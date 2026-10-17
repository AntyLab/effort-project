import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDuration } from '../src/duration.mjs';

test('single units', () => {
  assert.equal(parseDuration('90s'), 90_000);
  assert.equal(parseDuration('250ms'), 250);
  assert.equal(parseDuration('2d'), 172_800_000);
  assert.equal(parseDuration('  45m '), 2_700_000);
});

test('compound values with and without spaces', () => {
  assert.equal(parseDuration('1h30m'), 5_400_000);
  assert.equal(parseDuration('2d 4h'), 187_200_000);
  assert.equal(parseDuration('1h 5m 10s'), 3_910_000);
  assert.equal(parseDuration('1m30s500ms'), 90_500);
});

test('invalid input throws a TypeError', () => {
  for (const text of ['', '   ', 'abc', '10', '5x', '1h-30m', '1.5h', 'h1', '1h30', '1 h']) {
    assert.throws(() => parseDuration(text), TypeError, JSON.stringify(text));
  }
});
