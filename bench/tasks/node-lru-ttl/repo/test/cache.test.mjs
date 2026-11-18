import test from 'node:test';
import assert from 'node:assert/strict';
import { LruCache } from '../src/cache.mjs';

test('a get changes which live key is evicted', () => {
  const c = new LruCache(2, { now: () => 0 });
  c.set('a', 1).set('b', 2);
  assert.equal(c.get('a'), 1);
  c.set('c', 3);
  assert.deepEqual(c.keys(), ['a', 'c']);
});

test('expiration frees space before a live key is evicted', () => {
  let time = 0;
  const c = new LruCache(2, { now: () => time });
  c.set('a', 1, 100).set('b', 2, 5);
  time = 5;
  c.set('c', 3);
  assert.deepEqual(c.keys(), ['a', 'c']);
});
