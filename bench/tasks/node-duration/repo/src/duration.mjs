const UNITS = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };

/**
 * Parse a duration such as "90s", "1h30m" or "2d 4h" into milliseconds.
 *
 * The text is one or more parts. Each part is a whole number immediately
 * followed by a unit: ms, s, m, h or d. Parts may be separated by spaces, and
 * leading or trailing spaces are ignored. Anything else is invalid and throws
 * a TypeError.
 *
 * @param {string} text
 * @returns {number}
 */
export function parseDuration(text) {
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(String(text).trim());
  if (!match) throw new TypeError(`Invalid duration: ${text}`);
  return Number(match[1]) * UNITS[match[2]];
}
