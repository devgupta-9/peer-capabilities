import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Runtime } from '../dist/runtime/runner.js';
import { TaskStore } from '../dist/runtime/store.js';
import { runtimeFixture } from './fixtures/runtime-fixture.mjs';
import { fixtureAuthority } from './fixtures/approval.mjs';

async function verifier(authority) {
  const api = await import('../dist/runtime/approval.js').catch(() => ({}));
  assert.equal(typeof api.ApprovalVerifier, 'function', 'host approval verification must exist');
  return new api.ApprovalVerifier('fixture-host', authority.publicKey);
}

test('without a pinned host authority an agent-supplied approval callback cannot integrate', async () => {
  const f = await runtimeFixture();
  try {
    const task = await f.runtime.start(f.root, 'Fixture');
    await assert.rejects(f.runtime.integrate(task.id, async operationDigest => ({ operationDigest, actor: 'human' })), /authority|approval/i);
    assert.equal(await readFile(path.join(f.root, 'answer.txt'), 'utf8'), 'wrong\n');
    assert.equal(f.store.get(task.id).status, 'READY');
  } finally { await f.close(); }
});

test('approval signatures reject tampering, unknown issuers, wrong operations and invalid time bounds', async () => {
  const authority = fixtureAuthority(), other = fixtureAuthority(), verify = await verifier(authority);
  const operation = 'a'.repeat(64), grant = authority.grant(operation);
  assert.equal(verify.verify(grant, operation).actor, 'test-harness');
  for (const bad of [
    { ...grant, actor: 'different-human' }, { ...grant, issuer: 'untrusted' },
    { ...grant, signature: '' }, other.grant(operation),
    authority.grant(operation, { issuedAt: Date.now() - 120000, expiresAt: Date.now() - 1000 }),
    authority.grant(operation, { issuedAt: Date.now() + 60000, expiresAt: Date.now() + 120000 }),
    authority.grant(operation, { expiresAt: Date.now() + 3600000 }),
  ]) assert.throws(() => verify.verify(bad, operation));
  assert.throws(() => verify.verify(grant, 'b'.repeat(64)), /operation/i);
});

test('operation consent is invalidated by task revision or policy changes', async () => {
  const authority = fixtureAuthority(), verify = await verifier(authority), f = await runtimeFixture(undefined, verify);
  try {
    const task = await f.runtime.start(f.root, 'Fixture');
    const first = f.runtime.operationDigest(task.id), grant = authority.grant(first);
    const request = f.runtime.operationRequest(task.id);
    assert.equal(request.repository, task.repository);
    assert.equal(request.taskId, task.id);
    assert.equal(request.revision, task.revision);
    f.store.append(task.id, task.revision, 'NOTE_RECORDED', { note: 'New material fact' });
    assert.notEqual(f.runtime.operationDigest(task.id), first);
    await assert.rejects(f.runtime.integrate(task.id, grant), /operation/i);
    const changedPolicy = new Runtime(f.store, f.adapters, { ...f.policy, policyVersion: 'changed' }, verify);
    assert.notEqual(changedPolicy.operationDigest(task.id), f.runtime.operationDigest(task.id));
    assert.equal(await readFile(path.join(f.root, 'answer.txt'), 'utf8'), 'wrong\n');
  } finally { await f.close(); }
});

test('signed integration consumes consent durably and cannot be replayed', async () => {
  const authority = fixtureAuthority(), f = await runtimeFixture(undefined, await verifier(authority));
  try {
    const task = await f.runtime.start(f.root, 'Fixture');
    const grant = authority.grant(f.runtime.operationDigest(task.id));
    const result = await f.runtime.integrate(task.id, grant);
    assert.equal(result.status, 'COMPLETE');
    assert.equal(result.integration.approvalId, grant.approvalId);
    assert.equal(await readFile(path.join(f.root, 'answer.txt'), 'utf8'), '42\n');
    await assert.rejects(f.runtime.integrate(task.id, grant));
    assert.equal(f.store.events(task.id).filter(e => e.type === 'INTEGRATION_STARTED').length, 1);
    assert.deepEqual(f.store.replay(task.id), f.store.get(task.id));
    const another = f.store.create({ objective: 'Second task', repository: f.root, baseline: 'fixture', manifestDigest: 'fixture', environmentDigest: 'fixture' });
    const ready = f.store.append(another.id, another.revision, 'PATCH_EXPORTED', task.patch);
    assert.throws(() => f.store.append(ready.id, ready.revision, 'INTEGRATION_STARTED', grant), /UNIQUE|consumed/i);
    assert.equal(f.store.get(ready.id).status, 'READY', 'failed consumption must roll back the projection');
    assert.equal(f.store.events(ready.id).length, 2);
  } finally { await f.close(); }
});

test('an interrupted integration remains fenced after database restart and does not reapply', async () => {
  const authority = fixtureAuthority(), verify = await verifier(authority), f = await runtimeFixture(undefined, verify);
  let reopened, closed = false;
  try {
    const task = await f.runtime.start(f.root, 'Fixture');
    const grant = authority.grant(f.runtime.operationDigest(task.id));
    await writeFile(path.join(f.root, 'answer.txt'), 'user edit\n');
    await assert.rejects(f.runtime.integrate(task.id, grant), /baseline/i);
    assert.equal(f.store.get(task.id).status, 'INTEGRATING');
    f.store.close();
    closed = true;
    reopened = new TaskStore(f.database);
    const resumed = new Runtime(reopened, f.adapters, f.policy, verify);
    await assert.rejects(resumed.integrate(task.id, grant), /ready|reconcil/i);
    await assert.rejects(resumed.resume(task.id), /reconcil/i);
    assert.equal(await readFile(path.join(f.root, 'answer.txt'), 'utf8'), 'user edit\n');
    assert.equal(reopened.events(task.id).filter(e => e.type === 'INTEGRATION_STARTED').length, 1);
  } finally { reopened?.close(); await f.close(closed); }
});
