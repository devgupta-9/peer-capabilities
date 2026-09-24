# Security implementation notes

The canonical operation boundaries are in MASTER-AGENTS-REFERENCE.md, section 6. This file explains local controls; it does not duplicate or relax authorization.

## Controls

Do not recommend blanket EAGER/TURBO settings as a substitute for operation-specific approval. Antigravity is configured to request review for terminal commands, artifact review, and browser JavaScript. The CLI retains explicit safe command grants, denies its existing mutating Git commands, and trusts named project directories rather than a whole drive or user profile.

Host approval controls are defense in depth, not proof that every harmful action is blocked. Scoped workspace edits and diagnostics remain governed by platform controls and the user's task. Existing permissions and credentials must not be weakened to make a test succeed. A peer's READ_ONLY label is an instruction; verify actual permissions and returned changes.

## Secrets

Never print, summarize, copy, transform, delegate, expose, commit, or include secret values from configurations, environment variables, auth databases, tokens, cookies, or key stores. Use native OAuth/OS stores where supported. Some existing integrations use file-backed credentials; this repair preserves them in place rather than copying them into the origin or migrating authentication without consent.

Only allowlisted non-secret metadata belongs in inventories. Report a credential's verification state as unknown unless a relevant harmless authenticated operation actually succeeded; an HTTP endpoint being reachable is not proof of authentication.

## External services

Jev may send decision context to its provider. Never send secrets or sensitive project material without the relevant authorization. Jev is advisory and cannot approve production, destructive, billing, credential, or external communication operations.

Graphify remote inference requires explicit data-handling authorization. Prefer local code-only extraction. A Headroom proxy or browser can encounter sensitive data; avoid raw payload logging and do not copy state/log databases into this origin.

## Recovery

Back up only non-secret managed documents before replacing them. Record narrowly scoped runtime edits without copying credential-bearing files. Retire redundant instruction files recoverably. Do not delete vendor binaries or host-managed plugin caches to achieve apparent synchronization.
