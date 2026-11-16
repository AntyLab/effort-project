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
    claude: { fast: 'haiku', daily: 'sonnet', frontier: 'fable' },
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
      assert.equal(result.policyVersion, 'rules-0.3');
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

test('English costly-error keywords require high effort without making the task investigative', () => {
  for (const prompt of [
    'Fix login.', 'Let users log in.', 'Update logins.',
    'Update sign-in.', 'Let users sign in.', 'Update signup.', 'Update sign-up.',
    'Change the password.', 'Change passwords.', 'Rotate a token.', 'Rotate tokens.',
    'Remove a secret.', 'Remove secrets.', 'Store a credential.', 'Store credentials.',
    'Update billing.', 'Add an invoice.', 'Add invoices.',
    'Resolve the production outage.', 'Resolve the prod outage.',
    'DROP TABLE users;', 'Truncate the table.', 'Wipe the database.',
    'Delete data.', 'Delete all customer data.', 'Deleting old data.',
    'Handle PII.', 'Update privacy controls.',
  ]) {
    const result = recommend({ prompt });
    assert.equal(result.features.critical, true, prompt);
    assert.equal(result.features.complex, false, prompt);
    assert.equal(result.effort, 'high', prompt);
    assert.equal(result.tier, 'daily', prompt);
  }
});

test('English investigative keywords require high effort without making the task critical', () => {
  for (const prompt of [
    'Fix a crash.', 'Fix crashes.', 'The app is crashing.', 'Fix the flaky test.',
    'Fix a memory leak.', 'Fix memory leaks.',
    'The app can hang.', 'The app hangs.', 'The app is hanging.',
    'Fix the freeze.', 'The app freezes.', 'Improve performance.',
    'The page is slow.', 'Fix the slowness.', 'Find the bottleneck.',
    'The test fails randomly.', 'The test sometimes fails.', 'Bisect this failure.',
  ]) {
    const result = recommend({ prompt });
    assert.equal(result.features.complex, true, prompt);
    assert.equal(result.features.critical, false, prompt);
    assert.equal(result.effort, 'high', prompt);
    assert.equal(result.tier, 'daily', prompt);
  }
  assert.equal(recommend({ prompt: 'Fix crashing sign-in.' }).tier, 'frontier');
});

test('short English mechanical edits use low effort and the fast model tier', () => {
  for (const prompt of [
    'Add a comment.', 'Fix the comments.', 'Add a docstring.', 'Fix the docstrings.',
    'Lint this file.', 'Indent this block.', 'Fix the indentation.',
    'Bump the version.', 'Make a version bump.', 'Fix the wording.',
    'Reword this sentence.', 'Remove whitespace.', 'Sort imports.',
  ]) {
    const result = recommend({ prompt });
    assert.equal(result.effort, 'low', prompt);
    assert.equal(result.tier, 'fast', prompt);
  }
});

for (const [language, mechanical, complex, critical] of [
  ['Spanish',
    ['errata', 'falta de ortografía', 'ortografía', 'renombrar', 'traducir', 'formatear'],
    ['investigar', 'depurar', 'refactorizar', 'condición de carrera', 'intermitente'],
    ['seguridad', 'autenticación', 'pago', 'migración', 'pérdida de datos', 'contraseña']],
  ['French',
    ['faute de frappe', 'orthographe', 'renommer', 'traduire', 'formater'],
    ['enquêter', 'déboguer', 'refactoriser', 'condition de course', 'intermittent', 'plantage'],
    ['sécurité', 'authentification', 'paiement', 'migration', 'perte de données', 'mot de passe']],
  ['German',
    ['Tippfehler', 'Rechtschreibung', 'umbenennen', 'übersetzen', 'formatieren'],
    ['untersuchen', 'debuggen', 'refaktorieren', 'Race Condition', 'sporadisch', 'Absturz'],
    ['Sicherheit', 'Authentifizierung', 'Zahlung', 'Migration', 'Datenverlust', 'Passwort']],
  ['Portuguese',
    ['erro de digitação', 'ortografia', 'renomear', 'traduzir', 'formatar'],
    ['investigar', 'depurar', 'refatorar', 'condição de corrida', 'intermitente', 'travamento'],
    ['segurança', 'autenticação', 'pagamento', 'migração', 'perda de dados', 'senha']],
  ['Italian',
    ['refuso', 'errore di battitura', 'ortografia', 'rinominare', 'tradurre', 'formattare'],
    ['indagare', 'debuggare', 'rifattorizzare', 'condizione di gara', 'intermittente', 'arresto anomalo'],
    ['sicurezza', 'autenticazione', 'pagamento', 'migrazione', 'perdita di dati', 'password']],
]) {
  test(`${language} has basic mechanical, investigative and critical keyword coverage`, () => {
    for (const prompt of mechanical) {
      const result = recommend({ prompt });
      assert.equal(result.effort, 'low', prompt);
      assert.equal(result.tier, 'fast', prompt);
    }
    for (const [prompts, feature] of [[complex, 'complex'], [critical, 'critical']]) {
      for (const prompt of prompts) {
        const result = recommend({ prompt });
        assert.equal(result.effort, 'high', prompt);
        assert.equal(result.features[feature], true, prompt);
      }
    }
    assert.equal(recommend({ prompt: `${complex[0]}: ${critical[0]}` }).tier, 'frontier');
  });
}

test('keywords match whole Unicode words, ignoring case and allowing punctuation', () => {
  for (const prompt of [
    'Add a tokenizer.', 'Change the button color.', 'Add a hanger.',
    'Update the commentary.', 'Update the billingInfo field.', 'Fix the token_count field.',
    'insécurité', 'segurançaextra', 'épassword', 'passwordé', 'sécurité2', '_senha',
    'préorthographe', 'orthographeé', 'indagares',
  ]) {
    const result = recommend({ prompt });
    assert.equal(result.effort, 'medium', prompt);
    assert.equal(result.tier, 'daily', prompt);
    for (const feature of ['critical', 'complex', 'mechanical']) assert.equal(result.features[feature], false, prompt);
  }
  for (const prompt of ['(SÉCURITÉ)', '«contraseña»', 'AUTENTICAÇÃO!', 'ENQUÊTER', 'ÜBERSETZEN']) {
    assert.notEqual(recommend({ prompt }).effort, 'medium', prompt);
  }
  assert.equal(recommend({ prompt: 'faute\tde\nfrappe' }).effort, 'low');
});

test('comments never lower risky, investigative, long or broad requests to fast', () => {
  for (const prompt of ['Add a comment about passwords.', 'Add a comment about the memory leak.']) {
    const result = recommend({ prompt });
    assert.equal(result.effort, 'high', prompt);
    assert.equal(result.tier, 'daily', prompt);
  }
  const long = 'Add a comment. ' + 'Details about the requested behavior. '.repeat(12);
  assert.ok(long.length >= 350);
  assert.equal(recommend({ prompt: long }).effort, 'medium');
  assert.equal(recommend({ prompt: long }).tier, 'daily');
  const risky = recommend({ prompt: long + 'Investigate the production outage.' });
  assert.equal(risky.effort, 'high');
  assert.equal(risky.tier, 'frontier');
  assert.equal(risky.features.mechanical, false);
  const broad = recommend({ prompt: 'Add comments.', facts: { mentionedFiles: 5 } });
  assert.equal(broad.effort, 'high');
  assert.equal(broad.tier, 'daily');
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

test('review comments are not a mechanical edit', () => {
  for (const prompt of ['Address the review comments on the PR', 'Address the PR comments', 'Resolve the pull request comments']) {
    assert.equal(recommend({ prompt }).features.mechanical, false, prompt);
  }
  assert.equal(recommend({ prompt: 'Add a comment to parseDuration' }).effort, 'low');
});

test('a doc comment that describes behavior is not a comment edit', () => {
  for (const prompt of ['Fix parseDuration so it follows its doc comment.', 'Make it follow the rules in its doc comment.', 'Implement the docstring contract.']) {
    assert.equal(recommend({ prompt }).features.mechanical, false, prompt);
  }
  for (const prompt of ['Add a comment to parseDuration', 'Update the docstring for retry_delays', 'Fix the inline comment typo']) {
    assert.equal(recommend({ prompt }).features.mechanical, true, prompt);
  }
});
