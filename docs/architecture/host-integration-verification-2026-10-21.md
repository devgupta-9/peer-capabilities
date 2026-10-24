# Host integration readiness: verification and handoff

Status: local development deployment; not an npm release, merge, or cross-platform certification.
Source: `phase1-runtime`, based on `f076a6f`, plus the uncommitted readiness changes.

## Delivered

- Parsed, scoped host configuration reconciliation with hash-bound preview/apply, private backups, durable operation records, conflict refusal and rollback.
- Independent Codex, Antigravity CLI, Antigravity IDE, Claude Code and Claude Desktop registrations. Existing permissions, disabled flags, environment overrides and unrelated settings are preserved.
- Optional REA 6.5.0 dependency lock and registration; REA is not required by default setup. No additional native analysis engines were installed.
- Jev launcher with named provider-environment forwarding and byte-preserving stdio. No credentials are written into the manifest or command arguments.
- Per-host/component deployment observations so partial updates do not change expectations for untouched integrations. Doctor scopes probes and required checks to selected hosts.
- A thin Claude Code bootstrap, updated shared routing guidance, and conditional REA/Jev/Graphify/Headroom usage. Native REA skills remain vendor-owned, not redistributed in this repository.

## Deployment and recovery

The installed development archive has SHA-256:

`4aa53d2d12fcbeda73c7ed6e323f00454d8e6ab805ee9e156d21b4ad5b39fa76`

It is installed under `%USERPROFILE%\.peer-capabilities\runtime-releases\4aa53d2d12fcbeda\node_modules\@devgupta\peer-capabilities`.
The old runtime remains available. Five host profiles were updated by operation
`10688214-4a8d-44da-b7b2-cab7056c806f`; an immediate repeat preview was empty.

Nine scoped deployment-support files were promoted to the live rules origin with backups. The origin's own sync deployed three rule files, retained all 218 managed skill files, and now tracks 232 files. This was not a full synchronization of the original checkout or a rerun of its legacy installer.

Host rollback uses `scripts/sync-hosts.ps1 -RuntimeRoot <installed-runtime> -Rollback <operation>`.
Backups/journal remain private under `%USERPROFILE%\.peer-capabilities\host-configuration`.
Rule-origin backups are under `%USERPROFILE%\.ai-rules-backups`; do not export them.
Rollback refuses to overwrite later user edits.

## Verification evidence

- Final complete Node suite: **175 passed, 0 failed**. Log: local ignored `reports/host-readiness-tests-final.log`.
- Doctor regression suite: **3 passed**, including Claude-only operation, unselected-host isolation, partial deployment observations and rollback exclusion.
- Build/type compilation, PowerShell parsing, CI fail-fast regression tests, synchronization safety tests and `git diff --check` passed.
- Runtime and REA dependency audits reported **0 vulnerabilities**. Secret scan passed; fixture canaries are synthetic, not provider credentials.
- Installed host-configuration and resource-contract modules match the built source by SHA-256.
- Final live doctor on 2026-10-21: **PASS, 23 probes, 0 errors, 0 managed-file drift**, with the three pre-existing safety warnings retained. An earlier run reported Antigravity CLI availability failure under Codex; current in-chat capability discovery and the final live doctor both succeeded. Discovery is not authenticated delegation.
- This Codex chat successfully invoked REA `binary_session`: version 6.5.0, aligned installed path, 207 tools, no target opened and no analysis started.
- This chat successfully invoked Jev's no-candidate extraction path without a provider request. A bounded authenticated Jev decision call had also passed during the preceding deployment work; that earlier call is not a fresh authentication check for every host.

A separate Codex reviewer found host-selection, optional-REA and partial-deployment defects, plus a Zod partial-record regression. These were fixed and covered by regression tests. Antigravity independent review was unavailable because its headless invocation required permission; no permission bypass was added.

## Remaining boundaries

- Existing app conversations need reconnect/reload and an in-session check. Current-chat verification here does not certify Claude Desktop, Claude Code or Antigravity sessions.
- Existing Antigravity review-policy/CLI deny-rule warnings remain visible and unchanged. Real Antigravity delegated review remains unverified.
- ChatGPT web/remote connectors are not configured by local stdio registrations. Claude is not yet a supported peer-bridge caller.
- Graphify has no graph for this development repository yet. Headroom proxy health/configuration does not prove proxy routing for every host.
- Ghidra/IDA/JADX and other optional engines are not made available merely by installing REA.
- Scheduler consumption of resource observations and governed, task-specific integration invocation are the next implementation slice. Tools are not forced into irrelevant tasks.
- Three-platform GitHub CI has not been run for these uncommitted changes. Nothing was committed, pushed or published during this increment.

See [operator guide](host-integration-readiness.md) and [ADR 009](../decisions/009-host-configuration-reconciliation.md).
