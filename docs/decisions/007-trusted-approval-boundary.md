# ADR-007: Host-signed, one-use integration approvals

Status: accepted for the development library; a trusted host producer is not implemented.
Date: 2026-10-03. Extends the human-gate decisions in the Phase-1 architecture.

## Context

An agent can answer a terminal prompt or automate a same-user browser. Neither is
proof of human origin. The previous library callback accepted a claimed actor and
digest; it was only a fixture seam, not an authorization mechanism.

## Decision

The embedding host pins an issuer and an Ed25519 public KeyObject when constructing
the runtime's ApprovalVerifier. No authority means no integration. CLI/MCP do not
accept signing keys, trusted-key configuration, approval callbacks or integration
requests. The runtime never generates or stores the host's private signing key.

The host obtains an operationRequest and displays the exact patch, repository,
task/revision and verification/review limitations to the human through a separately
trusted interface. It signs a versioned receipt only after human consent. The
operation digest covers task ID, canonical repository path, task revision, source
fingerprint, patch hash, policy digest, manifest digest and environment digest.

Receipt fields: schemaVersion, approvalId (UUID), issuer, actor (opaque non-secret
identity), operationDigest, issuedAt, expiresAt and signature. Times are integer
Unix milliseconds; receipts cannot be future-issued, expired, or valid longer than
five minutes. Signature bytes are canonical base64url Ed25519 over UTF-8:

```text
peer-capabilities/approval/v1\n + canonical JSON of all receipt fields except signature
```

Canonical JSON uses sorted object keys without insignificant whitespace. The fixed
domain and algorithm prevent cross-protocol or caller-selected algorithm confusion.
The receipt signature proves a statement from the pinned host, not independently
that a human clicked a button. That assertion remains the host's responsibility.

Under repository/task leases, the runtime reloads current state, enforces engineering
and policy gates, verifies the receipt and consumes it by appending INTEGRATION_STARTED.
The event and INTEGRATING projection commit together. A unique SQLite event index
prevents approvalId reuse across tasks in that repository database. Binding to task
and repository prevents the same signed receipt from authorizing another repository.
Expiry is checked at consumption; it is not a deadline for the already-started Git
operation. The task cannot accept another receipt after integration starts.

Git consumes the immutable hash-verified patch bytes. Successful application appends
INTEGRATED and TASK_COMPLETED. Failure or process death leaves INTEGRATING for explicit
reconciliation; it never silently retries, refunds consent, rolls back user files, or
claims Git and SQLite form one transaction. Recovery automation remains future work.

Legacy INTEGRATION_AUTHORIZED events remain replayable for existing development
history, but new unsigned events are rejected. The additive event/index preserves
the existing schema version; older binaries cannot be assumed to replay new events.

## Trust assumptions and release gates

- Host signer, runtime process, pinned trust configuration and task database must be
  outside delegated agents' write/control capabilities. An agent able to execute
  arbitrary code as the trusted host can defeat an in-process library contract.
- Same-user files, CLI arguments, a local web button, PTY presence and a model's
  assertion of consent do not establish this isolation. No signing CLI is supplied.
- Host key provisioning/revocation, human-facing interface, native host transport and
  platform-specific process/filesystem isolation require certification before enabling
  integration on a product surface. Tests use ephemeral keys and actor test-harness.
- System clock and authoritative database are trusted. Restoring an old database or
  rolling back the host clock needs separate operational controls; signatures alone
  do not prevent rollback of the whole machine's state.
- Runtime leases serialize participating runtimes, not arbitrary editors or processes.
  Fingerprint checks cannot create an atomic filesystem-wide compare-and-apply. The
  trusted host must establish exclusive mutation access for the final apply window.

## Alternatives

- Terminal confirmation or an unsigned callback: rejected as forgeable human claims.
- A signing key in the manifest/repository: rejected because delegated agents could
  self-authorize and the secret-free environment boundary would be violated.
- A new browser/server approval product now: deferred; it would still need a real
  human-origin and isolation design, not merely an approve button.

## Consequences

The library has a testable consumption contract without pretending the host trust
boundary is finished. CLI/MCP integration stays disabled. Interrupted integration
requires manual reconciliation and cannot be repaired by simply reusing a receipt.
