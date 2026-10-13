import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { EnvironmentManager } from '../dist/runtime/environment.js';

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
const scope = () => ({ workerId: 'worker', bindingId: 'binding', role: 'reviewer', effort: 'high',
  frontendVersion: '1.0.0', configurationDigest: 'a'.repeat(64) });
const observation = (changes = {}) => ({ scope: scope(), resourceRevision: 1,
  authentication: 'AUTHENTICATED', availability: 'AVAILABLE', verification: 'VERIFIED',
  observedAt: new Date(Date.now() - 2000).toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(),
  evidence: { method: 'FUNCTIONAL_PROBE', reference: 'b'.repeat(64) }, ...changes });
async function fixture(run) {
  const dir = await mkdtemp(path.join(tmpdir(), 'peer-resource-observation-'));
  const root = path.join(dir, 'root'); await mkdir(root); const managers = [];
  const open = () => { const m = new EnvironmentManager(path.join(dir, 'environment.sqlite'), root); managers.push(m); return m; };
  try { await run(open, path.join(dir, 'environment.sqlite')); }
  finally { for (const m of managers) m.close(); await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
}

test('scoped observations persist without extending expiry and never certify another role, effort or version', async () => fixture(async open => {
  const m = open(); m.saveResources(catalog(), 0);
  assert.equal(m.getResourceObservation(scope()).status, 'UNKNOWN');
  const input = observation(); m.recordResourceObservation(input);
  const fresh = open().getResourceObservation(scope());
  assert.equal(fresh.status, 'CURRENT'); assert.equal(fresh.observation.expiresAt, input.expiresAt);
  for (const changed of [{ effort: 'low' }, { role: 'lead' }, { frontendVersion: '2.0.0' }, { configurationDigest: 'c'.repeat(64) }]) {
    assert.equal(m.getResourceObservation({ ...scope(), ...changed }).status, 'UNKNOWN');
  }
}));

test('expiry returns no usable positive observation', async () => fixture(async open => {
  const m = open(); m.saveResources(catalog(), 0);
  m.recordResourceObservation(observation({ observedAt: new Date(Date.now() - 60000).toISOString(), expiresAt: new Date(Date.now() - 1000).toISOString() }));
  assert.deepEqual(m.getResourceObservation(scope()), { status: 'EXPIRED' });
}));

test('relevant configuration changes invalidate evidence permanently, including after rollback', async () => fixture(async open => {
  const m = open(); m.saveResources(catalog(), 0); m.recordResourceObservation(observation());
  const changed = catalog(); changed.authContexts[0].handle = 'different-profile'; m.saveResources(changed, 1);
  assert.deepEqual(m.getResourceObservation(scope()), { status: 'CONFIGURATION_CHANGED' });
  m.restoreResources(1, 2);
  assert.deepEqual(m.getResourceObservation(scope()), { status: 'CONFIGURATION_CHANGED' });
  assert.throws(() => m.recordResourceObservation(observation()), /RESOURCE_REVISION_CONFLICT/);
}));

test('unrelated catalog additions preserve the exact observation scope', async () => fixture(async open => {
  const m = open(); m.saveResources(catalog(), 0); m.recordResourceObservation(observation());
  const changed = catalog(); changed.providers.push({ id: 'unrelated' }); m.saveResources(changed, 1);
  assert.equal(m.getResourceObservation(scope()).status, 'CURRENT');
}));

test('newer auth failure supersedes success and delayed successes cannot overwrite it', async () => fixture(async open => {
  const m = open(); m.saveResources(catalog(), 0); const old = observation(); m.recordResourceObservation(old);
  m.recordResourceObservation(observation({ observedAt: new Date(Date.now() - 500).toISOString(), authentication: 'AUTH_REQUIRED',
    availability: 'AUTH_REQUIRED', verification: 'UNAVAILABLE', evidence: { method: 'OFFICIAL_STATUS', reference: 'd'.repeat(64) } }));
  assert.equal(m.getResourceObservation(scope()).observation.authentication, 'AUTH_REQUIRED');
  assert.throws(() => m.recordResourceObservation(old), /STALE_RESOURCE_OBSERVATION/);
}));

test('discovery cannot assert verified access; invalid, future and secret observations are rejected', async () => fixture(async open => {
  const m = open(); m.saveResources(catalog(), 0);
  for (const change of [
    { evidence: { method: 'DISCOVERY', reference: 'e'.repeat(64) } },
    { authentication: 'UNKNOWN' },
    { observedAt: new Date(Date.now() + 60000).toISOString() },
    { expiresAt: new Date(Date.now() - 60000).toISOString() },
    { verification: 'UNVERIFIED', evidence: { method: 'DISCOVERY', reference: 'e'.repeat(64) } },
    { availability: 'QUOTA_EXHAUSTED' },
    { scope: { ...scope(), bindingId: 'missing' } },
    { ['pass' + 'word']: ['synthetic', 'value'].join('-') },
  ]) assert.throws(() => m.recordResourceObservation(observation(change)), /INVALID_RESOURCE_OBSERVATION/);
  assert.equal(m.getResourceObservation(scope()).status, 'UNKNOWN');
}));

test('missing catalog cannot record access; legacy observations remain independent', async () => fixture(async open => {
  const m = open();
  assert.throws(() => m.recordResourceObservation(observation()), /RESOURCE_REVISION_CONFLICT/);
  m.recordObservation({ component: 'frontend', presence: 'CONFIGURED', authentication: 'AUTHENTICATED',
    verification: 'VERIFIED', observedAt: new Date().toISOString() });
  assert.equal(m.getResourceObservation(scope()).status, 'UNKNOWN');
  m.saveResources(catalog(), 0);
  m.recordResourceObservation(observation({ availability: 'SERVICE_UNAVAILABLE', verification: 'UNAVAILABLE' }));
  const current = m.getResourceObservation(scope()).observation;
  assert.equal(current.authentication, 'AUTHENTICATED');
  assert.equal(current.availability, 'SERVICE_UNAVAILABLE');
  assert.equal(m.getObservation('frontend').verification, 'VERIFIED');
}));

test('removed/readded bindings invalidate old evidence; a fresh probe can verify the new revision', async () => fixture(async open => {
  const m = open(); const old = observation(); m.saveResources(catalog(), 0); m.recordResourceObservation(old);
  const removed = catalog(); removed.bindings = []; m.saveResources(removed, 1);
  m.saveResources(catalog(), 2);
  assert.deepEqual(m.getResourceObservation(scope()), { status: 'CONFIGURATION_CHANGED' });
  m.recordResourceObservation(observation({ resourceRevision: 3, observedAt: new Date().toISOString() }));
  assert.equal(m.getResourceObservation(scope()).status, 'CURRENT');
  assert.throws(() => m.recordResourceObservation(old), /RESOURCE_REVISION_CONFLICT/);
}));

test('corrupt latest evidence fails closed without falling back to older success', async () => fixture(async (open, file) => {
  const m = open(); m.saveResources(catalog(), 0); m.recordResourceObservation(observation());
  const db = new DatabaseSync(file);
  try { db.prepare('UPDATE resource_observations SET digest=?').run('0'.repeat(64)); } finally { db.close(); }
  assert.throws(() => m.getResourceObservation(scope()), /CORRUPT_RESOURCE_OBSERVATION/);
  assert.throws(() => m.recordResourceObservation(observation()), /CORRUPT_RESOURCE_OBSERVATION/);
}));

test('partial and unknown observation schemas fail closed', async () => fixture(async (open, file) => {
  const m = open(); m.saveResources(catalog(), 0); const db = new DatabaseSync(file);
  try {
    db.exec('CREATE TABLE resource_observation_schema(version INTEGER PRIMARY KEY) STRICT; INSERT INTO resource_observation_schema VALUES(99)');
    assert.throws(() => m.getResourceObservation(scope()), /UNSUPPORTED_RESOURCE_OBSERVATION_SCHEMA/);
    assert.throws(() => m.recordResourceObservation(observation()), /UNSUPPORTED_RESOURCE_OBSERVATION_SCHEMA/);
    db.exec('CREATE TABLE resource_observations(sequence INTEGER PRIMARY KEY, scope_key TEXT, digest TEXT, body TEXT) STRICT');
    assert.throws(() => m.getResourceObservation(scope()), /UNSUPPORTED_RESOURCE_OBSERVATION_SCHEMA/);
  } finally { db.close(); }
}));
