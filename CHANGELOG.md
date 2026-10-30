# Unpublished development — 2026-10-30

- Add read-only scoped resource doctor with shared dispatch eligibility checks.
- Add trusted verification coordination: durable pending state, exact context/check validation, cancellation and conditional completion. Real provider collectors remain gated pending context-binding certification.
- Persist exact-scope invocation failures, preserve newer observations, and block dispatch when failure feedback cannot be stored. Successful task calls do not renew proof.
- Preserve failure-feedback outcomes in task/review history; retain compensating verification for recorded reviewer outages.
- Deploy the private runtime to existing local peer-bridge hosts with verified backups. Repair one stale Antigravity IDE Codex executable reference; retain all permissions, credentials and optional-runtime settings.
- Windows release verification: 235/235 tests passed. This remains private `0.4.0-dev.0`, not an npm publication or live-provider certification.

# Unpublished development — 2026-10-24

- Add scoped, previewed host configuration reconciliation with backups, rollback, and preserved host permissions and credentials.
- Share task-based optional-tool recommendations across the CLI, MCP, delegated prompts and runtime context; recommendations do not execute tools or grant authority.
- Remove redundant Antigravity catalog discovery from exact pinned delegation; retain provider validation, explicit failures and no model substitution.
- Consume opt-in exact resource observations in scheduling and dispatch, including expiry, configuration invalidation and durable assignment provenance. Live scoped collectors remain pending.
- Pin Zod 4.6.7 in the bridge and override REA 6.5.0's vulnerable Zod pin; upgrade the isolated Jev runtime to 0.14.5 and refresh REA's fast-uri lock. Preserve Jev's explicit `JEV_MCP_MODEL` setting through its launcher.
- This remains private `0.4.0-dev.0` development work, not an npm publication or production/platform certification.

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
