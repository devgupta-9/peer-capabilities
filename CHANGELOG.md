# v0.3.0 — 2026-09-24

- Export IMPLEMENT patches directly through Git, verify them before cleanup, hash them, and preserve recovery artifacts on failure.
- Require delegated workspaces to be Git repositories inside explicit or session-derived allowed roots; delegated Codex sessions disable peer-agents recursively.
- Register a native `PEER_CODEX_BIN` and validate `peer_capabilities`, including launchability of both peer CLIs.
- Make Codex model exclusions portable through `peer-agents/policy.json`.
- Make strict Antigravity safety enforcement explicit, backed up, documented, and optional through `-SkipAntigravitySafety`.
- Pin the one-command bootstrap to the `v0.3.0` release and document managed MCP, plugin, and skill ownership.

## Earlier local consolidation — 2026-09-24

- Consolidated shared policy ownership, platform bootstraps, orchestrator guidance, and 100 curated skill sources into this local origin.
- Retired the duplicate %USERPROFILE%\.gemini\config\AGENTS.md to the non-secret backup directory after preserving its safety requirements in the master.
- Removed hard-coded authenticated/reachable claims, mandatory delegation pipelines, and false automatic Headroom skill selection claims.
- Unified Graphify's Windows instructions and local-first/privacy behavior.
- Updated Antigravity Jev args from %USERPROFILE%\.ai-rules\tools\jev\dist\index.js to %USERPROFILE%\.ai-rules\tools\jev\node_modules\@jkudish\jev-mcp\dist\index.js.
- Added PEER_AGY_BIN to both peer-agents registrations. The original consolidation intended to preserve PEER_CODEX_BIN, but the first public installer did not; v0.3.0 now resolves and registers a native Codex executable explicitly.
- Antigravity review settings changed from ARTIFACT_REVIEW_MODE_TURBO, CASCADE_COMMANDS_AUTO_EXECUTION_EAGER, and BROWSER_JS_EXECUTION_POLICY_TURBO to ALWAYS, OFF, and ALWAYS_ASK respectively. Other UI settings and sandbox settings preserved.
- CLI safe-command regex grants narrowed to command-prefix grants. Broad trustedWorkspaces C:\WINDOWS\system32, %USERPROFILE%, and D:\ replaced with verified named project roots. Existing deny rules retained.
- Main-model defaults, remote authentication, production resources, project source, and vendor-managed binaries/plugins were not changed.

Rollback runtime edits only if intentionally restoring those previous behaviors. Do not restore blanket trust/review bypass merely to suppress prompts. Restore non-secret documents from %USERPROFILE%\.ai-rules-backups\20260924-sync-repair when needed; preserve newer work.
