import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import * as z from 'zod/v4';
import { assertNonSecret } from '../security.js';
import { availability } from './contracts.js';
import { canonical, digest } from './identity.js';
import { resourceAssignmentSchema } from './resource-routing.js';
import { resourceObservationScopeSchema, type ResourceObservationScope } from './resource-observations.js';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const intentSchema = z.object({ id: z.uuid(), assignment: resourceAssignmentSchema,
  invocationHash: hash, taskHash: hash, startedAt: z.iso.datetime(), ownerPid: z.number().int().positive(),
}).strict();
const completionSchema = z.object({ id: z.uuid(), intentDigest: hash, finishedAt: z.iso.datetime(),
  outcome: availability.or(z.literal('RECONCILED')), reconciliationEvidence: hash.optional(),
}).strict().refine(v => (v.outcome === 'RECONCILED') === (v.reconciliationEvidence !== undefined));
export type ResourceInvocation = z.infer<typeof intentSchema>;

/** Environment-domain journal. Call mutations inside the environment transaction.
 * No prompts, paths, provider output, credentials or provider session IDs. */
export class ResourceInvocations {
  constructor(private db: DatabaseSync) {}
  private initialized(): boolean {
    const tables = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('resource_invocations','resource_invocation_completions')").all();
    const version = this.db.prepare("SELECT version FROM schema_meta WHERE domain='environment'").get()?.version;
    if (!tables.length && version === 1) return false;
    if (tables.length !== 2 || version !== 2) throw new Error('UNSUPPORTED_RESOURCE_INVOCATION_SCHEMA');
    return true;
  }
  private decode<T>(schema: z.ZodType<T>, row: Record<string, unknown>): T {
    try {
      const value = schema.parse(JSON.parse(String(row.body))); assertNonSecret(value);
      if (digest(value) !== row.digest) throw new Error();
      return value;
    } catch { throw new Error('CORRUPT_RESOURCE_INVOCATION'); }
  }
  read(id: string): { intent: ResourceInvocation; completion: z.infer<typeof completionSchema> | null } | null {
    if (!this.initialized()) return null;
    const row = this.db.prepare('SELECT * FROM resource_invocations WHERE id=?').get(id);
    if (!row) return null;
    const intent = this.decode(intentSchema, row);
    if (intent.id !== id || row.scope_key !== digest(intent.assignment.scope)) throw new Error('CORRUPT_RESOURCE_INVOCATION');
    const end = this.db.prepare('SELECT * FROM resource_invocation_completions WHERE id=?').get(id);
    const completion = end ? this.decode(completionSchema, end) : null;
    if (completion && (completion.id !== id || completion.intentDigest !== digest(intent) ||
      Date.parse(completion.finishedAt) < Date.parse(intent.startedAt))) throw new Error('CORRUPT_RESOURCE_INVOCATION');
    return { intent, completion };
  }
  pending(scope: ResourceObservationScope): ResourceInvocation[] {
    resourceObservationScopeSchema.parse(scope);
    if (!this.initialized()) return [];
    // Validate completed records too: corruption must not silently lift a fence.
    const rows = this.db.prepare('SELECT id FROM resource_invocations WHERE scope_key=?').all(digest(scope));
    return rows.map(row => this.read(String(row.id))!).filter(row => !row.completion).map(row => row.intent);
  }
  begin(assignment: unknown, invocationId: string, taskId: string): ResourceInvocation {
    const intent = intentSchema.parse({ id: randomUUID(), assignment,
      invocationHash: digest(invocationId), taskHash: digest(taskId), startedAt: new Date().toISOString(), ownerPid: process.pid });
    assertNonSecret(intent);
    if (this.pending(intent.assignment.scope).length) throw new Error('INVOCATION_PENDING');
    if (!this.initialized()) {
      this.db.exec(`CREATE TABLE resource_invocations(id TEXT PRIMARY KEY, scope_key TEXT NOT NULL,
        digest TEXT NOT NULL, body TEXT NOT NULL) STRICT;
        CREATE INDEX resource_invocation_scope ON resource_invocations(scope_key);
        CREATE TABLE resource_invocation_completions(id TEXT PRIMARY KEY REFERENCES resource_invocations(id),
        digest TEXT NOT NULL, body TEXT NOT NULL) STRICT;
        CREATE TRIGGER immutable_resource_invocation_update BEFORE UPDATE ON resource_invocations
          BEGIN SELECT RAISE(ABORT, 'Immutable invocation intent'); END;
        CREATE TRIGGER immutable_resource_invocation_delete BEFORE DELETE ON resource_invocations
          BEGIN SELECT RAISE(ABORT, 'Immutable invocation intent'); END;
        CREATE TRIGGER immutable_resource_completion_update BEFORE UPDATE ON resource_invocation_completions
          BEGIN SELECT RAISE(ABORT, 'Immutable invocation completion'); END;
        CREATE TRIGGER immutable_resource_completion_delete BEFORE DELETE ON resource_invocation_completions
          BEGIN SELECT RAISE(ABORT, 'Immutable invocation completion'); END;
        UPDATE schema_meta SET version=2 WHERE domain='environment';`);
    }
    this.db.prepare('INSERT INTO resource_invocations VALUES(?,?,?,?)')
      .run(intent.id, digest(intent.assignment.scope), digest(intent), canonical(intent));
    if (digest(this.read(intent.id)?.intent) !== digest(intent)) throw new Error('RESOURCE_INVOCATION_WRITE_FAILED');
    return intent;
  }
  finish(id: string, intentDigest: string, outcome: z.infer<typeof completionSchema>['outcome'], reconciliationEvidence?: string): void {
    const current = this.read(id);
    if (!current || digest(current.intent) !== intentDigest) throw new Error('RESOURCE_INVOCATION_CONFLICT');
    if (current.completion) {
      if (current.completion.outcome !== outcome || current.completion.reconciliationEvidence !== reconciliationEvidence) throw new Error('RESOURCE_INVOCATION_CONFLICT');
      return;
    }
    const completion = completionSchema.parse({ id, intentDigest, outcome, reconciliationEvidence, finishedAt: new Date().toISOString() });
    assertNonSecret(completion);
    if (Date.parse(completion.finishedAt) < Date.parse(current.intent.startedAt)) throw new Error('INVOCATION_CLOCK_CHANGED');
    this.db.prepare('INSERT INTO resource_invocation_completions VALUES(?,?,?)').run(id, digest(completion), canonical(completion));
    if (!this.read(id)?.completion) throw new Error('RESOURCE_INVOCATION_WRITE_FAILED');
  }
}
