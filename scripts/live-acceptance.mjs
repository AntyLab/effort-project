import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { appendFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { performance } from 'node:perf_hooks';
import { chooseModel, recommend } from '../src/policy.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = join(root, 'bin/effort.mjs');
export const cases = [
  // Automatic routing uses the fast tier only when allowed, so this case passes --allow-fast.
  { name: 'typo', file: 'greeting.mjs', tier: 'fast', effort: 'low', allowFast: true,
    prompt: 'Fix the typo: the exported function in greeting.mjs is misspelled geet; rename it to greet.',
    broken: 'export function geet() { return "hello"; }\n',
    fixed: 'export function greet() { return "hello"; }\n',
    test: 'import assert from "node:assert/strict";\nimport { greet } from "./greeting.mjs";\nassert.equal(greet(), "hello");\n' },
  { name: 'feature', file: 'slug.mjs', tier: 'daily', effort: 'medium',
    prompt: 'Add slugify(title) to slug.mjs: lowercase, trim, join words with single hyphens.',
    broken: 'export {};\n',
    fixed: 'export const slugify = title => title.toLowerCase().trim().split(/\\s+/).join("-");\n',
    test: 'import assert from "node:assert/strict";\nimport { slugify } from "./slug.mjs";\nassert.equal(slugify("  Hello World  "), "hello-world");\nassert.equal(slugify("A  B"), "a-b");\n' },
  { name: 'race', file: 'counter.mjs', tier: 'frontier', effort: 'high',
    prompt: 'Investigate and fix the intermittent race condition in counter.mjs: concurrent increment() calls lose updates.',
    broken: 'let n = 0; export async function increment() { const v = n; await null; n = v + 1; return n; }\nexport const value = () => n;\n',
    fixed: 'let n = 0; export async function increment() { return ++n; }\nexport const value = () => n;\n',
    test: 'import assert from "node:assert/strict";\nimport { increment, value } from "./counter.mjs";\nawait Promise.all(Array.from({ length: 50 }, () => increment()));\nassert.equal(value(), 50);\n' },
];

// Only the live branch calls this with the Effort CLI. All execution is shell-free.
function execute(args, { cwd, env = process.env, timeoutMs, signal }) {
  return new Promise(resolveResult => {
    if (signal?.aborted) return resolveResult({ code: null, stdout: '', error: true });
    const childEnv = { ...env };
    delete childEnv.NODE_TEST_CONTEXT;
    const child = spawn(process.execPath, args, { cwd, env: childEnv, shell: false,
      windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', size = 0, error = false, timedOut = false, hardKill;
    const kill = signal => {
      if (!child.pid) return;
      if (process.platform === 'win32') {
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { shell: false, stdio: 'ignore', windowsHide: true });
        killer.on('error', () => child.kill(signal));
      } else {
        try { process.kill(-child.pid, signal); } catch { child.kill(signal); }
      }
    };
    // Let Effort cancel its independently grouped provider and reap it first.
    const stop = () => {
      if (hardKill) return;
      kill('SIGTERM'); hardKill = setTimeout(() => kill('SIGKILL'), 7500);
    };
    signal?.addEventListener('abort', stop, { once: true });
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    child.stdout.on('data', data => {
      size += data.length;
      if (size > 2_000_000) { if (!error) { error = true; stop(); } }
      else stdout += data;
    });
    // Drain diagnostics without persisting provider text.
    child.stderr.resume();
    child.on('error', () => { error = true; });
    child.on('close', code => {
      clearTimeout(timer); clearTimeout(hardKill);
      signal?.removeEventListener('abort', stop);
      kill('SIGKILL');
      resolveResult({ code, stdout, error, timedOut });
    });
  });
}

export function recordResult(provider, fixture, task, wallTimeMs) {
  const attempts = Array.isArray(task.attempts) ? task.attempts : [];
  const evidence = attempts[0]?.effortEvidence ?? {};
  const usage = attempts.map(attempt => attempt.usage ?? null);
  // Claude reports conversation-total cost on resumed attempts; do not sum it.
  const cost = usage.map(value => value?.costUsd).filter(value => typeof value === 'number' && Number.isFinite(value));
  return { provider, case: fixture.name,
    expected: { tier: fixture.tier, effort: fixture.effort, model: chooseModel(provider, fixture.tier) },
    model: task.model ?? null, modelSelection: task.modelSelection ?? null,
    effort: attempts[0]?.effort ?? null,
    effortEvidence: Object.fromEntries(['observedModel', 'model', 'configuredEffort', 'observedLabel', 'thinkingTokens']
      .filter(key => Object.hasOwn(evidence, key)).map(key => [key, evidence[key]])),
    status: task.status ?? 'blocked', attempts: attempts.length,
    ...(usage.some(value => value !== null) ? { usage } : {}),
    ...(cost.length ? { costUsd: cost.at(-1) } : {}), wallTimeMs };
}

const cell = value => (value === undefined ? 'not reported' : typeof value === 'object' ? JSON.stringify(value) : String(value))
  .replace(/\|/g, '\\|').replace(/[\r\n]/g, ' ');
function table(records) {
  const fields = ['provider', 'case', 'expected', 'model', 'modelSelection', 'effort', 'effortEvidence', 'status', 'attempts', 'usage', 'costUsd', 'wallTimeMs'];
  return [fields, fields.map(() => '---'), ...records.map(row => fields.map(key => cell(row[key])))].map(row => `| ${row.join(' | ')} |`).join('\n');
}

export async function runAcceptance(args, { runCommand = execute, print = text => process.stdout.write(text + '\n'), signal } = {}) {
  const { values } = parseArgs({ args, strict: true, options: {
    live: { type: 'boolean' }, providers: { type: 'string', default: 'codex,claude,gemini' },
    out: { type: 'string' }, 'max-runs': { type: 'string', default: '9' },
  } });
  const providers = values.providers.split(',').map(value => value.trim());
  if (!providers.length || new Set(providers).size !== providers.length || providers.some(value => !['codex', 'claude', 'gemini'].includes(value))) {
    throw new Error('--providers must be a comma-separated selection of codex, claude, gemini without duplicates.');
  }
  const maxRuns = Number(values['max-runs']);
  if (!Number.isSafeInteger(maxRuns) || maxRuns < 1) throw new Error('--max-runs must be a positive integer.');
  if (providers.length * cases.length > maxRuns) throw new Error('Selected cases exceed --max-runs; select fewer providers or raise the cap.');
  const run = async (command, options) => {
    if (signal?.aborted) throw new Error('Acceptance interrupted.');
    const result = await runCommand(command, { ...options, signal });
    if (signal?.aborted) throw new Error('Acceptance interrupted.');
    return result;
  };
  const scratch = await mkdtemp(join(tmpdir(), 'effort-live-acceptance-'));
  const plans = [], records = [];
  try {
    for (const provider of providers) for (const fixture of cases) {
      const cwd = await mkdtemp(join(scratch, `${provider}-${fixture.name}-`));
      await writeFile(join(cwd, fixture.file), fixture.broken);
      await writeFile(join(cwd, 'test.mjs'), fixture.test);
      const prediction = recommend({ prompt: fixture.prompt, provider, allowFast: fixture.allowFast === true });
      const expected = { tier: fixture.tier, model: chooseModel(provider, fixture.tier), effort: fixture.effort };
      assert.deepEqual({ tier: prediction.tier, model: prediction.model, effort: prediction.effort }, expected);
      const command = [cli, 'run', fixture.prompt, '--provider', provider, '--cwd', cwd,
        '--allow-write', '--max-attempts', '2', ...(fixture.allowFast ? ['--allow-fast'] : []), '--json', '--', 'node', 'test.mjs'];
      plans.push({ provider, fixture, cwd, command, expected });
      if (!values.live) print(`Plan ${JSON.stringify({ provider, case: fixture.name, expected, command: [process.execPath, ...command] })}`);
      const check = () => run(['test.mjs'], { cwd, timeoutMs: 30_000 });
      const before = await check();
      assert.ok(!before.error && !before.timedOut && Number.isInteger(before.code) && before.code !== 0, `${provider}/${fixture.name}: starting test must fail`);
      await writeFile(join(cwd, fixture.file), fixture.fixed);
      const after = await check();
      assert.ok(!after.error && !after.timedOut && after.code === 0, `${provider}/${fixture.name}: reference fix must pass`);
      await writeFile(join(cwd, fixture.file), fixture.broken);
    }
    print(`Offline self-check passed: ${plans.length} starting workspaces fail; reference fixes pass.`);
    if (!values.live) {
      print('Plan only. No provider started; --live is required. No output file was written.');
      return { plans, records, failed: false };
    }
    for (const plan of plans) {
      // Keep run metadata in the disposable workspace, away from the user's history.
      const dataDir = join(plan.cwd, '.effort-data');
      await mkdir(dataDir);
      const started = performance.now();
      const result = await run(plan.command, { cwd: root, env: { ...process.env, EFFORT_DATA_DIR: dataDir }, timeoutMs: 600_000 });
      let task = {};
      if (!result.error && !result.timedOut) {
        try { task = JSON.parse(result.stdout).task ?? {}; } catch { /* Record a blocked run without raw output. */ }
      }
      const record = recordResult(plan.provider, plan.fixture, task, Math.round(performance.now() - started));
      records.push(record);
      const line = JSON.stringify(record) + '\n';
      if (values.out) await appendFile(resolve(values.out), line, { mode: 0o600 });
      else print(line.trimEnd());
    }
    print(table(records));
    return { plans, records, failed: records.some(row => row.status !== 'verified' || row.model !== row.expected.model || row.effort !== row.expected.effort) };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  runAcceptance(process.argv.slice(2), { signal: controller.signal }).then(result => { process.exitCode = result.failed ? 1 : 0; })
    .catch(error => { process.stderr.write(`live-acceptance: ${error.message}\n`); process.exitCode = 1; })
    .finally(() => { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); });
}
