import { test } from 'node:test';
import assert from 'node:assert/strict';
const load = () => import('../dist/runtime/adapters.js');

test('Codex reviews require a completed turn and reject failed, unfinished, or malformed streams', async () => {
  const { ProviderAdapter } = await load();
  const message = { type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify({ outcome: 'APPROVE', findings: [] }) } };
  const completed = { type: 'turn.completed', usage: {} };
  const choice = { agent: 'codex', model: 'fixture-model', effort: 'high', efforts: ['high'], authentication: 'AUTHENTICATED', availability: 'AVAILABLE' };
  for (const [events, expected] of [
    [[message, completed], 'AVAILABLE'],
    [[message, { type: 'turn.failed', error: { message: 'fixture failure' } }], 'EXECUTION_ERROR'],
    [[message], 'EXECUTION_ERROR'],
    [[message, { type: 'error', message: 'fixture failure' }, completed], 'EXECUTION_ERROR'],
    [[message, completed, { type: 'turn.started' }], 'EXECUTION_ERROR'],
    [[message, completed, 'malformed'], 'EXECUTION_ERROR'],
  ]) {
    const capture = async () => ({ code: 0, timedOut: false, cancelled: false, stdoutTruncated: false, stderrTruncated: false,
      stdout: events.map(event => typeof event === 'string' ? event : JSON.stringify(event)).join('\n'), stderr: '' });
    const adapter = new ProviderAdapter({ id: 'codex', executable: process.execPath, experimental: true }, undefined, capture);
    adapter.discover = async () => ({ observation: {}, choices: [choice] });
    const result = await adapter.execute({ id: 'review', taskId: 'fixture', cwd: process.cwd(), role: 'reviewer', choice, prompt: 'Review fixture' });
    assert.equal(result.availability, expected, JSON.stringify(events));
    assert.equal(result.review?.outcome, expected === 'AVAILABLE' ? 'APPROVE' : undefined);
  }
});
test('provider adapters build exact selections without argv prompts and normalize failure states', async () => {
  const api = await load().catch(() => ({}));
  assert.equal(typeof api.providerCommand, 'function');
  const input = { cwd: '/fixture', role: 'lead', choice: { model: 'exact-model', effort: 'high' }, prompt: 'large '.repeat(12000) };
  const codex = api.providerCommand('codex', input);
  assert.equal(codex.input, input.prompt);
  assert.ok(codex.args.includes('exact-model'));
  assert.ok(!codex.args.includes(input.prompt));
  const agy = api.providerCommand('antigravity', input);
  assert.ok(!agy.args.includes(input.prompt));
  assert.equal(JSON.parse(agy.input).message.content, input.prompt);
  assert.equal(api.normalizeFailure('quota exhausted', false), 'QUOTA_EXHAUSTED');
  assert.equal(api.normalizeFailure('please login', false), 'AUTH_REQUIRED');
  assert.equal(api.normalizeFailure('something else', true), 'TIMEOUT');
});
test('installed provider without authentication evidence remains unknown and unverified', async () => {
  const { ProviderAdapter } = await load();
  const adapter = new ProviderAdapter({
    id: 'antigravity', executable: process.execPath,
    profiles: [{ model: 'exact-model', effort: 'high', competence: 9, cost: 1, contextWindow: 100000 }],
  });
  const discovered = await adapter.discover();
  assert.equal(discovered.observation.presence, 'INSTALLED');
  assert.equal(discovered.observation.authentication, 'UNKNOWN');
  assert.equal(discovered.observation.verification, 'UNVERIFIED');
  assert.equal(discovered.choices.length, 0, 'models not in fresh discovery must not be invented');
});

test('version-scoped authentication evidence survives fresh adapters without extending its expiry', async () => {
  const { ProviderAdapter } = await load();
  const capture = async (_command, args) => ({
    code: 0, stderr: '', stdoutTruncated: false, stderrTruncated: false, timedOut: false, cancelled: false, durationMs: 1,
    stdout: args[0] === '--version' ? 'fixture-cli 1.0' : args[0] === 'models' ? 'fixture-high'
      : JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'PEER_OK' } }),
  });
  const config = { id: 'antigravity', executable: process.execPath, experimental: true,
    profiles: [{ model: 'fixture-high', effort: 'high', competence: 9, cost: 1, contextWindow: 50000 }] };
  const verified = await new ProviderAdapter(config, undefined, capture).verify(process.cwd());
  assert.equal(verified.verification, 'VERIFIED');
  const next = await new ProviderAdapter(config, verified, capture).discover();
  assert.equal(next.observation.authentication, 'AUTHENTICATED');
  assert.equal(next.observation.expiresAt, verified.expiresAt);
  assert.equal((await new ProviderAdapter(config, next.observation, capture).discover()).observation.authentication, 'AUTHENTICATED');
  const expired = { ...verified, expiresAt: '2020-01-01T00:00:00.000Z' };
  assert.equal((await new ProviderAdapter(config, expired, capture).discover()).observation.authentication, 'UNKNOWN');
});
