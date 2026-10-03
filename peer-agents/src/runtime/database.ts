import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export function database(file: string, domain: 'task' | 'environment'): DatabaseSync {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file, { timeout: 5000 });
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
  db.exec('CREATE TABLE IF NOT EXISTS schema_meta (domain TEXT PRIMARY KEY, version INTEGER NOT NULL) STRICT');
  const existing = db.prepare('SELECT domain, version FROM schema_meta').all();
  if (existing.length && (existing[0].domain !== domain || existing[0].version !== 1)) {
    db.close();
    throw new Error('Unsupported database domain or migration version; refusing mutation');
  }
  db.prepare('INSERT OR IGNORE INTO schema_meta VALUES (?, 1)').run(domain);
  return db;
}
export function transaction<T>(db: DatabaseSync, action: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try { const result = action(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
