import { assertNonSecret } from '../security.js';
import { contentHash, digest } from './identity.js';
import type { TaskToolPlan } from '../tool-selection.js';
import { projectDecisions, type Decision } from './decisions.js';

export type Allocation = { window: number; occupied: number; host: number; output: number; tools: number; margin: number; ceiling: number; remaining: number };
export type Checkpoint = { session?: string; packageHash: string; cursor: number; policyVersion: string; fingerprint: string; graphVersion: string | null; contextVersion: number };
export type ContextEvidence = { id: string; text: string; mandatory: boolean;
  source?: string; version?: string; classification?: 'PUBLIC' | 'PROJECT'; contentHash?: string };
export function contextPackage(input: {
  task: { id: string; revision: number; [key: string]: unknown }; role: string; question: string; constraints: string[];
  evidence: ContextEvidence[]; events: { sequence: number; [key: string]: unknown }[];
  policyVersion: string; fingerprint: string; graphVersion: string | null; allocation: Allocation;
  checkpoint?: Checkpoint; session?: { id: string; valid: boolean; acknowledgedHash: string };
  toolSelection?: TaskToolPlan;
  decisions?: Decision[];
  excludedEvidence?: string[];
}) {
  assertNonSecret(input);
  if (Object.values(input.allocation).some(n => !Number.isFinite(n) || n < 0)) throw new Error('Invalid context allocation');
  const a = input.allocation;
  const usable = Math.max(0, a.window - a.occupied - a.host - a.output - a.tools - a.margin);
  const limit = Math.min(usable, a.ceiling, a.remaining);
  const cp = input.checkpoint;
  const decisions = input.decisions ? projectDecisions(input.decisions) : undefined;
  for (const decision of decisions?.current ?? []) {
    if (decision.status === 'ACTIVE' && (decision.validatedFingerprint ?? decision.sourceFingerprint) !== input.fingerprint) throw new Error('STALE_DECISION_CONTEXT');
    for (const id of decision.evidence) {
      const matches = input.evidence.filter(e => e.id === id), item = matches[0];
      if (matches.length !== 1 || !item.mandatory || !item.source || item.version !== decision.sourceFingerprint ||
        !['PUBLIC', 'PROJECT'].includes(item.classification ?? '') || contentHash(item.text) !== item.contentHash ||
        digest({ text: item.text, source: item.source, version: item.version, classification: item.classification }) !== id) {
        throw new Error('DECISION_EVIDENCE_REQUIRED');
      }
    }
  }
  const evidenceIds = new Set(input.evidence.map(item => item.id));
  if (evidenceIds.size !== input.evidence.length || input.excludedEvidence?.some(id => evidenceIds.has(id))) {
    throw new Error('DUPLICATE_CONTEXT_EVIDENCE');
  }
  const delta = Boolean(cp && input.session?.valid && cp.session === input.session.id &&
    cp.packageHash === input.session.acknowledgedHash && cp.policyVersion === input.policyVersion &&
    cp.fingerprint === input.fingerprint && cp.graphVersion === input.graphVersion &&
    cp.contextVersion === 1 && cp.cursor <= input.task.revision);
  const base = {
    schemaVersion: 1, kind: delta ? 'DELTA' : 'FULL', task: input.task, role: input.role, question: input.question,
    constraints: input.constraints, policyVersion: input.policyVersion, fingerprint: input.fingerprint,
    graphVersion: input.graphVersion, events: input.events.filter(e => !delta || e.sequence > cp!.cursor),
    ...(input.toolSelection ? { toolSelection: input.toolSelection } : {}),
    ...(decisions ? { decisions } : {}),
    evidence: input.evidence.filter(e => e.mandatory),
    omissions: [...new Set([...(input.excludedEvidence ?? []), ...input.evidence.filter(e => !e.mandatory).map(e => e.id)])],
    allocation: { ...a, usable, limit, estimator: 'utf8-bytes-conservative-v1', estimated: true },
  };
  // One token per UTF-8 byte is deliberately conservative across scripts; no false precision.
  const cost = (value: typeof base) => Buffer.byteLength(JSON.stringify({ ...value, hash: '0'.repeat(64) }), 'utf8');
  if (cost(base) > limit) throw new Error('INSUFFICIENT_CONTEXT: split consultation or retrieve iteratively; mandatory evidence retained');
  for (const item of input.evidence.filter(e => !e.mandatory)) {
    const trial = { ...base, evidence: [...base.evidence, item], omissions: base.omissions.filter(id => id !== item.id) };
    if (cost(trial) <= limit) {
      base.evidence.push(item);
      base.omissions = trial.omissions;
    }
  }
  return { ...base, hash: digest(base) };
}
