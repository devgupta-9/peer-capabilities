# Antigravity review and approval-boundary follow-up

Scope: unpublished Phase-1 runtime, especially runner/store/repository/CLI/MCP.
Requested peer: Gemini 3.1 Pro, High reasoning, via peer-agents REVIEW.
The bridge reported successful completion in 145.98 seconds with no model fallback.
These are requested-model arguments, not independent backend attestation.

The configured desktop MCP initially refused dispatch because its launch context
had no safe repository root. Fresh discovery succeeded. A temporary MCP instance
launched through the repository's existing stdio client, scoped only to the development
repository, completed the review. No live registration, permissions, credentials,
authentication or C-drive configuration was changed. No review edits were detected.
The CLI's warning that plan mode has no effect with slash expansion disabled remains
a certification limitation; this review is not proof of a read-only OS sandbox.

The peer reported source inspection, not running tests. Its findings were checked
locally before fixes. This is a bounded review of existing code, not certification
of the new approval consumer or the whole release.

| Peer finding | Lead disposition |
| --- | --- |
| Test/build debris can enter git add -A patch export | Confirmed for non-ignored changes produced by tests. Before/after verification fingerprints now block the task and retain artifacts. Agent-authored untracked files cannot be classified as unwanted automatically. |
| Failed tests leave RUNNING with no safe resume | Confirmed. Nonzero and unlaunchable verification now persist failed tests and BLOCKED. No automatic retry or artifact deletion is introduced. |
| Drift can race the final fingerprint and git apply | Valid residual limitation against external writers; no filesystem-wide atomicity claim. Host-exclusive mutation access remains required before enabling public integration. |
| PID reuse can retain an unrelated process's lease | Valid availability limitation; not a demonstrated unauthorized-write path or unconditional permanent deadlock. Conservative refusal remains pending process-identity/recovery certification. |
| Whole-file hashing can exhaust memory | Confirmed unbounded per-file buffering. Fingerprinting now streams file contents; a fault-injection test denies whole-file allocation and verifies content changes still affect the hash. Git path-list capture and patch size remain bounded separately. |

The peer also highlighted approval expiry and interrupted application. The old callback
was not a cryptographic human approval mechanism. ADR-007 replaces it with pinned
host-signature verification, exact operation binding, short validity, durable one-use
consumption and an INTEGRATING fence. No host signer/UI has been provisioned.

## Rulings and costs

- Ruling: use a temporary, explicitly scoped development MCP instead of changing live
  registration. Cost: the desktop MCP's launch-root misconfiguration remains to be
  corrected separately if persistent in-session dispatch is wanted.
- Ruling: reject test-induced exportable changes instead of guessing which files are
  unwanted or deleting them. Cost: legitimate tests that rewrite tracked fixtures
  need workflow changes. Agent-authored additions still require patch review.
- Ruling: keep CLI/MCP integration disabled while implementing only the host receipt
  consumer. Cost: no usable real human approval channel until a trusted host is selected,
  provisioned and certified. A signer controlled by the agent is not acceptable.
- Ruling: preserve conservative leases and disclose the external-writer race; do not
  expire a live-looking PID lease or claim ordinary Git checks provide atomicity.
  Cost: PID reuse can block progress, and final integration needs exclusive host access.
- Ruling: native argv execution stays shell-free. Cost: Windows shell shims require an
  explicitly configured native runner; spawn failures now block durably and safely.

No cosmetic findings were requested; there are no deferred minor findings from this
review. Live provider sandbox/cancellation, runtime authentication certification and
provider login state were not tested. Hash implementation was checked locally as
SHA-256; this does not turn source review into cryptographic or production certification.
