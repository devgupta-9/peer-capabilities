import * as z from 'zod/v4';
import { assertNonSecret } from '../security.js';

const id = z.string().min(1).max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);
const role = z.enum(['lead', 'reviewer', 'specialist', 'consultant']);
const unique = <T extends z.ZodType>(item: T) => z.array(item).max(256).refine(items => new Set(items).size === items.length);
const provider = z.object({ id }).strict();
const frontend = z.object({ id }).strict();
const account = z.object({ id, providerId: id, policy: z.enum(['ACTIVE', 'RESERVE', 'EMERGENCY_ONLY', 'MANUAL_ONLY', 'DISABLED']) }).strict();
// A provider-owned opaque label, not a credential, login assertion or file path.
const authContext = z.object({ id, accountId: id, frontendId: id, handle: id }).strict();
const quotaPool = z.object({ id, accountId: id }).strict();
const model = z.object({ id, providerId: id, model: z.string().min(1).max(256),
  efforts: unique(id).min(1), contextWindow: z.number().int().positive() }).strict();
const binding = z.object({ id, modelId: id, authContextId: id, quotaPoolId: id, enabled: z.boolean() }).strict();
const profile = z.object({ id, roles: unique(role).min(1), features: unique(id), competence: z.number().min(0).max(10) }).strict();
const worker = z.object({ id, frontendId: id, authContextId: id, profileId: id, enabled: z.boolean() }).strict();
const records = <T extends z.ZodType>(item: T) => z.array(item).max(10000);
const catalogSchema = z.object({ schemaVersion: z.literal(1), providers: records(provider), frontends: records(frontend),
  accounts: records(account), authContexts: records(authContext), quotaPools: records(quotaPool), models: records(model),
  bindings: records(binding), profiles: records(profile), workers: records(worker) }).strict();
const contractSchema = z.object({ schemaVersion: z.literal(1), role, features: unique(id),
  minimumCompetence: z.number().min(0).max(10), requiredContext: z.number().int().positive(), effort: id }).strict();

export type Provider = z.infer<typeof provider>;
export type AgentFrontend = z.infer<typeof frontend>;
export type Account = z.infer<typeof account>;
export type AuthContextRef = z.infer<typeof authContext>;
export type QuotaPool = z.infer<typeof quotaPool>;
export type Model = z.infer<typeof model>;
export type ModelAccessBinding = z.infer<typeof binding>;
export type CapabilityProfile = z.infer<typeof profile>;
export type Worker = z.infer<typeof worker>;
export type CapabilityContract = z.infer<typeof contractSchema>;
export type ResourceCatalog = z.infer<typeof catalogSchema>;

function index<T extends { id: string }>(items: T[]): Map<string, T> {
  const map = new Map(items.map(item => [item.id, item]));
  if (map.size !== items.length) throw new Error('Duplicate resource ID');
  return map;
}
function indexes(c: ResourceCatalog) {
  return { providers: index(c.providers), frontends: index(c.frontends), accounts: index(c.accounts),
    authContexts: index(c.authContexts), quotaPools: index(c.quotaPools), models: index(c.models),
    bindings: index(c.bindings), profiles: index(c.profiles), workers: index(c.workers) };
}
function requireRecord<T>(map: Map<string, T>, key: string): T {
  const value = map.get(key);
  if (!value) throw new Error('Missing resource reference');
  return value;
}

/** Metadata boundary only. Validation does NOT prove login, access or availability. */
export function validateResources(value: unknown): ResourceCatalog {
  try {
    assertNonSecret(value);
    const c = catalogSchema.parse(value), m = indexes(c);
    for (const a of c.accounts) requireRecord(m.providers, a.providerId);
    for (const a of c.authContexts) { requireRecord(m.accounts, a.accountId); requireRecord(m.frontends, a.frontendId); }
    for (const q of c.quotaPools) requireRecord(m.accounts, q.accountId);
    for (const model of c.models) requireRecord(m.providers, model.providerId);
    for (const b of c.bindings) {
      const model = requireRecord(m.models, b.modelId), auth = requireRecord(m.authContexts, b.authContextId);
      const account = requireRecord(m.accounts, auth.accountId), pool = requireRecord(m.quotaPools, b.quotaPoolId);
      if (model.providerId !== account.providerId || pool.accountId !== account.id) throw new Error('Resource ownership mismatch');
    }
    for (const w of c.workers) {
      requireRecord(m.frontends, w.frontendId); requireRecord(m.profiles, w.profileId);
      if (requireRecord(m.authContexts, w.authContextId).frontendId !== w.frontendId) throw new Error('Frontend mismatch');
    }
    return c;
  } catch { throw new Error('INVALID_RESOURCE_CATALOG'); }
}

export function validateCapabilityContract(value: unknown): CapabilityContract {
  try { assertNonSecret(value); return contractSchema.parse(value); }
  catch { throw new Error('INVALID_CAPABILITY_CONTRACT'); }
}

/** Resolve one explicit assignment, never rotate accounts or choose a fallback.
 * This is static compatibility, NOT dispatch authorization. Authentication,
 * verification, quota, repository policy and human gates remain execution checks. */
export function resolveResource(value: unknown, selection: { workerId: string; bindingId: string }, requested: unknown) {
  const c = validateResources(value), m = indexes(c), contract = validateCapabilityContract(requested);
  const worker = m.workers.get(selection.workerId), binding = m.bindings.get(selection.bindingId);
  if (!worker || !binding) throw new Error('RESOURCE_NOT_FOUND');
  if (worker.authContextId !== binding.authContextId) throw new Error('RESOURCE_BINDING_MISMATCH');
  const authContext = m.authContexts.get(binding.authContextId)!;
  const account = m.accounts.get(authContext.accountId)!;
  if (!worker.enabled || !binding.enabled || account.policy !== 'ACTIVE') throw new Error('RESOURCE_POLICY_BLOCKED');
  const model = m.models.get(binding.modelId)!, profile = m.profiles.get(worker.profileId)!;
  if (!profile.roles.includes(contract.role) || profile.competence < contract.minimumCompetence ||
      !contract.features.every(feature => profile.features.includes(feature)) ||
      !model.efforts.includes(contract.effort) || model.contextWindow < contract.requiredContext) throw new Error('CAPABILITY_MISMATCH');
  return { worker, binding, authContext, account, model, profile, contract,
    provider: m.providers.get(model.providerId)!, frontend: m.frontends.get(worker.frontendId)!,
    quotaPool: m.quotaPools.get(binding.quotaPoolId)! };
}
