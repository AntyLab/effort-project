import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, newcombe, nonInferiority, wilson } from './stats.mjs';
import { isRoutingArm, renderChart } from './chart.mjs';

const LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];
const count = (values) => values.reduce((counts, value) => ({ ...counts, [value]: (counts[value] ?? 0) + 1 }), {});

/** Latest record per run key; harness errors and interrupted runs are set aside, not scored. */
export function analyzableRecords(records) {
  const latest = new Map();
  for (const record of records) if (record?.key) latest.set(record.key, record);
  const included = [];
  const excluded = [];
  for (const record of latest.values()) (record.harnessError || record.interrupted ? excluded : included).push(record);
  return { included, excluded };
}

export function summarizeArm(arm, records) {
  const passed = records.filter((record) => record.accepted).length;
  return {
    arm,
    runs: records.length,
    passed,
    passRate: wilson(passed, records.length),
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

export function aggregate(records, meta) {
  const { included, excluded } = analyzableRecords(records);
  const armNames = meta.arms.map((arm) => arm.name);
  const providers = meta.providers.map((provider) => {
    const rows = included.filter((record) => record.provider === provider);
    const arms = armNames.map((arm) => summarizeArm(arm, rows.filter((record) => record.arm === arm)));
    const reference = arms.find((arm) => arm.arm === meta.referenceArm && arm.runs > 0);
    const comparisons = reference ? arms.filter((arm) => arm !== reference && arm.runs > 0).map((arm) => {
      const difference = newcombe(arm.passed, arm.runs, reference.passed, reference.runs);
      const ratio = (value, base) => (value !== null && base ? value / base : null);
      return {
        arm: arm.arm, difference, verdict: nonInferiority(difference, meta.margin),
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
        ? `${points(comparison.difference.estimate)} (95% CI ${points(comparison.difference.lower)} to ${points(comparison.difference.upper)})` : 'not comparable';
      const tokens = comparison.tokenRatio === null ? 'unknown'
        : `${comparison.tokenRatio.toFixed(2)}×${comparison.tokensKnown[0] < comparison.tokensKnown[1] ? ' (incomplete usage, see below)' : ''}`;
      lines.push(`- \`${comparison.arm}\`: pass rate ${difference}, **${comparison.verdict}**; median tokens ${tokens}.`);
    }
    lines.push('');
  }
  lines.push(`![${summary.provider}: pass rate and median tokens by arm](${chartFile})`, '');
  lines.push('### Outcomes', '');
  lines.push(table(
    ['Arm', 'Runs', 'Passed', 'Pass rate (95% CI)', 'Visible check passed', 'Visible passed, hidden failed', 'Run status'],
    summary.arms.map((arm) => [
      `\`${arm.arm}\``, arm.runs, arm.passed,
      arm.passRate ? `${pct(arm.passRate.estimate)} (${pct(arm.passRate.lower)}–${pct(arm.passRate.upper)})` : '—',
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
    lines.push(`### Compared with \`${summary.reference}\``, '');
    lines.push(`Pass-rate difference = arm − \`${summary.reference}\`, with a Newcombe 95% interval. The non-inferiority margin of ${(meta.margin * 100).toFixed(1)} percentage points was fixed when the benchmark started: *non-inferior* means the whole interval lies above −${(meta.margin * 100).toFixed(1)} pp, *inferior* means it lies entirely below, anything else is *inconclusive*.`, '');
    lines.push(table(
      ['Arm', 'Pass-rate difference (95% CI)', 'Verdict', 'Median tokens vs reference', 'Median wall time vs reference'],
      summary.comparisons.map((comparison) => [
        `\`${comparison.arm}\``,
        comparison.difference ? `${points(comparison.difference.estimate)} (${points(comparison.difference.lower)} to ${points(comparison.difference.upper)})` : '—',
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
  const revision = harness.effort?.commit ? `\`${harness.effort.commit.slice(0, 12)}\`${harness.effort.dirty ? ' (uncommitted changes)' : ''}` : 'unknown';
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
    ['Scored', `${result.included} run(s)${result.excluded.length ? `; ${result.excluded.length} excluded (harness errors or interruptions, listed below)` : ''}${records.malformed ? `; ${records.malformed} malformed JSONL line(s) skipped` : ''}`],
    ['Providers', Object.entries(meta.providerVersions ?? {}).map(([provider, version]) => `${provider}: ${version}`).join('; ')],
    ['Harness', `Effort ${revision}, policy ${harness.policyVersion ?? '?'}, Node ${harness.node ?? '?'}, ${harness.platform ?? '?'}${harness.python ? `, Python ${harness.python}` : ''}`],
  ]), '');
  lines.push('**Pass** means the hidden acceptance check passed on a copy of the final workspace. The agent never sees that check. Neither a completed provider turn nor a passing visible check counts as a pass.', '');
  for (const summary of result.providers) lines.push(providerSection(summary, meta, `chart-${summary.provider}.svg`));
  if (result.excluded.length) {
    lines.push('## Excluded runs', '', table(['Run', 'Reason'], result.excluded.map((record) => [record.key, record.harnessError ? `harness error: ${record.harnessError}` : 'interrupted']), ), '');
  }
  lines.push('## Reading these numbers', '');
  lines.push(
    '- **Unknown usage is not counted as zero.** Token and cost medians and totals use only runs where every attempt reported usage. The "Usage known" column shows how many runs that is. Codex reports no cost, and Claude reports no per-turn tokens on resumed turns, so multi-attempt Claude runs have unknown token totals.',
    '- Token fields are what each CLI reports, and the two CLIs count input and cached tokens differently. Compare arms within a provider, not across providers.',
    '- The intervals treat runs as independent. Repeats of one task are correlated, so with a corpus this small the real uncertainty is larger than shown. Overlapping intervals mean this data cannot tell the arms apart. A small pilot cannot establish equal quality (see docs/architecture.md, "Evaluate before learning").',
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
