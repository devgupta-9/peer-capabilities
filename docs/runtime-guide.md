# Development runtime guide
This is an **unpublished development foundation**, not the npm Technical Preview.
Read [implementation status](architecture/implementation-status.md) before enabling
real adapters. The released v0.3.0 bridge/installer remains a separate compatibility path.

## Local build
From the repository's peer-agents directory:
```powershell
npm ci --ignore-scripts
npm run build
npm test
node bin/peer-capabilities.mjs --help
```
Node >=24 is required. Node 24 is the initial test target. No postinstall performs
host setup. The package remains private; do not publish it before the preview gates.

## Reproducible managed-file setup
Use an explicitly selected, disposable directory to try the example:
```powershell
node bin/peer-capabilities.mjs setup --manifest examples/environment.json --root ./sandbox-environment
node bin/peer-capabilities.mjs setup --manifest examples/environment.json --root ./sandbox-environment --apply
node bin/peer-capabilities.mjs doctor --manifest examples/environment.json --root ./sandbox-environment
```
The first command journals an inspectable plan; only --apply writes managed files.
The example creates peer-policy.md. Agent/integration entries are declarations only:
this engine does NOT yet install CLIs, MCPs, plugins or skills. Existing matching
files are observed, never silently adopted. User edits produce conflicts.

update/sync/repair use the same manifest/root options. rollback requires
--id OPERATION --apply. uninstall --root DIRECTORY --apply removes only owned
unchanged files. Default environment state is under ~/.peer-capabilities/environments,
keyed by root; --state-dir selects a separate explicit state location. One ledger
is bound to one canonical managed root. Task history and provider credentials are
not removed by uninstall.

Interrupted APPLYING operations can be reconciled with EnvironmentManager.apply(id).
The CLI does not yet expose an environment-operation resume command. CONFLICT
operations require a fresh reviewed plan; preserved temporary files may need
inspection. No upstream package installer is claimed to be transactional.

## Agents and authentication
examples/runtime.json is a starting template, not an executable model recommendation.
Use the existing peer_capabilities discovery or the providers' official model
commands to fill exact model/effort profiles. Competence/cost/context capacity are
human-maintained policy inputs, not learned rankings or certified benchmarks.
Native executable overrides are supported; Windows .cmd/.ps1 shims are rejected.
No free model bypasses the configured competence threshold.

```powershell
node bin/peer-capabilities.mjs discover --repo REPOSITORY --config runtime.json
node bin/peer-capabilities.mjs verify --repo REPOSITORY --config runtime.json
```
Real adapters require experimental:true explicitly and remain uncertified. verify
spends one harmless model consultation per configured adapter, without tools by
instruction; complete official provider login yourself first. Codex login status
can provide authentication evidence; Antigravity authentication may be UNKNOWN
until verify succeeds. A successful verification is scoped to the CLI version and
exact model, expires after 15 minutes, and is stored without credentials. It does
not certify every model. UNKNOWN never means authenticated. Discovery failure
does not imply a need to copy credentials.

Antigravity transport follows the official
[stdin streaming protocol](https://antigravity.google/docs/cli/headless/).
Native SQLite uses the APIs documented for
[Node 24](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html).
Provider filesystem/tool/recursion enforcement remains a live certification gate;
neither prompts nor change-detection tripwires are a sandbox.

## Governed tasks
Use a clean fixture repository first. Configure a real verification command and
exact model profiles; keep test commands within the authorized task scope.
```powershell
node bin/peer-capabilities.mjs run --repo REPOSITORY --config runtime.json --objective "Task objective" --checkpoint-only
node bin/peer-capabilities.mjs resume --repo REPOSITORY --config runtime.json --id TASK_ID
node bin/peer-capabilities.mjs status --repo REPOSITORY --config runtime.json --id TASK_ID
```
run selects the lead and attempts one independent review; failure triggers
compensating verification, never a consensus claim. --checkpoint-only stops at
a safe checkpoint. Resume exports and verifies a patch, not an automatic merge.
Task state, worktrees and patches live under the repository's common Git directory.
Full policy and dirty-source fingerprints are checked before export/integration.
Tests currently prove restart through separate driver processes; arbitrary mid-tool
termination requires manual process/artifact reconciliation and does not redispatch.

CLI/MCP integration is **disabled** pending a trusted host approval mechanism.
A terminal/PTY and repeated digest are not proof of human origin. Inspect and apply
the exported patch through your existing explicitly approved host workflow. The
library now requires a receipt signed by an explicitly pinned host authority; an
agent-supplied callback no longer works. Receipts bind the task/repository/revision,
patch and policy, expire within five minutes, and are consumed durably before Git
mutation. Tests use an ephemeral fixture signer labelled test-harness. No real
human-facing host signer or isolation boundary is certified or configured yet.
See [ADR-007](decisions/007-trusted-approval-boundary.md).

After receipt consumption a task is INTEGRATING until success is durably recorded.
Interruption/failure leaves that state for explicit reconciliation; resume does not
reapply or reuse consent. Git and SQLite are not one atomic transaction. Repository
leases protect participating runtimes, not arbitrary external writers; certified
integration will also require exclusive host-controlled mutation access.

Failing or unlaunchable verification commands now record failed evidence and BLOCKED
state. Commands that change tracked or non-ignored repository content also block:
test-generated debris cannot silently enter the patch. Put disposable test output
in appropriate ignored/temp paths; ignored files remain outside this fingerprint
tripwire, so it is not a sandbox. Blocked tasks require worktree inspection and a
new governed task, not an implicit retry that ignores a prior failed test. Agent-created
untracked files remain part of the proposed patch and require review. Verification
commands use a native executable and argv; Windows npm.cmd is not launched implicitly
through a shell. Configure the intended native runner explicitly.

## Host integration
`node bin/peer-capabilities.mjs mcp --repo REPOSITORY --config runtime.json`
starts a separate development MCP surface bound to that repository and local
policy. No registration is changed automatically.
Tools: v1_task_create, v1_task_status, v1_task_context, v1_task_dispatch,
v1_task_resume. There is no approval, login, shell, or integration tool.
The existing peer-agents MCP and its exact legacy schemas remain separate.

## Limits
Baseline allocation is conservative and byte-estimated. Mandatory material that
cannot fit fails explicitly. Delta logic is unit-tested, but real adapters currently
use fresh sessions/full packages; verified live delta/session reuse is not complete.
Graphify/Headroom/Jev connectors, accepted-decision promotion, retention/compaction,
specialist/re-review flows, trusted host approvals and live platform certification
remain planned. Their switches are reserved configuration, not evidence of active
connectors. All fixture scenarios run without requiring any optional integration.
