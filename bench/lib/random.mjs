import { createHash } from 'node:crypto';

/** A deterministic number in [0, 1) derived from `parts`, identical on every platform. */
export function unitHash(...parts) {
  return createHash('sha256').update(parts.map(String).join('\u001f')).digest().readUInt32BE(0) / 2 ** 32;
}

/** A seeded generator: the same seed always yields the same sequence. */
export function seededRandom(seed) {
  let counter = 0;
  return () => unitHash(seed, counter++);
}

/** Fisher–Yates shuffle of a copy of `items`. */
export function shuffle(items, random) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
