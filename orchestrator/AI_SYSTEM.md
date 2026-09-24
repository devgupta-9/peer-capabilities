# Local AI system map

Shared authority: %USERPROFILE%\.ai-rules\MASTER-AGENTS-REFERENCE.md. This document is operational guidance, not an additional policy hierarchy. Editable sources and sync commands live in %USERPROFILE%\.ai-rules\README.md.

## Choose tools by task

Either host can lead. Use current discovery and the task's needs, not a fixed role allocation. Shared core MCPs are intentional; ecosystem-specific integrations need not be duplicated.

- peer-agents: exact lead-selected model/effort; bounded optional help; no default multi-agent pipeline.
- Graphify: local code relationships and impact navigation. Existing graph first; verify against current source. Prefer authorized local AST-only indexing.
- Headroom: compress genuinely large results; retain hashes and retrieve originals before exact comparisons or edits. It does not automatically choose skills, enforce routing, or prove every session uses a proxy.
- Jev: optional structured decision advice. The maintained @jkudish/jev-mcp package is shared by both hosts. Discover actual tools instead of assuming the legacy six-tool interface. No confidence threshold grants permission.
- Current docs: appropriate authoritative documentation tools or official sources.
- Browser: use the host browser for exploration, Playwright for reproducible flows, DevTools for runtime/network diagnosis when available. Avoid conflicting control of one browser session; honor each host's browser skill boundaries.

## Supporting files: load when relevant

- AI_SECURITY.md: approval implementation and credential boundaries.
- AI_CAPABILITIES.yaml: inventory semantics and shared tool expectations.
- AI_HEALTH.md: generated timestamped evidence; unknown means not tested.
- SKILL_PROFILES.yaml: optional starting points, not mandatory bundles.
- VENDOR_SCOPES.yaml: scope by actual purpose, not name prefixes.
- PROJECT_OVERLAY_TEMPLATE/: examples for project-specific context, constraints, tools, architecture, and a bootstrap pointer.

The sync script deploys global docs and curated skills only. It never rewrites project rules, credentials, host plugin caches, or remote resources.

## Evidence and memory

Current source/runtime outrank stale graphs, inventories, and memory. Project docs and ADRs capture intent; reconcile contradictions explicitly. Memory is context, not executable policy. Do not update memory or external planning systems without authorization.

## Health workflow

Run %USERPROFILE%\.ai-rules\scripts\validate.ps1 -Probe. It checks source/live hashes, supported local configuration expectations, executable existence and fresh MCP tool discovery. It does not assert remote authentication or successful model access. Reconnect hosts after registration changes and verify an in-session harmless call separately.
