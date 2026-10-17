export const Z95 = 1.959963984540054;

/** Wilson score interval for a binomial proportion; null when there are no trials. */
export function wilson(successes, trials, z = Z95) {
  if (!Number.isInteger(trials) || trials < 0) throw new RangeError('trials must be a non-negative integer.');
  if (!Number.isInteger(successes) || successes < 0 || successes > trials) throw new RangeError('successes must be an integer from 0 to trials.');
  if (trials === 0) return null;
  return wilsonBounds(successes, trials, z);
}

// The Wilson formula itself, which also takes the fractional effective counts of newcombePairedByTask.
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
    return { size: cells[0] + cells[1] + cells[2] + cells[3], difference: cells[1] - cells[2], discordant: cells[1] + cells[2] };
  }).filter((cluster) => cluster.size > 0);
  const count = clusters.length;
  const pairs = clusters.reduce((sum, cluster) => sum + cluster.size, 0);
  if (pairs === count) return { designEffect: 1, basis: 'one pair per task', tasks: count, pairs };
  const bound = pairs / count;
  const mean = clusters.reduce((sum, cluster) => sum + cluster.difference, 0) / pairs;
  // Each pair's difference is −1, 0 or 1, so the sum of squared deviations is
  // the discordant count minus pairs × mean².
  const squares = clusters.reduce((sum, cluster) => sum + cluster.discordant, 0) - pairs * mean * mean;
  if (count < 2 || squares <= 1e-9) return { designEffect: bound, basis: 'upper bound', tasks: count, pairs };
  const independent = squares / (pairs * (pairs - 1));
  const between = (count / (count - 1)) * clusters.reduce((sum, cluster) => sum + (cluster.difference - cluster.size * mean) ** 2, 0) / (pairs * pairs);
  return { designEffect: Math.min(Math.max(between / independent, 1), bound), basis: 'estimated', tasks: count, pairs };
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

/**
 * Sum per-attempt usage for a run. A field is known only if every attempt
 * reported it; otherwise the run total is null rather than a partial sum.
 */
export function totalUsage(attempts) {
  const total = {};
  for (const field of USAGE_FIELDS) {
    total[field] = attempts.length && attempts.every((usage) => usage[field] !== null)
      ? attempts.reduce((sum, usage) => sum + usage[field], 0) : null;
  }
  if (total.costUsd !== null) total.costUsd = Math.round(total.costUsd * 1e6) / 1e6;
  total.totalTokens = total.inputTokens !== null && total.outputTokens !== null ? total.inputTokens + total.outputTokens : null;
  total.attempts = attempts.length;
  total.attemptsWithTokens = attempts.filter((usage) => usage.inputTokens !== null && usage.outputTokens !== null).length;
  return total;
}
