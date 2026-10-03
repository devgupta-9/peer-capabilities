import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, rename, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
const load = () => import('../dist/runtime/environment.js');
const manifest = content => ({ schemaVersion: 1, components: [{
  id: 'policy', kind: 'managed-file', optional: false, recipe: 'managed-file', version: '1',
  destination: 'policy/AGENTS.md', content,
  integrity: 'sha256:' + createHash('sha256').update(content).digest('hex'),
}] });

test('manifest reconciliation installs only owned changes and supports rollback', async () => {
  const api = await load().catch(() => ({}));
  assert.equal(typeof api.EnvironmentManager, 'function');
  const dir = await mkdtemp(path.join(tmpdir(), 'peer-env-'));
  const root = path.join(dir, 'managed'); await mkdir(root);
  const manager = new api.EnvironmentManager(path.join(dir, 'env.sqlite'), root);
  try {
    const plan = await manager.plan(manifest('policy v1'), 'setup');
    await manager.apply(plan.id);
    assert.equal(await readFile(path.join(root, 'policy/AGENTS.md'), 'utf8'), 'policy v1');
    assert.equal((await manager.doctor(manifest('policy v1')))[0].verification, 'VERIFIED');
    assert.equal((await manager.plan(manifest('policy v1'), 'sync')).operations.length, 0);
    const update = await manager.plan(manifest('policy v2'), 'update');
    await manager.apply(update.id);
    await manager.rollback(update.id);
    assert.equal(await readFile(path.join(root, 'policy/AGENTS.md'), 'utf8'), 'policy v1');
    await writeFile(path.join(root, 'policy/AGENTS.md'), 'user edits');
    assert.equal((await manager.doctor(manifest('policy v1')))[0].verification, 'UNAVAILABLE');
    await assert.rejects(manager.plan(manifest('policy v1'), 'repair'), /conflict/i);
    await assert.rejects(manager.uninstall(), /conflict/i);
    assert.equal(await readFile(path.join(root, 'policy/AGENTS.md'), 'utf8'), 'user edits');
  } finally { manager.close(); await rm(dir, { recursive: true, force: true }); }
});
test('preexisting matching files are not adopted and stale operation plans fail closed', async () => {
  const { EnvironmentManager } = await load();
  const dir = await mkdtemp(path.join(tmpdir(), 'peer-env-'));
  await mkdir(path.join(dir, 'policy'));
  await writeFile(path.join(dir, 'policy/AGENTS.md'), 'policy v1');
  const manager = new EnvironmentManager(path.join(dir, 'env.sqlite'), dir);
  try {
    const plan = await manager.plan(manifest('policy v1'), 'setup');
    assert.equal(plan.operations.length, 0);
    await manager.uninstall();
    assert.equal(await readFile(path.join(dir, 'policy/AGENTS.md'), 'utf8'), 'policy v1');
    await assert.rejects(manager.plan(manifest('replacement'), 'update'), /unmanaged/i);
  } finally { manager.close(); await rm(dir, { recursive: true, force: true }); }
});

test('environment database cannot uninstall ownership into a different root', async () => {
  const { EnvironmentManager } = await load();
  const dir = await mkdtemp(path.join(tmpdir(), 'peer-scope-'));
  const one = path.join(dir, 'one'), two = path.join(dir, 'two');
  await mkdir(one); await mkdir(two);
  const db = path.join(dir, 'environment.sqlite');
  const manager = new EnvironmentManager(db, one);
  try {
    const plan = await manager.plan(manifest('owned'), 'setup');
    await manager.apply(plan.id);
  } finally { manager.close(); }
  let other;
  try {
    assert.throws(() => { other = new EnvironmentManager(db, two); }, /scope/i);
  } finally { other?.close(); await rm(dir, { recursive: true, force: true }); }
});

test('unapplied stale plan does not adopt a newly created unmanaged matching file', async () => {
  const { EnvironmentManager } = await load();
  const dir = await mkdtemp(path.join(tmpdir(), 'peer-stale-'));
  const manager = new EnvironmentManager(path.join(dir, 'env.sqlite'), dir);
  try {
    const plan = await manager.plan(manifest('desired'), 'setup');
    await mkdir(path.join(dir, 'policy'));
    await writeFile(path.join(dir, 'policy/AGENTS.md'), 'desired');
    await assert.rejects(manager.apply(plan.id), /conflict/i);
    await assert.rejects(manager.apply(plan.id), /conflict/i);
    await manager.uninstall();
    assert.equal(await readFile(path.join(dir, 'policy/AGENTS.md'), 'utf8'), 'desired');
  } finally { manager.close(); await rm(dir, { recursive: true, force: true }); }
});

test('interrupted journal resumes after temporary output was written before rename', async () => {
  const { EnvironmentManager } = await load();
  const dir = await mkdtemp(path.join(tmpdir(), 'peer-interrupted-'));
  const dbFile = path.join(dir, 'environment.sqlite');
  let manager = new EnvironmentManager(dbFile, dir);
  try {
    const plan = await manager.plan(manifest('recovered policy'), 'setup');
    manager.close();
    const db = new DatabaseSync(dbFile);
    db.prepare('UPDATE operations SET body=? WHERE id=?').run(JSON.stringify({ ...plan, status: 'APPLYING', started: ['policy'] }), plan.id);
    db.close();
    await mkdir(path.join(dir, 'policy'));
    await writeFile(path.join(dir, 'policy/AGENTS.md.' + plan.id + '.tmp'), 'recovered policy');
    manager = new EnvironmentManager(dbFile, dir);
    await manager.apply(plan.id);
    assert.equal(await readFile(path.join(dir, 'policy/AGENTS.md'), 'utf8'), 'recovered policy');
    assert.equal((await manager.doctor(manifest('recovered policy')))[0].owned, true);
  } finally { manager.close(); await rm(dir, { recursive: true, force: true }); }
});

test('recovery cannot adopt a future operation that had no durable intent', async () => {
  const { EnvironmentManager } = await load();
  const dir = await mkdtemp(path.join(tmpdir(), 'peer-future-op-'));
  const dbFile = path.join(dir, 'environment.sqlite');
  let manager = new EnvironmentManager(dbFile, dir);
  try {
    const desired = manifest('same bytes');
    desired.components.push({ ...desired.components[0], id: 'future', destination: 'future.md' });
    const plan = await manager.plan(desired, 'setup');
    manager.close();
    const db = new DatabaseSync(dbFile);
    db.prepare('UPDATE operations SET body=? WHERE id=?').run(JSON.stringify({ ...plan, status: 'APPLYING', started: ['policy'] }), plan.id);
    db.close();
    await mkdir(path.join(dir, 'policy'));
    await writeFile(path.join(dir, 'policy/AGENTS.md'), 'same bytes');
    await writeFile(path.join(dir, 'future.md'), 'same bytes');
    manager = new EnvironmentManager(dbFile, dir);
    await assert.rejects(manager.apply(plan.id), /conflict/i);
    assert.equal((await manager.doctor(desired)).find(o => o.component === 'future').owned, false);
    await manager.uninstall();
    assert.equal(await readFile(path.join(dir, 'future.md'), 'utf8'), 'same bytes');
  } finally { manager.close(); await rm(dir, { recursive: true, force: true }); }
});

test('managed root replacement by a junction cannot redirect effects outside scope', async () => {
  const { EnvironmentManager } = await load();
  const dir = await mkdtemp(path.join(tmpdir(), 'peer-root-swap-'));
  const root = path.join(dir, 'managed'), external = path.join(dir, 'external');
  await mkdir(root); await mkdir(external);
  const manager = new EnvironmentManager(path.join(dir, 'env.sqlite'), root);
  try {
    const plan = await manager.plan(manifest('policy'), 'setup');
    await rename(root, path.join(dir, 'original'));
    await symlink(external, root, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(manager.apply(plan.id), /scope|root/i);
    await assert.rejects(readFile(path.join(external, 'policy/AGENTS.md')));
  } finally { manager.close(); await rm(dir, { recursive: true, force: true }); }
});

test('authentication observations survive restart without storing credentials', async () => {
  const { EnvironmentManager } = await load();
  const dir = await mkdtemp(path.join(tmpdir(), 'peer-auth-'));
  let manager = new EnvironmentManager(path.join(dir, 'env.sqlite'), dir);
  try {
    const observed = { component: 'antigravity', presence: 'INSTALLED', authentication: 'AUTHENTICATED',
      verification: 'VERIFIED', observedAt: new Date().toISOString(), expiresAt: new Date(Date.now()+60000).toISOString(),
      version: '1', scope: 'exact model: fixture' };
    assert.equal(typeof manager.recordObservation, 'function');
    manager.recordObservation(observed);
    manager.close(); manager = new EnvironmentManager(path.join(dir, 'env.sqlite'), dir);
    assert.equal(manager.getObservation('antigravity').authentication, 'AUTHENTICATED');
    assert.throws(() => manager.recordObservation({ ...observed, password: ['opaque', 'fixture', 'value'].join('-') }), /SECRET|Unrecognized/);
  } finally { manager.close(); await rm(dir, { recursive: true, force: true }); }
});

test('rolling back repair of a missing owned file restores the prior ownership ledger', async () => {
  const { EnvironmentManager } = await load();
  const dir = await mkdtemp(path.join(tmpdir(), 'peer-rollback-ledger-'));
  const manager = new EnvironmentManager(path.join(dir, 'env.sqlite'), dir);
  try {
    const desired = manifest('owned policy');
    const setup = await manager.plan(desired, 'setup'); await manager.apply(setup.id);
    await rm(path.join(dir, 'policy/AGENTS.md'));
    const repair = await manager.plan(desired, 'repair'); await manager.apply(repair.id);
    await manager.rollback(repair.id);
    await assert.rejects(readFile(path.join(dir, 'policy/AGENTS.md')));
    assert.equal((await manager.doctor(desired))[0].owned, true);
  } finally { manager.close(); await rm(dir, { recursive: true, force: true }); }
});
