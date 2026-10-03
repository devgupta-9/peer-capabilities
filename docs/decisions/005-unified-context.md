# ADR-005-unified-context: Unified Context invariants

## Status

Accepted, 2026-09-26. Not a claim of completed implementation.

## Context

The approved Phase-1 plan requires portable, auditable, safe incremental delivery.

## Decision

Source outranks memory; one canonical state yields role projections; late joins hydrate; deltas require valid sessions/checkpoints; no secrets; explicit supersession; optional integrations remain optional.

## Alternatives

Full replay wastes context; uncontrolled summarization loses evidence.

## Consequences

Adaptive budgets protect mandatory facts and report insufficiency; compression and semantic promotion remain measured R&D.
