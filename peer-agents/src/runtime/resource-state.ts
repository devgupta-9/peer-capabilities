import type { DatabaseSync } from 'node:sqlite';
import { transaction } from './database.js';
import { canonical, digest } from './identity.js';
import { validateResources, type ResourceCatalog } from './resources.js';

export type ResourceSnapshot = {
  revision: number; digest: string; savedAt: string; restoredFrom: number | null; catalog: ResourceCatalog;
};
function revision(value: number, allowZero = false): void {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) throw new Error('INVALID_RESOURCE_REVISION');
}

/** An additive, independently versioned part of the existing environment DB.
 * Reads never initialize storage. All DDL and revision writes share a transaction. */
export class ResourceState {
  constructor(private db: DatabaseSync) {}
  private initialized(): boolean {
    const tables = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('resource_schema','resource_catalogs')").all();
    if (!tables.length) return false;
    if (tables.length !== 2) throw new Error('UNSUPPORTED_RESOURCE_SCHEMA');
    const rows = this.db.prepare('SELECT version FROM resource_schema').all();
    if (rows.length !== 1 || rows[0].version !== 1) throw new Error('UNSUPPORTED_RESOURCE_SCHEMA');
    return true;
  }
  read(atRevision?: number): ResourceSnapshot | null {
    if (atRevision !== undefined) revision(atRevision);
    if (!this.initialized()) return null;
    const row = atRevision === undefined
      ? this.db.prepare('SELECT * FROM resource_catalogs ORDER BY revision DESC LIMIT 1').get()
      : this.db.prepare('SELECT * FROM resource_catalogs WHERE revision=?').get(atRevision);
    if (!row) return null;
    try {
      const catalog = validateResources(JSON.parse(String(row.body)));
      revision(Number(row.revision));
      if (digest(catalog) !== row.digest || typeof row.saved_at !== 'string' || !Number.isFinite(Date.parse(row.saved_at))) throw new Error();
      if (row.restored_from !== null) { revision(Number(row.restored_from)); if (Number(row.restored_from) >= Number(row.revision)) throw new Error(); }
      return { revision: Number(row.revision), digest: String(row.digest), savedAt: row.saved_at,
        restoredFrom: row.restored_from === null ? null : Number(row.restored_from), catalog };
    } catch { throw new Error('CORRUPT_RESOURCE_STATE'); }
  }
  save(value: unknown, expectedRevision: number): ResourceSnapshot {
    const catalog = validateResources(value); revision(expectedRevision, true);
    return transaction(this.db, () => this.append(catalog, expectedRevision, null));
  }
  restore(sourceRevision: number, expectedRevision: number): ResourceSnapshot {
    revision(sourceRevision); revision(expectedRevision, true);
    return transaction(this.db, () => {
      const source = this.read(sourceRevision);
      if (!source) throw new Error('RESOURCE_REVISION_NOT_FOUND');
      return this.append(source.catalog, expectedRevision, sourceRevision);
    });
  }
  private append(catalog: ResourceCatalog, expectedRevision: number, restoredFrom: number | null): ResourceSnapshot {
    const current = this.read();
    if ((current?.revision ?? 0) !== expectedRevision) throw new Error('RESOURCE_REVISION_CONFLICT');
    const next = expectedRevision + 1; revision(next);
    if (!this.initialized()) {
      this.db.exec(`CREATE TABLE resource_schema(version INTEGER PRIMARY KEY) STRICT;
        INSERT INTO resource_schema VALUES(1);
        CREATE TABLE resource_catalogs(revision INTEGER PRIMARY KEY CHECK(revision>0),
          digest TEXT NOT NULL, saved_at TEXT NOT NULL, restored_from INTEGER, body TEXT NOT NULL,
          FOREIGN KEY(restored_from) REFERENCES resource_catalogs(revision)) STRICT;`);
    }
    const snapshot = { revision: next, digest: digest(catalog), savedAt: new Date().toISOString(), restoredFrom, catalog };
    this.db.prepare('INSERT INTO resource_catalogs VALUES(?,?,?,?,?)')
      .run(next, snapshot.digest, snapshot.savedAt, restoredFrom, canonical(catalog));
    return snapshot;
  }
}
