import test from 'node:test';
import assert from 'node:assert/strict';
import { recommend, nextDecision, classifyFailure, MODELS, TIERS, modelTier, chooseModel } from '../src/policy.mjs';

test('model tiers follow task features independently of effort bounds', () => {
  for (const [prompt, facts, tier] of [
    ['Fix a typo.', {}, 'fast'],
    ['Update payments.', {}, 'daily'],
    ['Debug the regression.', {}, 'daily'],
    ['Investigate security.', {}, 'frontier'],
    ['Rename the helper in a.ts b.ts c.ts d.ts e.ts.', { mentionedFiles: 5 }, 'daily'],
    ['Add a page.', {}, 'daily'],
    ['Rename the authentication token.', {}, 'daily'],
    ['Rename and refactor the helper.', {}, 'daily'],
    ['Rename and refactor the authentication token.', {}, 'frontier'],
  ]) {
    const result = recommend({ prompt, facts });
    assert.equal(modelTier(result.features), tier, prompt);
    assert.equal(result.tier, tier, prompt);
  }
  assert.equal(recommend({ prompt: 'Fix a typo.', minEffort: 'high' }).tier, 'fast');
  assert.equal(recommend({ prompt: 'Investigate security.', maxEffort: 'low' }).tier, 'frontier');
});

test('built-in models are frozen and recommendations map every provider and tier', () => {
  assert.deepEqual(TIERS, ['fast', 'daily', 'frontier']);
  assert.deepEqual(MODELS, {
    claude: { fast: 'haiku', daily: 'opus', frontier: 'fable' },
    codex: { fast: 'gpt-6-luna', daily: 'gpt-6.1-sol', frontier: 'gpt-6-astra' },
    gemini: { fast: 'gemini-4-hydrogen', daily: 'gemini-4-argon', frontier: 'gemini-4-argon' },
  });
  assert.ok(Object.isFrozen(MODELS));
  for (const provider of Object.keys(MODELS)) {
    assert.ok(Object.isFrozen(MODELS[provider]));
    for (const [tier, prompt] of [['fast', 'Fix a typo.'], ['daily', 'Add a page.'], ['frontier', 'Investigate security.']]) {
      const result = recommend({ prompt, provider });
      assert.equal(result.tier, tier);
      assert.equal(result.model, MODELS[provider][tier]);
      assert.equal(chooseModel(provider, tier), MODELS[provider][tier]);
    }
  }
  assert.equal(recommend({ prompt: 'Add a page.', provider: 'generic' }).model, null);
});

test('model lookup rejects unknown or unavailable IDs without prototype lookups', () => {
  for (const unknown of ['unknown', 'generic', '__proto__', 'constructor', 'toString', undefined]) {
    assert.equal(chooseModel(unknown, 'fast'), undefined);
    assert.equal(chooseModel('codex', unknown), undefined);
  }
  assert.equal(chooseModel('codex', 'fast', []), undefined);
  assert.equal(chooseModel('codex', 'fast', [MODELS.codex.daily]), undefined);
  assert.equal(chooseModel('codex', 'fast', [MODELS.codex.fast]), MODELS.codex.fast);
  assert.equal(chooseModel('codex', 'fast', null), MODELS.codex.fast);
  for (const provider of ['unknown', '__proto__', 'constructor']) {
    assert.throws(() => recommend({ prompt: 'Add a page.', provider }), /Provider must be codex, claude, gemini, or generic/);
  }
});

test('documented payments and migrations requests start at high effort', () => {
  for (const prompt of ['Update payments', 'Update database migrations']) {
    const result = recommend({ prompt });
    assert.equal(result.effort, 'high', prompt);
    assert.equal(result.features.critical, true, prompt);
  }
});

test('mechanical length and file breadth thresholds are exact', () => {
  const short = 'Rename ' + 'x'.repeat(342);
  assert.equal(short.length, 349);
  assert.equal(recommend({ prompt: short, facts: { mentionedFiles: 4 } }).effort, 'low');
  assert.equal(recommend({ prompt: short + 'x' }).effort, 'medium');
  const broad = recommend({ prompt: 'Add a page', facts: { mentionedFiles: 5 } });
  assert.equal(broad.effort, 'high');
  assert.equal(broad.features.broadEdit, true);
  assert.equal(recommend({ prompt: 'Reformatting the page' }).effort, 'medium');
});

test('floors and ceilings clamp decisions and explain the change', () => {
  for (const [prompt, minEffort, maxEffort, effort] of [
    ['Fix a typo', 'medium', 'high', 'medium'],
    ['Add a page', 'xhigh', 'max', 'xhigh'],
    ['Investigate security', 'low', 'low', 'low'],
    ['Fix a typo', 'max', 'max', 'max'],
  ]) {
    const result = recommend({ prompt, minEffort, maxEffort });
    assert.equal(result.effort, effort);
    assert.ok(result.reasons.some(reason => /configured effort bounds/.test(reason)));
  }
  for (const provider of ['generic', 'codex', 'claude', 'gemini']) {
    assert.equal(recommend({ prompt: 'Add a page', provider }).control, provider === 'generic' ? 'advisory' : 'managed-turns');
  }
  assert.equal(recommend({ prompt: 'x'.repeat(100_000) }).features.promptCharacters, 100_000);
  for (const options of [{ minEffort: 'invalid' }, { maxEffort: 'invalid' }, { prompt: ' \n\t' }]) {
    assert.throws(() => recommend({ prompt: 'Add a page', ...options }));
  }
});

test('timeouts take precedence over output and classification handles empty and colored reports', () => {
  assert.equal(classifyFailure('AssertionError', { timedOut: true }), 'timeout');
  assert.equal(classifyFailure(), 'unknown');
  assert.equal(classifyFailure('\x1b[31mnot ok 1 - sums\x1b[0m\r\n# fail 1\r\n'), 'test');
});

test('retry decisions obey support, repetition and extended ceilings', () => {
  assert.equal(nextDecision({ effort: 'high', kind: 'test', repeatCount: 1 }).action, 'retry');
  assert.equal(nextDecision({ effort: 'medium', kind: 'test', repeatCount: 2, maxEffort: 'medium' }).action, 'stop');
  assert.equal(nextDecision({ effort: 'low', kind: 'test', repeatCount: 2, supportedLevels: ['high', 'medium'] }).effort, 'medium');
  assert.equal(nextDecision({ effort: 'high', kind: 'test', repeatCount: 100, maxEffort: 'max', supportedLevels: ['high', 'max'] }).effort, 'max');
  for (const options of [
    { effort: 'invalid' }, { maxEffort: 'invalid' }, { kind: 'cancelled' },
    { supportedLevels: [] }, { supportedLevels: null }, { supportedLevels: ['invalid'] },
    { repeatCount: 0 }, { repeatCount: 101 }, { repeatCount: 1.5 }, { repeatCount: '2' },
  ]) assert.throws(() => nextDecision({ effort: 'low', kind: 'test', ...options }));
});
