import test from 'node:test';
import assert from 'node:assert/strict';
import { mapLimit } from '../src/map-limit.mjs';

// Calls are settled by hand, so these checks do not depend on timer precision.
const tick = () => new Promise((resolve) => setImmediate(resolve));

function controlled() {
  const calls = [];
  let active = 0;
  let peak = 0;
  const fn = (item) => {
    active += 1;
    peak = Math.max(peak, active);
    let resolvePromise;
    let rejectPromise;
    const promise = new Promise((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    const call = {
      item,
      settled: false,
      resolve(value) { call.settled = true; resolvePromise(value); },
      reject(error) { call.settled = true; rejectPromise(error); },
    };
    calls.push(call);
    return promise.finally(() => { active -= 1; });
  };
  return { fn, calls, peak: () => peak };
}

// Settle whatever is in flight, newest call first, until `run` finishes.
async function drive(run, calls) {
  let done = false;
  run.then(() => { done = true; }, () => { done = true; });
  for (let round = 0; round < 1000 && !done; round += 1) {
    await tick();
    for (const call of calls.filter((entry) => !entry.settled).reverse()) {
      call.resolve(call.item * 10);
      await tick();
    }
  }
  return run;
}

test('results follow input order when calls finish out of order', async () => {
  const c = controlled();
  assert.deepEqual(await drive(mapLimit([1, 2, 3, 4, 5, 6, 7], 3, c.fn), c.calls), [10, 20, 30, 40, 50, 60, 70]);
});

test('never more than `limit` calls are in flight, and each item is called once', async () => {
  const c = controlled();
  await drive(mapLimit([1, 2, 3, 4, 5, 6, 7, 8], 3, c.fn), c.calls);
  assert.ok(c.peak() <= 3, `peak concurrency was ${c.peak()}`);
  assert.deepEqual(c.calls.map((call) => call.item).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('a limit larger than the list works', async () => {
  const c = controlled();
  assert.deepEqual(await drive(mapLimit([1, 2], 10, c.fn), c.calls), [10, 20]);
});

test('rejects with the first error and starts no new calls afterwards', async () => {
  const c = controlled();
  const outcome = mapLimit([1, 2, 3, 4, 5, 6], 2, c.fn).then(() => 'resolved', (error) => error);
  await tick();
  assert.equal(c.calls.length, 2, 'two calls should be in flight');
  c.calls[0].reject(new Error('first failure'));
  await tick();
  c.calls[1].resolve(20);
  for (let i = 0; i < 5; i += 1) await tick();
  const error = await outcome;
  assert.ok(error instanceof Error, 'mapLimit should reject');
  assert.equal(error.message, 'first failure');
  assert.equal(c.calls.length, 2, 'no new calls may start after a rejection');
});

test('an empty list resolves to an empty array without calling fn', async () => {
  let called = false;
  assert.deepEqual(await mapLimit([], 2, async () => { called = true; }), []);
  assert.equal(called, false);
});
