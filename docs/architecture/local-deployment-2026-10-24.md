# Local development deployment — 2026-10-24

Scope: private `0.4.0-dev.0`, development branch `phase1-runtime`.
This is not an npm publication, merge to main, or live-provider certification.

## Shipped scope

- Scoped host reconciliation, optional-tool selection and AGY discovery reliability.
- Opt-in resource-bound scheduling and dispatch. No live resource enrollment or
  scoped authentication observations were created; trusted collectors remain pending.
- Bridge Zod pinned to 4.6.7. Jev updated from 0.5.0 to 0.14.5.
- REA remains 6.5.0 with an explicit Zod 4.6.7 override and fast-uri 3.1.9.
  Upstream REA's pin was still vulnerable; remove the override only after a tested,
  patched upstream dependency replaces it.
- Jev's existing launcher now forwards the documented `JEV_MCP_MODEL` pin.
  No HTTP transport, new provider credentials, or broader environment forwarding.

The fresh audit identified [the Zod advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).
Jev's updated dependency graph also removes the older vulnerable transitive
packages. All three final production dependency audits report zero vulnerabilities.
Dependency audits are timestamped evidence, not a guarantee against future findings.

## Deployment and recovery

Installed package SHA-256:
`e96af2eb8c3e59137b5cff7cf3af5a67eed88f34152ff5ad1f71166ab05ae486`

Immutable release directory:
`%USERPROFILE%\.peer-capabilities\runtime-releases\e96af2eb8c3e5913`

The bridge package is under `node_modules/@devgupta/peer-capabilities`; the
locked optional runtimes are under `tools/jev` and `tools/rea`.
Install scripts were disabled; package contents were allowlisted and all **85**
installed package files matched the reviewed source/build bytes.

Host operation: `4d81b14b-9889-404d-a8ca-700256215630`.

- Codex, Antigravity CLI and Antigravity IDE: peer bridge, Jev and REA launch paths.
- Claude Code and Claude Desktop: existing Jev and REA launch paths only.
- Five original-config backups were verified against the preview hashes.
- Semantic comparison confirmed only selected server argument arrays changed.
  Commands, environment values, credentials, permissions, disable flags and all
  unrelated values were preserved. Antigravity's permissions file hash is unchanged.
- Repeating the reconciliation preview produced zero changes.
- Previous runtimes remain available; no cleanup or credential migration occurred.

Rollback uses `scripts/sync-hosts.ps1 -RuntimeRoot <installed-package> -Rollback 4d81b14b-9889-404d-a8ca-700256215630`.
It refuses conflicting subsequent edits. Older runtimes may restore vulnerable
dependencies; rollback is a recovery mechanism, not the recommended steady state.
Do not run mixed task-runtime versions against resource-bearing task state.

## Verification boundaries

- Patched bridge build and full Windows suite: **198/198 passed**.
- Subsequent Jev model-pin launcher regression: **2/2 passed**.
- Doctor isolation tests: **4/4 passed** using the supported Headroom Python.
  System Python 3.10 lacks `tomllib` and is not the validator environment.
- Isolated synchronization safety and workspace migration checks passed.
- Twelve project PowerShell files parsed; probe syntax and whitespace checks passed.
- Pre-commit staged scans and the fetched reachable history scan passed.
- Jev 0.14.5 fresh-process discovery exposes twelve tools, including the selector's
  `jev_decide` and `jev_gate`. No paid inference or provider-authentication proof.
- REA's harmless `binary_session` call passed with the exact package/path
  expectation. This does not certify every native analysis backend.
- Installed-host doctor: **23 probes, 232 managed files, zero drift and zero
  errors**. Three existing warnings remain: two Antigravity review-setting
  mismatches and the validator's mutating-Git deny-rule warning. No safety settings
  were rewritten to silence them. Exact-pushed-SHA CI results are separate evidence.
- Existing app sessions must reconnect their MCP servers to load new executables.
  This runtime upgrade reload is distinct from ordinary workspace authorization.
- Earlier AGY review timed out; no independent approval is claimed.

Remaining roadmap: trusted scoped collectors, resource-aware doctor inspection,
live provider/account certification, and the staged Technical Preview gates.

## CI follow-up

The first pushed run at `27c014b` passed Linux but exposed the same recovery-test
fault-injection error on macOS and Windows: the test compared an alias path with
the runtime's canonical destination, so its simulated interruption never occurred.
An explicit root-alias case reproduced the failure locally. The test now resolves
its injection target through the existing filesystem identity primitive and asserts
that the interruption actually happened; both cases retain journal/restart/rollback
assertions. The focused recovery suite passes 11/11 and the final full Windows
suite passes 199/199. No runtime or security-policy
code changed, so the deployed artifact and its verified hashes remain unchanged.
