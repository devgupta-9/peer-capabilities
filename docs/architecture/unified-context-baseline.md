# Unified Context baseline

Status: locally implemented slices under the accepted Phase-1 plan and ADR-005.
The resource lifecycle was deployed on 2026-10-30. Real provider collection remains
gated independently; this slice does not depend on Graphify, Headroom or Jev.

## Current slice and acceptance

1. Validate complete evidence identity, content and provenance on reads. Reject
   missing/corrupt evidence before accepting or replaying a linked decision.
2. Append evidence-backed decisions and explicit supersession/staleness events;
   update canonical task projections in the existing transaction. Preserve legacy
   task replay without rewriting history or introducing another writable authority.
3. Hydrate lead/reviewer packages with current decisions and required evidence.
   Invalidate decisions against the actual dirty-state repository fingerprint.
   Retain stale decisions as labelled material requiring reconsideration; avoid
   treating superseded statements as current instructions.

Verification: deterministic store/context regressions, fixture runtime dispatch
and restart, then the complete Node suite, build, publication scan and package check.

## Implemented behavior

The trusted `TaskStore.acceptDecision(taskId, expectedRevision, value)` operation
requires a new UUID, statement, exact repository fingerprint and one or more
existing evidence IDs. Evidence must identify the same snapshot. Optional
`supersedes` references one active or stale predecessor. Its transition and the
replacement's acceptance are one event/projection transaction. Reusing an ID,
replacing an already superseded decision or supplying stale task revisions fails.

`DECISION_ACCEPTED` projects `ACTIVE`; `DECISIONS_INVALIDATED` projects `STALE`;
accepting a replacement projects the predecessor as `SUPERSEDED`. Source rollback
does not reactivate either state. These are engineering lifecycle states and do
not imply an independent review or a human authorization.

`readEvidence` checks its complete record shape, content hash, requested/embedded
ID and the content-addressed identity over text, source, version and classification.
Collection time is validated metadata, not an independently attested timestamp.
Decision append, task replay and ordinary reads of a decision-bearing task validate
linked evidence. A missing/corrupt historical record blocks further mutations and
rebuild instead of silently losing provenance.

Before lead hydration and after lead verification, the runtime compares decisions
with the isolated worktree's actual fingerprint. It repeats the check before reviewer
hydration. This includes dirty content and supports tasks with only one agent.
Source sampling is a snapshot; existing repository leases do not prevent arbitrary
external processes from editing files, and this increment adds no OS sandbox.

Agent packages contain active/stale decisions with mandatory linked evidence;
superseded history contains IDs/status/replacement references. Stale statements
remain visible as claims requiring reconsideration. Acceptance events in the
package carry references without duplicate historical statements; `sourceEventHash`
locates their original immutable event, rather than claiming the projected payload
is the original hash preimage. Full durable history remains available for audit.
Required evidence never becomes optional to meet a context ceiling. An oversized
package returns `INSUFFICIENT_CONTEXT` with the existing split/retrieval guidance;
the task is durably blocked before dispatch and its worktree/evidence are retained.
Linked evidence in the package carries source/version/classification/content hash;
its content-addressed identity is rechecked and duplicate IDs are rejected.

## Compatibility and scope

No new database or parallel store was introduced. Existing tasks retain their old
projection shape until their first decision event, and replay does not rewrite
earlier events. Old binaries cannot replay new decision event types; do not run
mixed/downgraded runtimes against decision-bearing task state without a compatible
recovery plan. Missing evidence cannot be reconstructed from a decision statement.

The authoring surface is currently the trusted runtime library. The existing task
context surface exposes canonical state; runtime/CLI status reports expose
`engineeringDecisions` separately from human approvals. Native/CLI decision-authoring
workflows remain deferred. Agent output does not automatically accept a decision.

## Contract boundary

Decision acceptance is a trusted runtime/library operation with optimistic revision
checking, not a new agent-callable approval surface. Engineering decisions cannot
authorize integration, deployment, credentials or billing. Supporting evidence is
provenance, not an automatic claim that the decision is correct or independently
reviewed. Existing signed human gates and integration boundaries remain in force.

The initial dependency boundary is a complete repository snapshot, including dirty
state. Any snapshot change conservatively marks affected snapshot-bound decisions
stale; finer file/claim dependency tracking is later work. Explicit replacement
needs a new decision ID and evidence for the new snapshot. Restoring old source
does not silently reactivate stale or superseded decisions.

Physical archival/compaction, semantic extraction, live session deltas, optional connectors
and native decision-authoring interfaces remain later increments.

## Review and follow-up

Local review covers event/projection atomicity, restart/legacy compatibility,
evidence integrity, context/source consistency and approval boundaries. A bounded
inline AGY review using `gemini-3.8-flash-high` with high effort timed out on
2026-11-08. No retry, substitution or independent approval is claimed.

This increment does not address the resource invocation crash window documented
in the previous slice, provider account binding, or hostile concurrent filesystem
writers. No live configuration, credentials, deployment, commit or push changed.

## Verification — 2026-11-08

Windows / Node 24.18.0 build and full suite passed **246/246** tests. Eleven new
regressions cover transactional acceptance/supersession, restart/rebuild, strict
evidence links, provenance/content corruption, explicit invalidation and rollback,
protected context, actual lead/reviewer hydration, single-agent checkpoints,
secret/forged inputs, legacy projection compatibility, atomic bulk invalidation
and durable context-budget failure before dispatch.

Current-content secret scan: 172 tracked/untracked files, zero findings. Production
dependency audit: zero vulnerabilities. Package dry-run: 91 files including the new
decision module/source map. Whitespace checks passed. This is local deterministic
evidence; remote CI, live provider behavior and desktop activation are not claimed.

## Selective retrieval and retention planning — 2026-11-10

The runtime derives evidence scope from validated task events. The trusted library
can append `EVIDENCE_LINKED` with an existing evidence ID and an optional `mandatory`
flag. Acceptance and replay validate the record. Task queries include observed test
results, lead reports, decision support, explicit links and stored context evidence.
Historical context hashes that identify external patches retain their locator role.

The deterministic `lexical-v1` selector ranks optional evidence by Unicode word
overlap, then event sequence and evidence ID. Only current-snapshot, explicitly
linked optional evidence or lead reports enter automatic hydration. Active/stale
decision support, observed tests and explicitly mandatory links always enter the
required set. Superseded-only support remains retrievable through history. Packages
record omitted IDs, and allocation accounts for omission metadata and the package
hash before adding optional bodies. Source versions remain attached to evidence.

CLI and MCP expose metadata queries and exact record reads. Queries have bounded
pages and byte budgets. Their cursors bind the task revision and query parameters.
A changed revision requires restarting pagination. Exact reads verify task scope,
provenance and content identity, and reject oversized responses with
`INSUFFICIENT_CONTEXT`. Callers can increase the retrieval budget or split their
consultation. This baseline loads task-linked records locally for lexical ranking.
Indexed retrieval and automatic iterative agent consultations remain future work.

`retention` derives a repository-wide `references-v1` report in a consistent SQLite
transaction. Current obligations propose HOT, historical/optional references propose
WARM, and unreferenced records propose COLD. Shared evidence receives the strongest
obligation across tasks. Every referenced record is protected, including superseded
decision support and prior context packages. Corrupt or missing stored evidence
blocks the report. External patch locators are listed separately.

This increment deliberately implements retention planning. Physical storage stays
HOT and `deletionAllowed` is false. Archive movement, compression, deletion and
event compaction need a separately verified recovery workflow. Immutable events,
approvals and artifacts remain available for replay and reconciliation.

The task database remains the authority, with its existing schema and transaction
boundary. Earlier tasks use their existing events for scope discovery. Older
binaries cannot replay the new `EVIDENCE_LINKED` event. Deploy a compatible runtime
before using new event types, and preserve database backups for rollback.

Jev recommended the retention-plan boundary. Its subsequent diff review returned
low confidence on coverage and application safety, without a concrete defect trace.
Local source review and regression checks provide the implementation evidence.
Headroom processed the large suite log and reported zero token savings for that
input. The Graphify project query reported a missing index, so implementation
relationships were checked against source.

Fresh AGY discovery listed CLI 1.5.3 and `claude-sonnet-4-6`, with a bridge-wide
`high` effort option. The bounded inline review was rejected because that model
does not support `--effort`. This exposed a catalog-to-invocation mismatch and
provided no independent assessment. No model substitution was attempted.

## Verification — 2026-11-10

Windows / Node 24.18.0 build and the full suite passed **254/254** tests. Eight new
regressions cover task scoping, ranking and revision pagination, exact Unicode
retrieval/reopen, required evidence selection, query byte limits, protected/shared
retention, corruption, package allocation and CLI dispatch. Expanded MCP checks
exercise query/read and explicit oversized-response errors. Publication scanning
checked 174 files with zero findings, the production audit reported zero
vulnerabilities, and the package dry-run included 93 files with both new modules.
The implementation commit `d383513` subsequently passed remote Windows, macOS and
Linux CI and was deployed locally under explicit user authorization. Live session
qualification remains pending. [Deployment record](local-deployment-2026-11-10.md)
