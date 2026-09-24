# Peer Capabilities

Portable Windows setup for a shared Codex + Antigravity engineering environment. It installs the repository-owned policy, orchestrator, peer bridge, and local MCP registrations without publishing credentials.

## One-command install

Run in PowerShell 7:

```powershell
irm https://raw.githubusercontent.com/devgupta-9/peer-capabilities/main/bootstrap.ps1 | iex
```

This clones or fast-forwards the repository at `%USERPROFILE%\.ai-rules` and runs `install.ps1`. The bootstrap refuses to overwrite a different repository or a dirty checkout.

For a review-first installation, open [bootstrap.ps1](bootstrap.ps1), then run:

```powershell
git clone https://github.com/devgupta-9/peer-capabilities.git "$env:USERPROFILE\.ai-rules"
& "$env:USERPROFILE\.ai-rules\install.ps1"
```

Requirements: Windows, PowerShell 7, Git, Node.js 20+, npm, uv, Codex CLI, and Antigravity CLI (`agy`). Codex and Antigravity authentication remain interactive and are never stored by this repository.

## Installed components

- Canonical no-tier policy plus small Codex and Antigravity bootstrap files.
- Optional project-overlay and security/routing references.
- The peer-agents MCP bridge, built and tested from the included TypeScript source.
- Pinned Graphify `0.9.63`, Headroom `0.37.0`, and maintained Jev MCP `0.5.0`.
- Shared MCP registration in both hosts, using absolute executable paths discovered on the machine.
- Headroom MCP plus a local startup proxy on `127.0.0.1:8787`; Codex provider routing is installed with Headroom's supported command.
- Timestamped, secret-free health reporting and drift-safe synchronization.

The installer backs up replaced non-secret rule files, refuses conflicting live edits after initial deployment, and never imports `config.toml`, `mcp_config.json`, authentication databases, environment values, tokens, cookies, logs, or runtime state into Git.

Jev requires `TYPESAFE_API_KEY` in the user's environment for provider-backed decisions. The installer checks only whether it exists; it never reads, prints, or stores the value.

## Third-party skills

`skills-manifest.json` records the 100 locally curated skill names and their available provenance. The skill bodies are intentionally not published: 45 currently lack explicit license metadata. Existing local skills are preserved and synchronized when present, but a clean public install does not claim to redistribute or install those third-party works. Add skills from their original repositories after reviewing their licenses.

Codex `.system` skills and plugin-managed skills remain host-owned and are never copied by this project.

## Maintenance

```powershell
pwsh -NoProfile -File "$env:USERPROFILE\.ai-rules\scripts\sync.ps1"
pwsh -NoProfile -File "$env:USERPROFILE\.ai-rules\scripts\sync.ps1" -Apply
pwsh -NoProfile -File "$env:USERPROFILE\.ai-rules\scripts\validate.ps1" -Probe
pwsh -NoProfile -File "$env:USERPROFILE\.ai-rules\scripts\secret-scan.ps1"
```

The first command checks drift without writing. Apply performs a complete preflight, refuses independently changed live files, and creates recoverable non-secret backups under `%USERPROFILE%\.ai-rules-backups`.

After an MCP upgrade, restart/reconnect both hosts. A fresh-process probe proves discovery, not that an already-open session reloaded settings or that remote credentials/model access work.

## Source layout

| Path | Purpose |
| --- | --- |
| `MASTER-AGENTS-REFERENCE.md` | Shared canonical policy |
| `platforms/` | Small live host bootstraps |
| `orchestrator/` | On-demand routing, security, health, and project overlays |
| `peer-agents/` | Bidirectional MCP bridge source and tests |
| `tools/jev/` | Pinned maintained Jev runtime dependency |
| `scripts/` | Sync, validation, safety, and probe utilities |
| `integrations.json` | Secret-free portable expectations |

Original repository content is available under the [MIT License](LICENSE). Installed third-party tools and dependencies remain governed by their respective upstream licenses; see [THIRD_PARTY.md](THIRD_PARTY.md).
