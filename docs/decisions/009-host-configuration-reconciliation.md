# ADR 009: Scoped host configuration reconciliation

Status: Accepted for the readiness slice.

## Decision

Use the shared registration manifest and a portable parsed JSON/TOML reconciliation core behind explicit local setup. Reuse canonical directory identities, the environment-domain SQLite helper and hash preflight. Journal metadata separately from task state; retain private local backups, not secret-bearing configuration in the database. Preserve unrelated host state and disabled integrations.

Jev uses a packaged Windows stdio launcher that forwards only named existing provider environment values, including user-scope fallback for hosts with filtered/stale environments. Credentials remain provider-owned. Claude surfaces receive optional MCP registrations but do not impersonate a Codex/Antigravity bridge caller.

## Alternatives and consequences

Remove/re-add registration can discard permissions and is rejected. Regex TOML modification is unsafe around quoted tables and multiline strings; pinned `smol-toml` adds a small dependency and can reformat comments, with semantic round-trip checks and recoverable originals. Global forced tool use is rejected: relevance, availability and observed evidence must govern later runtime integration. Local setup does not imply remote/web support or active-session reload.

See [implementation and operator instructions](../architecture/host-integration-readiness.md). This extends ADRs 003, 004 and 008; it does not supersede their authority or credential boundaries.
