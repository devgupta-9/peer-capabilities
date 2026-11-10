# Unified Context development deployment — 2026-11-10

The user authorized commit, push, local deployment and remote CI. The implementation
was committed on `phase1-runtime` as `d38351348fb2aee111f559b352b7b3994c19924b`.
The package remains private `0.4.0-dev.0`, with `releaseSupported` reported as false.

## Shipped scope

- Durable evidence-backed decisions, explicit supersession and source staleness.
- Required-evidence hydration and deterministic optional evidence selection.
- Task-scoped CLI/MCP metadata queries and complete validated evidence reads.
- Read-only retention planning across repository task history.

Physical archival, live session-delta certification and trusted host approval
production remain future work. The maintained baseline describes the implementation
and its verification boundaries. [Unified Context baseline](unified-context-baseline.md)

## Artifact and deployment

The package SHA-256 is
`c687c19145edaf4d823f96e4b595e2c4e4d189bc30c8e58bc39d608c91aab334`.

The installed runtime is
`%USERPROFILE%\.peer-capabilities\runtime-releases\c687c19145edaf4d\node_modules\@devgupta\peer-capabilities`.

All 93 package files match the tested source/build bytes. All four production
dependencies match the repository lock's versions and integrity hashes. Installation
used `--ignore-scripts`. The installed production dependency audit reported zero
vulnerabilities.

Operation `f5699e1b-5416-4a84-b686-e0dfeb7f7550` updated the peer bridge launcher
argument arrays in these existing host configurations.

- `%USERPROFILE%\.codex\config.toml`
- `%USERPROFILE%\.gemini\config\mcp_config.json`
- `%USERPROFILE%\.gemini\antigravity\mcp_config.json`

The applied preview digest was
`941b7ea6f3c44e126a53902ead801c0bd2494fa19abc20d138ab3312a9497f34`.
All three backup hashes match the preview's original-file hashes. Semantic checks
confirmed preserved credentials, permissions, disabled flags and unrelated settings.
The separately protected Antigravity permission file and Claude configuration
retained their hashes. A repeated preview returned zero changes.

## Verification

- Local build and full suite passed 254/254 tests. The final focused suite passed
  20/20 tests after the response-guidance change.
- Staged publication scan checked 14 files. Reachable-history scanning checked
  340 objects. Both scans reported zero findings.
- The installed package exposed eight task MCP tools. A fresh fixture verified
  task-scoped querying, exact Unicode evidence retrieval, mandatory hydration and
  retention planning through the installed modules.
- Remote verification of the implementation commit passed the Windows integration
  job and portable-core jobs on Windows, macOS and Linux. [GitHub Actions run](https://github.com/devgupta-9/peer-capabilities/actions/runs/42844415440)
- The fresh-process host doctor passed 15 probes, checked 232 managed files and
  reported zero drift and zero errors. It retained three existing warnings for
  Antigravity `artifactReviewMode`, `autoExecutionPolicy` and the CLI mutating-Git
  deny rule. Those permission settings retain their previous values.

These results establish package, deterministic-runtime and fresh-process evidence.
Existing desktop sessions require an MCP reconnect or new session to load the new
launcher. Live provider/account certification remains independently gated.

## Recovery

Original configuration backups remain under
`%USERPROFILE%\.peer-capabilities\host-configuration\f5699e1b-5416-4a84-b686-e0dfeb7f7550`.
The retained `6275098ba8a7e3cb` runtime supplies the previous bridge. Earlier
release trees also supply optional-integration paths and remain available.

Use the host reconciler's rollback with this operation ID after checking current
configuration hashes. It preserves later edits by rejecting conflicts. New decision
and `EVIDENCE_LINKED` events require a compatible runtime. Recover the corresponding
task-state backup or retain a compatible reader when considering a downgrade.
