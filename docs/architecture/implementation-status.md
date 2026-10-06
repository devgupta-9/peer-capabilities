# Implementation ledger

Current hardening slice: [Phase 0 foundation hardening](phase-0-hardening.md).
The dated verification below is historical, not a claim that the current HEAD's
three-platform CI passed. The next approved slice after Phase 0 is Identity and
Resource Contracts; the earlier next-slice recommendation below is superseded.

Updated: 2026-10-03. Status: **unpublished development foundation; roadmap incomplete**.
Plan: [accepted architecture](phase-1-plan.md). Baseline: `3bce3a4` / v0.3.0,
with 19 passing bridge tests before development. Current package: `0.4.0-dev.0`,
private. No Technical Preview, public support certification, or production readiness
is implied by this ledger.

Work is maintained on the isolated `phase1-runtime` branch. On 2026-10-03 the user
authorized committing and pushing this development branch. See Git history for the
resulting commits; that source handoff is not an npm release, a merge to main, or a
deployment. The live configuration and original main checkout remain unchanged.

## Implemented development scope

| Area | Implemented and locally exercised | Still required |
| --- | --- | --- |
| Architecture | Original brief, accepted plan, seven ADRs, support matrix, runtime guide | Maintain evidence as subsequent slices land |
| Task authority | Separate task SQLite database, append-only events, transactional projections, revision checks, replay validation, evidence, execution/repository leases | Full decision/supersession model, retention, migrations beyond the initial schema |
| Environment | Versioned manifest validation; separate environment database; scoped ownership, observations, operation journal; setup/doctor/sync/update/repair/rollback/uninstall for managed files | Migration from integrations.json; reviewed CLI/MCP/skill/plugin installation recipes; broader upgrade recovery |
| Authentication | Provider-owned login guidance; separate presence/authentication/verification; scoped expiring observations persisted across processes | Live-provider authentication matrix; configuration-sensitive invalidation and broader integration authentication |
| Scheduling | Generic registry, exact model/effort selection, competence filters, deterministic cost/latency tie-breaking, N-agent selection tests | Quota-pool cooldown handling, specialists, bounded re-review, governed replacement policies |
| Context | Adaptive conservative allocation, mandatory evidence protection, checkpoint validity and delta selection logic | Live session/delta integration, accepted-decision lifecycle, retention and measured allocation profiles |
| Adapters | Codex and Antigravity protocol implementations, stdin prompts, normalized failures, explicit experimental opt-in | Live sandbox, cancellation, authentication, recursion and platform certification |
| Execution | Isolated worktree, observed tests, unavailable-review degradation, compensating verification, safe checkpoint restart, patch export and validation | Interrupted mid-tool reconciliation and recovery beyond completed checkpoints |
| Git and gates | Streaming dirty-content fingerprints; original-base patches; immutable verified-byte application; signed expiring host receipts with durable one-use consumption | Trusted human-origin signer/transport and exclusive mutation access; CLI/MCP integration remains disabled |
| Host surfaces | Development CLI and task MCP share the runtime; existing bridge schemas retained | Review-submission surface, thin native host skills/plugins, trusted approval channels |
| Packaging | Node 24 guard, allowlisted npm contents, local pack/install smoke, three-OS core CI definition | Actual cross-platform CI results, release integrity qualification, external preview testing and publication |

Graphify, Headroom and Jev connectors are **not implemented** in this slice. Reserved
switches and disabled-integration fixture runs establish that the conservative core
does not require them; they do not prove connector behavior or outage recovery.
The third adapter is deterministic test data, not a third real provider.

## Verification evidence

Local environment: Windows, Node 24.18.0. Historical foundation verification on 2026-09-27:

- Type-check and build passed.
- **52/52 tests passed**, including the original bridge checks and new runtime,
  environment, authentication, context, security, CLI/MCP and repository tests.
- The restart fixture runs eight scenarios: single-agent and injected reviewer
  quota failure, each with Graphify, Headroom, Jev, and all three disabled. Separate
  processes checkpoint/resume/export/integrate; approvals are labelled `test-harness`,
  never represented as real human authorization. No real model calls are involved.
- Publication scanner passed current tracked/untracked candidates (99 files) and
  all reachable history blobs (74). Canary tests prove it
  reads index content, detects historical/quoted credentials, and omits secret values
  from findings. Pattern scanning is a safeguard, not a guarantee against every secret.
- PowerShell parsing passed for install.ps1, bootstrap.ps1 and secret-scan.ps1;
  Python syntax parsing passed for validate.py. The live validator was not run.
- The sandboxed sync safety test passed all seven checks with the documented
  PowerShell 7 host: drift, apply, idempotence, conflict refusal, preservation of
  user edits, source update and backup recovery. An initial Windows PowerShell 5
  invocation treated an expected child error as fatal; that host is unsupported.
- `git diff --check` passed; Windows line-ending notices are not validation failures.
- `npm pack` created an allowlisted archive. Installing that archive into an isolated
  temporary prefix and executing its version command passed, reporting development
  maturity and `releaseSupported: false`. The first smoke command misread npm's
  keyed JSON result as an array; the corrected exact-archive installation passed.

The CI matrix is configured for Windows, macOS and Linux but has not been run on
remote CI in this task. Local passing tests are not platform certification. No live
provider invocation, external preview exercise, published package, or host deployment
is claimed.

## Independent review and fixes

A read-only Codex review using GPT-6 Astra with High reasoning completed. An initial
quota interruption was disclosed; the same reviewer later finished. Findings were
reproduced with local regressions and fixed:

- Per-operation intent journaling prevents a partially applied environment plan from
  adopting unrelated files. Same-content temporary recovery is allowed only after intent.
- Managed-root replacement by a junction fails closed; inverse ownership survives
  rollback of repairs where the formerly owned file was absent.
- Quoted/nested credentials are rejected or sanitized before shared persistence.
- Provider verification survives new processes without extending the original expiry.
- Agent-accessible terminal confirmation cannot manufacture human approval: CLI
  integration is disabled until a trusted channel exists.
- Patch approval binds the bytes consumed by Git, not a mutable pathname. A regression
  replaces the file after checking and confirms only the originally approved bytes apply.
- Codex responses require a successful terminal turn; failure/error/unfinished/malformed
  streams cannot turn an earlier APPROVE message into a successful review.

The reviewer assessed this as a development foundation conditional on the final two
fixes, not as Preview-ready. The lead verified those fixes and reran the full suite;
this is not a second independent review of the amended patch.

## October 3 continuation

The same isolated development branch was continued after relocation to D drive.
The fresh baseline passed 52/52 tests before this continuation. A successful
Antigravity review now supplements the earlier built-in Codex review. See the
[review, findings and rulings](../reviews/2026-10-03-antigravity.md).

Implemented in this continuation:

- Failed/unlaunchable tests persist BLOCKED with failed evidence instead of RUNNING.
- Verification that changes exportable files blocks patch production and retains artifacts.
- Repository file-content hashing uses streams instead of whole-file buffers.
- Pinned host receipt verification replaces the unsigned integration callback. Exact
  task/repository/revision/patch/policy binding, expiry and unique durable consumption
  are enforced before Git starts. INTEGRATING survives interruption without reapplication.
- CLI/MCP cannot configure a signing authority or invoke integration. A genuine host
  approval UI/signer and its isolation remain unimplemented; signatures do not prove
  human origin without that trusted producer. See [ADR-007](../decisions/007-trusted-approval-boundary.md).

New failure paths were observed RED before production changes. Verification on
2026-10-03: typecheck/build passed; 61/61 tests passed (including all eight separate-process
vertical-slice scenarios with signed fixture receipts); current publication scan passed
106 tracked/untracked files; package dry-run and git diff --check passed. The restart
approval test initially had a double-close in fixture cleanup; the fixture was corrected
without weakening the production lifecycle assertions. No live login, configuration
deployment, commit, push or publication occurred. This does not change certification.

## Delivery position and next slice

Phase 0 documentation is recorded. Phase 1 hardening and Phase 2 foundation have
substantial implementations but are not release-qualified. Phase 3 adapters are
experimental. Phase 4 is proven with deterministic fixture adapters and a test-only
host signer, not yet with live adapters/trusted human approval. Phase 5 has
baseline allocation/checkpoint logic, not the full context lifecycle. Phases 6, 9 and
10 remain planned. Phase 7 has N-agent selection evidence; Phase 8 has development
packaging only. No phase is promoted solely because a test executable exists.

The next implementation slice must provision/certify a trusted host approval producer and
exercise the same end-to-end workflow with exact real adapter selections in a disposable
repository. Obtain the appropriate user authorization before any credential flow or
paid/live consultation. Keep the production integration surface disabled until human
origin, exact operation scope, expiry and one-time consumption are demonstrably enforced.
Continue manifest recipes, decision/evidence lifecycle and optional connectors behind
their declared boundaries, followed by cross-platform and external Preview qualification.

## Rulings and shared interfaces

- Keep work isolated; origin integration and live deployment are deliberate later actions.
- The approved architecture is the spec. The initial implementation was kept uncommitted
  and recorded in this ledger; the subsequent explicit branch-push authorization does
  not authorize npm publication, a main-branch merge or live deployment.
- Minimal context/checkpoint/store precede the runnable slice; no second writable authority.
- Environment desired state, ownership and actual observations remain separate.
- Exact model/effort and a generic registry replace fixed agent-pair assumptions.
- The legacy bridge retains its no-tier schema; FAST/STANDARD are new runtime workflow
  presets, not model classes or permission to use lightweight Codex workers.
- Credentials remain provider-owned. Unknown authentication or quota remains unknown.
- Simulated evidence, CLI discovery and installed executables cannot certify live adapters.
