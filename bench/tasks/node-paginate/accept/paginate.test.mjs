import test from 'node:test';
import assert from 'node:assert/strict';
import { paginate } from '../src/paginate.mjs';

const letters = ['a', 'b', 'c', 'd', 'e'];
const numbers = (count) => Array.from({ length: count }, (_, index) => index);

test('pages are 1-based', () => {
  assert.deepEqual(paginate(letters, 1, 2), { items: ['a', 'b'], page: 1, totalPages: 3 });
  assert.deepEqual(paginate(letters, 2, 2), { items: ['c', 'd'], page: 2, totalPages: 3 });
  assert.deepEqual(paginate(letters, 3, 2), { items: ['e'], page: 3, totalPages: 3 });
});

test('totalPages counts a partial last page and exact multiples', () => {
  assert.equal(paginate(numbers(4), 1, 2).totalPages, 2);
  assert.equal(paginate(numbers(5), 1, 4).totalPages, 2);
  assert.equal(paginate(numbers(1), 1, 4).totalPages, 1);
  assert.equal(paginate([], 1, 3).totalPages, 0);
});

test('the default page size is 10', () => {
  const page = paginate(numbers(25), 3);
  assert.deepEqual(page.items, [20, 21, 22, 23, 24]);
  assert.equal(page.totalPages, 3);
});

test('pages past the end are empty', () => {
  assert.deepEqual(paginate(['a', 'b', 'c'], 3, 2).items, []);
  assert.deepEqual(paginate([], 1, 5).items, []);
});
