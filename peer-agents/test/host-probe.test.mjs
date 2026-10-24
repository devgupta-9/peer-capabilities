import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('large catalogs require an explicit bounded allowance; functional verification remains separate', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'peer-probe-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const entry = path.join(root, 'server.mjs');
  writeFileSync(entry, `import readline from 'node:readline';
    const lines=readline.createInterface({input:process.stdin});
    lines.on('line',line=>{const m=JSON.parse(line);if(!m.id)return;
      const result=m.method==='initialize'?{protocolVersion:'2025-03-26',capabilities:{},serverInfo:{name:'fixture',version:'1'}}:
        m.method==='tools/list'?{tools:[{name:'fixture_check',description:'x'.repeat(2100000),inputSchema:{type:'object'}}]}:
        {isError:Boolean(m.params.arguments.fail),content:[{type:'text',text:'withheld synthetic result'}]};
      process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');});`);
  const probe = fileURLToPath(new URL('../../scripts/probe.mjs', import.meta.url));
  const run = extra => {
    const r = spawnSync(process.execPath, [probe], { input: JSON.stringify({ command: process.execPath, args: [entry], cwd: root, ...extra }), encoding: 'utf8', timeout: 15000 });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!r.stdout.includes('withheld synthetic result'));
    return JSON.parse(r.stdout);
  };
  assert.equal(run({}).error, 'excessive_output');
  assert.deepEqual(run({ maxOutputBytes: 4_000_000 }).tools, ['fixture_check']);
  assert.equal(run({ maxOutputBytes: 4_000_000, verify: { name: 'fixture_check', arguments: {} } }).functionalVerified, true);
  assert.equal(run({ maxOutputBytes: 4_000_000, verify: { name: 'fixture_check', arguments: { fail: true } } }).functionalVerified, false);
});

test('probe allows graceful EOF cleanup before terminating its launcher', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'peer-probe-shutdown-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const entry = path.join(root, 'server.mjs');
  const marker = path.join(root, 'closed.txt');
  writeFileSync(entry, `import readline from 'node:readline'; import {writeFileSync} from 'node:fs';
    const lines=readline.createInterface({input:process.stdin});
    lines.on('close',()=>setTimeout(()=>writeFileSync(process.argv[2],'closed'),100));
    lines.on('line',line=>{const m=JSON.parse(line);if(!m.id)return;
      process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:m.method==='initialize'?{}:{tools:[]}})+'\\n');});`);
  const probe = fileURLToPath(new URL('../../scripts/probe.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [probe], { input: JSON.stringify({ command: process.execPath, args: [entry, marker] }), encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).ok, true);
  assert.equal(readFileSync(marker, 'utf8'), 'closed');
});
