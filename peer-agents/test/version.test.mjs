import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { bridgeSession } from './fixtures/bridge-session.mjs';

test('MCP discovery and CLI report the installed package version, not the legacy bridge version', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const installed = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const bridge = await bridgeSession(root, {}, undefined);
  try {
    const discovery = await bridge.call('peer_capabilities', {});
    assert.equal(discovery.bridgeVersion, installed.version);
    const cli = JSON.parse(execFileSync(process.execPath, [fileURLToPath(new URL('../bin/peer-capabilities.mjs', import.meta.url)), 'version'], { encoding: 'utf8' }));
    assert.equal(cli.version, installed.version);
    assert.equal(discovery.hostWorkspaceSupport, 'STARTUP_CWD_ONLY');
  } finally { await bridge.close(); }
});
