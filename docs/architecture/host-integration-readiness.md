# Host integration readiness

Status: implementation in the development branch; certification and active-session verification are separate. This is the readiness/registration slice, not automatic scheduler integration.

Local deployment evidence and remaining limits: [2026-10-21 verification report](host-integration-verification-2026-10-21.md).

Headless permission diagnosis, discovery mitigation and remaining desktop checks:
[Antigravity verification update](antigravity-headless-verification-2026-10-21.md).

## What was wrong

The installed runtime lagged the development checkout. Jev was launched without a deliberate credential-delivery path. Antigravity CLI and IDE did not share registrations, and Claude Code and Desktop were separate unconfigured scopes. REA was installed but absent from the reproducible integration inventory. Graphify discovery did not establish a project graph; Headroom's working Codex proxy did not route every host.

## Current boundary

`integrations.json` schema 3 declares launch details and supported host/server combinations. It remains the legacy setup input to the future full Environment Manifest; it does not replace resource contracts or task state.

| Surface | Managed registrations | Important limit |
| --- | --- | --- |
| Codex | Peer bridge, Graphify, Headroom, Jev, optional REA | Existing session must reload after launch changes |
| Antigravity CLI / IDE | Same catalog, separately configured | CLI success does not prove IDE discovery |
| Claude Code | Graphify, Headroom, Jev, optional REA | No supported Claude peer caller/adapter yet |
| Claude Desktop | Same optional tooling | Windows Store and ordinary installs have different paths; ambiguous installs fail closed |
| ChatGPT web / remote hosts | Not changed by local registration | Needs an official supported connector; no public local-filesystem tunnel |

Native ChatGPT/Codex surfaces must be checked against the installed app's actual configuration support. Do not infer web availability from a desktop config file.

## Safe setup

The Windows resolver calls a portable TypeScript reconciliation core. JSON/TOML are parsed, not text-spliced. A pinned TOML parser preserves numeric/date types; TOML comments and formatting can change. Launch details are scoped; unrelated settings, existing environment, permissions, disable flags and plugins survive. Explicit installer workspace choices are non-secret environment overrides, never inferred permission expansion.

Preview is read-only. Applying requires the preview digest and rechecks file hashes. Canonical directory identity and link/hardlink checks reject redirected targets. Environment-domain SQLite records operation metadata, hashes and status, **not configuration bodies**. Backups stay under the user's `.peer-capabilities/host-configuration/<operation>/` with restricted creation modes/inherited user-directory ACLs. They can contain existing host configuration secrets: do not export or commit them. Provider credential stores are never inspected or copied.

Successful setup also records non-secret installed runtime/Jev/REA paths as deployment observations, scoped to each selected host and component. Doctor reads the latest completed observation for that pair, ignoring rolled-back operations; explicit path arguments take precedence. This prevents a development checkout or an older source installation from being mistaken for the runtime the hosts actually launch. A no-change apply can record these bindings without rewriting host files. These observations are local operator state, not provider authentication evidence or the desired-state manifest.

An interrupted apply retains its operation record and original files. Rollback handles partial application, checks backup hashes and refuses to overwrite later user edits. This is not a transaction against a concurrently running host; close configuration editors, inspect the preview again after conflicts, and reload the host after applying.

```powershell
$hosts = 'codex','antigravity-cli','antigravity-ide','claude-code','claude-desktop'
$plan = .\scripts\sync-hosts.ps1 -Hosts $hosts | ConvertFrom-Json
$plan.changes
.\scripts\sync-hosts.ps1 -Hosts $hosts -Apply -ExpectedDigest $plan.digest
# Recover only this operation, preserving newer edits:
.\scripts\sync-hosts.ps1 -Rollback '<operation UUID>'
```

`-RuntimeRoot`, `-JevEntry` and `-ReaEntry` select already-installed absolute entrypoints. `-Servers` limits the selected capabilities. Use explicit matching arguments for preview/apply; nothing is downloaded by reconciliation. `install.ps1 -IncludeRea` installs the exact optional package from its lockfile. REA 6.5.0 has its own Node engine requirement (including Node 24.11+); native analysis engines remain bring-your-own. Setup does not install Ghidra, IDA, Java, Hopper or browser tooling.

The default reconciliation selects Peer, Graphify, Headroom and Jev only. Include `rea` explicitly in `-Servers` after installing it. Doctor's `-Hosts` selection limits required checks and probes; other discovered hosts are inventory, not dependencies of the selected hosts.

The main installer now uses this reconciler for Codex/Antigravity CLI; additional hosts are explicit. `scripts/sync.ps1 -IncludeClaude -Apply` installs the thin Claude Code bootstrap through the existing policy deployment mechanism. REA's bundled skill remains vendor-owned, outside the shared curated inventory.

## Jev authentication and transport

The packaged Windows launcher reads only named Jev provider variables from its process environment, falling back to the existing Windows user environment. Unrelated application credentials are not forwarded. Values are never written to the manifest, command line, report or database. The child receives an explicit allowlist and byte-stream stdio forwarding. `-Check` returns presence only, **not authenticated success**. Missing/invalid credentials still need the provider's official setup; Peer Capabilities neither creates nor rotates keys.

## Verification and next slices

Local tests cover semantic preservation, idempotency, conflicts, rollback, canonical path rejection, secret-free metadata and Jev stdio/credential isolation. Fresh-process MCP discovery and a scoped functional call are distinct checks. An already-open host requires its own in-session test after reload; setup cannot guarantee tool use by every model or every task.

The [task-selection increment](task-tool-selection.md) adds automatic runtime/delegated-prompt recommendations and durable selection records, not tool-execution receipts. Pending: scheduler consumption of resource/access observations, governed connector execution and per-host session certification. ChatGPT web is excluded by user choice. REA remains task-triggered, Jev optional advice, Headroom eligible compression, and Graphify evidence-grounded navigation. No mandatory call-all-tools pipeline.
