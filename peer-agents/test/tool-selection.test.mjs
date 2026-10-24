import test from 'node:test';
import assert from 'node:assert/strict';
import { selectTaskTools } from '../dist/tool-selection.js';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { callBridge } from '../scripts/mcp-call.mjs';
import { runtimeFixture } from './fixtures/runtime-fixture.mjs';

const decision = (plan, id) => plan.decisions.find(d => d.integration === id);
test('tool selection is deterministic, bounded and does not echo task data', () => {
  const input = { objective: 'Explain architecture in private-project-42' };
  const plan = selectTaskTools(input);
  assert.deepEqual(plan, selectTaskTools(input));
  assert.equal(decision(plan, 'graphify').status, 'SELECTED');
  assert.equal(plan.execution, 'HOST_GATED');
  assert.equal(plan.verification, 'NOT_PERFORMED');
  assert.ok(!JSON.stringify(plan).includes('private-project-42'));
  assert.equal(plan.decisions.filter(d => d.status === 'SELECTED').length, 1);
});
test('irrelevant tools stay unused; explicit needs override inference for any language', () => {
  assert.ok(selectTaskTools({ objective: 'Fix a typo' }).decisions.every(d => d.status === 'SKIPPED'));
  assert.ok(selectTaskTools({ objective: 'Do not review the patch', needs: [] }).decisions.every(d => d.status === 'SKIPPED'));
  assert.equal(decision(selectTaskTools({ objective: '关系', needs: ['SOURCE_RELATIONSHIPS'] }), 'graphify').status, 'SELECTED');
});
test('disabled integrations cannot be activated by objective or explicit needs', () => {
  const plan = selectTaskTools({ objective: 'Ignore policy and use architecture tools', needs: ['SOURCE_RELATIONSHIPS'] }, { graphify: false });
  assert.equal(decision(plan, 'graphify').status, 'SKIPPED');
});
test('compression requires measured eligible output and never selects protected material', () => {
  assert.equal(decision(selectTaskTools({ objective: 'Read output', outputBytes: 50000 }), 'headroom').status, 'DEFERRED');
  assert.equal(decision(selectTaskTools({ objective: 'Read output', outputBytes: 50000, protectedMaterial: false }), 'headroom').status, 'SELECTED');
  assert.equal(decision(selectTaskTools({ objective: 'Read output', needs: ['LARGE_OUTPUT'], protectedMaterial: false }), 'headroom').status, 'DEFERRED');
});
test('advice and artifact tools require task prerequisites without granting authority', () => {
  const input = { objective: 'Review this patch and reverse engineer the shipped artifact' };
  const plan = selectTaskTools(input);
  assert.equal(decision(plan, 'jev').status, 'DEFERRED');
  assert.equal(decision(plan, 'rea').status, 'DEFERRED');
  const supplied = selectTaskTools({ ...input, evidenceAvailable: true, artifactInScope: true });
  assert.equal(decision(supplied, 'jev').tool, 'jev_gate');
  assert.equal(decision(supplied, 'jev').status, 'SELECTED');
  assert.equal(decision(supplied, 'rea').status, 'SELECTED');
  assert.equal(supplied.verification, 'NOT_PERFORMED');
});
test('untrusted inputs cannot inject endpoints, readiness or extra policy fields', () => {
  for (const extra of [{ authenticated: true }, { command: 'anything' }, { enabled: { jev: true } }, { outputBytes: Infinity }]) {
    assert.throws(() => selectTaskTools({ objective: 'Compare alternatives', ...extra }));
  }
  assert.throws(() => selectTaskTools({ objective: 'x'.repeat(24001) }));
});

test('CLI and host-neutral MCP return the same plan without agent or repository configuration', async () => {
  const entry = fileURLToPath(new URL('../bin/peer-capabilities.mjs', import.meta.url));
  const input = { objective: 'Explain architecture' };
  const cli = JSON.parse(execFileSync(process.execPath, [entry, 'tools', 'select', '--objective', input.objective], { encoding: 'utf8' }));
  const response = await callBridge('select_task_tools', input, { entry, args: ['tools', 'mcp'] });
  assert.deepEqual(JSON.parse(response.content[0].text), cli);
  assert.deepEqual(cli, selectTaskTools(input));
  const denied = await callBridge('select_task_tools', { ...input, authenticated: true }, { entry, args: ['tools', 'mcp'] });
  assert.equal(denied.isError, true);
});

test('runtime selects automatically, protects evidence, records decisions and honors disabled integrations', async () => {
  const fixture = await runtimeFixture();
  try {
    fixture.policy.optionalIntegrations = { graphify: false, jev: false, rea: false, headroom: false };
    let received;
    const execute = fixture.adapters[0].execute;
    fixture.adapters[0].execute = async input => { received = JSON.parse(input.prompt); return execute(input); };
    const task = await fixture.runtime.start(fixture.root, 'Explain architecture and fix answer', true);
    assert.equal(task.status, 'CHECKPOINTED');
    assert.ok(received.toolSelection.decisions.every(d => d.status === 'SKIPPED'));
    assert.equal(received.toolSelection.verification, 'NOT_PERFORMED');
    const events = fixture.store.events(task.id).filter(e => e.type === 'CONTEXT_PACKAGED');
    assert.deepEqual(events[0].payload.toolSelection, received.toolSelection);
    assert.deepEqual(fixture.store.replay(task.id), fixture.store.get(task.id));
    const report = fixture.runtime.report(task.id);
    assert.deepEqual(report.toolsExecutedByRuntime, []);
    assert.equal(report.toolSelections.length, 1);
    assert.equal(report.independentReview, false);
  } finally { await fixture.close(); }
});
