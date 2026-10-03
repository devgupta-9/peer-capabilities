import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { runtimeFixture } from './fixtures/runtime-fixture.mjs';

test('a missing verification executable records a failed test and blocks the task', async () => {
  const f = await runtimeFixture();
  try {
    f.policy.testCommand = [path.join(f.root, 'nonexistent-verifier.exe')];
    const task = await f.runtime.create(f.root, 'Fixture');
    await assert.rejects(f.runtime.dispatch(task.id), /verification/i);
    const state = f.store.get(task.id);
    assert.equal(state.status, 'BLOCKED');
    assert.equal(state.tests.at(-1).passed, false);
  } finally { await f.close(); }
});

test('failed observed verification durably blocks the task rather than leaving it running', async () => {
  const f = await runtimeFixture('process.exit(1)');
  try {
    const task = await f.runtime.create(f.root, 'Fixture');
    await assert.rejects(f.runtime.dispatch(task.id), /verification/i);
    const state = f.store.get(task.id);
    assert.equal(state.status, 'BLOCKED');
    assert.equal(state.tests.at(-1).passed, false);
    assert.match(state.notes.at(-1), /verification/i);
    assert.equal(await readFile(path.join(state.worktree, 'answer.txt'), 'utf8'), '42\n');
    assert.equal(await readFile(path.join(f.root, 'answer.txt'), 'utf8'), 'wrong\n');
  } finally { await f.close(); }
});

test('successful test commands that create exportable debris cannot produce a ready patch', async () => {
  const f = await runtimeFixture("require('node:fs').writeFileSync('test-debris.txt','generated')");
  try {
    const task = await f.runtime.create(f.root, 'Fixture');
    await assert.rejects(f.runtime.dispatch(task.id), /verification/i);
    const state = f.store.get(task.id);
    assert.equal(state.status, 'BLOCKED');
    assert.equal(state.patch, undefined);
    assert.equal(state.tests.at(-1).passed, false);
    assert.match(state.notes.at(-1), /changed/i);
    assert.equal(await readFile(path.join(state.worktree, 'test-debris.txt'), 'utf8'), 'generated');
  } finally { await f.close(); }
});
