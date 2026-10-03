# ADR-004-provider-authentication: Provider-owned authentication

## Status

Accepted, 2026-09-26. Not a claim of completed implementation.

## Context

The approved Phase-1 plan requires portable, auditable, safe incremental delivery.

## Decision

Official provider login/stores; persist only non-secret observations and opaque references. Presence, authentication and verification are independent.

## Alternatives

Copying tokens into a portable config leaks credentials and confuses ownership.

## Consequences

Installed is not authenticated or verified. Unknown remains unknown; login instructions followed by scoped verification.
