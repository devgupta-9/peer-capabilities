# Identity and Resource Contracts

Status: local development implementation, updated 2026-10-29. Not release-qualified.
Scope: resource contracts, environment persistence, scoped observations, opt-in dispatch consumption, read-only diagnostics and trusted collection lifecycle.

## Boundary and rationale

The existing `Choice` fields are insufficient to distinguish multiple accounts,
frontends and shared quota pools. Add a validated metadata boundary first; do not
infer account identities from CLI names, copy credentials, or rewrite task history.
Legacy configurations retain their existing scheduler/adapter behavior. The opt-in
dispatch increment below consumes explicit bindings without inferring identities.

| Record | Meaning |
| --- | --- |
| Provider | Model service identity, independent of the frontend |
| AgentFrontend | CLI/host identity; may expose multiple providers |
| Account | Provider-owned account/workspace alias and resource-use policy |
| AuthContextRef | Non-secret provider-owned handle scoped to account and frontend |
| QuotaPool | Shared capacity identity within an account; no invented quota numbers |
| Model | Provider-scoped exact model, supported efforts and declared context capacity |
| ModelAccessBinding | Explicit model access through one auth context and quota pool |
| Worker | Frontend/auth-context execution identity plus declared capability profile |
| CapabilityProfile | Declared roles, tool features and competence; not certification |
| CapabilityContract | Versioned role, feature, competence, context and exact-effort requirements |

`validateResources(unknown)` validates schema version 1, bounded strict records,
unique IDs per record kind, references and ownership across the catalog.
`validateCapabilityContract(unknown)` validates one consultation's requirements.
`resolveResource(catalog, {workerId, bindingId}, contract)` resolves only the exact
requested pair, checking static compatibility. It never chooses another account,
model, worker or effort. Return data is a detached validated snapshot.

## Security and authority

- The input boundary is untrusted metadata, not authorization or login evidence.
- Shared secret rejection runs before parsing. Unknown fields fail closed, including
  credential fields and claims such as `authenticated: true`. Errors do not echo input.
- Auth handles are bounded opaque labels, not URLs, paths or credential storage.
  Recognizable secrets are rejected; pattern scanning cannot detect every opaque secret.
- A binding's model provider must match its account's provider, and its quota pool
  must belong to that account. Worker and binding must use the same auth context.
- Multiple frontends may share an account/pool; that does not create extra capacity.
- Only ACTIVE accounts and enabled bindings/workers resolve in this increment.
  RESERVE, EMERGENCY_ONLY, MANUAL_ONLY and DISABLED are represented but blocked.
  No reserve-unlock or account-rotation mechanism is introduced.
- Static compatibility is not permission to dispatch. Authentication observations,
  quota availability, privacy, repository authorization and human gates remain required.
- The initial metadata increment changes no auth flow, scheduler routing or installed-host configuration.

## Environment persistence — second increment

The existing `EnvironmentManager` owns resource storage in its existing
`environment.sqlite`. No new database, task tables, credentials, or workspace
enrollment authority is introduced. Its pinned root identity is checked on every
resource operation.

- `readResources(revision?)`: latest or historical validated snapshot, or null.
  Reads do not create resource tables in an existing environment database.
- `saveResources(catalog, expectedRevision)`: validates before mutation and appends
  one canonical snapshot with revision, content digest and timestamp. First write
  expects revision zero. No implicit merge or last-writer-wins update.
- `restoreResources(sourceRevision, expectedRevision)`: appends the selected prior
  catalog as a new revision with explicit provenance; history is never rewritten.

An additive `resource_schema` version 1 identifies `resource_catalogs` independently
of the environment base schema. Initialization and writes run under BEGIN IMMEDIATE
using the existing transaction helper. Partial/unknown resource schemas are rejected,
not silently adopted. Stale revisions and failed SQL writes leave prior state intact.
Reads validate both the catalog and its digest; corruption blocks updates rather
than being repaired by overwriting evidence. Digests detect corruption, not malicious
same-user database rewriting. Retention remains future work; no data is pruned.

## Scoped observations — third increment

`EnvironmentManager.recordResourceObservation(value)` appends validated observations
to independently versioned `resource_observation_schema` / `resource_observations`
tables in the same environment database. `getResourceObservation(scope)` returns
`CURRENT` plus the latest observation, or `UNKNOWN`, `EXPIRED`, or
`CONFIGURATION_CHANGED` without usable evidence. Existing component observations
remain separate and are never promoted into scoped verification.

- Scope is the exact worker, binding, role, effort, frontend version and non-secret
  configuration digest. The runtime collector must supply the actual version and
  digest; no agent-callable observation writer is exposed.
- Authentication, availability and verification remain distinct. A service outage
  does not imply logout. Unknown availability is explicit, not assumed success.
- `VERIFIED` requires a functional probe, authenticated or auth-not-required state,
  and usable availability. Discovery cannot establish authentication. Evidence
  stores only a method and content-hash reference, never raw provider responses.
- Writes require the current resource revision and strictly increasing observation
  time for that scope. Newer failures supersede successes; delayed successes are
  rejected. Future timestamps and invalid expiration intervals are rejected.
- Reads never extend expiration. Relevant worker, model, profile, binding, account,
  auth-context, quota-pool or frontend changes invalidate evidence. Every intervening
  catalog revision is checked, so restoring a configuration does not revive old
  evidence. Unrelated catalog additions do not invalidate it. A fresh probe can
  establish new evidence against the current revision.
- Reads and writes use the existing transaction helper for consistent snapshots.
  Partial/unknown schemas and corrupt observation contents fail closed. Root
  identity checks and shared secret rejection apply to both entry points.

Observation metadata is not cryptographic provider proof, policy authorization,
quota reservation or competence certification. These APIs are for trusted runtime
collectors; live collectors remain deferred. Opt-in scheduler consumption is
described below. History
checks currently scale with intervening catalog revisions; before high-frequency
routing, evaluate cached invalidation generations without weakening rollback safety.

## Follow-on increments

1. Implement trusted scoped collectors and certify how each frontend identifies
   its actual provider-owned context. Never promote discovery or a generic login
   result into model/role/tool verification. Keep this separate from credentials.
2. Scoped doctor and the internal collection/failure-feedback lifecycle are now
   implemented below. Certify migration and live single/N-agent paths next.
3. Measure model-specific competence and tool evidence before treating declared
   profiles as certified capabilities. Learned routing remains deferred.

Existing Phase-0 follow-up changes are preserved separately in the working tree.
Their pending commit/push and exact-SHA three-platform CI remain open gates.

## Verification — 2026-10-12

Windows: build passed; full suite 144/144 passed, including eight new resource
contract tests. Targeted tests also passed after adjusting synthetic credential
construction for the publication scanner. Current-content scan and production
dependency audit passed (zero findings/vulnerabilities). No live model calls,
configuration deployment, database migration, commit, push or new remote CI run.

## Verification — 2026-10-13

Windows: build and full suite 151/151 passed, including seven new persistence
tests. Coverage includes fresh managers, a separate-process read, stale writers,
append-only restore, unknown schema, corrupt contents, root replacement, rejected
secret input and SQL-failure rollback/retry. Current-content secret scan passed.
Only disposable fixture databases were migrated; no live environment state,
scheduler configuration, credentials, commit, push or remote CI was changed.

### Scoped-observation verification — 2026-10-13

Windows: build passed and full suite **161/161** passed, including ten observation
tests. Coverage includes scope isolation, persistent expiry, configuration changes
and rollback, unrelated updates, failure precedence, stale writes, invalid/secret
input, legacy API isolation, removal/re-enrollment, fresh re-verification, corrupt
contents and partial/unknown schemas. Current-content secret scan passed (140 files).
Interface/review checks kept the API additive and invalid evidence inaccessible.
No independent peer review or live-provider proof is claimed. Nothing was deployed,
committed or pushed; exact-SHA three-platform CI remains unverified.

## Scoped dispatch consumption — fourth increment (2026-10-23)

Experimental provider configuration can opt in with a `resources` entry:

```json
{ "resources": { "workerId": "worker", "bindingIds": ["binding"] } }
```

This entry belongs inside an existing agent configuration, alongside its exact
model profiles. It references an already populated environment resource catalog;
it does not create or enroll resources. The worker must match the frontend, and
every binding must use that worker's auth context. One exact model cannot have
multiple selected binding aliases. This prevents implicit account/pool rotation.

`resource-routing.ts` narrows provider-discovered, operator-configured exact model
profiles. A candidate needs current `VERIFIED` functional evidence for its exact
worker, binding, role, effort, frontend version and configuration. Missing,
expired, configuration-invalidated, unverified, auth-required or quota-failed
evidence is ineligible. Legacy component-wide verification cannot fill the gap.
Non-active account policies and disabled resources remain blocked.

Choices carry explicit provider/pool identities and non-secret resource provenance.
Competence and context capacity are bounded by both the existing model-specific
profile and the resource metadata; neither is upgraded by a successful login or
no-op probe. These remain declared bounds, not empirical certification. Arbitrary
feature/tool certification and learned routing are not added by this increment.

The scheduler preserves the verified effort/role and checks expiry. The provider
adapter rediscovers and revalidates the exact evidence before execution. The
runtime refreshes reviewer candidates after lead work, rather than reusing its
initial availability snapshot. Existing single-agent compensating verification,
worktree isolation and human integration gates remain unchanged.

`ASSIGNED` events accept an optional strictly validated resource provenance field,
which survives canonical replay/checkpoint/resume. Old task records remain valid;
older runtimes are not promised to read new resource-bearing events. No task or
environment database schema migration is required, and historical events are not
rewritten. Do not run mixed runtime versions against the same task state.

CLI discovery exposes `resourceContext` for trusted collectors: `frontendVersion`
is the digest of the observed version string; `configurationDigest` covers the
normalized adapter configuration and launch command. These are matching keys,
not binary attestation or provider-account proof. The CLI keeps the environment
database available throughout task/MCP execution and closes command-scoped handles.

### Trust boundary and rollout limits

- Binding the current provider-owned CLI context to a worker is an explicit trusted
  host/operator assertion. No login, account switching or credential inspection is
  performed. Actual account/context certification remains an open gate.
- No MCP-callable observation writer is introduced. Existing generic `verify`
  refuses resource-bound adapters; it cannot fabricate scoped verification.
- Trusted live scoped collectors, tool-capability verification, and automatic
  persistence of live invocation failures were future increments at this stage.
  The seventh increment below adds failure persistence; live collection remains gated.
  This slice consumes observations; it does not silently generate or refresh them.
- Existing adapters without `resources` remain compatible. No live configuration,
  installed runtime, provider permission, or credential was changed in this task.
- Verification uses disposable databases and deterministic adapter responses,
  not live provider/account certification. Remote three-platform CI remains open.

### Verification — 2026-10-23

Windows: TypeScript build and the final full Node suite passed (**198/198**, seven
new resource-routing tests). Tests cover absence of scoped evidence, legacy
verification isolation, exact role/effort/agent identity, tampered or missing
provenance, expiry, quota/auth failures, configuration changes and rollback,
ambiguous bindings, wrong frontends, CLI state lifetime, single-agent task replay
and resume, and reviewer availability changing after lead work. Existing degraded
review, package-install and host-MCP tests remain green. The cross-agent regression
failed before adding its guard, then passed with no provider invocation.

Current-content publication scan: **163 files, zero findings**. Production
dependency audit: **zero vulnerabilities**. `git diff --check` passed. AGY's
bounded text-only review (`gemini-3.8-flash-high`, high effort, 240-second budget)
timed out; no independent approval, fallback or automatic retry is claimed.
Local review was completed. No live resource enrollment, scoped provider probe,
configuration deployment, commit, push or remote CI run was performed.

## Scoped resource doctor — fifth increment (2026-10-28)

`resources doctor --repo REPOSITORY --config FILE [--state-dir DIRECTORY]`
inspects existing environment state without enrolling resources, modifying policy,
calling a model, or creating/renewing observations. `EnvironmentManager` has an
explicit read-only open mode that verifies database domain/version and canonical
root identity without initializing or migrating state. Missing, redirected, corrupt
or incompatible state fails closed. Task state is not opened.

`inspectResourceChoices` is the shared evaluator behind diagnostics and dispatch
filtering. The report explains exact scope, current authentication/availability/
verification and expiry, or missing/expired/configuration-invalidated evidence.
It preserves account-policy, exact-effort, frontend and binding checks. Catalog
revision changes abort inspection; corrupt evidence never falls back to old success.
Only fixed error reasons and scoped non-secret metadata reach the report, without
auth handles, account metadata, raw provider diagnostics or evidence contents.

CLI discovery obtains current version/configuration matching keys. It is not a
functional probe or account attestation. `ELIGIBLE` means a resource candidate
passed the same filtering as discovery; it does not bypass task/repository/human
gates, guarantee future availability, or certify declared competence/tools.
Legacy unbound adapters report `NOT_RESOURCE_BOUND` without provider calls.

This diagnostic slice precedes live collectors so missing trusted evidence is
visible and actionable without fabricating it. Trusted provider-context certification,
scoped functional collectors and live failure persistence remain follow-on work.
No live account, host configuration or installed runtime is changed by this increment.

### Verification — 2026-10-28

Windows TypeScript build and full Node suite passed **207/207**, including eight
new diagnostic tests. Coverage includes shared dispatch/doctor eligibility, exact
scope, read-only SQL enforcement, no evidence renewal or model invocation, expired
and invalidated observations, auth/quota/policy failures, ambiguous bindings,
concurrent catalog changes, corrupted evidence, safe errors, unbound adapters,
missing-state CLI behavior and rejection of mismatched/partial database scope.

Package dry-run and `git diff --check` passed. Current-content secret scan checked
164 files with zero findings; production dependency audit reported zero vulnerabilities.
Local review completed. A bounded AGY review (`gemini-3.8-flash-high`, high effort)
was blocked by required headless permission; independent approval is not claimed,
and no permission bypass, retry or model substitution was attempted. This increment
is not deployed, committed or pushed; remote platform CI remains unverified for it.

## Trusted collection lifecycle — sixth increment (2026-10-28)

The internal `collectResourceVerification(store, collector, request, signal?)`
coordinator now drives exact scoped verification into the existing observation
store. Its `ScopedVerificationCollector` is a trusted runtime-code dependency,
not an agent-supplied callback, imported JSON claim or dynamically loaded plugin.
No CLI/MCP observation writer, account switcher or live collector registration is
added. This increment implements and tests the lifecycle; it does not certify a
real provider's current account or tools.

1. Validate the exact worker/binding/role/effort/version/configuration scope,
   expected catalog revision, active resource policy, timeout and evidence TTL.
   A trusted role-specific recipe supplies the required runtime check IDs.
2. Durably append an `UNVERIFIED` pending observation before asynchronous work.
   Prior success immediately becomes ineligible. A crash leaves pending state,
   never silently restores old success, and does not automatically resume a probe.
3. Obtain a fresh provider-owned context observation. Its auth-context ID, opaque
   handle, version and configuration must match the requested resource. Unknown
   authentication or expired/mismatched context prevents the functional probe.
4. Revalidate the catalog revision and pending observation, then invoke the exact
   model/scope with an attempt ID and context digest. Accept only normalized,
   strictly validated results with every required observed check passing. Missing,
   duplicate, failed or extra checks cannot produce verification. Model assertions
   such as "tests passed" are not independent runtime checks.
5. Reobserve context after the probe. A context identity/generation change, logout,
   expiry, cancellation or deadline exhaustion prevents successful verification.
6. Append the final observation only if its original catalog revision and pending
   digest are still current. A newer failure/attempt wins over late success.
   Successful lifetime is bounded by the initial TTL and both context expirations.

`recordResourceObservation` now accepts an optional `expectedLatestDigest`.
The observation compare-and-write occurs inside its existing SQLite transaction;
legacy callers retain their existing behavior. No state migration is needed.
Same-millisecond or backward-clock writes fail closed rather than inventing future
timestamps. Completion waits for a later clock tick when necessary.

Probe failures persist normalized availability/authentication separately from
verification. Invalid results and exceptions never persist raw diagnostics. The
coordinator preserves the trusted collector's evidence hash reference; the collector
must retain the underlying permitted evidence. Context identity digests must derive
from non-secret provider identity/generation information, never credential contents.
Only digests and normalized observation metadata enter shared state.

Timeout/cancellation requests abort and prevents late callbacks from writing
success. Actual child termination and reconciliation remain obligations of the
provider collector; racing a promise is not OS process containment. Timeout, result
validation, cancellation and process-exit tests use deterministic fixtures.

### Live activation gate

Real provider collectors remain unregistered. Registration requires independently
observed provider-context binding, role-specific runtime evidence, bounded child
cleanup, and matching context revalidation at dispatch. An operator label, CLI
installation or successful no-op response cannot meet this gate. Existing generic
`verify` continues to refuse resource-bound adapters. The coordinator does not
promote declared model competence or arbitrary tools, authorize billing, or grant
repository/integration permissions. The seventh increment below adds automatic
recording of ordinary task invocation failures without opening the live collection gate.

A registered collector must pin the provider-owned execution context and report
the actual invocation's context digest, not echo the request's digest. Matching
before/after status alone cannot detect an account switch followed by a switch
back. Providers without a certifiable binding mechanism remain unsupported for
live scoped collection; this coordinator does not manufacture that mechanism.

### Verification — 2026-10-29

Windows build and full Node suite passed **222/222**, including 15 new collector
tests. The tests exercise pending-state recovery after actual process exit, stale
completion versus a newer failure, catalog changes before probing, exact context
and check matching, quota/auth failures, secret/invalid result rejection, conditional
writes, cancellation and late results. The timeout regression uses a controlled
clock and confirms that the probe started before injecting the deadline; its first
wall-clock version incorrectly assumed setup would always finish within 200 ms.

Package dry-run includes the new collector module and source map (87 files).
Current-content secret scan checked 166 files with zero findings; production
dependency audit reported zero vulnerabilities. Local review completed. A bounded,
inline-only AGY design review (`gemini-3.8-flash-high`, high effort) timed out;
no independent approval, retry or substitution is claimed.

No live resource verification, account/permission changes, deployment, commit or
push was performed. Remote three-platform CI remains unverified for this increment.

## Invocation failure feedback — seventh increment (2026-10-29)

Opt-in resource-bound adapters now persist normalized invocation failures to the
environment domain. A failed task call must not leave its selected `VERIFIED`
observation eligible for another dispatch. This is negative feedback, not a new
authentication/capability collector. The [provider-context audit](provider-context-audit-2026-10-29.md)
did not establish a certified invocation binding for the installed interfaces;
real scoped collectors remain unregistered.

- Feedback uses the selected worker/binding/role/effort/version/configuration
  scope. It does not infer account-wide quota, logout other workers, or invalidate
  unrelated roles, efforts or bindings.
- An `INVOCATION` receipt records normalized availability and `UNAVAILABLE`
  verification. Authentication changes only on `AUTH_REQUIRED`; quota/service
  failure does not imply logout. Receipt hashes identify normalized metadata,
  not independent test or review evidence. Raw provider output is excluded.
- Successful task calls neither mint nor renew verification. Preflight rejection
  does not revoke evidence because no invocation occurred. `INVOCATION` receipts
  cannot carry `VERIFIED` status.
- Catalog applicability is rechecked after any clock wait. The write compares
  both the catalog revision and selected observation digest transactionally.
  Newer observations and relevant configuration changes/rollback supersede an old
  completion. Unrelated catalog additions do not invalidate an unchanged scope.
- Negative observations have a 60-second diagnostic lifetime. Expiration leaves
  the scope ineligible; it never restores a historical success. Fresh trusted
  verification is required to regain eligibility.
- Resource-bound dispatch requires a writable observation store. This checks the
  store's open mode; it cannot guarantee that a later disk write will succeed.
  A write/corruption failure returns `resourceFeedback: FAILED`, blocks the adapter
  instance and stops the task. Reviewer storage failure is not handled as ordinary
  degraded review. Repair and revalidation are required before reopening.
- Results distinguish `RECORDED`, `SUPERSEDED` and `FAILED`; task/review reasons
  preserve this status. Persisted reviewer quota failure still permits the existing
  compensating-test path, with no independent approval claim.

No process-global durable fence is claimed when storage itself cannot accept a
write. A fresh process cannot recover an in-memory failure latch; operators must
repair storage and revalidate before reopening. Abrupt death between provider
completion and feedback persistence also remains a recovery limitation. This
increment does not certify arbitrary mid-invocation crash recovery.

Existing records retain their schema and behavior. `INVOCATION` extends the
closed evidence-method vocabulary; older binaries fail closed when reading these
new records. Binary downgrade against state containing new receipts is unsupported;
preserve compatible runtime/state backups for any later deployment.

### Verification — seventh increment

On 2026-10-29 the Windows build and full suite passed **235/235** tests, including
13 new regressions covering durable quota/auth failures, timeout/cancellation,
malformed results, scope isolation, concurrent evidence/catalog changes, rollback,
read-only stores, corruption and write failures. Runtime tests distinguish a
blocked lead, degraded reviewer with compensating tests, and blocked reviewer
feedback storage. Existing legacy adapter and workspace tests also passed.

The secret scan checked 168 tracked/untracked files with zero findings. Production
dependency audit reported zero vulnerabilities. Package dry-run includes the
feedback and collection modules (89 files); whitespace checks passed. Local review
completed; no independent peer approval is claimed. This is deterministic local
evidence, not live provider certification or remote three-platform CI. No live
configuration change, deployment, commit or push occurred.
