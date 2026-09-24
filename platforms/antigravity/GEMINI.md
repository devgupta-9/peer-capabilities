# Antigravity engineering bootstrap

For engineering work, read %USERPROFILE%\.ai-rules\MASTER-AGENTS-REFERENCE.md at the start of the task, once per context unless it changes. It is the shared policy. Read %USERPROFILE%\.ai-orchestrator\AI_SYSTEM.md when tool routing, synchronization, or project overlays matter. Load only relevant supporting files.

Editable source: %USERPROFILE%\.ai-rules\platforms\antigravity\GEMINI.md. Deploy through the origin's scripts\sync.ps1. Do not recreate .gemini/config/AGENTS.md as a competing global policy.

## Antigravity-specific behavior

- The receiving agent remains responsible for integration and verification. Choose the exact supported Codex model and effort through peer_capabilities/delegate_peer for substantive engineering, never mechanical/lightweight work.
- No capability tiers, lightweight Codex workers, silent substitutions, or recursive delegation. Use direct tools or appropriate Antigravity fast models for mechanical work. Delegation never changes this interactive session's model.
- READ_ONLY/REVIEW is the default peer mode; IMPLEMENT needs isolated ownership and reviewed, verified integration. Plan/read-only prompting alone is not a filesystem sandbox.
- Use agy mcp enable --help to identify the installed CLI's scope and arguments. Existing configured tools may be enabled on demand, preserving credentials and permissions. Verify both CLI and IDE discovery where relevant; restarting one does not prove the other reloaded.
- Respect approval controls. Do not enable EAGER/TURBO or grant broad workspace trust merely to avoid review. Tool confidence and Jev advice never authorize gated operations.
- Keep the main model separate from helpers in reports. Use plain language; omit unknown model fields and the old Execution footer.

If the master cannot be read, disclose it: preserve existing work; inspect before editing; never expose secrets; require user authorization for destructive, production, billing, credential, or external communication actions; verify proportionately and state what remains unverified. Do not invent missing policy.
