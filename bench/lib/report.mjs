import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, newcombePairedByTask, nonInferiority, wilsonByTask } from './stats.mjs';
import { isRoutingArm, renderChart } from './chart.mjs';

const LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];
const count = (values) => values.reduce((counts, value) => ({ ...counts, [value]: (counts[value] ?? 0) + 1 }), {});

/** Latest record per run key; harness errors, provider failures and interrupted runs are set aside, not scored. */
export function analyzableRecords(records) {
  const latest = new Map();
  for (const record of records) if (record?.key) latest.set(record.key, record);
  const included = [];
  const excluded = [];
  for (const record of latest.values()) (record.harnessError || record.interrupted || record.providerError ? excluded : included).push(record);
  return { included, excluded };
}

const exclusionReason = (record) => (record.harnessError ? `harness error: ${record.harnessError}`
  : record.providerError ? `provider failure: ${record.providerError} (redone on --resume)` : 'interrupted');

const taskKey = (record) => `${record.provider}/${record.task}`;

export function summarizeArm(arm, records) {
  const passed = records.filter((record) => record.accepted).length;
  // [passed, runs] per task, so the interval can count a task's repeats as fewer runs.
  const byTask = new Map();
  for (const record of records) {
    if (!byTask.has(taskKey(record))) byTask.set(taskKey(record), [0, 0]);
    const cells = byTask.get(taskKey(record));
    if (record.accepted) cells[0]++;
    cells[1]++;
  }
  return {
    arm,
    runs: records.length,
    passed,
    passRate: wilsonByTask([...byTask.values()]),
    visiblePassed: records.filter((record) => record.visibleCheckPassed === true).length,
    // The agent's own check passed but the hidden check did not.
    visibleOnly: records.filter((record) => record.visibleCheckPassed === true && !record.accepted).length,
    statuses: count(records.map((record) => record.runStatus)),
    tokens: describe(records.map((record) => record.usage?.totalTokens ?? null)),
    outputTokens: describe(records.map((record) => record.usage?.outputTokens ?? null)),
    cost: describe(records.map((record) => record.usage?.costUsd ?? null)),
    wallMs: describe(records.map((record) => record.wallMs)),
    attempts: describe(records.map((record) => record.attempts?.length ?? 0)),
    escalated: records.filter((record) => LEVELS.indexOf(record.effort?.final) > LEVELS.indexOf(record.effort?.initial)).length,
    initialEfforts: count(records.map((record) => record.effort?.initial).filter(Boolean)),
    testsChanged: records.filter((record) => record.visibleTestsChanged).length,
  };
}

const pairKey = (record) => `${taskKey(record)}/${record.repeat}`;
const PAIR_KINDS = ['both', 'armOnly', 'referenceOnly', 'neither'];

/**
 * Match an arm's runs with the reference arm's runs of the same provider, task
 * and repeat, and count the four kinds of pair, in total and per task
 * (`byTask`, [both, armOnly, referenceOnly, neither] for each task with a pair).
 * A run whose partner is missing or was excluded (harness error, interruption)
 * is unpaired: it stays in its arm's own pass rate but not in the difference,
 * and is counted here.
 */
export function pairRuns(armRecords, referenceRecords) {
  const reference = new Map(referenceRecords.map((record) => [pairKey(record), record]));
  const counts = { both: 0, armOnly: 0, referenceOnly: 0, neither: 0 };
  const byTask = new Map();
  let unpairedArm = 0;
  for (const record of armRecords) {
    const partner = reference.get(pairKey(record));
    if (!partner) {
      unpairedArm++;
      continue;
    }
    const kind = record.accepted ? (partner.accepted ? 0 : 1) : (partner.accepted ? 2 : 3);
    counts[PAIR_KINDS[kind]]++;
    if (!byTask.has(taskKey(record))) byTask.set(taskKey(record), [0, 0, 0, 0]);
    byTask.get(taskKey(record))[kind]++;
  }
  const pairs = armRecords.length - unpairedArm;
  return { ...counts, pairs, tasks: byTask.size, unpairedArm, unpairedReference: referenceRecords.length - pairs, byTask: [...byTask.values()] };
}

export function aggregate(records, meta) {
  const { included, excluded } = analyzableRecords(records);
  const armNames = meta.arms.map((arm) => arm.name);
  const providers = meta.providers.map((provider) => {
    const rows = included.filter((record) => record.provider === provider);
    const armRows = (arm) => rows.filter((record) => record.arm === arm);
    const arms = armNames.map((arm) => summarizeArm(arm, armRows(arm)));
    const reference = arms.find((arm) => arm.arm === meta.referenceArm && arm.runs > 0);
    const comparisons = reference ? arms.filter((arm) => arm !== reference && arm.runs > 0).map((arm) => {
      const pairs = pairRuns(armRows(arm.arm), armRows(reference.arm));
      const difference = newcombePairedByTask(pairs.byTask);
      const ratio = (value, base) => (value !== null && base ? value / base : null);
      return {
        arm: arm.arm, pairs, difference, verdict: nonInferiority(difference, meta.margin),
        tokenRatio: ratio(arm.tokens.median, reference.tokens.median), timeRatio: ratio(arm.wallMs.median, reference.wallMs.median),
        tokensKnown: [arm.tokens.n, arm.runs], referenceTokensKnown: [reference.tokens.n, reference.runs],
      };
    }) : [];
    const tasks = meta.tasks.map((task) => {
      const taskRows = rows.filter((record) => record.task === task.id);
      const picks = count(taskRows.filter((record) => record.arm.startsWith('auto-')).map((record) => record.effort?.initial).filter(Boolean));
      return {
        ...task,
        rulesPick: Object.keys(picks).sort((a, b) => LEVELS.indexOf(a) - LEVELS.indexOf(b)).join('/') || null,
        cells: armNames.map((arm) => {
          const cell = taskRows.filter((record) => record.arm === arm);
          return { arm, passed: cell.filter((record) => record.accepted).length, runs: cell.length };
        }),
      };
    });
    return {
      provider, runs: rows.length, arms, reference: reference?.arm ?? null, comparisons, tasks,
      observedModels: [...new Set(rows.flatMap((record) => record.model?.observed ?? []))],
      requestedModel: meta.models?.[provider] ?? null,
    };
  });
  return { providers, included: included.length, excluded };
}

const pct = (value) => `${(value * 100).toFixed(1)}%`;
const points = (value) => `${value < 0 ? '−' : '+'}${Math.abs(value * 100).toFixed(1)} pp`;
const integer = (value) => Math.round(value).toLocaleString('en-US');
const seconds = (ms) => `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
const usd = (value) => `$${value.toFixed(value < 1 ? 4 : 2)}`;
const cell = (value) => String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ');
// Whether some task contributed more than one pair, or an arm more than one run, so the interval allows for repeats.
const clustered = (comparison) => comparison.pairs.pairs > comparison.pairs.tasks;
const repeatedRuns = (arm) => Boolean(arm.passRate) && arm.passRate.runs > arm.passRate.tasks;
const ofTasks = (tasks) => ` from ${tasks} task${tasks === 1 ? '' : 's'}`;
const fromTasks = (comparison) => (clustered(comparison) ? ofTasks(comparison.pairs.tasks) : '');
function designEffect(design, effective) {
  const text = `${design.designEffect.toFixed(2)} (${effective.toFixed(1)})`;
  return design.basis === 'upper bound' ? `${text}, upper bound: nothing to estimate it from` : text;
}
const table = (header, rows) => [
  `| ${header.map(cell).join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`,
  ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`),
].join('\n');

function spread(stats, format) {
  if (!stats.n) return 'unknown';
  return stats.n > 1 ? `${format(stats.median)} (${format(stats.p25)}–${format(stats.p75)})` : format(stats.median);
}

function statusText(statuses) {
  const order = ['verified', 'failed', 'blocked', 'cancelled', 'unverified'];
  return Object.entries(statuses).sort(([a], [b]) => order.indexOf(a) - order.indexOf(b)).map(([status, n]) => `${status} ${n}`).join(', ') || '—';
}

function providerSection(summary, meta, chartFile) {
  const lines = [`## ${summary.provider}`, ''];
  if (!summary.runs) return [...lines, 'No scored runs.', ''].join('\n');
  const models = summary.observedModels.length ? summary.observedModels.map((model) => `\`${model}\``).join(', ') : 'not reported';
  lines.push(`Model requested: ${summary.requestedModel ? `\`${summary.requestedModel}\`` : 'provider default'} · observed: ${models}${summary.observedModels.length > 1 ? ' — **more than one model was observed; arms may not be comparable**' : ''}.`, '');
  const highlights = summary.comparisons.filter((comparison) => isRoutingArm(comparison.arm));
  if (highlights.length) {
    lines.push(`**At a glance, against \`${summary.reference}\`:**`, '');
    for (const comparison of highlights) {
      const difference = comparison.difference
        ? `${points(comparison.difference.estimate)} (95% CI ${points(comparison.difference.lower)} to ${points(comparison.difference.upper)}, ${comparison.pairs.pairs} paired runs${fromTasks(comparison)})` : 'not comparable (no paired runs)';
      const tokens = comparison.tokenRatio === null ? 'unknown'
        : `${comparison.tokenRatio.toFixed(2)}×${comparison.tokensKnown[0] < comparison.tokensKnown[1] ? ' (incomplete usage, see below)' : ''}`;
      lines.push(`- \`${comparison.arm}\`: pass rate ${difference}, **${comparison.verdict}**; median tokens ${tokens}.`);
    }
    lines.push('');
  }
  lines.push(`![${summary.provider}: pass rate and median tokens by arm](${chartFile})`, '');
  const repeatedArms = summary.arms.some(repeatedRuns);
  lines.push('### Outcomes', '');
  if (repeatedArms) {
    lines.push('The repeats of one task share its difficulty, so they are not independent runs. Each pass-rate interval counts them as fewer: runs ÷ the design effect, which comes from how much the arm\'s passes and failures cluster by task and lies between 1 (runs as independent) and runs ÷ tasks (each task counted once). Tasks that always passed or always failed push it toward runs ÷ tasks. When every run of the arm had the same outcome, or there is only one task, there is nothing to estimate it from and each task counts once.', '');
  }
  lines.push(table(
    ['Arm', 'Runs', 'Passed', 'Pass rate (95% CI)', ...(repeatedArms ? ['Design effect (effective runs)'] : []), 'Visible check passed', 'Visible passed, hidden failed', 'Run status'],
    summary.arms.map((arm) => [
      `\`${arm.arm}\``, repeatedRuns(arm) ? `${arm.runs}${ofTasks(arm.passRate.tasks)}` : arm.runs, arm.passed,
      arm.passRate ? `${pct(arm.passRate.estimate)} (${pct(arm.passRate.lower)}–${pct(arm.passRate.upper)})` : '—',
      ...(repeatedArms ? [arm.passRate ? designEffect(arm.passRate, arm.passRate.effectiveRuns) : '—'] : []),
      arm.visiblePassed, arm.visibleOnly, statusText(arm.statuses),
    ]),
  ), '');
  const showCost = summary.arms.some((arm) => arm.cost.n > 0);
  lines.push('### Tokens and time', '');
  lines.push(table(
    ['Arm', 'Usage known', 'Median tokens (IQR)', 'Median output tokens', 'Total tokens, known runs', ...(showCost ? ['Total cost, known runs'] : []), 'Median wall time (IQR)', 'Mean attempts', 'Escalated'],
    summary.arms.map((arm) => [
      `\`${arm.arm}\``, `${arm.tokens.n}/${arm.runs}`, spread(arm.tokens, integer), arm.outputTokens.n ? integer(arm.outputTokens.median) : 'unknown',
      arm.tokens.n ? `${integer(arm.tokens.sum)}${arm.tokens.n < arm.runs ? ` (${arm.runs - arm.tokens.n} unknown, not counted)` : ''}` : 'unknown',
      ...(showCost ? [arm.cost.n ? `${usd(arm.cost.sum)}${arm.cost.n < arm.runs ? ` (${arm.cost.n}/${arm.runs} runs)` : ''}` : 'unknown'] : []),
      arm.wallMs.n ? spread(arm.wallMs, seconds) : '—', arm.attempts.n ? (arm.attempts.sum / arm.attempts.n).toFixed(2) : '—', arm.escalated,
    ]),
  ), '');
  const coverage = summary.arms.filter((arm) => arm.runs && arm.tokens.n < arm.runs);
  if (coverage.length) {
    lines.push(`> **Incomplete usage:** ${coverage.map((arm) => `\`${arm.arm}\` has no complete token count for ${arm.runs - arm.tokens.n} of ${arm.runs} runs`).join('; ')}. Those runs are left out of the medians and totals above, not counted as zero. Runs that needed retries are the likeliest to be missing, so token comparisons involving these arms lean toward their cheaper runs.`, '');
  }
  if (summary.comparisons.length) {
    const repeated = summary.comparisons.some(clustered);
    lines.push(`### Compared with \`${summary.reference}\``, '');
    lines.push(`Pass-rate difference = arm − \`${summary.reference}\` over paired runs. Each run is matched with the \`${summary.reference}\` run of the same task and repeat, and the difference is (only the arm passed − only the reference passed) ÷ pairs, with Newcombe's 95% interval for paired proportions. A run whose partner is missing or excluded is left out of the difference but still counts in the outcomes table, so the difference can differ from the gap between the two pass rates there.${repeated ? ' The repeats of one task are not independent pairs, so the interval counts them as fewer: pairs ÷ the design effect, which comes from how much the two arms\' disagreements cluster by task and lies between 1 (pairs as independent) and pairs ÷ tasks (each task counted once). When there is nothing to estimate it from, because every pair had the same result (usually, every pair agreed) or there is only one task, each task counts once, so repeats of outcomes that never varied cannot narrow the interval.' : ''} The non-inferiority margin of ${(meta.margin * 100).toFixed(1)} percentage points was fixed when the benchmark started: *non-inferior* means the whole interval lies above −${(meta.margin * 100).toFixed(1)} pp, *inferior* means it lies entirely below, anything else is *inconclusive*.`, '');
    lines.push(table(
      ['Arm', 'Paired runs', 'Only one passed (arm / reference)', 'Pass-rate difference (95% CI)', ...(repeated ? ['Design effect (effective pairs)'] : []), 'Verdict', 'Median tokens vs reference', 'Median wall time vs reference'],
      summary.comparisons.map((comparison) => [
        `\`${comparison.arm}\``,
        `${comparison.pairs.pairs}${fromTasks(comparison)}${comparison.pairs.unpairedArm || comparison.pairs.unpairedReference ? ` (unpaired: ${comparison.pairs.unpairedArm} arm, ${comparison.pairs.unpairedReference} reference)` : ''}`,
        `${comparison.pairs.armOnly} / ${comparison.pairs.referenceOnly}`,
        comparison.difference ? `${points(comparison.difference.estimate)} (${points(comparison.difference.lower)} to ${points(comparison.difference.upper)})` : '—',
        ...(repeated ? [comparison.difference ? designEffect(comparison.difference, comparison.difference.effectivePairs) : '—'] : []),
        comparison.verdict,
        comparison.tokenRatio === null ? 'unknown' : `${comparison.tokenRatio.toFixed(2)}× (usage known ${comparison.tokensKnown.join('/')} vs ${comparison.referenceTokensKnown.join('/')})`,
        comparison.timeRatio === null ? '—' : `${comparison.timeRatio.toFixed(2)}×`,
      ]),
    ), '');
  }
  lines.push('### Per task', '');
  lines.push(`Passed/runs for each arm. "Rules pick" is the effort the rules chose in the auto arms (before any escalation).`, '');
  lines.push(table(
    ['Task', 'Language', 'Difficulty', 'Rules pick', ...summary.arms.map((arm) => `\`${arm.arm}\``)],
    summary.tasks.map((task) => [task.id, task.language, task.difficulty, task.rulesPick ?? '—', ...task.cells.map((entry) => (entry.runs ? `${entry.passed}/${entry.runs}` : '—'))]),
  ), '');
  const tampered = summary.arms.reduce((sum, arm) => sum + arm.testsChanged, 0);
  if (tampered) lines.push(`> ${tampered} run(s) modified or deleted visible test files. The hidden check does not depend on them, but review those runs (\`visibleTestsChanged\` in runs.jsonl).`, '');
  return lines.join('\n');
}

export function renderSummary(meta, records) {
  const result = aggregate(records, meta);
  const fake = meta.mode !== 'live';
  const harness = meta.harness ?? {};
  const commitText = (effort) => `\`${effort.commit.slice(0, 12)}\`${effort.dirty ? ' (uncommitted changes)' : ''}`;
  // A resumed benchmark can run later invocations on other commits; name them.
  const resumedOn = [...new Set((meta.invocations ?? []).slice(1).map((invocation) => invocation.effort)
    .filter((effort) => effort?.commit && (effort.commit !== harness.effort?.commit || effort.dirty !== harness.effort?.dirty))
    .map(commitText))];
  const revision = (harness.effort?.commit ? commitText(harness.effort) : 'unknown') + (resumedOn.length ? `, resumed on ${resumedOn.join(', ')}` : '');
  const lines = ['# Effort benchmark summary', ''];
  if (fake) {
    lines.push('> [!WARNING]', '> **Offline fake-provider run.** Outcomes, tokens and costs come from the scripted stand-ins in `bench/fake/`, not from a model. They exercise the harness end to end and say nothing about Codex, Claude or whether Effort saves anything.', '');
  }
  const languages = count(meta.tasks.map((task) => task.language));
  const difficulties = count(meta.tasks.map((task) => task.difficulty));
  lines.push(table(['', ''], [
    ['Benchmark', `\`${meta.benchId}\` · ${meta.mode} · started ${meta.createdAt}`],
    ['Tasks', `${meta.tasks.length} (${Object.entries(languages).map(([k, v]) => `${k} ${v}`).join(', ')}; ${Object.entries(difficulties).map(([k, v]) => `${k} ${v}`).join(', ')})`],
    ['Arms', meta.arms.map((arm) => `\`${arm.name}\``).join(', ')],
    ['Plan', `${meta.plannedRuns} runs (${meta.repeats} repeat${meta.repeats === 1 ? '' : 's'}), seed \`${meta.seed}\`, randomized order per provider, ${meta.timeoutMs / 1000} s per run`],
    ['Scored', `${result.included} run(s)${result.excluded.length ? `; ${result.excluded.length} excluded (harness errors, provider failures or interruptions, listed below)` : ''}${records.malformed ? `; ${records.malformed} malformed JSONL line(s) skipped` : ''}`],
    ['Providers', Object.entries(meta.providerVersions ?? {}).map(([provider, version]) => `${provider}: ${version}`).join('; ')],
    ['Harness', `Effort ${revision}, policy ${harness.policyVersion ?? '?'}, Node ${harness.node ?? '?'}, ${harness.platform ?? '?'}${harness.python ? `, Python ${harness.python}` : ''}`],
  ]), '');
  lines.push('**Pass** means the hidden acceptance check passed on a copy of the final workspace. The agent never sees that check. Neither a completed provider turn nor a passing visible check counts as a pass.', '');
  for (const summary of result.providers) lines.push(providerSection(summary, meta, `chart-${summary.provider}.svg`));
  if (result.excluded.length) {
    lines.push('## Excluded runs', '', table(['Run', 'Reason'], result.excluded.map((record) => [record.key, exclusionReason(record)])), '');
  }
  lines.push('## Reading these numbers', '');
  lines.push(
    '- **Unknown usage is not counted as zero.** Token and cost medians and totals use only runs where every attempt reported usage. The "Usage known" column shows how many runs that is. Codex reports no cost. Claude reports per-turn tokens on a resumed turn only when the turn\'s own stream confirms them, so some multi-attempt Claude runs have unknown token totals. A retried Claude run\'s cost is the conversation total its last attempt reported (Claude Code 2.1.277 or later), never a sum of such totals.',
    '- Token fields are what each CLI reports, and the two CLIs count input and cached tokens differently. Compare arms within a provider, not across providers.',
    '- Per-arm pass-rate intervals (Wilson) count the repeats of one task as fewer, effective runs, because repeats share the task\'s difficulty. The difference from the reference arm pairs runs by task and repeat, so tasks that both arms find easy or hard do not widen it, and it likewise counts the repeats of one task as fewer, effective pairs. Both still rest on the tasks in the corpus: a failure confined to kinds of task the corpus lacks, or too rare to appear among its tasks, cannot show in any interval, and more repeats cannot replace more tasks. Judge a difference by its paired interval, not by whether two per-arm intervals overlap. A small pilot cannot establish equal quality (see docs/architecture.md, "Evaluate before learning").',
    '- Single-attempt arms get no feedback. `auto-escalate` also gets up to two retries with the visible check\'s output, so its pass rate mixes retrying and escalating. Add the opt-in `medium-retry` arm to separate the two.',
    '- The visible check is the agent\'s own test command, the one Effort retries on. It can pass while the hidden check fails (see "Visible passed, hidden failed").',
    '- Wall time covers the whole managed run: provider turns, process start-up and visible checks. It excludes the hidden acceptance check.',
  );
  if (fake) lines.push('- Fake-provider outcomes come from fixed made-up solve probabilities per difficulty and effort. They are listed under `fake` in meta.json.');
  lines.push('');
  return { markdown: lines.join('\n'), aggregate: result };
}

/** Write summary.md and one chart per provider into `outDir`. */
export async function writeReport({ outDir, meta, records }) {
  const { markdown, aggregate: result } = renderSummary(meta, records);
  const summaryPath = join(outDir, 'summary.md');
  await writeFile(summaryPath, markdown);
  const charts = [];
  for (const summary of result.providers) {
    if (!summary.runs) continue;
    const path = join(outDir, `chart-${summary.provider}.svg`);
    await writeFile(path, renderChart(summary, { fake: meta.mode !== 'live' }));
    charts.push(path);
  }
  return { summaryPath, charts };
}
