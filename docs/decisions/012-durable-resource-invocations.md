# ADR-012 — Durable resource invocation fencing

## Status

Accepted for the development runtime on 2026-11-18. Extends ADR-002 and ADR-004.
Implemented locally; live-provider and cross-platform certification remain separate.

## Decision

Before a resource-bound provider call, commit an invocation intent to the existing
environment database. Bind it to the selected resource scope, catalog revision,
verification digest and expiry. Check the observation and resource policy in the
same SQLite transaction. Reject another pending call for that exact scope.

Keep intents and completions in append-only, checksum-validated tables. Store
opaque invocation/task hashes, an operation UUID, owner PID and timestamps; never
store prompts, credentials, working paths or raw provider responses. Successful
calls preserve the original verification and its expiry. Failure feedback must
persist or be demonstrably superseded before a completion can release the fence.
An ignored failure write cannot leave the original usable proof behind.

The first reservation upgrades the **environment** schema from 1 to 2 atomically
with journal creation and intent insertion. New environment readers accept 1/2.
Older readers reject newly opened version-2 state. Do not mix running old and new
processes against upgraded state: open-time version checks cannot retrofit old
processes. Task-schema migrations, including evidence archival, remain independent.
The separate workspace-enrollment database is unchanged.

## Interrupted calls

Process termination or completion-write failure leaves the intent pending. Routing
and resource doctor both report `INVOCATION_PENDING`, including after restart or
verification expiry. Fresh verification alone does not erase it. No timeout,
retry, lease expiry or startup cleanup assumes that external work did not occur.
Resource-bound integrations lacking the journal report `INVOCATION_STATE_REQUIRED`.
Legacy unbound adapters retain their existing behavior and do not gain this guarantee.

Trusted operator library code can inspect pending records and reconcile one exact
intent. Reconciliation requires:

- Its original identity/digest and an opaque reconciliation-evidence hash.
- An absent original owner process. A live/reused PID or uncertain probe blocks it.
- Current, verified evidence observed after the intent began, for its exact scope.
- The trusted caller's prior reconciliation of child processes and task artifacts.

PID absence cannot establish child-process quiescence. The evidence hash is a
reference supplied by trusted runtime code, not independent proof of human origin.
Therefore reconciliation is **not** exposed through CLI/MCP or model tools. A
certified process/artifact collector and operator surface remain future work.
Repeated reconciliation with the same evidence is idempotent; changed evidence or
outcome conflicts. Recovery never resumes a task, applies a patch or grants approval.

## Consequences

This closes the durable eligibility gap for resource-bound calls, including the
window after provider completion but before feedback persistence. It does not
claim exactly-once external execution, automatic task recovery, provider account
binding, or live-session certification. Existing task resume refusal and worktree
preservation remain necessary. Unexpected process death requires explicit recovery.

Scope remains worker/binding/role/effort/frontend/configuration, not an account-wide
quota lock. Corrupt or unwritable state fails closed. Journal records are retained;
compaction and pruning are deferred. Downgrade requires compatible state recovery,
not deleting pending records or changing the schema version by hand.
