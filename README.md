# Peer Capabilities

Versioned Windows setup for a shared Codex and Antigravity engineering environment. It installs repository-owned policy, the peer bridge, local MCP registrations, validation, and synchronization without publishing credentials.

## Phase-1 development

The portable governance runtime is under development, separate from the released
v0.3.0 installer below. Start with the [original brief](docs/product/phase-1-brief.md),
[accepted architecture](docs/architecture/phase-1-plan.md), [ADRs](docs/decisions/README.md),
and [implementation evidence and remaining gates](docs/architecture/implementation-status.md).
The development runtime requires **Node 24+**. No platform combination is yet
release-certified, and the npm package remains private/unpublished.

From `peer-agents`: `npm ci --ignore-scripts`, `npm run build`, then
`node bin/peer-capabilities.mjs --help`. See the [runtime guide](docs/runtime-guide.md).
The managed-file setup engine does not yet replace the legacy tool installer.

## One-command install

Run the pinned `v0.3.0` release in PowerShell 7:

```powershell
irm https://raw.githubusercontent.com/devgupta-9/peer-capabilities/v0.3.0/bootstrap.ps1 | iex
```

The command clones or updates `%USERPROFILE%\.ai-rules`, checks out that exact release, shows a diff summary before changing an existing installation, and runs `install.ps1`. It refuses a different origin, a dirty checkout, or a non-Git target directory.

For review-first installation:

```powershell
git clone --branch v0.3.0 --depth 1 https://github.com/devgupta-9/peer-capabilities.git "$env:USERPROFILE\.ai-rules"
git -C "$env:USERPROFILE\.ai-rules" show --stat --oneline HEAD
& "$env:USERPROFILE\.ai-rules\install.ps1"
```

Historical v0.3.0 requirements: Windows, PowerShell 7, Git, Node.js 20+, npm, uv, Codex CLI, and Antigravity CLI (`agy`). The development checkout requires Node 24+. Authentication remains provider-owned and interactive.

## Inventory and ownership

### MCP servers managed by this installer

| MCP | Version | Purpose | Installed for |
| --- | --- | --- | --- |
| `peer-agents` | 0.3.0 | Bidirectional Codex/Antigravity delegation with exact model selection | Codex and Antigravity |
| `graphify` | 0.9.63 | Local project graph extraction and query | Codex and Antigravity |
| `headroom` | 0.37.0 | MCP tools plus the local Codex proxy on `127.0.0.1:8787` | Codex and Antigravity |
| `jev` | 0.5.0 | Provider-backed decision support; requires `TYPESAFE_API_KEY` | Codex and Antigravity |

`integrations.json` is the portable, secret-free registration source. Validation also inventories other MCPs already configured on the machine, but this project does not claim to install or manage those unrelated servers.

### Plugins

This repository installs **no host plugins**. Codex and Antigravity plugins are vendor/host-managed and can change independently. `scripts/validate.ps1` records their names and enabled state in the ignored, secret-free `reports/latest.json`; it never copies plugin credentials or plugin bodies into Git.

The locally enabled `codex-agy-plugin` is therefore not a dependency of the portable installer: the installer registers `peer-agents` directly with both hosts.

### Skills

`skills-manifest.json` is the complete list of **100 locally curated skill names**, sources, hashes, and available license metadata. It is the canonical readable inventory for this repository.

The skill bodies are deliberately not redistributed: 45 entries currently lack explicit license metadata. A fresh public install therefore installs no third-party skill bodies. Existing local skills are preserved and synchronized when a private `skills/` source directory is present. Codex `.system` skills and plugin-managed skills remain host-owned.

<details>
<summary>All 100 curated skill names</summary>

`antigravity-design-expert`, `api-and-interface-design`, `ask-matt`, `brain-to-docs`, `browser-testing-with-devtools`, `canvas-design`, `ci-cd-and-automation`, `ckw-design`, `claude-ally-health`, `claude-api`, `claude-code-expert`, `claude-code-guide`, `claude-d3js-skill`, `claude-delegate`, `claude-in-chrome-troubleshooting`, `claude-monitor`, `claude-scientific-skills`, `claude-settings-audit`, `claude-speed-reader`, `claude-win11-speckit-update-skill`, `code-review-and-quality`, `code-simplification`, `codebase-design`, `context-engineering`, `crossframe-critical`, `daily-gift`, `debugging-and-error-recovery`, `deprecation-and-migration`, `design-spatial`, `design-taste-frontend`, `deterministic-design`, `diagnosing-bugs`, `documentation-and-adrs`, `domain-modeling`, `doubt-driven-development`, `emil-design-eng`, `ffuf-claude-skill`, `folder-specific-claude-and-agents-md`, `frontend-slides-frontend-slides`, `frontend-ui-dark-ts`, `frontend-ui-engineering`, `full-output-enforcement`, `git-workflow-and-versioning`, `gpt-taste`, `graphify`, `grill-me`, `grill-with-docs`, `grilling`, `handoff`, `high-end-visual-design`, `idea-refine`, `implement`, `improve-codebase-architecture`, `incremental-implementation`, `industrial-brutalist-ui`, `linear-claude-skill`, `lookdev-auto`, `minimalist-ui`, `not-a-vibe-coder`, `observability-and-instrumentation`, `performance-optimization`, `planning-and-task-breakdown`, `ponytail`, `ponytail-audit`, `ponytail-debt`, `ponytail-gain`, `ponytail-help`, `ponytail-review`, `prototype`, `redesign-existing-projects`, `resolving-merge-conflicts`, `screenstudio-alt`, `security-and-hardening`, `setup-matt-pocock-skills`, `sharp-coder`, `shipping-and-launch`, `skill-improver`, `source-driven-development`, `spec-driven-development`, `spec-driven-loop`, `stitch-design-taste`, `tdd`, `teach`, `to-issues`, `to-prd`, `triage`, `ui-ux-pro-max`, `understand`, `understand-chat`, `understand-dashboard`, `understand-diff`, `understand-domain`, `understand-explain`, `understand-figma`, `understand-knowledge`, `understand-onboard`, `varlock-claude-skill`, `visual-emotion-engineer`, `writing-great-skills`, `writing-plans`.

</details>

## Installer behavior

The installer:

- builds and tests `peer-agents` and installs the pinned Jev runtime;
- installs Graphify and Headroom from version-pinned, hash-verified transitive dependency locks;
- deploys canonical Codex, Antigravity, and orchestrator rules with drift detection and backups;
- registers all four managed MCPs in both hosts using absolute executable paths;
- records both `PEER_AGY_BIN` and a native, directly launchable `PEER_CODEX_BIN`;
- configures and starts the local Headroom proxy;
- performs fresh-process MCP discovery and calls `peer_capabilities` to prove both peer CLIs are launchable.

### Antigravity safety policy

By default, installation backs up the affected files under `%USERPROFILE%\.ai-rules-backups\install-<timestamp>` and enforces:

- artifact review: `ALWAYS`;
- command auto-execution: `OFF`;
- browser JavaScript: `ALWAYS_ASK`;
- a CLI deny rule for mutating Git commands;
- removal of broad trusted roots such as the user profile, Windows System32, and an entire `D:` drive.

This behavior is intentional and is verified in strict mode. To preserve existing Antigravity safety settings, run `install.ps1 -SkipAntigravitySafety`; installation validation then treats differences as warnings instead of failures.

Command grants are **opt-in**: `-GrantAntigravityInspection` adds anchored, enumerated Git inspection rules for `command` and `unsandboxed`. These are global provider rules, not directory-bound sandbox permissions. Existing deny/ask rules are preserved and may still block them. No blanket execution grant, credential copying, or automatic sandbox downgrade occurs.

### Peer delegation safety

- Delegation requires a Git repository inside `PEER_AGENTS_ALLOWED_ROOTS`. When that variable is absent, the repository that launched the MCP server is the only allowed root. Multiple explicit roots use the platform path separator (`;` on Windows).
- Both providers receive task prompts through stdin. Antigravity uses its stream-JSON protocol, preserving plan mode without the Windows command-line length limit.
- Delegated Codex sessions explicitly disable their own `peer-agents` MCP. The depth environment guard and no-recursion prompt remain additional protection.
- `IMPLEMENT` writes Git's binary patch directly to disk, verifies it with `git apply --check`, hashes it, and only then removes the temporary worktree. Any export or verification failure preserves the worktree and partial patch for recovery.
- `READ_ONLY` and `REVIEW` remain best-effort modes. Git-status comparison is a tripwire, not a complete filesystem sandbox; the lead must verify results.

The Codex exclusion policy is configurable in `peer-agents/policy.json` or through an absolute `PEER_AGENTS_POLICY_FILE` path. There are no capability tiers or silent model substitutions.

For a new project, install with explicit project roots, for example `./install.ps1 -DelegationRoots 'D:\my-project'`. Reinstallation preserves existing roots when this argument is omitted; a fresh installation defaults to the origin repository only. The roots must be specific project folders, not entire drives or user profiles. Configure the corresponding trusted workspace and scoped read permission through Antigravity's settings; do not disable its permission system. Reconnect each host after registration changes.

Call `peer_capabilities` with the intended `cwd` before delegation: check `workspace.ready`, CLI availability, and `antigravity.modelDiscovery.status`. CLI installation alone does not prove a project is authorized or provider authentication is working. Model discovery permits a bounded 90-second cold startup and caches successful observations for 60 seconds; failures are reported explicitly, without stale-model fallback. See [Antigravity troubleshooting](peer-agents/README.md#antigravity-call-health).

Antigravity's OS sandbox is required by default. If the installed OS cannot support it, an explicit `-AntigravitySandboxMode permissions-only` registration retains provider permission checks but does not provide filesystem isolation. The bridge reports this choice and never downgrades automatically; reinstall preserves the explicit choice unless overridden. Do not confuse this with `--dangerously-skip-permissions`, which is never used.

### Verify Antigravity on your own machine

Setup and MCP discovery deliberately report authentication as `UNKNOWN` and live delegation as `UNVERIFIED`. They do not spend a model turn or log in for you. Complete the provider's official interactive `agy` login, choose an exact model from `agy models`, then run this from the installed checkout:

```powershell
node peer-agents/scripts/doctor-antigravity.mjs --cwd 'D:\my-project' --model gemini-3.1-pro-high --effort high --verify
```

Use an available model with matching effort. Add `--sandbox-mode permissions-only` only if you explicitly accept permission-controlled execution without OS isolation; otherwise sandboxing is required. Without `--verify`, the command performs discovery only.

The live check consumes provider quota, creates a temporary proof file in the selected repository, and requires observed file-read, exact `git status --short`, and `git rev-parse --show-toplevel` tool events plus the file's unpredictable proof value. Command workspace evidence and the observed Git root must match the requested project. It removes only its own file and empty directory. Failed checks exit nonzero and give a next action. No response text, provider diagnostics, credentials, or proof value is saved in the report. Verification is scoped to that machine/account/model/workspace and those operations, not arbitrary commands, all platforms, or an already-running host's MCP registration. Reconnect hosts separately after registration changes.

This readiness command is development-checkout functionality, not a claim that the pinned v0.3.0 bootstrap already includes it. Fresh-user and cross-platform live certification remain pending.

## Maintenance

```powershell
# Check drift without writing
pwsh -NoProfile -File "$env:USERPROFILE\.ai-rules\scripts\sync.ps1"

# Apply an approved source update
pwsh -NoProfile -File "$env:USERPROFILE\.ai-rules\scripts\sync.ps1" -Apply

# Portable validation; host-specific safety differences are warnings
pwsh -NoProfile -File "$env:USERPROFILE\.ai-rules\scripts\validate.ps1" -Probe

# Strict validation used by the default installer
pwsh -NoProfile -File "$env:USERPROFILE\.ai-rules\scripts\validate.ps1" -Probe -StrictSecurity

# Scan publication candidates without displaying secret contents
pwsh -NoProfile -File "$env:USERPROFILE\.ai-rules\scripts\secret-scan.ps1"
```

After an MCP or provider-routing update, restart/reconnect both hosts. Fresh-process validation proves discovery and CLI launchability, not remote credential validity, model-account access, or that an already-open session reloaded configuration.

## Source layout

| Path | Purpose |
| --- | --- |
| `MASTER-AGENTS-REFERENCE.md` | Shared canonical policy |
| `platforms/` | Small live host bootstraps |
| `orchestrator/` | On-demand routing, security, health, and project overlays |
| `peer-agents/` | Bidirectional bridge source, policy, and regression tests |
| `tools/jev/` | Pinned maintained Jev runtime dependency |
| `tools/graphify/` | Graphify input requirement and hashed transitive lock |
| `tools/headroom/` | Headroom input requirement and hashed transitive lock |
| `scripts/` | Sync, validation, safety, inventory, and probe utilities |
| `integrations.json` | Managed MCP registration expectations |
| `skills-manifest.json` | Complete third-party skill provenance inventory |

Original repository content is available under the [MIT License](LICENSE). Installed third-party tools and dependencies remain governed by their upstream licenses; see [THIRD_PARTY.md](THIRD_PARTY.md).
