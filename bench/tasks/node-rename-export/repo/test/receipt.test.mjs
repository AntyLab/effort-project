import test from 'node:test';
import assert from 'node:assert/strict';
import { formatReceipt } from '../src/receipt.mjs';

test('formatReceipt shows the item count and total', () => {
  assert.equal(formatReceipt([{ price: 199, quantity: 3 }]), '3 items, total 5.97');
});
