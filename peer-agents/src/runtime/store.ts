import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import * as z from 'zod/v4';
import { assertNonSecret } from '../security.js';
import { database, transaction } from './database.js';
import { canonical, contentHash, digest } from './identity.js';
import type { Choice, TaskState } from './contracts.js';
import { approvalGrantSchema } from './approval.js';
import { taskToolPlanSchema } from '../tool-selection.js';
import { resourceAssignmentSchema } from './resource-routing.js';
import { acceptedDecisionSchema, decisionInvalidationSchema, decisionSourceCheckSchema, acceptDecision, invalidateDecisions, checkDecisionSources } from './decisions.js';
import type { RepositorySnapshot } from './repository.js';
import { evidenceReferences, evidenceRelevance, evidenceQuerySchema, evidenceReadSchema } from './evidence.js';

const text = z.string().min(1);
const evidenceInputSchema = z.object({ text: z.string(), classification: z.enum(['PUBLIC', 'PROJECT']), source: text, version: text }).strict();
const evidenceSchema = evidenceInputSchema.extend({ id: z.string().regex(/^[a-f0-9]{64}$/),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/), collectedAt: z.iso.datetime(),
  method: z.literal('runtime-observed'), retention: z.literal('HOT'),
});
const choice = z.object({
  agent: text, model: text, effort: text, efforts: z.array(text), roles: z.array(z.enum(['lead', 'reviewer', 'specialist', 'consultant'])),
  competence: z.number().finite(), cost: z.number().nonnegative(), latency: z.number().nonnegative(),
  contextWindow: z.number().positive(), availability: text, authentication: text, provider: text, quotaPool: text,
  resource: resourceAssignmentSchema.optional(),
}).strict();
const schemas = {
  TASK_CREATED: z.object({ objective: text, repository: text, baseline: text, manifestDigest: text, environmentDigest: text }).strict(),
  ASSIGNED: choice,
  NOTE_RECORDED: z.object({ note: text }).strict(),
  EVIDENCE_LINKED: z.object({ evidence: z.string().regex(/^[a-f0-9]{64}$/), mandatory: z.boolean().optional() }).strict(),
  DECISION_ACCEPTED: acceptedDecisionSchema,
  DECISIONS_INVALIDATED: decisionInvalidationSchema,
  DECISION_SOURCES_CHECKED: decisionSourceCheckSchema,
  WORKTREE_CREATED: z.object({ path: text, baseSha: text }).strict(),
  CONTEXT_PACKAGED: z.object({ hash: text, kind: z.enum(['FULL', 'DELTA']), evidence: z.array(text), role: text.optional(), toolSelection: taskToolPlanSchema.optional() }).strict(),
  LEAD_FINISHED: z.object({ evidence: text }).strict(),
  TEST_RECORDED: z.object({ phase: text, passed: z.boolean(), command: z.array(text).min(1), evidence: text }).strict(),
  REVIEW_RECORDED: z.object({ agent: text.optional(), outcome: z.enum(['APPROVE', 'REQUEST_CHANGES', 'BLOCKED', 'UNAVAILABLE']), findings: z.array(text), reason: text.optional() }).strict(),
  CHECKPOINT_SAVED: z.object({ cursor: z.number().int(), fingerprint: text, policyVersion: text, packageHash: text, contextVersion: z.number().int(), session: text.optional() }).strict(),
  PATCH_EXPORTED: z.object({ path: text, hash: text, bytes: z.number().int().positive() }).strict(),
  INTEGRATION_AUTHORIZED: z.object({ operationDigest: text, actor: text }).strict(),
  INTEGRATION_STARTED: approvalGrantSchema,
  INTEGRATED: z.object({ operationDigest: text }).strict(),
  TASK_COMPLETED: z.object({}).strict(),
  TASK_BLOCKED: z.object({ reason: text }).strict(),
};
export type Event = {
  schemaVersion: 1; id: string; taskId: string; sequence: number; actor: string; at: string;
  type: keyof typeof schemas; expectedRevision: number; causation: string | null;
  classification: 'PROJECT'; payload: unknown; previousHash: string; hash: string;
};
function reduce(state: TaskState | undefined, event: Event): TaskState {
  const payload = schemas[event.type].parse(event.payload);
  if (event.type === 'TASK_CREATED') {
    if (state) throw new Error('Task already created');
    return { ...schemas.TASK_CREATED.parse(payload), id: event.taskId, revision: 1, contextVersion: 1,
      status: 'CREATED', leadFinished: false, tests: [], reviews: [], notes: [], degraded: false };
  }
  if (!state || state.status === 'COMPLETE') throw new Error('Invalid task transition');
  const next = structuredClone(state);
  next.revision = event.sequence; next.contextVersion++;
  switch (event.type) {
    case 'ASSIGNED': next.assignment = payload as Choice; next.status = 'RUNNING'; break;
    case 'NOTE_RECORDED': next.notes.push(schemas.NOTE_RECORDED.parse(payload).note); break;
    case 'EVIDENCE_LINKED': break; // The immutable event is the task's evidence association.
    case 'DECISION_ACCEPTED': next.decisions = acceptDecision(next.decisions ?? [], schemas.DECISION_ACCEPTED.parse(payload), event.at, event.sequence); break;
    case 'DECISIONS_INVALIDATED': next.decisions = invalidateDecisions(next.decisions ?? [], schemas.DECISIONS_INVALIDATED.parse(payload)); break;
    case 'DECISION_SOURCES_CHECKED': next.decisions = checkDecisionSources(next.decisions ?? [], schemas.DECISION_SOURCES_CHECKED.parse(payload)); break;
    case 'WORKTREE_CREATED': {
      const p = schemas.WORKTREE_CREATED.parse(payload); next.worktree = p.path; next.baseSha = p.baseSha; break;
    }
    case 'LEAD_FINISHED': next.leadFinished = true; break;
    case 'TEST_RECORDED': next.tests.push(schemas.TEST_RECORDED.parse(payload)); break;
    case 'REVIEW_RECORDED': {
      const p = schemas.REVIEW_RECORDED.parse(payload); next.reviews.push(p);
      if (p.outcome === 'UNAVAILABLE') next.degraded = true;
      break;
    }
    case 'CHECKPOINT_SAVED': next.checkpoint = schemas.CHECKPOINT_SAVED.parse(payload); next.status = 'CHECKPOINTED'; break;
    case 'PATCH_EXPORTED': next.patch = schemas.PATCH_EXPORTED.parse(payload); next.status = 'READY'; break;
    case 'INTEGRATION_AUTHORIZED':
      if (next.status !== 'READY' || !next.patch) throw new Error('No verified patch ready');
      next.integration = { ...schemas.INTEGRATION_AUTHORIZED.parse(payload), integrated: false }; break;
    case 'INTEGRATION_STARTED': {
      if (next.status !== 'READY' || !next.patch || next.integration) throw new Error('Integration requires reconciliation or a ready patch');
      const { operationDigest, actor, approvalId, issuer, issuedAt, expiresAt } = schemas.INTEGRATION_STARTED.parse(payload);
      next.integration = { operationDigest, actor, approvalId, issuer, issuedAt, expiresAt, integrated: false };
      next.status = 'INTEGRATING'; break;
    }
    case 'INTEGRATED':
      if (!next.integration || next.integration.operationDigest !== schemas.INTEGRATED.parse(payload).operationDigest) throw new Error('Approval mismatch');
      next.integration.integrated = true; break;
    case 'TASK_COMPLETED':
      if (!next.integration?.integrated || !next.tests.length || next.tests.some(t => !t.passed)
        || next.reviews.some(r => ['BLOCKED', 'REQUEST_CHANGES'].includes(r.outcome))) throw new Error('Unresolved completion gates');
      next.status = 'COMPLETE'; break;
    case 'TASK_BLOCKED': next.status = 'BLOCKED'; next.notes.push(schemas.TASK_BLOCKED.parse(payload).reason); break;
  }
  return next;
}
export class TaskStore {
  private readonly db: DatabaseSync;
  constructor(file: string) {
    this.db = database(file, 'task');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events(task_id TEXT NOT NULL, sequence INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY(task_id,sequence)) STRICT;
      CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, revision INTEGER NOT NULL, state TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS evidence(id TEXT PRIMARY KEY, body TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS leases(resource TEXT PRIMARY KEY, owner TEXT NOT NULL, pid INTEGER NOT NULL) STRICT;
      CREATE TRIGGER IF NOT EXISTS immutable_events_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'events are append-only'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_events_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'events are append-only'); END;
      CREATE UNIQUE INDEX IF NOT EXISTS approval_consumed_once ON events(json_extract(body, '$.payload.approvalId')) WHERE json_extract(body, '$.type') = 'INTEGRATION_STARTED';
    `);
  }
  create(input: z.infer<typeof schemas.TASK_CREATED>): TaskState {
    return this.append(randomUUID(), 0, 'TASK_CREATED', input);
  }
  append(id: string, expected: number, type: string, payload: unknown, actor = 'runtime'): TaskState {
    if (type === 'INTEGRATION_AUTHORIZED') throw new Error('Unsigned legacy approval is replay-only; trusted host approval required');
    if (!(type in schemas)) throw new Error('Unknown event type');
    assertNonSecret({ payload, actor });
    schemas[type as keyof typeof schemas].parse(payload);
    return transaction(this.db, () => {
      const row = this.db.prepare('SELECT state, revision FROM tasks WHERE id=?').get(id);
      if ((row?.revision ?? 0) !== expected) throw new Error('Task revision conflict');
      const previous = row ? this.get(id) : undefined;
      if (type === 'DECISION_ACCEPTED') this.validateDecisionEvidence(payload);
      if (type === 'EVIDENCE_LINKED') this.readEvidence(schemas.EVIDENCE_LINKED.parse(payload).evidence);
      const priorEvent = this.db.prepare('SELECT body FROM events WHERE task_id=? ORDER BY sequence DESC LIMIT 1').get(id);
      const prior = priorEvent ? JSON.parse(String(priorEvent.body)) as Event : undefined;
      const unsigned = { schemaVersion: 1 as const, id: randomUUID(), taskId: id, sequence: expected + 1, actor,
        at: new Date().toISOString(), type: type as keyof typeof schemas, expectedRevision: expected,
        causation: prior?.id ?? null, classification: 'PROJECT' as const, payload, previousHash: prior?.hash ?? '' };
      const event: Event = { ...unsigned, hash: digest(unsigned) };
      const state = reduce(previous, event);
      this.db.prepare('INSERT INTO events VALUES (?,?,?)').run(id, event.sequence, canonical(event));
      this.db.prepare('INSERT INTO tasks VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,state=excluded.state')
        .run(id, state.revision, canonical(state));
      return state;
    });
  }
  get(id: string): TaskState {
    const row = this.db.prepare('SELECT state FROM tasks WHERE id=?').get(id);
    if (!row) throw new Error('Unknown task');
    const projected = JSON.parse(String(row.state)) as TaskState;
    if (canonical(projected) !== canonical(this.replay(id))) throw new Error('Corrupt task projection; mutation stopped');
    return projected;
  }
  events(id: string): Event[] {
    return this.db.prepare('SELECT body FROM events WHERE task_id=? ORDER BY sequence').all(id).map(row => JSON.parse(String(row.body)) as Event);
  }
  replay(id: string): TaskState {
    let state: TaskState | undefined;
    let previous = '';
    for (const event of this.events(id)) {
      const { hash, ...unsigned } = event;
      if (event.schemaVersion !== 1 || event.sequence !== (state?.revision ?? 0) + 1 || event.previousHash !== previous || digest(unsigned) !== hash) {
        throw new Error('Corrupt event history; mutation stopped');
      }
      state = reduce(state, event); previous = hash;
      if (event.type === 'DECISION_ACCEPTED') this.validateDecisionEvidence(event.payload);
      if (event.type === 'EVIDENCE_LINKED') this.readEvidence(schemas.EVIDENCE_LINKED.parse(event.payload).evidence);
    }
    if (!state) throw new Error('Unknown task');
    return state;
  }
  rebuild(id: string): void {
    transaction(this.db, () => { const state = this.replay(id);
      this.db.prepare('UPDATE tasks SET state=?,revision=? WHERE id=?').run(canonical(state), state.revision, id);
    });
  }
  private validateDecisionEvidence(value: unknown): void {
    const decision = acceptedDecisionSchema.parse(value);
    for (const id of decision.evidence) {
      if (this.readEvidence(id).version !== decision.sourceFingerprint) throw new Error('Decision evidence source snapshot mismatch');
    }
  }
  /** Trusted runtime interface only; never a human approval or agent-callable gate. */
  acceptDecision(id: string, expected: number, value: unknown): TaskState {
    return this.append(id, expected, 'DECISION_ACCEPTED', value);
  }
  invalidateDecisions(id: string, expected: number, fingerprint: string): TaskState {
    decisionInvalidationSchema.shape.fingerprint.parse(fingerprint);
    const state = this.get(id);
    if (state.revision !== expected) throw new Error('Task revision conflict');
    const ids = (state.decisions ?? []).filter(d => d.status === 'ACTIVE' && (d.validatedFingerprint ?? d.sourceFingerprint) !== fingerprint).map(d => d.id);
    if (!ids.length) return state;
    return this.append(id, expected, 'DECISIONS_INVALIDATED', { ids, fingerprint });
  }
  /** Trusted runtime observations only. This method never authorizes an operation. */
  checkDecisionSources(id: string, expected: number, snapshot: RepositorySnapshot): TaskState {
    decisionSourceCheckSchema.shape.fingerprint.parse(snapshot.fingerprint);
    const state = this.get(id);
    if (state.revision !== expected) throw new Error('Task revision conflict');
    const changed = (state.decisions ?? []).filter(d => d.status === 'ACTIVE' &&
      (d.validatedFingerprint ?? d.sourceFingerprint) !== snapshot.fingerprint);
    if (!changed.length) return state;
    if (!changed.some(d => d.sourceScope)) return this.invalidateDecisions(id, expected, snapshot.fingerprint);
    const checks = changed.map(decision => ({ id: decision.id,
      ...(decision.sourceScope ? { files: decision.sourceScope.files.map(file => {
        const actual = snapshot.files.get(file.path);
        return { path: file.path, fingerprint: actual?.regular ? actual.fingerprint : null };
      }) } : {}),
    }));
    return this.append(id, expected, 'DECISION_SOURCES_CHECKED', { fingerprint: snapshot.fingerprint, checks });
  }
  evidence(input: { text: string; classification: string; source: string; version: string }): string {
    if (!['PUBLIC', 'PROJECT'].includes(input.classification)) throw new Error('SECRET or SENSITIVE evidence requires an unavailable protected storage policy');
    assertNonSecret(input);
    evidenceInputSchema.parse(input);
    const id = digest(input);
    const value = { ...input, id, contentHash: contentHash(input.text), collectedAt: new Date().toISOString(), method: 'runtime-observed', retention: 'HOT' };
    this.db.prepare('INSERT OR IGNORE INTO evidence VALUES (?,?)').run(id, canonical(value));
    return id;
  }
  readEvidence(id: string): z.infer<typeof evidenceSchema> {
    const row = this.db.prepare('SELECT body FROM evidence WHERE id=?').get(id);
    if (!row) throw new Error('Missing evidence');
    try {
      const value = evidenceSchema.parse(JSON.parse(String(row.body)));
      assertNonSecret(value);
      const { text, source, version, classification } = value;
      if (value.id !== id || digest({ text, source, version, classification }) !== id || contentHash(text) !== value.contentHash) throw new Error();
      return value;
    } catch { throw new Error('Corrupt evidence'); }
  }
  private taskEvidence(id: string) {
    const state = this.get(id);
    const references = evidenceReferences(state, this.events(id));
    const records = references.filter(ref => ref.stored || this.db.prepare('SELECT 1 FROM evidence WHERE id=?').get(ref.id))
      .map(ref => ({ ...this.readEvidence(ref.id), mandatory: ref.mandatory, consultable: ref.consultable, sequence: ref.sequence }));
    return { state, records };
  }
  queryEvidence(id: string, input: unknown = {}) {
    const request = evidenceQuerySchema.parse(input);
    assertNonSecret(request);
    return transaction(this.db, () => {
      const { state, records } = this.taskEvidence(id);
      const queryHash = digest({ query: request.query, limit: request.limit, maxBytes: request.maxBytes });
      if (request.cursor && (request.cursor.revision !== state.revision || request.cursor.queryHash !== queryHash)) {
        throw new Error('Evidence cursor expired; restart the query');
      }
      const ranked = records.map(record => ({ record, score: evidenceRelevance(request.query, record.source, record.text) }))
        .filter(item => !request.query.trim() || item.score > 0)
        .sort((a, b) => b.score - a.score || b.record.sequence - a.record.sequence || a.record.id.localeCompare(b.record.id));
      const offset = request.cursor?.offset ?? 0;
      const candidates = ranked.slice(offset, offset + request.limit).map(({ record, score }) => {
        const { text, ...metadata } = record;
        return { ...metadata, bytes: Buffer.byteLength(text, 'utf8'), score };
      });
      const items: typeof candidates = [];
      for (const candidate of candidates) {
        // Reserve framing and cursor bytes before accepting complete metadata records.
        if (Buffer.byteLength(JSON.stringify([...items, candidate]), 'utf8') + 512 > request.maxBytes) {
          if (!items.length) throw new Error('INSUFFICIENT_CONTEXT: evidence metadata exceeds retrieval budget');
          break;
        }
        items.push(candidate);
      }
      const next = offset + items.length;
      return { taskId: id, revision: state.revision, policy: 'lexical-v1', total: ranked.length, items,
        nextCursor: next < ranked.length ? { revision: state.revision, queryHash, offset: next } : null };
    });
  }
  readTaskEvidence(id: string, input: unknown) {
    const request = evidenceReadSchema.parse(input);
    return transaction(this.db, () => {
      const state = this.get(id);
      if (!evidenceReferences(state, this.events(id)).some(ref => ref.id === request.evidenceId)) {
        throw new Error('Evidence is outside task scope');
      }
      const record = this.readEvidence(request.evidenceId);
      if (Buffer.byteLength(JSON.stringify(record), 'utf8') > request.maxBytes) {
        throw new Error('INSUFFICIENT_CONTEXT: exact evidence exceeds retrieval budget; increase maxBytes or split the consultation');
      }
      return record;
    });
  }
  contextEvidence(id: string, fingerprint: string, query: string) {
    return transaction(this.db, () => {
      const { records } = this.taskEvidence(id);
      const ranked = records.map(record => ({ record, score: evidenceRelevance(query, record.source, record.text) }))
        .sort((a, b) => b.score - a.score || b.record.sequence - a.record.sequence || a.record.id.localeCompare(b.record.id));
      const selected = ranked.filter(({ record, score }) => record.mandatory ||
        (record.consultable && record.version === fingerprint && (score > 0 || record.source.startsWith('agent-report:'))));
      const ids = new Set(selected.map(item => item.record.id));
      return { evidence: selected.map(({ record }) => {
        const { id, text, source, version, classification, contentHash, mandatory } = record;
        return { id, text, source, version, classification, contentHash, mandatory };
      }),
        omissions: records.filter(record => !ids.has(record.id)).map(record => record.id) };
    });
  }
  /** Read-only repository-wide plan. No evidence, events, patches or approvals are deleted. */
  retentionReport() {
    return transaction(this.db, () => {
      const protectedIds = new Set<string>(), hotIds = new Set<string>();
      const externalReferences = new Set<string>();
      for (const row of this.db.prepare('SELECT id FROM tasks ORDER BY id').all()) {
        const state = this.get(String(row.id));
        for (const ref of evidenceReferences(state, this.events(state.id))) {
          const exists = this.db.prepare('SELECT 1 FROM evidence WHERE id=?').get(ref.id);
          if (ref.stored || exists) {
            this.readEvidence(ref.id);
            protectedIds.add(ref.id);
            if (ref.mandatory) hotIds.add(ref.id);
          } else externalReferences.add(ref.id);
        }
      }
      const items = this.db.prepare('SELECT id FROM evidence ORDER BY id').all().map(row => {
        const record = this.readEvidence(String(row.id));
        const proposedTier = hotIds.has(record.id) ? 'HOT' : protectedIds.has(record.id) ? 'WARM' : 'COLD';
        return { id: record.id, proposedTier, protected: protectedIds.has(record.id),
          bytes: Buffer.byteLength(JSON.stringify(record), 'utf8'), physicalStorage: record.retention };
      });
      return { schemaVersion: 1, mode: 'PLAN_ONLY', policy: 'references-v1', items,
        externalReferences: [...externalReferences].sort(), deletionAllowed: false };
    });
  }
  acquire(resource: string, owner: string): void {
    transaction(this.db, () => {
      const existing = this.db.prepare('SELECT owner,pid FROM leases WHERE resource=?').get(resource);
      if (existing) {
        let alive = true;
        try { process.kill(Number(existing.pid), 0); } catch (e) { alive = (e as NodeJS.ErrnoException).code !== 'ESRCH'; }
        if (alive) throw new Error('Resource leased by another execution');
        this.db.prepare('DELETE FROM leases WHERE resource=?').run(resource);
      }
      this.db.prepare('INSERT INTO leases VALUES (?,?,?)').run(resource, owner, process.pid);
    });
  }
  release(resource: string, owner: string): void {
    this.db.prepare('DELETE FROM leases WHERE resource=? AND owner=?').run(resource, owner);
  }
  close(): void { this.db.close(); }
}
