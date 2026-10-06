import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('CI runner stops on an earlier native failure even if a later command would succeed', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'peer-ci-'));
  try {
    const script = path.join(dir, 'fixture.ps1');
    const node = process.execPath.replaceAll("'", "''");
    await writeFile(script, `& '${node}' -e 'process.exit(7)'\n& '${node}' -e 'console.log("MASKED")'\n`);
    const runner = fileURLToPath(new URL('../../scripts/ci-step.ps1', import.meta.url));
    const result = spawnSync('pwsh', ['-NoProfile', '-File', runner, script], { encoding: 'utf8' });
    assert.ifError(result.error);
    assert.equal(result.status, 7, result.stderr);
    assert.ok(!result.stdout.includes('MASKED'));
    await writeFile(script, `& '${node}' -e 'process.exit(0)'\n`);
    assert.equal(spawnSync('pwsh', ['-NoProfile', '-File', runner, script]).status, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('workflow native commands remain separate or use the checked block runner', async () => {
  const workflow = await readFile(new URL('../../.github/workflows/verify.yml', import.meta.url), 'utf8');
  const steps = workflow.split(/^      - /m).slice(1);
  for (const step of steps) {
    const nativeLines = step.match(/(?:^|\n)\s*(?:run:\s*)?(?:npm|node|python|git)\s+[^\n]+/g) ?? [];
    assert.ok(nativeLines.length <= 1 || step.includes('shell: pwsh -NoProfile -File scripts/ci-step.ps1 {0}'), 'unchecked native command block');
  }
  assert.ok(!workflow.includes('continue-on-error: true'));
  assert.match(workflow, /shell: pwsh\r?\n/); // built-in Actions wrapper propagates the final native exit
});
