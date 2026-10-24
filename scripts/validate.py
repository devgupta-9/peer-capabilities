"""Timestamped, secret-free inventory; never serialize raw host configurations."""
from __future__ import annotations
import argparse, concurrent.futures, contextlib, datetime, hashlib, json, os, pathlib, shutil, sqlite3, subprocess, sys, tomllib, urllib.request
ROOT = pathlib.Path(__file__).resolve().parents[1]
USER = pathlib.Path.home()
parser = argparse.ArgumentParser()
parser.add_argument("--probe", action="store_true")
parser.add_argument("--strict-security", action="store_true")
parser.add_argument("--runtime-root", type=pathlib.Path)
parser.add_argument("--jev-entry", type=pathlib.Path)
parser.add_argument("--rea-entry", type=pathlib.Path)
parser.add_argument("--hosts", default="codex,antigravity-cli")
args = parser.parse_args()
selected = set(args.hosts.split(","))
known_hosts = {"codex", "antigravity-cli", "antigravity-ide", "claude-code", "claude-desktop"}
if not selected or not selected <= known_hosts:
    parser.error("--hosts must name supported host scopes")
agy_selected = bool(selected & {"antigravity-cli", "antigravity-ide"})
errors: list[str] = []
warnings: list[str] = []
bindings={}
ledger=USER/".peer-capabilities/host-configuration/environment.sqlite"
if ledger.is_file():
    try:
        with contextlib.closing(sqlite3.connect(ledger.as_uri()+"?mode=ro",uri=True)) as db:
            for (body,) in db.execute("SELECT body FROM host_configuration_operations ORDER BY rowid DESC"):
                operation=json.loads(body)
                if operation.get("version") != 1: raise ValueError("Unknown host ledger version")
                if operation.get("status")=="COMPLETE":
                    for host,components in operation.get("bindings",{}).items():
                        if host not in known_hosts or not isinstance(components,dict): continue
                        for component,locations in components.items():
                            if component not in ("peer-agents","jev","rea") or not isinstance(locations,dict): continue
                            if all(key in ("runtimeRoot","entry") and isinstance(value,str) and pathlib.Path(value).is_absolute() for key,value in locations.items()):
                                bindings.setdefault(host,{}).setdefault(component,locations)
    except Exception: warnings.append("Deployment bindings could not be read; explicit runtime paths may be needed")
def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest().upper() if path.is_file() else None
def read_json(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))
def safe_load(label, path, is_toml=False, required=True):
    try:
        return tomllib.loads(path.read_text(encoding="utf-8-sig")) if is_toml else read_json(path)
    except Exception:
        message=f"{label}: could not parse configuration (contents withheld)"
        (errors if required else warnings).append(message)
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
    "${CODEX_PEER_BIN}": shutil.which("codex.exe") or shutil.which("codex") or "codex",
    "${UV_BIN}": uv_bin_dir(),
    "${PEER_RUNTIME}": str(args.runtime_root or ROOT/"peer-agents"),
    "${POWERSHELL_BIN}": shutil.which("pwsh") or "pwsh",
    "${JEV_ENTRY}": str(args.jev_entry or ROOT/"tools/jev/node_modules/@jkudish/jev-mcp/dist/index.js"),
    "${REA_ENTRY}": str(args.rea_entry or ROOT/"tools/rea/node_modules/rea-agents/scripts/rea.mjs"),
}
manifest = read_json(ROOT / "integrations.json")
expected = expand_tokens(manifest, replacements)
def expected_server(host, name):
    tokens = dict(replacements)
    locations = bindings.get(host,{}).get(name,{})
    if not args.runtime_root and "runtimeRoot" in locations: tokens["${PEER_RUNTIME}"]=locations["runtimeRoot"]
    if name=="jev" and not args.jev_entry and "entry" in locations: tokens["${JEV_ENTRY}"]=locations["entry"]
    if name=="rea" and not args.rea_entry and "entry" in locations: tokens["${REA_ENTRY}"]=locations["entry"]
    return expand_tokens(manifest["sharedServers"][name],tokens)
def load_host(label, file, host, is_toml=False):
    return safe_load(label, file, is_toml, required=host in selected) if file.is_file() or host in selected else {}
codex = load_host("Codex", USER / ".codex/config.toml", "codex", True)
agy = load_host("Antigravity MCP", USER / ".gemini/config/mcp_config.json", "antigravity-cli")
settings = safe_load("Antigravity settings", USER / ".gemini/config/config.json", required=args.strict_security) if agy_selected else {}
cli = safe_load("Antigravity CLI", USER / ".gemini/antigravity-cli/settings.json", required=args.strict_security) if agy_selected else {}
host_paths = {
    "antigravity-ide": USER / ".gemini/antigravity/mcp_config.json",
    "claude-code": USER / ".claude.json",
}
desktop_candidates = [USER / "AppData/Roaming/Claude/claude_desktop_config.json"] + list((USER / "AppData/Local/Packages").glob("Claude_*/LocalCache/Roaming/Claude/claude_desktop_config.json"))
desktop_found = [p for p in desktop_candidates if p.is_file()]
if len(desktop_found) == 1: host_paths["claude-desktop"] = desktop_found[0]
elif len(desktop_found) > 1: warnings.append("Claude Desktop: multiple configurations; select the intended app explicitly")
hosts = {"codex": codex.get("mcp_servers", {}), "antigravity-cli": agy.get("mcpServers", {})}
for host, file in host_paths.items():
    if file.is_file() or host in selected:
        hosts[host] = safe_load(host, file, required=host in selected).get("mcpServers", {})
for host in selected - set(hosts): errors.append(f"{host}: host configuration is not available")
report = {
    "observed_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "scope": "Local configuration and fresh-process tool discovery; remote authentication and existing sessions not tested.",
    "hosts": {}, "plugins": {}, "shared_tools": {}, "drift": [], "warnings": warnings,
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
    for name in expected["hosts"][host]:
        want=expected_server(host,name)
        actual=servers.get(name,{})
        enabled=actual.get("enabled",True) if host=="codex" else not actual.get("disabled",False)
        matches = bool(actual) and same_value(str(actual.get("command","")), want["command"]) and same_value(actual.get("args",[]), want["args"])
        for key,value in want.get("env",{}).items():
            # Manifest env entries are defaults. Reconciliation preserves established host overrides.
            configured_value=actual.get("env",{}).get(key)
            matches = matches and bool(configured_value)
            if key.endswith("_BIN"): matches = matches and pathlib.Path(str(configured_value)).is_file()
        command=want["command"]
        installed=bool(shutil.which(command) or pathlib.Path(command).is_file())
        for arg in want.get("args",[]):
            if pathlib.Path(arg).is_absolute(): installed=installed and pathlib.Path(arg).is_file()
        row={"configured":bool(actual),"enabled":bool(enabled),"matches_expected":bool(matches),"installed":installed,"discovered":"not_tested","loaded_in_session":"not_tested"}
        report["shared_tools"][host][name]=row
        required=host in selected and name not in expected.get("optionalServers",[])
        if not enabled:
            warnings.append(f"{host}/{name}: intentionally disabled; setup will not enable it implicitly")
        elif not (matches and installed):
            (errors if required else warnings).append(f"{host}/{name}: not aligned or not installed")
        if args.probe and host in selected and actual and enabled:
            jobs.append((host,name,actual,row))
def probe(job):
    host,name,actual,row=job
    try:
        env=actual.get("env",{})
        spec={"command":actual["command"],"args":actual.get("args",[]),"env":env,"env_vars":actual.get("env_vars",[]),"cwd":str(ROOT)}
        if name=="rea": spec["maxOutputBytes"]=16_000_000  # Its full 207-tool catalog exceeds the default bound.
        roots=env.get("PEER_AGENTS_ALLOWED_ROOTS", "").split(os.pathsep)
        if name=="peer-agents":
            spec["workspace"]=roots[0] or str(ROOT)
            # Do not mask missing roots by launching the probe inside our Git checkout.
            spec["cwd"]=actual.get("cwd", str(USER))
        result=subprocess.run(["node",str(ROOT/"scripts/probe.mjs")],input=json.dumps(spec),text=True,capture_output=True,timeout=120)
        data=json.loads(result.stdout)
        row["discovered"]=bool(data.get("ok"))
        row["tools"]=data.get("tools",[])
        if name=="peer-agents":
            row["explicit_model_schema"]=data.get("explicitModelSchema",False)
            row["peer_capabilities_checked"]=data.get("peerCapabilitiesChecked",False)
            row["workspace_ready"]=data.get("workspaceReady",False)
            row["workspace_evidence_scope"]=data.get("workspaceEvidenceScope","unknown")
            row["antigravity_models_available"]=data.get("antigravityModelsAvailable",False)
            row["antigravity_discovery"]=data.get("antigravityDiscovery",{})
            row["antigravity_readiness"]=data.get("antigravityReadiness",{"authentication":"UNKNOWN","verification":"UNVERIFIED"})
            row["peer_cli_availability"]={"codex":data.get("codexAvailable",False),"antigravity":data.get("antigravityAvailable",False)}
        peer_ok=name!="peer-agents" or (
            data.get("explicitModelSchema") and data.get("peerCapabilitiesChecked")
            and data.get("codexAvailable") and data.get("antigravityAvailable")
            and data.get("antigravityModelsAvailable") and data.get("workspaceReady")
        )
        if not data.get("ok") or not peer_ok:
            if name=="peer-agents" and data.get("antigravityDiscovery"):
                discovery=data["antigravityDiscovery"]
                return f"{host}/{name}: MCP probe failed (Antigravity CLI={discovery.get('cli', 'UNKNOWN')}, catalog={discovery.get('catalog', 'UNKNOWN')})"
            return f"{host}/{name}: MCP probe failed"
    except Exception:
        row["discovered"]=False
        return f"{host}/{name}: MCP probe could not complete (diagnostics withheld)"
# AGY's catalog command also starts provider/MCP services. Do not amplify cold startup
# by probing several host registrations concurrently, or alongside the other MCPs.
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    for problem in pool.map(probe,[job for job in jobs if job[1] != 'peer-agents']):
        if problem: errors.append(problem)
for job in jobs:
    if job[1] == 'peer-agents':
        problem = probe(job)
        if problem: errors.append(problem)
# Enumerate current sources as well as recorded deployments so new files cannot hide.
source_pairs=[
    (ROOT/"platforms/codex/AGENTS.md", USER/".codex/AGENTS.md"),
    (ROOT/"platforms/antigravity/GEMINI.md", USER/".gemini/GEMINI.md"),
]
if (USER/".claude/CLAUDE.md").is_file():
    source_pairs.append((ROOT/"platforms/claude/CLAUDE.md",USER/".claude/CLAUDE.md"))
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
for key,value in (expected["antigravityReview"] if agy_selected else {}).items():
    okay=settings.get("userSettings",{}).get(key)==value
    report["security"][key]={"matches_expected":okay}
    if not okay: (errors if args.strict_security else warnings).append(f"Antigravity review setting drift: {key}")
broad={r"C:\WINDOWS\system32".casefold(),str(USER).casefold(),"d:\\"}
trust=cli.get("trustedWorkspaces",[])
report["security"]["broad_cli_trust_absent"]=not any(str(p).rstrip("\\").casefold() in {s.rstrip("\\") for s in broad} for p in trust)
if not report["security"]["broad_cli_trust_absent"]: (errors if args.strict_security else warnings).append("Antigravity CLI still trusts a broad user/system/drive root")
required_deny=r'command(regex:\bgit(?:\.exe)?\s+.*\b(push|pull|fetch|merge|rebase|checkout|switch|reset|restore|stash|clean|commit|add|rm|mv)\b.*)'
report["security"]["cli_mutating_git_deny_present"]=required_deny in cli.get("permissions",{}).get("deny",[])
if agy_selected and not report["security"]["cli_mutating_git_deny_present"]: (errors if args.strict_security else warnings).append("CLI mutating Git deny rule missing")
filesystem_rules=[rule for rule in cli.get("permissions",{}).get("allow",[]) if isinstance(rule,str)]
if any(rule.startswith(("read_file(regex:","write_file(regex:")) for rule in filesystem_rules):
    errors.append("Antigravity filesystem rules use unsupported regex syntax; use literal directory/file paths before invoking the terminal sandbox")
report["managed_files"]=len(source_pairs)
report["headroom_proxy"]={"health":"not_tested","session_routing":"not_verified"}
report["project_graph"]={"present":(ROOT/"graphify-out/graph.json").is_file(),"freshness":"not_verified"}
report["jev"]={"credential_present":"not_tested","authentication":"UNKNOWN","functional_verification":"UNVERIFIED"}
if args.probe:
    try:
        jev_host=next((host for host in sorted(selected) if "jev" in expected["hosts"][host]), None)
        if jev_host is None: raise ValueError("No selected Jev scope")
        jev_args=expected_server(jev_host,"jev")["args"]
        launcher=jev_args[jev_args.index("-File")+1]
        check=subprocess.run([replacements["${POWERSHELL_BIN}"],"-NoProfile","-File",launcher,"-Check"],capture_output=True,text=True,timeout=15)
        report["jev"]["credential_present"]=bool(json.loads(check.stdout).get("credentialPresent")) if check.returncode==0 else "not_tested"
        if report["jev"]["credential_present"] is False: warnings.append("Jev: official provider credential required; installation is not authentication")
    except Exception: warnings.append("Jev: credential presence could not be checked; contents withheld")
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
report["warnings"]=warnings
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
if warnings: lines+=["","## Warnings",""]+[f"- {x}" for x in warnings]
lines+=["",f"Full secret-free inventory: {ROOT / 'reports/latest.json'}", ""]
(USER/".ai-orchestrator/AI_HEALTH.md").write_text("\n".join(lines),encoding="utf-8")
print(json.dumps({"ok":report["ok"],"observed_at":report["observed_at"],"managed_files":len(source_pairs),"curated_skills":report["curated_skills"],"drift":len(report["drift"]),"probes":len(jobs),"warnings":warnings,"errors":errors,"report":str(ROOT/"reports/latest.json")}))
sys.exit(0 if report["ok"] else 1)
