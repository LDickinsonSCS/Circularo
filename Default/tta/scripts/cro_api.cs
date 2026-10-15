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

        private const string VERSION = "cro-api 0.1.2";
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

        // ---- Circularo API key: read server-side with the system session; never returned or logged ----
        private static string ApiKey(string systemSession)
        {
            var svc = new TotalAgility.Sdk.ClientService();
            object v = null;
            foreach (var mi in svc.GetType().GetMethods())
            {
                var ps = mi.GetParameters();
                if (mi.Name == "GetServerVariableValue" && ps.Length == 2 && ps[0].ParameterType == typeof(string) && ps[1].ParameterType == typeof(string))
                { v = mi.Invoke(svc, new object[] { systemSession, "CRO_API_KEY" }); break; }
            }
            object val = v is string ? v : GetP(v, "Value");
            string key = val == null ? "" : Convert.ToString(val, CultureInfo.InvariantCulture).Trim();
            if (key.Length < 16) throw new Exception("The Circularo API key (CRO_API_KEY) is not set.");
            return key;
        }

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
                        string key = ApiKey(In(sp, "SPP_SYSTEM_SESSION_ID"));
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
                    case "keycheck":
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
