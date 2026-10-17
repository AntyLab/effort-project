import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { describe, newcombePaired, nonInferiority, normalizeUsage, quantile, totalUsage, wilson } from '../bench/lib/stats.mjs';
import { ARMS, DEFAULT_ARMS, FAKE_CLI, SpendGuardError, buildSchedule, checkSpendGuard, maxProviderTurns, parseList, providerLaunch, runKey } from '../bench/lib/plan.mjs';
import { aggregate, pairRuns, renderSummary } from '../bench/lib/report.mjs';
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

test('the paired Newcombe interval reproduces a published worked example', () => {
  // StatsDirect's paired-proportions example (data from Armitage and Berry 1994, p. 138):
  // 50 specimens, both media positive 20, first only 12, second only 2, neither 16.
  // Printed "Score based (Newcombe)" interval: 0.056156 to 0.329207.
  const difference = newcombePaired(20, 12, 2, 16);
  close(difference.estimate, 0.2, 1e-12);
  close(difference.lower, 0.056156, 1e-6);
  close(difference.upper, 0.329207, 1e-6);
});

test('the paired Newcombe interval matches hand-computed values at its edge cases', () => {
  // Negative correlation is used as is: 8/8/8/6 has AD − BC = 48 − 64, phi = −16/224.
  // Wilson for 16/30 is 0.361423 to 0.697676, so each half-width is
  // sqrt(0.171910² + 2·(16/224)·0.171910·0.164343 + 0.164343²) = 0.246166.
  const negative = newcombePaired(8, 8, 8, 6);
  close(negative.estimate, 0, 1e-12);
  close(negative.lower, -0.246166, 1e-6);
  close(negative.upper, 0.246166, 1e-6);
  // When every pair passed, a margin is empty and phi is 0: the half-width is the
  // Wilson distance for 10/10, 1 − 0.722467 (the same 0.2775 as Wilson(0, 10)).
  const allPassed = newcombePaired(10, 0, 0, 0);
  close(allPassed.lower, -0.277533, 1e-6);
  close(allPassed.upper, 0.277533, 1e-6);
  // A positive AD − BC no larger than n/2 is corrected to 0 (2·2 − 1·1 = 3 = 6/2), so
  // the halves combine as if uncorrelated.
  const w = wilson(3, 6);
  const corrected = newcombePaired(2, 1, 1, 2);
  close(corrected.upper, Math.hypot(w.upper - w.estimate, w.estimate - w.lower), 1e-12);
  close(corrected.lower, -corrected.upper, 1e-12);
  assert.equal(newcombePaired(0, 0, 0, 0), null);
  for (const cells of [[1, -1, 0, 0], [1.5, 0, 0, 0], [1, 0, Number.NaN, 0]]) assert.throws(() => newcombePaired(...cells), RangeError);
});

test('pairing can change the non-inferiority verdict for the same pass rates', () => {
  // Both tables have arm 80/100 and reference 81/100. As two independent samples
  // (Newcombe's method 10 for independent proportions) that is −12.0 to +10.0 pp,
  // inconclusive against a 5 pp margin.
  // Arm and reference fail on the same 19 runs: the pairs agree, the interval is narrow.
  const agreeing = newcombePaired(80, 0, 1, 19);
  close(agreeing.estimate, -0.01, 1e-12);
  close(agreeing.lower, -0.046101, 1e-6);
  close(agreeing.upper, 0.024455, 1e-6);
  assert.equal(nonInferiority(agreeing, 0.05), 'non-inferior');
  // The same pass rates with the failures on different runs: 39 discordant pairs.
  const disagreeing = newcombePaired(61, 19, 20, 0);
  close(disagreeing.lower, -0.132010, 1e-6);
  close(disagreeing.upper, 0.112392, 1e-6);
  assert.equal(nonInferiority(disagreeing, 0.05), 'inconclusive');
});

test('the reference comparison pairs runs by task and repeat and sets unpaired runs aside', () => {
  const tasks = Array.from({ length: 21 }, (_, index) => ({ id: `t${index + 1}`, language: 'node', difficulty: 'easy' }));
  const meta = { arms: [{ name: 'fixed-high' }, { name: 'auto-rules' }], providers: ['codex'], referenceArm: 'fixed-high', margin: 0.05, tasks, repeats: 5, mode: 'fake' };
  const record = (task, arm, repeat, accepted, extra = {}) => ({ key: runKey({ provider: 'codex', task, arm, repeat }), provider: 'codex', task, arm, repeat, accepted, ...extra });
  const records = [];
  // 100 pairs over t1–t20 × 5 repeats: 80 both passed, 1 only the reference passed, 19 neither.
  for (let index = 0; index < 100; index++) {
    const task = `t${Math.floor(index / 5) + 1}`;
    const repeat = (index % 5) + 1;
    records.push(record(task, 'auto-rules', repeat, index < 80), record(task, 'fixed-high', repeat, index <= 80));
  }
  // t21 repeat 1: the reference run hit a harness error. t21 repeat 2: the arm run is missing.
  records.push(record('t21', 'auto-rules', 1, true), record('t21', 'fixed-high', 1, false, { harnessError: 'disk full' }));
  records.push(record('t21', 'fixed-high', 2, true));

  const [summary] = aggregate(records, meta).providers;
  const [arm, reference] = [summary.arms.find((entry) => entry.arm === 'auto-rules'), summary.arms.find((entry) => entry.arm === 'fixed-high')];
  assert.deepEqual([arm.passed, arm.runs, reference.passed, reference.runs], [81, 101, 82, 101], 'unpaired runs still count in their own arm');
  const [comparison] = summary.comparisons;
  assert.deepEqual(comparison.pairs, { both: 80, armOnly: 0, referenceOnly: 1, neither: 19, pairs: 100, unpairedArm: 1, unpairedReference: 1 });
  close(comparison.difference.lower, -0.046101, 1e-6);
  close(comparison.difference.upper, 0.024455, 1e-6);
  assert.equal(comparison.verdict, 'non-inferior');

  const { markdown } = renderSummary(meta, records);
  assert.match(markdown, /\| `auto-rules` \| 100 \(unpaired: 1 arm, 1 reference\) \| 0 \/ 1 \| −1\.0 pp \(−4\.6 pp to \+2\.4 pp\) \| non-inferior \|/);
  assert.match(markdown, /`auto-rules`: pass rate −1\.0 pp \(95% CI −4\.6 pp to \+2\.4 pp, 100 paired runs\), \*\*non-inferior\*\*/);

  // Pairing never crosses providers, and an arm with no partners has no difference.
  const lonely = pairRuns([record('t1', 'auto-rules', 1, true)], [{ ...record('t1', 'fixed-high', 1, true), provider: 'claude' }]);
  assert.deepEqual(lonely, { both: 0, armOnly: 0, referenceOnly: 0, neither: 0, pairs: 0, unpairedArm: 1, unpairedReference: 1 });
  assert.equal(newcombePaired(lonely.both, lonely.armOnly, lonely.referenceOnly, lonely.neither), null);
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
