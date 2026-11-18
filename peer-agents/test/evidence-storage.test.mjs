import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { TaskStore } from '../dist/runtime/store.js';
import { database } from '../dist/runtime/database.js';
import { digest } from '../dist/runtime/identity.js';
import { archiveEvidenceBody, restoreEvidenceBody, MAX_ARCHIVE_RECORD_BYTES, MAX_ARCHIVE_BATCH_BYTES } from '../dist/runtime/evidence-storage.js';
import { callBridge } from '../scripts/mcp-call.mjs';
import { runtimeFixture } from './fixtures/runtime-fixture.mjs';
import { stateDirectory } from '../dist/runtime/repository.js';

const version = 'a'.repeat(64);
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'peer-archive-'));
  const file = path.join(root, 'tasks.sqlite'), store = new TaskStore(file);
  t.after(async () => { store.close(); await rm(root, { recursive: true, force: true }); });
  const evidence = (name = 'fixture') => store.evidence({ text: ('Exact Unicode evidence 解析🙂 ' + name + '\n').repeat(300),
    source: name, version, classification: 'PROJECT' });
  const task = () => store.create({ objective: 'Inspect evidence', repository: root, baseline: version, manifestDigest: 'fixture', environmentDigest: 'fixture' });
  const body = id => String(store.db.prepare('SELECT body FROM evidence WHERE id=?').get(id).body);
  return { root, file, store, evidence, task, body };
}

test('archive and restore preserve exact evidence bytes, identity, restart and retry receipts', async t => {
  const f = await fixture(t), id = f.evidence();
  const record = f.store.readEvidence(id);
  const original = JSON.stringify(record, null, 2) + '\n';
  f.store.db.prepare('UPDATE evidence SET body=? WHERE id=?').run(original, id);
  const plan = f.store.planEvidenceStorage('archive', [id]);
  assert.equal(f.body(id), original, 'preview must preserve evidence');
  assert.equal(f.store.db.prepare('SELECT version FROM schema_meta').get().version, 1);
  assert.ok(plan.changes[0].afterBytes < plan.changes[0].beforeBytes);
  const receipt = f.store.applyEvidenceStorage(plan);
  const changed = { ...plan, action: 'restore' };
  const { digest: _digest, ...unsigned } = changed;
  assert.throws(() => f.store.applyEvidenceStorage({ ...changed, digest: digest(unsigned) }), /Conflicting/);
  assert.deepEqual(f.store.applyEvidenceStorage(plan), receipt);
  assert.deepEqual(f.store.readEvidence(id), record);
  assert.equal(f.store.retentionReport().items[0].physicalStorage, 'ARCHIVED');
  assert.equal(f.store.db.prepare('SELECT version FROM schema_meta').get().version, 2);
  assert.throws(() => database(f.file, 'task'), /Unsupported database/);
  const reopened = new TaskStore(f.file);
  try {
    assert.deepEqual(reopened.readEvidence(id), record);
    assert.deepEqual(reopened.applyEvidenceStorage(plan), receipt);
    const restore = reopened.planEvidenceStorage('restore', [id]);
    reopened.applyEvidenceStorage(restore);
    assert.equal(f.body(id), original);
    assert.equal(f.store.retentionReport().items[0].physicalStorage, 'HOT');
    assert.deepEqual(reopened.applyEvidenceStorage(plan), receipt, 'retry returns the historical receipt after a later restore');
    assert.equal(f.body(id), original);
    assert.equal(reopened.planEvidenceStorage('archive', [id]).digest === plan.digest, false);
  } finally { reopened.close(); }
  assert.throws(() => f.store.db.exec('DELETE FROM evidence_storage_operations'), /append-only/);
  assert.equal(f.store.db.prepare('SELECT count(*) AS count FROM evidence_storage_operations').get().count, 2);
});

test('historical evidence stays available to replay, queries and later mandatory links', async t => {
  const f = await fixture(t), old = f.evidence('original'), current = f.evidence('replacement');
  let state = f.task();
  const firstId = randomUUID();
  state = f.store.acceptDecision(state.id, state.revision, { id: firstId, statement: 'first', evidence: [old], sourceFingerprint: version });
  state = f.store.acceptDecision(state.id, state.revision, { id: randomUUID(), statement: 'replacement', evidence: [current], sourceFingerprint: version, supersedes: firstId });
  const events = f.store.events(state.id);
  assert.throws(() => f.store.planEvidenceStorage('archive', [current]), /eligible/);
  f.store.applyEvidenceStorage(f.store.planEvidenceStorage('archive', [old]));
  assert.deepEqual(f.store.replay(state.id), state);
  assert.deepEqual(f.store.events(state.id), events);
  assert.ok(f.store.queryEvidence(state.id, { query: 'original' }).items.some(item => item.id === old));
  assert.equal(f.store.readTaskEvidence(state.id, { evidenceId: old }).version, version);
  state = f.store.append(state.id, state.revision, 'EVIDENCE_LINKED', { evidence: old, mandatory: true });
  assert.ok(f.store.contextEvidence(state.id, version, 'original').evidence.some(item => item.id === old && item.mandatory));
  const report = f.store.retentionReport().items.find(item => item.id === old);
  assert.equal(report.proposedTier, 'HOT'); assert.equal(report.physicalStorage, 'ARCHIVED');
});

test('stale previews, cross-database plans and tampering cannot mutate evidence', async t => {
  const f = await fixture(t), other = await fixture(t), id = f.evidence();
  other.evidence();
  const plan = f.store.planEvidenceStorage('archive', [id]), before = f.body(id);
  assert.throws(() => other.store.applyEvidenceStorage(plan), /scope/);
  assert.throws(() => f.store.applyEvidenceStorage({ ...plan, action: 'restore' }), /integrity/);
  const state = f.task();
  assert.throws(() => f.store.applyEvidenceStorage(plan), /expired/);
  const eligible = f.store.planEvidenceStorage('archive', [id]);
  f.store.append(state.id, state.revision, 'EVIDENCE_LINKED', { evidence: id, mandatory: true });
  assert.throws(() => f.store.applyEvidenceStorage(eligible), /eligible/);
  assert.equal(f.body(id), before);
  assert.equal(f.store.db.prepare('SELECT version FROM schema_meta').get().version, 1);
});

test('mid-batch archive failure rolls back every body, migration and journal', async t => {
  const f = await fixture(t), ids = [f.evidence('one'), f.evidence('two')].sort();
  const before = ids.map(f.body);
  const plan = f.store.planEvidenceStorage('archive', ids);
  f.store.db.exec(`CREATE TRIGGER injected_storage_failure BEFORE UPDATE ON evidence WHEN OLD.id='${ids[1]}' BEGIN SELECT RAISE(ABORT,'injected storage failure'); END`);
  assert.throws(() => f.store.applyEvidenceStorage(plan), /injected/);
  assert.deepEqual(ids.map(f.body), before);
  assert.equal(f.store.db.prepare('SELECT version FROM schema_meta').get().version, 1);
  assert.equal(f.store.db.prepare("SELECT name FROM sqlite_master WHERE name='evidence_storage_operations'").get(), undefined);
  f.store.db.exec('DROP TRIGGER injected_storage_failure');
  f.store.applyEvidenceStorage(plan);
  const archived = ids.map(f.body), restore = f.store.planEvidenceStorage('restore', ids);
  f.store.db.exec(`CREATE TRIGGER injected_restore_failure BEFORE UPDATE ON evidence WHEN OLD.id='${ids[1]}' BEGIN SELECT RAISE(ABORT,'injected restore failure'); END`);
  assert.throws(() => f.store.applyEvidenceStorage(restore), /injected/);
  assert.deepEqual(ids.map(f.body), archived);
  assert.equal(f.store.db.prepare('SELECT count(*) AS count FROM evidence_storage_operations').get().count, 1);
  f.store.db.exec('DROP TRIGGER injected_restore_failure');
  f.store.applyEvidenceStorage(restore);
  assert.deepEqual(ids.map(f.body), before);
});

test('ignored writes cannot produce a successful archive receipt', async t => {
  const f = await fixture(t), id = f.evidence(), plan = f.store.planEvidenceStorage('archive', [id]);
  f.store.db.exec('CREATE TRIGGER ignored_write BEFORE UPDATE ON evidence BEGIN SELECT RAISE(IGNORE); END');
  assert.throws(() => f.store.applyEvidenceStorage(plan), /write verification/);
  assert.equal(f.store.db.prepare('SELECT version FROM schema_meta').get().version, 1);
});

test('process termination during archival recovers the original bytes and permits a safe retry', async t => {
  const f = await fixture(t), id = f.evidence(), original = f.body(id);
  const plan = f.store.planEvidenceStorage('archive', [id]);
  const script = `
    const { TaskStore } = await import(process.argv[1]);
    const store = new TaskStore(process.argv[2]);
    store.db.function('terminate_archive', () => { process.exit(73); });
    store.db.exec('CREATE TRIGGER terminate_storage AFTER UPDATE ON evidence BEGIN SELECT terminate_archive(); END');
    store.applyEvidenceStorage(JSON.parse(process.argv[3]));
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script,
    new URL('../dist/runtime/store.js', import.meta.url).href, f.file, JSON.stringify(plan)],
  { encoding: 'utf8', timeout: 15000 });
  assert.equal(child.status, 73, child.stderr);
  assert.equal(f.body(id), original);
  assert.equal(f.store.db.prepare('SELECT version FROM schema_meta').get().version, 1);
  assert.equal(f.store.db.prepare("SELECT name FROM sqlite_master WHERE name='evidence_storage_operations'").get(), undefined);
  f.store.db.exec('DROP TRIGGER terminate_storage');
  const reopened = new TaskStore(f.file);
  try {
    reopened.applyEvidenceStorage(plan);
    assert.deepEqual(reopened.readEvidence(id), JSON.parse(original));
  } finally { reopened.close(); }
});

test('archive corruption and oversized decompression fail closed', async t => {
  const f = await fixture(t), id = f.evidence(), state = f.task();
  f.store.append(state.id, state.revision, 'EVIDENCE_LINKED', { evidence: id });
  f.store.applyEvidenceStorage(f.store.planEvidenceStorage('archive', [id]));
  const archive = JSON.parse(f.body(id));
  for (const value of [{ ...archive, originalBytes: 1 }, { ...archive, originalBytes: MAX_ARCHIVE_RECORD_BYTES + 1 },
    { ...archive, data: archive.data.slice(4) }, { ...archive, bodyHash: 'b'.repeat(64) }, { ...archive, data: archive.data + 'junk' }]) {
    assert.throws(() => restoreEvidenceBody(JSON.stringify(value)));
    f.store.db.prepare('UPDATE evidence SET body=? WHERE id=?').run(JSON.stringify(value), id);
    assert.throws(() => f.store.get(state.id), /Corrupt evidence/);
    assert.throws(() => f.store.planEvidenceStorage('restore', [id]), /Corrupt evidence/);
  }
});

test('record and batch limits prevent oversized archive operations', async t => {
  const f = await fixture(t);
  assert.throws(() => archiveEvidenceBody('{}'), /would not reduce/);
  const big = f.store.evidence({ text: 'x'.repeat(MAX_ARCHIVE_RECORD_BYTES), source: 'large', version, classification: 'PROJECT' });
  assert.throws(() => f.store.planEvidenceStorage('archive', [big]), /record limit/);
  const ids = ['a', 'b', 'c'].map(name => f.store.evidence({ text: name.repeat(Math.floor(MAX_ARCHIVE_BATCH_BYTES / 3)), source: name, version, classification: 'PROJECT' }));
  assert.throws(() => f.store.planEvidenceStorage('archive', ids), /batch limit/);
  assert.equal(f.store.db.prepare('SELECT version FROM schema_meta').get().version, 1);
});

test('secret-bearing unknown metadata cannot be hidden by archive encoding', async t => {
  const f = await fixture(t), id = f.evidence(), record = f.store.readEvidence(id);
  const changed = { ...record, [['api', 'key'].join('_')]: 'fixture-value' };
  f.store.db.prepare('UPDATE evidence SET body=? WHERE id=?').run(JSON.stringify(changed), id);
  assert.throws(() => f.store.readEvidence(id), /Corrupt evidence/);
  assert.throws(() => f.store.planEvidenceStorage('archive', [id]), /Corrupt evidence/);
  assert.equal(f.store.db.prepare('SELECT version FROM schema_meta').get().version, 1);
});

test('journal integrity is checked before retries and further operations', async t => {
  const f = await fixture(t), id = f.evidence(), plan = f.store.planEvidenceStorage('archive', [id]);
  const receipt = f.store.applyEvidenceStorage(plan);
  f.store.db.exec('DROP TRIGGER immutable_evidence_storage_update');
  f.store.db.prepare('UPDATE evidence_storage_operations SET body=? WHERE operation_id=?').run(JSON.stringify({ ...receipt, completedAt: '2000-01-01T00:00:00.000Z' }), receipt.operationId);
  assert.throws(() => f.store.applyEvidenceStorage(plan), /journal/);
  assert.throws(() => f.store.planEvidenceStorage('restore', [id]), /journal/);
});

test('CLI preview, archive, retrieval and restore work against the normal repository state', async () => {
  const f = await runtimeFixture();
  let store;
  try {
    const dir = await stateDirectory(f.root);
    await mkdir(dir, { recursive: true });
    store = new TaskStore(path.join(dir, 'tasks.sqlite'));
    const state = store.create({ objective: 'Archive CLI fixture', repository: f.root, baseline: version, manifestDigest: 'fixture', environmentDigest: 'fixture' });
    const id = store.evidence({ text: 'CLI preserved evidence\n'.repeat(300), source: 'fixture', version, classification: 'PROJECT' });
    store.append(state.id, state.revision, 'EVIDENCE_LINKED', { evidence: id });
    const entry = fileURLToPath(new URL('../bin/peer-capabilities.mjs', import.meta.url));
    const run = args => JSON.parse(execFileSync(process.execPath, [entry, ...args, '--repo', f.root], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
    const selection = path.join(dir, 'selection.json'), planFile = path.join(dir, 'plan.json');
    await writeFile(selection, JSON.stringify({ ids: [id] }));
    const plan = run(['retention', 'archive', '--input', selection]);
    await writeFile(planFile, JSON.stringify(plan));
    assert.equal(run(['retention']).items[0].physicalStorage, 'HOT');
    run(['retention', 'archive', '--input', planFile, '--apply']);
    assert.equal(run(['retention']).items[0].physicalStorage, 'ARCHIVED');
    const config = path.join(dir, 'runtime.json');
    await writeFile(config, JSON.stringify({ agents: [], policy: f.policy }));
    const options = { entry, args: ['mcp', '--repo', f.root, '--config', config, '--state-dir', path.join(dir, 'environment')] };
    const listing = await callBridge('tools/list', {}, options);
    assert.equal(listing.tools.length, 8);
    assert.ok(!listing.tools.some(tool => /archive|restore/.test(tool.name)));
    const response = await callBridge('v1_task_evidence_read', { id: state.id, evidenceId: id }, options);
    assert.equal(JSON.parse(response.content[0].text).text, 'CLI preserved evidence\n'.repeat(300));
    const request = path.join(dir, 'read.json');
    await writeFile(request, JSON.stringify({ evidenceId: id }));
    assert.equal(run(['evidence', 'read', '--id', state.id, '--input', request]).text, 'CLI preserved evidence\n'.repeat(300));
    await writeFile(planFile, JSON.stringify(run(['retention', 'restore', '--input', selection])));
    run(['retention', 'restore', '--input', planFile, '--apply']);
    assert.equal(run(['retention']).items[0].physicalStorage, 'HOT');
    assert.throws(() => run(['retention', '--apply']));
    assert.throws(() => run(['retention', 'archive', '--input', planFile, '--apply']));
    assert.equal(store.get(state.id).revision, 2);
  } finally { store?.close(); await f.close(); }
});
