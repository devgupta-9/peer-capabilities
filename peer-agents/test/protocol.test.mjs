import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callBridge } from '../scripts/mcp-call.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('fresh MCP schema requires explicit model and effort without legacy routing', async () => {
  const result = await callBridge('tools/list');
  const tool = result.tools.find(t => t.name === 'delegate_peer');
  for (const key of ['model', 'effort', 'selectionReason']) assert.ok(tool.inputSchema.required.includes(key));
  assert.equal(tool.inputSchema.properties.tier, undefined);
  assert.equal(tool.inputSchema.additionalProperties, false);
});
test('legacy calls fail validation instead of selecting an implicit model', async () => {
  const result = await callBridge('delegate_peer', { caller: 'codex', task: 'test', tier: 'STANDARD' });
  assert.equal(result.isError, true);
});
test('depth guard rejects recursive delegation before execution', async () => {
  const result = await callBridge('delegate_peer', {
    caller: 'codex', task: 'No work', model: 'irrelevant', effort: 'high', selectionReason: 'Protocol guard verification',
  }, { env: { PEER_AGENTS_DEPTH: '1' } });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /depth limit/);
});

test('invalid recursion depth fails closed', async () => {
  const result = await callBridge('delegate_peer', {
    caller: 'codex', task: 'No work', model: 'irrelevant', effort: 'high', selectionReason: 'Invalid depth guard verification',
  }, { env: { PEER_AGENTS_DEPTH: 'not-a-number' } });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /depth limit/);
});

test('invalid task limit configuration falls back safely', async () => {
  const result = await callBridge('tools/list', {}, {
    env: { PEER_AGENTS_MAX_TASK_CHARS: 'not-a-number' },
  });
  assert.ok(result.tools.some((tool) => tool.name === 'delegate_peer'));
});

test('workspace preflight detects missing roots even when both CLIs launch', async () => {
  const outside = await mkdtemp(path.join(tmpdir(), 'peer-host-'));
  const repo = fileURLToPath(new URL('../../', import.meta.url));
  try {
    for (const roots of ['', repo]) {
      const result = await callBridge('peer_capabilities', { cwd: repo }, { cwd: outside,
        env: { PEER_AGY_BIN: process.execPath, PEER_CODEX_BIN: process.execPath, PEER_AGENTS_ALLOWED_ROOTS: roots } });
      const payload = JSON.parse(result.content[0].text);
      assert.equal(payload.antigravity.available, true);
      assert.equal(payload.antigravity.readiness.authentication, 'UNKNOWN');
      assert.equal(payload.antigravity.readiness.verification, 'UNVERIFIED');
      assert.equal(payload.antigravity.readiness.presence, 'INSTALLED');
      assert.equal(payload.antigravity.modelDiscovery.status, 'UNAVAILABLE');
      assert.equal(payload.workspace.ready, Boolean(roots));
      if (!roots) assert.match(payload.workspace.error, /No safe delegation root/);
    }
  } finally { await rm(outside, { recursive: true, force: true }); }
});
