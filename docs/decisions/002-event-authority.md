# ADR-002-event-authority: SQLite event-state authority

## Status

Accepted, 2026-09-26. Not a claim of completed implementation.

## Context

The approved Phase-1 plan requires portable, auditable, safe incremental delivery.

## Decision

Append task events and update rebuildable projections atomically. Separate environment and per-repository task databases/migrations. JSONL is export only.

## Alternatives

Independent JSON files or dual writable logs risk partial transitions and divergent authority.

## Consequences

Optimistic revisions, leases, replay/recovery tests and protected evidence are required.
