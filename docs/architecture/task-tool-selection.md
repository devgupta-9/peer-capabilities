# Task-based tool selection

Status: development increment, 2026-10-21. Local agents/apps only; ChatGPT web was
explicitly excluded by the user. Not a public release or tool-execution engine.

## Shared local surfaces

`src/tool-selection.ts` is the deterministic selection boundary. The governed
runtime calls it automatically for lead/reviewer context packages and records plans
in `CONTEXT_PACKAGED` events. The peer bridge includes plans in delegated prompts.
CLI and MCP use the same function:

```powershell
node D:\peer-capabilities\peer-agents\bin\peer-capabilities.mjs tools select --objective 'Explain the architecture'
node D:\peer-capabilities\peer-agents\bin\peer-capabilities.mjs tools select --input task-tools.json
# Optional host-neutral local stdio surface; not automatically registered:
node D:\peer-capabilities\peer-agents\bin\peer-capabilities.mjs tools mcp
```

`select_task_tools` is exposed by the bridge, task runtime MCP and standalone
planning MCP. It has no repository, shell, credential or remote-server access.
Hosts without the bridge can use the CLI; registering the standalone server is a
separate scoped change. This does not add Claude as a peer adapter.

## Selection contract

| Need | Candidate | Prerequisites |
| --- | --- | --- |
| Source relationships / impact | Graphify `query_graph` | Current graph for the authorized repository; otherwise inspect source |
| Large eligible output | Headroom `headroom_compress` | At least 12,000 measured bytes, non-protected material, retained originals |
| Bounded decision | Jev `jev_decide` | Alternatives/evidence, provider authentication, data/cost permission |
| Patch/claim review | Jev `jev_gate` | Diff/claims and evidence; advice is not approval or observed tests |
| Shipped artifact / binary / runtime analysis | REA `binary_session` | Authorized scoped target; analysis effects need separate permission |

The byte threshold is a selection heuristic, not a context-window constant.
Protected or unclassified material is never selected for compression. Runtime
review evidence is always protected; this increment does not compress it.

English intent inference is deliberately small and imperfect. Explicit `needs`
replaces inference (including `[]`) for other languages or false positives, but
cannot override runtime disables or protection checks. No learned routing or model
fallback is introduced.

Every plan declares `execution: HOST_GATED`, `verification: NOT_PERFORMED`.
`SELECTED` means recommended, `DEFERRED` means missing task prerequisites, and
`SKIPPED` means irrelevant or disabled. These are not installation/authentication
states. Caller-supplied task facts are hints, never attested evidence or permission.

Before execution, discover the tool in the current session, preserve disabled flags,
verify prerequisites and apply existing permissions. The host binds actual targets
and evidence from the authorized task. Plans do not copy raw task content, paths,
credentials or executable arguments. Future connectors require validated handles
and execution receipts; the selector must not serve as their authorization check.

Unavailable optional tools never block tasks. Use source inspection, exact originals
and observed tests, reporting limitations. Runtime reports retain selection history
and explicitly report no optional tools executed by the runtime itself. Agent claims
are not independently observed usage evidence.

Existing conversations still require the host model to call the planner or follow
synced guidance; a server cannot force arbitrary models to invoke tools. New
code/schema requires one reconnect after upgrade, not one per project.

## Verification and app checks

2026-10-21: build/typecheck and **184 Node tests passed**. Tests cover deterministic
selection, irrelevant/disabled tools, protected evidence, strict inputs, prerequisites,
CLI/MCP parity, automatic runtime packaging, event replay, restart, single-agent and
quota-degraded operation with each integration disabled, including REA.

Observed in this Codex conversation:

- Headroom `headroom_stats`: success.
- Jev no-candidate `jev_extract`: success, `provider: none`, no provider call. This
  proves transport/function loading, not fresh provider authentication.
- REA `binary_session`: version 6.5.0 and expected server path aligned, no target opened.
- Graphify `graph_stats`: callable, but this repository has no project graph.
- Peer preflight: authorized; Codex 0.154.0 and Antigravity 1.4.4 discovered.
- Antigravity `gemini-3.8-flash-high` / `high`: bounded design review completed.
  A separate request for harmless MCP calls was blocked by headless permissions.
  No bypass or permission changes were made; those calls remain unverified.
- Claude Code was not found on PATH or in the standard user-native/npm locations.
  This does not prove absence everywhere; supply its executable location or use
  official installation before session testing.
- Claude Desktop and Antigravity IDE were not running when inspected. Configuration
  is not evidence of loaded tools.

In each remaining app, request: “Call Headroom headroom_stats and REA binary_session
only. Do not open a target or start analysis. Report actual success or permission
denial.” A separate Jev no-candidate extraction can verify transport without inference.
Do not relax blanket permissions to make checks green. Graphify needs an authorized
current project graph before functional graph queries.

The Antigravity design review identified optional-tool deadlock, target-binding and
intent-override risks. Recommendations are now explicitly non-blocking; execution
stays outside the planner; runtime disables/protected evidence override needs.
This was design review, not independent final-code review.

Remaining: observed invocation receipts, trusted connector execution, host-session
certification, resource-observation consumption and three-platform remote CI.

## Approved local deployment

The user approved the local update after verification. Development archive SHA-256:
`f7ccabe75a0fa0f20c8e4523c637d5c25038504ac143e46335edef10ec878016`.
Installed under `%USERPROFILE%\.peer-capabilities\runtime-releases\f7ccabe75a0fa0f2\node_modules\@devgupta\peer-capabilities`.

Host operation `96e2fc73-9392-49c0-b185-17ba0a8cd97a` updated only the peer-bridge
entrypoints in Codex, Antigravity CLI and Antigravity IDE. Semantic comparison
against private backups confirmed all non-launch settings, including permissions,
remained unchanged. The post-apply preview was empty. A stale first preview was
refused after Codex configuration changed; the refreshed plan preserved those edits.

The routing paragraph was promoted to the C-drive origin with a private backup,
then deployed through that origin's sync script: one file updated, 232 managed,
zero drift/conflicts on recheck. No Claude registration or provider permission was
changed. Old runtime artifacts remain available for rollback.

The installed artifact's CLI and fresh MCP `select_task_tools` call passed. The
current already-open chat still exposes the prior bridge schema: reconnect its
peer MCP once to load the new tool. Fresh-process success does not prove an existing
conversation reloaded. Three doctor regression tests and the publication secret
scan also passed. The tests require modern Python; the default machine Python 3.10
lacks `tomllib`, so they were rerun with the existing Headroom-managed interpreter.

The post-deployment broad doctor was **not fully green**: 10 fresh-process probes,
zero managed-file drift, and two peer-preflight failures reporting Antigravity CLI/
model discovery unavailable. All tool catalogs, including `select_task_tools`, were
discovered. Direct `agy --version` and a subsequent targeted probe using the actual
Codex registration succeeded with both CLIs, model discovery and workspace readiness.
This is evidence of intermittent availability, not proof its cause is fixed. The
three pre-existing Antigravity safety warnings remain unchanged. Keep this separate
from the successful code tests and from the headless MCP permission denial above.

Rollback host registration with `scripts/sync-hosts.ps1 -RuntimeRoot <installed-runtime>
-Rollback 96e2fc73-9392-49c0-b185-17ba0a8cd97a`. Do not downgrade a task database
that has new event payload fields into an older reader; older readers can reject
them. Keep the matching runtime and task history intact. No commit, push, npm
publication or remote CI run is included in this deployment.
