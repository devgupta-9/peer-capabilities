import type { EnvironmentManager } from './environment.js';
import { availability, type Availability } from './contracts.js';
import { digest } from './identity.js';
import { resourceAssignmentSchema, type ResourceAssignment } from './resource-routing.js';

type Store = Pick<EnvironmentManager, 'readResources' | 'getResourceObservation' | 'recordResourceObservation'>;

/** Failure-only feedback. A successful invocation cannot mint or renew proof.
 * Compare-and-write preserves newer verification/failures and changed scope. */
export async function recordInvocationFailure(store: Store, assignment: ResourceAssignment,
  failure: Availability): Promise<'RECORDED' | 'SUPERSEDED'> {
  const selected = resourceAssignmentSchema.parse(assignment);
  const state = availability.parse(failure);
  if (['AVAILABLE', 'AVAILABLE_LIMITED', 'QUOTA_LOW'].includes(state)) throw new Error('FAILURE_REQUIRED');
  const before = store.getResourceObservation(selected.scope);
  if (before.status !== 'CURRENT' || digest(before.observation) !== selected.observationDigest) return 'SUPERSEDED';
  // Do not invent a future timestamp to outrun the selected verification.
  if (Date.now() === Date.parse(before.observation.observedAt)) await new Promise(resolve => setTimeout(resolve, 1));
  // Read revision BEFORE rechecking scope. A concurrent catalog change either
  // invalidates this read or conflicts with the transactional revision check.
  const catalog = store.readResources();
  if (!catalog) throw new Error('RESOURCE_CATALOG_REQUIRED');
  const current = store.getResourceObservation(selected.scope);
  if (current.status !== 'CURRENT' || digest(current.observation) !== selected.observationDigest) return 'SUPERSEDED';
  const now = Date.now();
  try {
    store.recordResourceObservation({ scope: selected.scope, resourceRevision: catalog.revision,
      authentication: state === 'AUTH_REQUIRED' ? 'AUTH_REQUIRED' : current.observation.authentication,
      availability: state, verification: 'UNAVAILABLE', observedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 60000).toISOString(),
      evidence: { method: 'INVOCATION', reference: digest({ scope: selected.scope,
        previous: selected.observationDigest, availability: state, observedAt: now }) },
    }, selected.observationDigest);
    return 'RECORDED';
  } catch (error) {
    // Only confirmed newer/invalidated evidence makes a failed write benign.
    if (error instanceof Error && ['RESOURCE_OBSERVATION_CONFLICT', 'RESOURCE_REVISION_CONFLICT'].includes(error.message)) {
      const latest = store.getResourceObservation(selected.scope);
      if (latest.status !== 'CURRENT' || digest(latest.observation) !== selected.observationDigest) return 'SUPERSEDED';
    }
    throw new Error('RESOURCE_FEEDBACK_FAILED');
  }
}
