import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

const load = () => import('../dist/runtime/index.js');
test('runtime provides a durable task store instead of process-local state', async () => {
  const api = await load().catch(() => ({}));
  assert.equal(typeof api.TaskStore, 'function');
});
test('events and projections transact, reject stale revisions and replay after restart', async () => {
  const { TaskStore } = await load();
  const dir = await mkdtemp(path.join(tmpdir(), 'peer-store-'));
  try {
    let store = new TaskStore(path.join(dir, 'tasks.sqlite'));
    const task = store.create({ objective: 'test', repository: '/fixture', baseline: 'abc', manifestDigest: 'm', environmentDigest: 'e' });
    const updated = store.append(task.id, 1, 'NOTE_RECORDED', { note: 'material fact' });
    assert.equal(updated.revision, 2);
    assert.throws(() => store.append(task.id, 1, 'NOTE_RECORDED', { note: 'stale' }), /revision/);
    assert.throws(() => store.append(task.id, 2, 'BOGUS', {}), /event/i);
    assert.equal(store.events(task.id).length, 2);
    store.close();
    store = new TaskStore(path.join(dir, 'tasks.sqlite'));
    assert.deepEqual(store.replay(task.id), store.get(task.id));
    assert.equal(store.get(task.id).revision, 2);
    store.close();
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('durable leases exclude competing owners and secrets never enter task evidence', async () => {
  const { TaskStore } = await load();
  const store = new TaskStore(':memory:');
  try {
    store.acquire('repo:fixture', 'first');
    assert.throws(() => store.acquire('repo:fixture', 'second'), /leased/);
    store.release('repo:fixture', 'second');
    assert.throws(() => store.acquire('repo:fixture', 'second'), /leased/);
    store.release('repo:fixture', 'first');
    store.acquire('repo:fixture', 'second');
    assert.throws(() => store.evidence({ text: 'sensitive', classification: 'SECRET', source: 'fixture', version: '1' }), /SECRET/);
    process.env.TEST_CANARY_SECRET = 'sensitive-canary-123456789';
    assert.throws(() => store.evidence({ text: process.env.TEST_CANARY_SECRET, classification: 'PROJECT', source: 'fixture', version: '1' }), /SECRET/);
  } finally { delete process.env.TEST_CANARY_SECRET; store.close(); }
});
test('scheduler is N-agent, deterministic, rejects weak free models and respects exact effort', async () => {
  const { selectAgent } = await load();
  const candidate = (id, competence, cost) => ({
    agent: id, model: id + '-model', effort: 'high', efforts: ['high'], roles: ['lead', 'reviewer'],
    competence, cost, latency: 1, contextWindow: 50000, availability: 'AVAILABLE',
    authentication: 'NOT_REQUIRED', provider: id, quotaPool: id,
  });
  const choices = [candidate('third', 9, 2), candidate('weak-free', 2, 0), candidate('strong', 10, 8)];
  const request = { role: 'lead', competence: 8, complexity: 'high', requiredContext: 1000 };
  assert.equal(selectAgent(choices, request).agent, 'strong');
  assert.equal(selectAgent(choices.toReversed(), { ...request, role: 'reviewer' }).agent, 'third');
  assert.throws(() => selectAgent(choices, { ...request, exact: { agent: 'strong', model: 'strong-model', effort: 'low' } }), /eligible/);
  assert.throws(() => selectAgent(choices, { ...request, excluded: ['strong', 'third'] }), /eligible/);
});
test('adaptive context never silently drops mandatory evidence and invalid sessions hydrate fully', async () => {
  const { contextPackage } = await load();
  const input = {
    task: { id: 't', revision: 2 }, question: 'review', role: 'reviewer', constraints: ['never publish'],
    evidence: [{ id: 'e1', text: 'important', mandatory: true }], events: [{ sequence: 2 }],
    policyVersion: '1', fingerprint: 'repo', graphVersion: null,
    allocation: { window: 10000, occupied: 100, host: 200, output: 1000, tools: 500, margin: 200, ceiling: 9000, remaining: 9000 },
  };
  const full = contextPackage(input);
  assert.equal(full.kind, 'FULL');
  assert.equal(full.allocation.usable, 8000);
  const checkpoint = { session: 'session', packageHash: full.hash, cursor: 1, policyVersion: '1', fingerprint: 'repo', graphVersion: null, contextVersion: 1 };
  assert.equal(contextPackage({ ...input, checkpoint, session: { id: 'session', valid: true, acknowledgedHash: full.hash } }).kind, 'DELTA');
  assert.equal(contextPackage({ ...input, checkpoint, session: { id: 'session', valid: false, acknowledgedHash: full.hash } }).kind, 'FULL');
  assert.throws(() => contextPackage({ ...input, evidence: [{ id: 'large', text: 'x'.repeat(50000), mandatory: true }] }), /INSUFFICIENT_CONTEXT/);
});
test('manifest separates desired state from secrets and rejects executable recipes', async () => {
  const { validateManifest } = await load();
  const manifest = { schemaVersion: 1, components: [{ id: 'graphify', kind: 'integration', optional: true, recipe: 'observe', version: '1.0.0', config: {} }] };
  assert.equal(validateManifest(manifest).components[0].id, 'graphify');
  assert.throws(() => validateManifest({ ...manifest, components: [{ ...manifest.components[0], recipe: 'shell', command: 'echo arbitrary' }] }), /recipe|Unrecognized/);
  assert.throws(() => validateManifest({ ...manifest, components: [{ ...manifest.components[0], config: { apiKey: ['any', 'thing'].join('') } }] }), /credential/i);
  assert.throws(() => validateManifest({ schemaVersion: 2, components: [] }));
});
