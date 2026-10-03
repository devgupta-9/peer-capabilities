import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runCapture } from '../dist/process.js';

test('process capture preserves UTF-8 split across output chunks', async () => {
  const script = [
    "const bytes = Buffer.from('🙂', 'utf8');",
    'process.stdout.write(bytes.subarray(0, 2));',
    'setTimeout(() => process.stdout.write(bytes.subarray(2)), 20);',
  ].join('');
  const result = await runCapture(process.execPath, ['-e', script], { timeoutSeconds: 5 });
  assert.equal(result.code, 0);
  assert.equal(result.stdout, '🙂');
  assert.equal(result.stdoutTruncated, false);
});

test('process capture reports truncation instead of silently returning a prefix', async () => {
  const result = await runCapture(
    process.execPath,
    ['-e', "process.stdout.write('x'.repeat(1000))"],
    { timeoutSeconds: 5, maxOutputBytes: 64 },
  );
  assert.equal(result.code, 0);
  assert.equal(result.stdoutTruncated, true);
  assert.match(result.stdout, /truncated by peer-agents after 64 bytes/);
});

test('process capture can send prompts through stdin', async () => {
  const result = await runCapture(
    process.execPath,
    ['-e', "let v=''; process.stdin.setEncoding('utf8'); process.stdin.on('data', c => v += c); process.stdin.on('end', () => process.stdout.write(v));"],
    { timeoutSeconds: 5, input: 'prompt via stdin' },
  );
  assert.equal(result.code, 0);
  assert.equal(result.stdout, 'prompt via stdin');
});

test('cancellation terminates an active child promptly', async () => {
  const abort = new AbortController();
  setTimeout(() => abort.abort(), 100);
  const started = Date.now();
  const result = await runCapture(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { signal: abort.signal, timeoutSeconds: 4 });
  assert.equal(result.cancelled, true);
  assert.ok(Date.now() - started < 3500);
});
