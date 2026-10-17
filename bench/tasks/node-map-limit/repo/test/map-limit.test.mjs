import test from 'node:test';
import assert from 'node:assert/strict';
import { mapLimit } from '../src/map-limit.mjs';

const delay = (ms, value) => new Promise((resolve) => setTimeout(resolve, ms, value));

test('mapLimit returns results in input order', async () => {
  const result = await mapLimit([30, 10, 20], 2, (ms) => delay(ms, ms));
  assert.deepEqual(result, [30, 10, 20]);
});

test('mapLimit handles an empty list', async () => {
  assert.deepEqual(await mapLimit([], 3, async (value) => value), []);
});
