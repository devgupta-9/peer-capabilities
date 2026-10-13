import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { EnvironmentManager } from '../dist/runtime/environment.js';

const catalog = id => ({ schemaVersion: 1, providers: [{ id }], frontends: [], accounts: [],
  authContexts: [], quotaPools: [], models: [], bindings: [], profiles: [], workers: [] });
async function fixture(run) {
  const dir = await mkdtemp(path.join(tmpdir(), 'peer-resource-state-'));
  const root = path.join(dir, 'root'); await mkdir(root);
  const file = path.join(dir, 'environment.sqlite'); const handles = [];
  const open = () => { const manager = new EnvironmentManager(file, root); handles.push(manager); return manager; };
  try { await run({ dir, root, file, open }); }
  finally { for (const manager of handles) manager.close(); await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
}

test('resource catalog survives a fresh environment manager and shares its environment database', async () => fixture(async ({ file, open }) => {
  const first = open(); assert.equal(first.readResources(), null);
  const saved = first.saveResources(catalog('service-a'), 0);
  assert.equal(saved.revision, 1);
  const second = open(); assert.deepEqual(second.readResources(), saved);
  const db = new DatabaseSync(file, { readOnly: true });
  try { assert.equal(db.prepare('SELECT domain FROM schema_meta').get().domain, 'environment'); }
  finally { db.close(); }
}));

test('stale writers cannot overwrite resource updates and rollback appends a revision', async () => fixture(async ({ open }) => {
  const a = open(), b = open();
  a.saveResources(catalog('service-a'), 0);
  assert.equal(b.readResources().revision, 1);
  a.saveResources(catalog('service-b'), 1);
  assert.throws(() => b.saveResources(catalog('lost-update'), 1), /RESOURCE_REVISION_CONFLICT/);
  assert.equal(b.readResources().catalog.providers[0].id, 'service-b');
  const restored = b.restoreResources(1, 2);
  assert.equal(restored.revision, 3);
  assert.equal(restored.catalog.providers[0].id, 'service-a');
  assert.equal(a.readResources(2).catalog.providers[0].id, 'service-b');
  assert.throws(() => a.restoreResources(1, 2), /RESOURCE_REVISION_CONFLICT/);
  assert.throws(() => a.restoreResources(99, 3), /RESOURCE_REVISION_NOT_FOUND/);
  assert.equal(a.readResources().revision, 3);
}));

test('invalid resource input neither initializes storage nor changes a saved catalog', async () => fixture(async ({ file, open }) => {
  const manager = open();
  const secret = catalog('service-a'); secret[['pass', 'word'].join('')] = ['synthetic', 'value'].join('-');
  assert.throws(() => manager.saveResources(secret, 0), /INVALID_RESOURCE_CATALOG/);
  const db = new DatabaseSync(file, { readOnly: true });
  try { assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='resource_catalogs'").get().n, 0); }
  finally { db.close(); }
  manager.saveResources(catalog('service-a'), 0);
  assert.throws(() => manager.saveResources({ ...catalog('service-b'), schemaVersion: 999 }, 1), /INVALID_RESOURCE_CATALOG/);
  assert.equal(manager.readResources().revision, 1);
  assert.throws(() => manager.saveResources(catalog('service-b'), -1), /INVALID_RESOURCE_REVISION/);
}));

test('unknown resource schema and corrupted snapshots fail closed without overwriting evidence', async () => fixture(async ({ file, open }) => {
  const manager = open(); manager.saveResources(catalog('service-a'), 0);
  const db = new DatabaseSync(file);
  try {
    db.exec('UPDATE resource_schema SET version=99');
    assert.throws(() => manager.readResources(), /UNSUPPORTED_RESOURCE_SCHEMA/);
    assert.throws(() => manager.saveResources(catalog('service-b'), 1), /UNSUPPORTED_RESOURCE_SCHEMA/);
    assert.equal(db.prepare('SELECT count(*) AS n FROM resource_catalogs').get().n, 1);
    db.exec('UPDATE resource_schema SET version=1');
    db.prepare('UPDATE resource_catalogs SET body=?').run(JSON.stringify(catalog('tampered')));
    assert.throws(() => manager.readResources(), /CORRUPT_RESOURCE_STATE/);
    assert.throws(() => manager.saveResources(catalog('service-b'), 1), /CORRUPT_RESOURCE_STATE/);
  } finally { db.close(); }
}));

test('resource operations reject replacement of the pinned environment root', async () => fixture(async ({ root, open }) => {
  const manager = open(); manager.saveResources(catalog('service-a'), 0);
  await rename(root, root + '-old'); await mkdir(root);
  assert.throws(() => manager.readResources(), /identity|changed/i);
  assert.throws(() => manager.saveResources(catalog('service-b'), 1), /identity|changed/i);
}));

test('resource snapshots can be read after a separate process starts', async () => fixture(async ({ file, root, open }) => {
  const manager = open(); manager.saveResources(catalog('service-a'), 0);
  const module = new URL('../dist/runtime/environment.js', import.meta.url).href;
  const script = `import { EnvironmentManager } from ${JSON.stringify(module)};
    const manager = new EnvironmentManager(process.argv[1], process.argv[2]);
    try { console.log(JSON.stringify(manager.readResources())); } finally { manager.close(); }`;
  const snapshot = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script, file, root], { encoding: 'utf8', timeout: 10000 }));
  assert.equal(snapshot.revision, 1);
  assert.equal(snapshot.catalog.providers[0].id, 'service-a');
}));

test('failed SQL writes roll back and leave the connection usable for a safe retry', async () => fixture(async ({ file, open }) => {
  const manager = open(); manager.saveResources(catalog('service-a'), 0);
  const db = new DatabaseSync(file);
  try {
    db.exec("CREATE TRIGGER reject_resource_write BEFORE INSERT ON resource_catalogs BEGIN SELECT RAISE(ABORT, 'injected failure'); END");
    assert.throws(() => manager.saveResources(catalog('service-b'), 1), /injected failure/);
    assert.equal(manager.readResources().revision, 1);
    db.exec('DROP TRIGGER reject_resource_write');
    assert.equal(manager.saveResources(catalog('service-b'), 1).revision, 2);
    assert.equal(manager.readResources(1).catalog.providers[0].id, 'service-a');
  } finally { db.close(); }
}));
