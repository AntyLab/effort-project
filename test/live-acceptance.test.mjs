import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cases, recordResult, runAcceptance } from '../scripts/live-acceptance.mjs';
import { chooseModel, recommend } from '../src/policy.mjs';

const entry = fileURLToPath(new URL('../scripts/live-acceptance.mjs', import.meta.url));

test('plan mode runs only local fixture tests, matches policy, and restores broken workspaces', async () => {
  const calls = [], lines = [];
  const result = await runAcceptance([], {
    print: line => lines.push(line),
    runCommand: async (args, options) => {
      // Fail immediately if plan mode tries to start Effort or a provider.
      assert.deepEqual(args, ['test.mjs']);
      const sourceFile = cases.find(fixture => options.cwd.includes(`-${fixture.name}-`)).file;
      calls.push({ cwd: options.cwd, source: await readFile(join(options.cwd, sourceFile), 'utf8') });
      const child = spawnSync(process.execPath, args, { cwd: options.cwd, shell: false,
        encoding: 'utf8', timeout: options.timeoutMs });
      assert.ifError(child.error);
      return { code: child.status, stdout: child.stdout };
    },
  });
  assert.equal(result.plans.length, 9);
  assert.equal(calls.length, 18);
  assert.equal(new Set(calls.map(call => call.cwd)).size, 9);
  assert.deepEqual(result.records, []);
  assert.equal(result.failed, false);
  for (const [index, plan] of result.plans.entries()) {
    const fixture = plan.fixture;
    const prediction = recommend({ provider: plan.provider, prompt: fixture.prompt, allowFast: fixture.allowFast === true });
    assert.deepEqual(plan.expected, { tier: prediction.tier, effort: prediction.effort, model: chooseModel(plan.provider, prediction.tier) });
    assert.equal(calls[index * 2].source, fixture.broken);
    assert.equal(calls[index * 2 + 1].source, fixture.fixed);
    assert.deepEqual(plan.command.slice(1), ['run', fixture.prompt, '--provider', plan.provider, '--cwd', plan.cwd,
      '--allow-write', '--max-attempts', '2', ...(fixture.allowFast ? ['--allow-fast'] : []), '--json', '--', 'node', 'test.mjs']);
    await assert.rejects(access(plan.cwd), { code: 'ENOENT' });
  }
  assert.equal(lines.filter(line => line.startsWith('Plan {')).length, 9);
  assert.match(lines.at(-1), /No provider started; --live is required/);
});

test('CLI without live never starts configured provider executables or writes --out', async t => {
  const scratch = await mkdtemp(join(tmpdir(), 'effort-acceptance-test-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const marker = join(scratch, 'provider-started');
  const trap = join(scratch, 'provider.mjs');
  await writeFile(trap, `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(marker)}, 'started');\nprocess.exit(99);\n`);
  const output = join(scratch, 'runs.jsonl');
  const child = spawnSync(process.execPath, [entry, '--providers', 'codex', '--max-runs', '3', '--out', output], { cwd: scratch, shell: false,
    encoding: 'utf8', timeout: 60_000, env: { ...process.env,
      EFFORT_CODEX_BIN: trap, EFFORT_CLAUDE_BIN: trap, EFFORT_GEMINI_BIN: trap } });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr);
  const plans = child.stdout.split('\n').filter(line => line.startsWith('Plan {')).map(line => JSON.parse(line.slice(5)));
  assert.equal(plans.length, 3);
  assert.deepEqual([...new Set(plans.map(plan => plan.provider))], ['codex']);
  assert.match(child.stdout, /3 starting workspaces fail; reference fixes pass/);
  await assert.rejects(access(marker), { code: 'ENOENT' });
  await assert.rejects(access(output), { code: 'ENOENT' });
});

test('provider selection and run cap are checked before any subprocess starts', async () => {
  const options = { runCommand: () => assert.fail('unexpected subprocess'), print: () => {} };
  for (const args of [
    ['--providers', 'codex,claude', '--max-runs', '5'], ['--max-runs', '0'], ['--max-runs', '1.5'],
    ['--providers', 'unknown'], ['--providers', ''], ['--providers', 'codex,codex'],
  ]) await assert.rejects(runAcceptance(args, options));
});

test('acceptance records keep reported evidence and per-attempt usage without provider text', () => {
  const task = { model: 'haiku', modelSelection: 'automatic', status: 'verified', text: 'private response', prompt: 'private prompt', attempts: [
    { effort: 'low', effortEvidence: { observedModel: 'claude-haiku-5-5', model: 'haiku', configuredEffort: 'low',
      observedLabel: 'Haiku', thinkingTokens: 0, privateField: 'private evidence' }, usage: { inputTokens: 12, costUsd: 0.01 } },
    { effort: 'low', usage: { inputTokens: 20, costUsd: 0.03 } },
  ] };
  const record = recordResult('claude', cases[0], task, 123);
  assert.equal(record.costUsd, 0.03);
  assert.deepEqual(record.usage, task.attempts.map(attempt => attempt.usage));
  assert.equal(record.effortEvidence.thinkingTokens, 0);
  assert.equal(record.attempts, 2);
  assert.equal(record.wallTimeMs, 123);
  assert.doesNotMatch(JSON.stringify(record), /private/);
  const missing = recordResult('codex', cases[0], {}, 1);
  assert.equal(missing.status, 'blocked');
  assert.deepEqual(missing.effortEvidence, {});
  assert.equal(Object.hasOwn(missing, 'costUsd'), false);
  assert.equal(Object.hasOwn(missing, 'usage'), false);
});

test('cancellation stops offline work before another subprocess starts', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(runAcceptance(['--providers', 'codex'], { signal: controller.signal,
    print: () => {}, runCommand: () => assert.fail('unexpected subprocess') }), /Acceptance interrupted/);
});
