import * as z from 'zod/v4';
import type { Choice } from './contracts.js';
import type { EnvironmentManager } from './environment.js';
import { digest } from './identity.js';
import { resolveResource } from './resources.js';
import { resourceObservationScopeSchema, type ResourceObservationScope, type ResourceObservation } from './resource-observations.js';

const id = z.string().min(1).max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);
export const resourceBindingSchema = z.object({ workerId: id,
  bindingIds: z.array(id).min(1).max(256).refine(ids => new Set(ids).size === ids.length),
}).strict();
export type ResourceSource = Pick<EnvironmentManager, 'readResources' | 'getResourceObservation'>;
export type ResourceContext = { frontendVersion: string; configurationDigest: string };
export const resourceAssignmentSchema = z.object({ scope: resourceObservationScopeSchema,
  catalogRevision: z.number().int().positive(), observationDigest: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt: z.iso.datetime(),
}).strict();
export type ResourceAssignment = z.infer<typeof resourceAssignmentSchema>;

export const resourceNextAction = {
  ELIGIBLE: 'Eligible for resource routing only; task, repository and approval gates still apply.',
  NO_DISCOVERED_PROFILE: 'Check the exact configured model/effort and refresh official CLI model discovery.',
  RESOURCE_CATALOG_REQUIRED: 'No resource catalog exists. Explicit resource setup is required; doctor does not enroll resources.',
  RESOURCE_NOT_FOUND: 'Check the configured worker and binding IDs against the resource catalog.',
  RESOURCE_FRONTEND_MISMATCH: 'Use a worker belonging to this frontend; do not infer account identity.',
  RESOURCE_BINDING_MISMATCH: 'Use bindings belonging to the selected worker auth context.',
  AMBIGUOUS_RESOURCE_BINDING: 'Select one binding per exact model; automatic account rotation is not supported.',
  RESOURCE_POLICY_BLOCKED: 'Inspect disabled resources or non-active account policy. Doctor cannot override policy.',
  CAPABILITY_MISMATCH: 'Check the declared role and exact effort; do not broaden capability claims to pass this check.',
  AUTH_REQUIRED: 'Complete official provider login, then obtain fresh trusted verification for this exact scope.',
  DISCOVERY_BLOCKED: 'Check CLI availability and experimental-adapter policy before requesting verification.',
  UNKNOWN: 'No observation for this exact scope. A trusted scoped collector is required; legacy verify cannot fill this gap.',
  EXPIRED: 'Obtain fresh trusted scoped verification; doctor does not renew evidence.',
  CONFIGURATION_CHANGED: 'Revalidate provider context and collect fresh scoped evidence after the configuration change.',
  AUTH_UNKNOWN: 'Authentication is unknown for this scope; use official provider status and trusted scoped verification.',
  UNVERIFIED: 'Obtain functional verification for this exact scope. Installation and discovery are insufficient.',
  UNAVAILABLE: 'Inspect the reported availability; resolve quota or service failure without switching accounts implicitly.',
  RESOURCE_REVISION_CHANGED: 'Resource state changed during inspection; run doctor again.',
  RESOURCE_FEEDBACK_FAILED: 'Failure feedback could not be persisted. Repair environment storage and revalidate before reopening the adapter.',
  INSPECTION_FAILED: 'Inspect local resource state and schema integrity. No evidence or policy was repaired.',
} as const;
type Reason = keyof typeof resourceNextAction;
export type ResourceDiagnostic = {
  workerId: string; bindingId: string; model: string;
  scope?: ResourceObservationScope;
  eligible: boolean; reason: Reason; nextAction: string;
  observation?: Pick<ResourceObservation, 'authentication' | 'availability' | 'verification' | 'observedAt' | 'expiresAt'>;
};

/** Narrow discovered model profiles using explicit identities and current evidence.
 * No account selection, inferred identities, credential access or evidence writes. */
export function bindResourceChoices(source: ResourceSource, frontend: string,
  selection: z.infer<typeof resourceBindingSchema>, context: ResourceContext, choices: Choice[]): Choice[] {
  return inspectResourceChoices(source, frontend, selection, context, choices).choices;
}

/** One evaluator powers both dispatch filtering and read-only diagnostics. */
export function inspectResourceChoices(source: ResourceSource, frontend: string,
  selection: z.infer<typeof resourceBindingSchema>, context: ResourceContext, choices: Choice[]) {
  const snapshot = source.readResources();
  if (!snapshot) throw new Error('RESOURCE_CATALOG_REQUIRED');
  const catalog = snapshot.catalog, worker = catalog.workers.find(w => w.id === selection.workerId);
  if (!worker) throw new Error('RESOURCE_NOT_FOUND');
  if (worker.frontendId !== frontend) throw new Error('RESOURCE_FRONTEND_MISMATCH');
  const models = new Set<string>(), result: Choice[] = [];
  const diagnostics: ResourceDiagnostic[] = [];
  for (const bindingId of selection.bindingIds) {
    const binding = catalog.bindings.find(b => b.id === bindingId);
    if (!binding) throw new Error('RESOURCE_NOT_FOUND');
    if (binding.authContextId !== worker.authContextId) throw new Error('RESOURCE_BINDING_MISMATCH');
    const model = catalog.models.find(m => m.id === binding.modelId)!;
    // One frontend invocation cannot silently select between account/pool aliases.
    if (models.has(model.model)) throw new Error('AMBIGUOUS_RESOURCE_BINDING');
    models.add(model.model);
    const candidates = choices.filter(c => c.agent === frontend && c.model === model.model);
    const report = (reason: Reason, scope?: ResourceObservationScope, observation?: ResourceObservation) => {
      diagnostics.push({ workerId: worker.id, bindingId, model: model.model, scope,
        eligible: reason === 'ELIGIBLE', reason, nextAction: resourceNextAction[reason],
        ...(observation ? { observation: { authentication: observation.authentication, availability: observation.availability,
          verification: observation.verification, observedAt: observation.observedAt, expiresAt: observation.expiresAt } } : {}),
      });
    };
    if (!candidates.length) report('NO_DISCOVERED_PROFILE');
    for (const choice of candidates) {
      for (const role of choice.roles) {
        const scope = { workerId: worker.id, bindingId, role, effort: choice.effort, ...context };
        if (choice.authentication === 'AUTH_REQUIRED') { report('AUTH_REQUIRED', scope); continue; }
        if (!['AVAILABLE', 'AVAILABLE_LIMITED', 'QUOTA_LOW'].includes(choice.availability)) {
          report('DISCOVERY_BLOCKED', scope); continue;
        }
        let resolved: ReturnType<typeof resolveResource>;
        try {
          resolved = resolveResource(catalog, { workerId: worker.id, bindingId }, {
            schemaVersion: 1, role, effort: choice.effort, features: [], minimumCompetence: 0, requiredContext: 1,
          });
        } catch (error) {
          if (error instanceof Error && (error.message === 'RESOURCE_POLICY_BLOCKED' || error.message === 'CAPABILITY_MISMATCH')) {
            report(error.message, scope); continue;
          }
          throw error;
        }
        const evidence = source.getResourceObservation(scope);
        if (evidence.status !== 'CURRENT') { report(evidence.status, scope); continue; }
        const o = evidence.observation;
        if (o.authentication === 'AUTH_REQUIRED' || o.availability === 'AUTH_REQUIRED') { report('AUTH_REQUIRED', scope, o); continue; }
        if (o.availability === 'UNKNOWN' || !['AVAILABLE', 'AVAILABLE_LIMITED', 'QUOTA_LOW'].includes(o.availability)) { report('UNAVAILABLE', scope, o); continue; }
        if (!['AUTHENTICATED', 'NOT_REQUIRED'].includes(o.authentication)) { report('AUTH_UNKNOWN', scope, o); continue; }
        if (o.verification !== 'VERIFIED') { report('UNVERIFIED', scope, o); continue; }
        result.push({ ...choice, roles: [role], efforts: [choice.effort],
          competence: Math.min(choice.competence, resolved.profile.competence),
          contextWindow: Math.min(choice.contextWindow, model.contextWindow),
          provider: resolved.provider.id, quotaPool: resolved.quotaPool.id,
          authentication: o.authentication, availability: o.availability,
          resource: { scope, catalogRevision: snapshot.revision, observationDigest: digest(o), expiresAt: o.expiresAt },
        });
        report('ELIGIBLE', scope, o);
      }
    }
  }
  if (source.readResources()?.revision !== snapshot.revision) throw new Error('RESOURCE_REVISION_CHANGED');
  return { catalogRevision: snapshot.revision, choices: result, diagnostics };
}
