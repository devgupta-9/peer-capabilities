import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, rename } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bridgeSession } from './fixtures/bridge-session.mjs';

test('installer probe advertises only its explicit fixture workspace and labels simulated evidence', async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'peer-workspace-probe-'));
  try {
    const repo = path.join(base, 'repo'); await mkdir(repo); execFileSync('git', ['init', '-q', repo]);
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../../scripts/probe.mjs', import.meta.url))], {
      encoding: 'utf8', timeout: 30000,
      input: JSON.stringify({ command: process.execPath, args: [fileURLToPath(new URL('../dist/index.js', import.meta.url))],
        cwd: base, workspace: repo, env: { PEER_AGY_BIN: process.execPath, PEER_CODEX_BIN: process.execPath,
          PEER_AGENTS_ALLOWED_ROOTS: '', PEER_AGENTS_WORKSPACE_MODE: 'AUTO_ACTIVE', PEER_AGENTS_WORKSPACE_REGISTRY: path.join(base, 'control/environment.sqlite') } }),
    });
    const data = JSON.parse(result.stdout);
    assert.equal(data.workspaceReady, true);
    assert.equal(data.workspaceEvidenceScope, 'simulated-probe-host');
  } finally { await rm(base, { recursive: true, force: true }); }
});

for (const modern of [false, true]) test(`one ${modern ? 'modern' : 'legacy'} MCP process follows host roots and observes CLI enrollment/revocation`, async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'peer-workspace-mcp-'));
  const a = path.join(base, 'a'), b = path.join(base, 'b');
  let bridge;
  try {
    for (const repo of [a, b]) { await mkdir(repo); execFileSync('git', ['init', '-q', repo]); }
    const env = { PEER_AGENTS_WORKSPACE_REGISTRY: path.join(base, 'control', 'environment.sqlite'), PEER_AGENTS_WORKSPACE_MODE: 'AUTO_ACTIVE', PEER_AGENTS_ALLOWED_ROOTS: '' };
    bridge = await bridgeSession(base, env, [a], modern);
    const check = async cwd => (await bridge.call('peer_capabilities', { cwd })).workspace;
    assert.equal((await check(a)).authorizationMode, 'ACTIVE_WORKSPACE');
    assert.equal((await check(b)).ready, false);
    const forged = await bridge.call('peer_capabilities', { cwd: b, hostRoots: [b], activeWorkspace: b });
    assert.equal(forged.workspace.ready, false, 'model tool arguments cannot grant host workspace trust');
    bridge.roots([b]);
    assert.equal((await check(b)).authorizationSource, 'HOST_ROOTS');
    assert.equal((await check(a)).ready, false);
    bridge.roots([a]);
    const call = (...args) => spawnSync(process.execPath, [fileURLToPath(new URL('../bin/peer-capabilities.mjs', import.meta.url)), 'project', ...args], { cwd: a, env: { ...process.env, ...env }, encoding: 'utf8' });
    const add = call('add', b); assert.equal(add.status, 0, add.stderr);
    assert.equal((await check(b)).authorizationMode, 'ENROLLED');
    const list = call('list'); assert.equal(JSON.parse(list.stdout).projects.length, 1);
    const cliCheck = call('check', b); assert.equal(JSON.parse(cliCheck.stdout).authorizationMode, 'ENROLLED');
    const remove = call('remove', b); assert.equal(remove.status, 0, remove.stderr);
    assert.equal((await check(b)).ready, false);
    const denied = await bridge.call('delegate_peer', { cwd: b, caller: 'codex', task: 'No execution', model: 'irrelevant', effort: 'high', selectionReason: 'Verify authorizationMode before launching a provider' });
    assert.equal(denied.workspace.reason, 'NOT_ENROLLED');
    assert.equal(denied.workspace.authorizationMode, 'DENIED');
    bridge.roots([b]);
    await rename(a, path.join(base, 'old-a'));
    assert.equal((await check(b)).authorizationMode, 'ACTIVE_WORKSPACE', 'historical roots cannot force an MCP restart');
  } finally { if (bridge) await bridge.close(); await rm(base, { recursive: true, force: true }); }
});
