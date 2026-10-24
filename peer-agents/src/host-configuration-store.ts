import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { assertIdentity, childPath, directoryIdentity, type DirectoryIdentity } from './filesystem-identity.js';
import { database, transaction } from './runtime/database.js';
import { reconcileHost, type HostFormat, type ServerRegistration } from './host-configuration.js';
import { assertNonSecret } from './security.js';

export type HostTarget = { host: string; relativePath: string; format: HostFormat; servers: Record<string, ServerRegistration> };
type Change = { host: string; relativePath: string; beforeHash: string | null; afterHash: string; servers: string[] };
export type DeploymentBindings = Record<string, Partial<Record<'peer-agents' | 'jev' | 'rea', { runtimeRoot?: string; entry?: string }>>>;
type RecordEntry = { version: 1; id: string; identity: string; status: 'PLANNED' | 'COMPLETE' | 'ROLLED_BACK'; changes: Change[]; bindings?: DeploymentBindings };
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const read = (file: string): string | null => existsSync(file) ? readFileSync(file, 'utf8') : null;
const fingerprint = (text: string | null) => text === null ? null : hash(text);

/** Explicit local host setup, NOT an agent-callable capability. Stores only metadata in SQLite. */
export class HostConfigurationStore {
  private readonly root: DirectoryIdentity;
  private readonly stateRelative = '.peer-capabilities/host-configuration';
  constructor(root: string) { this.root = directoryIdentity(root); }

  private file(relative: string): string {
    assertIdentity(this.root);
    const file = childPath(this.root.canonicalPath, relative);
    let current = this.root.canonicalPath;
    for (const part of path.relative(current, file).split(path.sep)) {
      current = path.join(current, part);
      try {
        const info = lstatSync(current);
        if (info.isSymbolicLink() || (info.isFile() && info.nlink > 1)) throw new Error('Redirected host configuration path');
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    return file;
  }
  private prepare(targets: HostTarget[]) {
    const seen = new Set<string>();
    return targets.map(target => {
      const file = this.file(target.relativePath);
      if (seen.has(file)) throw new Error('Duplicate host destination');
      seen.add(file);
      const before = read(file);
      const result = reconcileHost(before, target.format, target.servers);
      return { before, after: result.text, change: {
        host: target.host, relativePath: target.relativePath, beforeHash: fingerprint(before),
        afterHash: hash(result.text), servers: result.changedServers,
      } };
    }).filter(item => item.change.servers.length);
  }
  preview(targets: HostTarget[]) {
    const changes = this.prepare(targets).map(item => item.change);
    return { digest: hash(JSON.stringify(changes)), changes, note: 'TOML formatting/comments may change; settings and value types are preserved.' };
  }
  private open() {
    const file = this.file(this.stateRelative + '/environment.sqlite');
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    for (const suffix of ['', '-wal', '-shm']) this.file(this.stateRelative + '/environment.sqlite' + suffix);
    const db = database(file, 'environment');
    db.exec('CREATE TABLE IF NOT EXISTS host_configuration_operations (id TEXT PRIMARY KEY, body TEXT NOT NULL) STRICT');
    return db;
  }
  private replace(relative: string, text: string, expected: string | null) {
    const file = this.file(relative);
    if (fingerprint(read(file)) !== expected) throw new Error('Host changed since preview; refusing overwrite');
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temporary = relative + '.' + randomUUID() + '.tmp';
    const temp = this.file(temporary);
    try {
      writeFileSync(temp, text, { flag: 'wx', mode: 0o600 });
      if (fingerprint(read(this.file(relative))) !== expected) throw new Error('Host changed during apply; refusing overwrite');
      renameSync(this.file(temporary), this.file(relative));
      if (fingerprint(read(this.file(relative))) !== hash(text)) throw new Error('Host write verification failed');
    } finally { if (existsSync(temp)) unlinkSync(this.file(temporary)); }
  }
  apply(targets: HostTarget[], expectedDigest: string, bindings?: DeploymentBindings) {
    if (bindings) {
      assertNonSecret(bindings);
      for (const [host, components] of Object.entries(bindings)) {
        for (const [component, locations] of Object.entries(components)) {
          if (!targets.some(target => target.host === host && component in target.servers)) throw new Error('Binding outside selected host/components');
          for (const [key, value] of Object.entries(locations)) {
            if (!['runtimeRoot','entry'].includes(key) || typeof value !== 'string' || !path.isAbsolute(value)) throw new Error('Invalid deployment binding');
          }
        }
      }
    }
    const prepared = this.prepare(targets);
    const changes = prepared.map(item => item.change);
    if (hash(JSON.stringify(changes)) !== expectedDigest) throw new Error('Host plan changed; inspect a new preview');
    if (!changes.length && !bindings) return { status: 'UNCHANGED', changedHosts: 0 };
    const record: RecordEntry = { version: 1, id: randomUUID(), identity: this.root.key, status: 'PLANNED', changes, bindings };
    const db = this.open();
    try {
      db.prepare('INSERT INTO host_configuration_operations VALUES (?,?)').run(record.id, JSON.stringify(record));
      transaction(db, () => {
        // Complete preflight before any target changes. Failed/interrupted records remain recoverable.
        for (const item of prepared) if (fingerprint(read(this.file(item.change.relativePath))) !== item.change.beforeHash) throw new Error('Host changed since preview');
        const backupDirectory = this.file(this.stateRelative + '/' + record.id + '/placeholder');
        mkdirSync(path.dirname(backupDirectory), { recursive: true, mode: 0o700 });
        for (const [index, item] of prepared.entries()) {
          if (item.before !== null) writeFileSync(this.file(`${this.stateRelative}/${record.id}/${index}.original`), item.before, { flag: 'wx', mode: 0o600 });
        }
        for (const item of prepared) this.replace(item.change.relativePath, item.after, item.change.beforeHash);
        record.status = 'COMPLETE';
        db.prepare('UPDATE host_configuration_operations SET body=? WHERE id=?').run(JSON.stringify(record), record.id);
      });
      return { status: record.status, operation: record.id, changedHosts: changes.length };
    } catch { throw new Error(`Host setup incomplete; inspect or roll back operation ${record.id}. Configuration details withheld.`); }
    finally { db.close(); }
  }
  rollback(id: string) {
    if (!/^[\da-f-]{36}$/.test(id)) throw new Error('Invalid operation ID');
    const db = this.open();
    try {
      return transaction(db, () => {
        const row = db.prepare('SELECT body FROM host_configuration_operations WHERE id=?').get(id);
        if (!row) throw new Error('Unknown host operation');
        const record: RecordEntry = JSON.parse(String(row.body));
        if (record.version !== 1 || record.identity !== this.root.key) throw new Error('Host operation scope changed');
        if (record.status === 'ROLLED_BACK') return { status: record.status, operation: id };
        const restores = record.changes.map((change, index) => {
          const current = fingerprint(read(this.file(change.relativePath)));
          if (current !== change.beforeHash && current !== change.afterHash) throw new Error('Host edited after setup; rollback preserves user edits');
          const before = change.beforeHash === null ? null : read(this.file(`${this.stateRelative}/${id}/${index}.original`));
          if (current !== change.beforeHash && fingerprint(before) !== change.beforeHash) throw new Error('Host backup missing or changed');
          return { change, before, needed: current !== change.beforeHash };
        });
        for (const { change, before, needed } of restores) if (needed) {
          if (before === null) unlinkSync(this.file(change.relativePath));
          else this.replace(change.relativePath, before, change.afterHash);
        }
        record.status = 'ROLLED_BACK';
        db.prepare('UPDATE host_configuration_operations SET body=? WHERE id=?').run(JSON.stringify(record), id);
        return { status: record.status, operation: id };
      });
    } finally { db.close(); }
  }
}
