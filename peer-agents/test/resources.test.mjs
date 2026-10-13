import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateResources, resolveResource } from '../dist/runtime/resources.js';

const fixture = () => ({
  schemaVersion: 1,
  providers: [{ id: 'provider-a' }, { id: 'provider-b' }],
  frontends: [{ id: 'frontend-a' }, { id: 'frontend-b' }],
  accounts: [{ id: 'account-a', providerId: 'provider-a', policy: 'ACTIVE' }],
  authContexts: [{ id: 'auth-a', accountId: 'account-a', frontendId: 'frontend-a', handle: 'provider-owned-profile' }],
  quotaPools: [{ id: 'shared', accountId: 'account-a' }],
  models: [{ id: 'model-a', providerId: 'provider-a', model: 'exact-model', efforts: ['high'], contextWindow: 32000 }],
  bindings: [{ id: 'binding-a', modelId: 'model-a', authContextId: 'auth-a', quotaPoolId: 'shared', enabled: true }],
  profiles: [{ id: 'profile-a', roles: ['lead', 'reviewer'], features: ['read', 'isolated-edit'], competence: 8 }],
  workers: [{ id: 'worker-a', frontendId: 'frontend-a', authContextId: 'auth-a', profileId: 'profile-a', enabled: true }],
});
const contract = () => ({ schemaVersion: 1, role: 'reviewer', features: ['read'], minimumCompetence: 7, requiredContext: 16000, effort: 'high' });

test('resolves an exact resource without conflating frontend, provider, account or quota pool', () => {
  const resources = validateResources(fixture());
  const resolved = resolveResource(resources, { workerId: 'worker-a', bindingId: 'binding-a' }, contract());
  assert.equal(resolved.provider.id, 'provider-a');
  assert.equal(resolved.frontend.id, 'frontend-a');
  assert.equal(resolved.account.id, 'account-a');
  assert.equal(resolved.quotaPool.id, 'shared');
  assert.equal(resolved.model.model, 'exact-model');
  assert.equal(resolved.authContext.handle, 'provider-owned-profile');
});

test('multiple frontends can share one account quota pool without inventing new capacity', () => {
  const data = fixture();
  data.authContexts.push({ id: 'auth-b', accountId: 'account-a', frontendId: 'frontend-b', handle: 'other-provider-profile' });
  data.bindings.push({ ...data.bindings[0], id: 'binding-b', authContextId: 'auth-b' });
  data.workers.push({ ...data.workers[0], id: 'worker-b', frontendId: 'frontend-b', authContextId: 'auth-b' });
  const second = resolveResource(data, { workerId: 'worker-b', bindingId: 'binding-b' }, contract());
  assert.equal(second.quotaPool.id, 'shared');
  assert.throws(() => resolveResource(data, { workerId: 'worker-a', bindingId: 'binding-b' }, contract()), /RESOURCE_BINDING_MISMATCH/);
});

test('rejects duplicate, dangling and cross-provider/account references', () => {
  for (const mutate of [
    d => d.accounts.push({ ...d.accounts[0] }),
    d => { d.bindings[0].quotaPoolId = 'missing'; },
    d => { d.models[0].providerId = 'provider-b'; },
    d => { d.workers[0].frontendId = 'frontend-b'; },
    d => { d.accounts.push({ id: 'account-b', providerId: 'provider-a', policy: 'ACTIVE' }); d.quotaPools[0].accountId = 'account-b'; },
  ]) { const data = fixture(); mutate(data); assert.throws(() => validateResources(data), /INVALID_RESOURCE_CATALOG/); }
});

test('does not silently select a different resource or unlock reserved capacity', () => {
  for (const policy of ['RESERVE', 'EMERGENCY_ONLY', 'MANUAL_ONLY', 'DISABLED']) {
    const data = fixture(); data.accounts[0].policy = policy;
    assert.throws(() => resolveResource(data, { workerId: 'worker-a', bindingId: 'binding-a' }, contract()), /RESOURCE_POLICY_BLOCKED/);
  }
  for (const field of ['workers', 'bindings']) {
    const data = fixture(); data[field][0].enabled = false;
    assert.throws(() => resolveResource(data, { workerId: 'worker-a', bindingId: 'binding-a' }, contract()), /RESOURCE_POLICY_BLOCKED/);
  }
  assert.throws(() => resolveResource(fixture(), { workerId: 'missing', bindingId: 'binding-a' }, contract()), /RESOURCE_NOT_FOUND/);
});

test('requires exact effort, sufficient context, competence and all requested capabilities', () => {
  for (const change of [{ effort: 'low' }, { role: 'specialist' }, { features: ['deploy'] }, { requiredContext: 32001 }, { minimumCompetence: 9 }]) {
    assert.throws(() => resolveResource(fixture(), { workerId: 'worker-a', bindingId: 'binding-a' }, { ...contract(), ...change }), /CAPABILITY_MISMATCH/);
  }
});

test('rejects secret fields, unknown schema and malformed contracts without echoing input', () => {
  const data = fixture(); data.authContexts[0][['pass', 'word'].join('')] = ['synthetic', 'private', 'value'].join('-');
  assert.throws(() => validateResources(data), e => e.message === 'INVALID_RESOURCE_CATALOG');
  assert.throws(() => validateResources({ ...fixture(), schemaVersion: 2 }), /INVALID_RESOURCE_CATALOG/);
  assert.throws(() => resolveResource(fixture(), { workerId: 'worker-a', bindingId: 'binding-a' }, { ...contract(), requiredContext: -1 }), /INVALID_CAPABILITY_CONTRACT/);
});

test('one frontend can serve distinct provider accounts with explicit bindings', () => {
  const data = fixture();
  data.accounts.push({ id: 'account-b', providerId: 'provider-b', policy: 'ACTIVE' });
  data.authContexts.push({ id: 'auth-b', accountId: 'account-b', frontendId: 'frontend-a', handle: 'provider-b-profile' });
  data.quotaPools.push({ id: 'pool-b', accountId: 'account-b' });
  data.models.push({ ...data.models[0], id: 'model-b', providerId: 'provider-b' });
  data.bindings.push({ id: 'binding-b', modelId: 'model-b', authContextId: 'auth-b', quotaPoolId: 'pool-b', enabled: true });
  data.workers.push({ ...data.workers[0], id: 'worker-b', authContextId: 'auth-b' });
  const result = resolveResource(data, { workerId: 'worker-b', bindingId: 'binding-b' }, contract());
  assert.equal(result.frontend.id, 'frontend-a');
  assert.equal(result.provider.id, 'provider-b');
  assert.equal(result.account.id, 'account-b');
  assert.equal(result.quotaPool.id, 'pool-b');
  assert.equal('authenticated' in result, false, 'Metadata must not manufacture authentication evidence');
});

test('invalid IDs, credential paths and unknown fields cannot be carried as opaque auth metadata', () => {
  for (const handle of ['../auth.json', ['https://user', ':', 'password', '@example.test'].join(''), '', 'a'.repeat(129)]) {
    const data = fixture(); data.authContexts[0].handle = handle;
    assert.throws(() => validateResources(data), /INVALID_RESOURCE_CATALOG/);
  }
  const data = fixture(); data.authContexts[0].authenticated = true;
  assert.throws(() => validateResources(data), /INVALID_RESOURCE_CATALOG/);
});
