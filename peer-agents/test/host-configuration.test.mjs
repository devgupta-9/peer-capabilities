import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'smol-toml';
import { reconcileHost } from '../dist/host-configuration.js';
import { HostConfigurationStore } from '../dist/host-configuration-store.js';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const desired = { jev: { command: '/local/pwsh', args: ['-File', '/local/start-jev.ps1'] } };
test('host reconciliation preserves permissions, credentials, disabled state and unrelated JSON', () => {
  const before = { preferences: { theme: 'dark' }, mcpServers: {
    other: { url: 'https://example.test', headers: { ['Author' + 'ization']: 'fixture-private' } },
    jev: { command: 'node', args: ['old'], disabled: true, env: { TYPESAFE_API_KEY: 'fixture-private' }, tools: ['bounded'] },
  } };
  const result = reconcileHost(JSON.stringify(before), 'mcp-json', desired);
  const after = JSON.parse(result.text);
  assert.deepEqual(after.preferences, before.preferences);
  assert.deepEqual(after.mcpServers.other, before.mcpServers.other);
  assert.deepEqual(after.mcpServers.jev, { ...before.mcpServers.jev, ...desired.jev });
  assert.deepEqual(reconcileHost(result.text, 'mcp-json', desired).changedServers, []);
});
test('Codex TOML retains integer/float/date types and security settings', () => {
  const before = `count = 9223372036854775807\nratio = 1.0\nwhen = 2026-10-18\nmodel = "exact-model"\n[mcp_servers.jev]\ncommand = "node"\nargs = ["old"]\nenabled = false\nstartup_timeout_sec = 30\n[mcp_servers.jev.env]\nTYPESAFE_API_KEY = "fixture-private"\n`;
  const result = reconcileHost(before, 'codex-toml', desired);
  const after = parse(result.text, { integersAsBigInt: true });
  assert.equal(after.count, 9223372036854775807n);
  assert.equal(after.ratio, 1);
  assert.equal(after.mcp_servers.jev.enabled, false);
  assert.equal(after.mcp_servers.jev.startup_timeout_sec, 30n);
  assert.equal(after.mcp_servers.jev.env.TYPESAFE_API_KEY, 'fixture-private');
  assert.deepEqual(reconcileHost(result.text, 'codex-toml', desired).changedServers, []);
});
test('existing workspace environment wins over defaults; remote conflicts and malformed configs fail closed', () => {
  const input = JSON.stringify({ mcpServers: { peer: { command: 'node', args: ['old'], env: { PEER_WORKSPACE_POLICY: 'STRICT_ROOTS' } } } });
  const result = reconcileHost(input, 'mcp-json', { peer: { command: 'node', args: ['new'], env: { PEER_WORKSPACE_POLICY: 'AUTO_ACTIVE' } } });
  assert.equal(JSON.parse(result.text).mcpServers.peer.env.PEER_WORKSPACE_POLICY, 'STRICT_ROOTS');
  assert.throws(() => reconcileHost('{private-malformed', 'mcp-json', desired), /contents withheld/);
  assert.throws(() => reconcileHost('{"mcpServers":{"jev":{"url":"https://example.test"}}}', 'mcp-json', desired), /transport conflict/);
  assert.throws(() => reconcileHost(null, 'mcp-json', { jev: { ...desired.jev, env: { TYPESAFE_API_KEY: 'actual-private-key' } } }), /secret-bearing/);
});
test('manifest order does not change plan digests; explicit non-secret overrides are scoped', () => {
  const a = { jev: desired.jev, peer: { command: 'node', args: ['new'], env: { PEER_AGY_BIN: 'agy', PEER_CODEX_BIN: 'codex' } } };
  const b = { peer: { command: 'node', args: ['new'], env: { PEER_CODEX_BIN: 'codex', PEER_AGY_BIN: 'agy' } }, jev: desired.jev };
  assert.equal(reconcileHost(null, 'mcp-json', a).text, reconcileHost(null, 'mcp-json', b).text);
  const original = '{"mcpServers":{"peer":{"command":"node","args":[],"disabled":true,"env":{"PEER_AGENTS_WORKSPACE_MODE":"STRICT_ROOTS","KEEP":"yes"}}}}';
  const changed = reconcileHost(original, 'mcp-json', { peer: { ...a.peer, envOverrides: { PEER_AGENTS_WORKSPACE_MODE: 'AUTO_ACTIVE' } } });
  const actual = JSON.parse(changed.text).mcpServers.peer;
  assert.equal(actual.env.PEER_AGENTS_WORKSPACE_MODE, 'AUTO_ACTIVE');
  assert.equal(actual.env.KEEP, 'yes'); assert.equal(actual.disabled, true);
});

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'peer-host-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, '.codex'));
  const target = { host: 'codex', relativePath: '.codex/config.toml', format: 'codex-toml', servers: desired };
  return { root, target, store: new HostConfigurationStore(root), file: path.join(root, target.relativePath) };
}
test('host plan is secret-free, apply is idempotent and rollback restores exact bytes', t => {
  const { root, target, store, file } = fixture(t);
  const original = '# Keep this comment\n[mcp_servers.jev]\ncommand="node"\nargs=["old"]\n[mcp_servers.jev.env]\nTYPESAFE_API_KEY="fixture-private"\n';
  writeFileSync(file, original);
  const plan = store.preview([target]);
  assert.ok(!JSON.stringify(plan).includes('fixture-private'));
  const applied = store.apply([target], plan.digest);
  assert.equal(applied.changedHosts, 1);
  assert.equal(store.apply([target], store.preview([target]).digest).status, 'UNCHANGED');
  const db = new DatabaseSync(path.join(root, '.peer-capabilities/host-configuration/environment.sqlite'));
  assert.ok(!db.prepare('SELECT body FROM host_configuration_operations').get().body.includes('fixture-private'));
  db.close();
  assert.equal(new HostConfigurationStore(root).rollback(applied.operation).status, 'ROLLED_BACK');
  assert.equal(readFileSync(file, 'utf8'), original);
});
test('edits between preview/apply and after apply are never overwritten', t => {
  const { target, store, file } = fixture(t);
  writeFileSync(file, 'model="first"\n');
  const plan = store.preview([target]);
  writeFileSync(file, 'model="changed"\n');
  assert.throws(() => store.apply([target], plan.digest), /plan changed/);
  const result = store.apply([target], store.preview([target]).digest);
  writeFileSync(file, 'model="user-edit"\n');
  assert.throws(() => store.rollback(result.operation), /preserves user edits/);
  assert.equal(readFileSync(file, 'utf8'), 'model="user-edit"\n');
});
test('redirected paths and path escapes fail closed without changing outside files', t => {
  const { root, target, store } = fixture(t);
  const outside = mkdtempSync(path.join(tmpdir(), 'peer-host-outside-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  rmSync(path.join(root, '.codex'), { recursive: true });
  symlinkSync(outside, path.join(root, '.codex'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => store.preview([target]), /Redirected/);
  assert.throws(() => store.preview([{ ...target, relativePath: '../escape' }]), /escaped/);
});
test('partial apply retains a durable journal and can roll back after process restart', t => {
  const { root, target, store, file } = fixture(t);
  const second = { ...target, host: 'second', relativePath: 'second.json', format: 'mcp-json' };
  writeFileSync(file, '# original\n');
  writeFileSync(path.join(root, 'second.json'), '{"unrelated":true}\n');
  const plan = store.preview([target, second]);
  const rename = fs.renameSync;
  fs.renameSync = (source, destination) => {
    if (destination === path.join(root, 'second.json')) throw new Error('Injected interruption');
    return rename(source, destination);
  };
  syncBuiltinESMExports();
  try { assert.throws(() => store.apply([target, second], plan.digest), /incomplete/); }
  finally { fs.renameSync = rename; syncBuiltinESMExports(); }
  assert.notEqual(readFileSync(file, 'utf8'), '# original\n');
  const db = new DatabaseSync(path.join(root, '.peer-capabilities/host-configuration/environment.sqlite'));
  const record = JSON.parse(db.prepare('SELECT body FROM host_configuration_operations').get().body);
  db.close();
  assert.equal(record.status, 'PLANNED');
  new HostConfigurationStore(root).rollback(record.id);
  assert.equal(readFileSync(file, 'utf8'), '# original\n');
  assert.equal(readFileSync(path.join(root, 'second.json'), 'utf8'), '{"unrelated":true}\n');
});
test('deployment bindings are non-secret observations, including unchanged registrations', t => {
  const { root, target, store } = fixture(t);
  const bindings = { codex: { jev: { runtimeRoot: root } } };
  const first = store.apply([target], store.preview([target]).digest, bindings);
  const second = store.apply([target], store.preview([target]).digest, bindings);
  assert.equal(second.changedHosts, 0);
  assert.notEqual(first.operation, second.operation);
  assert.throws(() => store.apply([target], store.preview([target]).digest, { ['pass' + 'word']: 'fixture' }), /SECRET/);
  assert.throws(() => store.apply([target], store.preview([target]).digest, { other: { jev: { runtimeRoot: root } } }), /outside selected/);
  assert.throws(() => store.apply([target], store.preview([target]).digest, { codex: { rea: { entry: root } } }), /outside selected/);
  store.rollback(second.operation); // leaves prior deployment observations available
  const db = new DatabaseSync(path.join(root, '.peer-capabilities/host-configuration/environment.sqlite'));
  const records = db.prepare('SELECT body FROM host_configuration_operations ORDER BY rowid').all().map(row => JSON.parse(row.body));
  db.close();
  assert.equal(records[0].bindings.codex.jev.runtimeRoot, root);
  assert.equal(records[1].status, 'ROLLED_BACK');
});

test('operator CLI accepts partial host/component bindings without requiring optional REA or a Claude peer', t => {
  const { root, store } = fixture(t);
  for (const [host, names] of [['codex', ['peer-agents', 'jev']], ['claude-code', ['jev', 'rea']], ['claude-desktop', ['rea']]]) {
    const target = { host, relativePath: `${host}-日本語.json`, format: 'mcp-json', servers: Object.fromEntries(names.map(name => [name, desired.jev])) };
    const request = { action: 'apply', root, targets: [target], expectedDigest: store.preview([target]).digest,
      bindings: { [host]: Object.fromEntries(names.map(name => [name, { runtimeRoot: root }])) } };
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../dist/host-configuration-cli.js', import.meta.url))],
      { input: JSON.stringify(request), encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).status, 'COMPLETE');
  }
});
