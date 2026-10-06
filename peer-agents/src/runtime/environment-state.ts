import { existsSync, lstatSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { directoryIdentity } from '../filesystem-identity.js';

/** No automatic adoption: old or conflicting state needs deliberate operator reconciliation. */
export function defaultEnvironmentDirectory(root: string, base = path.join(homedir(), '.peer-capabilities', 'environments')): string {
  const identity = directoryIdentity(root);
  const name = 'v2-' + identity.key;
  if (existsSync(base)) for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (!/^(?:v2-)?[a-f0-9]{64}$/.test(entry.name)) continue;
    if (entry.isSymbolicLink()) throw new Error('Redirected environment state requires explicit reconciliation');
    if (!entry.isDirectory() || entry.name === name) continue;
    const file = path.join(base, entry.name, 'environment.sqlite');
    if (!existsSync(file)) continue;
    if (lstatSync(file).isSymbolicLink()) throw new Error('Redirected environment database');
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      const scope = db.prepare('SELECT root FROM environment_scope WHERE id=1').get();
      if (!scope || typeof scope.root !== 'string') throw new Error('Unidentified legacy environment state');
      let same = scope.root === identity.canonicalPath || scope.root === identity.displayPath;
      try { same ||= directoryIdentity(scope.root).key === identity.key; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (same) throw new Error('Legacy or conflicting environment state detected; explicit reconciliation required (no automatic migration)');
    } finally { db.close(); }
  }
  return path.resolve(base, name);
}
