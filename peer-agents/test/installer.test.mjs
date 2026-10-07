import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('installer preserves project roots and explicit sandbox choices', { skip: process.platform !== 'win32' }, () => {
  execFileSync('pwsh', ['-NoProfile', '-File', fileURLToPath(new URL('../../scripts/test-peer-roots.ps1', import.meta.url))], { stdio: 'pipe' });
});

test('fresh Antigravity settings initialize safely under strict mode', { skip: process.platform !== 'win32' }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'peer-settings-'));
  try {
    const installer = fileURLToPath(new URL('../../install.ps1', import.meta.url));
    execFileSync('pwsh', ['-NoProfile', '-Command', `
      $ErrorActionPreference='Stop'
      Set-StrictMode -Version Latest
      $userRoot=$env:TEST_FIXTURE
      $installBackup=Join-Path $userRoot 'backup'
      $DryRun=$false
      $GrantAntigravityInspection=$false
      $ast=[System.Management.Automation.Language.Parser]::ParseFile($env:TEST_INSTALLER,[ref]$null,[ref]$null)
      $names=@('Backup-LocalConfig','Read-JsonHashtable','Write-JsonHashtable','Set-AntigravitySafetySettings')
      foreach ($fn in $ast.FindAll({param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst]},$false)) {
        if($fn.Name -in $names){ Invoke-Expression $fn.Extent.Text }
      }
      Set-AntigravitySafetySettings
      $initial=Get-Content (Join-Path $userRoot '.gemini/antigravity-cli/settings.json') -Raw | ConvertFrom-Json
      if (@($initial.permissions.allow).Count -ne 0) { throw 'Default setup granted command execution' }
      $GrantAntigravityInspection=$true
      Set-AntigravitySafetySettings
      Set-AntigravitySafetySettings
    `], { env: { ...process.env, TEST_FIXTURE: dir, TEST_INSTALLER: installer }, stdio: 'pipe' });
    const value = JSON.parse(await readFile(path.join(dir, '.gemini/antigravity-cli/settings.json'), 'utf8'));
    assert.equal(value.permissions.deny.length, 1);
    const allows = value.permissions.allow.map(rule => new RegExp(rule.slice(rule.indexOf('regex:') + 6, -1)));
    assert.ok(value.permissions.allow.includes('unsandboxed(regex:^git status --short$)'));
    for (const command of ['git status --short', 'git diff --stat', 'git rev-parse --show-toplevel']) {
      assert.ok(allows.some(rule => rule.test(command)), command);
    }
    for (const command of ['git push', 'git status --short; git push', 'git diff --output=important.txt',
      'git -c core.pager=malicious diff', 'git status $(whoami)']) {
      assert.ok(!allows.some(rule => rule.test(command)), command);
    }
    const rule = value.permissions.deny[0].slice('command(regex:'.length, -1);
    for (const command of ['git push', 'git -C repo push', 'git.exe --git-dir=x reset', 'git commit']) {
      assert.match(command, new RegExp(rule, 'i'));
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
