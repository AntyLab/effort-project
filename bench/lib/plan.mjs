import { join } from 'node:path';
import { BENCH_DIR } from './corpus.mjs';
import { seededRandom, shuffle } from './random.mjs';

export const PROVIDERS = Object.freeze(['codex', 'claude']);

// Each arm is one runTask configuration. Within a provider every arm gets the
// same prompts, fresh fixture copies, visible check, time limit and model.
export const ARMS = Object.freeze({
  'fixed-low': Object.freeze({ effort: 'low', maxEffort: 'high', maxAttempts: 1, label: 'Fixed low effort, one attempt' }),
  'fixed-medium': Object.freeze({ effort: 'medium', maxEffort: 'high', maxAttempts: 1, label: 'Fixed medium effort, one attempt' }),
  'fixed-high': Object.freeze({ effort: 'high', maxEffort: 'high', maxAttempts: 1, label: 'Fixed high effort, one attempt' }),
  'auto-rules': Object.freeze({ effort: 'auto', maxEffort: 'high', maxAttempts: 1, label: 'Effort rules choose the level, one attempt' }),
  'auto-escalate': Object.freeze({ effort: 'auto', maxEffort: 'high', maxAttempts: 3, label: '`effort run` defaults: rules choose, failed checks retry, repeated failures escalate' }),
  // Opt-in arms. medium-escalate is the architecture.md baseline; medium-retry
  // keeps the retries but never escalates, separating the two effects.
  'medium-escalate': Object.freeze({ effort: 'medium', maxEffort: 'high', maxAttempts: 3, optional: true, label: 'Start at medium, retry and escalate like effort run' }),
  'medium-retry': Object.freeze({ effort: 'medium', maxEffort: 'medium', maxAttempts: 3, optional: true, label: 'Start at medium, retry on failed checks, never escalate' }),
});
export const DEFAULT_ARMS = Object.freeze(['fixed-low', 'fixed-medium', 'fixed-high', 'auto-rules', 'auto-escalate']);

export const FAKE_CLI = Object.freeze({
  codex: join(BENCH_DIR, 'fake', 'codex.mjs'),
  claude: join(BENCH_DIR, 'fake', 'claude.mjs'),
});

/** Parse a comma-separated option against an allowed list, keeping the given order. */
export function parseList(value, allowed, name) {
  const items = [...new Set(String(value).split(',').map((item) => item.trim()).filter(Boolean))];
  const unknown = items.filter((item) => !allowed.includes(item));
  if (unknown.length) throw new Error(`Unknown ${name}: ${unknown.join(', ')}. Choose from ${allowed.join(', ')}.`);
  if (!items.length) throw new Error(`Choose at least one ${name}.`);
  return items;
}

export const runKey = ({ provider, task, arm, repeat }) => `${provider}/${task}/${arm}/${repeat}`;

/**
 * Every (task, arm, repeat) combination for each provider, shuffled with a
 * seeded generator so order effects (warm caches, provider load, time of day)
 * do not line up with arms. The same seed always gives the same order.
 */
export function buildSchedule({ taskIds, arms, providers, repeats, seed }) {
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 100) throw new Error('--repeats must be an integer from 1 to 100.');
  if (typeof seed !== 'string' || !seed) throw new Error('--seed must be a nonempty string.');
  const schedule = [];
  for (const provider of providers) {
    const entries = [];
    for (const task of taskIds) for (const arm of arms) for (let repeat = 1; repeat <= repeats; repeat++) entries.push({ provider, task, arm, repeat });
    shuffle(entries, seededRandom(`${seed}/${provider}`)).forEach((entry, index) => schedule.push({ ...entry, order: index + 1, key: runKey(entry) }));
  }
  return schedule;
}

/** The most provider turns a schedule can start: each run makes up to its arm's maxAttempts turns. */
export const maxProviderTurns = (schedule) => schedule.reduce((sum, entry) => sum + ARMS[entry.arm].maxAttempts, 0);

export class SpendGuardError extends Error {}

/** Refuse before any provider starts: live runs need an explicit cap, and no plan may exceed its cap. */
export function checkSpendGuard({ live, maxRuns, runs }) {
  if (maxRuns !== undefined && (!Number.isInteger(maxRuns) || maxRuns < 0)) throw new SpendGuardError('--max-runs must be a non-negative integer.');
  if (live && maxRuns === undefined) {
    throw new SpendGuardError(`--live needs --max-runs N, the most provider runs you accept paying for. This plan has ${runs} run(s).`);
  }
  if (maxRuns !== undefined && runs > maxRuns) {
    throw new SpendGuardError(`This plan has ${runs} run(s), more than --max-runs ${maxRuns}. Narrow --tasks, --arms, --providers or --repeats, or raise --max-runs.`);
  }
}

/**
 * How the adapter launches its CLI. Offline mode always runs a fake CLI script
 * with this Node binary, so no real provider can start without --live.
 */
export function providerLaunch(provider, { live, bin, fakeConfig } = {}) {
  if (!live) {
    if (!fakeConfig) throw new Error('Offline runs need a fake provider configuration.');
    return { executable: process.execPath, executableArgs: [FAKE_CLI[provider], '--bench-config', fakeConfig] };
  }
  if (!bin) return {};
  return /\.[cm]?js$/i.test(bin) ? { executable: process.execPath, executableArgs: [bin] } : { executable: bin, executableArgs: [] };
}
