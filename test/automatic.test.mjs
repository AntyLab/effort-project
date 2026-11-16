import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutomaticRouter, validateModelMap } from '../src/automatic.mjs';

const request = (router, prompt, options = {}) => router.decide({ sessionId: 'a', model: 'test-model', supportedEfforts: ['low', 'medium', 'high'], prompt, ...options });

test('routes mechanical and risky requests without another model call', () => {
  const router = createAutomaticRouter();
  assert.equal(request(router, 'Fix a spelling typo in the README.').effort, 'low');
  assert.equal(request(router, 'Investigate a payment authorization race condition.').effort, 'high');
});

test('short followups keep the prior task context and sessions stay isolated', () => {
  const router = createAutomaticRouter();
  assert.equal(request(router, 'Investigate the intermittent data loss.').tier, 'frontier');
  for (const prompt of ['yes, continue', 'yes', 'continue', 'please fix it', 'try again']) {
    const result = request(router, prompt);
    assert.equal(result.effort, 'high');
    assert.equal(result.tier, 'frontier');
    assert.equal(result.recommendation.tier, 'daily');
  }
  assert.equal(request(router, 'Fix a typo.', { sessionId: 'b' }).effort, 'low');
});

test('two explicit simpler requests allow downgrade, including after a model change', () => {
  const router = createAutomaticRouter();
  assert.equal(request(router, 'Debug the authentication regression.').tier, 'frontier');
  const first = request(router, 'Fix a spelling typo.', { model: 'new-model' });
  assert.equal(first.effort, 'high');
  assert.equal(first.tier, 'frontier');
  const second = request(router, 'Rename a README heading.', { model: 'new-model' });
  assert.equal(second.effort, 'low');
  assert.equal(second.tier, 'fast');
});

test('tier follows the recommendation when hysteresis does not keep prior effort', () => {
  const router = createAutomaticRouter();
  request(router, 'Investigate data loss.');
  assert.equal(request(router, 'Debug a regression.').tier, 'daily');
  assert.equal(request(router, 'Fix a typo.').tier, 'daily');
  assert.equal(request(router, 'Fix a typo.').tier, 'fast');
  assert.equal(request(router, 'Investigate data loss.').tier, 'frontier');
});

test('reset forgets prior complexity', () => {
  const router = createAutomaticRouter();
  request(router, 'Debug the authentication regression.');
  router.forget('a');
  assert.equal(request(router, 'Fix a typo.').effort, 'low');
});

test('uses advertised capabilities and preserves requests when no adequate bounded effort exists', () => {
  const router = createAutomaticRouter();
  assert.equal(request(router, 'Fix a typo.', { supportedEfforts: ['medium', 'high'] }).effort, 'medium');
  assert.equal(request(router, 'Debug a regression.', { supportedEfforts: ['low'] }).action, 'preserve');
  assert.equal(request(router, 'Debug a regression.', { supportedEfforts: ['xhigh'] }).action, 'preserve');
  assert.equal(request(createAutomaticRouter({ maxEffort: 'xhigh' }), 'Debug a regression.', { supportedEfforts: ['low', 'xhigh'] }).effort, 'xhigh');
});

test('fixed effort and explicit ceiling win and cannot exceed bounds', () => {
  const fixed = createAutomaticRouter({ effort: 'low' });
  const result = request(fixed, 'Investigate data loss.');
  assert.equal(result.effort, 'low');
  assert.equal(result.tier, 'frontier');
  assert.equal(request(fixed, 'yes, continue').tier, 'daily');
  assert.equal(request(fixed, 'Fix a typo.').tier, 'fast');
  assert.equal(request(createAutomaticRouter({ maxEffort: 'medium' }), 'Investigate data loss.').effort, 'medium');
  assert.throws(() => createAutomaticRouter({ effort: 'high', maxEffort: 'medium' }), /bounds/);
  assert.throws(() => createAutomaticRouter({ minEffort: 'high', maxEffort: 'low' }), /Minimum/);
});

test('a narrow mechanical edit is not inflated by unrelated repository languages', () => {
  assert.equal(request(createAutomaticRouter(), 'Fix a spelling typo.', { facts: { languages: ['python', 'swift', 'go'], mentionedFiles: 1 } }).effort, 'low');
  assert.equal(request(createAutomaticRouter(), 'Rename these files.', { facts: { mentionedFiles: 6 } }).effort, 'high');
});

test('invalid input is rejected and public decisions contain no prompt', () => {
  const router = createAutomaticRouter();
  assert.throws(() => request(router, ''), /Prompt/);
  const secretPrompt = 'Rename PRIVATE_MARKER in a README.';
  assert.ok(!JSON.stringify(request(router, secretPrompt)).includes('PRIVATE_MARKER'));
  for (const supportedEfforts of [['low', 'medium', 'high'], []]) {
    assert.equal(Object.hasOwn(request(router, 'Fix a typo.', { supportedEfforts }), 'model'), false);
  }
});

test('model routing tables accept only explicit effort-to-ID mappings', () => {
  assert.deepEqual(validateModelMap({ low: 'provider/small', high: 'provider/large' }), { low: 'provider/small', high: 'provider/large' });
  assert.throws(() => validateModelMap({ cheap: 'anything' }), /Unsupported effort/);
  assert.throws(() => validateModelMap({ high: '--flag value' }), /model ID/);
  assert.throws(() => validateModelMap([]), /models/);
});

test('preview neither creates a session nor consumes a simpler-request count', () => {
  const router = createAutomaticRouter();
  assert.equal(request(router, 'Investigate data loss.', { preview: true }).tier, 'frontier');
  const fresh = request(router, 'Fix a typo.');
  assert.equal(fresh.effort, 'low');
  assert.equal(fresh.tier, 'fast');
  request(router, 'Investigate data loss.');
  const preview = request(router, 'Fix a typo.', { preview: true });
  assert.equal(preview.effort, 'high');
  assert.equal(preview.tier, 'frontier');
  const first = request(router, 'Fix a typo.');
  assert.equal(first.effort, 'high');
  assert.equal(first.tier, 'frontier');
  assert.equal(request(router, 'Fix a typo.', { preview: true }).tier, 'fast');
  assert.equal(request(router, 'yes, continue', { preview: true }).tier, 'frontier');
  const second = request(router, 'Fix a typo.');
  assert.equal(second.effort, 'low');
  assert.equal(second.tier, 'fast');
});

test('continuations and renewed complexity reset a pending downgrade', () => {
  for (const reset of ['yes', 'Debug the regression again.']) {
    const router = createAutomaticRouter();
    request(router, 'Investigate a race condition.');
    request(router, 'Fix a typo.');
    assert.equal(request(router, reset).effort, 'high');
    assert.equal(request(router, 'Fix a typo.').effort, 'high');
    assert.equal(request(router, 'Fix a typo.').effort, 'low');
  }
});

test('preserving an unsupported request keeps the prior session state', () => {
  const router = createAutomaticRouter();
  const unsupported = request(router, 'Investigate data loss.', { supportedEfforts: [] });
  assert.equal(unsupported.action, 'preserve');
  assert.equal(unsupported.tier, 'frontier');
  assert.equal(request(router, 'Fix a typo.').tier, 'fast');
  request(router, 'Investigate data loss.');
  const kept = request(router, 'Fix a typo.', { supportedEfforts: ['low'] });
  assert.equal(kept.action, 'preserve');
  assert.equal(kept.tier, 'frontier');
  assert.equal(request(router, 'Fix a typo.').effort, 'high');
  assert.equal(request(router, 'Fix a typo.').effort, 'low');
  assert.equal(request(createAutomaticRouter({ effort: 'medium' }), 'Fix a typo.', { supportedEfforts: ['high'] }).action, 'preserve');
});

test('routing evicts the least recently used session after 256 applied sessions', () => {
  const router = createAutomaticRouter();
  for (let i = 0; i < 256; i++) request(router, 'Debug a regression.', { sessionId: String(i) });
  request(router, 'continue', { sessionId: '0' });
  request(router, 'Debug a regression.', { sessionId: '256' });
  assert.equal(request(router, 'Fix a typo.', { sessionId: '0' }).effort, 'high');
  assert.equal(request(router, 'Fix a typo.', { sessionId: '1' }).effort, 'low');
});

test('routing validates bounded IDs, effort levels and plain model maps', () => {
  for (const sessionId of [undefined, '', 1, 'x'.repeat(513)]) {
    assert.throws(() => request(createAutomaticRouter(), 'Fix a typo.', { sessionId }), /conversation ID/);
  }
  assert.equal(request(createAutomaticRouter(), 'Fix a typo.', { sessionId: 'x'.repeat(512) }).action, 'apply');
  for (const options of [{ minEffort: 'invalid' }, { maxEffort: 'invalid' }, { effort: 'invalid' }]) {
    assert.throws(() => createAutomaticRouter(options), /Unsupported effort/);
  }
  assert.equal(validateModelMap(undefined), undefined);
  for (const models of [null, 'model', Object.create(null), { high: '' }, { high: 'x'.repeat(201) }]) {
    assert.throws(() => validateModelMap(models));
  }
});
