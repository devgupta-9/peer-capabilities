import { existsSync, lstatSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import * as z from 'zod/v4';
import { database, transaction } from './runtime/database.js';
import { directoryIdentity, assertIdentity, type DirectoryIdentity } from './filesystem-identity.js';
import { assertNonSecret } from './security.js';

const identitySchema = z.object({ displayPath: z.string(), canonicalPath: z.string(), objectId: z.string(), key: z.string() }).strict();
const projectSchema = z.object({ id: z.string(), identity: identitySchema, enabled: z.boolean(),
  authorizationMode: z.literal('ENROLLED'), createdAt: z.string(), updatedAt: z.string() }).strict();
export type EnrolledProject = z.infer<typeof projectSchema>;

/** Environment control state, never task state or credentials. Reopen on each
 * operation so a long-lived MCP process observes enrollment/revocation commits.
 * No MCP mutation tool: the writer is the local operator CLI. */
export class WorkspaceRegistry {
  readonly file: string;
  private anchor: DirectoryIdentity;
  constructor(file: string) {
    if (!path.isAbsolute(file)) throw new Error('Workspace registry path must be absolute');
    let ancestor = path.dirname(file);
    const suffix = [path.basename(file)];
    while (!existsSync(ancestor)) { suffix.unshift(path.basename(ancestor)); ancestor = path.dirname(ancestor); }
    // Canonicalize an existing ancestor once (including OS aliases such as /var
    // on macOS). Subsequent redirection of that ancestor still fails closed.
    this.anchor = directoryIdentity(ancestor);
    this.file = path.join(this.anchor.canonicalPath, ...suffix);
    if (existsSync(path.dirname(file)) && lstatSync(path.dirname(file)).isSymbolicLink()) throw new Error('Redirected workspace registry');
  }
  private open(write: boolean): DatabaseSync | undefined {
    if (!path.isAbsolute(this.file)) throw new Error('Workspace registry path must be absolute');
    assertIdentity(this.anchor);
    if (directoryIdentity(this.anchor.displayPath).key !== this.anchor.key) throw new Error('Workspace registry scope changed');
    for (let current = this.file;; current = path.dirname(current)) {
      if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new Error('Redirected workspace registry');
      if (current === this.anchor.canonicalPath || path.dirname(current) === current) break;
    }
    if (!existsSync(this.file) && !write) return undefined;
    if (write) mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const identity = directoryIdentity(path.dirname(this.file));
    const db = write ? database(this.file, 'environment') : new DatabaseSync(this.file, { readOnly: true, timeout: 5000 });
    try {
      if (write) db.exec(`CREATE TABLE IF NOT EXISTS workspace_registry_meta(version INTEGER PRIMARY KEY, identity TEXT NOT NULL) STRICT;
        CREATE TABLE IF NOT EXISTS workspace_projects(id TEXT PRIMARY KEY, body TEXT NOT NULL) STRICT;`);
      const domain = db.prepare('SELECT domain, version FROM schema_meta').all();
      if (domain.length !== 1 || domain[0].domain !== 'environment' || domain[0].version !== 1) throw new Error('Unsupported registry domain/version');
      const versions = db.prepare('SELECT version, identity FROM workspace_registry_meta').all();
      if (!versions.length && write) db.prepare('INSERT INTO workspace_registry_meta VALUES (1, ?)').run(identity.key);
      else if (versions.length !== 1 || versions[0].version !== 1 || versions[0].identity !== identity.key) throw new Error('Workspace registry identity/version changed');
      return db;
    } catch (error) { db.close(); throw error; }
  }
  list(): EnrolledProject[] {
    const db = this.open(false);
    if (!db) return [];
    try { return db.prepare('SELECT body FROM workspace_projects ORDER BY id').all().map(row => projectSchema.parse(JSON.parse(String(row.body)))); }
    finally { db.close(); }
  }
  put(project: EnrolledProject): void {
    assertNonSecret(project);
    const parsed = projectSchema.parse(project), db = this.open(true)!;
    try { transaction(db, () => db.prepare('INSERT INTO workspace_projects VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET body=excluded.body')
      .run(parsed.id, JSON.stringify(parsed))); }
    finally { db.close(); }
  }
  remove(displayPath: string): number {
    const db = this.open(false);
    if (!db) return 0;
    db.close();
    const writer = this.open(true)!;
    try { return transaction(writer, () => {
      const projects = writer.prepare('SELECT body FROM workspace_projects').all().map(row => projectSchema.parse(JSON.parse(String(row.body))));
      // Exact saved names can revoke even missing/redirected references. They
      // never grant access or select a replacement target's unrelated enrollment.
      let matches = projects.filter(p => p.identity.displayPath === displayPath || p.identity.canonicalPath === displayPath);
      if (!matches.length && existsSync(displayPath)) {
        const current = directoryIdentity(displayPath);
        for (const p of projects) if (existsSync(p.identity.displayPath)) {
          const referenced = directoryIdentity(p.identity.displayPath);
          if (referenced.key === current.key && referenced.key !== p.identity.key) throw new Error('Redirected enrollment; remove its exact listed reference');
        }
        matches = projects.filter(p => p.identity.key === current.key);
        for (const p of matches) assertIdentity(p.identity);
      }
      for (const p of matches) writer.prepare('DELETE FROM workspace_projects WHERE id=?').run(p.id);
      return matches.length;
    }); } finally { writer.close(); }
  }
}
