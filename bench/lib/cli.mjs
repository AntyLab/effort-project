import { parseArgs } from 'node:util';
import { readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { recommend } from '../../src/policy.mjs';
import { repositoryFacts } from '../../src/repository.mjs';
import { BENCH_DIR, DEFAULT_MANIFEST, findPython, loadCorpus, selectTasks, selfTestTask } from './corpus.mjs';
import { ARMS, DEFAULT_ARMS, PROVIDERS, SpendGuardError, buildSchedule, checkSpendGuard, maxProviderTurns, parseList } from './plan.mjs';
import { readRecords, runBenchmark } from './execute.mjs';
import { aggregate, writeReport } from './report.mjs';

export const HELP = `Effort benchmark harness

  node bench/run.mjs [run] [options]     Run the benchmark (offline fake providers unless --live)
  node bench/run.mjs plan [options]      Show tasks, arms, run counts and the rules' effort picks
  node bench/run.mjs report <dir>        Rebuild summary.md and charts from <dir>/runs.jsonl
  node bench/run.mjs self-test           Check every task: hidden check fails at start, passes on the solution

Selection
  --providers codex,claude    Providers to run (default: both)
  --arms a,b                  ${Object.keys(ARMS).join(', ')}
                              (default: ${DEFAULT_ARMS.join(', ')})
  --tasks id,id | all         Task ids from the manifest (default: all)
  --language node|python      Only tasks in this language
  --repeats N                 Repeats of every task and arm (default: 1)
  --seed TEXT                 Seed for the randomized run order (default: effort-bench)

Execution
  --timeout SECONDS           Time limit per run, all attempts included (default: 60 offline, 600 live; max 1800)
  --out DIR                   Output directory (default: bench/results/<time>-<mode>)
  --resume                    Continue an interrupted benchmark in --out with the same options
  --keep-workspaces           Keep each run's temporary workspace for inspection
  --work-root DIR             Where temporary workspaces are created (default: the OS temp directory)
  --python PATH               Python 3.8+ interpreter for Python tasks (or EFFORT_BENCH_PYTHON)
  --manifest PATH             Use another task manifest, e.g. a private held-out corpus
  --margin FRACTION           Non-inferiority margin for pass rates, fixed at start (default: 0.05)
  --reference-arm ARM         Arm the others are compared with (default: fixed-high)
  --verbose                   Also print each attempt as it starts

Real providers (billed or plan-limited usage)
  --live                      Required to start any real Codex or Claude turn
  --max-runs N                Required with --live: refuse plans with more than N runs
  --codex-model ID            Pin the Codex model (recommended)
  --claude-model ID           Pin the Claude model (recommended)
  --codex-bin PATH            Codex executable or JavaScript entry point (default: codex)
  --claude-bin PATH           Claude executable or JavaScript entry point (default: claude)

Without --live, both providers are replaced by local fake CLIs (bench/fake/) that
need no credentials and produce synthetic results. See bench/README.md.
`;

const OPTIONS = {
  help: { type: 'boolean', short: 'h' },
  live: { type: 'boolean' },
  providers: { type: 'string' },
  arms: { type: 'string' },
  tasks: { type: 'string' },
  language: { type: 'string' },
  repeats: { type: 'string' },
  seed: { type: 'string' },
  timeout: { type: 'string' },
  'max-runs': { type: 'string' },
  out: { type: 'string' },
  resume: { type: 'boolean' },
  'keep-workspaces': { type: 'boolean' },
  'work-root': { type: 'string' },
  python: { type: 'string' },
  manifest: { type: 'string' },
  margin: { type: 'string' },
  'reference-arm': { type: 'string' },
  verbose: { type: 'boolean' },
  json: { type: 'boolean' },
  'codex-model': { type: 'string' },
  'claude-model': { type: 'string' },
  'codex-bin': { type: 'string' },
  'claude-bin': { type: 'string' },
};

class UsageError extends Error {}

function integer(value, name, { min, max }) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new UsageError(`${name} must be an integer from ${min} to ${max}.`);
  return number;
}

const stamp = () => new Date().toISOString().replace(/\..+$/, '').replace(/[-:]/g, '').replace('T', '-');

/** Turn parsed flags into validated benchmark settings. Nothing is executed here. */
export async function resolveSettings(values) {
  const live = Boolean(values.live);
  for (const name of ['codex-bin', 'claude-bin']) if (values[name] && !live) throw new UsageError(`--${name} only applies with --live.`);
  const corpus = await loadCorpus(values.manifest ? resolve(values.manifest) : DEFAULT_MANIFEST);
  const tasks = selectTasks(corpus.tasks, { ids: values.tasks, language: values.language });
  const providers = parseList(values.providers ?? PROVIDERS.join(','), PROVIDERS, 'provider');
  const arms = parseList(values.arms ?? DEFAULT_ARMS.join(','), Object.keys(ARMS), 'arm');
  const repeats = values.repeats === undefined ? 1 : integer(values.repeats, '--repeats', { min: 1, max: 100 });
  const seconds = values.timeout === undefined ? (live ? 600 : 60) : Number(values.timeout);
  if (!Number.isFinite(seconds) || seconds < 1 || seconds > 1800) throw new UsageError('--timeout must be 1–1,800 seconds.');
  const maxRuns = values['max-runs'] === undefined ? undefined : integer(values['max-runs'], '--max-runs', { min: 0, max: 1_000_000 });
  const margin = values.margin === undefined ? 0.05 : Number(values.margin);
  if (!Number.isFinite(margin) || margin < 0 || margin > 0.5) throw new UsageError('--margin must be a fraction from 0 to 0.5, for example 0.05.');
  let referenceArm = values['reference-arm'] ?? 'fixed-high';
  if (!arms.includes(referenceArm)) {
    if (values['reference-arm']) throw new UsageError(`--reference-arm ${referenceArm} is not one of the selected arms.`);
    referenceArm = null;
  }
  const workRoot = resolve(values['work-root'] ?? tmpdir());
  if (!(await stat(workRoot).catch(() => null))?.isDirectory()) throw new UsageError(`--work-root ${workRoot} is not a directory.`);
  if (values.resume && !values.out) throw new UsageError('--resume needs --out with the directory to continue.');
  const python = tasks.some((task) => task.language === 'python') ? findPython({ override: values.python ?? process.env.EFFORT_BENCH_PYTHON }) : null;
  return {
    corpus, tasks, providers, arms, repeats, live, maxRuns, margin, referenceArm, workRoot, python,
    seed: values.seed ?? 'effort-bench',
    timeoutMs: Math.round(seconds * 1000),
    outDir: resolve(values.out ?? join(BENCH_DIR, 'results', `${stamp()}-${live ? 'live' : 'fake'}`)),
    resume: Boolean(values.resume),
    keepWorkspaces: Boolean(values['keep-workspaces']),
    models: { codex: values['codex-model'], claude: values['claude-model'] },
    bins: { codex: values['codex-bin'] && resolve(values['codex-bin']), claude: values['claude-bin'] && resolve(values['claude-bin']) },
  };
}

async function planCommand(settings, { json, write }) {
  const schedule = buildSchedule({ taskIds: settings.tasks.map((task) => task.id), arms: settings.arms, providers: settings.providers, repeats: settings.repeats, seed: settings.seed });
  const tasks = [];
  for (const task of settings.tasks) {
    const pick = recommend({ prompt: task.prompt, provider: 'generic', facts: await repositoryFacts(task.repoDir, task.prompt) });
    tasks.push({ id: task.id, language: task.language, difficulty: task.difficulty, category: task.category, rulesPick: pick.effort });
  }
  const plan = {
    mode: settings.live ? 'live' : 'fake', tasks, arms: settings.arms.map((name) => ({ name, ...ARMS[name] })), providers: settings.providers,
    repeats: settings.repeats, seed: settings.seed, timeoutSeconds: settings.timeoutMs / 1000,
    runsPerProvider: schedule.length / settings.providers.length, runs: schedule.length, maxProviderTurns: maxProviderTurns(schedule),
  };
  if (json) return write(`${JSON.stringify(plan, null, 2)}\n`);
  const width = Math.max(...tasks.map((task) => task.id.length));
  write([
    `Effort benchmark plan (${settings.live ? 'LIVE providers' : 'offline fake providers'})`,
    '',
    `Tasks (${tasks.length}):`,
    ...tasks.map((task) => `  ${task.id.padEnd(width)}  ${task.language.padEnd(6)}  ${task.difficulty.padEnd(6)}  ${task.category.padEnd(12)}  rules pick: ${task.rulesPick}`),
    '',
    `Arms: ${plan.arms.map((arm) => `${arm.name} (${arm.maxAttempts === 1 ? '1 attempt' : `up to ${arm.maxAttempts} attempts`})`).join(', ')}`,
    `Providers: ${plan.providers.join(', ')}; repeats ${plan.repeats}; seed "${plan.seed}"; ${plan.timeoutSeconds} s per run`,
    `Runs: ${plan.runsPerProvider} per provider, ${plan.runs} in total, at most ${plan.maxProviderTurns} provider turns`,
    settings.live ? `Spend guard: this plan needs --max-runs ${plan.runs} or higher.` : 'Live equivalent: add --live --max-runs ' + plan.runs + ' (real usage; see bench/README.md).',
    '',
  ].join('\n'));
}

async function selfTestCommand(settings, { json, write }) {
  const results = [];
  const queue = [...settings.tasks];
  // A few tasks at a time keeps the number of concurrent processes modest.
  await Promise.all(Array.from({ length: 3 }, async () => {
    for (let task = queue.shift(); task; task = queue.shift()) results.push(await selfTestTask(task, { python: settings.python }));
  }));
  results.sort((a, b) => settings.tasks.findIndex((task) => task.id === a.id) - settings.tasks.findIndex((task) => task.id === b.id));
  if (json) write(`${JSON.stringify(results, null, 2)}\n`);
  else {
    for (const result of results) {
      if (result.status === 'skipped') { write(`- ${result.id}: skipped (${result.reason})\n`); continue; }
      write(`${result.status === 'passed' ? '✔' : '✖'} ${result.id}: hidden check ${result.checks.acceptStart} at start, ${result.checks.acceptSolved} on solution; visible check ${result.checks.visibleStart} at start, ${result.checks.visibleSolved} on solution\n`);
      for (const problem of result.problems) write(`    ${problem}\n`);
      for (const [name, output] of Object.entries(result.output ?? {})) write(`    --- ${name} output (tail) ---\n${output.replace(/^/gm, '    ')}\n`);
    }
    const failed = results.filter((result) => result.status === 'failed').length;
    const skipped = results.filter((result) => result.status === 'skipped').length;
    write(`\n${results.length - failed - skipped} passed, ${failed} failed, ${skipped} skipped.\n`);
  }
  return results.some((result) => result.status === 'failed') ? 1 : 0;
}

async function reportCommand(directory, { write }) {
  if (!directory) throw new UsageError('Usage: node bench/run.mjs report <results directory>');
  const outDir = resolve(directory);
  const meta = JSON.parse(await readFile(join(outDir, 'meta.json'), 'utf8'));
  const records = await readRecords(join(outDir, 'runs.jsonl'));
  const { summaryPath } = await writeReport({ outDir, meta, records });
  write(`Wrote ${summaryPath}\n`);
}

function printTotals(meta, records, write) {
  const { providers } = aggregate(records, meta);
  for (const summary of providers) {
    if (!summary.runs) continue;
    write(`${summary.provider}: ${summary.arms.filter((arm) => arm.runs).map((arm) => `${arm.arm} ${arm.passed}/${arm.runs}`).join(', ')}\n`);
  }
}

/** CLI entry point. Returns the process exit code. */
export async function main(argv, { stdout = process.stdout, stderr = process.stderr, signal } = {}) {
  const write = (text) => stdout.write(text);
  try {
    const { values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true });
    if (values.help) { write(HELP); return 0; }
    const [command = 'run', ...rest] = positionals;
    if (command === 'report') { await reportCommand(rest[0], { write }); return 0; }
    if (!['run', 'plan', 'self-test'].includes(command)) throw new UsageError(`Unknown command "${command}". Use run, plan, report or self-test.`);
    if (rest.length) throw new UsageError(`Unexpected argument: ${rest[0]}`);
    const settings = await resolveSettings(values);
    if (command === 'plan') { await planCommand(settings, { json: values.json, write }); return 0; }
    if (command === 'self-test') return await selfTestCommand(settings, { json: values.json, write });

    const schedule = buildSchedule({ taskIds: settings.tasks.map((task) => task.id), arms: settings.arms, providers: settings.providers, repeats: settings.repeats, seed: settings.seed });
    // Fail fast, before loading anything else, when a live plan exceeds its cap.
    if (!settings.resume) checkSpendGuard({ live: settings.live, maxRuns: settings.maxRuns, runs: schedule.length });
    const where = relative(process.cwd(), settings.outDir) || '.';
    stderr.write(settings.live
      ? `LIVE benchmark: ${schedule.length} run(s), at most ${maxProviderTurns(schedule)} provider turns on your signed-in ${settings.providers.join(' and ')} account(s). Ctrl+C stops after cancelling the current run.\n`
      : `Offline benchmark with fake providers: ${schedule.length} run(s). No real provider is started.\n`);
    const result = await runBenchmark({ ...settings, signal, log: (line, { verbose = false } = {}) => { if (!verbose || values.verbose) stderr.write(`${line}\n`); } });
    printTotals(result.meta, await readRecords(result.runsPath), write);
    write(`\nRuns: ${relative(process.cwd(), result.runsPath)}\nSummary: ${relative(process.cwd(), result.summaryPath)}\n`);
    if (result.interrupted) {
      stderr.write(`Interrupted. To continue, rerun with the same options plus --out "${where}" --resume\n`);
      return 130;
    }
    return 0;
  } catch (error) {
    stderr.write(`bench: ${error.message}\n`);
    return error instanceof SpendGuardError ? 2 : 1;
  }
}
