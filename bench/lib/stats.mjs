export const Z95 = 1.959963984540054;

/**
 * Wilson score interval for a binomial proportion; null when there are no trials.
 * It treats the trials as independent; for runs that come in tasks, use wilsonByTask.
 */
export function wilson(successes, trials, z = Z95) {
  if (!Number.isInteger(trials) || trials < 0) throw new RangeError('trials must be a non-negative integer.');
  if (!Number.isInteger(successes) || successes < 0 || successes > trials) throw new RangeError('successes must be an integer from 0 to trials.');
  if (trials === 0) return null;
  return wilsonBounds(successes, trials, z);
}

// The Wilson formula itself, which also takes the fractional effective counts of wilsonByTask and newcombePairedByTask.
function wilsonBounds(successes, trials, z) {
  const p = successes / trials;
  const z2 = z * z;
  const denominator = 1 + z2 / trials;
  const center = (p + z2 / (2 * trials)) / denominator;
  const margin = (z / denominator) * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials));
  return { estimate: p, lower: Math.max(0, center - margin), upper: Math.min(1, center + margin) };
}

/**
 * Newcombe's hybrid score interval for p1 − p2 from paired binary outcomes
 * (Newcombe 1998, Statistics in Medicine 17:2635–2650, method 10). Each pair is
 * counted once: `both` passed, only the first passed (`firstOnly`), only the
 * second passed (`secondOnly`), or `neither` did. Null when there are no pairs.
 *
 * Arms run the same tasks and repeats, so their outcomes are paired. This treats
 * the pairs as independent, which holds with one pair per task; with repeats,
 * use newcombePairedByTask.
 */
export function newcombePaired(both, firstOnly, secondOnly, neither, z = Z95) {
  const cells = [both, firstOnly, secondOnly, neither];
  if (!cells.every((value) => Number.isInteger(value) && value >= 0)) throw new RangeError('paired counts must be non-negative integers.');
  if (both + firstOnly + secondOnly + neither === 0) return null;
  return newcombeBounds(both, firstOnly, secondOnly, neither, z);
}

function newcombeBounds(both, firstOnly, secondOnly, neither, z) {
  const pairs = both + firstOnly + secondOnly + neither;
  const first = wilsonBounds(both + firstOnly, pairs, z);
  const second = wilsonBounds(both + secondOnly, pairs, z);
  // Correlation of the two outcomes (phi), 0 when any margin is empty. Newcombe
  // reduces a positive numerator by n/2 before dividing.
  const margins = (both + firstOnly) * (secondOnly + neither) * (both + secondOnly) * (firstOnly + neither);
  let numerator = both * neither - firstOnly * secondOnly;
  if (numerator > 0) numerator = Math.max(numerator - pairs / 2, 0);
  const phi = margins ? numerator / Math.sqrt(margins) : 0;
  const combine = (x, y) => Math.sqrt(Math.max(0, x * x - 2 * phi * x * y + y * y));
  const estimate = (firstOnly - secondOnly) / pairs;
  return {
    estimate,
    lower: estimate - combine(first.estimate - first.lower, second.upper - second.estimate),
    upper: estimate + combine(first.upper - first.estimate, second.estimate - second.lower),
  };
}

/**
 * How much the clustering of pairs in tasks inflates the variance of the paired
 * difference: its between-task variance, the clustered variance Obuchowski
 * (1998, Statistics in Medicine 17:1495–1507) uses for matched pairs, over its
 * variance if every pair were independent. `tasks` holds each task's
 * [both, firstOnly, secondOnly, neither] counts; tasks without pairs are left out.
 *
 * The result is kept between 1 (pairs as independent) and pairs ÷ tasks (one
 * pair per task), and `basis` says where it came from: 'one pair per task' (it
 * is exactly 1), 'estimated', or 'upper bound' when there is nothing to estimate
 * it from: a single task, or every pair with the same difference (typically,
 * every pair agreed).
 */
export function taskDesignEffect(tasks) {
  const clusters = tasks.map((cells) => {
    if (cells.length !== 4 || !cells.every((value) => Number.isInteger(value) && value >= 0)) throw new RangeError('paired counts must be non-negative integers.');
    // Each pair's difference is −1, 0 or 1, so its square is 1 exactly when the pair disagrees.
    return { size: cells[0] + cells[1] + cells[2] + cells[3], sum: cells[1] - cells[2], squares: cells[1] + cells[2] };
  }).filter((cluster) => cluster.size > 0);
  const { runs, ...design } = clusterDesignEffect(clusters, 'one pair per task');
  return { ...design, pairs: runs };
}

/**
 * The same design effect for one arm's pass rate: the between-task variance of
 * its pass/fail outcomes over their variance if every run were independent.
 * `tasks` holds each task's [passed, runs]; tasks without runs are left out.
 * Bounds and bases as in taskDesignEffect, with 'one run per task' for exactly 1
 * and 'upper bound' when there is a single task or every run had the same outcome.
 */
export function passDesignEffect(tasks) {
  const clusters = tasks.map((cells) => {
    if (cells.length !== 2 || !cells.every((value) => Number.isInteger(value) && value >= 0) || cells[0] > cells[1]) throw new RangeError('each task needs [passed, runs], integers with passed ≤ runs.');
    // A run's outcome is 0 or 1, so the sum of its squares is the number passed.
    return { size: cells[1], sum: cells[0], squares: cells[0] };
  }).filter((cluster) => cluster.size > 0);
  return clusterDesignEffect(clusters, 'one run per task');
}

// Both design effects: tasks are clusters of runs, each with its run count
// (`size`), the sum of its runs' values and the sum of their squares. The
// between-task and independent variances use K − 1 and n − 1, so one run per
// task gives exactly 1. That case is returned directly, with the basis `single`.
function clusterDesignEffect(clusters, single) {
  const count = clusters.length;
  const runs = clusters.reduce((sum, cluster) => sum + cluster.size, 0);
  if (runs === count) return { designEffect: 1, basis: single, tasks: count, runs };
  const bound = runs / count;
  const mean = clusters.reduce((sum, cluster) => sum + cluster.sum, 0) / runs;
  const squares = clusters.reduce((sum, cluster) => sum + cluster.squares, 0) - runs * mean * mean;
  if (count < 2 || squares <= 1e-9) return { designEffect: bound, basis: 'upper bound', tasks: count, runs };
  const independent = squares / (runs * (runs - 1));
  const between = (count / (count - 1)) * clusters.reduce((sum, cluster) => sum + (cluster.sum - cluster.size * mean) ** 2, 0) / (runs * runs);
  return { designEffect: Math.min(Math.max(between / independent, 1), bound), basis: 'estimated', tasks: count, runs };
}

/**
 * Wilson's interval for an arm's pass rate when its runs come in tasks, as they
 * do when the benchmark repeats each task. The repeats of one task share its
 * difficulty, so they are worth fewer independent runs than their number. As in
 * newcombePairedByTask (Rao and Scott 1992), the passes and runs are divided by
 * passDesignEffect before the interval is computed. `tasks` holds each task's
 * [passed, runs]. With one run per task nothing changes and the result equals
 * wilson(passed, runs); null when there are no runs.
 *
 * Unlike the paired difference, an arm's pass rate keeps the variation between
 * easy and hard tasks, so its design effect is usually larger: when every task
 * always passes or always fails, with the same number of runs each, it reaches
 * runs ÷ tasks and the interval is the one-repeat interval. When every run had
 * the same outcome there is nothing to estimate it from and each task counts
 * once, so repeats of tasks whose outcomes never vary cannot narrow it.
 */
export function wilsonByTask(tasks, z = Z95) {
  const design = passDesignEffect(tasks);
  if (!design.runs) return null;
  const passed = tasks.reduce((sum, cells) => sum + cells[0], 0);
  const interval = wilsonBounds(passed / design.designEffect, design.runs / design.designEffect, z);
  return { ...interval, estimate: passed / design.runs, ...design, effectiveRuns: design.runs / design.designEffect };
}

/**
 * Newcombe's paired interval for pairs that come in tasks, as they do when the
 * benchmark repeats each task. Repeats of a task share whatever makes it easy or
 * hard for one arm and not the other, so they are worth fewer independent pairs
 * than their number. Following Rao and Scott (1992, Biometrics 48:577–585), the
 * four counts are divided by taskDesignEffect before the interval is computed,
 * which widens it by about the square root of the design effect. With one pair
 * per task nothing changes and the result equals newcombePaired.
 *
 * Why this method: a simulation over 11 and 20 tasks, 1 to 10 repeats, tasks
 * from near-deterministic to noisy, and an arm that always fails a random few
 * tasks. At 11 tasks and 3 repeats it covered 96–100% (unadjusted: 92–100%) and
 * gave a non-inferior verdict when the true difference was at the margin in at
 * most 3.2% of samples (unadjusted: 5.0%). The alternatives:
 * - Each task as one pair (Newcombe over per-task pass fractions): always covers,
 *   but repeats never narrow it, so they would buy nothing.
 * - A t-interval over per-task differences, or a task-clustered bootstrap seeded
 *   from meta.seed: zero width when every task agrees, and with eleven tasks
 *   false non-inferior verdicts at the margin in up to 48% (t) and 53%
 *   (bootstrap) of samples, even with one repeat.
 * This one is closed form, needs no seed, and never has zero width.
 *
 * Two choices protect the non-inferiority verdict. A design effect below 1 is
 * treated as noise, never as a reason to narrow. When no pair disagrees, the
 * clustering cannot be estimated and each task counts once, so repeating tasks
 * whose outcomes never vary cannot buy a non-inferior verdict. (A single
 * disagreement is then estimated as unclustered, so it can give a narrower
 * interval than none.) Limits: the design effect is itself estimated from about
 * eleven tasks, and a failure confined to a few kinds of task may not be in the
 * sample at all. Repeats cannot reveal it; only more tasks can. With 10 repeats
 * of near-deterministic tasks coverage fell to 80% (unadjusted: 41%).
 */
export function newcombePairedByTask(tasks, z = Z95) {
  const design = taskDesignEffect(tasks);
  if (!design.pairs) return null;
  const totals = [0, 1, 2, 3].map((index) => tasks.reduce((sum, cells) => sum + cells[index], 0));
  const interval = newcombeBounds(...totals.map((value) => value / design.designEffect), z);
  return { ...interval, ...design, effectivePairs: design.pairs / design.designEffect };
}

/** A predefined non-inferiority reading of a difference interval (arm − reference) against `margin`. */
export function nonInferiority(interval, margin) {
  if (!interval) return 'no data';
  if (interval.lower > -margin) return 'non-inferior';
  if (interval.upper < -margin) return 'inferior';
  return 'inconclusive';
}

/** Linear-interpolation quantile (R type 7) of an ascending array. */
export function quantile(sorted, q) {
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

/** Median, quartiles and sum of the known values. Unknown (null) values are left out, never counted as zero. */
export function describe(values) {
  const sorted = values.filter((value) => typeof value === 'number' && Number.isFinite(value)).sort((a, b) => a - b);
  return {
    n: sorted.length,
    median: quantile(sorted, 0.5), p25: quantile(sorted, 0.25), p75: quantile(sorted, 0.75),
    sum: sorted.length ? sorted.reduce((total, value) => total + value, 0) : null,
  };
}

const USAGE_FIELDS = ['inputTokens', 'outputTokens', 'cachedInputTokens', 'costUsd'];
const reported = (value) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null);

/** One attempt's provider-reported usage; anything missing or invalid is null (unknown). */
export function normalizeUsage(usage) {
  const result = Object.fromEntries(USAGE_FIELDS.map((field) => [field, reported(usage?.[field])]));
  // Claude reports a conversation-scoped cost on resumed turns. Keep it, labeled, but never as per-turn cost.
  if (reported(usage?.conversationCostUsd) !== null) Object.assign(result, { conversationCostUsd: usage.conversationCostUsd, costScope: 'conversation' });
  return result;
}

// The run's cost from conversation totals: the first attempt's own cost, then the
// total each resumed attempt reported, which may never fall. Null otherwise.
function conversationCost(attempts) {
  if (attempts.length < 2 || attempts[0].costUsd === null) return null;
  let cost = attempts[0].costUsd;
  for (const usage of attempts.slice(1)) {
    const total = usage.costScope === 'conversation' ? reported(usage.conversationCostUsd) : null;
    if (total === null || total < cost) return null;
    cost = total;
  }
  return cost;
}

/**
 * Sum per-attempt usage for a run. A field is known only if every attempt
 * reported it; otherwise the run total is null rather than a partial sum.
 *
 * With `conversationTotals`, a run whose later attempts are resumed Claude turns
 * takes its cost from them instead. Every attempt of a run continues the same
 * conversation, and Claude Code 2.1.277 and later report that conversation's
 * whole cost on each resumed turn, so the last attempt's total is the run's
 * cost. `costSource` is then 'conversation'. The totals are never added up.
 */
export function totalUsage(attempts, { conversationTotals = false } = {}) {
  const total = {};
  for (const field of USAGE_FIELDS) {
    total[field] = attempts.length && attempts.every((usage) => usage[field] !== null)
      ? attempts.reduce((sum, usage) => sum + usage[field], 0) : null;
  }
  if (total.costUsd === null && conversationTotals) {
    total.costUsd = conversationCost(attempts);
    if (total.costUsd !== null) total.costSource = 'conversation';
  }
  if (total.costUsd !== null) total.costUsd = Math.round(total.costUsd * 1e6) / 1e6;
  total.totalTokens = total.inputTokens !== null && total.outputTokens !== null ? total.inputTokens + total.outputTokens : null;
  total.attempts = attempts.length;
  total.attemptsWithTokens = attempts.filter((usage) => usage.inputTokens !== null && usage.outputTokens !== null).length;
  return total;
}
