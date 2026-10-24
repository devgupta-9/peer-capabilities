import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { spawnSync, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { bridgeSession } from './fixtures/bridge-session.mjs';

test('installed npm artifact uses tested runtime dependencies and authorizes legacy and modern host roots', { timeout: 120000 }, async () => {
  assert.ok(process.env.npm_execpath, 'Run through npm test so its npm CLI is available');
  const root = fileURLToPath(new URL('../', import.meta.url));
  const base = await mkdtemp(path.join(tmpdir(), 'peer-package-'));
  const npm = (...args) => {
    const result = spawnSync(process.execPath, [process.env.npm_execpath, ...args], { cwd: root, encoding: 'utf8', timeout: 60000 });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  try {
    const packed = JSON.parse(npm('pack', '--ignore-scripts', '--pack-destination', base, '--json'));
    const artifact = (Array.isArray(packed) ? packed : Object.values(packed))[0];
    const prefix = path.join(base, 'installed');
    npm('install', '--prefix', prefix, path.join(base, artifact.filename), '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund');
    const installed = path.join(prefix, 'node_modules/@devgupta/peer-capabilities');
    const requireInstalled = createRequire(path.join(installed, 'package.json'));
    const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
    assert.ok(existsSync(path.join(installed, 'scripts/start-jev.ps1')), 'Jev launcher must be in the npm artifact');
    assert.ok(existsSync(path.join(installed, 'dist/host-configuration-cli.js')), 'Host reconciler must be in the npm artifact');
    for (const name of ['@modelcontextprotocol/server', 'zod', 'smol-toml']) {
      let directory = path.dirname(requireInstalled.resolve(name));
      let manifest;
      while (directory !== path.dirname(directory)) {
        const candidate = path.join(directory, 'package.json');
        if (existsSync(candidate)) {
          const value = JSON.parse(readFileSync(candidate, 'utf8'));
          if (value.name === name) { manifest = value; break; }
        }
        directory = path.dirname(directory);
      }
      assert.equal(manifest?.version, lock.packages[`node_modules/${name}`].version, `Installed ${name} drifted from tested lock`);
    }
    const repo = path.join(base, 'project'); await mkdir(repo); execFileSync('git', ['init', '-q', repo]);
    for (const modern of [false, true]) {
      const bridge = await bridgeSession(base, { PEER_AGENTS_WORKSPACE_REGISTRY: path.join(base, 'control/environment.sqlite') }, [repo], modern, path.join(installed, 'dist/index.js'), modern);
      try {
        const result = await bridge.call('peer_capabilities', { cwd: repo });
        assert.equal(result.workspace.ready, true);
        assert.equal(result.workspace.authorizationSource, 'HOST_ROOTS');
      } finally { await bridge.close(); }
    }
  } finally { await rm(base, { recursive: true, force: true }); }
});
