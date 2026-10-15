<%@ WebHandler Language="C#" Class="CroWebhookReceiver" %>
<%@ Assembly Name="System.Security, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b03f5f7f11d50a3a" %>
<%@ Assembly Name="System.Data, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089" %>
<%@ Assembly Name="System.Configuration, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b03f5f7f11d50a3a" %>
// CRO webhook receiver – TotalAgility x Circularo.
// Receives Circularo document events, checks the HMAC-SHA256 signature (header x-circularo-signature) against the
// secret held DPAPI-encrypted in cro.secret, and stores every event in cro.webhook_event via cro_api.webhook_receive.
// It never calls Circularo or TotalAgility and does no processing: the CRO Sync process picks the events up.
// Replies 200 quickly for anything it stored (valid or not), so Circularo does not retry a bad signature forever.
using System;
using System.Configuration;
using System.Data;
using System.Data.SqlClient;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Web;

public class CroWebhookReceiver : IHttpHandler
{
    private const string ENTROPY = "CRO.Circularo.secret.v1";   // must match CRO API
    private const int MAX_BODY = 65536;
    private static string _secret; private static DateTime _secretAt = DateTime.MinValue;
    private static readonly object _lock = new object();

    public bool IsReusable { get { return true; } }

    public void ProcessRequest(HttpContext ctx)
    {
        ctx.Response.ContentType = "application/json";
        ctx.Response.Cache.SetCacheability(HttpCacheability.NoCache);
        if (ctx.Request.HttpMethod == "GET")
        {
            ctx.Response.Write("{\"service\":\"cro-webhook\",\"ok\":true}");   // health check only
            return;
        }
        if (ctx.Request.HttpMethod != "POST") { ctx.Response.StatusCode = 405; ctx.Response.Write("{\"ok\":false}"); return; }
        if (ctx.Request.ContentLength > MAX_BODY) { ctx.Response.StatusCode = 413; ctx.Response.Write("{\"ok\":false}"); return; }

        byte[] body;
        using (var ms = new MemoryStream())
        {
            ctx.Request.InputStream.CopyTo(ms);
            body = ms.ToArray();
        }
        if (body.Length > MAX_BODY) { ctx.Response.StatusCode = 413; ctx.Response.Write("{\"ok\":false}"); return; }

        string conn = ConfigurationManager.ConnectionStrings["Circularo"].ConnectionString;
        bool valid = false;
        try
        {
            string secret = Secret(conn);
            string given = (ctx.Request.Headers["x-circularo-signature"] ?? "").Trim().ToLowerInvariant();
            if (secret.Length > 0 && given.Length > 0)
            {
                string mine;
                using (var h = new HMACSHA256(Encoding.UTF8.GetBytes(secret))) mine = Hex(h.ComputeHash(body));
                valid = FixedEquals(mine, given);
            }
        }
        catch (Exception) { valid = false; }

        try
        {
            using (var c = new SqlConnection(conn))
            using (var cmd = new SqlCommand("cro_api.webhook_receive", c))
            {
                cmd.CommandType = CommandType.StoredProcedure;
                cmd.CommandTimeout = 15;
                cmd.Parameters.Add("@SignatureValid", SqlDbType.Bit).Value = valid;
                cmd.Parameters.Add("@RawBody", SqlDbType.NVarChar, -1).Value = Encoding.UTF8.GetString(body);
                c.Open();
                cmd.ExecuteNonQuery();
            }
            ctx.Response.StatusCode = 200;
            ctx.Response.Write("{\"ok\":true}");
        }
        catch (Exception)
        {
            ctx.Response.StatusCode = 503;   // could not store: let Circularo retry if it does
            ctx.Response.Write("{\"ok\":false}");
        }
    }

    // DPAPI (machine scope + CRO entropy) ciphertext from cro.secret; cached for 5 minutes.
    private static string Secret(string conn)
    {
        lock (_lock)
        {
            if (_secret != null && (DateTime.UtcNow - _secretAt).TotalMinutes < 5) return _secret;
            string b64 = null;
            using (var c = new SqlConnection(conn))
            using (var cmd = new SqlCommand("cro_api.secret_get", c))
            {
                cmd.CommandType = CommandType.StoredProcedure;
                cmd.Parameters.Add("@Name", SqlDbType.VarChar, 64).Value = "webhook_hmac_secret";
                c.Open();
                using (var r = cmd.ExecuteReader()) if (r.Read()) b64 = r["protected_b64"] as string;
            }
            _secret = string.IsNullOrEmpty(b64) ? "" :
                Encoding.UTF8.GetString(ProtectedData.Unprotect(Convert.FromBase64String(b64), Encoding.UTF8.GetBytes(ENTROPY), DataProtectionScope.LocalMachine));
            _secretAt = DateTime.UtcNow;
            return _secret;
        }
    }
    private static string Hex(byte[] b) { var sb = new StringBuilder(b.Length * 2); foreach (var x in b) sb.Append(x.ToString("x2")); return sb.ToString(); }
    private static bool FixedEquals(string a, string b)
    {
        if (a.Length != b.Length) return false;
        int d = 0; for (int i = 0; i < a.Length; i++) d |= a[i] ^ b[i];
        return d == 0;
    }
}
