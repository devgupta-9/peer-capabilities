# Local development deployment — 2026-10-30

Scope: private `0.4.0-dev.0`, branch `phase1-runtime`, under explicit authorization
to deploy, commit and push. No npm publication, main merge or provider enrollment.

## Shipped scope

- Read-only scoped resource doctor using the same eligibility checks as dispatch.
- Trusted collection coordinator with pending state, bounded completion and exact
  context/check matching. No real provider collector is registered.
- Exact-scope invocation failure persistence, conditional updates and task-visible
  storage failure. Success does not renew proof; quota failures do not imply logout.
- Provider-context audit and maintained implementation/reference documentation.

See the [resource contracts](identity-resource-contracts.md) for implemented behavior
and [provider-context audit](provider-context-audit-2026-10-29.md) for activation gates.

## Artifact and deployment

Package SHA-256:
`6275098ba8a7e3cbaf4240beabe1ccb82480028d1a2d60622b23b509d798162a`.

Installed runtime:
`%USERPROFILE%\.peer-capabilities\runtime-releases\6275098ba8a7e3cb\node_modules\@devgupta\peer-capabilities`.

All 89 package files match the tested source/build bytes. All four installed
production dependencies match the repository lock's versions and integrity hashes.
Install scripts were disabled. The package remains development-only; its version
command reports `releaseSupported: false`.

Operation `2c51c79f-1766-4d18-91bb-8e9159bad976` updated only the peer bridge's
argument array in Codex, Antigravity CLI and Antigravity IDE. The preview digest
was checked before apply; all three original-file backups match their preview hashes.
A repeated preview had zero changes.

The first post-deployment doctor found an existing stale `PEER_CODEX_BIN` in the
IDE configuration. Fresh bridge discovery worked through fallback, but the configured
binary no longer existed. Operation `ebc35290-8eac-4e7c-a0f6-1918397e3bdc` updated
only that IDE environment entry to the existing verified native executable already
used by Codex. Its separate original-file backup was hash-verified.

Semantic comparisons against the original configurations confirm the only changes
are those three argument arrays and the IDE executable reference. Credentials,
permission rules, disable flags and unrelated settings are preserved. Protected
Antigravity permissions and both Claude configuration files have unchanged hashes.
Jev/REA/Graphify/Headroom launch settings were not changed; the older release tree
remains necessary for their existing paths and must not be removed indiscriminately.

## Recovery

Both operations retain local backups under
`%USERPROFILE%\.peer-capabilities\host-configuration\<operation>`.
The host reconciler checks current hashes before rollback. Inverse operations must
be applied in reverse order: executable repair first, runtime switch second.
Use `scripts/sync-hosts.ps1 -RuntimeRoot <installed-package> -Rollback <operation>`.

Those exact inverse operations also restore the known stale IDE executable entry.
Prefer a reviewed forward reconciliation to the retained older runtime while keeping
the valid executable reference. Do not overwrite later host edits or credentials.
Older runtimes cannot read the new `INVOCATION` evidence method; do not downgrade
resource-bearing state without a compatible runtime/state recovery plan.

## Verification and limits

- Clean dependency install, build and full Windows suite: **235/235 passed**.
- Current-content and fetched reachable-history secret scans passed.
- Bridge, Jev, REA and the installed bridge production audits: zero vulnerabilities.
- Installed CLI version and read-only missing-state doctor smoke passed; the latter
  created no state directory or database.
- Package byte/dependency verification, host backup checks and semantic preservation
  checks passed.
- Final fresh-process host doctor after the scoped IDE repair: **23 probes, 232
  managed files, zero drift and zero errors**. Three existing warnings remain:
  Antigravity artifact/auto-execution review-setting mismatches and the CLI
  mutating-Git deny-rule warning. Settings were not rewritten to suppress them.

Local review completed; no independent peer approval is claimed for these increments.
GitHub verification runs against the pushed commit separately. Local tests and
tool discovery do not certify remote accounts, provider context, paid inference,
native REA backends or existing desktop sessions.

Already-open hosts must reconnect their MCP servers or open a new session to load
the new runtime. This upgrade reload is separate from ordinary new-project workspace
authorization, which does not require per-project re-registration.
