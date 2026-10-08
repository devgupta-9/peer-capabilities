# Workspace authorization — Phase 0 amendment

Status: implementation under verification on `phase1-runtime`. This is not a
claim that every released Codex/Antigravity host implements MCP roots correctly.

Peer Capabilities automatically authorizes the active Git workspace under the
configured workspace policy. Additional repositories require explicit enrollment
or allowed-root configuration. Sensitive paths remain denied.

## Trust boundary

`WorkspaceAuthorizer` is the shared decision boundary for `peer_capabilities`
preflight and `delegate_peer`. The caller's `cwd` is a request, never a grant.
All filesystem comparisons reuse Phase-0 `DirectoryIdentity`, physical ancestry,
and object identity. No lowercase path comparison or drive-wide auto trust exists.

The bridge asks the connected, trusted local MCP host for its roots **on each
request**. The installed SDK supports legacy `roots/list` and modern
`input_required` roots exchange. These values arrive through the host protocol,
not through model-visible tool parameters. Roots must be local file URIs whose
directories resolve inside Git repositories. A host listing a parent drive or a
non-Git projects directory does not authorize its child repositories. A host
listing a Git subdirectory authorizes only that subtree of that repository.
Multiple user-opened roots are treated as one multi-root workspace.

An explicitly empty root list revokes active access. A failed, invalid, or
unsupported root exchange must not fall back to caller-supplied paths. If the host
does not advertise roots at all, the server's pinned **startup Git repository**
is the fallback. It does not follow a later project switch inside that same
roots-incapable host. A roots-capable host, a new project-scoped server launched
normally by the host, or explicit enrollment is needed in that case. The product
must not label this limitation as automatic host integration certification.

Sources: [MCP roots](https://modelcontextprotocol.io/specification/2025-06-18/client/roots)
and the installed `@modelcontextprotocol/server` v2 contract. Host roots depend on
the host enforcing user workspace consent; a malicious host or an unsandboxed
same-user process is outside this boundary. No prompt text proves consent.

## Policy precedence and migration

1. Sensitive-path, invalid-identity, and operation denial override every grant.
2. `AUTO_ACTIVE`: host workspace + enrolled repositories + explicit roots.
3. `STRICT_ROOTS`: explicit roots only; neither host roots nor enrollment broaden it.

`PEER_AGENTS_WORKSPACE_MODE` chooses the mode. Without a mode, existing nonempty
`PEER_AGENTS_ALLOWED_ROOTS` retains strict behavior. Without either, the default is
`AUTO_ACTIVE`. Fresh installer registrations explicitly set `AUTO_ACTIVE`; old
ambiguous root-only registrations remain strict and display migration guidance.
`-WorkspaceAuthorizationMode AUTO_ACTIVE` is an explicit policy-owner migration,
not a step repeated for each project. Conflicting host policies require an explicit
choice. Existing root values are preserved unless deliberately replaced.

`PEER_AGENTS_ALLOWED_ROOTS` is backwards-compatible explicit scope; under auto mode
it adds cross-project access. `-DelegationRoots` is optional, not the normal
new-project workflow. Never configure whole drives or profiles as trusted roots.

## Environment control registry

Version 1 registry: `~/.peer-capabilities/control/environment.sqlite`, environment
domain, independent of task events and the per-managed-root ownership ledger.
It uses the existing SQLite/transaction infrastructure. Tables:
`workspace_registry_meta` (version and control-directory identity),
`workspace_projects` (stable physical ID, canonical/display root, filesystem
identity, enabled flag, enrollment mode, timestamps). There are no credentials.
`PEER_AGENTS_WORKSPACE_REGISTRY` is an operator/test override, not a tool argument.

Reads reopen the registry per request. Enrollment and revocation are transactional
and immediately visible in existing MCP processes. Unknown schemas, corruption,
redirected control paths and replaced project identities fail closed. No automatic
adoption/migration of unknown state occurs. Remove stale enrollment explicitly
before enrolling a moved/recreated project; never inherit trust by name alone.

Operator commands (development CLI: `node peer-agents/bin/peer-capabilities.mjs`):

```text
peer-capabilities project add <absolute-repository-path>
peer-capabilities project remove <absolute-enrolled-root>
peer-capabilities project list
peer-capabilities project check <absolute-path>
```

These commands administer additional persistent trust; ordinary active projects
do not need enrollment. They are not exposed as MCP tools. Delegated children are
blocked by the recursion guard. As with host configuration, an unsandboxed process
running as the owner can change control state; deployment must preserve OS/host
sandbox restrictions. CLI invocation is not a human-approval proof.

## Sensitive locations and operation limits

Global SSH/cloud/provider stores, browser profiles, Windows system/application
locations, Peer Capabilities private/control state, and equivalent Unix/macOS
stores are denied by canonical physical ancestry. `PEER_AGENTS_DENIED_ROOTS` adds
operator denials. Project-local `.codex` files are not confused with the global
credential store. Symlinks/junctions cannot borrow the identity of their lexical
parent. Replaced trusted roots fail closed instead of being repinned silently.

This is **working-directory authorization**, not an OS filesystem sandbox.
Provider sandbox/permissions still control subsequent file/tool access, including
links encountered inside an otherwise authorized repository. The existing
READ_ONLY/REVIEW Git-status tripwire is not complete write prevention. IMPLEMENT
still uses the isolated worktree/verified-patch workflow; this change grants no
direct primary-checkout mutation, integration, deployment, or human approval.

## Preflight and evidence

Preflight returns `repository`, `authorizationMode`, `authorizationSource`,
`activeWorkspace` (boolean), `crossWorkspace`, `ready`, `reason`, and `nextAction`.
The field is named `authorizationMode` rather than `authorization` so it does not
collide with the shared secret-redaction rule for HTTP Authorization credentials.
Sensitive-denial responses omit sensitive paths. No registry listing is sent to
providers. `ready` means workspace eligibility, not provider authentication.

Acceptance tests cover active/descendant/new repositories, unenrolled cross-repo
denial, explicit roots, strict migration, sensitive paths, symlink escapes,
identity replacement, registry version rejection and **one live MCP process**
observing host-root changes plus CLI enrollment/removal.

## Execution ledger

- Boundary and registry tests: observed failing before implementation; initial
  policy and same-process MCP tests now pass locally.
- Ruling: ambiguous legacy root configurations remain strict. Broadening requires
  an explicit owner choice; otherwise migration could violate administrator intent.
- Ruling: use `authorizationMode` to preserve existing secret redaction unchanged.
- Ruling: roots-incapable hosts cannot be made aware of an in-process project
  switch from an agent-supplied path. Preserve denial, document the limitation,
  and require host evidence before universal no-restart certification.
- Independent review: GPT-6 Astra/High found mixed-policy migration, enrollment
  alias revocation, and obsolete historical-root dependencies. All three were
  reproduced as failing regressions and fixed in the same change. No provider
  permissions were changed for this review.
- Startup probing now advertises its explicit fixture workspace and labels that
  result `simulated-probe-host`; validation does not pass it off as actual host
  roots support. Fresh installer roots are empty rather than implicitly enrolling
  the origin repository.
- Local verification: typecheck and all 133 bridge/runtime tests passed, alongside
  installer-root tests, sync safety, staged/history secret scans, and package
  dry-run inspection. Both production dependency audits reported no vulnerabilities.
- Pending: exact-change three-platform CI and live host integration evidence.
  Provider sandbox enforcement remains an
  independent host capability, not something this cwd policy certifies.
