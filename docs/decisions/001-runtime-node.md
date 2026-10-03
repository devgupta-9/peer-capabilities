# ADR-001-runtime-node: Runtime Node version

## Status

Accepted, 2026-09-26. Not a claim of completed implementation.

## Context

The approved Phase-1 plan requires portable, auditable, safe incremental delivery.

## Decision

Require Node >=24. Initially certify Node 24 LTS and isolate node:sqlite behind storage interfaces.

## Alternatives

Older Node plus an alternate SQLite dependency broadens compatibility but adds native packaging and CI complexity.

## Consequences

Fail before runtime import/mutation on older Node. npm cannot upgrade its own runtime. Newer majors require certification.

Reference: [Node SQLite documentation](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html). Use only APIs verified on the certified Node version.
