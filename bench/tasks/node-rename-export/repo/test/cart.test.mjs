import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateTotal, itemCount } from '../src/cart.mjs';

test('calculateTotal multiplies price by quantity', () => {
  assert.equal(calculateTotal([{ price: 250, quantity: 2 }, { price: 100, quantity: 1 }]), 600);
});

test('itemCount adds quantities', () => {
  assert.equal(itemCount([{ price: 1, quantity: 2 }, { price: 1, quantity: 3 }]), 5);
});
