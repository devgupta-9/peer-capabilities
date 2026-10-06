# ADR-008: Foundation path identity and secret policy

Status: accepted for Phase 0, 2026-10-06. No autonomy or integration expansion.

## Filesystem identity

Use one native realpath boundary for existing directories. Keep display paths,
canonical filesystem paths and physical directory identity (device/inode) distinct.
Never globally lowercase paths. Repository identity uses the common Git directory;
checkout identity uses the checkout-specific Git directory. Repository mutation
leases share the common identity across linked worktrees.

Containment walks canonical physical ancestors. Managed roots and configured
delegation roots are pinned and revalidated; root replacement and destination
symlinks/junctions fail closed. This is not a general OS sandbox or a guarantee
against malicious concurrent filesystem replacement between checks and syscalls.
Existing isolated worktrees, verified patch bytes and approval gates remain required.

New default environment state uses a versioned canonical identity key. Existing
default sibling databases are inspected read-only for legacy/alias collisions.
Legacy scope databases and changed physical roots require explicit operator
reconciliation: no ownership adoption, automatic merge or migration. Custom state
directories outside the default parent cannot be discovered automatically. Stop old
runtime processes before changing runtime versions; mixed-version leases are not supported.
Back up and reconcile old state before reuse; do not delete it to bypass a conflict.

## Secret policy

The runtime and publication scanner import the same dependency-free policy module.
Structured credential names, text assignments, provider tokens, private keys,
authorization values and authenticated URLs share synthetic detection/redaction
tests. Runtime environment allowlisting remains separate and unchanged. Credentials
stay provider-owned: broader detection does not authorize collecting more data.

Publication additionally prohibits high-risk filenames. History scanning covers
blobs, commit/tag text and tree filenames reachable from all fetched refs plus HEAD.
Shallow history, missing reachable objects and traversal errors are failures, not
partial successes. CI checkout fetches all branch/tag history; PR runs also include
the checked-out merge HEAD. Unfetched PR refs, deleted refs, unreachable objects and
objects once uploaded to the host are not claimed to be covered.

Two pre-existing immutable blobs contain reviewed non-secret syntax caught by the
stronger assignment detector: `1720c9fd86258208f1eecf59aef04d2d37c8ea00` (manifest
rejection test placeholder) and `141bdaa679a6c53f9f60763730bbcfa7abda7a20` (old
PowerShell detector definition). Only their documented assignment findings are
excepted. No directory/extension exemption or history rewrite is permitted. Changed
bytes have a different object identity and are scanned normally.

Pattern matching is defense in depth, not proof that arbitrary data contains no
secrets. Scanner failures return categories and sanitized locators, never matched
values. Synthetic canaries test returned and persisted diagnostic redaction.

## CI authority

Each mandatory native command gets a separate Actions step using the built-in shell
exit handling. A tested PowerShell 7.3+ wrapper protects multi-command blocks.
All portable matrix jobs and the supplemental Windows checks must pass; no job is
optional and a green supplemental job cannot override a red matrix member.

References: [Actions shell semantics](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idstepsshell),
[checkout history scope](https://github.com/actions/checkout#usage),
[Node native realpath](https://nodejs.org/docs/latest-v24.x/api/fs.html#fsrealpathsyncnativepath-options).
