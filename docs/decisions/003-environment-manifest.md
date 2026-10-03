# ADR-003-environment-manifest: Environment Manifest versus Ownership Ledger

## Status

Accepted, 2026-09-26. Not a claim of completed implementation.

## Context

The approved Phase-1 plan requires portable, auditable, safe incremental delivery.

## Decision

Manifest declares desired state, ledger records owned resources, timestamped observations describe actual state. Reconcile through one journaled engine.

## Alternatives

Unrelated installation scripts and implicit adoption make recovery and uninstall unsafe.

## Consequences

Validate versioned schemas, reviewed recipes and integrity. Preserve pre-existing resources and conflicting edits; explicit adoption only.
