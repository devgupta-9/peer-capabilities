# Codex engineering bootstrap

For engineering work, read %USERPROFILE%\.ai-rules\MASTER-AGENTS-REFERENCE.md at the start of the task, once per context unless it changes. It is the shared policy. Read %USERPROFILE%\.ai-orchestrator\AI_SYSTEM.md when tool routing, synchronization, or project overlays matter. Load only relevant supporting files.

Editable source: %USERPROFILE%\.ai-rules\platforms\codex\AGENTS.md. Deploy through the origin's scripts\sync.ps1; do not maintain independent live copies.

## Codex-specific behavior

- The receiving agent remains responsible for integration and verification. Choose exact supported Antigravity model and effort through peer_capabilities/delegate_peer only when bounded delegation adds value.
- No capability tiers, lightweight Codex workers, silent model substitutions, or recursive delegation. Antigravity fast models may do suitable mechanical work. Delegation never changes this interactive session's model.
- READ_ONLY/REVIEW is the default peer mode; IMPLEMENT needs isolated ownership and reviewed, verified integration.
- Already-configured MCPs may be enabled on demand. Preserve permissions and credentials; check plugin settings separately. Verify discovery after reconnecting. Do not restore obsolete tier arguments for a stale bridge.
- AGENTS.md is this host's global entry. Do not create CODEX.md or copy vendor-managed .system/plugin skills into the shared curated set.
- Keep the main model separate from helpers in reports. Use plain language; omit unknown model fields and the old Execution footer.

If the master cannot be read, disclose it: preserve existing work; inspect before editing; never expose secrets; require user authorization for destructive, production, billing, credential, or external communication actions; verify proportionately and state what remains unverified. Do not invent missing policy.
