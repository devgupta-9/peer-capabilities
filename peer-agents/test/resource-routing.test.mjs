import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ProviderAdapter } from '../dist/runtime/adapters.js';
import { EnvironmentManager } from '../dist/runtime/environment.js';
import { selectAgent } from '../dist/runtime/scheduler.js';
import { Runtime } from '../dist/runtime/runner.js';
import { runtimeFixture } from './fixtures/runtime-fixture.mjs';

const catalog = () => ({ schemaVersion: 1,
  providers: [{ id: 'service' }], frontends: [{ id: 'antigravity' }],
  accounts: [{ id: 'account', providerId: 'service', policy: 'ACTIVE' }],
  authContexts: [{ id: 'auth', accountId: 'account', frontendId: 'antigravity', handle: 'official-profile' }],
  quotaPools: [{ id: 'shared-pool', accountId: 'account' }],
  models: [{ id: 'model', providerId: 'service', model: 'fixture-model', efforts: ['high', 'low'], contextWindow: 32000 }],
  bindings: [{ id: 'binding', modelId: 'model', authContextId: 'auth', quotaPoolId: 'shared-pool', enabled: true }],
  profiles: [{ id: 'profile', roles: ['lead', 'reviewer'], features: ['read', 'isolated-edit'], competence: 8 }],
  workers: [{ id: 'worker', frontendId: 'antigravity', authContextId: 'auth', profileId: 'profile', enabled: true }],
});
const config = () => ({ id: 'antigravity', executable: process.execPath, experimental: true,
  resources: { workerId: 'worker', bindingIds: ['binding'] },
  profiles: [{ model: 'fixture-model', effort: 'high', competence: 9, cost: 1, contextWindow: 64000 }],
});
const request = { role: 'lead', competence: 8, complexity: 'high', requiredContext: 2048 };
async function fixture(t, directory) {
  const root = directory ?? await mkdtemp(path.join(tmpdir(), 'peer-resource-routing-'));
  const environment = new EnvironmentManager(path.join(root, directory ? '.git/environment.sqlite' : 'environment.sqlite'), root);
  let closed = false;
  const close = () => { if (!closed) { environment.close(); closed = true; } };
  t.after(async () => { close(); if (!directory) await rm(root, { recursive: true, force: true }); });
  environment.saveResources(catalog(), 0);
  let calls = 0;
  const capture = async (_command, args, options) => {
    let stdout;
    if (args[0] === '--version') stdout = 'fixture-cli-1.0';
    else if (args[0] === 'models') stdout = 'fixture-model';
    else {
      calls++;
      if (directory) await writeFile(path.join(options.cwd, 'answer.txt'), '42\n');
      stdout = JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'Fixture response' } });
    }
    return { code: 0, timedOut: false, cancelled: false, stdoutTruncated: false, stderrTruncated: false, durationMs: 1, stderr: '', stdout };
  };
  const adapter = new ProviderAdapter(config(), undefined, capture, environment);
  const discovered = await adapter.discover();
  const scope = role => ({ workerId: 'worker', bindingId: 'binding', role, effort: 'high', ...discovered.resourceContext });
  const record = (role = 'lead', changes = {}) => environment.recordResourceObservation({
    scope: scope(role), resourceRevision: environment.readResources().revision,
    authentication: 'AUTHENTICATED', availability: 'AVAILABLE', verification: 'VERIFIED',
    observedAt: new Date(Date.now() - 10000).toISOString(), expiresAt: new Date(Date.now() + 300000).toISOString(),
    evidence: { method: 'FUNCTIONAL_PROBE', reference: 'a'.repeat(64) }, ...changes,
  });
  const invoke = (choice, role = 'lead') => adapter.execute({ id: 'fixture', taskId: 'fixture', cwd: root, role, choice, prompt: 'Fixture only' });
  return { root, environment, adapter, capture, scope, record, invoke, close, calls: () => calls };
}

test('resource-backed discovery requires exact scoped verification, not installation or legacy authentication', async t => {
  const f = await fixture(t);
  assert.deepEqual((await f.adapter.discover()).choices, []);
  const legacy = { component: 'antigravity', verification: 'VERIFIED', authentication: 'AUTHENTICATED',
    version: 'fixture-cli-1.0', expiresAt: new Date(Date.now() + 300000).toISOString() };
  assert.deepEqual((await new ProviderAdapter(config(), legacy, f.capture, f.environment).discover()).choices, []);
  f.record();
  const choices = (await f.adapter.discover()).choices;
  assert.equal(choices.length, 1);
  const selected = selectAgent(choices, request);
  assert.equal(selected.provider, 'service'); assert.equal(selected.quotaPool, 'shared-pool');
  assert.equal(selected.resource.scope.workerId, 'worker'); assert.equal(selected.resource.scope.bindingId, 'binding');
  assert.equal(selected.competence, 8); assert.equal(selected.contextWindow, 32000);
  assert.equal(JSON.stringify(selected).includes('official-profile'), false);
  assert.throws(() => selectAgent(choices, { ...request, role: 'reviewer' }), /eligible/);
  assert.throws(() => selectAgent(choices, { ...request, exact: { agent: 'antigravity', model: 'fixture-model', effort: 'low' } }), /eligible/);
  assert.throws(() => selectAgent([{ ...selected, efforts: ['high', 'low'] }], {
    ...request, exact: { agent: 'antigravity', model: 'fixture-model', effort: 'low' },
  }), /eligible/, 'Broader catalog effort support is not scoped verification');
  assert.throws(() => selectAgent([{ ...selected, resource: { ...selected.resource, expiresAt: '2020-01-01T00:00:00.000Z' } }], request), /eligible/);
  assert.equal((await f.invoke(selected, 'reviewer')).availability, 'POLICY_BLOCKED');
  assert.equal((await f.invoke({ ...selected, agent: 'codex' })).availability, 'POLICY_BLOCKED');
  const { resource, ...unbound } = selected;
  assert.equal((await f.invoke(unbound)).availability, 'POLICY_BLOCKED');
  assert.equal((await f.invoke({ ...selected, resource: { ...resource, observationDigest: '0'.repeat(64) } })).availability, 'POLICY_BLOCKED');
  assert.equal((await f.invoke(selected)).availability, 'AVAILABLE');
  assert.equal(f.calls(), 1);
});

test('new quota failures and expired evidence block an already-selected resource before invocation', async t => {
  for (const failure of ['QUOTA_EXHAUSTED', 'AUTH_REQUIRED', 'EXPIRED']) {
    const f = await fixture(t); f.record();
    const selected = selectAgent((await f.adapter.discover()).choices, request);
    f.record('lead', failure === 'EXPIRED' ? {
      observedAt: new Date(Date.now() - 2000).toISOString(), expiresAt: new Date(Date.now() - 1000).toISOString(),
    } : { observedAt: new Date(Date.now() - 1000).toISOString(), availability: failure, verification: 'UNAVAILABLE',
      authentication: failure === 'AUTH_REQUIRED' ? 'AUTH_REQUIRED' : 'AUTHENTICATED' });
    assert.deepEqual((await f.adapter.discover()).choices, [], failure);
    assert.equal((await f.invoke(selected)).availability, 'POLICY_BLOCKED', failure);
    assert.equal(f.calls(), 0, failure);
  }
});

test('configuration changes and catalog rollback cannot revive resource verification', async t => {
  const f = await fixture(t); f.record();
  const changedConfig = config(); changedConfig.profiles[0].contextWindow++;
  assert.deepEqual((await new ProviderAdapter(changedConfig, undefined, f.capture, f.environment).discover()).choices, []);
  const changed = catalog(); changed.accounts[0].policy = 'RESERVE';
  f.environment.saveResources(changed, 1);
  assert.deepEqual((await f.adapter.discover()).choices, []);
  f.environment.restoreResources(1, 2);
  assert.deepEqual((await f.adapter.discover()).choices, []);
  f.record('lead', { observedAt: new Date(Date.now() - 1000).toISOString() });
  assert.equal((await f.adapter.discover()).choices.length, 1);
});

test('bound adapters reject missing state, wrong frontend, ambiguous bindings and legacy verification', async t => {
  assert.throws(() => new ProviderAdapter(config()), /resource.*state/i);
  const f = await fixture(t);
  await assert.rejects(f.adapter.verify(f.root), /scoped/i);
  const wrong = catalog(); wrong.frontends[0].id = 'codex'; wrong.workers[0].frontendId = 'codex'; wrong.authContexts[0].frontendId = 'codex';
  f.environment.saveResources(wrong, 1);
  await assert.rejects(f.adapter.discover(), /RESOURCE_FRONTEND_MISMATCH/);
  const ambiguous = catalog(); ambiguous.bindings.push({ ...ambiguous.bindings[0], id: 'other' });
  f.environment.saveResources(ambiguous, 2);
  const both = config(); both.resources.bindingIds.push('other');
  await assert.rejects(new ProviderAdapter(both, undefined, f.capture, f.environment).discover(), /AMBIGUOUS_RESOURCE_BINDING/);
  assert.equal(f.calls(), 0);
});

test('resource identity persists through single-agent runtime checkpoint and resume', async t => {
  const run = await runtimeFixture();
  let f;
  try {
    f = await fixture(t, run.root); f.record();
    const runtime = new Runtime(run.store, [f.adapter], run.policy);
    const state = await runtime.start(run.root, 'Correct fixture answer', true);
    assert.equal(state.status, 'CHECKPOINTED'); assert.equal(state.degraded, true);
    assert.equal(state.assignment.resource.scope.bindingId, 'binding');
    assert.equal(run.store.replay(state.id).assignment.resource.scope.workerId, 'worker');
    const resumed = await new Runtime(run.store, [f.adapter], run.policy).resume(state.id);
    assert.equal(resumed.status, 'READY'); assert.equal(runtime.report(state.id).independentReview, false);
    assert.equal(f.calls(), 1);
  } finally { f?.close(); await run.close(); }
});

test('CLI discovery keeps the environment source connected without invoking a model', async t => {
  const run = await runtimeFixture(); let f;
  try {
    f = await fixture(t, run.root);
    const configFile = path.join(run.root, '.git', 'resource-config.json');
    await writeFile(configFile, JSON.stringify({ agents: [config()], policy: run.policy }));
    const output = execFileSync(process.execPath, [fileURLToPath(new URL('../bin/peer-capabilities.mjs', import.meta.url)),
      'discover', '--repo', run.root, '--config', configFile, '--state-dir', path.join(run.root, '.git')], { encoding: 'utf8' });
    const result = JSON.parse(output);
    assert.equal(result.agents.length, 1); assert.deepEqual(result.agents[0].choices, []);
    assert.match(result.agents[0].resourceContext.configurationDigest, /^[a-f0-9]{64}$/);
    assert.equal(f.calls(), 0);
  } finally { f?.close(); await run.close(); }
});

test('runtime refreshes reviewer availability after the lead finishes', async () => {
  const run = await runtimeFixture();
  try {
    const lead = run.adapters[0], execute = lead.execute; let finished = false, reviewerCalls = 0;
    lead.execute = async input => { const result = await execute(input); finished = true; return result; };
    const reviewer = { id: 'reviewer', loginInstructions: () => 'Fixture',
      discover: async () => {
        const discovered = await lead.discover();
        return { observation: discovered.observation, choices: finished ? [] : discovered.choices.map(c => ({ ...c, agent: 'reviewer', roles: ['reviewer'] })) };
      },
      execute: async () => { reviewerCalls++; return { availability: 'AVAILABLE', response: 'Fixture', review: { outcome: 'APPROVE', findings: [] } }; },
    };
    const runtime = new Runtime(run.store, [lead, reviewer], run.policy);
    const state = await runtime.start(run.root, 'Correct fixture answer', true);
    assert.equal(state.status, 'CHECKPOINTED'); assert.equal(state.degraded, true);
    assert.equal(reviewerCalls, 0); assert.equal(runtime.report(state.id).independentReview, false);
    assert.ok(state.tests.some(t => t.phase === 'compensating-verification' && t.passed));
  } finally { await run.close(); }
});
