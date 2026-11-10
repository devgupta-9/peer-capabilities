import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { TaskStore } from '../dist/runtime/store.js';
import { Runtime } from '../dist/runtime/runner.js';
import { contextPackage } from '../dist/runtime/context.js';
import { runtimeFixture } from './fixtures/runtime-fixture.mjs';

const baseline = 'a'.repeat(64), changed = 'b'.repeat(64);
const create = store => store.create({ objective: 'Fixture decision', repository: '/fixture', baseline,
  manifestDigest: 'fixture', environmentDigest: 'fixture' });
const evidence = (store, version = baseline, text = 'Observed fixture contract') => store.evidence({
  text, version, classification: 'PROJECT', source: 'fixture-contract' });
const decision = (evidenceId, overrides = {}) => ({ id: randomUUID(), statement: 'Keep the fixture contract',
  evidence: [evidenceId], sourceFingerprint: baseline, ...overrides });
const contextInput = (state, decisions, evidenceItems, fingerprint = baseline) => ({
  task: { id: state.id, revision: state.revision }, role: 'reviewer', question: 'Review the fixture', constraints: ['Never publish'],
  decisions, evidence: evidenceItems, events: [], policyVersion: 'fixture', fingerprint, graphVersion: null,
  allocation: { window: 20000, occupied: 0, host: 100, output: 1000, tools: 100, margin: 100, ceiling: 18000, remaining: 18000 },
});

test('decision acceptance and supersession replay transactionally across restart', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'peer-decisions-')); let store;
  try {
    const file = path.join(root, 'tasks.sqlite'); store = new TaskStore(file);
    let state = create(store); const proof = evidence(store), first = decision(proof);
    state = store.acceptDecision(state.id, state.revision, first);
    assert.equal(state.decisions[0].status, 'ACTIVE');
    assert.throws(() => store.acceptDecision(state.id, 1, decision(proof)), /revision/);
    const replacement = decision(proof, { statement: 'Use the revised contract', supersedes: first.id });
    state = store.acceptDecision(state.id, state.revision, replacement);
    assert.equal(state.decisions[0].status, 'SUPERSEDED'); assert.equal(state.decisions[0].supersededBy, replacement.id);
    assert.equal(state.decisions[1].status, 'ACTIVE');
    const cursor = state.revision;
    assert.throws(() => store.acceptDecision(state.id, cursor, decision(proof, { supersedes: first.id })), /decision/i);
    assert.throws(() => store.acceptDecision(state.id, cursor, replacement), /decision/i);
    assert.equal(store.events(state.id).length, cursor, 'Rejected transitions append nothing');
    store.close(); store = new TaskStore(file);
    assert.deepEqual(store.get(state.id), state); assert.deepEqual(store.replay(state.id), state);
    store.rebuild(state.id); assert.deepEqual(store.get(state.id), state);
  } finally { store?.close(); await rm(root, { recursive: true, force: true }); }
});

test('decision evidence must exist and match its source snapshot before generic append can accept it', () => {
  const store = new TaskStore(':memory:');
  try {
    const state = create(store), proof = evidence(store);
    for (const invalid of [decision('f'.repeat(64)), decision(proof, { sourceFingerprint: changed }),
      decision(proof, { evidence: [] }), decision(proof, { evidence: [proof, proof] }),
      decision(proof, { supersedes: randomUUID() })]) {
      assert.throws(() => store.append(state.id, state.revision, 'DECISION_ACCEPTED', invalid));
      assert.equal(store.get(state.id).revision, 1);
    }
    assert.throws(() => store.acceptDecision(state.id, 1, decision(proof, { operation: 'DEPLOY' })));
    assert.equal(store.get(state.id).integration, undefined);
  } finally { store.close(); }
});

test('source change explicitly stales decisions and rollback cannot reactivate them', () => {
  const store = new TaskStore(':memory:');
  try {
    let state = create(store); const proof = evidence(store), original = decision(proof);
    state = store.acceptDecision(state.id, state.revision, original);
    assert.equal(store.invalidateDecisions(state.id, state.revision, baseline).revision, state.revision);
    state = store.invalidateDecisions(state.id, state.revision, changed);
    assert.equal(state.decisions[0].status, 'STALE'); assert.equal(state.decisions[0].staleAtFingerprint, changed);
    assert.equal(store.events(state.id).at(-1).type, 'DECISIONS_INVALIDATED');
    assert.equal(store.invalidateDecisions(state.id, state.revision, baseline).decisions[0].status, 'STALE');
    const newProof = evidence(store, changed), replacement = decision(newProof, { sourceFingerprint: changed, supersedes: original.id });
    state = store.acceptDecision(state.id, state.revision, replacement);
    assert.equal(state.decisions[0].status, 'SUPERSEDED'); assert.equal(state.decisions[1].status, 'ACTIVE');
    assert.throws(() => store.append(state.id, state.revision, 'DECISIONS_INVALIDATED', { ids: [replacement.id], fingerprint: changed }));
    assert.throws(() => store.invalidateDecisions(state.id, 1, changed), /revision/);
  } finally { store.close(); }
});

test('metadata or content tampering cannot disguise evidence as a different source', async () => {
  for (const field of ['source', 'version', 'classification', 'id', 'text']) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'peer-evidence-')); let store;
    try {
      const file = path.join(root, 'tasks.sqlite'); store = new TaskStore(file);
      let state = create(store); const proof = evidence(store);
      state = store.acceptDecision(state.id, state.revision, decision(proof));
      const db = new DatabaseSync(file);
      try {
        const value = JSON.parse(db.prepare('SELECT body FROM evidence WHERE id=?').get(proof).body);
        value[field] = field === 'classification' ? 'PUBLIC' : field === 'version' ? changed : 'tampered';
        db.prepare('UPDATE evidence SET body=? WHERE id=?').run(JSON.stringify(value), proof);
      } finally { db.close(); }
      assert.throws(() => store.readEvidence(proof), /Corrupt evidence/);
      assert.throws(() => store.get(state.id), /Corrupt evidence/);
      assert.throws(() => store.append(state.id, state.revision, 'NOTE_RECORDED', { note: 'No mutation on corrupt evidence' }), /Corrupt evidence/);
    } finally { store?.close(); await rm(root, { recursive: true, force: true }); }
  }
});

test('context protects linked evidence and labels current, stale and superseded decisions', () => {
  const store = new TaskStore(':memory:');
  try {
    let state = create(store); const proof = evidence(store), first = decision(proof);
    state = store.acceptDecision(state.id, state.revision, first);
    state = store.acceptDecision(state.id, state.revision, decision(proof, { supersedes: first.id, statement: 'Revised decision' }));
    const items = [{ ...store.readEvidence(proof), mandatory: true }];
    const input = contextInput(state, state.decisions, items), packet = contextPackage(input);
    assert.equal(packet.decisions.current.length, 1); assert.equal(packet.decisions.history[0].status, 'SUPERSEDED');
    assert.equal(JSON.stringify(packet.decisions).includes(first.statement), false);
    assert.throws(() => contextPackage({ ...input, evidence: [] }), /DECISION_EVIDENCE_REQUIRED/);
    assert.throws(() => contextPackage({ ...input, evidence: [{ ...items[0], mandatory: false }] }), /DECISION_EVIDENCE_REQUIRED/);
    assert.throws(() => contextPackage({ ...input, evidence: [{ ...items[0], text: 'Different claim' }] }), /DECISION_EVIDENCE_REQUIRED/);
    assert.throws(() => contextPackage({ ...input, evidence: [{ ...items[0], source: 'different-source' }] }), /DECISION_EVIDENCE_REQUIRED/);
    assert.throws(() => contextPackage({ ...input, evidence: [items[0], items[0]] }), /DECISION_EVIDENCE_REQUIRED/);
    assert.throws(() => contextPackage({ ...input, fingerprint: changed }), /STALE_DECISION_CONTEXT/);
    assert.throws(() => contextPackage({ ...input, allocation: { ...input.allocation, ceiling: 100 } }), /INSUFFICIENT_CONTEXT/);
    state = store.invalidateDecisions(state.id, state.revision, changed);
    const stale = contextPackage(contextInput(state, state.decisions, items, changed));
    assert.equal(stale.decisions.current[0].status, 'STALE'); assert.equal(stale.evidence.length, 1);
  } finally { store.close(); }
});

test('runtime hydrates the lead and marks decisions stale for a late reviewer after edits', async () => {
  const f = await runtimeFixture(); const packets = [];
  try {
    const lead = f.adapters[0], execute = lead.execute;
    lead.execute = async input => { packets.push(JSON.parse(input.prompt)); return execute(input); };
    const reviewer = { id: 'reviewer', loginInstructions: () => 'Fixture',
      discover: async () => {
        const result = await lead.discover();
        return { ...result, choices: result.choices.map(c => ({ ...c, agent: 'reviewer', roles: ['reviewer'] })) };
      }, execute: async input => { packets.push(JSON.parse(input.prompt)); return { availability: 'AVAILABLE', response: 'Fixture review', review: { outcome: 'APPROVE', findings: [] } }; } };
    const runtime = new Runtime(f.store, [lead, reviewer], f.policy);
    let state = await runtime.create(f.root, 'Correct the fixture answer');
    const proof = evidence(f.store, state.baseline, 'answer.txt is the fixture source');
    state = f.store.acceptDecision(state.id, state.revision, decision(proof, { sourceFingerprint: state.baseline }));
    const final = await runtime.dispatch(state.id, true);
    assert.equal(final.status, 'CHECKPOINTED'); assert.equal(packets.length, 2);
    assert.equal(packets[0].decisions.current[0].status, 'ACTIVE');
    assert.equal(packets[1].decisions.current[0].status, 'STALE');
    assert.notEqual(packets[0].fingerprint, packets[1].fingerprint);
    for (const packet of packets) {
      assert.equal(packet.evidence.some(e => e.id === proof && e.mandatory), true);
      assert.equal(packet.evidence.find(e => e.id === proof).source, 'fixture-contract');
      assert.equal(packet.evidence.find(e => e.id === proof).version, state.baseline);
      assert.equal(packet.events.some(e => e.type === 'DECISION_ACCEPTED' && e.payload?.statement), false,
        'Historical statements cannot duplicate current context');
    }
    assert.equal(final.decisions[0].status, 'STALE');
    assert.equal(await readFile(path.join(final.worktree, 'answer.txt'), 'utf8'), '42\n');
    assert.equal(f.store.replay(state.id).decisions[0].status, 'STALE');
    const resumed = await runtime.resume(state.id); assert.equal(resumed.status, 'READY');
  } finally { await f.close(); }
});

test('single-agent checkpoints preserve explicit stale decisions after source edits', async () => {
  const f = await runtimeFixture();
  try {
    let state = await f.runtime.create(f.root, 'Correct fixture without a reviewer');
    const proof = evidence(f.store, state.baseline);
    state = f.store.acceptDecision(state.id, state.revision, decision(proof, { sourceFingerprint: state.baseline }));
    const checkpoint = await f.runtime.dispatch(state.id, true);
    assert.equal(checkpoint.status, 'CHECKPOINTED'); assert.equal(checkpoint.degraded, true);
    assert.equal(checkpoint.decisions[0].status, 'STALE');
    const fresh = new TaskStore(f.database);
    try { assert.deepEqual(fresh.replay(state.id).decisions, checkpoint.decisions); }
    finally { fresh.close(); }
    assert.equal(f.runtime.report(state.id).independentReview, false);
    assert.deepEqual(f.runtime.report(state.id).engineeringDecisions, checkpoint.decisions);
  } finally { await f.close(); }
});

test('decision inputs containing secrets or forged status cannot enter canonical state', () => {
  const store = new TaskStore(':memory:');
  process.env.PEER_DECISION_SECRET = ['decision', 'fixture', randomUUID()].join('-');
  try {
    const state = create(store), proof = evidence(store);
    assert.throws(() => store.acceptDecision(state.id, 1, decision(proof, { statement: process.env.PEER_DECISION_SECRET })), /SECRET/);
    assert.throws(() => store.acceptDecision(state.id, 1, decision(proof, { status: 'ACTIVE' })));
    assert.equal(store.events(state.id).length, 1);
  } finally { delete process.env.PEER_DECISION_SECRET; store.close(); }
});

test('legacy task projection remains byte-compatible until its first decision event', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'peer-legacy-decision-')); let store;
  try {
    const file = path.join(root, 'tasks.sqlite'); store = new TaskStore(file);
    const state = create(store); assert.equal(Object.hasOwn(state, 'decisions'), false); store.close();
    store = new TaskStore(file); assert.deepEqual(store.get(state.id), state);
    const updated = store.acceptDecision(state.id, 1, decision(evidence(store)));
    assert.equal(updated.decisions.length, 1); assert.equal(store.events(state.id)[0].schemaVersion, 1);
  } finally { store?.close(); await rm(root, { recursive: true, force: true }); }
});

test('snapshot invalidation changes every affected decision in one event and validates no-op inputs', () => {
  const store = new TaskStore(':memory:');
  try {
    let state = create(store); const proof = evidence(store);
    assert.throws(() => store.invalidateDecisions(state.id, 1, 'invalid-fingerprint'));
    state = store.acceptDecision(state.id, state.revision, decision(proof));
    state = store.acceptDecision(state.id, state.revision, decision(proof));
    const revision = state.revision;
    state = store.invalidateDecisions(state.id, revision, changed);
    assert.equal(state.revision, revision + 1); assert.equal(state.decisions.every(d => d.status === 'STALE'), true);
    assert.equal(store.events(state.id).at(-1).payload.ids.length, 2);
  } finally { store.close(); }
});

test('insufficient mandatory decision context blocks durably before provider execution', async () => {
  const f = await runtimeFixture(); let calls = 0;
  try {
    f.adapters[0].execute = async () => { calls++; throw new Error('Must not invoke'); };
    let state = await f.runtime.create(f.root, 'Bounded context fixture');
    const proof = evidence(f.store, state.baseline, 'large observed fixture '.repeat(3000));
    state = f.store.acceptDecision(state.id, state.revision, decision(proof, { sourceFingerprint: state.baseline }));
    await assert.rejects(f.runtime.dispatch(state.id, true), /INSUFFICIENT_CONTEXT/);
    const blocked = f.store.get(state.id);
    assert.equal(blocked.status, 'BLOCKED'); assert.equal(calls, 0);
    assert.match(blocked.notes[0], /Context hydration failed/);
    assert.equal(f.store.readEvidence(proof).text.length, 'large observed fixture '.length * 3000);
    assert.equal(await readFile(path.join(blocked.worktree, 'answer.txt'), 'utf8'), 'wrong\n');
  } finally { await f.close(); }
});
