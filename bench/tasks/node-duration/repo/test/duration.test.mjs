import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDuration } from '../src/duration.mjs';

test('parseDuration handles single units', () => {
  assert.equal(parseDuration('90s'), 90_000);
  assert.equal(parseDuration('250ms'), 250);
});

test('parseDuration handles compound values', () => {
  assert.equal(parseDuration('1h30m'), 5_400_000);
});
