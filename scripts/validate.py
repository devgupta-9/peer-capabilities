"""Timestamped, secret-free inventory; never serialize raw host configurations."""
from __future__ import annotations
import argparse, concurrent.futures, datetime, hashlib, json, os, pathlib, shutil, subprocess, sys, tomllib, urllib.request
ROOT = pathlib.Path(__file__).resolve().parents[1]
USER = pathlib.Path.home()
parser = argparse.ArgumentParser()
parser.add_argument("--probe", action="store_true")
args = parser.parse_args()
errors: list[str] = []
def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest().upper() if path.is_file() else None
def read_json(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))
def safe_load(label, path, is_toml=False):
    try:
        return tomllib.loads(path.read_text(encoding="utf-8-sig")) if is_toml else read_json(path)
    except Exception:
        errors.append(f"{label}: could not parse configuration (contents withheld)")
        return {}
def uv_bin_dir():
    uv = shutil.which("uv")
    if not uv:
        return ""
    try:
        result = subprocess.run([uv, "tool", "dir", "--bin"], text=True, capture_output=True, timeout=10)
        return result.stdout.strip() if result.returncode == 0 else ""
    except Exception:
        return ""
def expand_tokens(value, replacements):
    if isinstance(value, str):
        for token, replacement in replacements.items():
            value = value.replace(token, replacement)
        return value
    if isinstance(value, list):
        return [expand_tokens(item, replacements) for item in value]
    if isinstance(value, dict):
        return {key: expand_tokens(item, replacements) for key, item in value.items()}
    return value
def same_value(actual, wanted):
    if isinstance(actual, str) and isinstance(wanted, str):
        return actual.casefold() == wanted.casefold() if os.name == "nt" else actual == wanted
    if isinstance(actual, list) and isinstance(wanted, list):
        return len(actual) == len(wanted) and all(same_value(a, w) for a, w in zip(actual, wanted))
    return actual == wanted
replacements = {
    "${ORIGIN}": str(ROOT),
    "${NODE_BIN}": shutil.which("node") or "node",
    "${AGY_BIN}": shutil.which("agy") or "agy",
    "${UV_BIN}": uv_bin_dir(),
}
expected = expand_tokens(read_json(ROOT / "integrations.json"), replacements)
codex = safe_load("Codex", USER / ".codex/config.toml", True)
agy = safe_load("Antigravity MCP", USER / ".gemini/config/mcp_config.json")
settings = safe_load("Antigravity settings", USER / ".gemini/config/config.json")
cli = safe_load("Antigravity CLI", USER / ".gemini/antigravity-cli/settings.json")
hosts = {"codex": codex.get("mcp_servers", {}), "antigravity": agy.get("mcpServers", {})}
report = {
    "observed_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "scope": "Local configuration and fresh-process tool discovery; remote authentication and existing sessions not tested.",
    "hosts": {}, "plugins": {}, "shared_tools": {}, "drift": [],
    "security": {}, "limitations": [
        "Remote credential validity, model account access, and backend model identity remain unverified.",
        "Fresh probes do not prove an already-open Codex or Antigravity session reloaded its configuration.",
        "Headroom MCP discovery is not proof of proxy health or per-session routing.",
        "Graphify discovery is not proof that any project's graph exists or is up to date.",
    ],
}
for host, servers in hosts.items():
    # Only names and booleans; never URLs, headers, env values, arguments, or raw errors.
    report["hosts"][host] = [
        {"name": name, "enabled": server.get("enabled", True) if host=="codex" else not server.get("disabled", False),
         "transport": "local" if server.get("command") else "remote", "authentication": "not_tested"}
        for name, server in sorted(servers.items())
    ]
for host, plugins in (("codex",codex.get("plugins",{})),("antigravity",settings.get("plugins",{}))):
    report["plugins"][host] = [
        {"name":name,"enabled":value.get("enabled","not_recorded") if isinstance(value,dict) else value if isinstance(value,bool) else "not_recorded"}
        for name,value in sorted(plugins.items())
    ] if isinstance(plugins,dict) else []
jobs=[]
for host, servers in hosts.items():
    report["shared_tools"][host]={}
    for name, want in expected["sharedServers"].items():
        actual=servers.get(name,{})
        enabled=actual.get("enabled",True) if host=="codex" else not actual.get("disabled",False)
        matches = bool(actual) and same_value(str(actual.get("command","")), want["command"]) and same_value(actual.get("args",[]), want["args"])
        for key,value in want.get("env",{}).items():
            matches = matches and same_value(actual.get("env",{}).get(key), value)
        command=want["command"]
        installed=bool(shutil.which(command) or pathlib.Path(command).is_file())
        if want.get("args") and pathlib.Path(want["args"][0]).is_absolute():
            installed=installed and pathlib.Path(want["args"][0]).is_file()
        row={"configured":bool(actual),"enabled":bool(enabled),"matches_expected":bool(matches),"installed":installed,"discovered":"not_tested","loaded_in_session":"not_tested"}
        report["shared_tools"][host][name]=row
        if not (matches and enabled and installed): errors.append(f"{host}/{name}: registration mismatch, disabled, or executable missing")
        if args.probe and matches and enabled and installed: jobs.append((host,name,actual,row))
def probe(job):
    host,name,actual,row=job
    try:
        env=actual.get("env",{})
        spec={"command":actual["command"],"args":actual.get("args",[]),"env":env,"cwd":str(ROOT)}
        result=subprocess.run(["node",str(ROOT/"scripts/probe.mjs")],input=json.dumps(spec),text=True,capture_output=True,timeout=35)
        data=json.loads(result.stdout)
        row["discovered"]=bool(data.get("ok"))
        row["tools"]=data.get("tools",[])
        if name=="peer-agents": row["explicit_model_schema"]=data.get("explicitModelSchema",False)
        if not data.get("ok") or (name=="peer-agents" and not data.get("explicitModelSchema")):
            return f"{host}/{name}: MCP probe failed"
    except Exception:
        row["discovered"]=False
        return f"{host}/{name}: MCP probe could not complete (diagnostics withheld)"
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    for problem in pool.map(probe,jobs):
        if problem: errors.append(problem)
# Enumerate current sources as well as recorded deployments so new files cannot hide.
source_pairs=[
    (ROOT/"platforms/codex/AGENTS.md", USER/".codex/AGENTS.md"),
    (ROOT/"platforms/antigravity/GEMINI.md", USER/".gemini/GEMINI.md"),
]
for source in (ROOT/"orchestrator").rglob("*"):
    if source.is_file(): source_pairs.append((source,USER/".ai-orchestrator"/source.relative_to(ROOT/"orchestrator")))
if (ROOT/"skills").is_dir():
    for source in (ROOT/"skills").rglob("*"):
        if source.is_file():
            for live in (USER/".codex/skills", USER/".gemini/config/skills"):
                source_pairs.append((source,live/source.relative_to(ROOT/"skills")))
for source,target in source_pairs:
    if digest(source)!=digest(target): report["drift"].append(str(target))
state_path=ROOT/"state/deployments.json"
if not state_path.is_file(): errors.append("No deployment state: run sync.ps1 -Apply")
else:
    current_targets={str(t) for _,t in source_pairs}
    for entry in read_json(state_path):
        if entry["target"] not in current_targets: errors.append("An old managed source was removed; review its live target explicitly")
if report["drift"]: errors.append(f'{len(report["drift"])} managed files differ from their sources')
if (USER/".gemini/config/AGENTS.md").exists(): errors.append("Duplicate Antigravity global AGENTS.md is present")
for key,value in expected["antigravityReview"].items():
    okay=settings.get("userSettings",{}).get(key)==value
    report["security"][key]={"matches_expected":okay}
    if not okay: errors.append(f"Antigravity review setting drift: {key}")
broad={r"C:\WINDOWS\system32".casefold(),str(USER).casefold(),"d:\\"}
trust=cli.get("trustedWorkspaces",[])
report["security"]["broad_cli_trust_absent"]=not any(str(p).rstrip("\\").casefold() in {s.rstrip("\\") for s in broad} for p in trust)
if not report["security"]["broad_cli_trust_absent"]: errors.append("Antigravity CLI still trusts a broad user/system/drive root")
report["security"]["cli_mutating_git_deny_present"]=any("push|pull|fetch|merge" in p for p in cli.get("permissions",{}).get("deny",[]))
if not report["security"]["cli_mutating_git_deny_present"]: errors.append("CLI mutating Git deny rule missing")
report["managed_files"]=len(source_pairs)
report["headroom_proxy"]={"health":"not_tested","session_routing":"not_verified"}
if args.probe:
    try:
        with urllib.request.urlopen("http://127.0.0.1:8787/health", timeout=5) as response:
            health=json.load(response)
        report["headroom_proxy"]["health"]="healthy" if health.get("status")=="healthy" else "unexpected_response"
    except Exception:
        report["headroom_proxy"]["health"]="unreachable"
# Configuration evidence only; never serialize URLs or environment values.
provider=codex.get("model_providers",{}).get(codex.get("model_provider",""),{})
proxy_configured="127.0.0.1:8787" in str(provider.get("base_url","")) or "127.0.0.1:8787" in os.environ.get("OPENAI_BASE_URL","")
report["headroom_proxy"]["routing_in_inspected_config_or_environment"]=proxy_configured
report["curated_skills"]=len([p for p in (ROOT/"skills").iterdir() if p.is_dir()]) if (ROOT/"skills").is_dir() else 0
report["errors"]=errors
report["ok"]=not errors
(ROOT/"reports").mkdir(exist_ok=True)
(ROOT/"reports/latest.json").write_text(json.dumps(report,indent=2)+"\n",encoding="utf-8")
lines=["# Local AI health", "", f"Observed (UTC): {report['observed_at']}", "", report["scope"], "",
       f"Result: {'PASS' if report['ok'] else 'ATTENTION REQUIRED'}",
       f"Managed files: {len(source_pairs)}; curated skills: {report['curated_skills']}; drift: {len(report['drift'])}", "",
       "| Host | Shared tool | Config aligned | Installed | Fresh tool discovery |",
       "| --- | --- | --- | --- | --- |"]
for host, servers in report["shared_tools"].items():
    for name,row in servers.items(): lines.append(f"| {host} | {name} | {row['matches_expected']} | {row['installed']} | {row['discovered']} |")
lines+=["",f"Headroom proxy health: {report['headroom_proxy']['health']}. Session routing: not verified.",
        f"Proxy route found in inspected Codex provider/environment settings: {proxy_configured}.",
        "", "## Limits", ""]+[f"- {x}" for x in report["limitations"]]
if errors: lines+=["","## Findings",""]+[f"- {x}" for x in errors]
lines+=["",f"Full secret-free inventory: {ROOT / 'reports/latest.json'}", ""]
(USER/".ai-orchestrator/AI_HEALTH.md").write_text("\n".join(lines),encoding="utf-8")
print(json.dumps({"ok":report["ok"],"observed_at":report["observed_at"],"managed_files":len(source_pairs),"curated_skills":report["curated_skills"],"drift":len(report["drift"]),"probes":len(jobs),"errors":errors,"report":str(ROOT/"reports/latest.json")}))
sys.exit(0 if report["ok"] else 1)
