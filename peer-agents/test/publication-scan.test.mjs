import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { secretCanaries } from './fixtures/secret-canaries.mjs';
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
    const current = spawnSync(process.execPath, [script, '--root', dir], { encoding: 'utf8' });
    assert.equal(current.status, 0, current.stdout);
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

test('publication scanner uses the complete canary corpus without leaking values', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'peer-corpus-'));
  const script = fileURLToPath(new URL('../../scripts/secret-scan.mjs', import.meta.url));
  try {
    execFileSync('git', ['init', dir], { stdio: 'pipe' });
    const samples = secretCanaries();
    for (const [index, sample] of samples.entries()) await writeFile(path.join(dir, index + '.txt'), sample.text);
    for (const extension of ['ppk', 'jks', 'keystore']) await writeFile(path.join(dir, 'fixture.' + extension), 'not real key material');
    const result = spawnSync(process.execPath, [script, '--root', dir], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    const findings = JSON.parse(result.stdout).findings;
    for (const [index, sample] of samples.entries()) {
      assert.ok(findings.some(f => f.file === index + '.txt'), sample.name);
      assert.ok(!(result.stdout + result.stderr).includes(sample.secret), sample.name);
    }
    assert.equal(findings.filter(f => f.category === 'forbidden_filename').length, 3);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('history scan refuses shallow history instead of reporting a clean partial scan', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'peer-shallow-'));
  const script = fileURLToPath(new URL('../../scripts/secret-scan.mjs', import.meta.url));
  try {
    const source = path.join(dir, 'source'), clone = path.join(dir, 'clone');
    execFileSync('git', ['init', source], { stdio: 'pipe' });
    const git = (...args) => execFileSync('git', ['-C', source, ...args], { stdio: 'pipe' });
    git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
    await writeFile(path.join(source, 'fixture.txt'), 'gh' + 'p_' + 'a'.repeat(35));
    git('add', '.'); git('commit', '-m', 'synthetic fixture');
    await writeFile(path.join(source, 'fixture.txt'), 'clean'); git('add', '.'); git('commit', '-m', 'removed');
    execFileSync('git', ['clone', '--depth=1', pathToFileURL(source).href, clone], { stdio: 'pipe' });
    const result = spawnSync(process.execPath, [script, '--root', clone, '--history'], { encoding: 'utf8' });
    assert.equal(result.status, 2); assert.match(result.stdout, /incomplete/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
