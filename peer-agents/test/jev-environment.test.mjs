import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('Jev launcher forwards only named credentials, prefers process scope and reports presence without values', { skip: process.platform !== 'win32' }, () => {
  const script = fileURLToPath(new URL('../scripts/start-jev.ps1', import.meta.url)).replaceAll("'", "''");
  const run = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', `
    . '${script}'
    $read = { param($name,$scope)
      if($name -eq 'TYPESAFE_API_KEY') { if($scope -eq 'Process') { 'fixture-process' } else { 'fixture-user' } }
      elseif($name -eq 'OPENROUTER_API_KEY' -and $scope -eq 'User') { 'fixture-other' }
      elseif($name -eq 'PATH') { 'fixture-path' }
      elseif($name -eq 'JEV_MCP_MODEL') { 'fixture-pinned-model' }
      elseif($name -eq 'UNRELATED_SECRET') { throw 'Unrelated credential was read' }
    }
    $envs = Get-JevEnvironment -Read $read
    if($envs.TYPESAFE_API_KEY -ne 'fixture-process') { throw 'Precedence' }
    if($envs.OPENROUTER_API_KEY -ne 'fixture-other') { throw 'User fallback' }
    if($envs.JEV_MCP_MODEL -ne 'fixture-pinned-model') { throw 'Model pin was dropped' }
    if($envs.ContainsKey('UNRELATED_SECRET')) { throw 'Leak' }
    'PASS'
  `], { encoding: 'utf8', timeout: 20000, windowsHide: true });
  assert.equal(run.status, 0, run.stderr); assert.equal(run.stdout.trim(), 'PASS');
});
test('Jev launcher forwards stdio without corrupting MCP framing or inheriting unrelated secrets', { skip: process.platform !== 'win32' }, t => {
  const root = mkdtempSync(path.join(tmpdir(), 'peer-jev-stdio-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const entry = path.join(root, 'fixture.mjs');
  writeFileSync(entry, `process.stdin.once('data', chunk => { process.stdout.write(JSON.stringify({input:chunk.toString().trim(), unexpected:Boolean(process.env.UNRELATED_SECRET)})+'\\n'); process.exit(0); });`);
  const script = fileURLToPath(new URL('../scripts/start-jev.ps1', import.meta.url));
  const run = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', script, '-NodePath', process.execPath, '-EntryPath', entry], {
    input: '{"jsonrpc":"2.0","id":1}\n', encoding: 'utf8', timeout: 15000, windowsHide: true,
    env: { ...process.env, UNRELATED_SECRET: 'synthetic-canary-not-a-real-key' },
  });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout), { input: '{"jsonrpc":"2.0","id":1}', unexpected: false });
});
