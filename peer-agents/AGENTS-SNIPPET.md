## Peer-agent workflow

Read %USERPROFILE%\.ai-rules\MASTER-AGENTS-REFERENCE.md for canonical policy.

- The lead owns model selection, integration, verification, and reporting.
- Discover models and supported reasoning efforts with peer_capabilities when needed.
- Select an exact model and effort per task; provide selectionReason. No capability tiers or silent substitutions.
- Use direct tools or Antigravity fast models for mechanical work; never delegate that work to Codex or choose lightweight Codex variants.
- Default to READ_ONLY or REVIEW. IMPLEMENT returns an isolated patch for lead inspection and verification.
- Delegate only for material benefit; depth is one. Peers must not delegate further through any mechanism.
- Report requested model/effort honestly; do not infer the active interactive model from configuration or CLI versions.
- Enable already-configured MCPs on demand within task scope, preserving permissions and verifying availability.
- Never send secrets, bypass permissions, or make unauthorized external/production changes.
