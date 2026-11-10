import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TaskStore } from '../dist/runtime/store.js';
import { contextPackage } from '../dist/runtime/context.js';
import { fingerprint, stateDirectory } from '../dist/runtime/repository.js';
import { runtimeFixture } from './fixtures/runtime-fixture.mjs';

const baseline = 'a'.repeat(64);

async function database(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'peer-evidence-'));
  const file = path.join(root, 'tasks.sqlite');
  const store = new TaskStore(file);
  t.after(async () => { store.close(); await rm(root, { recursive: true, force: true }); });
  const state = store.create({ objective: 'repair parser Unicode handling', repository: root, baseline,
    manifestDigest: 'fixture', environmentDigest: 'fixture' });
  const evidence = (text, version = baseline, source = 'fixture-source') =>
    store.evidence({ text, version, source, classification: 'PROJECT' });
  const link = (id, mandatory = false) => store.append(state.id, store.get(state.id).revision, 'EVIDENCE_LINKED', { evidence: id, mandatory });
  return { store, state, evidence, link, file };
}

test('evidence queries rank task-linked records deterministically and paginate by revision', async t => {
  const f = await database(t);
  const first = f.evidence('parser Unicode failure'); f.link(first);
  const second = f.evidence('parser tokenization'); f.link(second);
  const unrelated = f.evidence('deployment advice'); f.link(unrelated);
  const hidden = f.evidence('parser Unicode outside task');
  const page = f.store.queryEvidence(f.state.id, { query: 'parser Unicode', limit: 1 });
  assert.equal(page.total, 2);
  assert.equal(page.items[0].id, first);
  assert.equal(page.items[0].text, undefined);
  assert.throws(() => f.store.queryEvidence(f.state.id, { query: 'deployment', limit: 1, cursor: page.nextCursor }), /cursor expired/);
  assert.throws(() => f.store.queryEvidence(f.state.id, { limit: 0 }));
  assert.equal(f.store.queryEvidence(f.state.id, { query: 'parser Unicode', limit: 1, cursor: page.nextCursor }).items[0].id, second);
  assert.deepEqual(f.store.queryEvidence(f.state.id, { query: 'missingterm' }).items, []);
  assert.throws(() => f.store.readTaskEvidence(f.state.id, { evidenceId: hidden }), /outside task scope/);
  const other = f.store.create({ objective: 'other task', repository: f.state.repository, baseline: 'source-1',
    manifestDigest: 'fixture', environmentDigest: 'fixture' });
  assert.throws(() => f.store.readTaskEvidence(other.id, { evidenceId: first }), /outside task scope/);
  f.link(f.evidence('new parser evidence'));
  assert.throws(() => f.store.queryEvidence(f.state.id, { query: 'parser Unicode', limit: 1, cursor: page.nextCursor }), /cursor expired/);
});

test('exact retrieval preserves Unicode, enforces budgets, and survives reopen', async t => {
  const f = await database(t);
  const text = '解析🙂\n'.repeat(1000);
  const id = f.evidence(text); f.link(id);
  assert.throws(() => f.store.readTaskEvidence(f.state.id, { evidenceId: id, maxBytes: 1024 }), /INSUFFICIENT_CONTEXT/);
  assert.equal(f.store.readTaskEvidence(f.state.id, { evidenceId: id }).text, text);
  const reopened = new TaskStore(f.file);
  try { assert.equal(reopened.readTaskEvidence(f.state.id, { evidenceId: id }).text, text); }
  finally { reopened.close(); }
});

test('context selection protects required evidence and omits irrelevant and old optional bodies', async t => {
  const f = await database(t);
  const required = f.evidence('unrelated mandatory constraint', 'old-source'); f.link(required, true);
  const testEvidence = f.evidence('test passed', 'old-source');
  f.store.append(f.state.id, f.store.get(f.state.id).revision, 'TEST_RECORDED', { phase: 'lead', command: ['fixture'], passed: true, evidence: testEvidence });
  const relevant = f.evidence('parser Unicode fact'); f.link(relevant);
  const irrelevant = f.evidence('deployment information'); f.link(irrelevant);
  const stale = f.evidence('parser Unicode outdated fact', 'old-source'); f.link(stale);
  const selection = f.store.contextEvidence(f.state.id, baseline, f.state.objective);
  assert.deepEqual(new Set(selection.evidence.map(e => e.id)), new Set([required, testEvidence, relevant]));
  assert.ok(selection.evidence.filter(e => [required, testEvidence].includes(e.id)).every(e => e.mandatory));
  assert.deepEqual(new Set(selection.omissions), new Set([irrelevant, stale]));
  assert.equal(f.store.readTaskEvidence(f.state.id, { evidenceId: stale }).text, 'parser Unicode outdated fact');
});

test('query metadata obeys byte limits and missing evidence cannot be linked', async t => {
  const f = await database(t);
  const id = f.evidence('parser', baseline, 's'.repeat(1800)); f.link(id);
  const revision = f.store.get(f.state.id).revision;
  assert.throws(() => f.store.queryEvidence(f.state.id, { maxBytes: 1024 }), /INSUFFICIENT_CONTEXT/);
  assert.throws(() => f.store.append(f.state.id, revision, 'EVIDENCE_LINKED', { evidence: 'b'.repeat(64) }), /Missing evidence/);
  assert.equal(f.store.get(f.state.id).revision, revision);
  const page = f.store.queryEvidence(f.state.id, { maxBytes: 4096 });
  assert.equal(page.items.length, 1);
  assert.ok(Buffer.byteLength(JSON.stringify(page), 'utf8') <= 4096);
});

test('retention plan preserves superseded decision history, shared evidence and external patch locators', async t => {
  const f = await database(t);
  const previous = f.evidence('original decision evidence');
  const firstId = randomUUID();
  f.store.acceptDecision(f.state.id, 1, { id: firstId, statement: 'initial choice', evidence: [previous], sourceFingerprint: baseline });
  const current = f.evidence('replacement decision evidence');
  f.store.acceptDecision(f.state.id, 2, { id: randomUUID(), statement: 'updated choice', evidence: [current], sourceFingerprint: baseline, supersedes: firstId });
  const cold = f.evidence('unlinked body');
  f.store.append(f.state.id, 3, 'CONTEXT_PACKAGED', { hash: 'package', kind: 'FULL', evidence: ['external-patch-hash', previous] });
  const before = f.store.events(f.state.id);
  const report = f.store.retentionReport();
  const tiers = Object.fromEntries(report.items.map(item => [item.id, item.proposedTier]));
  assert.equal(tiers[previous], 'WARM'); assert.equal(tiers[current], 'HOT'); assert.equal(tiers[cold], 'COLD');
  assert.equal(report.deletionAllowed, false);
  assert.deepEqual(report.externalReferences, ['external-patch-hash']);
  assert.deepEqual(f.store.events(f.state.id), before);
  assert.ok(f.store.replay(f.state.id).decisions.some(d => d.status === 'SUPERSEDED'));
  assert.ok(f.store.contextEvidence(f.state.id, baseline, 'decision evidence').omissions.includes(previous));
  assert.equal(f.store.readTaskEvidence(f.state.id, { evidenceId: previous }).text, 'original decision evidence');
  const other = f.store.create({ objective: 'other decision', repository: f.state.repository, baseline,
    manifestDigest: 'fixture', environmentDigest: 'fixture' });
  f.store.acceptDecision(other.id, 1, { id: randomUUID(), statement: 'shared proof remains required', evidence: [previous], sourceFingerprint: baseline });
  assert.equal(f.store.retentionReport().items.find(item => item.id === previous).proposedTier, 'HOT');
});

test('missing or corrupt linked evidence fails closed for retrieval and retention', async t => {
  const f = await database(t);
  const id = f.evidence('parser evidence'); f.link(id);
  const record = f.store.readEvidence(id);
  f.store.db.prepare('UPDATE evidence SET body=? WHERE id=?').run(JSON.stringify({ ...record, text: 'tampered' }), id);
  assert.throws(() => f.store.queryEvidence(f.state.id), /Corrupt evidence/);
  assert.throws(() => f.store.retentionReport(), /Corrupt evidence/);
  assert.throws(() => f.store.get(f.state.id), /Corrupt evidence/);
  f.store.db.prepare('DELETE FROM evidence WHERE id=?').run(id);
  assert.throws(() => f.store.retentionReport(), /Missing evidence/);
});

test('context budgets reserve omission metadata without starving mandatory evidence', () => {
  const allocation = { window: 10000, occupied: 0, host: 0, output: 0, tools: 0, margin: 0, ceiling: 1400, remaining: 10000 };
  const input = { task: { id: 'task', revision: 1 }, role: 'lead', question: 'parser', constraints: [], events: [],
    policyVersion: '1', fingerprint: 'source', graphVersion: null, allocation,
    evidence: [{ id: 'required', text: 'required evidence', mandatory: true },
      { id: 'oversized', text: 'x'.repeat(2000), mandatory: false }, { id: 'small', text: 'useful', mandatory: false }],
    excludedEvidence: ['historical'] };
  const result = contextPackage(input);
  assert.deepEqual(result.evidence.map(e => e.id), ['required', 'small']);
  assert.deepEqual(result.omissions, ['historical', 'oversized']);
  assert.ok(Buffer.byteLength(JSON.stringify(result), 'utf8') <= allocation.ceiling);
  assert.throws(() => contextPackage({ ...input, evidence: [{ id: 'required', text: 'x'.repeat(2000), mandatory: true }] }), /INSUFFICIENT_CONTEXT/);
});

test('normal runtime dispatch hydrates task-scoped evidence and CLI inspects existing state', async () => {
  const f = await runtimeFixture();
  try {
    const state = await f.runtime.create(f.root, 'repair parser');
    const version = await fingerprint(f.root);
    const relevant = f.store.evidence({ text: 'parser uses Unicode', source: 'fixture', version, classification: 'PROJECT' });
    const optional = f.store.evidence({ text: 'deployment advice', source: 'fixture', version, classification: 'PROJECT' });
    f.store.append(state.id, 1, 'EVIDENCE_LINKED', { evidence: relevant });
    f.store.append(state.id, 2, 'EVIDENCE_LINKED', { evidence: optional });
    let captured;
    const execute = f.adapters[0].execute;
    f.adapters[0].execute = async input => { captured = JSON.parse(input.prompt); return execute(input); };
    await f.runtime.dispatch(state.id, true);
    assert.ok(captured.evidence.some(e => e.id === relevant));
    assert.ok(captured.omissions.includes(optional));
    // CLI uses the standard per-repository state location.
    const { mkdir, copyFile } = await import('node:fs/promises');
    const dir = await stateDirectory(f.root);
    await mkdir(dir, { recursive: true });
    f.store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    await copyFile(f.database, path.join(dir, 'tasks.sqlite'));
    const entry = fileURLToPath(new URL('../bin/peer-capabilities.mjs', import.meta.url));
    const run = args => JSON.parse(execFileSync(process.execPath, [entry, ...args, '--repo', f.root], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
    assert.equal(run(['evidence', 'query', '--id', state.id]).total, 5);
    const request = path.join(f.root, '.git', 'read-request.json');
    await writeFile(request, JSON.stringify({ evidenceId: relevant }));
    assert.equal(run(['evidence', 'read', '--id', state.id, '--input', request]).text, 'parser uses Unicode');
    assert.equal(run(['retention']).mode, 'PLAN_ONLY');
  } finally { await f.close(); }
});
