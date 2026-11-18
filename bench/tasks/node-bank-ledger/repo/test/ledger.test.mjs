import test from 'node:test';
import assert from 'node:assert/strict';
import { replay } from '../src/ledger.mjs';

test('arrival order does not determine replay order', () => {
  const events = [
    { key: 'transfer', time: 2, type: 'transfer', from: 'alice', to: 'bob', amount: 40 },
    { key: 'opening', time: 1, type: 'deposit', account: 'alice', amount: 100 },
  ];
  assert.deepEqual(replay(events), { balances: { alice: 60, bob: 40 }, applied: ['opening', 'transfer'] });
});

test('redelivered events count once', () => {
  const event = { key: 'credit', time: 1, type: 'deposit', account: 'alice', amount: 10 };
  assert.deepEqual(replay([event, { ...event }]), { balances: { alice: 10 }, applied: ['credit'] });
});
