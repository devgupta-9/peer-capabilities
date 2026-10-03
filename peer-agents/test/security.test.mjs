import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCapture } from '../dist/process.js';
import { assertNonSecret, redact } from '../dist/security.js';

test('default subprocess environment excludes unrelated credentials', async () => {
  process.env.UNRELATED_TEST_SECRET = 'canary-never-inherit';
  try {
    const result = await runCapture(process.execPath, ['-e', 'console.log(process.env.UNRELATED_TEST_SECRET ?? "absent")']);
    assert.equal(result.stdout.trim(), 'absent');
  } finally { delete process.env.UNRELATED_TEST_SECRET; }
});

test('quoted JSON and nested structured credentials are rejected and redacted', () => {
  const canary = 'opaque-fixture-' + 'x'.repeat(30);
  for (const value of [{ password: canary }, { config: { api_key: canary } },
    { text: JSON.stringify({ password: canary }) }, { text: 'log: ' + JSON.stringify({ access_token: canary }) }]) {
    assert.throws(() => assertNonSecret(value), /SECRET/);
    assert.ok(!redact(JSON.stringify(value)).includes(canary));
  }
});
