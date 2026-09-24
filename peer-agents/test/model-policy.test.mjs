import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCodexCatalog, validateChoice } from '../dist/model-policy.js';

const models = parseCodexCatalog({ models: [
  { slug: 'engineering-model', description: 'Capable engineering model', supported_reasoning_levels: [{ effort: 'high' }, { effort: 'xhigh' }] },
  { slug: 'gpt-5.6-luna', supported_reasoning_levels: [{ effort: 'high' }] },
  { slug: 'new-budget-model', description: 'Fast and affordable agentic coding model.', supported_reasoning_levels: [{ effort: 'high' }] },
  { slug: 'codex-auto-review', supported_reasoning_levels: [{ effort: 'high' }] },
] });
test('exact supported Codex selection is preserved without fallback', () => {
  assert.deepEqual(validateChoice('codex', 'engineering-model', 'xhigh', models, []),
    { model: 'engineering-model', effort: 'xhigh', fallback: false });
});
test('unlisted and lightweight/internal Codex models are rejected', () => {
  for (const model of ['unknown-model', 'gpt-5.6-luna', 'new-budget-model', 'codex-auto-review']) {
    assert.throws(() => validateChoice('codex', model, 'high', models, []));
  }
});
test('unsupported Codex effort is rejected', () => {
  assert.throws(() => validateChoice('codex', 'engineering-model', 'low', models, []), /Unsupported/);
});
test('Antigravity fast models are allowed with matching effort', () => {
  assert.deepEqual(validateChoice('antigravity', 'gemini-3.8-flash-low', 'low', [], ['gemini-3.8-flash-low']),
    { model: 'gemini-3.8-flash-low', effort: 'low', fallback: false });
});
test('Antigravity mismatches, unknown models, and unsupported effort are rejected', () => {
  assert.throws(() => validateChoice('antigravity', 'gemini-3.8-flash-low', 'high', [], ['gemini-3.8-flash-low']), /disagree/);
  assert.throws(() => validateChoice('antigravity', 'unknown', 'low', [], []), /not in/);
  assert.throws(() => validateChoice('antigravity', 'claude-sonnet-4-6', 'xhigh', [], ['claude-sonnet-4-6']), /supports/);
});
test('invalid catalogs fail closed', () => {
  assert.throws(() => parseCodexCatalog({ models: [{ slug: 'incomplete' }] }));
});
