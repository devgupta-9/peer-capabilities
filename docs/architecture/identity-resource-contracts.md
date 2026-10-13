# Identity and Resource Contracts

Status: local development implementation, updated 2026-10-13. Not release-qualified.
Scope: resource contracts, environment persistence and scoped observations with behavioral tests.

## Boundary and rationale

The existing `Choice` fields are insufficient to distinguish multiple accounts,
frontends and shared quota pools. Add a validated metadata boundary first; do not
infer account identities from CLI names, copy credentials, or rewrite task history.
This preserves the current scheduler/adapters until explicit migration is tested.

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
- No auth flow, scheduler routing or installed-host configuration changes.

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
collectors; live collectors and scheduler consumption are not yet wired. History
checks currently scale with intervening catalog revisions; before high-frequency
routing, evaluate cached invalidation generations without weakening rollback safety.

## Follow-on increments

1. Adapt discovery and scheduler assignments without inferring missing identities
   or changing exact-model/no-fallback policy. Profiles need model-specific evidence
   before being used as competence claims by the scheduler.
2. Expose inspection in doctor, then certify migration and the single/N-agent paths.

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
