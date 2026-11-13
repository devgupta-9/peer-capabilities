import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile, readFile, stat, rename, unlink, chmod, symlink, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { runtimeFixture } from './fixtures/runtime-fixture.mjs';
import { repositorySnapshot, captureFileDependencies, fingerprint } from '../dist/runtime/repository.js';
import { digest, contentHash } from '../dist/runtime/identity.js';
import { TaskStore } from '../dist/runtime/store.js';
import { Runtime } from '../dist/runtime/runner.js';
import { contextPackage } from '../dist/runtime/context.js';

const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: 'pipe' });

async function accept(f, state, sourceFiles) {
  const sourceFingerprint = await fingerprint(state.worktree ?? f.root);
  const evidence = f.store.evidence({ text: 'Exact source observation', source: 'fixture', version: sourceFingerprint, classification: 'PROJECT' });
  return f.runtime.acceptDecision(state.id, state.revision, {
    id: randomUUID(), statement: 'The declared source contract applies', evidence: [evidence],
    ...(sourceFiles ? { sourceFiles } : {}),
  });
}

test('source snapshots preserve legacy repository fingerprints and capture canonical regular file scopes', async () => {
  const f = await runtimeFixture();
  try {
    const snapshot = await repositorySnapshot(f.root);
    const head = git(f.root, 'rev-parse', 'HEAD').trim();
    const index = git(f.root, 'ls-files', '--stage', '-z');
    const info = await stat(path.join(f.root, 'answer.txt'));
    const entries = [['answer.txt', contentHash(await readFile(path.join(f.root, 'answer.txt'))), info.mode]];
    assert.equal(snapshot.fingerprint, digest({ head, index, entries }));
    assert.equal(snapshot.fingerprint, await fingerprint(f.root));
    assert.equal(captureFileDependencies(snapshot, ['./answer.txt']).files[0].path, 'answer.txt');
    for (const paths of [[], ['../answer.txt'], [path.join(f.root, 'answer.txt')], ['.git/config'], ['missing.txt'], ['answer.txt', './answer.txt']]) {
      assert.throws(() => captureFileDependencies(snapshot, paths));
    }
  } finally { await f.close(); }
});

test('unrelated edits revalidate scoped decisions, stale legacy decisions, and preserve accepted evidence across restart', async () => {
  const f = await runtimeFixture();
  try {
    let state = await f.runtime.create(f.root, 'Check a scoped contract');
    state = await accept(f, state, ['answer.txt']);
    state = await accept(f, state);
    const original = state.decisions[0];
    await writeFile(path.join(f.root, 'unrelated.txt'), 'new content\n');
    const snapshot = await repositorySnapshot(f.root);
    const revision = state.revision;
    state = f.store.checkDecisionSources(state.id, revision, snapshot);
    assert.equal(state.revision, revision + 1);
    assert.equal(f.store.events(state.id).at(-1).type, 'DECISION_SOURCES_CHECKED');
    assert.equal(state.decisions[0].status, 'ACTIVE');
    assert.equal(state.decisions[0].sourceFingerprint, original.sourceFingerprint);
    assert.equal(state.decisions[0].validatedFingerprint, snapshot.fingerprint);
    assert.equal(state.decisions[1].status, 'STALE');
    assert.equal(f.store.checkDecisionSources(state.id, state.revision, snapshot).revision, state.revision);
    const context = contextPackage({ task: { id: state.id, revision: state.revision }, role: 'reviewer', question: state.objective,
      constraints: [], evidence: f.store.contextEvidence(state.id, snapshot.fingerprint, state.objective).evidence, events: [],
      decisions: state.decisions, policyVersion: 'fixture', fingerprint: snapshot.fingerprint, graphVersion: null,
      allocation: { window: 50000, occupied: 0, host: 0, output: 0, tools: 0, margin: 0, ceiling: 50000, remaining: 50000 } });
    assert.equal(context.decisions.current[0].validatedFingerprint, snapshot.fingerprint);
    assert.equal(context.evidence[0].version, original.sourceFingerprint);
    const reopened = new TaskStore(f.database);
    try { assert.deepEqual(reopened.replay(state.id), state); } finally { reopened.close(); }
    await writeFile(path.join(f.root, 'answer.txt'), 'changed contract\n');
    state = f.store.checkDecisionSources(state.id, state.revision, await repositorySnapshot(f.root));
    assert.equal(state.decisions[0].status, 'STALE');
    await writeFile(path.join(f.root, 'answer.txt'), 'wrong\n');
    await unlink(path.join(f.root, 'unrelated.txt'));
    const rolledBack = f.store.checkDecisionSources(state.id, state.revision, await repositorySnapshot(f.root));
    assert.equal(rolledBack.decisions[0].status, 'STALE');
    assert.equal(rolledBack.revision, state.revision);
  } finally { await f.close(); }
});

test('scoped dependency checks detect deletion, renaming, staging and file mode changes', async t => {
  const changes = {
    deletion: f => unlink(path.join(f.root, 'answer.txt')),
    rename: f => rename(path.join(f.root, 'answer.txt'), path.join(f.root, 'renamed.txt')),
    staging: async f => {
      await writeFile(path.join(f.root, 'answer.txt'), 'staged change\n');
      git(f.root, 'add', 'answer.txt');
      await writeFile(path.join(f.root, 'answer.txt'), 'wrong\n');
    },
  };
  if (process.platform !== 'win32') changes.mode = f => chmod(path.join(f.root, 'answer.txt'), 0o755);
  for (const [name, change] of Object.entries(changes)) {
    await t.test(name, async () => {
      const f = await runtimeFixture();
      try {
        let state = await accept(f, await f.runtime.create(f.root, 'Observe scoped source'), ['answer.txt']);
        await change(f);
        state = f.store.checkDecisionSources(state.id, state.revision, await repositorySnapshot(f.root));
        assert.equal(state.decisions[0].status, 'STALE');
      } finally { await f.close(); }
    });
  }
});

test('scope capture and validation reject symlink dependencies', async t => {
  const f = await runtimeFixture();
  try {
    let state = await accept(f, await f.runtime.create(f.root, 'Observe scoped source'), ['answer.txt']);
    await writeFile(path.join(f.root, 'target.txt'), 'wrong\n');
    await unlink(path.join(f.root, 'answer.txt'));
    try { await symlink('target.txt', path.join(f.root, 'answer.txt')); }
    catch (error) {
      if (process.platform === 'win32' && error.code === 'EPERM') {
        t.skip('Windows host does not grant file symlink creation'); return;
      }
      throw error;
    }
    const snapshot = await repositorySnapshot(f.root);
    assert.throws(() => captureFileDependencies(snapshot, ['answer.txt']), /regular file/);
    state = f.store.checkDecisionSources(state.id, state.revision, snapshot);
    assert.equal(state.decisions[0].status, 'STALE');
  } finally { await f.close(); }
});

test('source snapshots reject a dependency parent redirected outside the repository', async () => {
  const f = await runtimeFixture(), outside = await runtimeFixture();
  try {
    const source = path.join(f.root, 'source');
    await mkdir(source);
    await writeFile(path.join(source, 'contract.txt'), 'contract\n');
    git(f.root, 'add', '.'); git(f.root, 'commit', '-m', 'Add scoped source');
    const state = await accept(f, await f.runtime.create(f.root, 'Check physical source scope'), ['source/contract.txt']);
    await writeFile(path.join(outside.root, 'contract.txt'), 'outside\n');
    await rename(source, path.join(f.root, 'original-source'));
    await symlink(outside.root, source, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(repositorySnapshot(f.root), /escaped repository/);
    assert.equal(f.store.get(state.id).revision, state.revision);
  } finally { await f.close(); await outside.close(); }
});

test('source observation events reject incomplete, duplicate, unknown and narrowed scopes atomically', async () => {
  const f = await runtimeFixture();
  try {
    let state = await accept(f, await f.runtime.create(f.root, 'Check event integrity'), ['answer.txt']);
    state = await accept(f, state);
    const scoped = state.decisions[0], global = state.decisions[1];
    const changed = 'b'.repeat(64);
    const valid = { id: scoped.id, files: scoped.sourceScope.files };
    const invalidChecks = [
      [valid],
      [valid, valid],
      [{ id: randomUUID(), files: scoped.sourceScope.files }, { id: global.id }],
      [{ id: scoped.id }, { id: global.id }],
      [{ id: scoped.id, files: [{ ...scoped.sourceScope.files[0], path: 'other.txt' }] }, { id: global.id }],
      [valid, { id: global.id, files: scoped.sourceScope.files }],
    ];
    for (const checks of invalidChecks) {
      assert.throws(() => f.store.append(state.id, state.revision, 'DECISION_SOURCES_CHECKED', { fingerprint: changed, checks }));
      assert.equal(f.store.get(state.id).revision, state.revision);
    }
    await assert.rejects(f.runtime.acceptDecision(state.id, state.revision - 1, { id: randomUUID(), statement: 'stale author', evidence: scoped.evidence }), /revision/);
    await assert.rejects(f.runtime.acceptDecision(state.id, state.revision, { id: randomUUID(), statement: 'forged scope', evidence: scoped.evidence,
      sourceScope: scoped.sourceScope }));
  } finally { await f.close(); }
});

test('explicit conservative invalidation still works after a scoped decision was revalidated', async () => {
  const f = await runtimeFixture();
  try {
    let state = await accept(f, await f.runtime.create(f.root, 'Check conservative fallback'), ['answer.txt']);
    const original = state.baseline;
    await writeFile(path.join(f.root, 'extra.txt'), 'extra');
    state = f.store.checkDecisionSources(state.id, state.revision, await repositorySnapshot(f.root));
    assert.equal(state.decisions[0].status, 'ACTIVE');
    state = f.store.invalidateDecisions(state.id, state.revision, original);
    assert.equal(state.decisions[0].status, 'STALE');
  } finally { await f.close(); }
});

test('normal dispatch and reviewer hydration preserve a scoped contract through unrelated edits and restart', async () => {
  const f = await runtimeFixture();
  try {
    await writeFile(path.join(f.root, 'contract.txt'), 'stable contract\n');
    git(f.root, 'add', 'contract.txt'); git(f.root, 'commit', '-m', 'Add contract fixture');
    const packets = [];
    const reviewer = { ...f.adapters[0], id: 'reviewer', discover: async () => {
      const result = await f.adapters[0].discover();
      return { ...result, choices: result.choices.map(choice => ({ ...choice, agent: 'reviewer', roles: ['reviewer'] })) };
    }, execute: async input => { packets.push(JSON.parse(input.prompt)); return { availability: 'AVAILABLE', response: 'Reviewed', review: { outcome: 'APPROVE', findings: [] } }; } };
    const runtime = new Runtime(f.store, [...f.adapters, reviewer], f.policy);
    let state = await runtime.create(f.root, 'Correct answer and preserve stable contract');
    state = await accept(f, state, ['contract.txt']);
    const checkpoint = await runtime.dispatch(state.id, true);
    assert.equal(checkpoint.decisions[0].status, 'ACTIVE');
    assert.equal(packets[0].decisions.current[0].validatedFingerprint, packets[0].fingerprint);
    assert.notEqual(packets[0].decisions.current[0].sourceFingerprint, packets[0].fingerprint);
    assert.equal(packets[0].evidence.find(item => item.id === state.decisions[0].evidence[0]).mandatory, true);
    const reopened = new TaskStore(f.database);
    try {
      assert.deepEqual(reopened.replay(state.id).decisions, checkpoint.decisions);
      const resumed = await new Runtime(reopened, [...f.adapters, reviewer], f.policy).resume(state.id);
      assert.equal(resumed.status, 'READY');
      assert.equal(resumed.decisions[0].status, 'ACTIVE');
    } finally { reopened.close(); }
  } finally { await f.close(); }
});

test('single-agent dispatch still marks edits to declared files stale', async () => {
  const f = await runtimeFixture();
  try {
    let state = await accept(f, await f.runtime.create(f.root, 'Fix the declared file'), ['answer.txt']);
    state = await f.runtime.dispatch(state.id, true);
    assert.equal(state.decisions[0].status, 'STALE');
    assert.equal(state.degraded, true);
  } finally { await f.close(); }
});
