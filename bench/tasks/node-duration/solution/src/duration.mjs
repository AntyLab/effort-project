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
  const source = String(text).trim();
  if (!source) throw new TypeError(`Invalid duration: ${text}`);
  // "ms" must be tried before "m" so that "500ms" is not read as minutes.
  const part = /(\d+)(ms|s|m|h|d) */y;
  let total = 0;
  let index = 0;
  while (index < source.length) {
    part.lastIndex = index;
    const match = part.exec(source);
    if (!match) throw new TypeError(`Invalid duration: ${text}`);
    total += Number(match[1]) * UNITS[match[2]];
    index = part.lastIndex;
  }
  return total;
}
