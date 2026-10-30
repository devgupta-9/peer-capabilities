import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { ProviderAdapter } from '../dist/runtime/adapters.js';
import { EnvironmentManager } from '../dist/runtime/environment.js';
import { selectAgent } from '../dist/runtime/scheduler.js';
import { Runtime } from '../dist/runtime/runner.js';
import { inspectResourceChoices } from '../dist/runtime/resource-routing.js';
import { recordInvocationFailure } from '../dist/runtime/resource-feedback.js';
import { digest } from '../dist/runtime/identity.js';
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

test('resource doctor explains exact eligibility using dispatch evidence without invoking or renewing it', async t => {
  const f = await fixture(t); const observation = f.record();
  const reader = new EnvironmentManager(path.join(f.root, 'environment.sqlite'), f.root, { readOnly: true });
  try {
    const adapter = new ProviderAdapter(config(), undefined, f.capture, reader);
    const report = await adapter.resourceDoctor();
    assert.equal(report.status, 'ELIGIBLE');
    assert.equal(report.catalogRevision, 1);
    const eligible = report.diagnostics.filter(d => d.eligible);
    assert.deepEqual(eligible.map(d => d.scope), (await adapter.discover()).choices.map(c => c.resource.scope));
    assert.equal(eligible[0].observation.expiresAt, observation.expiresAt);
    assert.equal(report.diagnostics.find(d => d.scope.role === 'reviewer').reason, 'UNKNOWN');
    assert.equal(report.diagnostics.find(d => d.scope.role === 'consultant').reason, 'CAPABILITY_MISMATCH');
    const output = JSON.stringify(report);
    for (const privateValue of ['official-profile', 'shared-pool', 'FUNCTIONAL_PROBE', 'a'.repeat(64)]) assert.equal(output.includes(privateValue), false);
    assert.equal(f.calls(), 0);
    assert.deepEqual(reader.getResourceObservation(f.scope('lead')).observation, observation);
    assert.throws(() => reader.saveResources(catalog(), 1), /readonly|read.only/i);
    assert.throws(() => reader.recordResourceObservation({ ...observation, observedAt: new Date().toISOString() }), /readonly|read.only/i);
  } finally { reader.close(); }
});

test('resource doctor distinguishes missing, expired, authentication, quota and unverified evidence', async t => {
  const scenarios = [
    ['UNKNOWN', undefined],
    ['EXPIRED', { observedAt: new Date(Date.now() - 60000).toISOString(), expiresAt: new Date(Date.now() - 1000).toISOString() }],
    ['AUTH_REQUIRED', { authentication: 'AUTH_REQUIRED', availability: 'AUTH_REQUIRED', verification: 'UNAVAILABLE' }],
    ['UNAVAILABLE', { availability: 'QUOTA_EXHAUSTED', verification: 'UNAVAILABLE' }],
    ['AUTH_UNKNOWN', { authentication: 'UNKNOWN', verification: 'UNVERIFIED' }],
    ['UNVERIFIED', { verification: 'UNVERIFIED' }],
  ];
  for (const [reason, observation] of scenarios) {
    const f = await fixture(t); if (observation) f.record('lead', observation);
    const report = await f.adapter.resourceDoctor();
    assert.equal(report.status, 'BLOCKED', reason);
    const diagnostic = report.diagnostics.find(d => d.scope?.role === 'lead');
    assert.equal(diagnostic.reason, reason);
    assert.ok(diagnostic.nextAction.length > 20);
    assert.deepEqual((await f.adapter.discover()).choices, []);
    if (reason === 'UNAVAILABLE') assert.equal(diagnostic.observation.availability, 'QUOTA_EXHAUSTED');
    assert.equal(f.calls(), 0);
  }
});

test('doctor detects policy changes and rollback invalidation without reauthorizing old evidence', async t => {
  const f = await fixture(t); f.record();
  const changed = catalog(); changed.accounts[0].policy = 'RESERVE'; f.environment.saveResources(changed, 1);
  assert.equal((await f.adapter.resourceDoctor()).diagnostics.find(d => d.scope.role === 'lead').reason, 'RESOURCE_POLICY_BLOCKED');
  f.environment.restoreResources(1, 2);
  assert.equal((await f.adapter.resourceDoctor()).diagnostics.find(d => d.scope.role === 'lead').reason, 'CONFIGURATION_CHANGED');
  const newConfig = config(); newConfig.profiles[0].cost++;
  assert.equal((await new ProviderAdapter(newConfig, undefined, f.capture, f.environment).resourceDoctor())
    .diagnostics.find(d => d.scope.role === 'lead').reason, 'UNKNOWN');
  assert.equal(f.calls(), 0);
});

test('doctor reports discovery and binding failures without leaking raw errors or repairing state', async t => {
  const f = await fixture(t);
  const empty = config(); empty.profiles = [];
  assert.equal((await new ProviderAdapter(empty, undefined, f.capture, f.environment).resourceDoctor()).diagnostics[0].reason, 'NO_DISCOVERED_PROFILE');
  const blocked = config(); blocked.experimental = false;
  assert.equal((await new ProviderAdapter(blocked, undefined, f.capture, f.environment).resourceDoctor()).diagnostics[0].reason, 'DISCOVERY_BLOCKED');
  const unavailable = async () => { throw new Error('synthetic-private-local-path'); };
  assert.equal((await new ProviderAdapter(config(), undefined, unavailable, f.environment).resourceDoctor()).reason, 'CLI_UNAVAILABLE');
  const source = { readResources: () => { throw new Error('synthetic-private-local-path'); } };
  const broken = await new ProviderAdapter(config(), undefined, f.capture, source).resourceDoctor();
  assert.equal(broken.reason, 'INSPECTION_FAILED');
  assert.equal(JSON.stringify(broken).includes('synthetic-private-local-path'), false);
  assert.equal((await new ProviderAdapter(config(), undefined, f.capture, { readResources: () => null }).resourceDoctor()).reason, 'RESOURCE_CATALOG_REQUIRED');
  const missing = config(); missing.resources.workerId = 'missing';
  assert.equal((await new ProviderAdapter(missing, undefined, f.capture, f.environment).resourceDoctor()).reason, 'RESOURCE_NOT_FOUND');
  const ambiguous = catalog(); ambiguous.bindings.push({ ...ambiguous.bindings[0], id: 'other' }); f.environment.saveResources(ambiguous, 1);
  const both = config(); both.resources.bindingIds.push('other');
  assert.equal((await new ProviderAdapter(both, undefined, f.capture, f.environment).resourceDoctor()).reason, 'AMBIGUOUS_RESOURCE_BINDING');
  assert.equal(f.calls(), 0);
});

test('fresh discovery denial wins over scoped success and resource changes abort the entire diagnostic result', async t => {
  const f = await fixture(t); f.record(); const choice = (await f.adapter.discover()).choices[0];
  const inspect = (source, candidate) => inspectResourceChoices(source, 'antigravity', config().resources,
    { frontendVersion: choice.resource.scope.frontendVersion, configurationDigest: choice.resource.scope.configurationDigest }, [candidate]);
  const denied = inspect(f.environment, { ...choice, authentication: 'AUTH_REQUIRED' });
  assert.equal(denied.choices.length, 0); assert.equal(denied.diagnostics[0].reason, 'AUTH_REQUIRED');
  let reads = 0;
  const changing = { readResources: () => ({ ...f.environment.readResources(), revision: ++reads }),
    getResourceObservation: s => f.environment.getResourceObservation(s) };
  assert.throws(() => inspect(changing, choice), /RESOURCE_REVISION_CHANGED/);
  const db = new DatabaseSync(path.join(f.root, 'environment.sqlite'));
  try { db.exec("UPDATE resource_observations SET digest='invalid'"); } finally { db.close(); }
  const report = await f.adapter.resourceDoctor();
  assert.equal(report.reason, 'INSPECTION_FAILED'); assert.deepEqual(report.diagnostics, []);
  await assert.rejects(f.adapter.discover(), /CORRUPT_RESOURCE_OBSERVATION/);
});

test('unbound resource doctor makes no provider calls or scoped readiness claims', async () => {
  const unbound = config(); delete unbound.resources;
  const report = await new ProviderAdapter(unbound, undefined, async () => { throw new Error('Must not run'); }).resourceDoctor();
  assert.equal(report.status, 'NOT_RESOURCE_BOUND'); assert.deepEqual(report.diagnostics, []);
});

test('CLI resource doctor is read-only and missing state does not create an environment or task database', async () => {
  const run = await runtimeFixture();
  const cli = fileURLToPath(new URL('../bin/peer-capabilities.mjs', import.meta.url));
  try {
    const configFile = path.join(run.root, '.git', 'resource-doctor.json');
    await writeFile(configFile, JSON.stringify({ agents: [config()], policy: run.policy }));
    const state = path.join(run.root, '.git', 'doctor-state');
    const args = ['resources', 'doctor', '--repo', run.root, '--config', configFile, '--state-dir', state];
    const call = extra => spawnSync(process.execPath, [cli, ...args, ...extra], { encoding: 'utf8' });
    const missing = call([]);
    assert.equal(missing.status, 1, missing.stderr);
    assert.equal(JSON.parse(missing.stdout).reason, 'ENVIRONMENT_NOT_INITIALIZED');
    await assert.rejects(readdir(state), { code: 'ENOENT' });
    const manager = new EnvironmentManager(path.join(state, 'environment.sqlite'), run.root); manager.close();
    const file = path.join(state, 'environment.sqlite'); const before = await readFile(file);
    const result = call([]);
    assert.equal(result.status, 1, result.stderr);
    assert.equal(JSON.parse(result.stdout).agents[0].reason, 'RESOURCE_CATALOG_REQUIRED');
    assert.deepEqual(await readFile(file), before);
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      assert.equal(db.prepare('SELECT count(*) AS n FROM observations').get().n, 0);
      assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name LIKE 'resource%'").get().n, 0);
    } finally { db.close(); }
    const names = await readdir(state); assert.equal(names.includes('tasks.sqlite'), false);
    const rejected = call(['--apply']); assert.equal(rejected.status, 1); assert.equal(rejected.stdout, '');
    assert.deepEqual(await readFile(file), before, 'Rejected apply cannot change environment state');
  } finally { await run.close(); }
});

test('read-only environment inspection rejects mismatched scope and incomplete schema without mutation', async t => {
  const f = await fixture(t); f.close();
  const file = path.join(f.root, 'environment.sqlite'); const before = await readFile(file);
  assert.throws(() => new EnvironmentManager(file, tmpdir(), { readOnly: true }), /ENVIRONMENT_INSPECTION_FAILED/);
  assert.deepEqual(await readFile(file), before);
  const partial = path.join(f.root, 'partial.sqlite');
  const db = new DatabaseSync(partial); db.exec('CREATE TABLE unrelated(value TEXT)'); db.close();
  const original = await readFile(partial);
  assert.throws(() => new EnvironmentManager(partial, f.root, { readOnly: true }), /ENVIRONMENT_INSPECTION_FAILED/);
  assert.deepEqual(await readFile(partial), original);
});

function failureAdapter(f, failure = {}, source = f.environment, beforeResult = () => {}) {
  let calls = 0;
  const adapter = new ProviderAdapter(config(), undefined, async (command, args, options) => {
    if (args[0] === '--version' || args[0] === 'models') return f.capture(command, args, options);
    calls++; await beforeResult();
    return { code: 1, stdout: '', stderr: 'quota exhausted', timedOut: false, cancelled: false,
      stdoutTruncated: false, stderrTruncated: false, durationMs: 1, ...failure };
  }, source);
  return { adapter, calls: () => calls,
    invoke: (choice, role = 'lead') => adapter.execute({ id: 'fixture', taskId: 'fixture', cwd: f.root, role, choice, prompt: 'Fixture only' }) };
}

test('invocation quota failure durably revokes exact evidence without expiring back into success', async t => {
  const f = await fixture(t); f.record();
  const selected = selectAgent((await f.adapter.discover()).choices, request);
  const bad = failureAdapter(f); const result = await bad.invoke(selected);
  assert.equal(result.availability, 'QUOTA_EXHAUSTED'); assert.equal(result.resourceFeedback, 'RECORDED');
  const observation = f.environment.getResourceObservation(f.scope('lead')).observation;
  assert.equal(observation.verification, 'UNAVAILABLE'); assert.equal(observation.authentication, 'AUTHENTICATED');
  assert.equal(observation.evidence.method, 'INVOCATION');
  assert.deepEqual((await f.adapter.discover()).choices, [], 'A separate adapter also sees the failure');
  assert.equal((await bad.invoke(selected)).availability, 'POLICY_BLOCKED'); assert.equal(bad.calls(), 1);
  const reopened = new EnvironmentManager(path.join(f.root, 'environment.sqlite'), f.root, { readOnly: true });
  try { assert.deepEqual(reopened.getResourceObservation(f.scope('lead')).observation, observation); }
  finally { reopened.close(); }
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(observation.expiresAt) + 1 });
  assert.equal(f.environment.getResourceObservation(f.scope('lead')).status, 'EXPIRED');
  assert.deepEqual((await f.adapter.discover()).choices, [], 'Expiration never revives historical success');
});

test('auth, service, malformed, cancelled and timed out invocations persist normalized negative state', async t => {
  for (const [failure, expected] of [
    [{ stderr: 'please log in' }, 'AUTH_REQUIRED'],
    [{ stderr: '503 service unavailable' }, 'SERVICE_UNAVAILABLE'],
    [{ code: 0, stderr: '', stdout: '{unfinished' }, 'EXECUTION_ERROR'],
    [{ stderr: '', timedOut: true }, 'TIMEOUT'],
    [{ stderr: '', cancelled: true }, 'TIMEOUT'],
  ]) {
    const f = await fixture(t); f.record();
    const selected = selectAgent((await f.adapter.discover()).choices, request);
    const result = await failureAdapter(f, failure).invoke(selected);
    assert.equal(result.availability, expected); assert.equal(result.resourceFeedback, 'RECORDED');
    const observation = f.environment.getResourceObservation(f.scope('lead')).observation;
    assert.equal(observation.authentication, expected === 'AUTH_REQUIRED' ? 'AUTH_REQUIRED' : 'AUTHENTICATED');
    assert.equal(observation.availability, expected); assert.equal(observation.verification, 'UNAVAILABLE');
    assert.equal(result.review, undefined);
  }
});

test('success and preflight rejection cannot mint, renew or revoke scoped proof', async t => {
  const f = await fixture(t); const original = f.record();
  const selected = selectAgent((await f.adapter.discover()).choices, request);
  assert.equal((await f.invoke(selected)).availability, 'AVAILABLE');
  assert.deepEqual(f.environment.getResourceObservation(f.scope('lead')).observation, original);
  assert.equal((await f.invoke(selected, 'reviewer')).availability, 'POLICY_BLOCKED');
  assert.deepEqual(f.environment.getResourceObservation(f.scope('lead')).observation, original);
  assert.throws(() => f.environment.recordResourceObservation({ ...original,
    observedAt: new Date().toISOString(), evidence: { method: 'INVOCATION', reference: 'b'.repeat(64) },
  }), /INVALID_RESOURCE_OBSERVATION/, 'Invocation receipts cannot certify capability');
  await assert.rejects(recordInvocationFailure(f.environment, selected.resource, 'AVAILABLE'), /FAILURE_REQUIRED/);
});

test('failure feedback does not propagate across role, effort or binding', async t => {
  const f = await fixture(t); const original = f.record(); const review = f.record('reviewer');
  const expanded = catalog(); expanded.bindings.push({ ...expanded.bindings[0], id: 'other' });
  f.environment.saveResources(expanded, 1);
  const otherEffort = f.environment.recordResourceObservation({ ...original, resourceRevision: 2, scope: { ...original.scope, effort: 'low' } });
  const otherBinding = f.environment.recordResourceObservation({ ...original, resourceRevision: 2, scope: { ...original.scope, bindingId: 'other' } });
  const selected = selectAgent((await f.adapter.discover()).choices, request);
  assert.equal((await failureAdapter(f).invoke(selected)).resourceFeedback, 'RECORDED');
  assert.equal(f.environment.getResourceObservation(original.scope).observation.resourceRevision, 2);
  for (const untouched of [review, otherEffort, otherBinding]) {
    assert.deepEqual(f.environment.getResourceObservation(untouched.scope).observation, untouched);
  }
});

test('concurrent newer verification or failure wins over an old invocation receipt', async t => {
  for (const availability of ['AVAILABLE', 'RATE_LIMITED']) {
    const f = await fixture(t); f.record();
    const selected = selectAgent((await f.adapter.discover()).choices, request); let newer;
    const bad = failureAdapter(f, {}, f.environment, () => {
      newer = f.record('lead', { availability, verification: availability === 'AVAILABLE' ? 'VERIFIED' : 'UNAVAILABLE',
        observedAt: new Date(Date.now() - 1000).toISOString() });
    });
    const result = await bad.invoke(selected);
    assert.equal(result.availability, 'QUOTA_EXHAUSTED'); assert.equal(result.resourceFeedback, 'SUPERSEDED');
    assert.deepEqual(f.environment.getResourceObservation(f.scope('lead')).observation, newer);
  }
});

test('catalog changes and rollback during failure feedback cannot attribute failure to a new context', async t => {
  for (const rollback of [false, true]) {
    const f = await fixture(t); f.record();
    const selected = selectAgent((await f.adapter.discover()).choices, request); let injected = false;
    const source = {
      readResources: () => {
        const changed = catalog(); changed.authContexts[0].handle = 'different-profile';
        f.environment.saveResources(changed, 1);
        if (rollback) f.environment.restoreResources(1, 2);
        injected = true; return f.environment.readResources();
      },
      getResourceObservation: scope => f.environment.getResourceObservation(scope),
      recordResourceObservation: () => assert.fail('Changed context must not receive invocation evidence'),
    };
    assert.equal(await recordInvocationFailure(source, selected.resource, 'AUTH_REQUIRED'), 'SUPERSEDED');
    assert.equal(injected, true); assert.equal(f.environment.getResourceObservation(f.scope('lead')).status, 'CONFIGURATION_CHANGED');
  }
});

test('transactional failure write preserves an observation that arrives after final validation', async t => {
  const f = await fixture(t); f.record(); const selected = selectAgent((await f.adapter.discover()).choices, request);
  let newer, injected = false;
  const source = { readResources: () => f.environment.readResources(),
    getResourceObservation: scope => f.environment.getResourceObservation(scope),
    recordResourceObservation: (value, expected) => {
      injected = true; newer = f.record('lead', { observedAt: new Date(Date.now() - 1000).toISOString() });
      return f.environment.recordResourceObservation(value, expected);
    } };
  assert.equal(await recordInvocationFailure(source, selected.resource, 'AUTH_REQUIRED'), 'SUPERSEDED');
  assert.equal(injected, true); assert.deepEqual(f.environment.getResourceObservation(f.scope('lead')).observation, newer);
});

test('bound execution rejects read-only or absent writers before calling the provider', async t => {
  const f = await fixture(t); f.record(); const selected = selectAgent((await f.adapter.discover()).choices, request);
  const readOnly = new EnvironmentManager(path.join(f.root, 'environment.sqlite'), f.root, { readOnly: true });
  try {
    for (const source of [readOnly, { readResources: () => f.environment.readResources(),
      getResourceObservation: scope => f.environment.getResourceObservation(scope) }]) {
      const bad = failureAdapter(f, {}, source);
      assert.equal((await bad.invoke(selected)).availability, 'POLICY_BLOCKED'); assert.equal(bad.calls(), 0);
    }
  } finally { readOnly.close(); }
});

test('failure persistence errors stop further dispatch and expose no raw error', async t => {
  const f = await fixture(t); f.record(); const selected = selectAgent((await f.adapter.discover()).choices, request);
  const source = { readResources: () => f.environment.readResources(),
    getResourceObservation: scope => f.environment.getResourceObservation(scope), canWriteResourceObservations: () => true,
    recordResourceObservation: () => { throw new Error('PRIVATE_DIAGNOSTIC_SENTINEL'); } };
  const bad = failureAdapter(f, {}, source); const result = await bad.invoke(selected);
  assert.equal(result.resourceFeedback, 'FAILED'); assert.equal(result.availability, 'EXECUTION_ERROR');
  assert.equal(JSON.stringify(result).includes('PRIVATE_DIAGNOSTIC_SENTINEL'), false);
  assert.equal((await bad.invoke(selected)).availability, 'POLICY_BLOCKED'); assert.equal(bad.calls(), 1);
  await assert.rejects(bad.adapter.discover(), /RESOURCE_FEEDBACK_FAILED/);
  assert.equal((await bad.adapter.resourceDoctor()).reason, 'RESOURCE_FEEDBACK_FAILED');
});

test('corrupt observations during invocation cannot be overwritten by failure feedback', async t => {
  const f = await fixture(t); f.record(); const selected = selectAgent((await f.adapter.discover()).choices, request);
  const bad = failureAdapter(f, {}, f.environment, () => {
    const db = new DatabaseSync(path.join(f.root, 'environment.sqlite'));
    try { db.exec("UPDATE resource_observations SET digest='corrupt'"); } finally { db.close(); }
  });
  assert.equal((await bad.invoke(selected)).resourceFeedback, 'FAILED');
  assert.throws(() => f.environment.getResourceObservation(f.scope('lead')), /CORRUPT_RESOURCE_OBSERVATION/);
});

test('runtime preserves scoped failure status and blocks on reviewer feedback storage failure', async () => {
  const run = await runtimeFixture();
  try {
    const reviewer = { id: 'reviewer', loginInstructions: () => 'Fixture',
      discover: async () => {
        const result = await run.adapters[0].discover();
        return { ...result, choices: result.choices.map(c => ({ ...c, agent: 'reviewer', roles: ['reviewer'] })) };
      }, execute: async () => ({ availability: 'EXECUTION_ERROR', resourceFeedback: 'FAILED', response: 'Withheld' }) };
    const runtime = new Runtime(run.store, [...run.adapters, reviewer], run.policy);
    const state = await runtime.start(run.root, 'Correct fixture answer', true);
    assert.equal(state.status, 'BLOCKED'); assert.equal(state.checkpoint, undefined);
    assert.match(state.reviews[0].reason, /scoped feedback: FAILED/);
    assert.equal(state.tests.length, 1, 'Storage failure cannot continue as ordinary degraded review');
    assert.equal(run.store.replay(state.id).status, 'BLOCKED');
    assert.equal(runtime.report(state.id).independentReview, false);
  } finally { await run.close(); }
});

test('runtime durably reports a real adapter lead failure and keeps its worktree', async t => {
  const run = await runtimeFixture(); let f;
  try {
    f = await fixture(t, run.root); f.record(); const bad = failureAdapter(f);
    const runtime = new Runtime(run.store, [bad.adapter], run.policy);
    const state = await runtime.start(run.root, 'Correct fixture answer', true);
    assert.equal(state.status, 'BLOCKED'); assert.match(state.notes[0], /QUOTA_EXHAUSTED; scoped feedback: RECORDED/);
    assert.equal(await readFile(path.join(state.worktree, 'answer.txt'), 'utf8'), 'wrong\n');
    assert.deepEqual(run.store.replay(state.id).notes, state.notes);
  } finally { f?.close(); await run.close(); }
});

test('persisted reviewer quota failure still allows explicit degraded verification', async t => {
  const run = await runtimeFixture(); let f;
  try {
    f = await fixture(t, run.root); f.record('reviewer'); const bad = failureAdapter(f);
    const runtime = new Runtime(run.store, [...run.adapters, bad.adapter], run.policy);
    const state = await runtime.start(run.root, 'Correct fixture answer', true);
    assert.equal(state.status, 'CHECKPOINTED'); assert.equal(state.degraded, true);
    assert.equal(state.reviews[0].outcome, 'UNAVAILABLE');
    assert.match(state.reviews[0].reason, /QUOTA_EXHAUSTED; scoped feedback: RECORDED/);
    assert.equal(state.tests.length, 2); assert.equal(state.tests[1].phase, 'compensating-verification');
    assert.equal(runtime.report(state.id).independentReview, false);
    assert.equal(f.environment.getResourceObservation(f.scope('reviewer')).observation.availability, 'QUOTA_EXHAUSTED');
  } finally { f?.close(); await run.close(); }
});
