# peer-agents

Local MCP bridge for Codex <-> Antigravity CLI. Version 0.3.0.

The unchanged legacy MCP contract coexists with an experimental Phase-1 task runtime
(`node bin/peer-capabilities.mjs --help`). The runtime reports 0.4.0-dev.0, is not
published or certified, and requires Node 24+. See ../docs/runtime-guide.md and
../docs/architecture/implementation-status.md before using live adapters.

## Contract

- peer_capabilities discovers CLI versions, Antigravity models, and the local Codex model catalog with supported efforts and restrictions. It does not spend a model turn. A cached Codex catalog does not prove current account access.
- delegate_peer requires caller, task, exact model, effort, and selectionReason. cwd, mode, deliverable, and timeoutSeconds refine the work package.
- The lead chooses the model and reasoning effort per operation. No capability tiers, implicit default model, tier environment variables, promotions, or automatic fallback exist.
- Lightweight Codex variants (identified from catalog descriptions and known small/fast model names) and internal approval models are rejected. Mechanical task routing remains the lead's responsibility: use direct tools or Antigravity fast models.
- Antigravity efforts are low, medium, high; a model with an effort suffix must match the requested effort. Codex effort must be present in its catalog for the selected model.

Example after confirming this model in peer_capabilities:

```json
{
  "caller": "codex",
  "cwd": "C:\\Users\\you\\.ai-rules\\peer-agents",
  "task": "Review the explicit model-selection contract. Do not modify files, execute write commands, or delegate further. Return evidence-backed findings.",
  "mode": "REVIEW",
  "model": "gemini-3.1-pro-high",
  "effort": "high",
  "selectionReason": "Independent architectural review needs careful reasoning about model validation and both caller directions.",
  "deliverable": "Concrete defects, evidence, and unverified behavior.",
  "timeoutSeconds": 180
}
```

Reverse direction uses caller=antigravity and an allowed exact Codex model/effort from discovery. model and effort in the response describe explicit CLI arguments; modelEvidence states that the effective backend is not independently attested. The bridge never claims a CLI version is a model.

## Safety and limitations

Depth is capped at one through PEER_AGENTS_DEPTH; delegated Codex sessions also disable their own peer-agents MCP, invalid depth values fail closed, and prompts forbid further delegation. Both tools use the same WorkspaceAuthorizer: AUTO_ACTIVE accepts the trusted host Git workspace, enrolled projects and explicit roots; STRICT_ROOTS accepts explicit roots only. Sensitive paths override grants. See [workspace policy](../docs/architecture/workspace-authorization.md).

READ_ONLY and REVIEW prohibit file changes. Codex uses its read-only sandbox. Antigravity requests plan mode and normal CLI permission enforcement; slash expansion is not disabled because that would disable plan mode in the tested CLI. OS sandboxing is required unless the user explicitly selects `permissions-only`. Plan mode and Git-status comparisons are not complete read-only enforcement. The bridge does not bypass approval prompts. Permission denial is a real limitation to report.

Git status before/after is a supplementary change detector, not a filesystem security boundary. It cannot detect all changes to already-dirty files or non-Git directories. The lead must verify work and must not automatically revert unknown changes.

IMPLEMENT requires a clean Git repository and creates an isolated temporary worktree. The bridge writes Git's binary patch directly under ~/.peer-agents/runs, verifies it with git apply --check, records its SHA-256 hash, and only then removes the worktree. Any export or verification failure preserves the worktree and partial patch. The bridge never applies the patch automatically. The lead reviews and tests integration. Do not ask the bridge to edit global configuration through IMPLEMENT.

Child CLIs receive an allowlisted system environment and provider configuration
location, not unrelated environment secrets. Provider-owned login stores remain
in place. Ambient API-key authentication is not implicitly forwarded. Responses
and diagnostics are sanitized; never put credentials in prompts. The bridge itself
does not install, authenticate, publish or integrate delegated work.

## Install and verify

Requirements: Node.js 24+, Git and the selected provider CLI. The legacy v0.3.0
bridge was tested locally with Codex 0.154.0 and agy 1.2.4; that is not certification
of the new runtime or a requirement to install two agents.

```powershell
Set-Location "$env:USERPROFILE\.ai-rules\peer-agents"
npm ci
npm run typecheck
npm run build
npm test
```

Binary overrides: PEER_CODEX_BIN and PEER_AGY_BIN. The installer supplies absolute executable paths for both. PEER_CODEX_BIN must name a native executable, not a PowerShell or cmd shim.
Optional policy overrides: PEER_AGENTS_ALLOWED_ROOTS (additional explicit scope), PEER_AGENTS_WORKSPACE_MODE (AUTO_ACTIVE or STRICT_ROOTS), PEER_AGENTS_DENIED_ROOTS, and PEER_AGENTS_POLICY_FILE. Root lists use the OS path delimiter. Without a mode, a nonempty legacy allowed-root list remains strict. The default model exclusion policy is peer-agents/policy.json.
Codex discovery reads models_cache.json from CODEX_HOME when configured, otherwise ~/.codex. Missing or invalid catalogs fail closed; refresh model discovery through Codex before delegating.
Antigravity discovery runs agy models for fresh selections.

## Registration

Existing Codex registration in ~/.codex/config.toml:

The installer writes the real absolute path. `C:\Users\you` below is documentation only; neither host expands `%USERPROFILE%` inside MCP arguments.

```toml
[mcp_servers.peer-agents]
command = "node"
args = ["C:\\Users\\you\\.ai-rules\\peer-agents\\dist\\index.js"]
enabled = true
tool_timeout_sec = 1980

[mcp_servers.peer-agents.env]
PEER_CODEX_BIN = "C:\\path\\to\\codex.exe"
PEER_AGY_BIN = "C:\\path\\to\\agy.exe"
PEER_AGENTS_ALLOWED_ROOTS = "D:\\my-project"
```

Existing Antigravity CLI registration is ~/.gemini/config/mcp_config.json:

```json
{
  "mcpServers": {
    "peer-agents": {
      "command": "node",
      "args": ["C:\\Users\\you\\.ai-rules\\peer-agents\\dist\\index.js"],
      "env": {
        "PEER_CODEX_BIN": "C:\\path\\to\\codex.exe",
        "PEER_AGY_BIN": "C:\\path\\to\\agy.exe",
        "PEER_AGENTS_ALLOWED_ROOTS": "D:\\my-project"
      }
    }
  }
}
```

Rebuild, then reconnect/restart each host's peer-agents MCP after upgrading. Confirm peer_capabilities reports 0.3.0, both CLIs are available, and delegate_peer exposes model, effort, selectionReason with no tier input. Already-running servers retain their old code/schema. Old callers fail validation instead of receiving an implicit model.

This migration intentionally breaks the old tier-based delegate_peer contract. Old tier-specific model environment variables are no longer used.

## Shared policy and on-demand tools

Canonical policy: %USERPROFILE%\.ai-rules\MASTER-AGENTS-REFERENCE.md.
Runtime entry files: ~/.codex/AGENTS.md and ~/.gemini/GEMINI.md.

The lead may enable an already-configured MCP needed for the task using the host's supported control, preserving permissions, credentials, and unrelated settings. Verify discovery after reconnect; restore temporary activation when safe. This bridge does not toggle other MCPs or grant authority for their external operations.

## Direct MCP verification

scripts/mcp-call.mjs starts a fresh local bridge and calls a tool through JSON-RPC over stdio. It is useful when an existing host still has an older loaded schema. It does not replace normal host registration.

```powershell
node scripts/mcp-call.mjs peer_capabilities
```

Pass a JSON object as the second argument for a bounded delegate_peer call.

## Antigravity call health

The repaired bridge uses AGY's `--input-format stream-json` / `--output-format stream-json` protocol, tested with AGY 1.2.16. It sends the prompt on stdin and keeps `--mode plan` for read-only calls. It does not combine plan mode with `--disable-slash-commands`, which disables that mode on the tested CLI. Exact model and effort are retained; no automatic substitution or provider-turn retry occurs.

`PEER_AGY_SANDBOX_MODE` defaults to `required` (`--sandbox`). On a machine that cannot provide AGY's OS sandbox, a user may explicitly select `permissions-only` (`--sandbox=false`). This retains the provider's allow/deny/approval rules but is **not filesystem isolation**. Both discovery and delegation results expose the selected mode; unknown values fail closed, and a failed sandbox never triggers automatic downgrade. The installer accepts `-AntigravitySandboxMode` and otherwise preserves the registered choice, rejecting conflicting host settings. Re-enable `required` after installing and verifying the needed OS support.

- Use `AUTO_ACTIVE` with a host that supplies MCP workspace roots (or launches the bridge in the active Git repository). Roots and persistent project enrollment are checked per request, so new active projects need no MCP re-registration/restart. A roots-incapable host launched outside Git cannot safely infer its active project from tool arguments; see the workspace-policy limitations. Static roots remain optional explicit scope, not mandatory per-project setup.
- Antigravity must separately trust the named project and permit its required reads/commands. Preserve Git mutation denials for review. Never solve this by trusting an entire drive or enabling a blanket permission bypass.
- Windows can require full-line `command(regex:...)` matches and a separate `unsandboxed` grant. The installer's explicit `-GrantAntigravityInspection` option permits only enumerated Git inspection lines (for example, `git status --short`), anchored at both ends for both action types. These provider rules are global, not bound to project directories. Deny/ask rules still take precedence. Shell chains, arbitrary flags, write commands and global `command(*)` / `unsandboxed(*)` are not granted. See the [official permission documentation](https://www.antigravity.google/docs/permissions?tab=cli).
- Filesystem rules must use supported literal paths such as `read_file(D:\my-project)`, not `read_file(regex:...\\.*)`. The latter can prevent terminal sandbox construction even when a command itself is permitted. Validation flags this configuration error.
- `peer_capabilities({cwd: project})` reports workspace readiness without a model turn. `invocationProtocol: antigravity-stream-json-stdin-v1` identifies the new bridge. Discovery reports `AVAILABLE`, `TIMEOUT` or `UNAVAILABLE`, with observation time/cache status; an empty catalog is not interpreted as an unsupported user-selected model.
- A complete terminal result is required. Missing/empty/malformed/truncated results, denied permissions and provider failures cannot masquerade as successful reviews.
- After an upgrade, reconnect the host MCP or restart that host. An already-running server retains old code and launch environment. A successful fresh-process probe does not prove an existing chat reloaded it.
- Provider outages, expired authentication and exhausted quota remain real failures, not conditions the bridge can truthfully guarantee away.

Regression checks: `npm run build`, `npm test`, and (from the repository root) `pwsh -File scripts/test-peer-roots.ps1`. A real read-only provider call is still required to verify account access; the test suite uses deterministic protocol checks, not paid model calls.

Run `node scripts/doctor-antigravity.mjs --cwd <absolute-project> --model <exact-model> --effort <effort> --verify` from this package directory for an opt-in live check. It requires provider tool-event evidence and a generated file proof, not merely the model claiming success. An explicit `--sandbox-mode permissions-only` accepts the non-isolated mode; default remains `required`. It never changes provider settings or authenticates automatically. See the root README for scope and cleanup details.

Both the compatibility bridge and experimental runtime use the same Antigravity command builder and parser. A `DONE` tool event can still carry an error; permission/sandbox errors and denied actions cannot be masked by terminal `SUCCESS`. Other tool failures remain visible on bridge results and prevent experimental runtime review acceptance. Runtime adapter configuration accepts explicit `sandboxMode`; model-only runtime verification labels tools as unverified.

Local evidence (2026-10-07): Windows x64, Node 24.18.0, AGY 1.3.1, `gemini-3.1-pro-high` / `high`, explicit `permissions-only`: fresh-process bridge delegation passed the fixture read/proof, exact Git-status command, command-workspace evidence, and observed Git-root checks with zero reported tool failures. This used an existing provider account and permissions; it is **not** a clean-install or cross-platform certification. A separate source-review consultation hit its 180-second timeout, so tool readiness does not imply every consultation will complete within a chosen deadline.

AGY 1.3.1's observed command events contain only `CommandLine`; the initial session event records the working directory. The parser uses that initial directory only when the tool does not provide an explicit `Cwd`. Invalid explicit overrides, duplicate/late session initialization, missing directory evidence, or a mismatched Git-root query cannot pass readiness. No raw command output or file content is exported as tool evidence.
