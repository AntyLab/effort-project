import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCorpus, selectTasks } from '../bench/lib/corpus.mjs';
import { DEFAULT_ARMS, buildSchedule } from '../bench/lib/plan.mjs';
import { readRecords, runBenchmark } from '../bench/lib/execute.mjs';
import { FAKE_VERSION } from '../bench/fake/model.mjs';

// Offline only: every provider turn below goes to the fake CLIs in bench/fake.
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const corpus = await loadCorpus();

async function scratch(t) {
  const directory = await mkdtemp(join(tmpdir(), 'effort-bench-run-'));
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  return directory;
}

// Hide every executable on PATH, so a real codex or claude could not start even if the guards failed.
function withoutPath(directory) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^path$/i.test(key) && key !== 'NODE_TEST_CONTEXT'));
  return { ...env, PATH: join(directory, 'empty-bin') };
}

function cli(args, { env }) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [join(root, 'bench', 'run.mjs'), ...args], { cwd: root, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolveRun({ code, stdout, stderr }));
  });
}

describe('offline benchmark runs', { concurrency: 1 }, () => {
  test('a full offline run writes JSONL records, a summary and charts through the real adapters', async (t) => {
    const directory = await scratch(t);
    const workRoot = join(directory, 'work');
    await mkdir(workRoot);
    const tasks = selectTasks(corpus.tasks, { ids: 'node-map-limit' });
    const options = { arms: [...DEFAULT_ARMS], providers: ['codex', 'claude'], repeats: 1, seed: 'effort-bench' };
    const result = await runBenchmark({ corpus, tasks, ...options, timeoutMs: 60_000, outDir: join(directory, 'out'), workRoot });
    const records = await readRecords(result.runsPath);
    assert.deepEqual(records.map((record) => record.key), buildSchedule({ taskIds: ['node-map-limit'], ...options }).map((entry) => entry.key));

    for (const record of records) {
      for (const field of ['task', 'arm', 'provider', 'model', 'effort', 'attempts', 'accepted', 'acceptance', 'usage', 'wallMs', 'runStatus']) assert.ok(field in record, `${record.key} lacks ${field}`);
      assert.equal(record.mode, 'fake');
      assert.equal(record.harnessError, null);
      assert.equal(record.interrupted, false);
      assert.deepEqual(record.model.observed, [`fake-${record.provider}`]);
      assert.equal(record.accepted, record.acceptance.status === 'passed');
      assert.ok(record.attempts.length >= 1 && record.attempts.length <= 3);
      assert.ok(Number.isInteger(record.wallMs) && record.wallMs >= 0);
      const known = record.attempts.every((attempt) => attempt.usage.inputTokens !== null && attempt.usage.outputTokens !== null);
      assert.equal(record.usage.totalTokens === null, !known, record.key);
      if (known) assert.equal(record.usage.totalTokens, record.attempts.reduce((sum, attempt) => sum + attempt.usage.inputTokens + attempt.usage.outputTokens, 0));
      if (record.accepted) assert.ok(record.changedFiles.modified.includes('src/map-limit.mjs'));
    }
    for (const record of records.filter((entry) => entry.arm.startsWith('fixed-'))) {
      assert.equal(record.attempts.length, 1);
      assert.equal(record.effort.initial, record.arm.slice('fixed-'.length));
    }
    // With this seed the fake Claude fails the visible check twice, so Effort retries and
    // escalates. Claude reports no per-turn tokens on resumed turns, so the run total
    // must stay unknown rather than become a partial sum.
    const escalated = records.find((record) => record.key === 'claude/node-map-limit/auto-escalate/1');
    const ranks = escalated.attempts.map((attempt) => ['low', 'medium', 'high'].indexOf(attempt.effort));
    assert.ok(escalated.attempts.length >= 2, 'the auto-escalate run should retry');
    assert.ok(ranks.at(-1) > ranks[0], `effort should rise across attempts: ${escalated.attempts.map((attempt) => attempt.effort)}`);
    assert.ok(escalated.effort.decisions.some((decision) => decision.action === 'escalate'));
    assert.equal(escalated.usage.totalTokens, null);
    assert.equal(escalated.usage.attemptsWithTokens, 1);
    assert.equal(escalated.accepted, true);

    const summary = await readFile(result.summaryPath, 'utf8');
    for (const expected of [/Offline fake-provider run/, /Unknown usage is not counted as zero/, /## codex/, /## claude/, /Pass rate \(95% CI\)/, /Incomplete usage/, /At a glance, against `fixed-high`/, /\| node-map-limit \| node \| hard \| medium \|/]) assert.match(summary, expected);
    for (const provider of ['codex', 'claude']) {
      const svg = await readFile(join(result.outDir, `chart-${provider}.svg`), 'utf8');
      assert.match(svg, /^<svg [^>]*role="img"/);
      assert.match(svg, /SYNTHETIC · FAKE PROVIDER/);
    }
    const meta = JSON.parse(await readFile(result.metaPath, 'utf8'));
    assert.deepEqual(meta.providerVersions, { codex: FAKE_VERSION, claude: FAKE_VERSION });
    assert.equal(meta.plannedRuns, 10);
    assert.deepEqual(await readdir(workRoot), [], 'temporary workspaces are removed');
  });

  test('an interrupted benchmark resumes without repeating finished runs', async (t) => {
    const directory = await scratch(t);
    const tasks = selectTasks(corpus.tasks, { ids: 'node-paginate' });
    const options = { corpus, tasks, arms: ['fixed-low', 'fixed-high', 'auto-rules'], providers: ['codex'], repeats: 1, seed: 'resume', timeoutMs: 60_000, outDir: join(directory, 'out'), workRoot: directory };
    const controller = new AbortController();
    const first = await runBenchmark({ ...options, signal: controller.signal, log: (line) => { if (/^\[/.test(line)) controller.abort(); } });
    assert.equal(first.interrupted, true);
    assert.equal((await readRecords(first.runsPath)).length, 1);
    await assert.rejects(runBenchmark(options), /--resume/);
    await assert.rejects(runBenchmark({ ...options, resume: true, seed: 'another' }), /seed/);
    const second = await runBenchmark({ ...options, resume: true });
    assert.equal(second.skipped, 1);
    assert.equal(second.executed, 2);
    const records = await readRecords(second.runsPath);
    assert.equal(records.length, 3);
    assert.equal(new Set(records.map((record) => record.key)).size, 3);
    assert.equal(new Set(records.map((record) => record.benchId)).size, 1);
    assert.match(await readFile(second.summaryPath, 'utf8'), /\| Scored \| 3 run\(s\) \|/);
  });

  test('the CLI runs offline with nothing on PATH, plans, and rebuilds reports', async (t) => {
    const directory = await scratch(t);
    const env = withoutPath(directory);
    const out = join(directory, 'out');
    const run = await cli(['--tasks', 'node-paginate', '--arms', 'auto-escalate', '--out', out, '--work-root', directory], { env });
    assert.equal(run.code, 0, run.stderr);
    assert.match(run.stderr, /No real provider is started/);
    const records = await readRecords(join(out, 'runs.jsonl'));
    assert.deepEqual(records.map((record) => record.provider).sort(), ['claude', 'codex']);
    assert.ok(records.every((record) => record.harnessError === null && record.model.observed[0]?.startsWith('fake-')));

    await rm(join(out, 'summary.md'));
    const report = await cli(['report', out], { env });
    assert.equal(report.code, 0, report.stderr);
    assert.match(await readFile(join(out, 'summary.md'), 'utf8'), /# Effort benchmark summary/);

    const plan = await cli(['plan', '--json'], { env });
    assert.equal(plan.code, 0, plan.stderr);
    const parsed = JSON.parse(plan.stdout);
    assert.equal(parsed.mode, 'fake');
    assert.equal(parsed.runs, corpus.tasks.length * DEFAULT_ARMS.length * 2);
    assert.ok(parsed.tasks.every((task) => ['low', 'medium', 'high'].includes(task.rulesPick)));

    const unknownArm = await cli(['--arms', 'fixed-huge'], { env });
    assert.equal(unknownArm.code, 1);
    assert.match(unknownArm.stderr, /Unknown arm: fixed-huge/);
  });

  test('the CLI refuses live runs without an explicit, sufficient run cap', async (t) => {
    const directory = await scratch(t);
    const env = withoutPath(directory);
    const out = join(directory, 'live-out');
    const uncapped = await cli(['--live', '--out', out], { env });
    assert.equal(uncapped.code, 2);
    assert.match(uncapped.stderr, /--live needs --max-runs/);
    const undercapped = await cli(['--live', '--max-runs', '3', '--out', out], { env });
    assert.equal(undercapped.code, 2);
    assert.match(undercapped.stderr, /more than --max-runs 3/);
    // A sufficient cap gets past the guard, then stops at the CLI probe. The
    // executable deliberately does not exist, so no real provider can start.
    const missing = await cli(['--live', '--max-runs', '1', '--tasks', 'node-paginate', '--arms', 'fixed-low', '--providers', 'codex',
      '--codex-bin', join(directory, 'no-such-codex'), '--out', out], { env });
    assert.equal(missing.code, 1);
    assert.match(missing.stderr, /codex CLI .* did not answer --version/);
    await assert.rejects(stat(join(out, 'runs.jsonl')), { code: 'ENOENT' });
  });
});
