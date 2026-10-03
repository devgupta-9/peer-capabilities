import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
test('publication scanner reads staged blobs and catches secrets removed from current history', async () => {
  const script = fileURLToPath(new URL('../../scripts/secret-scan.mjs', import.meta.url));
  const dir = await mkdtemp(path.join(tmpdir(), 'peer-scan-'));
  try {
    const git = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' });
    git('init'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
    const token = 'gh' + 'p_' + 'a'.repeat(35);
    await writeFile(path.join(dir, 'fixture.txt'), token);
    git('add', '.');
    await writeFile(path.join(dir, 'fixture.txt'), 'clean working copy');
    const staged = spawnSync(process.execPath, [script, '--root', dir, '--staged'], { encoding: 'utf8' });
    assert.equal(staged.status, 1);
    assert.match(staged.stdout, /github_token/);
    assert.ok(!staged.stdout.includes(token));
    git('commit', '-m', 'staged secret fixture');
    git('add', '.'); git('commit', '-m', 'removed from current tree');
    const history = spawnSync(process.execPath, [script, '--root', dir, '--history'], { encoding: 'utf8' });
    assert.equal(history.status, 1);
    assert.match(history.stdout, /github_token/);
    assert.ok(!history.stdout.includes(token));
    await writeFile(path.join(dir, 'settings.json'), JSON.stringify({ password: ['opaque', 'fixture', 'value', '123456'].join('-') }));
    const jsonResult = spawnSync(process.execPath, [script, '--root', dir], { encoding: 'utf8' });
    assert.equal(jsonResult.status, 1);
    assert.match(jsonResult.stdout, /assigned_secret/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
