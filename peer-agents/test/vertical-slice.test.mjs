import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const driver = fileURLToPath(new URL('./fixtures/slice-driver.mjs', import.meta.url));
test('restartable CLI workflow supports quota degradation and single-agent without optional integrations', async () => {
  const runner = await import('../dist/runtime/runner.js').catch(() => ({}));
  assert.equal(typeof runner.Runtime, 'function');
  for (const single of [false, true]) {
    for (const disabled of [['graphify'], ['headroom'], ['jev'], ['graphify', 'headroom', 'jev']]) {
      const directory = await mkdtemp(path.join(tmpdir(), 'peer-slice-'));
      const root = path.join(directory, 'repo');
      try {
        execFileSync('git', ['init', root], { stdio: 'pipe' });
        const git = (...args) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' });
        git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid'); git('config', 'core.autocrlf', 'false');
        await writeFile(path.join(root, 'answer.txt'), 'wrong\n');
        git('add', '.'); git('commit', '-m', 'base');
        const call = (...args) => JSON.parse(execFileSync(process.execPath, [driver, root, String(single), disabled.join(','), ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
        const first = call('start');
        assert.equal(first.status, 'CHECKPOINTED');
        assert.equal(await readFile(path.join(root, 'answer.txt'), 'utf8'), 'wrong\n');
        const resumed = call('resume', first.id);
        assert.equal(resumed.status, 'READY');
        const integrated = call('integrate', first.id);
        assert.equal(integrated.status, 'COMPLETE');
        assert.equal(await readFile(path.join(root, 'answer.txt'), 'utf8'), '42\n');
        assert.equal(integrated.report.independentReview, false);
        assert.equal(integrated.report.degraded, true);
        assert.equal(integrated.report.tests.length, 2);
        assert.equal(integrated.report.humanDecisions[0].actor, 'test-harness');
        assert.ok(integrated.report.limitations.length);
      } finally { await rm(directory, { recursive: true, force: true }); }
    }
  }
});
