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

        private const string VERSION = "cro-api 0.6.1";
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
        private static string SendRequest(object cfg, string conn, string key, string actor, long requestId, string fileName, byte[] file, ref string dbg)
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

            // 4. ad hoc / fallback: default position on the last page for every signer without a field
            var dp = JO(JO(cfg, "adhoc"), "defaultPosition");
            int idx = 0;
            string placementUsed = anchors.Count > 0 ? "anchors" : "adhoc";
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
                placementUsed = anchors.Count > 0 ? "anchors+default" : "default_position";
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
                    if (sequential) d["order"] = JN(r, "sign_order");
                    string prot = JS(r, "protection");
                    bool isExt = JS(r, "kind") == "external" || JS(r, "internal_mode") == "as_external";
                    if (isExt && prot == "email_otp") { d["otpEnabled"] = true; d["mail"] = JS(r, "email"); }
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
                        result = SendRequest(cfg, conn, ApiKey(conn, In(sp, "SPP_SYSTEM_SESSION_ID"), ref dbg), who[1] + " (" + who[0] + ")", rid, fn, bytes, ref dbg);
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
