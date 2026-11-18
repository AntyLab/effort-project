import test from 'node:test';
import assert from 'node:assert/strict';
import { replay } from '../src/ledger.mjs';
const deposit = (key, time, account, amount) => ({ key, time, type: 'deposit', account, amount });
const transfer = (key, time, from, to, amount) => ({ key, time, type: 'transfer', from, to, amount });

test('shuffled redelivery reconstructs the same conserved balances', () => {
  const canonical = [deposit('seed', -2, 'alice', 100), transfer('A', 1, 'alice', 'bob', 70),
    transfer('B', 1, 'bob', 'carol', 50), transfer('back', 3, 'carol', 'alice', 20)];
  const expected = { balances: { reserve: 9, alice: 50, bob: 20, carol: 30 }, applied: ['seed', 'A', 'B', 'back'] };
  for (let offset = 0; offset < 12; offset += 1) {
    const events = [...canonical, ...canonical.map((e) => ({ ...e, metadata: offset }))];
    // A deterministic permutation, with every event delivered twice.
    events.sort((a, b) => ((a.key.length * 31 + offset) % 7) - ((b.key.length * 31 + offset) % 7));
    if (offset % 2) events.reverse();
    const snapshot = structuredClone(events);
    const initial = { reserve: 9 };
    assert.deepEqual(replay(events, initial), expected);
    assert.deepEqual(events, snapshot);
    assert.deepEqual(initial, { reserve: 9 });
  }
});

test('same-time ordering uses code units, not arrival order or locale order', () => {
  const events = [transfer('a', 0, 'one', 'two', 5), deposit('Z', 0, 'one', 5)];
  assert.deepEqual(replay(events), { balances: { one: 0, two: 5 }, applied: ['Z', 'a'] });
});

test('all meaningful fields participate in conflict detection; metadata does not', () => {
  const original = transfer('key', 4, 'a', 'b', 5);
  for (const patch of [{ time: 5 }, { amount: 6 }, { from: 'c' }, { to: 'c' },
    { type: 'deposit', account: 'a' }]) {
    assert.throws(() => replay([original, { ...original, ...patch }]), { code: 'duplicate_conflict', key: 'key' });
  }
  const credit = deposit('credit', 1, 'a', 5);
  assert.throws(() => replay([credit, { ...credit, account: 'b' }]), { code: 'duplicate_conflict', key: 'credit' });
  assert.deepEqual(replay([credit, { ...credit, from: 'unused', to: 'unused', note: 'redelivered' }]),
    { balances: { a: 5 }, applied: ['credit'] });
  // Duplicate validation precedes replay, even when the first event is unaffordable.
  assert.throws(() => replay([original, { ...original, amount: 8 }]), { code: 'duplicate_conflict', key: 'key' });
});

test('chronological insufficiency cannot borrow from a later deposit', () => {
  const initial = { a: 3, spare: 8 };
  const events = [deposit('later', 10, 'a', 100), transfer('early', 1, 'a', 'b', 4)];
  const snapshot = structuredClone(events);
  assert.throws(() => replay(events, initial), { code: 'insufficient_funds', key: 'early' });
  assert.deepEqual(initial, { a: 3, spare: 8 });
  assert.deepEqual(events, snapshot);
});

test('self transfers still check funds, touch accounts, and appear once', () => {
  const e = transfer('self', 0, 'a', 'a', 6);
  assert.deepEqual(replay([e, { ...e }], { a: 6, untouched: 0 }),
    { balances: { a: 6, untouched: 0 }, applied: ['self'] });
  assert.throws(() => replay([e], { a: 5 }), { code: 'insufficient_funds', key: 'self' });
  assert.deepEqual(replay([]), { balances: {}, applied: [] });
});

test('account names inherited from Object.prototype still begin at zero', () => {
  const events = [deposit('start', 1, 'constructor', 12),
    transfer('move', 2, 'constructor', 'toString', 5),
    transfer('back', 3, 'toString', 'hasOwnProperty', 2)];
  assert.deepEqual(replay(events), {
    balances: { constructor: 7, toString: 3, hasOwnProperty: 2 }, applied: ['start', 'move', 'back'],
  });
  assert.deepEqual(replay([transfer('own', 0, 'constructor', 'toString', 3)], { constructor: 4, toString: 2 }),
    { balances: { constructor: 1, toString: 5 }, applied: ['own'] });
  assert.throws(() => replay([transfer('absent', 0, 'valueOf', 'a', 1)]),
    { code: 'insufficient_funds', key: 'absent' });
});
