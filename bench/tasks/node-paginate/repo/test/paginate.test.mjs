import test from 'node:test';
import assert from 'node:assert/strict';
import { paginate } from '../src/paginate.mjs';

test('page 1 starts with the first item', () => {
  assert.deepEqual(paginate(['a', 'b', 'c', 'd', 'e'], 1, 2).items, ['a', 'b']);
});
