import { test } from 'node:test';
import assert from 'node:assert/strict';
import { secretCanaries } from './fixtures/secret-canaries.mjs';
import { assertNonSecret, redact } from '../dist/security.js';
import { secretFindings } from '../security-policy.mjs';
import { TaskStore } from '../dist/runtime/store.js';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

for (const sample of secretCanaries()) test('shared secret policy: ' + sample.name, async () => {
  assert.ok(secretFindings(sample.text).length, 'publication detection');
  assert.throws(() => assertNonSecret({ text: sample.text }), error => {
    assert.match(error.message, /SECRET/); assert.ok(!error.message.includes(sample.secret)); return true;
  });
  const safe = redact(sample.text, {});
  assert.ok(!safe.includes(sample.secret), 'returned diagnostic must not contain canary');
  const dir = await mkdtemp(path.join(tmpdir(), 'peer-redaction-'));
  const file = path.join(dir, 'tasks.sqlite'); const store = new TaskStore(file);
  try { store.evidence({ text: safe, source: 'fixture', version: '1', classification: 'PROJECT' }); }
  finally { store.close(); }
  try { assert.ok(!(await readFile(file)).includes(Buffer.from(sample.secret)), 'persisted diagnostic must not contain canary'); }
  finally { await rm(dir, { recursive: true, force: true }); }
});
