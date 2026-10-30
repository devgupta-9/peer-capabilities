import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { EnvironmentManager } from '../dist/runtime/environment.js';
import { collectResourceVerification } from '../dist/runtime/resource-verification.js';
import { inspectResourceChoices } from '../dist/runtime/resource-routing.js';
import { digest } from '../dist/runtime/identity.js';

const catalog = () => ({ schemaVersion: 1,
  providers: [{ id: 'provider' }], frontends: [{ id: 'frontend' }],
  accounts: [{ id: 'account', providerId: 'provider', policy: 'ACTIVE' }],
  authContexts: [{ id: 'auth', accountId: 'account', frontendId: 'frontend', handle: 'official-profile' }],
  quotaPools: [{ id: 'pool', accountId: 'account' }],
  models: [{ id: 'model', providerId: 'provider', model: 'exact-model', efforts: ['high', 'low'], contextWindow: 32000 }],
  bindings: [{ id: 'binding', modelId: 'model', authContextId: 'auth', quotaPoolId: 'pool', enabled: true }],
  profiles: [{ id: 'profile', roles: ['lead', 'reviewer'], features: ['read'], competence: 8 }],
  workers: [{ id: 'worker', frontendId: 'frontend', authContextId: 'auth', profileId: 'profile', enabled: true }],
});
const scope = { workerId: 'worker', bindingId: 'binding', role: 'reviewer', effort: 'high',
  frontendVersion: 'fixture-v1', configurationDigest: 'a'.repeat(64) };
const tick = () => new Promise(resolve => setTimeout(resolve, 3));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'peer-collector-'));
  const file = path.join(root, 'environment.sqlite'); const managers = [];
  const open = options => { const m = new EnvironmentManager(file, root, options); managers.push(m); return m; };
  const environment = open(); environment.saveResources(catalog(), 0);
  t.after(async () => { managers.forEach(m => m.close()); await rm(root, { recursive: true, force: true, maxRetries: 5 }); });
  const context = { authContextId: 'auth', handle: 'official-profile', frontendVersion: scope.frontendVersion,
    configurationDigest: scope.configurationDigest, identityDigest: 'b'.repeat(64), authentication: 'AUTHENTICATED',
    expiresAt: new Date(Date.now() + 120000).toISOString() };
  const calls = { context: 0, probe: 0 };
  const proof = request => ({ attemptId: request.attemptId, scope: request.scope, model: request.model,
    contextDigest: request.contextDigest, availability: 'AVAILABLE',
    checks: [{ id: 'observed-file-read', passed: true }, { id: 'review-contract', passed: true }], evidenceReference: 'c'.repeat(64) });
  const collector = { id: 'fixture-collector-v1', frontendId: 'frontend',
    requiredChecks: contract => { assert.equal(contract.role, 'reviewer'); return ['observed-file-read', 'review-contract']; },
    observeContext: async () => { calls.context++; return structuredClone(context); },
    probe: async request => { calls.probe++; return proof(request); },
  };
  const request = { scope, resourceRevision: 1, timeoutMs: 10000, ttlMs: 300000 };
  const run = (changes = {}, signal) => collectResourceVerification(environment, collector, { ...request, ...changes }, signal);
  const current = () => environment.getResourceObservation(scope);
  const choices = () => inspectResourceChoices(environment, 'frontend', { workerId: 'worker', bindingIds: ['binding'] },
    { frontendVersion: scope.frontendVersion, configurationDigest: scope.configurationDigest }, [{
      agent: 'frontend', model: 'exact-model', effort: 'high', efforts: ['high'], roles: ['reviewer'],
      competence: 8, contextWindow: 32000, cost: 1, latency: 1, authentication: 'UNKNOWN', availability: 'AVAILABLE',
      provider: 'provider', quotaPool: 'pool',
    }]);
  return { root, file, environment, open, collector, context, calls, proof, request, run, current, choices };
}

test('collector produces exact scoped durable evidence consumed by routing and doctor', async t => {
  const f = await fixture(t); const result = await f.run();
  assert.equal(result.status, 'VERIFIED'); assert.equal(result.reason, 'CHECKS_PASSED');
  assert.equal(f.calls.context, 2); assert.equal(f.calls.probe, 1);
  assert.equal(result.observation.expiresAt, f.context.expiresAt, 'Provider context bounds the evidence lifetime');
  assert.equal(result.observation.evidence.reference, 'c'.repeat(64), 'Preserve the collector evidence reference');
  assert.equal(f.choices().choices.length, 1); assert.equal(f.choices().diagnostics[0].reason, 'ELIGIBLE');
  assert.deepEqual(f.open({ readOnly: true }).getResourceObservation(scope).observation, result.observation);
  assert.equal(f.environment.getResourceObservation({ ...scope, effort: 'low' }).status, 'UNKNOWN');
  assert.equal(f.environment.getResourceObservation({ ...scope, role: 'lead' }).status, 'UNKNOWN');
  assert.equal(JSON.stringify(result).includes('official-profile'), false);
});

test('in-progress verification revokes old success and remains unverified after a fresh connection opens', async t => {
  const f = await fixture(t); await f.run(); await tick();
  const entered = deferred(), finish = deferred();
  f.collector.probe = async request => { entered.resolve(); await finish.promise; return f.proof(request); };
  const running = f.run(); await entered.promise;
  const pending = f.open({ readOnly: true }).getResourceObservation(scope).observation;
  assert.equal(pending.verification, 'UNVERIFIED'); assert.equal(pending.evidence.method, 'DISCOVERY');
  assert.deepEqual(f.choices().choices, []);
  finish.resolve(); assert.equal((await running).status, 'VERIFIED');
});

test('unconfirmed or mismatched provider context never reaches the functional probe', async t => {
  for (const change of [{ authentication: 'UNKNOWN' }, { authentication: 'AUTH_REQUIRED' },
    { authContextId: 'other' }, { handle: 'other-profile' }, { frontendVersion: 'v2' },
    { configurationDigest: 'd'.repeat(64) }, { expiresAt: '2020-01-01T00:00:00.000Z' }]) {
    const f = await fixture(t); Object.assign(f.context, change);
    const result = await f.run();
    assert.equal(result.status, 'UNAVAILABLE'); assert.equal(f.calls.probe, 0);
    assert.equal(result.observation.evidence.method, 'OFFICIAL_STATUS');
    assert.deepEqual(f.choices().choices, []);
  }
});

test('context switching or logout during the probe cannot produce successful evidence', async t => {
  for (const change of [{ identityDigest: 'd'.repeat(64) }, { handle: 'another' }, { authentication: 'AUTH_REQUIRED' }]) {
    const f = await fixture(t);
    f.collector.probe = async request => { Object.assign(f.context, change); return f.proof(request); };
    const result = await f.run(); assert.equal(result.status, 'UNAVAILABLE');
    assert.equal(result.reason, change.authentication ? 'AUTH_REQUIRED' : 'CONTEXT_CHANGED');
    assert.deepEqual(f.choices().choices, []);
  }
});

test('exact runtime checks are required; missing, failed, extra or mismatched proof is rejected', async t => {
  for (const change of [
    { checks: [] }, { checks: [{ id: 'model-said-ok', passed: true }] },
    { checks: [{ id: 'observed-file-read', passed: true }, { id: 'review-contract', passed: false }] },
    { checks: [{ id: 'observed-file-read', passed: true }, { id: 'review-contract', passed: true }, { id: 'unexpected', passed: false }] },
    { scope: { ...scope, effort: 'low' } }, { model: 'different-model' }, { contextDigest: 'f'.repeat(64) },
    { attemptId: '00000000-0000-4000-8000-000000000000' },
  ]) {
    const f = await fixture(t); f.collector.probe = async request => ({ ...f.proof(request), ...change });
    const result = await f.run(); assert.equal(result.status, 'UNAVAILABLE'); assert.deepEqual(f.choices().choices, []);
  }
});

test('quota and authentication failures are durable without becoming successful review evidence', async t => {
  for (const availability of ['QUOTA_EXHAUSTED', 'RATE_LIMITED', 'AUTH_REQUIRED', 'POLICY_BLOCKED', 'SERVICE_UNAVAILABLE']) {
    const f = await fixture(t);
    f.collector.probe = async request => ({ ...f.proof(request), availability });
    const result = await f.run(); assert.equal(result.status, 'UNAVAILABLE');
    assert.equal(result.observation.availability, availability);
    assert.equal(f.open({ readOnly: true }).getResourceObservation(scope).observation.availability, availability);
    assert.deepEqual(f.choices().choices, []);
  }
});

test('collector exceptions and secret-bearing or extra result fields are withheld from persistence', async t => {
  const privateValue = ['synthetic', 'must-not-persist'].join('-');
  for (const mode of ['throw', 'field', 'context']) {
    const f = await fixture(t);
    if (mode === 'context') f.collector.observeContext = async () => ({ ...f.context, raw: privateValue });
    else f.collector.probe = async request => {
      if (mode === 'throw') throw new Error(privateValue);
      return { ...f.proof(request), ['pass' + 'word']: privateValue };
    };
    const result = await f.run(); assert.equal(result.status, 'UNAVAILABLE');
    assert.equal(JSON.stringify(result).includes(privateValue), false);
    assert.equal((await readFile(f.file)).includes(Buffer.from(privateValue)), false);
    const wal = await readFile(f.file + '-wal').catch(() => Buffer.alloc(0));
    assert.equal(wal.includes(Buffer.from(privateValue)), false);
  }
});

test('a superseded attempt cannot overwrite a newer failure even when its success arrives last', async t => {
  const f = await fixture(t); const entered = deferred(), finish = deferred();
  f.collector.probe = async request => { entered.resolve(); await finish.promise; return f.proof(request); };
  const older = f.run(); const rejected = assert.rejects(older, /RESOURCE_OBSERVATION_CONFLICT/);
  await entered.promise; await tick();
  const writer = f.open();
  const failure = { ...f.current().observation, authentication: 'AUTH_REQUIRED', availability: 'AUTH_REQUIRED',
    verification: 'UNAVAILABLE', observedAt: new Date().toISOString(), evidence: { method: 'OFFICIAL_STATUS', reference: 'e'.repeat(64) } };
  writer.recordResourceObservation(failure); finish.resolve(); await rejected;
  assert.deepEqual(f.current().observation, failure); assert.deepEqual(f.choices().choices, []);
});

test('catalog changes before functional dispatch prevent the probe and never commit stale success', async t => {
  const f = await fixture(t);
  f.collector.observeContext = async () => {
    const changed = catalog(); changed.workers[0].enabled = false; f.environment.saveResources(changed, 1);
    return f.context;
  };
  await assert.rejects(f.run(), /RESOURCE_REVISION_CONFLICT/); assert.equal(f.calls.probe, 0);
  f.environment.restoreResources(1, 2);
  assert.equal(f.current().status, 'CONFIGURATION_CHANGED');
});

test('timeout requests cancellation and ignores a non-cooperative late success', async t => {
  const f = await fixture(t); const finish = deferred(), entered = deferred(); let probeSignal;
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.now() });
  f.collector.probe = async (request, signal) => { probeSignal = signal; entered.resolve(); await finish.promise; return f.proof(request); };
  const running = f.run({ timeoutMs: 200 }); await entered.promise;
  t.mock.timers.tick(200);
  const result = await running;
  assert.equal(result.reason, 'TIMEOUT'); assert.equal(result.status, 'UNAVAILABLE'); assert.equal(probeSignal.aborted, true);
  const failureDigest = digest(f.current().observation);
  finish.resolve(); await new Promise(setImmediate); assert.equal(digest(f.current().observation), failureDigest);
});

test('cancellation before dispatch writes nothing; cancellation during a probe persists failure', async t => {
  const f = await fixture(t); const early = new AbortController(); early.abort();
  await assert.rejects(f.run({}, early.signal), /VERIFICATION_CANCELLED/); assert.equal(f.current().status, 'UNKNOWN');
  const cancel = new AbortController(); const entered = deferred(), finish = deferred();
  f.collector.probe = async request => { entered.resolve(); await finish.promise; return f.proof(request); };
  const running = f.run({}, cancel.signal); await entered.promise; cancel.abort();
  assert.equal((await running).reason, 'CANCELLED'); assert.equal(f.current().observation.verification, 'UNAVAILABLE');
  finish.resolve(); await tick(); assert.deepEqual(f.choices().choices, []);
});

test('invalid requests, disabled resources and read-only state reject collection before provider calls', async t => {
  const f = await fixture(t);
  for (const change of [{ timeoutMs: 0 }, { ttlMs: 900001 }, { resourceRevision: 2 },
    { scope: { ...scope, workerId: 'missing' } }, { raw: 'not-permitted' }]) {
    await assert.rejects(f.run(change)); assert.equal(f.current().status, 'UNKNOWN');
  }
  const reader = f.open({ readOnly: true });
  await assert.rejects(collectResourceVerification(reader, f.collector, f.request), /readonly|read.only/i);
  const changed = catalog(); changed.accounts[0].policy = 'RESERVE'; f.environment.saveResources(changed, 1);
  await assert.rejects(f.run({ resourceRevision: 2 }), /RESOURCE_POLICY_BLOCKED/);
  assert.equal(f.calls.context, 0); assert.equal(f.calls.probe, 0);
});

test('conditional observation writes are atomic and do not replace a newer observation', async t => {
  const f = await fixture(t); const first = await f.run(); await tick();
  const later = { ...first.observation, observedAt: new Date().toISOString(), verification: 'UNAVAILABLE', availability: 'QUOTA_EXHAUSTED' };
  f.environment.recordResourceObservation(later, digest(first.observation)); await tick();
  await assert.rejects(f.run({ resourceRevision: 99 }), /RESOURCE_REVISION_CONFLICT/);
  assert.throws(() => f.environment.recordResourceObservation({ ...first.observation, observedAt: new Date().toISOString() }, digest(first.observation)), /RESOURCE_OBSERVATION_CONFLICT/);
  assert.deepEqual(f.current().observation, later);
});

test('process exit during functional verification leaves durable unverified state instead of old success', async t => {
  const f = await fixture(t); await f.run(); await tick();
  const code = `
    import { EnvironmentManager } from ${JSON.stringify(new URL('../dist/runtime/environment.js', import.meta.url).href)};
    import { collectResourceVerification } from ${JSON.stringify(new URL('../dist/runtime/resource-verification.js', import.meta.url).href)};
    const m = new EnvironmentManager(${JSON.stringify(f.file)}, ${JSON.stringify(f.root)});
    await collectResourceVerification(m, {
      id: 'crash-fixture', frontendId: 'frontend', requiredChecks: () => ['observed-file-read'],
      observeContext: async () => (${JSON.stringify(f.context)}), probe: async () => process.exit(0),
    }, ${JSON.stringify(f.request)});
    process.exit(99);
  `;
  execFileSync(process.execPath, ['--input-type=module', '-e', code], { stdio: 'pipe' });
  assert.equal(f.open({ readOnly: true }).getResourceObservation(scope).observation.verification, 'UNVERIFIED');
  assert.deepEqual(f.choices().choices, []);
});

test('invalid collector recipes do not leak errors or change observation state', async t => {
  const f = await fixture(t);
  for (const recipe of [() => [], () => ['same', 'same'], () => { throw new Error('synthetic-private-recipe'); }]) {
    f.collector.requiredChecks = recipe;
    await assert.rejects(f.run(), { message: 'INVALID_COLLECTOR_RESULT' });
    assert.equal(f.current().status, 'UNKNOWN'); assert.equal(f.calls.context, 0);
  }
});
