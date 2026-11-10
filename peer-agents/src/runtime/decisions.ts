import * as z from 'zod/v4';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const acceptedDecisionSchema = z.object({
  id: z.uuid(), statement: z.string().min(1).max(8000),
  evidence: z.array(hash).min(1).max(32).refine(ids => new Set(ids).size === ids.length),
  sourceFingerprint: hash, supersedes: z.uuid().optional(),
}).strict();
export const decisionInvalidationSchema = z.object({
  ids: z.array(z.uuid()).min(1).refine(ids => new Set(ids).size === ids.length), fingerprint: hash,
}).strict();
export const decisionSchema = acceptedDecisionSchema.extend({
  status: z.enum(['ACTIVE', 'STALE', 'SUPERSEDED']), acceptedAt: z.iso.datetime(), acceptedRevision: z.number().int().positive(),
  supersededBy: z.uuid().optional(), staleAtFingerprint: hash.optional(),
}).refine(d => (d.status === 'SUPERSEDED') === Boolean(d.supersededBy) &&
  (d.status !== 'STALE' || Boolean(d.staleAtFingerprint)));
export type Decision = z.infer<typeof decisionSchema>;

/** Pure canonical projection; one event supersedes the old decision and accepts
 * its replacement together. Neither source rollback nor reuse of an ID revives it. */
export function acceptDecision(current: Decision[], value: z.infer<typeof acceptedDecisionSchema>, at: string, revision: number): Decision[] {
  if (current.some(d => d.id === value.id)) throw new Error('Decision ID already exists');
  const next = structuredClone(current);
  if (value.supersedes) {
    const old = next.find(d => d.id === value.supersedes);
    if (!old || old.status === 'SUPERSEDED') throw new Error('Decision replacement requires a current or stale predecessor');
    old.status = 'SUPERSEDED'; old.supersededBy = value.id;
  }
  next.push({ ...value, status: 'ACTIVE', acceptedAt: at, acceptedRevision: revision });
  return next;
}
export function invalidateDecisions(current: Decision[], value: z.infer<typeof decisionInvalidationSchema>): Decision[] {
  const next = structuredClone(current);
  for (const id of value.ids) {
    const decision = next.find(d => d.id === id);
    if (!decision || decision.status !== 'ACTIVE' || decision.sourceFingerprint === value.fingerprint) {
      throw new Error('Decision invalidation requires changed source and an active decision');
    }
    decision.status = 'STALE'; decision.staleAtFingerprint = value.fingerprint;
  }
  return next;
}
export function projectDecisions(values: Decision[]) {
  const decisions = z.array(decisionSchema).parse(values);
  return {
    current: decisions.filter(d => d.status !== 'SUPERSEDED'),
    history: decisions.filter(d => d.status === 'SUPERSEDED').map(d => ({ id: d.id, status: d.status, supersededBy: d.supersededBy })),
  };
}
