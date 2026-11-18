import test from 'node:test';
import assert from 'node:assert/strict';
import { LruCache } from '../src/cache.mjs';

test('expiration, replacement, zero TTL, undefined values and non-promoting has', () => {
  let time = 0;
  const c = new LruCache(3, { ttl: 10, now: () => time });
  c.set('a', 1, Infinity).set('b', undefined, 3).set('c', 3, 20);
  assert.equal(c.has('b'), true);
  assert.deepEqual(c.keys(), ['a', 'b', 'c']);
  time = 3;
  assert.equal(c.delete('b'), false);
  assert.equal(c.size, 2);
  c.set('d', 4).set('a', 5, 0);
  assert.deepEqual(c.keys(), ['c', 'd']);
  c.set('c', 30, 2);
  assert.deepEqual(c.keys(), ['d', 'c']);
  time = 5;
  assert.equal(c.get('c'), undefined);
  assert.equal(c.get('d'), 4);
  time = 13;
  assert.equal(c.size, 0);
});

test('all observations purge nonadjacent expired entries, even a get miss', () => {
  let time = 0;
  const c = new LruCache(4, { now: () => time });
  c.set('a', 1, 1).set('b', 2, Infinity).set('c', 3, 1).set('d', 4, Infinity);
  time = 1;
  assert.equal(c.get('missing'), undefined);
  assert.equal(c.size, 2);
  assert.deepEqual(c.keys(), ['b', 'd']);
  const keys = c.keys(); keys.pop();
  assert.equal(c.size, 2);
});

test('clock is read once per operation and invalid limits are rejected', () => {
  let calls = 0;
  const c = new LruCache(1, { now: () => { calls += 1; return 0; } });
  for (const op of [() => c.set('a', 1), () => c.get('a'), () => c.has('a'),
    () => c.keys(), () => c.size, () => c.delete('a')]) {
    const before = calls; op(); assert.equal(calls - before, 1);
  }
  for (const capacity of [0, -1, 1.5, Infinity, NaN]) assert.throws(() => new LruCache(capacity), RangeError);
  for (const ttl of [-1, NaN, -Infinity, '1']) {
    assert.throws(() => new LruCache(1, { ttl }), RangeError);
    assert.throws(() => c.set('x', 1, ttl), RangeError);
  }
});

test('deterministic operation traces agree with an independent array model', () => {
  for (const capacity of [1, 2, 4]) {
    let time = 0;
    let state = [];
    const c = new LruCache(capacity, { ttl: 7, now: () => time });
    let seed = 9127;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
    for (let i = 0; i < 400; i += 1) {
      time += random() % 3;
      state = state.filter((entry) => entry.expires > time);
      const key = random() % 6;
      const op = random() % 5;
      const index = state.findIndex((entry) => entry.key === key);
      if (op === 0) {
        const ttl = [0, 1, 7, Infinity][random() % 4];
        const value = i % 3 ? i : undefined;
        state = state.filter((entry) => entry.key !== key);
        if (ttl) state.push({ key, value, expires: time + ttl });
        if (state.length > capacity) state.shift();
        assert.equal(c.set(key, value, ttl), c);
      } else if (op === 1) {
        const entry = index < 0 ? undefined : state.splice(index, 1)[0];
        if (entry) state.push(entry);
        assert.equal(c.get(key), entry?.value);
      } else if (op === 2) {
        assert.equal(c.has(key), index >= 0);
      } else if (op === 3) {
        assert.equal(c.delete(key), index >= 0);
        if (index >= 0) state.splice(index, 1);
      }
      assert.equal(c.size, state.length);
      assert.deepEqual(c.keys(), state.map((entry) => entry.key));
    }
  }
});

test('keys use Map identity, including objects and NaN', () => {
  const first = {};
  const second = {};
  const c = new LruCache(3, { now: () => 0 });
  c.set(first, 'first').set(second, 'second').set(NaN, undefined);
  assert.equal(c.has(NaN), true);
  assert.equal(c.get(first), 'first');
  c.set('new', 3);
  assert.equal(c.has(second), false);
  assert.deepEqual(c.keys(), [NaN, first, 'new']);
});
