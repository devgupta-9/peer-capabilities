# Phase 0 — Foundation Hardening

Implementation scope: CI failure truth, filesystem/state identity, shared secret
policy, full fetched-reachable-history scanning, and direct regression evidence.
See [ADR-008](../decisions/008-foundation-identity-and-secret-policy.md).

## Confirmed baseline defects

At `711c2c8483b8bcb353a719ba545547df3f01f4e8`, the supplemental Windows job was
green while portable Windows and macOS tests failed. Multi-native PowerShell blocks
could mask earlier command failures. Environment roots mixed sync and async
resolvers, default state keys used raw paths, and path-policy tests compared a
canonical result with a raw temporary fixture. Runtime/publication secret patterns
diverged; history scanning was not a visible CI gate and checkout was shallow.

## Implemented

- Native install/typecheck/build/test/audit and Python/Node validation steps fail
  independently. A failure-then-success fixture exercises the checked block runner.
- Native directory identity covers aliases without global case folding. Physical
  root replacement, escaped delegation and unsafe managed links remain rejected.
- Common repository and per-checkout identities are separate. State keys are
  canonical and versioned. Legacy state is detected, not automatically migrated.
- Current-content and fetched-reachable-history scans are separate CI steps with
  full checkout history. Shallow/missing history cannot produce a clean result.
- One packaged secret policy covers runtime rejection/redaction and publication.
  Synthetic canaries cover nested/escaped JSON, arrays, environment text, tokens,
  private keys and diagnostic persistence. Staged scans read index blobs.

## Verification status

Local Windows / Node 24.18.0: the exact staged snapshot (excluding unrelated local
Antigravity work) passed **102/102 tests**, typecheck, build, dependency audit and
package dry-run. The 54-entry archive includes the shared secret policy; installing
it into an isolated prefix and running `version` passed. Current content, staged
content and fetched reachable history scans passed. Sync safety passed all seven
checks. The 33-case synthetic corpus covers both detection and diagnostic redaction.

Remote verification is pending at the time of this implementation commit; do not
infer CI success from these local results.

Local Windows verification and exact-commit Actions results must be recorded with
the delivered commit. A workflow definition alone is not cross-platform evidence.
The authoritative run is the `verify` workflow for that commit, including all three
portable jobs and the supplemental Windows job. Local commands:

```text
cd peer-agents
npm ci --ignore-scripts
npm run typecheck
npm run build
npm test
npm audit --omit=dev --audit-level=high
npm pack --dry-run --json
cd ..
node scripts/secret-scan.mjs
node scripts/secret-scan.mjs --history
node scripts/secret-scan.mjs --staged
pwsh -NoProfile -File scripts/test-sync.ps1
git diff --check
```

This hardening does not certify live agents or publish npm. The pre-existing local
Antigravity repair is separate from this delivery. One optional Antigravity review
was attempted with an exact model/effort; it was blocked by headless command
permissions. No global permission settings were changed to obtain review, and no
independent peer approval is claimed.

## Deferred / next phase

Next: **Identity and Resource Contracts** (Provider, AgentFrontend, Account,
AuthContextRef, QuotaPool, Model, ModelAccessBinding, Worker, CapabilityProfile,
CapabilityContract). These are not implemented in Phase 0. Autonomy, capacity waits,
cloud workers, learned routing, new external integrations and live approval signing
remain deferred. Existing event/SQLite authority, single-agent flow, FAST/STANDARD,
verified patches, provider authentication and human authority are preserved.
