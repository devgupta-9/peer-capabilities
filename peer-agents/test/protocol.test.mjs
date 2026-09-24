import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callBridge } from '../scripts/mcp-call.mjs';

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
