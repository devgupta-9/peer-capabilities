# ADR 010: Task selection does not grant execution authority

Status: accepted for the development increment, 2026-10-21.

## Decision

One deterministic non-executing selector serves CLI, MCP and runtime context
packaging. Selection is recorded with context events. Actual availability,
authentication and permissions remain in host/environment boundaries. Optional
tools remain degradable. Explicit needs override inference, not protection/disables.
No secrets, raw evidence, executable commands or arbitrary endpoints enter plans.
ChatGPT web is excluded from the current implementation by user choice.

## Alternatives and consequences

A forced call-all-tools pipeline wastes budget and introduces availability/privacy
dependencies. An arbitrary MCP proxy adds credential/permission boundaries. Neither
is necessary for task-based selection.

Selection is automatic in governed contexts and delegated prompts; conversational
hosts still control execution. Future connectors need validated target/evidence
handles, scoped policy and independently observed invocation receipts. This planner
cannot certify independent review or grant human approval.

See [contract, verification and limits](../architecture/task-tool-selection.md).
