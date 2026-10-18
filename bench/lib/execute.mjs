import { appendFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { runTask } from '../../src/runner.mjs';
import { getAdapter } from '../../src/registry.mjs';
import { POLICY_VERSION } from '../../src/policy.mjs';
import { CLI_OVERRIDES, providerCommand } from '../../src/provider-cli.mjs';
import { verify } from '../../src/verify.mjs';
import { BENCH_DIR, checkEnvironment, diffSnapshots, materialize, resolveCommand, runAcceptance, snapshot, taskDigest } from './corpus.mjs';
import { ARMS, PROVIDER_FAILURES, buildSchedule, checkSpendGuard, maxProviderTurns, providerLaunch, reportsConversationTotals } from './plan.mjs';
import { normalizeUsage, totalUsage } from './stats.mjs';
import { writeReport } from './report.mjs';
import { FAKE_VERSION, fakeRunConfig, RETRY_BONUS, SOLVE_PROBABILITY, TOKENS_PER_TURN } from '../fake/model.mjs';

export const BENCH_VERSION = '0.1.0';
const RUN_SCHEMA = 'effort-bench-run/1';
const META_SCHEMA = 'effort-bench-meta/1';
// runTask enforces the time limit itself. This outer guard only catches a
// provider process that ignores cancellation.
const GUARD_GRACE_MS = 60_000;
const NULL_STORE = Object.freeze({ async save() {} });
const isVisibleTest = (path) => /^tests?\//.test(path);
const safeMessage = (error) => String(error?.message ?? error).replace(/\s+/g, ' ').slice(0, 500);
const exists = (path) => stat(path).then(() => true, () => false);

// The visible check runs agent-written code too, so it gets the same scrubbed
// environment as the acceptance check instead of the provider's credentials.
const isolatedVerify = (argv, options) => verify(argv, { ...options, env: checkEnvironment(options.env ?? process.env) });

/** Execute one schedule entry and return its JSONL record. Never throws for a run failure. */
export async function executeRun(entry, context) {
  const task = context.tasks.get(entry.task);
  const arm = ARMS[entry.arm];
  const base = {
    schema: RUN_SCHEMA, benchId: context.benchId, key: entry.key, order: entry.order, mode: context.live ? 'live' : 'fake',
    provider: entry.provider, task: task.id, language: task.language, difficulty: task.difficulty, category: task.category,
    arm: entry.arm, repeat: entry.repeat,
  };
  const startedAt = new Date().toISOString();
  const root = await mkdtemp(join(context.workRoot, 'effort-bench-'));
  const workspace = join(root, 'work');
  try {
    await materialize(task, workspace);
    const before = await snapshot(workspace);
    let fakeConfig;
    if (!context.live) {
      fakeConfig = join(root, 'fake-provider.json');
      await writeFile(fakeConfig, JSON.stringify(fakeRunConfig({
        provider: entry.provider, task, repeat: entry.repeat, seed: context.seed,
        stateFile: join(root, 'fake-state.json'), model: context.models[entry.provider],
      })));
    }
    const launch = providerLaunch(entry.provider, { live: context.live, bin: context.bins[entry.provider], fakeConfig });
    const observedModels = new Set();
    const diagnostics = [];
    // Failure codes the provider reported during the latest attempt.
    let attemptCodes = [];
    const onEvent = (event) => {
      if (event?.type === 'session' && typeof event.model === 'string') observedModels.add(event.model.slice(0, 200));
      // Codes only: messages can contain provider or task text.
      if (['diagnostic', 'error'].includes(event?.type) && diagnostics.length < 20) diagnostics.push(`${event.provider ?? 'runner'}:${typeof event.code === 'string' ? event.code.slice(0, 80) : event.type}`);
      if (['diagnostic', 'error'].includes(event?.type) && event.provider === entry.provider && typeof event.code === 'string') attemptCodes.push(event.code);
      if (event?.type === 'attempt') {
        attemptCodes = [];
        context.log?.(`    attempt ${event.number} at ${event.effort}`, { verbose: true });
      }
    };
    const controller = new AbortController();
    const cancel = () => controller.abort();
    context.signal?.addEventListener('abort', cancel, { once: true });
    if (context.signal?.aborted) cancel();
    const guard = setTimeout(cancel, context.timeoutMs + GUARD_GRACE_MS);
    const clock = performance.now();
    let outcome;
    try {
      outcome = await runTask({
        prompt: task.prompt, cwd: workspace, model: context.models[entry.provider] ?? undefined, allowWrite: true,
        effort: arm.effort, maxEffort: arm.maxEffort, maxAttempts: arm.maxAttempts, timeoutMs: context.timeoutMs,
        verify: resolveCommand(task.verify, { python: context.python }), signal: controller.signal, onEvent,
        env: context.env, ...launch,
      }, { adapter: getAdapter(entry.provider), store: NULL_STORE, verifyFn: isolatedVerify });
    } finally {
      clearTimeout(guard);
      context.signal?.removeEventListener('abort', cancel);
    }
    const wallMs = Math.round(performance.now() - clock);
    const interrupted = Boolean(context.signal?.aborted);
    const changedFiles = diffSnapshots(before, await snapshot(workspace));
    // An interrupted run is re-run on --resume, so it gets no verdict.
    const acceptance = interrupted ? null : await runAcceptance(task, workspace, { checkDir: join(root, 'check'), python: context.python });
    const result = outcome.task;
    const attempts = result.attempts.map((attempt) => ({
      number: attempt.number, effort: attempt.effort, status: attempt.status,
      visibleCheck: attempt.verification?.status ?? 'not-run', failureKind: attempt.verification?.kind ?? null,
      durationMs: attempt.durationMs, usage: normalizeUsage(attempt.usage),
    }));
    const lastCheck = attempts.at(-1)?.visibleCheck;
    // A provider-side failure that ended the run says nothing about the arm (see PROVIDER_FAILURES).
    const providerError = attempts.length && attempts.at(-1).status !== 'completed'
      ? attemptCodes.find((code) => PROVIDER_FAILURES[entry.provider]?.includes(code)) ?? null : null;
    return {
      ...base,
      model: { requested: context.models[entry.provider] ?? null, observed: [...observedModels] },
      effort: {
        initial: result.initialEffort, final: result.effort, policyVersion: result.policyVersion, features: result.features,
        decisions: result.decisions.map((decision, index) => ({ action: decision.action ?? (index === 0 ? 'start' : 'unknown'), effort: decision.effort, reason: decision.reason })),
      },
      attempts,
      runStatus: result.status,
      stopReason: result.stopReason ?? null,
      visibleCheckPassed: lastCheck === 'passed' ? true : lastCheck && lastCheck !== 'not-run' ? false : null,
      accepted: acceptance?.status === 'passed',
      acceptance: acceptance && { status: acceptance.status, kind: acceptance.kind, exitCode: acceptance.exitCode, fingerprint: acceptance.fingerprint, durationMs: acceptance.durationMs },
      usage: totalUsage(attempts.map((attempt) => attempt.usage), { conversationTotals: Boolean(context.conversationTotals?.[entry.provider]) }),
      wallMs,
      changedFiles,
      visibleTestsChanged: [...changedFiles.modified, ...changedFiles.deleted].some(isVisibleTest),
      diagnostics,
      interrupted,
      providerError,
      harnessError: null,
      ...(context.keepWorkspaces ? { workspace } : {}),
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  } catch (error) {
    return { ...base, interrupted: Boolean(context.signal?.aborted), harnessError: safeMessage(error), startedAt, finishedAt: new Date().toISOString() };
  } finally {
    if (!context.keepWorkspaces) await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
  }
}

/** Parse runs.jsonl; malformed lines are skipped and counted, not fatal. */
export async function readRecords(path) {
  let text;
  try { text = await readFile(path, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const records = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { records.push(JSON.parse(line)); } catch { records.malformed = (records.malformed ?? 0) + 1; }
  }
  return records;
}

function effortRevision() {
  const git = (args) => spawnSync('git', args, { cwd: BENCH_DIR, encoding: 'utf8', timeout: 10_000, windowsHide: true, shell: false });
  const head = git(['rev-parse', 'HEAD']);
  if (head.status !== 0) return { commit: null, dirty: null };
  const status = git(['status', '--porcelain', '--untracked-files=no']);
  return { commit: head.stdout.trim(), dirty: status.status === 0 ? status.stdout.trim().length > 0 : null };
}

/**
 * `--version` of each live CLI. This starts no model turn; a missing CLI stops the benchmark before any run.
 * It probes the command the adapter will start: --<provider>-bin as given, otherwise the same
 * resolution as `effort doctor` (EFFORT_<PROVIDER>_BIN, then on Windows a native .exe or npm shim on PATH).
 */
function probeProviders(providers, bins, env) {
  const versions = {};
  for (const provider of providers) {
    const hint = `Install it and sign in, or pass --${provider}-bin or set ${CLI_OVERRIDES[provider]} with its executable or JavaScript entry point.`;
    let command;
    try { command = providerCommand(provider, { ...providerLaunch(provider, { live: true, bin: bins[provider] }), env }); }
    catch (error) { throw new Error(`The ${provider} CLI cannot be started: ${error.message} ${hint}`); }
    const probe = spawnSync(command.executable, [...command.executableArgs, '--version'], { encoding: 'utf8', timeout: 20_000, windowsHide: true, shell: false });
    if (probe.error || probe.status !== 0) throw new Error(`The ${provider} CLI (${[command.executable, ...command.executableArgs].join(' ')}) did not answer --version. ${hint}`);
    versions[provider] = String(probe.stdout).trim().split('\n')[0].slice(0, 120);
  }
  return versions;
}

/**
 * Run (or resume) a benchmark: schedule, spend guard, sequential runs with
 * JSONL appended after each one, then the Markdown summary.
 */
export async function runBenchmark({
  corpus, tasks, arms, providers, repeats = 1, seed, timeoutMs, live = false, maxRuns, outDir, resume = false,
  models = {}, bins = {}, python = null, workRoot = tmpdir(), keepWorkspaces = false, margin = 0.05,
  referenceArm = 'fixed-high', signal, log = () => {},
}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 1_800_000) throw new Error('The per-run timeout must be 1–1,800 seconds.');
  const schedule = buildSchedule({ taskIds: tasks.map((task) => task.id), arms, providers, repeats, seed });
  const digests = Object.fromEntries(await Promise.all(tasks.map(async (task) => [task.id, await taskDigest(task)])));
  const plan = {
    mode: live ? 'live' : 'fake', seed, providers, arms, repeats, timeoutMs,
    models: { codex: models.codex ?? null, claude: models.claude ?? null }, tasks: digests,
  };
  const runsPath = join(outDir, 'runs.jsonl');
  const metaPath = join(outDir, 'meta.json');
  const completed = new Set();
  let meta;
  if (resume) {
    try { meta = JSON.parse(await readFile(metaPath, 'utf8')); } catch { throw new Error(`Cannot resume: ${metaPath} is missing or unreadable.`); }
    const changed = Object.keys(plan).filter((key) => JSON.stringify(plan[key]) !== JSON.stringify(meta.plan?.[key]));
    if (changed.length) throw new Error(`Cannot resume ${outDir}: ${changed.join(', ')} differ from the original run. Rerun with the original options.`);
    for (const record of await readRecords(runsPath)) if (record.key && !record.harnessError && !record.interrupted && !record.providerError) completed.add(record.key);
  } else if (await exists(runsPath)) {
    throw new Error(`${outDir} already contains runs.jsonl. Pass --resume to continue it, or choose another --out.`);
  }
  const remaining = schedule.filter((entry) => !completed.has(entry.key));
  checkSpendGuard({ live, maxRuns, runs: remaining.length });
  if (!python && tasks.some((task) => task.language === 'python')) {
    throw new Error('The selected tasks include Python tasks, but Python 3.8 or later was not found. Pass --python, set EFFORT_BENCH_PYTHON, or use --language node.');
  }
  const providerVersions = live ? probeProviders(providers, bins, process.env) : Object.fromEntries(providers.map((provider) => [provider, FAKE_VERSION]));
  // The fake Claude CLI reports conversation totals on resume the way current Claude Code does.
  const conversationTotals = { codex: false, claude: providers.includes('claude') && (!live || reportsConversationTotals(providerVersions.claude)) };
  const now = new Date().toISOString();
  if (meta) {
    meta.invocations = [...(meta.invocations ?? []), { startedAt: now, runs: remaining.length, providerVersions }];
  } else {
    meta = {
      schema: META_SCHEMA, benchId: randomUUID(), benchVersion: BENCH_VERSION, createdAt: now, plan,
      mode: plan.mode, seed, providers, repeats, timeoutMs, margin, referenceArm,
      maxRuns: maxRuns ?? null, plannedRuns: schedule.length, maxProviderTurns: maxProviderTurns(schedule),
      arms: arms.map((name) => ({ name, ...ARMS[name] })),
      tasks: tasks.map((task) => ({ id: task.id, language: task.language, difficulty: task.difficulty, category: task.category, digest: digests[task.id] })),
      corpus: { manifest: corpus?.path ?? null, description: corpus?.description ?? '' },
      models: plan.models, providerVersions,
      harness: {
        node: process.version, platform: `${process.platform} ${process.arch}`, effort: effortRevision(), policyVersion: POLICY_VERSION,
        python: python?.version ?? null,
        notes: [
          'Claude turns use the adapter default of 12 agentic turns; the harness does not set maxTurns.',
          ...(conversationTotals.claude ? ['The cost of a retried Claude run is the conversation total its last attempt reported.'] : []),
        ],
      },
      fake: live ? null : { version: FAKE_VERSION, solveProbability: SOLVE_PROBABILITY, retryBonus: RETRY_BONUS, tokensPerTurn: TOKENS_PER_TURN },
      invocations: [{ startedAt: now, runs: remaining.length, providerVersions }],
    };
  }
  await mkdir(outDir, { recursive: true });
  await writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`);

  const context = {
    benchId: meta.benchId, live, seed, timeoutMs, models: plan.models, bins, python, workRoot, keepWorkspaces, signal, log, conversationTotals,
    tasks: new Map(tasks.map((task) => [task.id, task])),
    // Offline runs never need credentials, so none are passed to the fake CLIs.
    env: live ? process.env : checkEnvironment(process.env),
  };
  const width = String(remaining.length).length;
  let executed = 0;
  let providerFailure = null;
  for (const [index, entry] of remaining.entries()) {
    if (signal?.aborted) break;
    if (live) log(`[${String(index + 1).padStart(width)}/${remaining.length}] ${entry.provider} ${entry.task} ${entry.arm} #${entry.repeat}: running…`);
    const record = await executeRun(entry, context);
    await appendFile(runsPath, `${JSON.stringify(record)}\n`);
    executed += 1;
    log(`[${String(index + 1).padStart(width)}/${remaining.length}] ${describeRun(record)}`);
    if (record.providerError) {
      providerFailure = { provider: record.provider, code: record.providerError, key: record.key };
      break;
    }
  }
  const records = await readRecords(runsPath);
  const report = await writeReport({ outDir, meta, records });
  return {
    outDir, runsPath, metaPath, summaryPath: report.summaryPath, meta, executed, skipped: schedule.length - remaining.length,
    interrupted: Boolean(signal?.aborted), providerFailure,
  };
}

export function describeRun(record) {
  const verdict = record.harnessError ? `HARNESS ERROR (${record.harnessError})` : record.interrupted ? 'interrupted'
    : record.providerError ? `PROVIDER FAILURE (${record.providerError}), not scored` : record.accepted ? 'PASS' : 'fail';
  const efforts = record.attempts?.map((attempt) => attempt.effort).join('→') || '-';
  const tokens = record.usage?.totalTokens;
  const usage = tokens === null || tokens === undefined ? 'usage unknown' : `${tokens.toLocaleString('en-US')} tokens`;
  const time = record.wallMs === undefined ? '' : ` · ${(record.wallMs / 1000).toFixed(1)} s`;
  return `${record.provider} ${record.task} ${record.arm} #${record.repeat}: ${verdict} · ${efforts} · ${usage}${time}`;
}
