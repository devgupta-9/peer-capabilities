import * as z from 'zod/v4';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const dependency = z.object({ path: z.string().min(1).max(4096), fingerprint: hash }).strict();
const fileScope = z.object({ kind: z.literal('FILES'), files: z.array(dependency).min(1).max(128)
  .refine(files => new Set(files.map(file => file.path)).size === files.length) }).strict();
export const acceptedDecisionSchema = z.object({
  id: z.uuid(), statement: z.string().min(1).max(8000),
  evidence: z.array(hash).min(1).max(32).refine(ids => new Set(ids).size === ids.length),
  sourceFingerprint: hash, supersedes: z.uuid().optional(),
  sourceScope: fileScope.optional(),
}).strict();
export const decisionRequestSchema = acceptedDecisionSchema.omit({ sourceFingerprint: true, sourceScope: true })
  .extend({ sourceFiles: z.array(z.string().min(1).max(4096)).min(1).max(128).optional() });
export const decisionSourceCheckSchema = z.object({
  fingerprint: hash,
  checks: z.array(z.object({ id: z.uuid(), files: z.array(dependency.extend({ fingerprint: hash.nullable() }))
    .min(1).max(128).refine(files => new Set(files.map(file => file.path)).size === files.length).optional() }).strict())
    .min(1).refine(checks => new Set(checks.map(check => check.id)).size === checks.length),
}).strict();
export const decisionInvalidationSchema = z.object({
  ids: z.array(z.uuid()).min(1).refine(ids => new Set(ids).size === ids.length), fingerprint: hash,
}).strict();
export const decisionSchema = acceptedDecisionSchema.extend({
  status: z.enum(['ACTIVE', 'STALE', 'SUPERSEDED']), acceptedAt: z.iso.datetime(), acceptedRevision: z.number().int().positive(),
  supersededBy: z.uuid().optional(), staleAtFingerprint: hash.optional(),
  validatedFingerprint: hash.optional(),
}).refine(d => (d.status === 'SUPERSEDED') === Boolean(d.supersededBy) &&
  (d.status !== 'STALE' || Boolean(d.staleAtFingerprint)) && (!d.validatedFingerprint || Boolean(d.sourceScope)));
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
    if (!decision || decision.status !== 'ACTIVE' || (decision.validatedFingerprint ?? decision.sourceFingerprint) === value.fingerprint) {
      throw new Error('Decision invalidation requires changed source and an active decision');
    }
    decision.status = 'STALE'; decision.staleAtFingerprint = value.fingerprint;
  }
  return next;
}
/** Replayed observations preserve the accepted source/evidence identity. Stale decisions stay stale. */
export function checkDecisionSources(current: Decision[], value: z.infer<typeof decisionSourceCheckSchema>): Decision[] {
  const affected = current.filter(d => d.status === 'ACTIVE' && (d.validatedFingerprint ?? d.sourceFingerprint) !== value.fingerprint);
  if (affected.length !== value.checks.length || affected.some(d => !value.checks.some(check => check.id === d.id))) {
    throw new Error('Source check must cover every affected active decision');
  }
  const next = structuredClone(current);
  for (const check of value.checks) {
    const decision = next.find(d => d.id === check.id);
    if (!decision || decision.status !== 'ACTIVE' || (decision.validatedFingerprint ?? decision.sourceFingerprint) === value.fingerprint) {
      throw new Error('Source check requires an active decision and a new repository snapshot');
    }
    if (decision.sourceScope) {
      const expected = decision.sourceScope.files;
      if (!check.files || check.files.length !== expected.length || expected.some(file => !check.files!.some(actual => actual.path === file.path))) {
        throw new Error('Source check must cover every declared dependency exactly');
      }
      if (expected.every(file => check.files!.find(actual => actual.path === file.path)!.fingerprint === file.fingerprint)) {
        decision.validatedFingerprint = value.fingerprint;
        continue;
      }
    } else if (check.files) throw new Error('Repository-wide decision cannot narrow its dependency scope');
    decision.status = 'STALE';
    decision.staleAtFingerprint = value.fingerprint;
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
