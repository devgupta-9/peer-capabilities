import * as z from 'zod/v4';
import type { Choice } from './contracts.js';
import type { EnvironmentManager } from './environment.js';
import { digest } from './identity.js';
import { resolveResource } from './resources.js';
import { resourceObservationScopeSchema } from './resource-observations.js';

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

/** Narrow discovered model profiles using explicit identities and current evidence.
 * No account selection, inferred identities, credential access or evidence writes. */
export function bindResourceChoices(source: ResourceSource, frontend: string,
  selection: z.infer<typeof resourceBindingSchema>, context: ResourceContext, choices: Choice[]): Choice[] {
  const snapshot = source.readResources();
  if (!snapshot) throw new Error('RESOURCE_CATALOG_REQUIRED');
  const catalog = snapshot.catalog, worker = catalog.workers.find(w => w.id === selection.workerId);
  if (!worker) throw new Error('RESOURCE_NOT_FOUND');
  if (worker.frontendId !== frontend) throw new Error('RESOURCE_FRONTEND_MISMATCH');
  const models = new Set<string>(), result: Choice[] = [];
  for (const bindingId of selection.bindingIds) {
    const binding = catalog.bindings.find(b => b.id === bindingId);
    if (!binding) throw new Error('RESOURCE_NOT_FOUND');
    if (binding.authContextId !== worker.authContextId) throw new Error('RESOURCE_BINDING_MISMATCH');
    const model = catalog.models.find(m => m.id === binding.modelId)!;
    // One frontend invocation cannot silently select between account/pool aliases.
    if (models.has(model.model)) throw new Error('AMBIGUOUS_RESOURCE_BINDING');
    models.add(model.model);
    for (const choice of choices.filter(c => c.agent === frontend && c.model === model.model)) {
      if (choice.authentication === 'AUTH_REQUIRED' ||
        !['AVAILABLE', 'AVAILABLE_LIMITED', 'QUOTA_LOW'].includes(choice.availability)) continue;
      for (const role of choice.roles) {
        let resolved: ReturnType<typeof resolveResource>;
        try {
          resolved = resolveResource(catalog, { workerId: worker.id, bindingId }, {
            schemaVersion: 1, role, effort: choice.effort, features: [], minimumCompetence: 0, requiredContext: 1,
          });
        } catch (error) {
          if (error instanceof Error && ['RESOURCE_POLICY_BLOCKED', 'CAPABILITY_MISMATCH'].includes(error.message)) continue;
          throw error;
        }
        const scope = { workerId: worker.id, bindingId, role, effort: choice.effort, ...context };
        const evidence = source.getResourceObservation(scope);
        if (evidence.status !== 'CURRENT') continue;
        const o = evidence.observation;
        if (o.verification !== 'VERIFIED' || !['AUTHENTICATED', 'NOT_REQUIRED'].includes(o.authentication) ||
          o.availability === 'UNKNOWN' || !['AVAILABLE', 'AVAILABLE_LIMITED', 'QUOTA_LOW'].includes(o.availability)) continue;
        result.push({ ...choice, roles: [role], efforts: [choice.effort],
          competence: Math.min(choice.competence, resolved.profile.competence),
          contextWindow: Math.min(choice.contextWindow, model.contextWindow),
          provider: resolved.provider.id, quotaPool: resolved.quotaPool.id,
          authentication: o.authentication, availability: o.availability,
          resource: { scope, catalogRevision: snapshot.revision, observationDigest: digest(o), expiresAt: o.expiresAt },
        });
      }
    }
  }
  if (source.readResources()?.revision !== snapshot.revision) throw new Error('RESOURCE_REVISION_CHANGED');
  return result;
}
