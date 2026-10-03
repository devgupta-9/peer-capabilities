import { randomUUID } from 'node:crypto';
import { lstat, readFile, mkdir, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { realpathSync } from 'node:fs';
import { database, transaction } from './database.js';
import { canonical, contentHash, digest } from './identity.js';
import { validateManifest } from './manifest.js';
import { assertNonSecret } from '../security.js';
import * as z from 'zod/v4';
import type { Observation } from './contracts.js';

type Owned = { id: string; destination: string; hash: string; manifestDigest: string };
type Operation = { id: string; destination: string; before: string | null; after: string | null; previous: Owned | null; restoreOwnership?: Owned | null };
type Plan = { id: string; command: string; manifestDigest: string; root: string; operations: Operation[]; status: string; started?: string[] };
const observationSchema = z.object({
  component: z.string().min(1), presence: z.enum(['DISCOVERED', 'INSTALLED', 'CONFIGURED']),
  authentication: z.enum(['UNKNOWN', 'NOT_REQUIRED', 'AUTH_REQUIRED', 'AUTHENTICATED']),
  verification: z.enum(['UNVERIFIED', 'VERIFIED', 'UNAVAILABLE']), observedAt: z.iso.datetime(),
  version: z.string().optional(), scope: z.string().optional(), reason: z.string().optional(), expiresAt: z.iso.datetime().optional(),
}).strict();
async function contents(file: string): Promise<string | null> {
  try { return await readFile(file, 'utf8'); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
}
export class EnvironmentManager {
  private db: DatabaseSync;
  constructor(file: string, private root: string) {
    this.root = realpathSync(root);
    this.db = database(file, 'environment');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ownership(id TEXT PRIMARY KEY, destination TEXT UNIQUE NOT NULL, body TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY, body TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS observations(id TEXT PRIMARY KEY, body TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS locks(id INTEGER PRIMARY KEY CHECK(id=1), pid INTEGER NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS environment_scope(id INTEGER PRIMARY KEY CHECK(id=1), root TEXT NOT NULL) STRICT;
    `);
    const scope = this.db.prepare('SELECT root FROM environment_scope WHERE id=1').get();
    if (scope && scope.root !== this.root) { this.db.close(); throw new Error('Environment scope mismatch; select its original root or a separate state directory'); }
    this.db.prepare('INSERT OR IGNORE INTO environment_scope VALUES (1,?)').run(this.root);
  }
  private async destination(relative: string): Promise<string> {
    if (path.isAbsolute(relative) || relative.split(/[\\/]/).some(x => x === '..' || x.includes(':'))) throw new Error('Path escape');
    const root = await realpath(this.root);
    if (root !== this.root || (await lstat(this.root)).isSymbolicLink()) throw new Error('Managed root scope changed');
    let current = root;
    for (const piece of relative.split(/[\\/]/).filter(Boolean)) {
      current = path.join(current, piece);
      try { if ((await lstat(current)).isSymbolicLink()) throw new Error('Symlink destination forbidden'); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    }
    if (current === root) throw new Error('Root is not a file destination');
    return current;
  }
  private owned(id: string): Owned | null {
    const row = this.db.prepare('SELECT body FROM ownership WHERE id=?').get(id);
    return row ? JSON.parse(String(row.body)) : null;
  }
  private save(plan: Plan): void {
    assertNonSecret(plan);
    this.db.prepare('INSERT INTO operations VALUES (?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(plan.id, canonical(plan));
  }
  async plan(value: unknown, command: 'setup' | 'sync' | 'update' | 'repair'): Promise<Plan> {
    const manifest = validateManifest(value);
    const plan: Plan = { id: randomUUID(), command, manifestDigest: digest(manifest), root: this.root, operations: [], status: 'PLANNED' };
    for (const component of manifest.components) {
      if (component.platforms.length && !component.platforms.includes(process.platform as 'win32' | 'linux' | 'darwin')) {
        if (!component.optional) throw new Error('Required component platform unsupported');
        continue;
      }
      if (component.recipe !== 'managed-file') continue;
      const destination = component.destination!;
      const wanted = component.content!;
      if ('sha256:' + contentHash(wanted) !== component.integrity) throw new Error('Artifact integrity mismatch');
      const before = await contents(await this.destination(destination));
      const owned = this.owned(component.id);
      if (owned && owned.destination !== destination) throw new Error('Ownership destination migration requires explicit removal');
      if (!owned && before !== null && before !== wanted) throw new Error('Unmanaged file conflict');
      if (owned && before !== null && contentHash(before) !== owned.hash) throw new Error('User edit conflict; repair preserves edits');
      if (before === wanted) continue; // matching pre-existing files are observed, not adopted
      plan.operations.push({ id: component.id, destination, before, after: wanted, previous: owned });
    }
    this.save(plan);
    return plan;
  }
  async apply(id: string): Promise<void> {
    const row = this.db.prepare('SELECT body FROM operations WHERE id=?').get(id);
    if (!row) throw new Error('Unknown environment operation');
    const plan: Plan = JSON.parse(String(row.body));
    if (plan.root !== this.root) throw new Error('Environment scope mismatch');
    if (plan.status === 'COMPLETE') return;
    if (!['PLANNED', 'APPLYING'].includes(plan.status)) throw new Error('Operation conflict requires a fresh reconciliation plan');
    const recovering = plan.status === 'APPLYING';
    transaction(this.db, () => {
      const lock = this.db.prepare('SELECT pid FROM locks WHERE id=1').get();
      if (lock) {
        let alive = true;
        try { process.kill(Number(lock.pid), 0); } catch (e) { alive = (e as NodeJS.ErrnoException).code !== 'ESRCH'; }
        if (alive) throw new Error('Environment operation already active');
        this.db.exec('DELETE FROM locks');
      }
      this.db.prepare('INSERT INTO locks VALUES (1,?)').run(process.pid);
    });
    try {
      plan.status = 'APPLYING'; this.save(plan);
      for (const op of plan.operations) {
        const destination = await this.destination(op.destination);
        const actual = await contents(destination);
        const recoveringOperation = recovering && plan.started?.includes(op.id);
        if (!recoveringOperation && actual !== op.before) throw new Error('Stale operation conflict; unmanaged changes are never adopted');
        if (actual !== op.before && actual !== op.after) throw new Error('Operation conflict: actual file differs from journal');
        plan.started = [...new Set([...(plan.started ?? []), op.id])];
        this.save(plan); // per-operation intent precedes the first filesystem effect
        if (actual !== op.after) {
          if (op.after === null) await unlink(destination);
          else {
            await mkdir(path.dirname(destination), { recursive: true });
            const temporary = destination + '.' + plan.id + '.tmp';
            const existingTemporary = await contents(await this.destination(op.destination + '.' + plan.id + '.tmp'));
            if (existingTemporary !== null) {
              if (!recoveringOperation || existingTemporary !== op.after) throw new Error('Temporary output conflict; preserved for inspection');
            } else await writeFile(temporary, op.after, { flag: 'wx', mode: 0o600 });
            // Recheck after preparing output; preserve concurrent user edits.
            if (await contents(destination) !== op.before) throw new Error('Concurrent file conflict');
            await rename(temporary, destination);
          }
        }
        transaction(this.db, () => {
          const owner = op.restoreOwnership !== undefined ? op.restoreOwnership
            : op.after === null ? null
              : { id: op.id, destination: op.destination, hash: contentHash(op.after), manifestDigest: plan.manifestDigest };
          if (!owner) this.db.prepare('DELETE FROM ownership WHERE id=?').run(op.id);
          else {
            this.db.prepare('INSERT INTO ownership VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET destination=excluded.destination,body=excluded.body')
              .run(op.id, op.destination, canonical(owner));
          }
        });
      }
      plan.status = 'COMPLETE'; this.save(plan);
    } catch (error) {
      plan.status = 'CONFLICT'; this.save(plan);
      throw error;
    } finally { this.db.prepare('DELETE FROM locks WHERE pid=?').run(process.pid); }
  }
  async rollback(id: string): Promise<string> {
    const row = this.db.prepare('SELECT body FROM operations WHERE id=?').get(id);
    if (!row) throw new Error('Unknown operation');
    const original: Plan = JSON.parse(String(row.body));
    if (original.status !== 'COMPLETE') throw new Error('Reconcile interrupted operation before rollback');
    const reverse: Plan = { ...original, id: randomUUID(), command: 'rollback', status: 'PLANNED', started: [],
      operations: [...original.operations].reverse().map(op => ({
        ...op, before: op.after, after: op.before, previous: this.owned(op.id), restoreOwnership: op.previous,
      })) };
    // Rollback never overwrites changes made after the original operation.
    for (const op of reverse.operations) {
      if (await contents(await this.destination(op.destination)) !== op.before) throw new Error('Rollback conflict');
    }
    this.save(reverse); await this.apply(reverse.id);
    return reverse.id;
  }
  async uninstall(): Promise<string> {
    const rows = this.db.prepare('SELECT body FROM ownership').all();
    const operations: Operation[] = [];
    for (const row of rows) {
      const owner: Owned = JSON.parse(String(row.body));
      const actual = await contents(await this.destination(owner.destination));
      if (actual !== null && contentHash(actual) !== owner.hash) throw new Error('Uninstall conflict; preserving user edits');
      operations.push({ id: owner.id, destination: owner.destination, before: actual, after: null, previous: owner });
    }
    const plan: Plan = { id: randomUUID(), root: this.root, manifestDigest: 'uninstall', command: 'uninstall', status: 'PLANNED', operations };
    this.save(plan); await this.apply(plan.id); return plan.id;
  }
  async doctor(value: unknown) {
    const manifest = validateManifest(value);
    const observations = [];
    for (const c of manifest.components) {
      const actual = c.recipe === 'managed-file' ? await contents(await this.destination(c.destination!)) : null;
      const verified = c.recipe === 'managed-file' && actual !== null && 'sha256:' + contentHash(actual) === c.integrity;
      const observation = {
        component: c.id, presence: actual !== null ? 'CONFIGURED' : 'DISCOVERED',
        authentication: c.recipe === 'managed-file' ? 'NOT_REQUIRED' : 'UNKNOWN',
        verification: verified ? 'VERIFIED' : c.recipe === 'managed-file' ? 'UNAVAILABLE' : 'UNVERIFIED',
        owned: Boolean(this.owned(c.id)), observedAt: new Date().toISOString(),
        scope: c.recipe === 'managed-file' ? 'managed file hash' : 'declaration only; adapter discovery required',
        releaseSupported: false,
      };
      this.db.prepare('INSERT INTO observations VALUES (?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(c.id, canonical(observation));
      observations.push(observation);
    }
    return observations;
  }
  recordObservation(value: Observation): void {
    assertNonSecret(value);
    const observation = observationSchema.parse(value);
    this.db.prepare('INSERT INTO observations VALUES (?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body')
      .run('agent:' + observation.component, canonical(observation));
  }
  getObservation(component: string): Observation | undefined {
    const row = this.db.prepare('SELECT body FROM observations WHERE id=?').get('agent:' + component);
    return row ? observationSchema.parse(JSON.parse(String(row.body))) : undefined;
  }
  close(): void { this.db.close(); }
}
