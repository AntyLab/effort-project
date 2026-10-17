export const Z95 = 1.959963984540054;

/** Wilson score interval for a binomial proportion; null when there are no trials. */
export function wilson(successes, trials, z = Z95) {
  if (!Number.isInteger(trials) || trials < 0) throw new RangeError('trials must be a non-negative integer.');
  if (!Number.isInteger(successes) || successes < 0 || successes > trials) throw new RangeError('successes must be an integer from 0 to trials.');
  if (trials === 0) return null;
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
 * Arms run the same tasks and repeats, so their outcomes are paired. Chosen
 * over a task-clustered bootstrap, which would also model correlated repeats:
 * with about eleven tasks a percentile bootstrap undercovers, and when every
 * pair agrees (likely in a small pilot) it collapses to a zero-width interval
 * that reads as non-inferior. This one is closed form, needs no seed and keeps
 * its width there. Its limit: pairs count as independent, so repeats of one
 * task, which are correlated, still make the interval too narrow.
 */
export function newcombePaired(both, firstOnly, secondOnly, neither, z = Z95) {
  const cells = [both, firstOnly, secondOnly, neither];
  if (!cells.every((value) => Number.isInteger(value) && value >= 0)) throw new RangeError('paired counts must be non-negative integers.');
  const pairs = both + firstOnly + secondOnly + neither;
  if (pairs === 0) return null;
  const first = wilson(both + firstOnly, pairs, z);
  const second = wilson(both + secondOnly, pairs, z);
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
