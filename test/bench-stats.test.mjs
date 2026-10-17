import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { describe, newcombe, nonInferiority, normalizeUsage, quantile, totalUsage, wilson } from '../bench/lib/stats.mjs';
import { ARMS, DEFAULT_ARMS, FAKE_CLI, SpendGuardError, buildSchedule, checkSpendGuard, maxProviderTurns, parseList, providerLaunch } from '../bench/lib/plan.mjs';
import { seededRandom, shuffle, unitHash } from '../bench/lib/random.mjs';
import { compact, isRoutingArm } from '../bench/lib/chart.mjs';

const close = (actual, expected, tolerance = 5e-4) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);

test('Wilson intervals match reference values and handle the edges', () => {
  const half = wilson(5, 10);
  close(half.lower, 0.2366);
  close(half.upper, 0.7634);
  const none = wilson(0, 10);
  assert.equal(none.lower, 0);
  close(none.upper, 0.2775);
  const all = wilson(10, 10);
  close(all.lower, 0.7225);
  close(all.upper, 1, 1e-12);
  assert.equal(wilson(0, 0), null);
  for (const [successes, trials] of [[3, 2], [-1, 2], [1.5, 2], [1, -1]]) assert.throws(() => wilson(successes, trials), RangeError);
});

test('the Newcombe difference interval reproduces the published worked example', () => {
  // Newcombe (1998), method 10, example 56/70 versus 48/80.
  const difference = newcombe(56, 70, 48, 80);
  close(difference.estimate, 0.2, 1e-12);
  close(difference.lower, 0.0524);
  close(difference.upper, 0.3339);
  assert.equal(newcombe(0, 0, 1, 1), null);
});

test('non-inferiority verdicts follow the predefined margin', () => {
  assert.equal(nonInferiority({ estimate: 0, lower: -0.04, upper: 0.04 }, 0.05), 'non-inferior');
  assert.equal(nonInferiority({ estimate: -0.15, lower: -0.25, upper: -0.06 }, 0.05), 'inferior');
  assert.equal(nonInferiority({ estimate: -0.02, lower: -0.12, upper: 0.08 }, 0.05), 'inconclusive');
  assert.equal(nonInferiority(null, 0.05), 'no data');
});

test('summaries leave unknown values out instead of counting them as zero', () => {
  const stats = describe([10, null, 30, undefined, Number.NaN, 20]);
  assert.equal(stats.n, 3);
  assert.equal(stats.median, 20);
  assert.equal(stats.sum, 60);
  assert.equal(stats.p25, 15);
  assert.equal(stats.p75, 25);
  assert.deepEqual(describe([null, null]), { n: 0, median: null, p25: null, p75: null, sum: null });
  assert.equal(quantile([], 0.5), null);
});

test('run usage is known only when every attempt reported it', () => {
  const first = normalizeUsage({ inputTokens: 10, outputTokens: 5, cachedInputTokens: 2, costUsd: 0.25 });
  const second = normalizeUsage({ inputTokens: 20, outputTokens: 1, cachedInputTokens: 0, costUsd: 0.5 });
  const total = totalUsage([first, second]);
  assert.equal(total.inputTokens, 30);
  assert.equal(total.outputTokens, 6);
  assert.equal(total.totalTokens, 36);
  assert.equal(total.costUsd, 0.75);
  assert.equal(total.attemptsWithTokens, 2);

  // A resumed Claude turn reports a conversation-scoped cost and no per-turn tokens.
  const resumed = normalizeUsage({ inputTokens: null, outputTokens: null, cachedInputTokens: null, costUsd: null, conversationCostUsd: 0.9, costScope: 'conversation', tokenScope: 'unverified-on-resume' });
  assert.equal(resumed.costUsd, null);
  assert.equal(resumed.conversationCostUsd, 0.9);
  const mixed = totalUsage([first, resumed]);
  assert.equal(mixed.totalTokens, null, 'a partial sum must not pass for the run total');
  assert.equal(mixed.inputTokens, null);
  assert.equal(mixed.costUsd, null);
  assert.equal(mixed.attemptsWithTokens, 1);

  assert.deepEqual(normalizeUsage({ inputTokens: -1, outputTokens: '7', cachedInputTokens: Infinity }), { inputTokens: null, outputTokens: null, cachedInputTokens: null, costUsd: null });
  assert.equal(normalizeUsage(null).inputTokens, null);
  assert.equal(totalUsage([]).totalTokens, null);
});

test('the schedule is a seeded permutation of every task, arm and repeat for each provider', () => {
  const options = { taskIds: ['a', 'b', 'c'], arms: [...DEFAULT_ARMS], providers: ['codex', 'claude'], repeats: 2, seed: 'seed-1' };
  const schedule = buildSchedule(options);
  assert.equal(schedule.length, 3 * 5 * 2 * 2);
  assert.equal(new Set(schedule.map((entry) => entry.key)).size, schedule.length);
  for (const provider of options.providers) {
    const entries = schedule.filter((entry) => entry.provider === provider);
    assert.equal(entries.length, 30);
    assert.deepEqual(entries.map((entry) => entry.order), Array.from({ length: 30 }, (_, index) => index + 1));
  }
  assert.deepEqual(buildSchedule(options), schedule);
  const reseeded = buildSchedule({ ...options, seed: 'seed-2' });
  assert.notDeepEqual(reseeded.map((entry) => entry.key), schedule.map((entry) => entry.key));
  assert.deepEqual(new Set(reseeded.map((entry) => entry.key)), new Set(schedule.map((entry) => entry.key)));
  // Arms are interleaved rather than run in blocks.
  const firstFive = schedule.slice(0, 5).map((entry) => entry.arm);
  assert.ok(new Set(firstFive).size > 1);
  assert.throws(() => buildSchedule({ ...options, repeats: 0 }), /repeats/);
  assert.throws(() => buildSchedule({ ...options, seed: '' }), /seed/);
});

test('the spend guard refuses live plans without an explicit, sufficient cap', () => {
  assert.throws(() => checkSpendGuard({ live: true, runs: 1 }), (error) => error instanceof SpendGuardError && /--max-runs/.test(error.message));
  assert.throws(() => checkSpendGuard({ live: true, maxRuns: 5, runs: 6 }), SpendGuardError);
  assert.throws(() => checkSpendGuard({ live: false, maxRuns: 2, runs: 3 }), SpendGuardError);
  assert.throws(() => checkSpendGuard({ live: true, maxRuns: -1, runs: 0 }), SpendGuardError);
  checkSpendGuard({ live: true, maxRuns: 6, runs: 6 });
  checkSpendGuard({ live: false, runs: 10_000 });
  const schedule = buildSchedule({ taskIds: ['a'], arms: ['fixed-low', 'auto-escalate'], providers: ['codex'], repeats: 1, seed: 's' });
  assert.equal(maxProviderTurns(schedule), 1 + 3);
});

test('offline launches always use the fake CLIs and live launches never do', () => {
  for (const provider of ['codex', 'claude']) {
    assert.ok(existsSync(FAKE_CLI[provider]));
    const offline = providerLaunch(provider, { live: false, fakeConfig: 'run.json' });
    assert.equal(offline.executable, process.execPath);
    assert.deepEqual(offline.executableArgs, [FAKE_CLI[provider], '--bench-config', 'run.json']);
    assert.throws(() => providerLaunch(provider, { live: false }), /fake provider configuration/);
    assert.deepEqual(providerLaunch(provider, { live: true }), {});
  }
  assert.deepEqual(providerLaunch('claude', { live: true, bin: '/opt/claude/cli.js' }), { executable: process.execPath, executableArgs: ['/opt/claude/cli.js'] });
  assert.deepEqual(providerLaunch('codex', { live: true, bin: 'C:/tools/codex.exe' }), { executable: 'C:/tools/codex.exe', executableArgs: [] });
});

test('arms cover the baselines and match the effort run defaults', () => {
  assert.deepEqual(DEFAULT_ARMS, ['fixed-low', 'fixed-medium', 'fixed-high', 'auto-rules', 'auto-escalate']);
  for (const level of ['low', 'medium', 'high']) assert.deepEqual({ ...ARMS[`fixed-${level}`], label: undefined }, { effort: level, maxEffort: 'high', maxAttempts: 1, label: undefined });
  assert.equal(ARMS['auto-rules'].maxAttempts, 1);
  // `effort run` defaults: --effort auto, --max-effort high, --max-attempts 3.
  assert.deepEqual([ARMS['auto-escalate'].effort, ARMS['auto-escalate'].maxEffort, ARMS['auto-escalate'].maxAttempts], ['auto', 'high', 3]);
  assert.equal(ARMS['medium-retry'].maxEffort, 'medium');
  assert.deepEqual(['auto-rules', 'auto-escalate', 'medium-escalate', 'medium-retry', 'fixed-high'].map(isRoutingArm), [true, true, true, false, false]);
  assert.deepEqual(parseList('fixed-low, auto-rules,fixed-low', Object.keys(ARMS), 'arm'), ['fixed-low', 'auto-rules']);
  assert.throws(() => parseList('fixed-huge', Object.keys(ARMS), 'arm'), /Unknown arm: fixed-huge/);
});

test('seeded randomness is stable and shuffles are permutations', () => {
  assert.equal(unitHash('a', 1), unitHash('a', 1));
  assert.notEqual(unitHash('a', 1), unitHash('a', 2));
  const values = Array.from({ length: 200 }, (_, index) => unitHash('range', index));
  assert.ok(values.every((value) => value >= 0 && value < 1));
  const first = seededRandom('s');
  const second = seededRandom('s');
  assert.deepEqual([first(), first(), first()], [second(), second(), second()]);
  const items = Array.from({ length: 20 }, (_, index) => index);
  assert.deepEqual([...shuffle(items, seededRandom('x'))].sort((a, b) => a - b), items);
  assert.equal(compact(950), '950');
  assert.equal(compact(12_345), '12K');
  assert.equal(compact(1_500), '1.5K');
  assert.equal(compact(2_000_000), '2M');
});
