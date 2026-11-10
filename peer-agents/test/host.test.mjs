import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { callBridge } from '../scripts/mcp-call.mjs';
import { TaskStore } from '../dist/runtime/store.js';
import { stateDirectory } from '../dist/runtime/repository.js';

test('fresh task MCP shares durable state and exposes no approval or integration capability', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'peer-host-'));
  const root = path.join(dir, 'repo');
  try {
    execFileSync('git', ['init', root], { stdio: 'pipe' });
    const git = (...args) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' });
    git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
    await writeFile(path.join(root, 'fixture.txt'), 'fixture');
    git('add', '.'); git('commit', '-m', 'fixture');
    const config = path.join(dir, 'runtime.json');
    await writeFile(config, JSON.stringify({ agents: [], policy: {
      policyVersion: '1', manifestDigest: 'fixture', mode: 'FAST', competence: 8, complexity: 'high', testCommand: ['node', '--test'],
    } }));
    const options = {
      entry: fileURLToPath(new URL('../bin/peer-capabilities.mjs', import.meta.url)),
      args: ['mcp', '--repo', root, '--config', config, '--state-dir', path.join(dir, 'state')],
    };
    const listing = await callBridge('tools/list', {}, options);
    assert.equal(listing.tools.length, 8);
    assert.ok(listing.tools.some(t => t.name === 'select_task_tools'));
    assert.ok(!listing.tools.some(t => /approve|integrate|login/.test(t.name)));
    const created = await callBridge('v1_task_create', { objective: 'Inspect fixture' }, options);
    const task = JSON.parse(created.content[0].text);
    assert.equal(task.status, 'CREATED');
    const status = await callBridge('v1_task_status', { id: task.id }, options);
    assert.equal(JSON.parse(status.content[0].text).status, 'CREATED');
    const evidence = await callBridge('v1_task_evidence_query', { id: task.id }, options);
    assert.deepEqual(JSON.parse(evidence.content[0].text).items, []);
    const store = new TaskStore(path.join(await stateDirectory(root), 'tasks.sqlite'));
    let proof;
    try {
      proof = store.evidence({ text: 'exact Unicode evidence 解析🙂'.repeat(80), source: 'fixture', version: task.baseline, classification: 'PROJECT' });
      store.append(task.id, store.get(task.id).revision, 'EVIDENCE_LINKED', { evidence: proof });
    } finally { store.close(); }
    const retrieved = await callBridge('v1_task_evidence_read', { id: task.id, evidenceId: proof }, options);
    assert.equal(JSON.parse(retrieved.content[0].text).text, 'exact Unicode evidence 解析🙂'.repeat(80));
    const oversized = await callBridge('v1_task_evidence_read', { id: task.id, evidenceId: proof, maxBytes: 1024 }, options);
    assert.equal(oversized.isError, true);
    assert.equal(JSON.parse(oversized.content[0].text).error, 'INSUFFICIENT_CONTEXT');
    const missing = await callBridge('v1_task_evidence_read', { id: task.id, evidenceId: 'a'.repeat(64) }, options);
    assert.equal(missing.isError, true);
    const dispatch = await callBridge('v1_task_dispatch', { id: task.id }, options);
    assert.equal(dispatch.isError, true);
    assert.equal(git('status', '--porcelain').toString().trim(), '');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
