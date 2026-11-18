# ADR-011 — Reversible evidence archival

## Status

Accepted for the development runtime on 2026-11-13. Extends ADR-002 and ADR-005.

## Context

Retention recommendations already distinguish current obligations, historical
references and unreferenced evidence. Historical decision replay requires the
complete original records. Storage changes need explicit intent, recovery and
compatibility checks.

## Decision

Use a versioned gzip/base64 envelope in the existing SQLite evidence body column.
The first archive operation upgrades the task database to schema version 2 in the
same transaction as the record replacements and an append-only operation receipt.
Environment databases retain their independent schema version. New readers accept
task versions 1 and 2. Version-1 readers reject newly opened version-2 databases.

Operator CLI/library calls preview explicit IDs, then apply the exact returned
plan. Plans bind the database scope, task revisions, retention classification,
storage journal and affected bytes. Current HOT obligations are ineligible for a
new archive operation. WARM/COLD records retain all original bytes through lossless
encoding. Every ordinary evidence reader validates decoded records through the
existing secret, content and provenance checks.

Restore writes the original JSON bytes exactly. Repeated operation IDs return their
historical receipt. A fresh operation requires a fresh plan. A transaction failure
rolls back every replacement, schema upgrade and receipt together.

## Bounds and recovery

Each operation selects 1–100 records, with at most 16 MiB per original archive
record and 32 MiB of original record bytes per batch. Decompression is bounded by
the recorded size and checked against the original SHA-256. Archive previews reject
encodings that would expand stored bytes. Corruption stops reads and further
storage planning.

Restoration uses a compatible runtime and retains the version-2 journal. Runtime
downgrades require compatible state recovery. Older already-open readers can fail
on the new envelope, so storage operators must use compatible readers when opting
into archival. SQLite page reuse, WAL checkpointing, file-size compaction and data
deletion remain later work. Reported savings measure encoded record bytes.

## Alternatives considered

External archive files require an additional filesystem transaction and recovery
protocol. Same-row encoding uses the existing SQLite atomicity boundary. Jev
recommended this scope as bounded advice. Regression tests verify the behavior.
