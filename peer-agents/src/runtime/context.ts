import { assertNonSecret } from '../security.js';
import { digest } from './identity.js';

export type Allocation = { window: number; occupied: number; host: number; output: number; tools: number; margin: number; ceiling: number; remaining: number };
export type Checkpoint = { session?: string; packageHash: string; cursor: number; policyVersion: string; fingerprint: string; graphVersion: string | null; contextVersion: number };
export function contextPackage(input: {
  task: { id: string; revision: number; [key: string]: unknown }; role: string; question: string; constraints: string[];
  evidence: { id: string; text: string; mandatory: boolean }[]; events: { sequence: number; [key: string]: unknown }[];
  policyVersion: string; fingerprint: string; graphVersion: string | null; allocation: Allocation;
  checkpoint?: Checkpoint; session?: { id: string; valid: boolean; acknowledgedHash: string };
}) {
  assertNonSecret(input);
  if (Object.values(input.allocation).some(n => !Number.isFinite(n) || n < 0)) throw new Error('Invalid context allocation');
  const a = input.allocation;
  const usable = Math.max(0, a.window - a.occupied - a.host - a.output - a.tools - a.margin);
  const limit = Math.min(usable, a.ceiling, a.remaining);
  const cp = input.checkpoint;
  const delta = Boolean(cp && input.session?.valid && cp.session === input.session.id &&
    cp.packageHash === input.session.acknowledgedHash && cp.policyVersion === input.policyVersion &&
    cp.fingerprint === input.fingerprint && cp.graphVersion === input.graphVersion &&
    cp.contextVersion === 1 && cp.cursor <= input.task.revision);
  const base = {
    schemaVersion: 1, kind: delta ? 'DELTA' : 'FULL', task: input.task, role: input.role, question: input.question,
    constraints: input.constraints, policyVersion: input.policyVersion, fingerprint: input.fingerprint,
    graphVersion: input.graphVersion, events: input.events.filter(e => !delta || e.sequence > cp!.cursor),
    evidence: input.evidence.filter(e => e.mandatory), omissions: [] as string[],
    allocation: { ...a, usable, limit, estimator: 'utf8-bytes-conservative-v1', estimated: true },
  };
  // One token per UTF-8 byte is deliberately conservative across scripts; no false precision.
  const cost = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');
  if (cost(base) > limit) throw new Error('INSUFFICIENT_CONTEXT: split consultation or retrieve iteratively; mandatory evidence retained');
  for (const item of input.evidence.filter(e => !e.mandatory)) {
    const trial = { ...base, evidence: [...base.evidence, item] };
    if (cost(trial) + 256 <= limit) base.evidence.push(item); else base.omissions.push(item.id);
  }
  if (cost(base) + 80 > limit) throw new Error('INSUFFICIENT_CONTEXT: package metadata exceeds allocation');
  return { ...base, hash: digest(base) };
}
