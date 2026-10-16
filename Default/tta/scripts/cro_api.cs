using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net;
using System.Reflection;
using System.Text;
using Agility.Server.Scripting.ScriptAssembly;

namespace Cro
{
    // CRO API - synchronous operations for the CRO forms and processes (TotalAgility x Circularo).
    // Inputs:  OP, ARGS (JSON), SESSIONTOKEN, SPP_SYSTEM_SESSION_ID, CRO_CONFIG
    // Outputs: RESULT (JSON), ERROR (text), DEBUG (text)
    // The caller is identified on the server from SESSIONTOKEN; nothing the browser says about identity is trusted.
    // Database access is limited to fixed procedures in schema cro_api.
    public class CroApi
    {
        public CroApi()
        {
        }

        private const string VERSION = "cro-api 0.15.1";
        private const string SYSTEM_RESOURCE = "7DF43CCDF24611D2804B00104B71BD10";
        private const string DEFAULT_DB = @"Server=.\SQLEXPRESS;Database=Circularo;Integrated Security=true;TrustServerCertificate=true;Connect Timeout=15";

        // ---- minimal JSON (parse + serialize) ----
        private static object JParse(string s) { int i = 0; return JVal(s ?? "", ref i); }
        private static void JWs(string s, ref int i) { while (i < s.Length && char.IsWhiteSpace(s[i])) i++; }
        private static object JVal(string s, ref int i)
        {
            JWs(s, ref i);
            if (i >= s.Length) return null;
            char c = s[i];
            if (c == '{')
            {
                var d = new Dictionary<string, object>(); i++; JWs(s, ref i);
                if (i < s.Length && s[i] == '}') { i++; return d; }
                while (i < s.Length)
                {
                    JWs(s, ref i); string k = JStr(s, ref i); JWs(s, ref i); i++;
                    d[k] = JVal(s, ref i); JWs(s, ref i);
                    if (i < s.Length && s[i] == ',') { i++; continue; }
                    if (i < s.Length && s[i] == '}') { i++; break; }
                }
                return d;
            }
            if (c == '[')
            {
                var l = new List<object>(); i++; JWs(s, ref i);
                if (i < s.Length && s[i] == ']') { i++; return l; }
                while (i < s.Length)
                {
                    l.Add(JVal(s, ref i)); JWs(s, ref i);
                    if (i < s.Length && s[i] == ',') { i++; continue; }
                    if (i < s.Length && s[i] == ']') { i++; break; }
                }
                return l;
            }
            if (c == '"') return JStr(s, ref i);
            if (string.CompareOrdinal(s, i, "true", 0, 4) == 0) { i += 4; return true; }
            if (string.CompareOrdinal(s, i, "false", 0, 5) == 0) { i += 5; return false; }
            if (string.CompareOrdinal(s, i, "null", 0, 4) == 0) { i += 4; return null; }
            int st = i;
            while (i < s.Length && "+-0123456789.eE".IndexOf(s[i]) >= 0) i++;
            return double.Parse(s.Substring(st, i - st), CultureInfo.InvariantCulture);
        }
        private static string JStr(string s, ref int i)
        {
            var sb = new StringBuilder(); i++;
            while (i < s.Length && s[i] != '"')
            {
                if (s[i] == '\\')
                {
                    i++; char e = s[i];
                    if (e == 'n') sb.Append('\n'); else if (e == 't') sb.Append('\t'); else if (e == 'r') sb.Append('\r');
                    else if (e == 'b') sb.Append('\b'); else if (e == 'f') sb.Append('\f');
                    else if (e == 'u') { sb.Append((char)Convert.ToInt32(s.Substring(i + 1, 4), 16)); i += 4; }
                    else sb.Append(e);
                }
                else sb.Append(s[i]);
                i++;
            }
            i++; return sb.ToString();
        }
        private static string JSer(object o)
        {
            if (o == null || o is DBNull) return "null";
            if (o is string) return JQ((string)o);
            if (o is bool) return ((bool)o) ? "true" : "false";
            if (o is double || o is int || o is long || o is decimal || o is float || o is short)
                return Convert.ToDouble(o).ToString("R", CultureInfo.InvariantCulture);
            if (o is DateTime) return JQ(((DateTime)o).ToString("yyyy-MM-ddTHH:mm:ss.fffZ", CultureInfo.InvariantCulture));
            if (o is Guid) return JQ(o.ToString());
            var d = o as Dictionary<string, object>;
            if (d != null)
            {
                var parts = new List<string>();
                foreach (var kv in d) parts.Add(JQ(kv.Key) + ":" + JSer(kv.Value));
                return "{" + string.Join(",", parts) + "}";
            }
            var l = o as List<object>;
            if (l != null)
            {
                var parts = new List<string>();
                foreach (var x in l) parts.Add(JSer(x));
                return "[" + string.Join(",", parts) + "]";
            }
            return JQ(Convert.ToString(o, CultureInfo.InvariantCulture));
        }
        private static string JQ(string s)
        {
            var sb = new StringBuilder("\"");
            foreach (char c in s ?? "")
            {
                if (c == '"') sb.Append("\\\""); else if (c == '\\') sb.Append("\\\\");
                else if (c == '\n') sb.Append("\\n"); else if (c == '\r') sb.Append("\\r"); else if (c == '\t') sb.Append("\\t");
                else if (c < 32 || (int)c == 0x2028 || (int)c == 0x2029) sb.Append("\\u" + ((int)c).ToString("x4"));
                else sb.Append(c);
            }
            return sb.Append("\"").ToString();
        }
        private static Dictionary<string, object> JO(object o, string k) { var d = o as Dictionary<string, object>; return (d != null && d.ContainsKey(k)) ? d[k] as Dictionary<string, object> : null; }
        private static List<object> JL(object o, string k) { var d = o as Dictionary<string, object>; return (d != null && d.ContainsKey(k)) ? d[k] as List<object> : null; }
        private static string JS(object o, string k) { var d = o as Dictionary<string, object>; return (d != null && d.ContainsKey(k) && d[k] != null) ? Convert.ToString(d[k], CultureInfo.InvariantCulture) : ""; }
        private static string In(ScriptParameters sp, string k) { object v = sp.InputVariables[k]; return v == null ? "" : Convert.ToString(v, CultureInfo.InvariantCulture); }
        private static string Arg(object a, string k, int max) { string s = JS(a, k).Trim(); return s.Length > max ? s.Substring(0, max) : s; }
        private static string Inner(Exception e) { while (e is TargetInvocationException && e.InnerException != null) e = e.InnerException; return e.Message; }

        // ---- reflection helpers ----
        private static object Call(object o, string m, params object[] a)
        {
            foreach (var mi in o.GetType().GetMethods())
                if (mi.Name == m && mi.GetParameters().Length == a.Length && (a.Length == 0 || mi.GetParameters()[0].ParameterType == typeof(string)))
                    return mi.Invoke(o, a);
            foreach (var mi in o.GetType().GetMethods())
                if (mi.Name == m && mi.GetParameters().Length == a.Length) return mi.Invoke(o, a);
            throw new Exception("No method " + m);
        }
        private static PropertyInfo Prop(object o, string n)
        {
            PropertyInfo best = null;   // most-derived declaration (SqlCommand hides DbCommand members)
            foreach (var p in o.GetType().GetProperties())
                if (p.Name == n && (best == null || best.DeclaringType.IsAssignableFrom(p.DeclaringType))) best = p;
            if (best == null) throw new Exception("No property " + n);
            return best;
        }
        private static object GetP(object o, string n)
        {
            if (o == null) return null;
            PropertyInfo best = null;
            foreach (var p in o.GetType().GetProperties())
                if (p.Name == n && (best == null || best.DeclaringType.IsAssignableFrom(p.DeclaringType))) best = p;
            return best == null ? null : best.GetValue(o, null);
        }

        // ---- database: fixed procedures in cro_api only ----
        private static Type DbClient()
        {
            string[] names = {
                "System.Data.SqlClient.SqlConnection, System.Data, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089",
                "Microsoft.Data.SqlClient.SqlConnection, Microsoft.Data.SqlClient",
                "System.Data.SqlClient.SqlConnection, System.Data.SqlClient" };
            foreach (var n in names) { try { var t = Type.GetType(n, false); if (t != null) return t; } catch (Exception) { } }
            return null;
        }
        private static string DbConn(object cfg) { string s = JS(JO(cfg, "database"), "connection"); return s == "" ? DEFAULT_DB : s; }

        // Runs cro_api.<proc>; returns JSON: [ [ {row}, ... ], [ ...second result set ] ]
        private static string DbQuery(string conn, string proc, params object[] kv)
        {
            if (!proc.StartsWith("cro_api.")) throw new Exception("Only cro_api procedures may be called.");
            var t = DbClient();
            if (t == null) throw new Exception("No SQL client library is available to scripts.");
            var c = Activator.CreateInstance(t, conn);
            try
            {
                Call(c, "Open");
                var cmd = Call(c, "CreateCommand");
                var ct = Prop(cmd, "CommandType");
                ct.SetValue(cmd, Enum.Parse(ct.PropertyType, "StoredProcedure"), null);
                Prop(cmd, "CommandText").SetValue(cmd, proc, null);
                Prop(cmd, "CommandTimeout").SetValue(cmd, 60, null);
                var ps = Prop(cmd, "Parameters").GetValue(cmd, null);
                for (int i = 0; i + 1 < kv.Length; i += 2) Call(ps, "AddWithValue", (string)kv[i], kv[i + 1] ?? DBNull.Value);
                var r = Call(cmd, "ExecuteReader");
                var sb = new StringBuilder("[");
                bool firstSet = true;
                do
                {
                    int fc = (int)Prop(r, "FieldCount").GetValue(r, null);
                    if (fc == 0) continue;
                    var names = new string[fc];
                    for (int i = 0; i < fc; i++) names[i] = (string)Call(r, "GetName", i);
                    sb.Append(firstSet ? "[" : ",["); firstSet = false;
                    bool firstRow = true;
                    while ((bool)Call(r, "Read"))
                    {
                        sb.Append(firstRow ? "{" : ",{"); firstRow = false;
                        for (int i = 0; i < fc; i++)
                        {
                            if (names[i] == "row_ver") continue;
                            if (sb[sb.Length - 1] != '{') sb.Append(",");
                            sb.Append(JQ(names[i])).Append(":").Append(JSer(Call(r, "GetValue", i)));
                        }
                        sb.Append("}");
                    }
                    sb.Append("]");
                } while ((bool)Call(r, "NextResult"));
                Call(r, "Close");
                return sb.Append("]").ToString();
            }
            catch (TargetInvocationException e) { throw new Exception(proc + ": " + Inner(e)); }
            finally { try { ((IDisposable)c).Dispose(); } catch (Exception) { } }
        }
        private static object Nz(string s) { return string.IsNullOrEmpty(s) ? null : (object)s; }

        // ---- caller identity ----
        private static string[] Caller(string token, ref string dbg)
        {
            if (string.IsNullOrEmpty(token) || token.Length != 32) { dbg += "No session token. "; return null; }
            try
            {
                var us = new TotalAgility.Sdk.UserService();
                MethodInfo m = null;
                foreach (var mi in us.GetType().GetMethods())
                    if (mi.Name == "ValidateSession" && mi.GetParameters().Length == 1) m = mi;
                if (m == null) { dbg += "ValidateSession not found. "; return null; }
                var u = m.Invoke(us, new object[] { token });
                bool valid = Convert.ToString(GetP(u, "IsValid")).ToLowerInvariant() == "true";
                string id = Convert.ToString(GetP(u, "ResourceId")).ToUpperInvariant();
                string nm = Convert.ToString(GetP(u, "DisplayName"));
                if (!valid || id.Length != 32 || id == SYSTEM_RESOURCE) { dbg += "Session not valid for CRO use. "; return null; }
                return new[] { id, nm };
            }
            catch (Exception e) { dbg += "Session check failed: " + Inner(e) + " "; }
            return null;
        }

        // ---- HTTP ----
        private static string[] Http(string method, string url, string body, string contentType, int timeoutSec)
        {
            ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
            var req = (HttpWebRequest)WebRequest.Create(url);
            req.Method = method;
            req.Timeout = timeoutSec * 1000;
            req.Accept = "application/json";
            req.UserAgent = VERSION;
            if (body != null)
            {
                var bytes = Encoding.UTF8.GetBytes(body);
                req.ContentType = contentType ?? "application/json; charset=utf-8";
                req.ContentLength = bytes.Length;
                using (var s = req.GetRequestStream()) s.Write(bytes, 0, bytes.Length);
            }
            HttpWebResponse resp;
            try { resp = (HttpWebResponse)req.GetResponse(); }
            catch (WebException we)
            {
                resp = we.Response as HttpWebResponse;
                if (resp == null) return new[] { "0", we.Message };
            }
            using (resp)
            using (var rd = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
                return new[] { ((int)resp.StatusCode).ToString(CultureInfo.InvariantCulture), rd.ReadToEnd() };
        }

        // ---- HTTP with raw bytes (multipart upload, binary download) ----
        private static object[] HttpBytes(string method, string url, byte[] body, string contentType, int timeoutSec)
        {
            ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;
            var req = (HttpWebRequest)WebRequest.Create(url);
            req.Method = method;
            req.Timeout = timeoutSec * 1000;
            req.ReadWriteTimeout = timeoutSec * 1000;
            req.UserAgent = VERSION;
            if (body != null)
            {
                req.ContentType = contentType;
                req.ContentLength = body.Length;
                using (var s = req.GetRequestStream()) s.Write(body, 0, body.Length);
            }
            HttpWebResponse resp;
            try { resp = (HttpWebResponse)req.GetResponse(); }
            catch (WebException we)
            {
                resp = we.Response as HttpWebResponse;
                if (resp == null) return new object[] { 0, Encoding.UTF8.GetBytes(we.Message), "" };
            }
            using (resp)
            using (var ms = new MemoryStream())
            {
                resp.GetResponseStream().CopyTo(ms);
                return new object[] { (int)resp.StatusCode, ms.ToArray(), resp.ContentType ?? "" };
            }
        }
        private static byte[] Multipart(string boundary, Dictionary<string, string> fields, string fileField, string fileName, string fileType, byte[] file)
        {
            using (var ms = new MemoryStream())
            {
                Action<string> w = t => { var b = Encoding.UTF8.GetBytes(t); ms.Write(b, 0, b.Length); };
                foreach (var kv in fields)
                {
                    w("--" + boundary + "\r\n");
                    w("Content-Disposition: form-data; name=\"" + kv.Key + "\"\r\n\r\n");
                    w(kv.Value + "\r\n");
                }
                w("--" + boundary + "\r\n");
                w("Content-Disposition: form-data; name=\"" + fileField + "\"; filename=\"" + fileName.Replace("\"", "") + "\"\r\n");
                w("Content-Type: " + fileType + "\r\n\r\n");
                ms.Write(file, 0, file.Length);
                w("\r\n--" + boundary + "--\r\n");
                return ms.ToArray();
            }
        }
        // Calls the Circularo API with the key. Returns parsed JSON; throws with Circularo's message on error.
        private static object Cx(object cfg, string key, string method, string path, object body, ref string dbg)
        {
            string url = JS(JO(cfg, "circularo"), "apiBase").TrimEnd('/') + path + (path.Contains("?") ? "&" : "?") + "token=" + Uri.EscapeDataString(key);
            int to = (int)(JN(JO(cfg, "circularo"), "timeoutSeconds") > 0 ? JN(JO(cfg, "circularo"), "timeoutSeconds") : 100);
            var r = Http(method, url, body == null ? null : JSer(body), "application/json; charset=utf-8", to);
            string text = r[1].Replace(key, "***");
            if (r[0] != "200" && r[0] != "201")
            {
                object e = JParse(text);
                string msg = JS(e, "message"); string typ = JS(e, "type");
                throw new Exception("Circularo " + method + " " + path.Split('?')[0] + " -> " + r[0] + (typ != "" ? " " + typ : "") + ": " + (msg != "" ? msg : (text.Length > 300 ? text.Substring(0, 300) : text)));
            }
            return JParse(text);
        }
        private static double JN(object o, string k) { var d = o as Dictionary<string, object>; return (d != null && d.ContainsKey(k) && d[k] != null) ? Convert.ToDouble(d[k], CultureInfo.InvariantCulture) : 0; }
        private static double Clamp(double v, double lo, double hi) { return v < lo ? lo : (v > hi ? hi : v); }
        private static Dictionary<string, object> Pos(double x, double y, double w, double h)
        {
            w = Clamp(w, 0.01, 1); h = Clamp(h, 0.005, 1);
            var p = new Dictionary<string, object>();
            p["percentX"] = Math.Round(Clamp(x, 0, 1 - w), 5);
            p["percentY"] = Math.Round(Clamp(y, 0, 1 - h), 5);
            p["percentWidth"] = Math.Round(w, 5);
            p["percentHeight"] = Math.Round(h, 5);
            return p;
        }

        // ---- secrets: DPAPI (machine scope + CRO entropy) ciphertext in SQL; plain values never stored or returned ----
        private const string ENTROPY = "CRO.Circularo.secret.v1";
        private static byte[] Dpapi(bool protect, byte[] data)
        {
            var pd = Type.GetType("System.Security.Cryptography.ProtectedData, System.Security, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b03f5f7f11d50a3a", false);
            var sc = Type.GetType("System.Security.Cryptography.DataProtectionScope, System.Security, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b03f5f7f11d50a3a", false);
            if (pd == null || sc == null) throw new Exception("Windows DPAPI is not available to scripts.");
            var m = pd.GetMethod(protect ? "Protect" : "Unprotect", BindingFlags.Public | BindingFlags.Static);
            try { return (byte[])m.Invoke(null, new object[] { data, Encoding.UTF8.GetBytes(ENTROPY), Enum.Parse(sc, "LocalMachine") }); }
            catch (TargetInvocationException e) { throw new Exception("DPAPI " + (protect ? "protect" : "unprotect") + " failed: " + Inner(e)); }
        }
        private static string Fingerprint(string plain)
        {
            using (var h = System.Security.Cryptography.SHA256.Create())
            {
                var b = h.ComputeHash(Encoding.UTF8.GetBytes(plain));
                var sb = new StringBuilder();
                for (int i = 0; i < 8; i++) sb.Append(b[i].ToString("x2"));
                return sb.ToString();
            }
        }
        // Plain value of the secure server variable (system session, server-side only). Used to migrate it into the store.
        private static string SecureVar(string systemSession, string varId)
        {
            var svc = new TotalAgility.Sdk.ClientService();
            object v = null;
            foreach (var mi in svc.GetType().GetMethods())
            {
                var ps = mi.GetParameters();
                if (mi.Name == "GetServerVariableValue" && ps.Length == 2 && ps[0].ParameterType == typeof(string) && ps[1].ParameterType == typeof(string))
                { v = mi.Invoke(svc, new object[] { systemSession, varId }); break; }
            }
            object val = v is string ? v : GetP(v, "Value");
            return val == null ? "" : Convert.ToString(val, CultureInfo.InvariantCulture).Trim();
        }
        private static Dictionary<string, object> FirstRow(string dbJson)
        {
            var sets = JParse(dbJson) as List<object>;
            if (sets == null || sets.Count == 0) return null;
            var rows = sets[0] as List<object>;
            return (rows == null || rows.Count == 0) ? null : rows[0] as Dictionary<string, object>;
        }
        // The Circularo API key: from the encrypted store; falls back to the secure variable only until migrated.
        private static string ApiKey(string conn, string systemSession, ref string dbg)
        {
            Dictionary<string, object> row = null;
            try { row = FirstRow(DbQuery(conn, "cro_api.secret_get", "@Name", "circularo_api_key")); }
            catch (Exception e) { dbg += "Secret store unavailable: " + Inner(e) + " "; }
            if (row != null)
            {
                string key = Encoding.UTF8.GetString(Dpapi(false, Convert.FromBase64String(JS(row, "protected_b64"))));
                if (key.Length >= 16) return key;
            }
            string plain = SecureVar(systemSession, "CRO_API_KEY");
            if (plain.Length < 16) throw new Exception("The Circularo API key is not set (run key_migrate after entering it in CRO_API_KEY).");
            dbg += "API key read from CRO_API_KEY (not yet migrated to the encrypted store). ";
            return plain;
        }
        private static bool IsAdmin(object cfg, string resourceId)
        {
            var l = JL(cfg, "admins");
            if (l == null) return false;
            foreach (var x in l) if (string.Equals(Convert.ToString(x), resourceId, StringComparison.OrdinalIgnoreCase)) return true;
            return false;
        }

        // ---- send a draft request: upload (+anchors) -> document -> share ----
        private static string SendRequest(object cfg, string conn, string key, string actor, long requestId, string fileName, byte[] file, List<object> placed, object opts, ref string dbg)
        {
            var got = JParse(DbQuery(conn, "cro_api.request_get", "@RequestId", requestId)) as List<object>;
            var reqRows = got != null && got.Count > 0 ? got[0] as List<object> : null;
            if (reqRows == null || reqRows.Count == 0) throw new Exception("Request not found.");
            var req = reqRows[0] as Dictionary<string, object>;
            var rcps = got.Count > 1 ? got[1] as List<object> : new List<object>();
            if (JS(req, "state") != "draft" && JS(req, "state") != "failed") throw new Exception("Request is " + JS(req, "state") + ", not draft.");
            var cx = JO(cfg, "circularo");
            string docType = JS(req, "document_type") == "" ? JS(cx, "documentType") : JS(req, "document_type");
            string placement = JS(req, "placement");
            var layout = JO(JO(cfg, "layouts"), JS(req, "layout_key"));
            var anchors = layout == null ? new List<object>() : (JL(layout, "anchors") ?? new List<object>());
            if (placement != "anchors") anchors = new List<object>();
            // Ad hoc "tokens": {{sign:n}} in the document marks the field of recipient n (1-based, recipient order as listed).
            bool tokens = placement == "adhoc" && JS(req, "adhoc_option") == "tokens";
            // Ad hoc "detect": find common signing wording ("Signed by", "Signed on behalf of", ...) and put a field just above it.
            bool detect = placement == "adhoc" && JS(req, "adhoc_option") == "detect";
            var dcfg = JO(JO(cfg, "adhoc"), "detect");
            if (detect)
            {
                anchors = new List<object>();
                var phrases = JL(dcfg, "phrases") ?? new List<object> { "Signed for and on behalf of", "Signed on behalf of", "Signed by", "Authorised signatory", "Authorized signatory", "Signature:" };
                for (int pi = 0; pi < phrases.Count; pi++)
                {
                    var da = new Dictionary<string, object>();
                    da["id"] = "CRO_DETECT_" + pi; da["text"] = Convert.ToString(phrases[pi]); da["type"] = "detect"; da["allMatches"] = true;
                    var off = new Dictionary<string, object>();
                    off["percentX"] = JN(dcfg, "offsetX"); off["percentY"] = JN(dcfg, "offsetY") != 0 ? JN(dcfg, "offsetY") : -0.055;
                    off["percentWidth"] = JN(dcfg, "width") > 0 ? JN(dcfg, "width") : 0.25; off["percentHeight"] = JN(dcfg, "height") > 0 ? JN(dcfg, "height") : 0.045;
                    da["offset"] = off;
                    anchors.Add(da);
                }
            }
            if (tokens)
            {
                var tk = JO(JO(cfg, "adhoc"), "tokens");
                anchors = new List<object>();
                for (int ti = 1; ti <= rcps.Count; ti++)
                {
                    var ta = new Dictionary<string, object>();
                    ta["id"] = "CRO_TOKEN_" + ti; ta["text"] = "{{sign:" + ti + "}}"; ta["type"] = "signature"; ta["role"] = "#tok" + ti;
                    ta["allMatches"] = true;
                    var off = JO(tk, "offset"); if (off == null) { off = new Dictionary<string, object>(); ((Dictionary<string, object>)off)["percentX"] = 0.0; ((Dictionary<string, object>)off)["percentY"] = -0.01; ((Dictionary<string, object>)off)["percentWidth"] = 0.22; ((Dictionary<string, object>)off)["percentHeight"] = 0.045; }
                    ta["offset"] = off;
                    anchors.Add(ta);
                }
            }
            if (file == null || file.Length == 0) throw new Exception("No file.");
            double maxMb = JN(cx, "maxUploadMB") > 0 ? JN(cx, "maxUploadMB") : 40;
            if (file.Length > maxMb * 1024 * 1024) throw new Exception("File is larger than " + maxMb + " MB.");

            // 1. upload with anchors
            var fields = new Dictionary<string, string>();
            fields["fileName"] = fileName;
            if (anchors.Count > 0)
            {
                var sa = new List<object>();
                foreach (var ao in anchors)
                {
                    var a = ao as Dictionary<string, object>;
                    var x = new Dictionary<string, object>();
                    x["id"] = JS(a, "id");
                    if (JS(a, "regexp") != "") x["regexp"] = JS(a, "regexp"); else x["text"] = JS(a, "text");
                    x["offset"] = a["offset"];
                    sa.Add(x);
                }
                fields["signatureAnchors"] = JSer(sa);
            }
            string boundary = "----cro" + Guid.NewGuid().ToString("N");
            string ext = Path.GetExtension(fileName).ToLowerInvariant();
            string ctype = ext == ".pdf" ? "application/pdf" : ext == ".docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "application/octet-stream";
            string upUrl = JS(cx, "apiBase").TrimEnd('/') + "/files/saveFile?token=" + Uri.EscapeDataString(key);
            var up = HttpBytes("POST", upUrl, Multipart(boundary, fields, "file", fileName, ctype, file), "multipart/form-data; boundary=" + boundary, 180);
            string upText = Encoding.UTF8.GetString((byte[])up[1]).Replace(key, "***");
            if ((int)up[0] != 200) throw new Exception("Circularo upload -> " + up[0] + ": " + (upText.Length > 300 ? upText.Substring(0, 300) : upText));
            var upJ = JParse(upText);
            var fileObj = JO(upJ, "file");
            string hash = JS(fileObj, "hash"); if (hash == "") hash = JS(fileObj, "id");
            int pages = (int)JN(fileObj, "pages"); if (pages < 1) pages = 1;
            if (hash == "") throw new Exception("Upload returned no file hash.");

            // anchor matches by id (de-duplicated)
            var found = new Dictionary<string, List<Dictionary<string, object>>>();
            var ap = JL(upJ, "anchorPositions");
            if (ap != null)
                foreach (var o in ap)
                {
                    string id = JS(o, "id");
                    var list = new List<Dictionary<string, object>>(); var seen = new HashSet<string>();
                    var fl = JL(o, "fields");
                    if (fl != null) foreach (var f in fl)
                    {
                        var pos = JO(f, "position");
                        string sig = JS(f, "page") + "|" + JS(pos, "percentX") + "|" + JS(pos, "percentY");
                        if (seen.Add(sig)) list.Add(f as Dictionary<string, object>);
                    }
                    found[id] = list;
                }

            // recipient numbers for tokens / placed fields = the order the recipients were given in (recipient_id), not the signing order
            var byInsert = new List<long>(); foreach (var ro in rcps) byInsert.Add(Convert.ToInt64(JN(ro, "recipient_id"))); byInsert.Sort();
            // 2. recipients -> shareTo
            var byRole = new Dictionary<string, List<Dictionary<string, object>>>(StringComparer.OrdinalIgnoreCase);
            var shareTo = new Dictionary<long, string>();
            foreach (var ro in rcps)
            {
                var r = ro as Dictionary<string, object>;
                long rid = Convert.ToInt64(JN(r, "recipient_id"));
                string to = JS(r, "email");
                if (JS(r, "kind") == "internal" && JS(r, "internal_mode") != "as_external")
                {
                    var all = JParse(DbQuery(conn, "cro_api.user_list")) as List<object>;
                    if (all != null && all.Count > 0)
                        foreach (var uo in (all[0] as List<object>))
                            if (string.Equals(JS(uo, "email"), to, StringComparison.OrdinalIgnoreCase) && JS(uo, "circularo_username") != "") to = JS(uo, "circularo_username");
                }
                shareTo[rid] = to;
                if (tokens) { string tr = "#tok" + (byInsert.IndexOf(rid) + 1); if (!byRole.ContainsKey(tr)) byRole[tr] = new List<Dictionary<string, object>>(); byRole[tr].Add(r); }
                string role = JS(r, "anchor_id");
                if (role == "") role = "#" + rid;
                if (!byRole.ContainsKey(role)) byRole[role] = new List<Dictionary<string, object>>();
                byRole[role].Add(r);
            }

            // 3. signature fields from anchors
            var sigFields = new List<object>();
            var covered = new HashSet<long>();
            var notes = new List<string>();
            bool annotations = JS(JO(cfg, "defaults"), "annotations").ToLowerInvariant() == "true";
            if (detect)
            {
                // all matches of all phrases, top to bottom; the k-th one goes to the k-th signing recipient (in the order given)
                var hits = new List<Dictionary<string, object>>();
                foreach (var ao in anchors)
                {
                    List<Dictionary<string, object>> ms;
                    if (found.TryGetValue(JS(ao, "id"), out ms)) foreach (var m in ms) { var hh = new Dictionary<string, object>(m); hh["_off"] = JO(ao, "offset"); hits.Add(hh); }
                }
                hits.Sort((x, y) => { int c = JN(x, "page").CompareTo(JN(y, "page")); if (c != 0) return c; c = JN(JO(x, "position"), "percentY").CompareTo(JN(JO(y, "position"), "percentY")); return c != 0 ? c : JN(JO(x, "position"), "percentX").CompareTo(JN(JO(y, "position"), "percentX")); });
                // a longer phrase and a shorter one inside it hit the same spot: keep one per spot
                var uniq = new List<Dictionary<string, object>>();
                foreach (var hh in hits)
                {
                    bool dup = false;
                    foreach (var u in uniq) if (JN(u, "page") == JN(hh, "page") && Math.Abs(JN(JO(u, "position"), "percentY") - JN(JO(hh, "position"), "percentY")) < 0.01) dup = true;
                    if (!dup) uniq.Add(hh);
                }
                var signRids = new List<long>();
                foreach (var rid0 in byInsert) foreach (var ro in rcps) if (Convert.ToInt64(JN(ro, "recipient_id")) == rid0 && "sign approve accept".Contains(JS(ro, "share_purpose"))) signRids.Add(rid0);
                for (int k = 0; k < uniq.Count && k < signRids.Count; k++)
                {
                    var m = uniq[k]; var mp = JO(m, "position"); var off = JO(m, "_off");
                    var f = new Dictionary<string, object>();
                    f["user"] = new List<object> { shareTo[signRids[k]] }; f["type"] = "signature";
                    f["pages"] = new List<object> { JN(m, "page") };
                    f["position"] = Pos(JN(mp, "percentX"), JN(mp, "percentY"), JN(off, "percentWidth"), JN(off, "percentHeight"));
                    f["required"] = true; f["timestamp"] = true;
                    sigFields.Add(f); covered.Add(signRids[k]);
                }
                notes.Add("signing wording found " + uniq.Count + " time(s) for " + signRids.Count + " signer(s)");
                anchors = new List<object>();
            }
            foreach (var ao in anchors)
            {
                var a = ao as Dictionary<string, object>;
                string id = JS(a, "id"), type = JS(a, "type");
                if (type == "annotation" && !annotations) { notes.Add(id + ": annotation skipped"); continue; }
                List<Dictionary<string, object>> matches;
                if (!found.TryGetValue(id, out matches) || matches.Count == 0) { notes.Add(id + ": no match"); continue; }
                var orderRoles = JL(a, "roleByMatchOrder");
                bool all = JS(a, "allMatches").ToLowerInvariant() == "true";
                for (int mi = 0; mi < matches.Count; mi++)
                {
                    if (!all && orderRoles == null && mi > 0) { notes.Add(id + ": " + (matches.Count - 1) + " extra match(es) ignored"); break; }
                    string roleSpec = orderRoles != null ? (mi < orderRoles.Count ? Convert.ToString(orderRoles[mi]) : "") : JS(a, "role");
                    var users = new List<object>(); var rids = new List<long>();
                    foreach (var role in roleSpec.Split(','))
                    {
                        List<Dictionary<string, object>> rl;
                        if (byRole.TryGetValue(role.Trim(), out rl)) foreach (var r in rl) { long rid = Convert.ToInt64(JN(r, "recipient_id")); users.Add(shareTo[rid]); rids.Add(rid); }
                    }
                    if (users.Count == 0) { notes.Add(id + ": no recipient for role " + roleSpec); continue; }
                    var m = matches[mi]; var mp = JO(m, "position"); var off = JO(a, "offset");
                    var f = new Dictionary<string, object>();
                    f["user"] = users;
                    f["type"] = type == "" ? "signature" : type;
                    if (type == "annotation") f["subtype"] = JS(a, "subtype");
                    f["pages"] = new List<object> { JN(m, "page") };
                    f["position"] = Pos(JN(mp, "percentX"), JN(mp, "percentY"), JN(off, "percentWidth"), JN(off, "percentHeight"));
                    f["required"] = true;
                    f["timestamp"] = false;
                    sigFields.Add(f);
                    if (type == "signature" || type == "stamp" || type == "initials") foreach (var rid in rids) covered.Add(rid);
                }
            }

            // 3b. fields placed by hand (TotalAgility placer or a calling process): [{recipient (1-based), page, x, y, w, h, type}]
            int placedCount = 0;
            if (placed != null && placed.Count > 0)
            {
                var order = byInsert;
                foreach (var po in placed)
                {
                    int n = (int)JN(po, "recipient");
                    if (n < 1 || n > order.Count) { notes.Add("placed field for unknown recipient " + n); continue; }
                    long rid = order[n - 1];
                    int pg = (int)JN(po, "page"); if (pg < 1) pg = 1; if (pg > pages) pg = pages;
                    string ty = JS(po, "type"); if (ty != "initials" && ty != "stamp") ty = "signature";
                    var f = new Dictionary<string, object>();
                    f["user"] = new List<object> { shareTo[rid] };
                    f["type"] = ty;
                    f["pages"] = new List<object> { (double)pg };
                    f["position"] = Pos(JN(po, "x"), JN(po, "y"), JN(po, "w") > 0 ? JN(po, "w") : 0.22, JN(po, "h") > 0 ? JN(po, "h") : 0.045);
                    f["required"] = true;
                    f["timestamp"] = ty == "signature";
                    sigFields.Add(f);
                    if (ty == "signature" || ty == "stamp" || ty == "initials") covered.Add(rid);
                    placedCount++;
                }
            }

            // 4. ad hoc / fallback: default position on the last page for every signer without a field
            var dp = JO(JO(cfg, "adhoc"), "defaultPosition");
            int idx = 0;
            string placementUsed = detect ? (covered.Count > 0 ? "detect" : "adhoc") : tokens ? "tokens" : anchors.Count > 0 ? "anchors" : placedCount > 0 ? "tta_placer" : "adhoc";
            foreach (var ro in rcps)
            {
                var r = ro as Dictionary<string, object>;
                long rid = Convert.ToInt64(JN(r, "recipient_id"));
                string purpose = JS(r, "share_purpose");
                if (covered.Contains(rid) || purpose == "view" || purpose == "review") continue;
                int cols = (int)(JN(dp, "columns") > 0 ? JN(dp, "columns") : 2);
                double w = JN(dp, "width") > 0 ? JN(dp, "width") : 0.25, h = JN(dp, "height") > 0 ? JN(dp, "height") : 0.05;
                double x = (JN(dp, "x") > 0 ? JN(dp, "x") : 0.08) + (idx % cols) * (w + JN(dp, "columnGap"));
                double y = (JN(dp, "y") > 0 ? JN(dp, "y") : 0.7) + (idx / cols) * (h + JN(dp, "rowGap") + 0.02);
                var f = new Dictionary<string, object>();
                f["user"] = new List<object> { shareTo[rid] };
                f["type"] = "signature";
                f["pages"] = new List<object> { (double)pages };
                f["position"] = Pos(x, y, w, h);
                f["required"] = true;
                f["timestamp"] = true;
                f["tooltip"] = "Signature";
                sigFields.Add(f);
                idx++;
                placementUsed = detect ? (covered.Count > 0 ? "detect+default" : "default_position") : tokens ? (covered.Count > 0 ? "tokens+default" : "default_position") : anchors.Count > 0 ? "anchors+default" : placedCount > 0 ? "tta_placer+default" : "default_position";
            }

            // 5. document
            var body = new Dictionary<string, object>();
            body["documentType"] = docType;
            body["documentTitle"] = JS(req, "title");
            var pdf = new Dictionary<string, object>(); pdf["content"] = hash; body["pdfFile"] = pdf;
            var docReq = new Dictionary<string, object>();
            docReq["body"] = body;
            docReq["definitionType"] = JS(cx, "definitionType") == "" ? "ext" : JS(cx, "definitionType");
            docReq["workflow"] = JS(cx, "workflow") == "" ? "wf_archive" : JS(cx, "workflow");
            if (JS(cx, "folderPath") != "") { var od = new Dictionary<string, object>(); od["path"] = JS(cx, "folderPath"); docReq["optionalData"] = od; }
            var docRes = Cx(cfg, key, "POST", "/documents", docReq, ref dbg);
            string docId = JS(docRes, "id");
            if (docId == "") { var rr = JL(docRes, "results"); if (rr != null && rr.Count > 0) docId = JS(rr[0], "documentId"); }
            if (docId == "") throw new Exception("Circularo did not return a document id.");
            DbQuery(conn, "cro_api.request_set_document", "@RequestId", requestId, "@DocumentId", docId, "@FileHash", hash,
                    "@PlacementUsed", placementUsed.Length > 20 ? placementUsed.Substring(0, 20) : placementUsed,
                    "@Detail", string.Join("; ", notes.ToArray()));

            // 6. share
            try
            {
                var defs = JO(cfg, "defaults");
                var orders = new HashSet<string>();
                foreach (var ro in rcps) orders.Add(JS(ro, "sign_order"));
                bool sequential = orders.Count > 1;
                string validUntil = JS(req, "valid_until_utc");
                if (validUntil == "") validUntil = DateTime.UtcNow.AddDays(JN(defs, "deadlineDays") > 0 ? JN(defs, "deadlineDays") : 14).ToString("yyyy-MM-ddTHH:mm:ss.fffZ", CultureInfo.InvariantCulture);
                var rem = JO(defs, "reminders");
                var data = new List<object>();
                foreach (var ro in rcps)
                {
                    var r = ro as Dictionary<string, object>;
                    long rid = Convert.ToInt64(JN(r, "recipient_id"));
                    var d = new Dictionary<string, object>();
                    d["sharePurpose"] = JS(r, "share_purpose");
                    d["shareTo"] = shareTo[rid];
                    d["validUntil"] = validUntil;
                    if (sequential || JN(JO(opts, "quorum"), JS(r, "sign_order")) > 0) d["order"] = JN(r, "sign_order");
                    string prot = JS(r, "protection");
                    bool isExt = JS(r, "kind") == "external" || JS(r, "internal_mode") == "as_external";
                    if (isExt && prot == "email_otp") { d["otpEnabled"] = true; d["mail"] = JS(r, "email"); }
                    // options (not stored): password per recipient number, signing-group quorum per order, rights, message
                    int rno = byInsert.IndexOf(rid) + 1;
                    if (isExt && prot == "password")
                    {
                        string pw = JS(JO(opts, "passwords"), rno.ToString(CultureInfo.InvariantCulture));
                        if (pw.Length < 6) throw new Exception("Recipient " + rno + " is password-protected but has no password of at least 6 characters.");
                        d["password"] = pw;
                    }
                    double qn = JN(JO(opts, "quorum"), JS(r, "sign_order"));
                    if (qn > 0) d["quorum"] = qn;
                    var rights = JL(opts, "rights"); if (rights != null) d["rights"] = rights;
                    if (JS(opts, "message") != "") d["message"] = JS(opts, "message").Length > 1000 ? JS(opts, "message").Substring(0, 1000) : JS(opts, "message");
                    if (rem != null && JN(rem, "intervalDays") > 0)
                    {
                        var ar = new Dictionary<string, object>();
                        ar["start"] = DateTime.UtcNow.AddDays(JN(rem, "startDays")).ToString("yyyy-MM-ddTHH:mm:ss.fffZ", CultureInfo.InvariantCulture);
                        ar["intervalDays"] = JN(rem, "intervalDays");
                        d["automaticReminder"] = ar;
                    }
                    data.Add(d);
                }
                var share = new Dictionary<string, object>();
                share["objectType"] = "document";
                share["type"] = docType;
                share["id"] = docId;
                share["data"] = data;
                share["signatureFields"] = sigFields;
                share["sequential"] = sequential;
                var shRes = Cx(cfg, key, "POST", "/share", share, ref dbg) as List<object>;
                var map = new List<object>();
                foreach (var ro in rcps)
                {
                    long rid = Convert.ToInt64(JN(ro, "recipient_id"));
                    string to = shareTo[rid], sid = "";
                    if (shRes != null)
                        foreach (var so in shRes)
                        {
                            var sw = JL(so, "sharedWith");
                            bool hit = string.Equals(JS(so, "sharedUsername"), to, StringComparison.OrdinalIgnoreCase);
                            if (!hit && sw != null) foreach (var x in sw) if (string.Equals(Convert.ToString(x), to, StringComparison.OrdinalIgnoreCase)) hit = true;
                            if (hit) { sid = JS(so, "shareId"); break; }
                        }
                    var e = new Dictionary<string, object>(); e["recipientId"] = (double)rid; e["shareId"] = sid; e["shareTo"] = to;
                    map.Add(e);
                }
                DbQuery(conn, "cro_api.request_set_shares", "@RequestId", requestId, "@Json", JSer(map));
                var res = new Dictionary<string, object>();
                res["requestId"] = (double)requestId; res["documentId"] = docId; res["fileHash"] = hash; res["pages"] = (double)pages;
                res["placementUsed"] = placementUsed; res["fields"] = (double)sigFields.Count; res["sequential"] = sequential;
                res["shares"] = map; res["notes"] = new List<object>(notes.ToArray());
                return JSer(res);
            }
            catch (Exception e)
            {
                DbQuery(conn, "cro_api.request_set_state", "@RequestId", requestId, "@State", "failed", "@Reason", Inner(e).Length > 1900 ? Inner(e).Substring(0, 1900) : Inner(e), "@Source", "system", "@Actor", actor);
                throw;
            }
        }

        // ---- outputs: signed PDF, audit trail, Certificate of Fulfillment -> SQL ----
        private static string Sha256Hex(byte[] b)
        {
            using (var h = System.Security.Cryptography.SHA256.Create())
            {
                var x = h.ComputeHash(b); var sb = new StringBuilder();
                foreach (var c in x) sb.Append(c.ToString("x2"));
                return sb.ToString();
            }
        }
        private static bool IsPdf(byte[] b) { return b != null && b.Length > 4 && b[0] == 0x25 && b[1] == 0x50 && b[2] == 0x44 && b[3] == 0x46; }
        private static bool HasSignature(byte[] b)
        {
            string t = Encoding.ASCII.GetString(b);
            return t.Contains("/ByteRange") && (t.Contains("/Type /Sig") || t.Contains("/Type/Sig") || t.Contains("/SubFilter"));
        }
        private static string SafeName(string s)
        {
            var sb = new StringBuilder();
            foreach (char c in s) sb.Append("/?<>\\:*|\"".IndexOf(c) >= 0 || c < 32 ? '_' : c);
            string r = sb.ToString().Trim(); return r.Length > 150 ? r.Substring(0, 150) : r;
        }
        private static string FetchOutputs(object cfg, string conn, string key, long requestId, ref string dbg)
        {
            var req = FirstRow(DbQuery(conn, "cro_api.request_get", "@RequestId", requestId));
            if (req == null) throw new Exception("Request not found.");
            if (JS(req, "state") != "completed") throw new Exception("Request is " + JS(req, "state") + "; outputs are fetched only when completed.");
            string docId = JS(req, "circularo_document_id");
            string hash = JS(req, "signed_file_hash");
            if (hash == "" || hash == JS(req, "original_file_hash"))
            {
                // re-read: signing creates a new hash
                var dj = Cx(cfg, key, "GET", "/documents/" + Uri.EscapeDataString(docId), null, ref dbg);
                var rl = JL(dj, "results");
                var doc = rl != null && rl.Count > 0 ? rl[0] : dj;
                hash = JS(JO(JO(doc, "values"), "pdfFile"), "content"); if (hash == "") hash = JS(JO(doc, "pdfFile"), "content");
            }
            if (hash == "") throw new Exception("No signed file hash.");
            string apiBase = JS(JO(cfg, "circularo"), "apiBase").TrimEnd('/');
            string tk = "token=" + Uri.EscapeDataString(key);
            string title = SafeName(JS(req, "title"));
            var items = new[] {
                new[] { "signed", apiBase + "/files/loadFile/hash/" + Uri.EscapeDataString(hash) + "?" + tk, title + ".pdf", hash },
                new[] { "audit", apiBase + "/documents/" + Uri.EscapeDataString(docId) + "/audit?" + tk, title + " (audit trail).pdf", "" },
                new[] { "certificate", apiBase + "/documents/" + Uri.EscapeDataString(docId) + "/audit?cof=true&" + tk, title + " (certificate of fulfillment).pdf", "" } };
            var list = new List<object>();
            foreach (var it in items)
            {
                var r = HttpBytes("GET", it[1], null, null, 180);
                var bytes = (byte[])r[1];
                var e = new Dictionary<string, object>(); e["kind"] = it[0];
                if ((int)r[0] != 200 || !IsPdf(bytes))
                {
                    string t = Encoding.UTF8.GetString(bytes, 0, Math.Min(bytes.Length, 300)).Replace(key, "***");
                    e["error"] = "HTTP " + r[0] + (IsPdf(bytes) ? "" : " (not a PDF): " + t);
                    list.Add(e); continue;
                }
                string sha = Sha256Hex(bytes);
                bool sig = HasSignature(bytes);
                DbQuery(conn, "cro_api.output_save", "@RequestId", requestId, "@Kind", it[0], "@FileName", it[2], "@ContentType", "application/pdf",
                        "@Content", bytes, "@Sha256", sha, "@SourceHash", Nz(it[3]), "@HasSignature", sig);
                e["size"] = (double)bytes.Length; e["sha256"] = sha; e["hasSignature"] = sig; e["fileName"] = it[2];
                list.Add(e);
            }
            bool allOk = true;
            foreach (var o in list) if (JS(o, "error") != "") allOk = false;
            if (allOk) DbQuery(conn, "cro_api.request_outputs_done", "@RequestId", requestId, "@Detail", "signed, audit, certificate");
            var res = new Dictionary<string, object>(); res["requestId"] = (double)requestId; res["documentId"] = docId; res["signedHash"] = hash; res["outputs"] = list; res["complete"] = allOk;
            return JSer(res);
        }

        // ---- read Circularo status and store it ----
        private static string RefreshRequest(object cfg, string conn, string key, long requestId, string source, ref string dbg)
        {
            var got = JParse(DbQuery(conn, "cro_api.request_get", "@RequestId", requestId)) as List<object>;
            var req = FirstRow(JSer(got));
            if (req == null) throw new Exception("Request not found.");
            string docId = JS(req, "circularo_document_id");
            if (docId == "") throw new Exception("Request has no Circularo document yet.");
            var dj = Cx(cfg, key, "GET", "/documents/" + Uri.EscapeDataString(docId), null, ref dbg);
            var rl = JL(dj, "results");
            var doc = rl != null && rl.Count > 0 ? rl[0] as Dictionary<string, object> : dj as Dictionary<string, object>;
            var wf = JO(doc, "workflow");
            string st = JS(wf, "shareStateName").ToLowerInvariant();
            string state = st == "completed" ? "completed" : st == "rejected" ? "rejected" : st == "expired" ? "expired" : st == "cancelled" || st == "canceled" ? "cancelled" : "inprogress";
            // waitingFor carries the shareId: match recipients by share id (Circularo may resolve an email to an internal username).
            var waiting = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var turn = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var wl = JL(wf, "waitingFor");
            if (wl != null) foreach (var w in wl)
            {
                string sid = JS(w, "shareId"); string n = JS(JO(w, "user"), "name"); if (n == "") n = JS(w, "user");
                if (sid != "") waiting.Add(sid); if (n != "") waiting.Add("u:" + n);
                if (sid != "" && JS(w, "hasTurn").ToLowerInvariant() == "true") turn.Add(sid);
            }
            var rcps = got.Count > 1 ? got[1] as List<object> : new List<object>();
            var upd = new List<object>();
            foreach (var ro in rcps)
            {
                string sid = JS(ro, "share_id");
                bool isWaiting = sid != "" ? waiting.Contains(sid) : waiting.Contains("u:" + JS(ro, "share_to"));
                string status = state == "completed" ? "signed" : state == "rejected" ? (isWaiting ? "rejected" : JS(ro, "status"))
                              : state == "expired" ? (isWaiting ? "expired" : "signed") : state == "cancelled" ? "cancelled"
                              : (isWaiting ? (sid != "" && !turn.Contains(sid) ? "pending" : "waiting") : "signed");
                var e = new Dictionary<string, object>(); e["recipientId"] = JN(ro, "recipient_id"); e["status"] = status; upd.Add(e);
            }
            string signedHash = state == "completed" ? JS(JO(JO(doc, "values"), "pdfFile"), "content") : "";
            if (signedHash == "" && state == "completed") signedHash = JS(JO(doc, "pdfFile"), "content");
            DbQuery(conn, "cro_api.request_set_state", "@RequestId", requestId, "@State", state, "@Reason", Nz(st == "" ? "" : "Circularo: " + st),
                    "@SignedFileHash", Nz(signedHash), "@RecipientsJson", JSer(upd), "@Source", source, "@Actor", "system");
            var res = new Dictionary<string, object>();
            res["requestId"] = (double)requestId; res["documentId"] = docId; res["circularoState"] = st; res["state"] = state;
            res["isSigned"] = JS(doc, "isSigned"); res["waitingFor"] = new List<object>(new List<string>(waiting).ToArray()); res["hasTurn"] = new List<object>(new List<string>(turn).ToArray()); res["recipients"] = upd;
            return JSer(res);
        }

        // ---- background sync (CRO Sync process, run mode "sync") ----
        // 1. webhook inbox: refresh each request that has unprocessed events, mark events done
        // 2. polling safety net: requests with no event for a while, near deadline, or completed without outputs
        private static string Sync(object cfg, string conn, string key, ref string dbg)
        {
            var sc = JO(cfg, "sync");
            int batch = (int)(JN(sc, "batch") > 0 ? JN(sc, "batch") : 50);
            var log = new List<object>();
            var done = new HashSet<long>();
            int ok = 0, failed = 0;
            var events = FirstSet(DbQuery(conn, "cro_api.webhook_next", "@Max", batch));
            var byReq = new Dictionary<long, List<long>>();
            foreach (var e in events)
            {
                long rid = Convert.ToInt64(JN(e, "request_id")), eid = Convert.ToInt64(JN(e, "event_id"));
                if (!byReq.ContainsKey(rid)) byReq[rid] = new List<long>();
                byReq[rid].Add(eid);
            }
            foreach (var kv in byReq)
            {
                string outcome;
                try { outcome = SyncOne(cfg, conn, key, kv.Key, "webhook", ref dbg); ok++; }
                catch (Exception ex) { outcome = "error: " + Inner(ex); failed++; }
                foreach (var eid in kv.Value) DbQuery(conn, "cro_api.webhook_done", "@EventId", eid, "@Result", outcome.Length > 1900 ? outcome.Substring(0, 1900) : outcome);
                done.Add(kv.Key);
                var l = new Dictionary<string, object>(); l["requestId"] = (double)kv.Key; l["via"] = "webhook"; l["events"] = (double)kv.Value.Count; l["result"] = outcome; log.Add(l);
            }
            var due = FirstSet(DbQuery(conn, "cro_api.requests_due_check",
                "@StaleMinutes", (int)(JN(sc, "pollStaleMinutes") > 0 ? JN(sc, "pollStaleMinutes") : 30),
                "@NearDeadlineMinutes", (int)(JN(sc, "nearDeadlineMinutes") > 0 ? JN(sc, "nearDeadlineMinutes") : 1440),
                "@NearDeadlineEvery", (int)(JN(sc, "nearDeadlineEveryMinutes") > 0 ? JN(sc, "nearDeadlineEveryMinutes") : 5),
                "@Max", batch));
            foreach (var d in due)
            {
                long rid = Convert.ToInt64(JN(d, "request_id"));
                if (done.Contains(rid)) continue;
                string outcome;
                try { outcome = SyncOne(cfg, conn, key, rid, "poll", ref dbg); ok++; }
                catch (Exception ex) { outcome = "error: " + Inner(ex); failed++; }
                var l = new Dictionary<string, object>(); l["requestId"] = (double)rid; l["via"] = "poll"; l["result"] = outcome; log.Add(l);
            }
            var res = new Dictionary<string, object>();
            res["events"] = (double)events.Count; res["requests"] = (double)log.Count; res["ok"] = (double)ok; res["failed"] = (double)failed; res["log"] = log;
            string summary = JSer(res);
            try { DbQuery(conn, "cro_api.sync_heartbeat", "@Events", events.Count, "@Requests", log.Count, "@Failed", failed, "@Summary", summary.Length > 3900 ? summary.Substring(0, 3900) : summary); }
            catch (Exception ex) { dbg += "Heartbeat not recorded: " + Inner(ex) + " "; }
            return summary;
        }
        // The caller's email, decided server-side: CRO user record first, then the TotalAgility resource.
        private static string CallerEmail(string conn, string systemSession, string resourceId, ref string dbg)
        {
            try
            {
                foreach (var u in FirstSet(DbQuery(conn, "cro_api.user_list")))
                    if (string.Equals(JS(u, "tta_resource_id"), resourceId, StringComparison.OrdinalIgnoreCase) && JS(u, "email") != "") return JS(u, "email").ToLowerInvariant();
            }
            catch (Exception) { }
            try
            {
                var asm = typeof(TotalAgility.Sdk.UserService).Assembly;
                var rt = asm.GetType("TotalAgility.Sdk.ResourceService", false);
                if (rt != null)
                {
                    var svc = Activator.CreateInstance(rt);
                    foreach (var mi in rt.GetMethods())
                    {
                        var ps = mi.GetParameters();
                        if ((mi.Name != "GetResourceSummary" && mi.Name != "GetWorkerResource") || ps.Length != 2 || ps[0].ParameterType != typeof(string)) continue;
                        object idArg = ps[1].ParameterType == typeof(string) ? (object)resourceId : Activator.CreateInstance(ps[1].ParameterType);
                        if (!(idArg is string)) { var pid = idArg.GetType().GetProperty("Id"); if (pid != null) pid.SetValue(idArg, resourceId, null); }
                        var r = mi.Invoke(svc, new object[] { systemSession, idArg });
                        foreach (var n in new[] { "Email", "EmailAddress", "Mail" })
                        {
                            var v = Convert.ToString(GetP(r, n) ?? GetP(GetP(r, "Resource"), n));
                            if (!string.IsNullOrEmpty(v)) return v.Trim().ToLowerInvariant();
                        }
                    }
                }
            }
            catch (Exception ex) { dbg += "Email lookup: " + Inner(ex) + " "; }
            return "";
        }
        // Refresh one request; when completed, fetch the outputs if not yet stored.
        private static string SyncOne(object cfg, string conn, string key, long rid, string source, ref string dbg)
        {
            var req = FirstRow(DbQuery(conn, "cro_api.request_get", "@RequestId", rid));
            if (req == null) return "request not found";
            string state = JS(req, "state");
            if (state == "sending" && JS(req, "placement_used") == "circularo_editor")
            {
                int got = ImportShares(cfg, conn, key, rid, ref dbg);
                if (got == 0) return "waiting for the sender to send from the Circularo editor";
                state = "inprogress";
            }
            if (state == "inprogress" || state == "sending" || (state == "completed" && JS(req, "outputs_retrieved_utc") == ""))
            {
                if (state != "completed")
                {
                    var r = JParse(RefreshRequest(cfg, conn, key, rid, source, ref dbg));
                    state = JS(r, "state");
                }
                if (state == "completed")
                {
                    req = FirstRow(DbQuery(conn, "cro_api.request_get", "@RequestId", rid));
                    if (JS(req, "outputs_retrieved_utc") == "")
                    {
                        var o = JParse(FetchOutputs(cfg, conn, key, rid, ref dbg));
                        return "completed; outputs " + (JS(o, "complete").ToLowerInvariant() == "true" ? "stored" : "incomplete");
                    }
                }
                return state;
            }
            return "skipped (" + state + ")";
        }
        private static List<object> FirstSet(string dbJson)
        {
            var sets = JParse(dbJson) as List<object>;
            return (sets != null && sets.Count > 0 && sets[0] is List<object>) ? (List<object>)sets[0] : new List<object>();
        }
        private static string RandomHex(int bytes)
        {
            var b = new byte[bytes];
            using (var rng = System.Security.Cryptography.RandomNumberGenerator.Create()) rng.GetBytes(b);
            var sb = new StringBuilder(); foreach (var x in b) sb.Append(x.ToString("x2")); return sb.ToString();
        }
        private static string InSafe(ScriptParameters sp, string k) { try { return In(sp, k); } catch (Exception) { return ""; } }

        // ---- secure server variable probe (never returns the value) ----
        // Looks through the server-side SDK for any method that reads a server variable and tries it with the
        // system session. Reports only whether a value came back and its length.
        private static string KeyCheck(string session, string varId)
        {
            var info = new Dictionary<string, object>();
            info["variable"] = varId;
            var tried = new List<object>();
            try
            {
                var asm = typeof(TotalAgility.Sdk.ServerService).Assembly;
                foreach (var t in asm.GetTypes())
                {
                    if (!t.IsClass || !t.IsPublic || t.Namespace != "TotalAgility.Sdk") continue;
                    foreach (var mi in t.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly))
                    {
                        if (mi.Name.IndexOf("ServerVariable", StringComparison.OrdinalIgnoreCase) < 0 || !mi.Name.StartsWith("Get")) continue;
                        var ps = mi.GetParameters();
                        string sig = t.Name + "." + mi.Name + "(" + string.Join(",", Array.ConvertAll(ps, x => x.ParameterType.Name)) + ")";
                        if (ps.Length != 2 || ps[0].ParameterType != typeof(string)) { tried.Add(sig); continue; }
                        object idArg;
                        if (ps[1].ParameterType == typeof(string)) idArg = varId;
                        else
                        {
                            try { idArg = Activator.CreateInstance(ps[1].ParameterType); } catch (Exception) { tried.Add(sig + " (no ctor)"); continue; }
                            var pid = idArg.GetType().GetProperty("Id"); if (pid != null) pid.SetValue(idArg, varId, null);
                        }
                        try
                        {
                            var svc = Activator.CreateInstance(t);
                            var v = mi.Invoke(svc, new object[] { session, idArg });
                            object val = v is string ? v : GetP(v, "Value");
                            string s = val == null ? "" : Convert.ToString(val, CultureInfo.InvariantCulture);
                            tried.Add(sig + " -> length " + s.Length + (s.Length > 0 && s.Trim('*', ' ').Length == 0 ? " (masked)" : ""));
                            if (s.Length > 0 && s.Trim('*', ' ').Length > 0 && !info.ContainsKey("readableBy")) info["readableBy"] = sig;
                        }
                        catch (Exception e) { tried.Add(sig + " -> " + Inner(e)); }
                    }
                }
            }
            catch (Exception e) { info["error"] = Inner(e); }
            info["readable"] = info.ContainsKey("readableBy");
            info["tried"] = tried;
            return JSer(info);
        }

        // ---- Circularo users ----
        private static object CxOrg(object cfg, string key, ref string dbg)
        {
            // organization id and role group ids, from the API key's own account
            string url = JS(JO(cfg, "circularo"), "apiBase").TrimEnd('/') + "/login?returnToken=false&token=" + Uri.EscapeDataString(key);
            var lr = JParse(Http("GET", url, null, null, 30)[1].Replace(key, "***"));
            var u = JO(lr, "user");
            string org = JS(u, "organization"); if (org == "") org = JS(JO(u, "organization"), "id");
            if (org == "") { string uname = JS(u, "name"); var me = Cx(cfg, key, "GET", "/users/" + Uri.EscapeDataString(uname), null, ref dbg); org = JS(me, "organization"); if (org == "") org = JS(JO(me, "organization"), "id"); }
            if (org == "") throw new Exception("Could not read the Circularo organization id.");
            var g = Cx(cfg, key, "GET", "/groups/" + Uri.EscapeDataString(org), null, ref dbg);
            var res = new Dictionary<string, object>(); res["organization"] = org; res["groups"] = JO(g, "organizationGroups");
            return res;
        }
        private static List<object> CxUsers(object cfg, string key, ref string dbg)
        {
            var body = new Dictionary<string, object>(); body["size"] = 500.0; body["from"] = 0.0;
            var r = Cx(cfg, key, "POST", "/users/search", body, ref dbg);
            var l = r as List<object> ?? JL(r, "results") ?? JL(r, "items") ?? JL(r, "users") ?? JL(JO(r, "hits"), "hits");
            var outl = new List<object>();
            if (l == null) { string t = JSer(r); dbg += "users/search: " + (t.Length > 600 ? t.Substring(0, 600) : t) + " "; return outl; }
            foreach (var o in l)
            {
                var x = JO(o, "_source") ?? o;
                var u = new Dictionary<string, object>();
                u["name"] = JS(x, "name"); u["fullname"] = JS(x, "fullname"); u["mail"] = JS(x, "mail"); u["status"] = JS(x, "status");
                u["id"] = JS(x, "id") != "" ? JS(x, "id") : JS(o, "_id") != "" ? JS(o, "_id") : JS(x, "name");
                var gl = JL(x, "group");
                if ((JS(x, "status") == "" || gl == null) && JS(x, "name") != "" && outl.Count < 200)
                {
                    // search results are abridged: read status and groups from the user record (only these fields are kept)
                    try { var d = Cx(cfg, key, "GET", "/users/" + Uri.EscapeDataString(JS(x, "name")), null, ref dbg); u["status"] = JS(d, "status"); gl = JL(d, "group"); u["recordType"] = JS(d, "recordType"); }
                    catch (Exception ex) { dbg += "user " + JS(x, "name") + ": " + Inner(ex) + " "; }
                }
                u["groups"] = gl ?? new List<object>();
                outl.Add(u);
            }
            return outl;
        }
        private static Dictionary<string, object> UserRow(string conn, long userId)
        {
            foreach (var u in FirstSet(DbQuery(conn, "cro_api.user_list"))) if (Convert.ToInt64(JN(u, "user_id")) == userId) return u as Dictionary<string, object>;
            return null;
        }

        // ---- TotalAgility Capture documents (reflection on TotalAgility.Sdk.CaptureDocumentService) ----
        private static object Cap(string method, params object[] args)
        {
            var t = typeof(TotalAgility.Sdk.UserService).Assembly.GetType("TotalAgility.Sdk.CaptureDocumentService", true);
            var svc = Activator.CreateInstance(t);
            foreach (var mi in t.GetMethods())
                if (mi.Name == method && mi.GetParameters().Length == args.Length)
                {
                    var ps = mi.GetParameters();
                    for (int i = 0; i < args.Length; i++)
                        if (args[i] == null && ps[i].ParameterType.IsClass && ps[i].ParameterType != typeof(string) && !ps[i].ParameterType.IsArray)
                            try { args[i] = Activator.CreateInstance(ps[i].ParameterType); } catch (Exception) { }
                    try { return mi.Invoke(svc, args); }
                    catch (TargetInvocationException e) { throw new Exception(method + ": " + Inner(e)); }
                }
            throw new Exception("CaptureDocumentService." + method + " with " + args.Length + " parameters not found.");
        }
        private static object Reporting()
        {
            var t = typeof(TotalAgility.Sdk.UserService).Assembly.GetType("TotalAgility.Sdk.CaptureDocumentService", true)
                    .GetMethod("GetDocument").GetParameters()[1].ParameterType;
            var r = Activator.CreateInstance(t);
            var p = t.GetProperty("Station"); if (p != null) p.SetValue(r, "CRO", null);
            return r;
        }
        // Source file of a TotalAgility document as PDF or DOCX: [fileName, bytes, parentFolderId]
        private static object[] TtaDocument(string session, string docId)
        {
            var doc = Cap("GetDocument", session, Reporting(), docId);
            string name = Convert.ToString(GetP(doc, "FileName") ?? GetP(doc, "Name") ?? "document");
            string parent = Convert.ToString(GetP(doc, "ParentId") ?? "");
            byte[] bytes = null; string mime = "";
            try
            {
                var sf = Cap("GetSourceFile", session, Reporting(), docId);
                mime = Convert.ToString(GetP(sf, "MimeType") ?? "").ToLowerInvariant();
                bytes = GetP(sf, "SourceFile") as byte[];
            }
            catch (Exception) { }
            bool pdf = mime.Contains("pdf") || IsPdf(bytes);
            bool docx = mime.Contains("wordprocessingml") || name.ToLowerInvariant().EndsWith(".docx");
            if (bytes == null || bytes.Length == 0 || (!pdf && !docx))
            {
                // images, TIFF, etc.: let TotalAgility render a PDF
                var st = Cap("GetDocumentFile", session, Reporting(), docId, "pdf") as Stream;
                if (st == null) throw new Exception("TotalAgility returned no PDF for document " + docId + ".");
                using (var ms = new MemoryStream()) { st.CopyTo(ms); bytes = ms.ToArray(); }
                pdf = true;
            }
            string baseName = Path.GetFileNameWithoutExtension(name); if (baseName == "") baseName = "document";
            return new object[] { baseName + (pdf ? ".pdf" : ".docx"), bytes, parent };
        }
        private static string TtaAddDocument(string session, string folderId, byte[] data, string mime)
        {
            var t = typeof(TotalAgility.Sdk.UserService).Assembly.GetType("TotalAgility.Sdk.CaptureDocumentService", true);
            var ps = t.GetMethod("CreateDocument3").GetParameters();
            var input = Activator.CreateInstance(ps[5].ParameterType);
            ps[5].ParameterType.GetProperty("Data").SetValue(input, data, null);
            ps[5].ParameterType.GetProperty("MimeType").SetValue(input, mime, null);
            Exception last = null;
            foreach (int idx in new[] { -1, 0 })
            {
                try
                {
                    var id = Cap("CreateDocument3", session, Reporting(), folderId, null, "", input, idx);
                    string s = Convert.ToString(GetP(id, "DocumentId") ?? GetP(id, "Id") ?? id);
                    if (s != "") return s;
                }
                catch (Exception e) { last = e; }
            }
            throw new Exception("Could not add the document to folder " + folderId + ": " + (last == null ? "no id returned" : last.Message));
        }
        private static object[] OutputBytes(string conn, long rid, string kind, string actor)
        {
            var t = DbClient(); var c = Activator.CreateInstance(t, conn);
            try
            {
                Call(c, "Open");
                var cmd = Call(c, "CreateCommand");
                var ct = Prop(cmd, "CommandType"); ct.SetValue(cmd, Enum.Parse(ct.PropertyType, "StoredProcedure"), null);
                Prop(cmd, "CommandText").SetValue(cmd, "cro_api.output_get", null);
                var ps = Prop(cmd, "Parameters").GetValue(cmd, null);
                Call(ps, "AddWithValue", "@RequestId", rid); Call(ps, "AddWithValue", "@Kind", kind); Call(ps, "AddWithValue", "@Actor", actor);
                var r = Call(cmd, "ExecuteReader");
                if (!(bool)Call(r, "Read")) return null;
                var o = new object[] { Convert.ToString(Call(r, "GetValue", 0)), (byte[])Call(r, "GetValue", 4) };
                Call(r, "Close");
                return o;
            }
            catch (TargetInvocationException e) { throw new Exception(Inner(e)); }
            finally { try { ((IDisposable)c).Dispose(); } catch (Exception) { } }
        }

        // ---- CRO Signing process (run mode "signing"): first pass sends, later passes check and finish ----
        private static void Signing(ScriptParameters sp, object cfg, string conn, ref string dbg)
        {
            string session = In(sp, "SPP_SYSTEM_SESSION_ID"), jobId = InSafe(sp, "AWF_JOBID");
            string ridS = InSafe(sp, "CRO_REQUEST_ID"), state = "", done = "false", signedDoc = InSafe(sp, "CRO_SIGNED_DOCUMENT_ID"), err = "", result = "";
            long rid = 0; long.TryParse(ridS, out rid);
            string actor = "CRO Signing job " + jobId;
            try
            {
                string key = ApiKey(conn, session, ref dbg);
                if (rid == 0)
                {
                    string docId = InSafe(sp, "CRO_DOCUMENT_ID").Trim();
                    if (docId == "") throw new Exception("CRO_DOCUMENT_ID is empty.");
                    var req = JParse(InSafe(sp, "CRO_REQUEST") == "" ? "{}" : InSafe(sp, "CRO_REQUEST")) as Dictionary<string, object>;
                    if (req == null) throw new Exception("CRO_REQUEST is not a JSON object.");
                    var src = TtaDocument(session, docId);
                    if (JS(req, "title") == "") req["title"] = SafeName(Path.GetFileNameWithoutExtension((string)src[0])).Replace("/", " ");
                    req["ttaJobId"] = jobId;
                    if (JS(req, "businessRef") == "") req["businessRef"] = "TTA document " + docId;
                    string senderId = JS(req, "senderResourceId").ToUpperInvariant(), senderName = JS(req, "senderName");
                    if (senderName == "") senderName = "CRO Signing";
                    var created = FirstRow(DbQuery(conn, "cro_api.request_create", "@ActorId", Nz(senderId.Length == 32 ? senderId : ""), "@ActorName", senderName, "@Json", JSer(req)));
                    rid = Convert.ToInt64(JN(created, "request_id"));
                    result = SendRequest(cfg, conn, key, actor, rid, (string)src[0], (byte[])src[1], JL(req, "fields"), JO(req, "options"), ref dbg);
                    state = "inprogress";
                }
                else
                {
                    string outcome = SyncOne(cfg, conn, key, rid, "poll", ref dbg);
                    var row = FirstRow(DbQuery(conn, "cro_api.request_get", "@RequestId", rid));
                    state = JS(row, "state");
                    result = outcome;
                    if (state == "completed" && JS(row, "outputs_retrieved_utc") != "")
                    {
                        if (signedDoc == "")
                        {
                            string folder = InSafe(sp, "CRO_FOLDER_ID").Trim();
                            if (folder == "") folder = (string)TtaDocument(session, InSafe(sp, "CRO_DOCUMENT_ID").Trim())[2];
                            if (folder == "") throw new Exception("No folder to add the signed document to (set CRO_FOLDER_ID).");
                            var sc = JO(cfg, "signing");
                            var kinds = new List<string> { "signed" };
                            if (JS(sc, "attachAudit").ToLowerInvariant() != "false") kinds.Add("audit");
                            if (JS(sc, "attachCertificate").ToLowerInvariant() != "false") kinds.Add("certificate");
                            var added = new List<object>();
                            foreach (var k in kinds)
                            {
                                var ob = OutputBytes(conn, rid, k, actor);
                                if (ob == null) continue;
                                string id = TtaAddDocument(session, folder, (byte[])ob[1], "application/pdf");
                                if (k == "signed") signedDoc = id;
                                added.Add(k + "=" + id);
                            }
                            DbQuery(conn, "cro_api.audit_write", "@Actor", actor, "@Action", "tta_documents_added", "@Outcome", "ok", "@RequestId", rid, "@Detail", string.Join("; ", added.ToArray()));
                            result += "; documents " + string.Join(", ", added.ToArray());
                        }
                        done = "true";
                    }
                    else if (state == "rejected" || state == "expired" || state == "cancelled" || state == "failed") done = "true";
                }
            }
            catch (Exception e)
            {
                err = Inner(e);
                if (rid == 0) { state = "failed"; done = "true"; }   // nothing sent: end the job with the error
                dbg += "signing: " + err + " ";
            }
            sp.OutputVariables["CRO_REQUEST_ID"] = rid == 0 ? "" : rid.ToString(CultureInfo.InvariantCulture);
            sp.OutputVariables["CRO_STATE"] = state;
            sp.OutputVariables["CRO_DONE"] = done;
            sp.OutputVariables["CRO_SIGNED_DOCUMENT_ID"] = signedDoc;
            sp.OutputVariables["RESULT"] = result;
            sp.OutputVariables["ERROR"] = err;
            sp.OutputVariables["DEBUG"] = dbg.Length > 3900 ? dbg.Substring(0, 3900) : dbg;
        }

        // ---- ad hoc "Circularo editor": upload + create the document, share it to the sender for editing ----
        private static string Prepare(object cfg, string conn, string key, string actor, string senderUsername, long requestId, string fileName, byte[] file, string returnUrl, ref string dbg)
        {
            var req = FirstRow(DbQuery(conn, "cro_api.request_get", "@RequestId", requestId));
            if (req == null) throw new Exception("Request not found.");
            if (JS(req, "state") != "draft") throw new Exception("Request is " + JS(req, "state") + ", not draft.");
            var cx = JO(cfg, "circularo");
            string docType = JS(req, "document_type") == "" ? JS(cx, "documentType") : JS(req, "document_type");
            if (file == null || file.Length == 0) throw new Exception("No file.");
            var fields = new Dictionary<string, string>(); fields["fileName"] = fileName;
            string boundary = "----cro" + Guid.NewGuid().ToString("N");
            string ext = Path.GetExtension(fileName).ToLowerInvariant();
            string ctype = ext == ".pdf" ? "application/pdf" : ext == ".docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "application/octet-stream";
            var up = HttpBytes("POST", JS(cx, "apiBase").TrimEnd('/') + "/files/saveFile?token=" + Uri.EscapeDataString(key), Multipart(boundary, fields, "file", fileName, ctype, file), "multipart/form-data; boundary=" + boundary, 180);
            string upText = Encoding.UTF8.GetString((byte[])up[1]).Replace(key, "***");
            if ((int)up[0] != 200) throw new Exception("Circularo upload -> " + up[0] + ": " + (upText.Length > 300 ? upText.Substring(0, 300) : upText));
            var fo = JO(JParse(upText), "file"); string hash = JS(fo, "hash"); if (hash == "") hash = JS(fo, "id");
            if (hash == "") throw new Exception("Upload returned no file hash.");
            var body = new Dictionary<string, object>(); body["documentType"] = docType; body["documentTitle"] = JS(req, "title");
            var pdf = new Dictionary<string, object>(); pdf["content"] = hash; body["pdfFile"] = pdf;
            var dr = new Dictionary<string, object>(); dr["body"] = body;
            dr["definitionType"] = JS(cx, "definitionType") == "" ? "ext" : JS(cx, "definitionType");
            dr["workflow"] = JS(cx, "workflow") == "" ? "wf_archive" : JS(cx, "workflow");
            if (JS(cx, "folderPath") != "") { var od = new Dictionary<string, object>(); od["path"] = JS(cx, "folderPath"); dr["optionalData"] = od; }
            var res = Cx(cfg, key, "POST", "/documents", dr, ref dbg);
            string docId = JS(res, "id"); if (docId == "") { var rr = JL(res, "results"); if (rr != null && rr.Count > 0) docId = JS(rr[0], "documentId"); }
            if (docId == "") throw new Exception("Circularo did not return a document id.");
            DbQuery(conn, "cro_api.request_set_document", "@RequestId", requestId, "@DocumentId", docId, "@FileHash", hash, "@PlacementUsed", "circularo_editor", "@Detail", "Prepared for the Circularo editor; shared for editing to " + senderUsername);
            var d = new Dictionary<string, object>(); d["sharePurpose"] = "edit"; d["shareTo"] = senderUsername;
            var sh = new Dictionary<string, object>(); sh["objectType"] = "document"; sh["type"] = docType; sh["id"] = docId; sh["data"] = new List<object> { d };
            Cx(cfg, key, "POST", "/share", sh, ref dbg);
            string fe = JS(cx, "frontendBase").TrimEnd('/');
            string url = fe + "/signPrepare?mode=create&documentId=" + Uri.EscapeDataString(docId) + "&documentType=" + Uri.EscapeDataString(docType)
                       + (returnUrl.StartsWith("https://") ? "&callbackUrl=" + Uri.EscapeDataString(returnUrl) : "");
            var o = new Dictionary<string, object>(); o["requestId"] = (double)requestId; o["documentId"] = docId; o["url"] = url;
            o["note"] = "Sign in to Circularo as " + senderUsername + " if asked, add recipients and fields, then send.";
            return JSer(o);
        }
        // Read the shares the sender created in Circularo and import them as the request's recipients.
        private static int ImportShares(object cfg, string conn, string key, long requestId, ref string dbg)
        {
            var req = FirstRow(DbQuery(conn, "cro_api.request_get", "@RequestId", requestId));
            if (req == null || JS(req, "state") != "sending") return 0;
            var dj = Cx(cfg, key, "GET", "/documents/" + Uri.EscapeDataString(JS(req, "circularo_document_id")), null, ref dbg);
            var rl = JL(dj, "results"); var doc = rl != null && rl.Count > 0 ? rl[0] : dj;
            var hist = JL(JO(doc, "workflow"), "history") ?? new List<object>();
            var seen = new HashSet<string>(); var shares = new List<Dictionary<string, object>>(); bool seq = false;
            for (int i = hist.Count - 1; i >= 0; i--)   // history is newest first: walk oldest first
            {
                var h = hist[i];
                if (JS(h, "name") != "shared_with") continue;
                if (JS(h, "shareSequential").ToLowerInvariant() == "true") seq = true;
                foreach (var so in (JL(h, "share") ?? new List<object>()))
                {
                    string sid = JS(so, "shareId"); if (sid == "" || !seen.Add(sid)) continue;
                    shares.Add(so as Dictionary<string, object>);
                }
            }
            if (shares.Count == 0) return 0;
            var users = FirstSet(DbQuery(conn, "cro_api.user_list"));
            var list = new List<object>(); int n = 0;
            foreach (var so in shares)
            {
                n++;
                var to = JO(so, "shareTo"); string name = JS(to, "name"), type = JS(to, "type");
                string email = name, full = "";
                foreach (var u in users) if (string.Equals(JS(u, "circularo_username"), name, StringComparison.OrdinalIgnoreCase)) { email = JS(u, "email"); full = JS(u, "full_name"); }
                if (type == "internal" && email == name)
                {
                    try { var ud = Cx(cfg, key, "GET", "/users/" + Uri.EscapeDataString(name), null, ref dbg); if (JS(ud, "mail") != "") email = JS(ud, "mail"); if (full == "") full = JS(ud, "fullname"); }
                    catch (Exception ex) { dbg += "user " + name + ": " + Inner(ex) + " "; }
                }
                var e = new Dictionary<string, object>();
                e["order"] = (double)(seq ? n : 1); e["kind"] = type == "internal" ? "internal" : "external"; e["email"] = email; e["fullName"] = full;
                e["purpose"] = JS(so, "sharePurpose") != "" ? JS(so, "sharePurpose") : "sign"; e["shareId"] = JS(so, "shareId"); e["shareTo"] = name;
                list.Add(e);
            }
            DbQuery(conn, "cro_api.request_import_recipients", "@RequestId", requestId, "@Json", JSer(list), "@Actor", "system");
            return list.Count;
        }

        // ---- signing link for the caller (must be a recipient of the request) ----
        private static string SignUrl(object cfg, string conn, string key, string email, string resourceId, long requestId, ref string dbg)
        {
            var got = JParse(DbQuery(conn, "cro_api.request_get", "@RequestId", requestId)) as List<object>;
            var req = FirstRow(JSer(got));
            if (req == null) throw new Exception("Request not found.");
            if (JS(req, "state") != "inprogress") throw new Exception("The request is " + JS(req, "state") + "; there is nothing to sign.");
            string docId = JS(req, "circularo_document_id");
            var rcps = got.Count > 1 ? got[1] as List<object> : new List<object>();
            Dictionary<string, object> me = null;
            foreach (var ro in rcps)
            {
                var r = ro as Dictionary<string, object>;
                if (email != "" && string.Equals(JS(r, "email"), email, StringComparison.OrdinalIgnoreCase) && JS(r, "status") != "signed") { me = r; break; }
            }
            if (me == null) throw new Exception("You are not a waiting recipient of this request.");
            string fe = JS(JO(cfg, "circularo"), "frontendBase").TrimEnd('/');
            string docType = JS(req, "document_type") == "" ? JS(JO(cfg, "circularo"), "documentType") : JS(req, "document_type");
            var res = new Dictionary<string, object>();
            res["requestId"] = (double)requestId; res["documentId"] = docId; res["status"] = JS(me, "status");
            bool isExt = JS(me, "kind") == "external" || JS(me, "internal_mode") == "as_external";
            if (!isExt)
            {
                res["mode"] = "circularo_login";
                res["url"] = fe + "/#!/sign?documentId=" + Uri.EscapeDataString(docId) + "&documentType=" + Uri.EscapeDataString(docType);
                res["note"] = "Sign in to Circularo as " + JS(me, "share_to") + " if asked.";
            }
            else
            {
                string sid = JS(me, "share_id");
                if (sid == "") throw new Exception("This recipient has no Circularo share id yet.");
                object v;
                try { v = Cx(cfg, key, "GET", "/share/" + Uri.EscapeDataString(sid) + "/validate", null, ref dbg); }
                catch (Exception ex)
                {
                    // Circularo turns an email that belongs to an internal account into that account, so the share is not external after all
                    if (Inner(ex).IndexOf("ACCESS_DENIED", StringComparison.OrdinalIgnoreCase) < 0) throw;
                    res["mode"] = "circularo_login";
                    res["url"] = fe + "/#!/sign?documentId=" + Uri.EscapeDataString(docId) + "&documentType=" + Uri.EscapeDataString(docType);
                    res["note"] = "This email belongs to a Circularo account, so Circularo treats it as internal: sign in to Circularo if asked.";
                    DbQuery(conn, "cro_api.audit_write", "@Actor", email + " (" + resourceId + ")", "@Action", "sign_url", "@Outcome", "ok", "@RequestId", requestId, "@Detail", "external share resolved to internal account");
                    return JSer(res);
                }
                string tok = JS(v, "shareToken"); if (tok == "") tok = JS(v, "token"); if (tok == "") tok = JS(JO(v, "share"), "shareToken");
                if (tok == "") { string t = JSer(v); dbg += "validate: " + (t.Length > 400 ? t.Substring(0, 400) : t) + " "; throw new Exception("Circularo did not return a share token."); }
                res["mode"] = "external_link";
                res["url"] = fe + "/share?shareToken=" + Uri.EscapeDataString(tok);
                res["note"] = "Circularo will email a code to " + JS(me, "email") + ".";
            }
            DbQuery(conn, "cro_api.audit_write", "@Actor", email + " (" + resourceId + ")", "@Action", "sign_url", "@Outcome", "ok", "@RequestId", requestId, "@Detail", JS(res, "mode"));
            return JSer(res);
        }
        private static bool IsCreatorOrAdmin(object cfg, Dictionary<string, object> req, string resourceId)
        {
            return string.Equals(JS(req, "created_by_resource_id"), resourceId, StringComparison.OrdinalIgnoreCase) || IsAdmin(cfg, resourceId);
        }

        [StartMethodAttribute()]
        public void Run(ScriptParameters sp)
        {
            string dbg = "", result = "null", error = "";
            try
            {
                string op = In(sp, "OP").Trim().ToLowerInvariant();
                object cfg = JParse(In(sp, "CRO_CONFIG"));
                if (!(cfg is Dictionary<string, object>)) throw new Exception("CRO_CONFIG is missing or not valid JSON.");
                string conn = DbConn(cfg);
                object a = JParse(In(sp, "ARGS") == "" ? "{}" : In(sp, "ARGS"));

                // CRO Sync runs this same script with the process variable CRO_RUNMODE = "sync" (not an input, so callers cannot set it).
                if (InSafe(sp, "CRO_RUNMODE") == "signing") { Signing(sp, cfg, conn, ref dbg); return; }
                if (InSafe(sp, "CRO_RUNMODE") == "sync")
                {
                    result = Sync(cfg, conn, ApiKey(conn, In(sp, "SPP_SYSTEM_SESSION_ID"), ref dbg), ref dbg);
                    sp.OutputVariables["RESULT"] = result; sp.OutputVariables["ERROR"] = error; sp.OutputVariables["DEBUG"] = dbg;
                    return;
                }
                var who = Caller(In(sp, "SESSIONTOKEN").Trim().ToUpperInvariant(), ref dbg);
                if (who == null) throw new Exception("Could not identify the signed-in user.");

                switch (op)
                {
                    case "version":
                        result = JQ(VERSION);
                        break;
                    case "whoami":
                        result = "{\"id\":" + JQ(who[0]) + ",\"name\":" + JQ(who[1]) + "}";
                        break;
                    case "health":
                    {
                        string db;
                        try { db = DbQuery(conn, "cro_api.health"); }
                        catch (Exception e) { db = JQ("ERROR: " + Inner(e)); }
                        result = "{\"version\":" + JQ(VERSION) + ",\"caller\":" + JQ(who[1]) + ",\"db\":" + db
                               + ",\"configVersion\":" + JQ(JS(cfg, "version")) + "}";
                        break;
                    }
                    case "config":
                    {
                        var c = cfg as Dictionary<string, object>;
                        var safe = new Dictionary<string, object>();
                        foreach (var k in new[] { "version", "circularo", "defaults", "options", "anchors", "adhoc", "groups", "layouts" })
                            if (c.ContainsKey(k)) safe[k] = c[k];
                        result = JSer(safe);
                        break;
                    }
                    case "circularo_ping":
                    {
                        string url = JS(JO(cfg, "circularo"), "apiBase").TrimEnd('/') + "/ping";
                        var r = Http("GET", url, null, null, 20);
                        result = "{\"status\":" + r[0] + ",\"body\":" + JQ(r[1].Length > 200 ? r[1].Substring(0, 200) : r[1]) + "}";
                        break;
                    }
                    case "circularo_check":
                    {
                        // Confirms the API key works: token check as documented (GET /login?token=...). Never echoes the key.
                        string key = ApiKey(conn, In(sp, "SPP_SYSTEM_SESSION_ID"), ref dbg);
                        string url = JS(JO(cfg, "circularo"), "apiBase").TrimEnd('/') + "/login?returnToken=false&token=" + Uri.EscapeDataString(key);
                        var r = Http("GET", url, null, null, 30);
                        object j = JParse(r[1]);
                        var info = new Dictionary<string, object>();
                        info["status"] = r[0];
                        info["logged"] = JS(j, "logged");
                        info["unlocked"] = JS(j, "isUnlocked");
                        info["user"] = JS(JO(j, "user"), "name");
                        info["tenant"] = JS(j, "tenant");
                        if (r[0] != "200") info["body"] = r[1].Length > 300 ? r[1].Substring(0, 300) : r[1];
                        result = JSer(info).Replace(key, "***");
                        break;
                    }
                    case "key_migrate":
                    {
                        // Moves the key from the secure variable into the encrypted store. Admins only.
                        if (!IsAdmin(cfg, who[0])) { DbQuery(conn, "cro_api.audit_write", "@Actor", who[1] + " (" + who[0] + ")", "@Action", "key_migrate", "@Outcome", "refused", "@Detail", "Not a CRO administrator"); throw new Exception("Only CRO administrators can do this."); }
                        string plain = SecureVar(In(sp, "SPP_SYSTEM_SESSION_ID"), "CRO_API_KEY");
                        if (plain.Length < 16) throw new Exception("CRO_API_KEY is empty: enter the key there first.");
                        string b64 = Convert.ToBase64String(Dpapi(true, Encoding.UTF8.GetBytes(plain)));
                        if (Encoding.UTF8.GetString(Dpapi(false, Convert.FromBase64String(b64))) != plain) throw new Exception("Encryption round-trip check failed.");
                        string fp = Fingerprint(plain);
                        DbQuery(conn, "cro_api.secret_set", "@Name", "circularo_api_key", "@ProtectedB64", b64, "@Fingerprint", fp,
                                "@ValueLength", plain.Length, "@MachineName", Environment.MachineName, "@Actor", who[1] + " (" + who[0] + ")");
                        result = "{\"stored\":true,\"fingerprint\":" + JQ(fp) + ",\"length\":" + plain.Length + ",\"machine\":" + JQ(Environment.MachineName) + "}";
                        break;
                    }
                    case "key_status":
                    {
                        if (!IsAdmin(cfg, who[0])) throw new Exception("Only CRO administrators can do this.");
                        string sv = SecureVar(In(sp, "SPP_SYSTEM_SESSION_ID"), "CRO_API_KEY");
                        result = "{\"store\":" + DbQuery(conn, "cro_api.secret_status") + ",\"secureVariableHasValue\":" + (sv.Length > 0 ? "true" : "false")
                               + ",\"machine\":" + JQ(Environment.MachineName) + "}";
                        break;
                    }
                    case "keycheck":
                        if (!IsAdmin(cfg, who[0])) throw new Exception("Only CRO administrators can do this.");
                        result = KeyCheck(In(sp, "SPP_SYSTEM_SESSION_ID"), "CRO_API_KEY");
                        break;
                    case "request_create":
                    {
                        var d = a as Dictionary<string, object>;
                        if (d == null) throw new Exception("ARGS must be a JSON object.");
                        result = DbQuery(conn, "cro_api.request_create", "@ActorId", who[0], "@ActorName", who[1], "@Json", JSer(d));
                        break;
                    }
                    case "request_get":
                        result = DbQuery(conn, "cro_api.request_get", "@RequestId", Nz(Arg(a, "requestId", 20)),
                                         "@RequestRef", Nz(Arg(a, "requestRef", 40)));
                        break;
                    case "request_list":
                    {
                        int page, size;
                        if (!int.TryParse(Arg(a, "page", 6), out page)) page = 1;
                        if (!int.TryParse(Arg(a, "pageSize", 4), out size)) size = 50;
                        result = DbQuery(conn, "cro_api.request_list", "@State", Nz(Arg(a, "state", 20).ToLowerInvariant()),
                                         "@Search", Nz(Arg(a, "search", 100)), "@Page", page, "@PageSize", size);
                        break;
                    }
                    case "request_send":
                    {
                        // ARGS: { requestId, fileName, fileB64 }  (test path; CRO Signing will pass TTA documents)
                        long rid; if (!long.TryParse(Arg(a, "requestId", 20), out rid)) throw new Exception("requestId is required.");
                        var rq = FirstRow(DbQuery(conn, "cro_api.request_get", "@RequestId", rid));
                        if (rq == null) throw new Exception("Request not found.");
                        if (!string.Equals(JS(rq, "created_by_resource_id"), who[0], StringComparison.OrdinalIgnoreCase) && !IsAdmin(cfg, who[0]))
                        {
                            DbQuery(conn, "cro_api.audit_write", "@Actor", who[1] + " (" + who[0] + ")", "@Action", "request_send", "@Outcome", "refused", "@RequestId", rid, "@Detail", "Not the creator");
                            throw new Exception("Only the person who created the request can send it.");
                        }
                        string fn = Arg(a, "fileName", 200); if (fn == "") fn = "document.pdf";
                        byte[] bytes = Convert.FromBase64String(JS(a, "fileB64"));
                        result = SendRequest(cfg, conn, ApiKey(conn, In(sp, "SPP_SYSTEM_SESSION_ID"), ref dbg), who[1] + " (" + who[0] + ")", rid, fn, bytes, JL(a, "fields"), JO(a, "options"), ref dbg);
                        break;
                    }
                    case "request_refresh":
                    {
                        long rid; if (!long.TryParse(Arg(a, "requestId", 20), out rid)) throw new Exception("requestId is required.");
                        result = RefreshRequest(cfg, conn, ApiKey(conn, In(sp, "SPP_SYSTEM_SESSION_ID"), ref dbg), rid, "poll", ref dbg);
                        break;
                    }
                    case "request_outputs":
                    {
                        long rid; if (!long.TryParse(Arg(a, "requestId", 20), out rid)) throw new Exception("requestId is required.");
                        var rq = FirstRow(DbQuery(conn, "cro_api.request_get", "@RequestId", rid));
                        if (rq == null) throw new Exception("Request not found.");
                        if (!string.Equals(JS(rq, "created_by_resource_id"), who[0], StringComparison.OrdinalIgnoreCase) && !IsAdmin(cfg, who[0]))
                            throw new Exception("Only the person who created the request can do this.");
                        result = FetchOutputs(cfg, conn, ApiKey(conn, In(sp, "SPP_SYSTEM_SESSION_ID"), ref dbg), rid, ref dbg);
                        break;
                    }
                    case "output_list":
                    {
                        long rid; if (!long.TryParse(Arg(a, "requestId", 20), out rid)) throw new Exception("requestId is required.");
                        result = DbQuery(conn, "cro_api.output_list", "@RequestId", rid);
                        break;
                    }
                    case "output_get":
                    {
                        // ARGS: { requestId, kind } -> { fileName, contentType, sha256, b64 }
                        long rid; if (!long.TryParse(Arg(a, "requestId", 20), out rid)) throw new Exception("requestId is required.");
                        var rq = FirstRow(DbQuery(conn, "cro_api.request_get", "@RequestId", rid));
                        if (rq == null) throw new Exception("Request not found.");
                        if (!string.Equals(JS(rq, "created_by_resource_id"), who[0], StringComparison.OrdinalIgnoreCase) && !IsAdmin(cfg, who[0]))
                            throw new Exception("Only the person who created the request can do this.");
                        var t = DbClient(); var c = Activator.CreateInstance(t, conn);
                        try
                        {
                            Call(c, "Open");
                            var cmd = Call(c, "CreateCommand");
                            var ct = Prop(cmd, "CommandType"); ct.SetValue(cmd, Enum.Parse(ct.PropertyType, "StoredProcedure"), null);
                            Prop(cmd, "CommandText").SetValue(cmd, "cro_api.output_get", null);
                            var ps = Prop(cmd, "Parameters").GetValue(cmd, null);
                            Call(ps, "AddWithValue", "@RequestId", rid); Call(ps, "AddWithValue", "@Kind", Arg(a, "kind", 20)); Call(ps, "AddWithValue", "@Actor", who[1] + " (" + who[0] + ")");
                            var r = Call(cmd, "ExecuteReader");
                            if (!(bool)Call(r, "Read")) throw new Exception("No " + Arg(a, "kind", 20) + " file for this request.");
                            var o = new Dictionary<string, object>();
                            o["fileName"] = Call(r, "GetValue", 0); o["contentType"] = Call(r, "GetValue", 1); o["size"] = Convert.ToDouble(Call(r, "GetValue", 2));
                            o["sha256"] = Call(r, "GetValue", 3); o["b64"] = Convert.ToBase64String((byte[])Call(r, "GetValue", 4));
                            Call(r, "Close");
                            result = JSer(o);
                        }
                        catch (TargetInvocationException e) { throw new Exception(Inner(e)); }
                        finally { try { ((IDisposable)c).Dispose(); } catch (Exception) { } }
                        break;
                    }
                    case "sync_now":
                        if (!IsAdmin(cfg, who[0])) throw new Exception("Only CRO administrators can do this.");
                        result = Sync(cfg, conn, ApiKey(conn, In(sp, "SPP_SYSTEM_SESSION_ID"), ref dbg), ref dbg);
                        break;
                    case "webhook_list":
                    {
                        if (!IsAdmin(cfg, who[0])) throw new Exception("Only CRO administrators can do this.");
                        var wl = Cx(cfg, ApiKey(conn, In(sp, "SPP_SYSTEM_SESSION_ID"), ref dbg), "GET", "/webhooks", null, ref dbg);
                        var rl = JL(wl, "results");
                        if (rl != null) foreach (var w in rl) { var d = w as Dictionary<string, object>; if (d != null && d.ContainsKey("hmacSecret")) d["hmacSecret"] = d["hmacSecret"] == null ? null : (object)"***"; }
                        result = JSer(wl);
                        break;
                    }
                    case "webhook_setup":
                    {
                        // ARGS: { callbackUrl?, type? }  Generates a new HMAC secret (stored DPAPI-encrypted, never returned) and registers the webhook.
                        if (!IsAdmin(cfg, who[0])) throw new Exception("Only CRO administrators can do this.");
                        string key = ApiKey(conn, In(sp, "SPP_SYSTEM_SESSION_ID"), ref dbg);
                        string url = Arg(a, "callbackUrl", 400); if (url == "") url = JS(JO(cfg, "webhook"), "receiverUrl");
                        if (!url.StartsWith("https://")) throw new Exception("The callback URL must be https.");
                        string secret = RandomHex(32);
                        string b64 = Convert.ToBase64String(Dpapi(true, Encoding.UTF8.GetBytes(secret)));
                        DbQuery(conn, "cro_api.secret_set", "@Name", "webhook_hmac_secret", "@ProtectedB64", b64, "@Fingerprint", Fingerprint(secret),
                                "@ValueLength", secret.Length, "@MachineName", Environment.MachineName, "@Actor", who[1] + " (" + who[0] + ")");
                        var tried = new List<object>(); object created = null;
                        string want = Arg(a, "type", 20);
                        foreach (var type in (want != "" ? new[] { want } : new[] { "organization", "team", "tenant" }))
                        {
                            var body = new Dictionary<string, object>(); body["type"] = type; body["callbackUrl"] = url; body["hmacSecret"] = secret;
                            try { created = Cx(cfg, key, "POST", "/webhooks", body, ref dbg); tried.Add(type + ": ok"); break; }
                            catch (Exception ex) { tried.Add(type + ": " + Inner(ex).Replace(secret, "***")); }
                        }
                        var res = new Dictionary<string, object>();
                        res["registered"] = created != null; res["tried"] = tried; res["callbackUrl"] = url; res["secretFingerprint"] = Fingerprint(secret);
                        if (created != null) { res["id"] = JS(created, "id"); res["type"] = JS(created, "type"); res["name"] = JS(created, "name"); }
                        result = JSer(res);
                        DbQuery(conn, "cro_api.audit_write", "@Actor", who[1] + " (" + who[0] + ")", "@Action", "webhook_setup", "@Outcome", created != null ? "ok" : "error", "@Detail", url + " " + string.Join("; ", Array.ConvertAll(tried.ToArray(), x => Convert.ToString(x))));
                        break;
                    }
                    case "webhook_delete":
                    {
                        if (!IsAdmin(cfg, who[0])) throw new Exception("Only CRO administrators can do this.");
                        string id = Arg(a, "id", 64); if (id == "") throw new Exception("id is required.");
                        Cx(cfg, ApiKey(conn, In(sp, "SPP_SYSTEM_SESSION_ID"), ref dbg), "DELETE", "/webhooks/" + Uri.EscapeDataString(id), null, ref dbg);
                        DbQuery(conn, "cro_api.audit_write", "@Actor", who[1] + " (" + who[0] + ")", "@Action", "webhook_delete", "@Outcome", "ok", "@Detail", id);
                        result = "{\"deleted\":" + JQ(id) + "}";
                        break;
                    }
                    case "dashboard":
                    {
                        // ARGS: { scope: "mine"|"all", days: 30 }
                        string scope = Arg(a, "scope", 10).ToLowerInvariant() == "all" && IsAdmin(cfg, who[0]) ? "all" : "mine";
                        int days; if (!int.TryParse(Arg(a, "days", 4), out days)) days = 30;
                        string email = CallerEmail(conn, In(sp, "SPP_SYSTEM_SESSION_ID"), who[0], ref dbg);
                        object em = email == "" ? null : (object)email;
                        result = "{\"scope\":" + JQ(scope) + ",\"isAdmin\":" + (IsAdmin(cfg, who[0]) ? "true" : "false") + ",\"email\":" + JQ(email)
                               + ",\"overview\":" + DbQuery(conn, "cro_api.dashboard_overview", "@Scope", scope, "@ResourceId", who[0], "@Email", em, "@DeadlineDays", 3)
                               + ",\"reports\":" + DbQuery(conn, "cro_api.dashboard_reports", "@Scope", scope, "@ResourceId", who[0], "@Email", em, "@Days", days)
                               + ",\"activity\":" + DbQuery(conn, "cro_api.dashboard_activity", "@Scope", scope, "@ResourceId", who[0], "@Email", em, "@Max", 20) + "}";
                        break;
                    }
                    case "monitor":
                        if (!IsAdmin(cfg, who[0])) throw new Exception("Only CRO administrators can do this.");
                        result = DbQuery(conn, "cro_api.monitor_status");
                        break;
                    case "webhook_recent":
                    {
                        if (!IsAdmin(cfg, who[0])) throw new Exception("Only CRO administrators can do this.");
                        int max; if (!int.TryParse(Arg(a, "max", 4), out max)) max = 50;
                        result = DbQuery(conn, "cro_api.webhook_recent", "@Max", max);
                        break;
                    }
                    case "me":
                    {
                        string em = CallerEmail(conn, In(sp, "SPP_SYSTEM_SESSION_ID"), who[0], ref dbg);
                        result = "{\"id\":" + JQ(who[0]) + ",\"name\":" + JQ(who[1]) + ",\"email\":" + JQ(em) + ",\"isAdmin\":" + (IsAdmin(cfg, who[0]) ? "true" : "false") + "}";
                        break;
                    }
                    case "sign_url":
                    {
                        // ARGS: { requestId }  -> { url, mode, note }  The caller must be a waiting recipient.
                        long rid; if (!long.TryParse(Arg(a, "requestId", 20), out rid)) throw new Exception("requestId is required.");
                        string em = CallerEmail(conn, In(sp, "SPP_SYSTEM_SESSION_ID"), who[0], ref dbg);
                        result = SignUrl(cfg, conn, ApiKey(conn, In(sp, "SPP_SYSTEM_SESSION_ID"), ref dbg), em, who[0], rid, ref dbg);
                        break;
                    }
                    case "request_cancel":
                    {
                        // ARGS: { requestId, reason? }  Creator or admin. Disables every share (Circularo cancels the whole process).
                        long rid; if (!long.TryParse(Arg(a, "requestId", 20), out rid)) throw new Exception("requestId is required.");
                        var got = JParse(DbQuery(conn, "cro_api.request_get", "@RequestId", rid)) as List<object>;
                        var rq = FirstRow(JSer(got));
                        if (rq == null) throw new Exception("Request not found.");
                        if (!IsCreatorOrAdmin(cfg, rq, who[0])) throw new Exception("Only the person who created the request can cancel it.");
                        string reason = Arg(a, "reason", 500); if (reason == "") reason = "Cancelled from TotalAgility";
                        string st = JS(rq, "state");
                        if (st == "draft" || st == "failed")
                        {
                            DbQuery(conn, "cro_api.request_set_state", "@RequestId", rid, "@State", "cancelled", "@Reason", reason, "@Source", "user", "@Actor", who[1] + " (" + who[0] + ")");
                            result = "{\"requestId\":" + rid + ",\"state\":\"cancelled\",\"circularo\":false}";
                            break;
                        }
                        if (st != "inprogress") throw new Exception("The request is " + st + " and cannot be cancelled.");
                        var ids = new List<object>();
                        foreach (var ro in (got.Count > 1 ? got[1] as List<object> : new List<object>())) if (JS(ro, "share_id") != "") ids.Add(JS(ro, "share_id"));
                        if (ids.Count == 0) throw new Exception("No Circularo shares recorded for this request.");
                        var body = new Dictionary<string, object>(); body["shareIds"] = ids;
                        Cx(cfg, ApiKey(conn, In(sp, "SPP_SYSTEM_SESSION_ID"), ref dbg), "PUT", "/share/disable", body, ref dbg);
                        var cupd = new List<object>();
                        foreach (var ro in (got.Count > 1 ? got[1] as List<object> : new List<object>()))
                        {
                            var e = new Dictionary<string, object>(); e["recipientId"] = JN(ro, "recipient_id");
                            e["status"] = JS(ro, "status") == "signed" ? "signed" : "cancelled"; cupd.Add(e);
                        }
                        DbQuery(conn, "cro_api.request_set_state", "@RequestId", rid, "@State", "cancelled", "@Reason", reason, "@RecipientsJson", JSer(cupd), "@Source", "user", "@Actor", who[1] + " (" + who[0] + ")");
                        result = "{\"requestId\":" + rid + ",\"state\":\"cancelled\",\"circularo\":true,\"shares\":" + ids.Count + "}";
                        break;
                    }
                    case "request_search":
                    {
                        // ARGS: { scope, filter, state, search, page, pageSize }  (needs 008_requests.sql)
                        string scope = Arg(a, "scope", 10).ToLowerInvariant() == "all" && IsAdmin(cfg, who[0]) ? "all" : "mine";
                        int page, size;
                        if (!int.TryParse(Arg(a, "page", 6), out page)) page = 1;
                        if (!int.TryParse(Arg(a, "pageSize", 4), out size)) size = 25;
                        string em = CallerEmail(conn, In(sp, "SPP_SYSTEM_SESSION_ID"), who[0], ref dbg);
                        result = "{\"scope\":" + JQ(scope) + ",\"isAdmin\":" + (IsAdmin(cfg, who[0]) ? "true" : "false") + ",\"rows\":"
                               + DbQuery(conn, "cro_api.request_search", "@Scope", scope, "@ResourceId", who[0], "@Email", Nz(em),
                                         "@Filter", Nz(Arg(a, "filter", 20)), "@State", Nz(Arg(a, "state", 20)), "@Search", Nz(Arg(a, "search", 100)),
                                         "@Page", page, "@PageSize", size, "@DeadlineDays", 3) + "}";
                        break;
                    }
                    case "request_detail":
                    {
                        // ARGS: { requestId }  Creator, recipient or admin. -> request, recipients, outputs, timeline, access
                        long rid; if (!long.TryParse(Arg(a, "requestId", 20), out rid)) throw new Exception("requestId is required.");
                        string em = CallerEmail(conn, In(sp, "SPP_SYSTEM_SESSION_ID"), who[0], ref dbg);
                        var acc = FirstRow(DbQuery(conn, "cro_api.request_access", "@RequestId", rid, "@ResourceId", who[0], "@Email", Nz(em)));
                        if (acc == null) throw new Exception("Request not found.");
                        bool admin = IsAdmin(cfg, who[0]);
                        bool creator = JS(acc, "is_creator") == "1" || JS(acc, "is_creator").ToLowerInvariant() == "true";
                        bool recipient = JS(acc, "is_recipient") == "1" || JS(acc, "is_recipient").ToLowerInvariant() == "true";
                        if (!creator && !recipient && !admin)
                        {
                            DbQuery(conn, "cro_api.audit_write", "@Actor", who[1] + " (" + who[0] + ")", "@Action", "request_detail", "@Outcome", "refused", "@RequestId", rid, "@Detail", "Not creator, recipient or admin");
                            throw new Exception("You do not have access to this request.");
                        }
                        result = "{\"request\":" + DbQuery(conn, "cro_api.request_get", "@RequestId", rid)
                               + ",\"outputs\":" + (creator || admin ? DbQuery(conn, "cro_api.output_list", "@RequestId", rid) : "[[]]")
                               + ",\"timeline\":" + DbQuery(conn, "cro_api.request_timeline", "@RequestId", rid, "@Max", 100)
                               + ",\"access\":{\"creator\":" + (creator ? "true" : "false") + ",\"recipient\":" + (recipient ? "true" : "false")
                               + ",\"admin\":" + (admin ? "true" : "false") + ",\"myStatus\":" + JQ(JS(acc, "my_status")) + ",\"email\":" + JQ(em) + "}}";
                        break;
                    }
                    case "circularo_get":
                    {
                        // Admin diagnostics: read-only GET of /users, /groups, /documents, /share (key masked).
                        if (!IsAdmin(cfg, who[0])) throw new Exception("Only CRO administrators can do this.");
                        string path = Arg(a, "path", 300);
                        if (!(path.StartsWith("/users") || path.StartsWith("/groups") || path.StartsWith("/documents/") || path.StartsWith("/share/")) || path.Contains("..") || path.Contains("token="))
                            throw new Exception("Path not allowed.");
                        result = JSer(Cx(cfg, ApiKey(conn, In(sp, "SPP_SYSTEM_SESSION_ID"), ref dbg), "GET", path, null, ref dbg));
                        break;
                    }
                    case "users_overview":
                    {
                        // Admin: CRO user records + Circularo accounts, matched by Circularo id, username or email.
                        if (!IsAdmin(cfg, who[0])) throw new Exception("Only CRO administrators can do this.");
                        string key = ApiKey(conn, In(sp, "SPP_SYSTEM_SESSION_ID"), ref dbg);
                        var cu = CxUsers(cfg, key, ref dbg);
                        object org = null; try { org = CxOrg(cfg, key, ref dbg); } catch (Exception ex) { dbg += "org: " + Inner(ex) + " "; }
                        result = "{\"records\":" + DbQuery(conn, "cro_api.user_list") + ",\"circularo\":" + JSer(cu) + ",\"org\":" + (org == null ? "null" : JSer(org))
                               + ",\"roles\":" + JSer(new List<object> { "sign", "user", "prepare", "read", "admin" }) + "}";
                        break;
                    }
                    case "user_save":
                    {
                        // Admin. ARGS: { email, fullName, role, ttaResourceId?, action: "record"|"invite"|"link" }
                        //  record – CRO record only; invite – create the Circularo account as an invitation (Circularo emails the user to set a password);
                        //  link – attach an existing Circularo account with this email.
                        if (!IsAdmin(cfg, who[0])) throw new Exception("Only CRO administrators can do this.");
                        string actor = who[1] + " (" + who[0] + ")";
                        string email = Arg(a, "email", 254).ToLowerInvariant(), full = Arg(a, "fullName", 200), role = Arg(a, "role", 20).ToLowerInvariant();
                        if (full == "") full = email;
                        var row = FirstRow(DbQuery(conn, "cro_api.user_upsert", "@ActorId", who[0], "@ActorName", who[1], "@TtaResourceId", Nz(Arg(a, "ttaResourceId", 32).ToUpperInvariant()),
                                                   "@Email", email, "@FullName", full, "@Role", role == "" ? "sign" : role));
                        long uid = Convert.ToInt64(JN(row, "user_id"));
                        string action = Arg(a, "action", 10).ToLowerInvariant();
                        var res = new Dictionary<string, object>(); res["userId"] = (double)uid; res["action"] = action;
                        if (action == "invite" || action == "link")
                        {
                            string key = ApiKey(conn, In(sp, "SPP_SYSTEM_SESSION_ID"), ref dbg);
                            Dictionary<string, object> found = null;
                            foreach (var c in CxUsers(cfg, key, ref dbg))
                                if (string.Equals(JS(c, "mail"), email, StringComparison.OrdinalIgnoreCase) || string.Equals(JS(c, "name"), email, StringComparison.OrdinalIgnoreCase)) { found = c as Dictionary<string, object>; break; }
                            if (found != null)
                            {
                                string st = JS(found, "status") == "suspended" ? "suspended" : JS(found, "status") == "newly_created" ? "invited" : "active";
                                DbQuery(conn, "cro_api.user_set_circularo", "@UserId", uid, "@Status", st, "@CircularoUserId", Nz(JS(found, "id")), "@CircularoUsername", Nz(JS(found, "name")), "@Actor", actor);
                                res["linked"] = true; res["circularoUsername"] = JS(found, "name"); res["status"] = st;
                            }
                            else if (action == "link") throw new Exception("No Circularo account found for " + email + ".");
                            else
                            {
                                var org = CxOrg(cfg, key, ref dbg);
                                string gid = JS(JO(org, "groups"), role == "" ? "sign" : role); if (gid == "") gid = JS(JO(org, "groups"), "user");
                                var u = new Dictionary<string, object>();
                                u["fullname"] = full; u["mail"] = email; u["name"] = email; u["organization"] = JS(org, "organization");
                                u["group"] = new List<object> { JS(org, "organization"), gid }; u["status"] = "newly_created";
                                var body = new Dictionary<string, object>(); body["sendMail"] = true; body["users"] = new List<object> { u };
                                try
                                {
                                    var cr = Cx(cfg, key, "POST", "/users", body, ref dbg);
                                    if (JS(cr, "errors").ToLowerInvariant() == "true") throw new Exception("Circularo reported errors: " + JSer(cr));
                                    string cid = "";
                                    foreach (var c in CxUsers(cfg, key, ref dbg)) if (string.Equals(JS(c, "mail"), email, StringComparison.OrdinalIgnoreCase)) { cid = JS(c, "id"); break; }
                                    DbQuery(conn, "cro_api.user_set_circularo", "@UserId", uid, "@Status", "invited", "@CircularoUserId", Nz(cid), "@CircularoUsername", email, "@Actor", actor);
                                    res["invited"] = true; res["status"] = "invited";
                                }
                                catch (Exception ex)
                                {
                                    DbQuery(conn, "cro_api.user_set_circularo", "@UserId", uid, "@Status", "error", "@Error", Inner(ex).Length > 1900 ? Inner(ex).Substring(0, 1900) : Inner(ex), "@Actor", actor);
                                    throw;
                                }
                            }
                        }
                        result = JSer(res);
                        break;
                    }
                    case "user_status":
                    {
                        // Admin. ARGS: { userId, status: "suspended"|"active" }  PUT /users/{id} {status}
                        if (!IsAdmin(cfg, who[0])) throw new Exception("Only CRO administrators can do this.");
                        long uid; if (!long.TryParse(Arg(a, "userId", 12), out uid)) throw new Exception("userId is required.");
                        string st = Arg(a, "status", 12).ToLowerInvariant();
                        if (st != "suspended" && st != "active") throw new Exception("status must be suspended or active.");
                        var u = UserRow(conn, uid); if (u == null) throw new Exception("User not found.");
                        string cid = JS(u, "circularo_user_id"); if (cid == "") cid = JS(u, "circularo_username");
                        if (cid == "") throw new Exception("This user has no Circularo account yet.");
                        var body = new Dictionary<string, object>(); body["status"] = st;
                        Cx(cfg, ApiKey(conn, In(sp, "SPP_SYSTEM_SESSION_ID"), ref dbg), "PUT", "/users/" + Uri.EscapeDataString(cid), body, ref dbg);
                        DbQuery(conn, "cro_api.user_set_circularo", "@UserId", uid, "@Status", st, "@Actor", who[1] + " (" + who[0] + ")");
                        result = "{\"userId\":" + uid + ",\"status\":" + JQ(st) + "}";
                        break;
                    }
                    case "sdk_probe":
                    {
                        // Admin diagnostics: method signatures (and parameter type members) of a TotalAgility.Sdk service.
                        if (!IsAdmin(cfg, who[0])) throw new Exception("Only CRO administrators can do this.");
                        string svcName = Arg(a, "service", 60), filter = Arg(a, "filter", 100);
                        var asm = typeof(TotalAgility.Sdk.UserService).Assembly;
                        var st = asm.GetType("TotalAgility.Sdk." + svcName, false);
                        if (st == null) throw new Exception("No such service.");
                        var outl = new List<object>();
                        foreach (var mi in st.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly))
                        {
                            if (filter != "" && !System.Text.RegularExpressions.Regex.IsMatch(mi.Name, filter)) continue;
                            var ps = new List<object>();
                            foreach (var pi in mi.GetParameters())
                            {
                                var pt = pi.ParameterType; string desc = pi.Name + ":" + pt.FullName;
                                if (pt.IsClass && pt != typeof(string) && !pt.IsArray && pt.Namespace != null && pt.Namespace.StartsWith("Agility"))
                                    desc += " {" + string.Join(", ", Array.ConvertAll(pt.GetProperties(), x => x.Name + ":" + x.PropertyType.Name)) + "}";
                                ps.Add(desc);
                            }
                            var rt = mi.ReturnType; var m = new Dictionary<string, object>(); m["name"] = mi.Name; m["returns"] = rt.FullName + (rt.Namespace != null && rt.Namespace.StartsWith("Agility") ? " {" + string.Join(", ", Array.ConvertAll(rt.GetProperties(), x => x.Name + ":" + x.PropertyType.Name)) + "}" : ""); m["params"] = ps; outl.Add(m);
                        }
                        result = JSer(outl);
                        break;
                    }
                    case "request_prepare":
                    {
                        // ARGS: { requestId, fileName, fileB64, returnUrl }  Ad hoc "Circularo editor". Creator only; needs a linked Circularo account.
                        long rid; if (!long.TryParse(Arg(a, "requestId", 20), out rid)) throw new Exception("requestId is required.");
                        var rq = FirstRow(DbQuery(conn, "cro_api.request_get", "@RequestId", rid));
                        if (rq == null) throw new Exception("Request not found.");
                        if (!string.Equals(JS(rq, "created_by_resource_id"), who[0], StringComparison.OrdinalIgnoreCase)) throw new Exception("Only the person who created the request can prepare it.");
                        string uname = "";
                        foreach (var u in FirstSet(DbQuery(conn, "cro_api.user_list")))
                            if (string.Equals(JS(u, "tta_resource_id"), who[0], StringComparison.OrdinalIgnoreCase) && JS(u, "status") == "active") uname = JS(u, "circularo_username");
                        if (uname == "") throw new Exception("You need an active Circularo account linked on the Users page to use the Circularo editor.");
                        string fn = Arg(a, "fileName", 200); if (fn == "") fn = "document.pdf";
                        result = Prepare(cfg, conn, ApiKey(conn, In(sp, "SPP_SYSTEM_SESSION_ID"), ref dbg), who[1] + " (" + who[0] + ")", uname, rid, fn,
                                         Convert.FromBase64String(JS(a, "fileB64")), Arg(a, "returnUrl", 500), ref dbg);
                        break;
                    }
                    case "request_import":
                    {
                        // ARGS: { requestId }  Pick up recipients after the sender sent from the Circularo editor (Sync does this too).
                        long rid; if (!long.TryParse(Arg(a, "requestId", 20), out rid)) throw new Exception("requestId is required.");
                        string key = ApiKey(conn, In(sp, "SPP_SYSTEM_SESSION_ID"), ref dbg);
                        int got = ImportShares(cfg, conn, key, rid, ref dbg);
                        if (got > 0) RefreshRequest(cfg, conn, key, rid, "poll", ref dbg);
                        result = "{\"requestId\":" + rid + ",\"imported\":" + got + "}";
                        break;
                    }
                    case "request_remind":
                    {
                        // ARGS: { requestId }  Creator or admin. Email reminder to everyone whose turn it is (Circularo allows one per share per day).
                        long rid; if (!long.TryParse(Arg(a, "requestId", 20), out rid)) throw new Exception("requestId is required.");
                        var got = JParse(DbQuery(conn, "cro_api.request_get", "@RequestId", rid)) as List<object>;
                        var rq = FirstRow(JSer(got));
                        if (rq == null) throw new Exception("Request not found.");
                        if (!IsCreatorOrAdmin(cfg, rq, who[0])) throw new Exception("Only the person who created the request can send reminders.");
                        if (JS(rq, "state") != "inprogress") throw new Exception("The request is " + JS(rq, "state") + ".");
                        var shares = new List<object>();
                        foreach (var ro in (got.Count > 1 ? got[1] as List<object> : new List<object>()))
                            if (JS(ro, "status") == "waiting" && JS(ro, "share_id") != "") { var x = new Dictionary<string, object>(); x["shareId"] = JS(ro, "share_id"); shares.Add(x); }
                        if (shares.Count == 0) throw new Exception("Nobody is waiting to act.");
                        var body = new Dictionary<string, object>(); body["reminderType"] = "email"; body["shares"] = shares;   // shares and documentId are exclusive
                        Cx(cfg, ApiKey(conn, In(sp, "SPP_SYSTEM_SESSION_ID"), ref dbg), "POST", "/share/reminder", body, ref dbg);
                        DbQuery(conn, "cro_api.audit_write", "@Actor", who[1] + " (" + who[0] + ")", "@Action", "reminder_sent", "@Outcome", "ok", "@RequestId", rid, "@Detail", shares.Count + " recipient(s)");
                        result = "{\"requestId\":" + rid + ",\"reminded\":" + shares.Count + "}";
                        break;
                    }
                    case "user_list":
                        result = DbQuery(conn, "cro_api.user_list");
                        break;
                    default:
                        throw new Exception("Unknown operation: " + op);
                }
            }
            catch (Exception e) { error = Inner(e); }
            sp.OutputVariables["RESULT"] = result;
            sp.OutputVariables["ERROR"] = error;
            sp.OutputVariables["DEBUG"] = dbg;
        }
    }
}
