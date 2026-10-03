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

Depth is capped at one through PEER_AGENTS_DEPTH; delegated Codex sessions also disable their own peer-agents MCP, invalid depth values fail closed, and prompts forbid further delegation. Every delegated directory must be a Git repository inside PEER_AGENTS_ALLOWED_ROOTS, or inside the repository that launched the MCP server when no roots are configured.

READ_ONLY and REVIEW prohibit file changes. Codex uses its read-only sandbox. Antigravity requests plan mode, sandbox, and normal CLI permission enforcement, with slash expansion disabled for read-only work. The installed agy CLI warns that plan mode has no effect with slash expansion disabled: do not treat plan mode as an enforced read-only boundary. Normal permissions and explicit no-write instructions still apply. The bridge does not bypass approval prompts. Permission denial is a real limitation to report.

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
Optional policy overrides: PEER_AGENTS_ALLOWED_ROOTS and PEER_AGENTS_POLICY_FILE. The default model exclusion policy is peer-agents/policy.json.
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
tool_timeout_sec = 1860

[mcp_servers.peer-agents.env]
PEER_CODEX_BIN = "C:\\path\\to\\codex.exe"
PEER_AGY_BIN = "C:\\path\\to\\agy.exe"
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
        "PEER_AGY_BIN": "C:\\path\\to\\agy.exe"
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
