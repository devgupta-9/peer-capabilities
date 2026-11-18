# Evidence archival and invocation recovery deployment — 2026-11-18

The user authorized commit, push to `phase1-runtime`, and local deployment.
Implementation commit: `5d9f705702d36191c27586709eb77428ffb55c7b`.
The package remains private `0.4.0-dev.0`, with `releaseSupported: false`.
No main-branch merge or public npm release was performed.

## Deployed scope

- File-scoped decision dependencies from the preceding source slice.
- Reversible evidence archival/restoration, exact reads and task replay.
- Durable resource-bound invocation intents, restart fencing and trusted-library
  reconciliation. Automatic interrupted-task replay remains disabled.

## Artifact and host changes

Package SHA-256:
`73660b2e7c9710002877c0a1e672931bbcd6abb8733c4a07f4a678b3b869c01c`.

Installed runtime:
`%USERPROFILE%\.peer-capabilities\runtime-releases\73660b2e7c971000\node_modules\@devgupta\peer-capabilities`.

All 97 packaged files matched the tested source/build bytes. All four production
dependencies matched repository-lock versions and integrity hashes. Installation
used `--ignore-scripts`; the installed production audit reported zero vulnerabilities.

Operation `815b558f-39a8-45f5-b298-636c8b782edb` changed only the peer bridge launcher
argument path in the existing Codex, Antigravity CLI and Antigravity IDE configurations:

- `%USERPROFILE%\.codex\config.toml`
- `%USERPROFILE%\.gemini\config\mcp_config.json`
- `%USERPROFILE%\.gemini\antigravity\mcp_config.json`

Reviewed preview digest:
`6e6f6129300530ed8575f9d8165ed8626c04a51bd32f480eef4ad4022675a1b4`.

All three backup hashes matched the pre-deployment files. Semantic comparison
confirmed that permissions, credentials, disabled flags, commands and unrelated
servers/settings were preserved. Protected Antigravity permission and Claude files
retained their hashes. A repeated preview reported zero remaining changes.
Jev and REA retained their separate runtime bindings.

## Verification

- The unchanged implementation passed the Windows build and **284/284** local tests.
- The staged secret scan checked 18 files with zero findings.
- All four implementation CI jobs passed: Windows integration and portable core on
  Windows, macOS and Linux. [Exact-commit run](https://github.com/devgupta-9/peer-capabilities/actions/runs/44260936251)
- The installed artifact passed archive/restore and durable-invocation restart
  smoke checks in a disposable fixture. Its fresh task MCP exposed all eight tools.
- Fresh-process host verification passed 15 probes, checked 232 managed files and
  reported zero drift/errors. It retained three existing warnings: Antigravity
  `artifactReviewMode`, `autoExecutionPolicy`, and the CLI mutating-Git deny rule.
  Their permission settings were preserved. An initial diagnostic invocation
  incorrectly supplied one global runtime path for both Peer Capabilities and Jev;
  rerunning with recorded per-component bindings passed without configuration edits.

Existing desktop sessions require an MCP reconnect or new session to load the
updated launcher. These checks do not establish live-provider/account certification.

## Recovery and schema boundary

Configuration backups remain under
`%USERPROFILE%\.peer-capabilities\host-configuration\815b558f-39a8-45f5-b298-636c8b782edb`.
The previous `c687c19145edaf4d` release and older optional-integration releases remain
available. Use the host reconciler's rollback with the operation ID after inspecting
current configuration hashes; it rejects conflicts with later edits.

Deployment changes launchers; it does not archive user evidence or reserve a live
provider invocation. First archival upgrades its task database to version 2. First
resource-bound reservation independently upgrades its runtime environment database
to version 2. Keep compatible state backups, stop old readers before these operations,
and do not downgrade upgraded state by changing version numbers or deleting journals.
See [ADR-011](../decisions/011-evidence-archival.md) and
[ADR-012](../decisions/012-durable-resource-invocations.md).
