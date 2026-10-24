# Antigravity headless MCP and desktop checks

Status: local development fixes; not a release or cross-platform certification.
This report updates the remaining checks in [task tool selection](task-tool-selection.md).

## Diagnosis and scoped permission change

Antigravity CLI 1.4.4 had no MCP allow rules in its CLI settings. Headless runs cannot
ask for approval; default-Ask tools can be soft-denied even when the process exits
successfully. See the official [headless guide](https://www.antigravity.google/docs/cli/headless/)
and [permissions reference](https://www.antigravity.google/docs/permissions?tab=cli).

The user explicitly approved exactly these two local diagnostic rules:

```text
mcp(headroom/headroom_stats)
mcp(rea/binary_session)
```

They were appended to `%USERPROFILE%\.gemini\antigravity-cli\settings.json` after
a private adjacent backup (`settings.json.mcp-diagnostics-20261021-202911.bak`).
Semantic comparison confirmed every other setting and existing rule was unchanged.
This does not allow all MCPs, Jev inference, REA analysis, command execution, or
permission bypass. Existing deny/ask precedence and sandbox configuration remain.
Other installations must obtain their own approval; setup does not add these rules.
Older `unsandboxed(...)` entries were reported ignored by CLI 1.4.4; they were not
silently converted into additional grants or removed during this scoped change.

## Discovery mitigation

Two simultaneous catalog probes timed out after their 90-second bounds (roughly
98 seconds including termination); their simultaneous version probes took about
9 seconds against the old 10-second bound. An isolated catalog probe succeeded in
51 seconds. Provider logs showed catalog startup also initialized MCP services.
This supports reducing probe fan-out, not a claim that all provider outages share
one cause.

Development changes:

- Doctor finishes ordinary MCP probes before checking peer registrations serially.
- Version discovery coalesces concurrent requests within a bridge, caches successful
  observations for 60 seconds, and allows 30 seconds for cold startup.
- CLI and catalog status/timing are separately reported. A catalog success proves
  CLI availability even when the independent version check timed out.
- Failed/cancelled/truncated observations are never cached as successes. No stale
  catalog, automatic retry, model replacement, or authentication workaround is added.
- Successful MCP completion records contain only validated server/tool names, never
  arguments or results. Large externalized outputs also count as completion; this
  is not blanket verification of every backend exposed by the tool.
- Soft denials in tool events remain fatal even if the model reports success.

Concurrent independent hosts may still perform their own provider requests. The
patch does not add a global daemon/lock or promise upstream availability.

## Live and desktop evidence

Exact requested helper: Gemini 3.8 Flash High, high reasoning, READ_ONLY; no model
fallback. A first test supplied an invalid REA `action` argument; that was a test
error, not a permission failure. The actual `binary_session` diagnostic schema
accepts `{}` and does not start target analysis.

- Headroom: successful `headroom/headroom_stats` completion observed in the AGY stream.
- REA: the corrected `rea/binary_session` call completed. AGY externalized the large
  response; its tool artifact contains REA 6.5.0 server identity. No analysis target
  was opened. The original evidence parser missed externalized output; regression
  coverage now preserves completion metadata without reading its contents.
- Claude Desktop: installed app launched to a signed-in new-chat screen. No diagnostic
  prompt was submitted. Window capture failed with `FrameArrived timed out` /
  `window capture timed out` after bounded recovery, so tool use remains unverified.
- Antigravity desktop/IDE: not running at initial app discovery; no desktop tool call
  was verified. Headless CLI evidence does not certify the desktop host.

Desktop handoff: in a new app conversation, request “Call Headroom headroom_stats
with {} and REA binary_session with {} only. Do not open a target or start analysis.
Report each actual result or denial.” Review any host permission prompt yourself;
do not approve blanket access. Capture actual tool results, not the model's claim.

No ChatGPT web integration, credential changes, commit, push, publication, or remote
CI execution is part of this increment. New development code is not automatically
the runtime loaded by an already-open app; deployment and reconnect evidence must
be reported separately.

## Verification and approved deployment (2026-10-22)

- `npm test`: **188 passed, 0 failed**. A preceding direct `node --test` run failed
  only the packaging test's required npm environment; the correctly invoked complete
  suite passed. No production assertion was weakened.
- Doctor regressions: **4 passed**, including non-overlapping provider probes.
- Build/type compilation, focused probe tests, secret scanning and diff checks passed.
- User-approved development archive SHA-256:
  `511367212dd5b3d51cd003c02a187aeb59dec0ad7718005c95f6f3a8c135ee14`.
  Installed under `%USERPROFILE%\.peer-capabilities\runtime-releases\511367212dd5b3d5\node_modules\@devgupta\peer-capabilities`.
  Installed bridge modules match the tested build by hash.
- Operation `919678e8-bbbe-4204-9899-22ab96bc3e0f` updated only the three peer bridge
  launchers (Codex, Antigravity CLI and IDE). Repeat preview was empty. Old runtimes
  and private operation backups remain available; Claude registrations were untouched.
- Only `scripts/validate.py` and `scripts/probe.mjs` were promoted to the C-drive
  rules origin. Their hashes match development. Previous copies remain under
  `%USERPROFILE%\.ai-rules-backups\agy-reliability-9fd82d71b3df449f9116ed009c90a928`.
- Backup comparisons confirmed every non-launch setting was preserved in all three
  host configurations. The post-deployment doctor run from the authoritative C-drive
  origin passed: **10 probes, 232 managed files, zero errors and zero drift**.
  Three prior warnings remain: two Antigravity review-setting differences and the
  deny-rule validator warning. Those policies were not expanded as part of this fix.
  A prior diagnostic from the development checkout lacked the origin's deployment
  ledger and reported source drift; it is not the authoritative managed-install check.
- The resumed desktop check failed even at `list_apps`; active desktop tool calls
  remain unverified. Do not equate the successful CLI calls with desktop certification.
- Current Codex-chat `peer_capabilities` exposed the new `cliDiscovery` fields after
  deployment: workspace ready, CLI AVAILABLE in 1,277 ms and catalog AVAILABLE in
  27,961 ms. This proves this chat loaded the updated bridge, not that either desktop
  agent conversation has done so. A successful sample is not an outage guarantee.

An existing long-lived MCP process can retain its old code until reconnect. This is
a code-update reload, not a requirement to re-enroll/restart for each new repository.
Host rollback: `scripts/sync-hosts.ps1 -RuntimeRoot <installed-runtime> -Rollback
919678e8-bbbe-4204-9899-22ab96bc3e0f`; it refuses conflicting subsequent user edits.

## Dependency-audit follow-up

The previously deployed runtime's dependency audit is **not clean**. It flags the pinned MCP server SDK
2.0.0 (and the dependent root package) as high severity. The advisories concern
[shared HTTP server/transport instances](https://github.com/advisories/GHSA-jm63-cq47-j5jp),
[HTTP input-validation resource exhaustion](https://github.com/advisories/GHSA-46jr-4wx8-v453),
and [HTTP bearer-token audience validation](https://github.com/advisories/GHSA-rvq5-wwqv-78pq).
The first two explicitly exclude stdio-only servers; the third requires HTTP
authentication middleware. Inspection found only local stdio MCP entrypoints here, without the
affected HTTP/auth helpers. This is a scoped reachability assessment, not suppression
of the audit or a claim that the SDK is generally safe.

This finding is addressed by the qualified SDK update and separately approved local
deployment below. The old release remains only for rollback. HTTP deployments would
additionally need the documented per-session lifecycle, input limits and audience
configuration. No HTTP surface is introduced here.

## SDK qualification and desktop retry (2026-10-22)

- Exact server SDK pin upgraded from **2.0.0 to 2.3.0**, with core **2.3.0** resolved
  in the lockfile. No bridge permission, transport or authentication change was
  needed. See the official [2.3.0 release notes](https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/v2.3.0).
  Upstream also corrects the SDK package license metadata to Apache-2.0.
- Build passed; complete `npm test`: **188 passed, 0 failed, 0 skipped**. Coverage
  includes installed-package dependency versions, legacy and modern MCP sessions,
  roots-change handling, dynamic enrollment/revocation, and restartable workflows.
- `npm audit --omit=dev --json` reports **zero vulnerabilities** for the development
  dependency tree. This is an audit observation, not a general security guarantee.
- At qualification time the live release still contained SDK 2.0.0; deployment
  awaited separate user approval. The subsequent approved deployment is recorded below.
- Claude launched, but its accessibility view remained an empty document shell;
  screenshot capture timed out. No current authentication or MCP success is inferred.
- Antigravity exposed a conversation composer through accessibility. Attempting
  to open a fresh diagnostic conversation failed with `coordinate input geometry
  is unavailable`; refreshed window capture then failed with `window capture timed
  out: timed out waiting on channel`. Automation stopped after bounded recovery.
  No diagnostic prompt was submitted, and no permission or update prompt was acted on.

Desktop MCP checks still require a usable app session and the actual diagnostic
tool results described above. The automation failure is not evidence that the
MCP servers themselves failed. Configuration deployment alone does not establish
that an already-open conversation has reloaded its MCP process.

## Approved SDK deployment (2026-10-22)

- Archive SHA-256:
  `6a0273ecd5dd2743e169fc67a237e0edcb8aae17efa9a07bb85beed9fdc9cc4f`.
  Installed with lifecycle scripts disabled under
  `%USERPROFILE%\.peer-capabilities\runtime-releases\6a0273ecd5dd2743\node_modules\@devgupta\peer-capabilities`.
- All **83 installed package files** match the development build. All **72 runtime
  files** are identical to the prior deployed bridge; this increment changes its
  dependencies, not bridge behavior or permissions. Server/core **2.3.0**, Zod
  **4.6.5**, and smol-toml **1.9.1** match the tested lockfile exactly.
- The installed runtime's `npm audit --omit=dev --json` passed with **zero known
  vulnerabilities**. Build passed again before packaging; the qualification suite
  above remains the test evidence for this unchanged build.
- Reviewed preview digest:
  `232b1d18c77b3a40f89682d4c06aaa6763cc5517ba6cac269126d7ffe2849c26`.
  Operation `fc33ce9c-9f4c-4ac4-b766-d14589451242` completed for exactly Codex,
  Antigravity CLI and Antigravity IDE. Repeat preview contained **zero changes**.
- Private backups remain under
  `%USERPROFILE%\.peer-capabilities\host-configuration\fc33ce9c-9f4c-4ac4-b766-d14589451242`.
  Semantic comparisons against all three backups prove only the peer entrypoint
  argument changed. Launch executables, environment, permissions, disable flags,
  credentials and unrelated settings were preserved. Independent file hashes
  confirm Claude configurations and Antigravity CLI permission settings were untouched.
- No origin policy/doctor changes, additional permission grants, commit, push,
  public package publication or desktop approval action are part of this deployment.
- Fresh doctor run from the C-drive origin at **2026-10-22T14:18:55Z** passed for
  all three updated hosts: **15 probes, 232 managed files, zero errors, zero drift**.
  The same three pre-existing review-setting/deny-validator warnings remain;
  no security setting was changed to remove them.
- Current-chat `peer_capabilities` succeeded for the development repository: workspace
  ready via its existing explicit root, both agent CLIs available, Antigravity model
  catalog AVAILABLE in **17,099 ms**. The CLI reported **1.4.5** in this observation;
  the SDK deployment did not install or update the provider CLI. This confirms this
  chat's bridge call works, not an Antigravity/Claude desktop conversation or every
  provider model. Desktop session checks remain unverified as described above.

Rollback uses `scripts/sync-hosts.ps1 -RuntimeRoot <new-installed-runtime> -Rollback
fc33ce9c-9f4c-4ac4-b766-d14589451242`; conflicting later edits are refused. The
previous runtime is retained, not deleted. Existing MCP processes may need a host
reconnect to load the new SDK; this is a code-update reload, not per-project setup.

## Catalog-independent explicit delegation (2026-10-22)

Reproduced against the installed bridge: CLI **1.4.5** version discovery succeeded
in **640 ms**, while `agy models` timed out after **90,272 ms**. A subsequent real
no-tool delegation to `gemini-3.8-flash-high` with high effort returned the exact
`AGY_BRIDGE_SMOKE_OK` marker in **45.32 seconds**. Catalog discovery and inference
are separate operations: a discovery failure does not establish inference failure.

The bridge previously awaited a catalog refresh before every explicit AGY dispatch
when its 60-second cache expired. This created an additional failure point before
the requested agent invocation even started.

Development fix:

- `delegate_peer` validates the explicit model slug, supported effort and suffix
  locally, then invokes that exact AGY model without another catalog command.
  Automatic/default model aliases are rejected; no silent model substitution,
  automatic task replay, stale catalog fallback or permission bypass is added.
- Model existence and account access remain provider-owned. The official
  [headless error contract](https://www.antigravity.google/docs/cli/headless/#handle-exit-codes-and-errors)
  rejects unknown model selections; the live negative test below checks that behavior.
- `peer_capabilities` still reports catalog availability honestly and advertises
  `modelDiscoveryRequiredForDelegation: false`. Successful AGY results identify
  `antigravityModelValidation: PROVIDER_CLI`. Discovery remains the way to find
  choices; callers must supply an exact model, never an implied default.
- Codex catalog restrictions, scheduler discovery, workspace authorization,
  READ_ONLY/REVIEW rules, worktree isolation, recursion control, and provider
  permissions are unchanged. Authentication, quota and provider outages remain
  real failures, not successes hidden by retries.

Verification:

- A deterministic regression using a CLI that cannot list models failed before
  the fix at catalog discovery and now reaches the explicitly requested invocation.
  Additional policy tests reject malformed/automatic pins and unsupported efforts.
- Targeted model-policy, protocol and Antigravity tests passed; build passed.
- The complete `npm test` suite subsequently passed. Secret scan covered **161
  tracked/untracked files with zero findings**; the diff whitespace check passed.
- Through the development bridge with the existing host environment, the valid
  real-model no-op returned the exact marker in **69.54 seconds**, with no tool
  calls/failures and `PROVIDER_CLI` validation. This is functional evidence, not a
  latency improvement claim: provider response times vary.
- An intentionally nonexistent model was rejected by the actual AGY CLI, with
  no response or fallback. The installed dependency audit remains clean.

### Approved local deployment (2026-10-23, Asia/Calcutta)

Deployed the reviewed archive to release `74f57d25239ed725`. Archive SHA-256:
`74f57d25239ed725d634d91e56e76d9e81fe4dee41993d5035018eaec56fbf65`.
All **83 packaged files** match the tested development build; the installed
production dependency audit reports **zero vulnerabilities**.

Reconciliation operation `51af16dc-e501-4a45-b8c0-772bd5828669` changed only the
`peer-agents` launcher arguments in Codex, Antigravity CLI and Antigravity IDE.
The applied preview digest matches the approved preview. All three original
configuration backups were verified, and semantic comparisons confirmed that
every other configuration value was preserved. Four protected-file hashes
(Claude configurations and Antigravity permissions) were unchanged. A second
preview reports **zero changes**. The previous release `6a0273ecd5dd2743` remains
available; the reconciliation journal and private backups support rollback.

A fresh bridge process launched from the installed registration successfully
called `gemini-3.8-flash-high` / `high` in READ_ONLY mode and returned the exact
`AGY_INSTALLED_FIX_OK` marker in **88.639 seconds**, with `PROVIDER_CLI` model
validation. This confirms the installed path, not merely the development copy.

The final C-drive-origin doctor observation at **2026-10-22T19:24:56Z** passed
**15 probes**, with **232 managed files**, **zero managed-file drift** and
**zero errors**. The three prior warnings remain: `artifactReviewMode`,
`autoExecutionPolicy`, and the mutating-Git deny-rule validator warning. Those
settings were not changed to suppress warnings. The publication scanner checked
**161 files**, found no secrets, and `git diff --check` passed.

This removes the reproduced catalog prerequisite failure; it cannot guarantee
provider availability, authentication, quota, or latency. The existing chat's
native capability call still omits the new `modelDiscoveryRequiredForDelegation`
metadata, indicating that its running bridge has not reloaded. Reconnect that
MCP session, or restart the host once, to load the approved launcher; fresh
processes already use the verified fix. No permissions were expanded, and no
commit, push, or package publication was performed.
