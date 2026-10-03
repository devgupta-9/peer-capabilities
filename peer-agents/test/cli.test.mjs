import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const bin = fileURLToPath(new URL('../bin/peer-capabilities.mjs', import.meta.url));
test('CLI help and Node version guard work before opening state', async () => {
  const result = spawnSync(process.execPath, [bin, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /setup/);
  const { requireNode24 } = await import('../bin/peer-capabilities.mjs');
  assert.throws(() => requireNode24('20.10.0'), /Node.*24/);
  assert.doesNotThrow(() => requireNode24('24.0.0'));
});

test('agent-accessible CLI cannot turn terminal confirmation into human approval', () => {
  const result = spawnSync(process.execPath, [bin, 'integrate'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /not proof of human approval/);
});
test('CLI manifest setup, doctor and uninstall share the ownership engine', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'peer-cli-'));
  try {
    const manifest = path.join(dir, 'manifest.json');
    const content = 'Local engineering policy';
    await writeFile(manifest, JSON.stringify({ schemaVersion: 1, components: [{
      id: 'policy', kind: 'managed-file', optional: false, recipe: 'managed-file', version: '1',
      destination: 'AGENTS.md', content, integrity: 'sha256:' + createHash('sha256').update(content).digest('hex'),
    }] }));
    const call = (...args) => spawnSync(process.execPath, [bin, ...args, '--manifest', manifest, '--root', path.join(dir, 'managed'), '--state-dir', path.join(dir, 'state')], { encoding: 'utf8' });
    const setup = call('setup', '--apply'); assert.equal(setup.status, 0, setup.stderr);
    assert.equal(await readFile(path.join(dir, 'managed/AGENTS.md'), 'utf8'), content);
    const doctor = call('doctor'); assert.equal(doctor.status, 0, doctor.stderr);
    assert.equal(JSON.parse(doctor.stdout).components[0].verification, 'VERIFIED');
    assert.equal(call('uninstall', '--apply').status, 0);
    await assert.rejects(readFile(path.join(dir, 'managed/AGENTS.md')));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
