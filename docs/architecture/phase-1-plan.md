# Peer Capabilities: Phase-1 architecture and staged release
Status: accepted design, implementation in progress. Approved 2026-09-26.
Baseline: `3bce3a4` / v0.3.0. See [original brief](../product/phase-1-brief.md),
[ADRs](../decisions/README.md), and [implementation evidence](implementation-status.md).
The original planning-only restriction is historical; implementation has now been authorized.
No publication, push, or host-configuration deployment is implied.

## Maturity and truthful support
- CURRENT v0.3.0 BEHAVIOR: two-agent Codex/Antigravity bridge, Windows installer,
  policy sync, registrations, probes; 19 baseline tests. Not portable certification.
- PLANNED TECHNICAL PREVIEW: public 0.x npm runtime; generic N-agent adapters;
  deterministic routing; single-agent, review and degradation; SQLite restart;
  Unified Context baseline; safe Git; manifest setup/doctor; real Codex and
  Antigravity on explicitly certified combinations; deterministic third adapter.
- PLANNED BETA: progressive Claude Code, Grok, Gemini CLI, OpenCode and platform
  certification; environment maintenance and thin native host integrations.
- LONG-TERM / GA: production-quality advertised matrix and maintenance commitment.
- R&D: context sufficiency, compression, semantic knowledge and marginal review value.

Architecturally supported, adapter implemented, platform certified, and release
supported are distinct properties. Certification records OS, architecture, CLI
version, authentication mode, tested capabilities and evidence. A deterministic
adapter is not a real third integration. Windows live certification comes first;
core/simulated tests target Windows, macOS and Linux. There is no 18-combination
gate before public npm. One capable agent is sufficient; two are recommended when
useful; N are dynamically assigned lead/reviewer/specialist/consultant roles.

## Runtime boundaries
One local TypeScript runtime: governance; execution; task context; environment
management; repository operations; host integration; optional integrations.
No distributed service, cloud synchronization or proprietary inter-agent protocol.

CLI and MCP call the same runtime. Native skills/plugins and future compatible
surfaces remain thin interfaces. They never duplicate scheduler/context/governance.
Host-owned conversations retain their main model. Runtime-owned tasks may reassign
at safe checkpoints. Keep legacy peer_capabilities/delegate_peer exact contracts.
Version new task operations. No agent-callable human approval.

## Persistence and authority
Require Node >=24; initially certify Node 24. Native node:sqlite is isolated behind
an internal persistence boundary. JSONL is export only.
Append events and update canonical projections in one SQLite transaction;
rebuild projections from supported event history. Optimistic revisions, task
execution leases and repository mutation leases guard competing writers.
Read-only consultations may run concurrently within budget.

Environment DB: observations, authentication/verification, ownership ledger and
operation journal. Per-repository task DB: events, state, findings, decisions,
evidence, checkpoints, approvals and metrics. Independent domain/migration
versions; no cross-database transaction. Assignments record manifest digest and
environment snapshot; changed environment requires revalidation, not history edits.

Records:
- Event: schema, ID, sequence, actor, task/repository, time, type, expected revision,
  causation, classification, typed payload and evidence references.
- Canonical task: objective, requirements, phase/status, assignments, decisions,
  unresolved findings, verification/review/gates, dirty-state fingerprint,
  context revision and cursor.
- Evidence: hash, source/version, collection method/time, classification, retention.
- Checkpoint: agent/invocation, optional session, acknowledged package hash/cursor,
  context/policy/graph/repository versions.
- Context package: role/question, constraints, current state, relevant accepted
  decisions/events/evidence, explicit omissions, allocation inputs and hash.
- Approval: human-origin evidence, exact operation digest, artifact/repository
  revision, scope, expiry and consumption.
Agent claims are not independently observed tests. Validate structured results.

## Environment Manifest
Manifest = desired state. Ledger = resources actually managed. Observations =
current timestamped machine evidence. Schema-versioned, validated, auditable,
secret-free components cover agents/adapters, MCPs, skills/plugins, engineering
and security policy, orchestrator/runtime, managed files and optional integrations.
Stable IDs, exact artifact/version/integrity, platform selectors, dependencies,
non-secret configuration and reviewed recipe IDs. Managed files carry content
reference, destination template and ownership behavior. No arbitrary shell script
recipes, credentials or authenticated URLs. Machine paths belong to observations/
ledger. Every applied revision has a digest. integrations.json is migration input,
not a permanent competing desired-state authority.

Manifest + ledger + actual machine -> inspectable reconcile plan -> journal before
effects -> apply -> verify -> ledger. setup discovers/selects/applies; doctor reports
drift/authentication/certification; update proposes new resolved manifest;
sync only managed files, not unrelated upgrades; repair preserves user edits;
rollback uses prior manifest/ledger/backups and admits nonreversible external effects;
uninstall only selected owned resources, preserving credentials/user changes/history.
Pre-existing resources are not silently adopted. Interrupted operations reconcile
actual state; upstream installers are not claimed atomic. Each managed component
type needs its own safe recovery path before release.

## Authentication
Provider-owned login and stores only; never copy credentials.
Orthogonal states:
- Presence/configuration: DISCOVERED, INSTALLED, CONFIGURED (remote install N/A).
- Auth: UNKNOWN, NOT_REQUIRED, AUTH_REQUIRED, AUTHENTICATED.
- Verification: UNVERIFIED, VERIFIED, UNAVAILABLE.
Installed does not mean authenticated or verified. Discovery does not prove account
access. Record component/adapter/version/config digest, method/time, reason,
verification scope/evidence, expiry and opaque reference. Official login invocation
or instructions, then harmless verification. Unknown remains unknown. Availability
and quota observations never erase engineering findings.

## Scheduler
Deterministic, no learned routing in the first release:
1. Explicit choices and hard policy.
2. Competence, role, tools, certified capabilities, privacy, usable context.
3. Authentication, availability, quota/cooldown.
4. Strongest appropriate available model for complex synthesis.
5. Cheapest sufficiently capable model for bounded consultation.
6. Configured latency/cost preferences and stable ties.
Agent, provider and quota pool are separate identities. Free is cost, not competence.
Collect local empirical metrics; human-maintained capability profiles initially.
No silent replacement of exact user selections.
Normalize AVAILABLE, AVAILABLE_LIMITED, QUOTA_LOW, RATE_LIMITED, QUOTA_EXHAUSTED,
AUTH_REQUIRED, MODEL_UNAVAILABLE, SERVICE_UNAVAILABLE, TIMEOUT, CLI_UNAVAILABLE,
POLICY_BLOCKED, EXECUTION_ERROR. Never invent quota percentages.

FAST/STANDARD are workflow presets, not model classes. FAST prefers fewer calls,
lower latency and conservative quotas; STANDARD deeper justified evidence/review.
Same safety and minimum evidence. Strong Codex may lead FAST engineering; no
Codex lightweight/mechanical workers. Default review: initial plus one re-review;
more requires a specific material question and budget.

## Adaptive Unified Context
Usable input = model window - session occupancy - host/system overhead - output
reserve - tool-result reserve - safety margin. Allocation depends on mode, role,
complexity, evidence, model/cache capabilities and remaining task budget.
Version configuration, reserve profiles and estimates; record all inputs.
Configured ceilings are defaults, not permission to omit mandatory evidence.
Unknown capacity uses tested conservative adapter profiles, explicitly estimated.
If mandatory evidence cannot fit: coherent split, iterative retrieval or explicit
insufficient-context result. Caching does not prove retention or enlarge a window.

Invariants:
1. Source truth outranks remembered context.
2. Unified context is not identical prompts.
3. One canonical understanding produces optimized agent-specific projections.
4. Late agents receive hydration.
5. Deltas require valid acknowledged checkpoint AND session/source/policy context.
6. Secrets never enter shared context.
7. Historical decisions are explicitly superseded.
8. Optional integrations never become availability dependencies.

Fresh agents receive compact current state, constraints, accepted decisions,
evidence and question. Returning agents get deltas only after compatibility checks;
otherwise full compact hydration. ACTIVE, SUPERSEDED, STALE, REJECTED, RESOLVED,
ARCHIVED are explicit. Changed sources invalidate affected claims; corrections
append evidence/supersession, never erase history. HOT/WARM/COLD retention protects
security, approvals and material evidence; no endless raw conversation retention.

## Optional intelligence
Graphify: source relationships/impact plus derived overlay from explicit accepted
evidence/decisions; task records remain authority. No assumed arbitrary graph writes.
Headroom: measurement, duplication, pressure, eligible compression. Context Broker
owns semantics; critical policy/approvals/findings/exact evidence stay outside
lossy compression. Preserve originals independently. Fallback is uncompressed.
Jev: advice among permitted choices, never permission, findings clearance or privacy
expansion. Fallback deterministic. Every integration independently disableable.

## Review, failure, security and Git
APPROVE, REQUEST_CHANGES, BLOCKED, UNAVAILABLE. Resolve material disagreement using
source/runtime/tests/contracts/requirements; no endless preference debate.
Single-agent self-verification never claims independence/consensus.
Peer outage: permitted replacement or DEGRADED_SINGLE_AGENT/WITH_CONSULTANT;
do not continuously retry exhausted peers in a work unit.
Lead outage: cancel/reconcile, preserve artifacts, checkpoint, only allowed reassignment.
Corrupt authoritative state stops mutation; optional outages do not.
Approvals bind operation/artifact/repository revision; agent agreement is not approval.

Allowlisted child env, redaction before persistence/return, enforced permissions/
recursion, certified filesystem/tool boundaries (prompts/status are not sandboxes).
Scan exact staged contents and history. Verify release artifacts. Provider auth stays
provider-owned. Isolated worktrees record original base; export committed/staged/
unstaged changes against it, verify complete patch, preserve failed exports.
Revalidate dirty-state baseline before integration. No automatic stash/commit of
unrelated work; no destructive cleanup of unreconciled artifacts.

## Delivery phases and gates
0. Freeze docs/ADRs.
1. Existing security hardening, retain bridge usability.
2. Portable contracts, event/projection/evidence, manifest/ledger/policy, minimum hydration.
3. Real Codex/Antigravity, auth/availability/scheduler/single-agent.
4. First vertical slice, one-agent and degraded review, restart and integration.
5. Context allocation/deltas/staleness/retention/replay.
6. Degradable Graphify/Headroom/Jev.
7. Deterministic third adapter; real third optional.
8. npm Technical Preview: setup/doctor/recovery/integrity/docs/external tests.
9. Additional real adapters and progressive platform certification.
10. Beta/GA qualification.

Preview gate: core tests on all three OSs, evidence for each supported live combo,
real initial adapters, one-agent success, N-agent proof, restart/degraded/context/Git
tests, interrupted reconcile recovery, actionable auth, secret canaries excluded,
package contents safe/licensed, honest capability labels. Publication remains human.

## Bounded R&D
Fixed fixture corpus, known defects/material facts, comparable model/effort/repo,
explicit experiment budget; actual/unknown tokens, latency, outcome uncertainty.
A: selected canonical+evidence+decisions+diff versus replay: missed facts, incorrect
assumptions, missing-context requests, size/usefulness.
B: full hydration versus checkpoint+delta: correctness/staleness/tokens; invalid
sessions force full.
C: explicit Graphify promotion: provenance/retrieval/supersession/stale detection;
no broad extraction first.
D: eligible Headroom compression: changed material conclusions/omissions/recovery/
savings; regressions disable path; critical material protected.
E: lead only vs reviewer vs specialist: real defects, false positives, tokens, latency.
These are workflow measurements, not general benchmarks/marketing claims.

## CHANGES FROM PREVIOUS PLAN
Staged releases instead of 18-way parity; explicit four support levels; adaptive
budgets; manifest/ledger/observations; environment/task separation; auth lifecycle;
host layer; explicit Node ADR; bounded R&D; mandatory single-agent slice.

## FROZEN DECISIONS
SQLite authority and separate domains; declarative environment; provider auth;
deterministic competence-driven scheduling; adaptive evidence-preserving context;
checkpoints/deltas/fingerprints; optional integrations; shared host runtime;
bounded review; human gates; isolated integration; staged support; Node >=24.

## REMAINING OPEN QUESTIONS
Exact certified CLI/auth/sandbox/cancellation/session combinations; reliable provider
quota/auth observations; empirical model reserve profiles; supported Graphify overlay
contract; native conversation/cancellation binding; measured advanced-context value.
Resolve by implementation evidence without reopening the frozen architecture.

## FIRST IMPLEMENTATION SLICE
Fixture CLI task -> discovery/auth -> exact selection -> durable events/state ->
adaptive context -> isolated lead edit -> observed test -> review request -> injected
quota failure -> safe degradation -> compensating verification -> terminate/restart ->
valid checkpoint resume -> export/verify -> dirty baseline revalidation -> deliberate
authorized integration -> separate reporting of tests, independent review, degradation,
human decisions and limitations. Repeat with only one agent installed, every optional
integration individually disabled and all three disabled. Never fabricate consensus.
