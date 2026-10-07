import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
const load = () => import('../scripts/doctor-antigravity.mjs');
const digest = value => createHash('sha256').update(value).digest('hex');

test('readiness requires observed file and command tools, not a model success claim', async () => {
  const { assessDelegation } = await load();
  const file = path.resolve('fixture.txt');
  const expected = { file, cwd: path.dirname(file), gitRoot: path.dirname(file), nonce: 'fixture-proof', model: 'fixture-high', effort: 'high' };
  const payload = { ok: true, model: 'fixture-high', effort: 'high', response: 'fixture-proof',
    antigravityToolFailures: [], antigravityToolEvidence: [
      { tool: 'view_file', pathHash: digest(process.platform === 'win32' ? file.toLowerCase() : file) },
      { tool: 'run_command', commandHash: digest('git status --short'), cwdHash: digest(process.platform === 'win32' ? expected.cwd.toLowerCase() : expected.cwd) },
      { tool: 'run_command', commandHash: digest('git rev-parse --show-toplevel'),
        cwdHash: digest(process.platform === 'win32' ? expected.cwd.toLowerCase() : expected.cwd),
        gitRootHash: digest(process.platform === 'win32' ? expected.gitRoot.toLowerCase() : expected.gitRoot) },
    ] };
  assert.equal(assessDelegation(payload, expected).verification, 'VERIFIED');
  for (const altered of [
    { ...payload, antigravityToolEvidence: [] },
    { ...payload, response: 'Everything worked' },
    { ...payload, model: 'other-model' },
    { ...payload, ok: false },
    { ...payload, policyViolation: 'modified workspace' },
    { ...payload, antigravityToolEvidence: payload.antigravityToolEvidence.slice(0, 1) },
    { ...payload, antigravityToolEvidence: [payload.antigravityToolEvidence[0],
      { tool: 'run_command', commandHash: digest('git status --short') }, payload.antigravityToolEvidence[2]] },
    { ...payload, antigravityToolEvidence: [payload.antigravityToolEvidence[0],
      { tool: 'run_command', commandHash: digest('git status --short'), cwdHash: digest('wrong repository') }, payload.antigravityToolEvidence[2]] },
    { ...payload, antigravityToolEvidence: payload.antigravityToolEvidence.slice(0, 2) },
    { ...payload, antigravityToolEvidence: [...payload.antigravityToolEvidence.slice(0, 2),
      { ...payload.antigravityToolEvidence[2], gitRootHash: digest('wrong repository') }] },
    { ...payload, antigravityToolFailures: [{ tool: 'run_command', message: 'failed' }] },
  ]) assert.notEqual(assessDelegation(altered, expected).verification, 'VERIFIED');
});

test('readiness distinguishes provider login and policy failures without exporting diagnostics', async () => {
  const { assessDelegation } = await load();
  const expected = { file: path.resolve('fixture.txt'), cwd: process.cwd(), nonce: 'proof', model: 'fixture-high', effort: 'high' };
  const auth = assessDelegation({ ok: false, error: 'please login' }, expected);
  assert.equal(auth.authentication, 'AUTH_REQUIRED');
  assert.match(auth.nextAction, /official.*login|interactive agy/i);
  const denied = assessDelegation({ ok: false, error: 'blocked by a required permission; private diagnostic' }, expected);
  assert.equal(denied.availability, 'POLICY_BLOCKED');
  assert.ok(!JSON.stringify(denied).includes('private diagnostic'));
});

test('live readiness cleans up its generated proof on success and provider failure', async () => {
  const { doctorAntigravity } = await load();
  const dir = await mkdtemp(path.join(tmpdir(), 'peer-doctor-'));
  try {
    for (const fail of [false, true]) {
      const bridgeCall = async (tool, args) => {
        if (tool === 'peer_capabilities') return { content: [{ type: 'text', text: JSON.stringify({
          workspace: { ready: true, cwd: dir, gitRoot: dir }, antigravity: { available: true, version: 'fixture',
            models: ['fixture-high'], efforts: ['high'], sandboxMode: 'required' },
        }) }] };
        assert.equal(args.mode, 'READ_ONLY');
        if (fail) throw new Error('simulated provider disconnect');
        const [fixture] = await readdir(dir);
        const file = path.join(dir, fixture, 'proof.txt');
        const proof = (await readFile(file, 'utf8')).trim();
        assert.ok(!args.task.includes(proof), 'proof must be obtained by reading, never supplied in prompt');
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true, model: args.model, effort: args.effort,
          response: proof, antigravityToolFailures: [], antigravityToolEvidence: [
            { tool: 'view_file', pathHash: digest(process.platform === 'win32' ? file.toLowerCase() : file) },
            { tool: 'run_command', commandHash: digest('git status --short'), cwdHash: digest(process.platform === 'win32' ? dir.toLowerCase() : dir) },
            { tool: 'run_command', commandHash: digest('git rev-parse --show-toplevel'),
              cwdHash: digest(process.platform === 'win32' ? dir.toLowerCase() : dir),
              gitRootHash: digest(process.platform === 'win32' ? dir.toLowerCase() : dir) },
          ] }) }] };
      };
      const run = doctorAntigravity({ cwd: dir, model: 'fixture-high', effort: 'high', verify: true }, bridgeCall);
      if (fail) await assert.rejects(run, /provider disconnect/);
      else assert.equal((await run).verification, 'VERIFIED');
      assert.deepEqual(await readdir(dir), []);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
