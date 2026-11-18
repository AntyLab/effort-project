import test from 'node:test';
import assert from 'node:assert/strict';
import { parseExpression } from '../src/expression.mjs';

test('signs on both sides of powers preserve precedence and associativity', () => {
  for (const [source, value] of [
    ['-2^2', -4], ['(-2)^2', 4], ['2^3^2', 512], ['2^-2^2', 1 / 16],
    ['-2^-2', -0.25], ['2^--2', 4], ['--2^3', 8], ['3 * -2^2 + 5', -7],
    ['-(-2)^2', -4], ['2^(1+2)^2', 512], ['2^-(-2)', 4],
    ['10-3-2', 5], ['24/4/2', 3], ['2*3^2/6', 3], ['2^0^0', 2],
    ['1--2*-3', -5], ['1 / 0', Infinity], ['0/0', NaN],
    [' \t1. + .25 * 4\r\n', 2], ['-.5^2', -0.25],
  ]) assert.equal(parseExpression(source), value, source);
});

test('operator families across several values', () => {
  for (let a = 2; a <= 4; a += 1) {
    for (let b = 1; b <= 3; b += 1) {
      for (let c = 1; c <= 3; c += 1) {
        assert.equal(parseExpression(`-${a}^${b}^${c}`), -(a ** (b ** c)));
        assert.equal(parseExpression(`${a}^-${b}+${c}*2`), a ** -b + c * 2);
        assert.equal(parseExpression(`(${a}-${b})^2-${c}`), (a - b) ** 2 - c);
      }
    }
  }
});

test('syntax failures identify the first unexpected character or EOF', () => {
  for (const [source, position] of [
    ['', 0], ['  ', 2], ['1 +', 3], ['1 +  ', 5], ['(1 + 2', 6],
    ['(1 + )', 5], ['1 + * 2', 4], ['2^^3', 2], ['2^', 2], ['2^-', 3],
    ['1 2', 2], ['1..2', 2], ['.e2', 0], ['1e2', 1], ['1)', 1],
    ['(2] + 1', 2], ['2(3)', 1], ['3/**2', 2], ['( )', 2],
    ['2 + @', 4], ['1 +\n  * 2', 6], ['2 ** 3', 3], ['2 + .', 4],
  ]) {
    assert.throws(() => parseExpression(source), (error) => {
      assert.ok(error instanceof SyntaxError, source);
      assert.equal(error.position, position, source);
      return true;
    });
  }
});
