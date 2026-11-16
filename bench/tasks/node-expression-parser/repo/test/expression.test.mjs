import test from 'node:test';
import assert from 'node:assert/strict';
import { parseExpression } from '../src/expression.mjs';

test('exponents bind before signs and associate right', () => {
  assert.equal(parseExpression('-2^2'), -4);
  assert.equal(parseExpression('2^3^2'), 512);
  assert.equal(parseExpression('2^-2'), 0.25);
});

test('parentheses, sums and products', () => {
  assert.equal(parseExpression('2 * (3 + .5) - 1'), 6);
  assert.equal(parseExpression('20 / 2 / 5'), 2);
});
