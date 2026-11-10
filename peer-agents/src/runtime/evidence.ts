import * as z from 'zod/v4';
import type { TaskState } from './contracts.js';
import type { Event } from './store.js';

export const evidenceQuerySchema = z.object({
  query: z.string().max(2000).default(''),
  limit: z.number().int().min(1).max(100).default(20),
  maxBytes: z.number().int().min(1024).max(16 * 1024 * 1024).default(65536),
  cursor: z.object({ revision: z.number().int().positive(), queryHash: z.string(), offset: z.number().int().nonnegative() }).strict().optional(),
}).strict();
export const evidenceReadSchema = z.object({
  evidenceId: z.string().regex(/^[a-f0-9]{64}$/),
  maxBytes: z.number().int().min(1024).max(16 * 1024 * 1024).default(65536),
}).strict();

export type EvidenceReference = { id: string; mandatory: boolean; stored: boolean; consultable: boolean; sequence: number };

/** Derive scope from validated events. Context history can also contain external patch locators. */
export function evidenceReferences(state: TaskState, events: Event[]): EvidenceReference[] {
  const mandatory = new Set((state.decisions ?? []).filter(d => d.status !== 'SUPERSEDED').flatMap(d => d.evidence));
  for (const test of state.tests) mandatory.add(test.evidence);
  const references = new Map<string, EvidenceReference>();
  for (const event of events) {
    const payload = event.payload as { evidence?: string | string[]; mandatory?: boolean };
    if (!['DECISION_ACCEPTED', 'TEST_RECORDED', 'LEAD_FINISHED', 'EVIDENCE_LINKED', 'CONTEXT_PACKAGED'].includes(event.type)) continue;
    const ids = Array.isArray(payload.evidence) ? payload.evidence : [payload.evidence!];
    for (const id of ids) {
      const previous = references.get(id);
      references.set(id, { id, mandatory: mandatory.has(id) || Boolean(previous?.mandatory) || (event.type === 'EVIDENCE_LINKED' && payload.mandatory === true),
        consultable: event.type === 'EVIDENCE_LINKED' || event.type === 'LEAD_FINISHED' || Boolean(previous?.consultable), sequence: event.sequence,
        stored: event.type !== 'CONTEXT_PACKAGED' || Boolean(previous?.stored) });
    }
  }
  return [...references.values()];
}

/** Deterministic lexical baseline. This score never changes evidence obligations. */
export function evidenceRelevance(query: string, source: string, text: string): number {
  const terms = new Set(query.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []);
  const words = new Set((source + '\n' + text).toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []);
  return [...terms].filter(term => words.has(term)).length;
}
