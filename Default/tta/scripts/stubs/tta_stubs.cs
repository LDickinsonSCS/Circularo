// Compile-only stubs for the TotalAgility script host (not deployed).
using System;
using System.Collections.Generic;

namespace Agility.Server.Scripting.ScriptAssembly
{
    public class StartMethodAttribute : Attribute { }
    public class VarDict
    {
        private readonly Dictionary<string, object> d = new Dictionary<string, object>();
        public object this[string k] { get { object v; return d.TryGetValue(k, out v) ? v : null; } set { d[k] = value; } }
    }
    public class ScriptParameters
    {
        public VarDict InputVariables = new VarDict();
        public VarDict OutputVariables = new VarDict();
    }
}
namespace TotalAgility.Sdk
{
    public class UserService { }
    public class ServerService { }
    public class JobService { }
}
namespace TotalAgility.Sdk { public class ClientService { } }
