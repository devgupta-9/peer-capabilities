import type { DatabaseSync } from 'node:sqlite';
import * as z from 'zod/v4';
import { assertNonSecret } from '../security.js';
import { availability } from './contracts.js';
import { transaction } from './database.js';
import { canonical, digest } from './identity.js';
import { ResourceState } from './resource-state.js';
import type { ResourceCatalog } from './resources.js';

const label = z.string().min(1).max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const resourceObservationScopeSchema = z.object({
  workerId: label, bindingId: label, role: z.enum(['lead', 'reviewer', 'specialist', 'consultant']),
  effort: label, frontendVersion: label, configurationDigest: hash,
}).strict();
const observationSchema = z.object({
  scope: resourceObservationScopeSchema, resourceRevision: z.number().int().positive(),
  authentication: z.enum(['UNKNOWN', 'NOT_REQUIRED', 'AUTH_REQUIRED', 'AUTHENTICATED']),
  availability: availability.or(z.literal('UNKNOWN')),
  verification: z.enum(['UNVERIFIED', 'VERIFIED', 'UNAVAILABLE']),
  observedAt: z.iso.datetime(), expiresAt: z.iso.datetime(),
  evidence: z.object({ method: z.enum(['DISCOVERY', 'OFFICIAL_STATUS', 'FUNCTIONAL_PROBE']), reference: hash }).strict(),
}).strict().refine(o => Date.parse(o.expiresAt) > Date.parse(o.observedAt))
  .refine(o => o.verification !== 'VERIFIED' || (o.evidence.method === 'FUNCTIONAL_PROBE' &&
    ['AUTHENTICATED', 'NOT_REQUIRED'].includes(o.authentication) &&
    ['AVAILABLE', 'AVAILABLE_LIMITED', 'QUOTA_LOW'].includes(o.availability)))
  .refine(o => o.evidence.method !== 'DISCOVERY' || o.authentication !== 'AUTHENTICATED');

export type ResourceObservationScope = z.infer<typeof resourceObservationScopeSchema>;
export type ResourceObservation = z.infer<typeof observationSchema>;
export type ResourceObservationResult =
  | { status: 'CURRENT'; observation: ResourceObservation }
  | { status: 'UNKNOWN' | 'EXPIRED' | 'CONFIGURATION_CHANGED' };

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  try { assertNonSecret(value); return schema.parse(value); }
  catch { throw new Error('INVALID_RESOURCE_OBSERVATION'); }
}

/** Exact dependency fingerprint, not an authorization or scheduling decision. */
function fingerprint(c: ResourceCatalog, s: ResourceObservationScope): string | null {
  const worker = c.workers.find(x => x.id === s.workerId), binding = c.bindings.find(x => x.id === s.bindingId);
  if (!worker || !binding || worker.authContextId !== binding.authContextId) return null;
  const auth = c.authContexts.find(x => x.id === worker.authContextId)!;
  const account = c.accounts.find(x => x.id === auth.accountId)!;
  const model = c.models.find(x => x.id === binding.modelId)!;
  const profile = c.profiles.find(x => x.id === worker.profileId)!;
  if (!profile.roles.includes(s.role) || !model.efforts.includes(s.effort)) return null;
  return digest({ scope: s, worker, binding, auth, account, model, profile,
    provider: c.providers.find(x => x.id === model.providerId),
    frontend: c.frontends.find(x => x.id === worker.frontendId),
    quotaPool: c.quotaPools.find(x => x.id === binding.quotaPoolId) });
}

/** Runtime collectors only: metadata is not provider proof or dispatch permission.
 * Append-only history lives in the environment DB; legacy observations are unchanged. */
export class ResourceObservations {
  constructor(private db: DatabaseSync) {}
  private initialized(): boolean {
    const tables = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('resource_observation_schema','resource_observations')").all();
    if (!tables.length) return false;
    if (tables.length !== 2) throw new Error('UNSUPPORTED_RESOURCE_OBSERVATION_SCHEMA');
    const rows = this.db.prepare('SELECT version FROM resource_observation_schema').all();
    if (rows.length !== 1 || rows[0].version !== 1) throw new Error('UNSUPPORTED_RESOURCE_OBSERVATION_SCHEMA');
    return true;
  }
  private latest(scope: ResourceObservationScope): ResourceObservation | null {
    if (!this.initialized()) return null;
    const row = this.db.prepare('SELECT body, digest FROM resource_observations WHERE scope_key=? ORDER BY sequence DESC LIMIT 1').get(digest(scope));
    if (!row) return null;
    try {
      const observation = parse(observationSchema, JSON.parse(String(row.body)));
      if (digest(observation) !== row.digest || digest(observation.scope) !== digest(scope)) throw new Error();
      return observation;
    } catch { throw new Error('CORRUPT_RESOURCE_OBSERVATION'); }
  }
  record(value: unknown): ResourceObservation {
    const observation = parse(observationSchema, value);
    if (Date.parse(observation.observedAt) > Date.now()) throw new Error('INVALID_RESOURCE_OBSERVATION');
    return transaction(this.db, () => {
      const current = new ResourceState(this.db).read();
      if (!current || current.revision !== observation.resourceRevision) throw new Error('RESOURCE_REVISION_CONFLICT');
      if (!fingerprint(current.catalog, observation.scope)) throw new Error('INVALID_RESOURCE_OBSERVATION');
      const previous = this.latest(observation.scope);
      if (previous && Date.parse(previous.observedAt) >= Date.parse(observation.observedAt)) throw new Error('STALE_RESOURCE_OBSERVATION');
      if (!this.initialized()) this.db.exec(`
        CREATE TABLE resource_observation_schema(version INTEGER PRIMARY KEY) STRICT;
        INSERT INTO resource_observation_schema VALUES(1);
        CREATE TABLE resource_observations(sequence INTEGER PRIMARY KEY, scope_key TEXT NOT NULL,
          digest TEXT NOT NULL, body TEXT NOT NULL) STRICT;
        CREATE INDEX resource_observation_scope ON resource_observations(scope_key, sequence DESC);
      `);
      this.db.prepare('INSERT INTO resource_observations(scope_key,digest,body) VALUES(?,?,?)')
        .run(digest(observation.scope), digest(observation), canonical(observation));
      return observation;
    });
  }
  read(value: unknown): ResourceObservationResult {
    const scope = parse(resourceObservationScopeSchema, value);
    return transaction(this.db, () => {
      const observation = this.latest(scope);
      if (!observation) return { status: 'UNKNOWN' };
      // Clock rollback cannot make evidence observed in the future usable.
      if (Date.parse(observation.observedAt) > Date.now() || Date.parse(observation.expiresAt) <= Date.now()) return { status: 'EXPIRED' };
      const resources = new ResourceState(this.db), current = resources.read();
      if (!current || current.revision < observation.resourceRevision) throw new Error('CORRUPT_RESOURCE_OBSERVATION');
      const baseline = resources.read(observation.resourceRevision);
      const original = baseline && fingerprint(baseline.catalog, scope);
      if (!original) throw new Error('CORRUPT_RESOURCE_OBSERVATION');
      // Inspect intervening revisions too: restoring old configuration must not
      // resurrect old auth evidence. Unrelated resource additions are harmless.
      for (let revision = observation.resourceRevision + 1; revision <= current.revision; revision++) {
        const snapshot = revision === current.revision ? current : resources.read(revision);
        if (!snapshot) throw new Error('CORRUPT_RESOURCE_STATE');
        if (fingerprint(snapshot.catalog, scope) !== original) return { status: 'CONFIGURATION_CHANGED' };
      }
      return { status: 'CURRENT', observation };
    });
  }
}
