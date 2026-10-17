// Shared behavior of the offline fake providers. Everything here is synthetic:
// it exists so the harness can run end to end without credentials, and says
// nothing about how a real model behaves at any effort level.
import { cp, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { unitHash } from '../lib/random.mjs';

export const FAKE_VERSION = 'effort-bench-fake/1';
const CONFIG_SCHEMA = 'effort-bench-fake-config/1';

// Made-up chance of "solving" a task in one turn, by difficulty and effort.
export const SOLVE_PROBABILITY = Object.freeze({
  easy: Object.freeze({ low: 0.8, medium: 0.9, high: 0.95 }),
  medium: Object.freeze({ low: 0.45, medium: 0.7, high: 0.85 }),
  hard: Object.freeze({ low: 0.15, medium: 0.4, high: 0.65 }),
});
// A later turn sees the failed check's output, so it does a little better.
export const RETRY_BONUS = 0.1;
export const TOKENS_PER_TURN = Object.freeze({
  low: Object.freeze({ input: 9_000, output: 600 }),
  medium: Object.freeze({ input: 12_000, output: 1_600 }),
  high: Object.freeze({ input: 16_000, output: 4_000 }),
});
const DIFFICULTY_SCALE = Object.freeze({ easy: 1, medium: 1.5, hard: 2.2 });
// Synthetic price used only so the cost columns have something to show.
export const FAKE_USD_PER_TOKEN = 1e-6;

export function fakeRunConfig({ provider, task, repeat, seed, stateFile, model }) {
  return {
    schema: CONFIG_SCHEMA, provider, taskId: task.id, difficulty: task.difficulty,
    solutionDir: task.solutionDir, repeat, seed, stateFile, model: model ?? null,
  };
}

/** Parse the leading `--bench-config <file>` arguments that the harness always passes first. */
export async function readConfig(argv) {
  if (argv[0] !== '--bench-config' || !argv[1]) throw new Error('The fake provider must be started with --bench-config <file> first.');
  const config = JSON.parse(await readFile(argv[1], 'utf8'));
  if (config?.schema !== CONFIG_SCHEMA || !(config.difficulty in SOLVE_PROBABILITY)) throw new Error('Invalid fake provider configuration.');
  return { config, args: argv.slice(2) };
}

// State persists across the separate processes of one benchmark run (one per attempt).
export async function readState(config) {
  try { return JSON.parse(await readFile(config.stateFile, 'utf8')); } catch { return { turns: 0, sessions: {} }; }
}

export async function writeState(config, state) {
  const temporary = `${config.stateFile}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(state));
  await rename(temporary, config.stateFile);
}

/**
 * One simulated agent turn. The draw ignores the arm (common random numbers),
 * so for a given task and repeat a turn that succeeds at low also succeeds at
 * higher effort. A success copies the reference solution into the workspace;
 * a failure leaves it unchanged.
 */
export async function simulateTurn(config, state, { cwd, effort, canWrite }) {
  if (!(effort in TOKENS_PER_TURN)) throw new Error(`Unsupported effort: ${effort}`);
  state.turns += 1;
  const attempt = state.turns;
  const probability = Math.min(0.99, SOLVE_PROBABILITY[config.difficulty][effort] + (attempt > 1 ? RETRY_BONUS : 0));
  const solved = canWrite && unitHash(config.seed, config.provider, config.taskId, config.repeat, attempt) < probability;
  if (solved) await cp(config.solutionDir, cwd, { recursive: true, force: true });
  const scale = DIFFICULTY_SCALE[config.difficulty] * (0.8 + 0.4 * unitHash(config.seed, config.provider, config.taskId, config.repeat, attempt, 'usage'));
  const inputTokens = Math.round(TOKENS_PER_TURN[effort].input * scale);
  const outputTokens = Math.round(TOKENS_PER_TURN[effort].output * scale);
  return {
    solved,
    usage: { inputTokens, outputTokens, cachedInputTokens: Math.round(inputTokens * 0.6) },
    text: solved ? 'Fake provider: applied the reference solution.' : 'Fake provider: left the workspace unchanged.',
  };
}
