import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as policy from '../dist/model-policy.js';
const { parseCodexCatalog, validateChoice } = policy;

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
test('explicit Antigravity dispatch validates the pin without depending on catalog discovery', () => {
  assert.deepEqual(policy.validatePinnedAntigravityChoice('gemini-3.8-flash-high', 'high'),
    { model: 'gemini-3.8-flash-high', effort: 'high', fallback: false });
  // Existence/account access is checked by the provider CLI, not fabricated locally.
  assert.deepEqual(policy.validatePinnedAntigravityChoice('provider-custom-model', 'medium'),
    { model: 'provider-custom-model', effort: 'medium', fallback: false });
});
test('provider-owned model validation does not relax local effort or explicit-pin policy', () => {
  for (const model of ['', '--model', 'model with spaces', 'auto', 'default', 'a'.repeat(129)]) {
    assert.throws(() => policy.validatePinnedAntigravityChoice(model, 'high'), /explicit|slug/);
  }
  assert.throws(() => policy.validatePinnedAntigravityChoice('gemini-3.8-flash-low', 'high'), /disagree/);
  assert.throws(() => policy.validatePinnedAntigravityChoice('claude-sonnet-4-6', 'xhigh'), /supports/);
});
test('invalid catalogs fail closed', () => {
  assert.throws(() => parseCodexCatalog({ models: [{ slug: 'incomplete' }] }));
});

test('Codex exclusions can be changed through portable policy configuration', () => {
  const custom = {
    codex: {
      excludedNameTokens: [],
      excludedDescriptionPhrases: [],
      internalNameSubstrings: [],
    },
  };
  const configured = parseCodexCatalog({ models: [
    { slug: 'gpt-5.6-luna', description: 'Locally approved', supported_reasoning_levels: [{ effort: 'high' }] },
  ] }, custom);
  assert.equal(configured[0].allowed, true);
});
