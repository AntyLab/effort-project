import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

const source = new URL('../src/', import.meta.url);

test('cart exports calculateTotal with unchanged behavior', async () => {
  const cart = await import('../src/cart.mjs');
  assert.equal(typeof cart.calculateTotal, 'function', 'src/cart.mjs should export calculateTotal');
  assert.equal(cart.calculateTotal([{ price: 250, quantity: 2 }, { price: 100, quantity: 1 }]), 600);
  assert.equal(cart.calculateTotal([{ price: 1000, quantity: 1 }], { taxRate: 0.08 }), 1080);
  assert.equal(cart.calculateTotal([]), 0);
});

test('the entry point re-exports the new name and receipts still work', async () => {
  const index = await import('../src/index.mjs');
  assert.equal(typeof index.calculateTotal, 'function', 'src/index.mjs should re-export calculateTotal');
  assert.equal(index.formatReceipt([{ price: 199, quantity: 3 }]), '3 items, total 5.97');
  assert.equal(index.formatReceipt([{ price: 1000, quantity: 2 }], { taxRate: 0.1 }), '2 items, total 22.00');
});

test('no module keeps the misspelled name', async () => {
  const cart = await import('../src/cart.mjs');
  const index = await import('../src/index.mjs');
  assert.equal(Object.hasOwn(cart, 'calcualteTotal'), false, 'src/cart.mjs still exports calcualteTotal');
  assert.equal(Object.hasOwn(index, 'calcualteTotal'), false, 'src/index.mjs still exports calcualteTotal');
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.m?js$/.test(entry.name)) continue;
    const text = await readFile(new URL(entry.name, source), 'utf8');
    assert.equal(text.includes('calcualteTotal'), false, `src/${entry.name} still mentions calcualteTotal`);
  }
});
