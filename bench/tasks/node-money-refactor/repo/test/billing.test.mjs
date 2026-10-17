import test from 'node:test';
import assert from 'node:assert/strict';
import { invoiceLines, invoiceTotal } from '../src/invoice.mjs';
import { monthlyReport } from '../src/report.mjs';
import { refundNotice } from '../src/refund.mjs';

test('invoice lines and total', () => {
  const items = [{ name: 'Desk', cents: 129_900 }, { name: 'Lamp', cents: 4_550 }];
  assert.deepEqual(invoiceLines(items), ['Desk: $1,299.00', 'Lamp: $45.50']);
  assert.equal(invoiceTotal(items, 'EUR'), '€1,344.50');
});

test('monthly report', () => {
  assert.equal(monthlyReport([{ month: 'Jan', cents: 1_000 }, { month: 'Feb', cents: -250 }]), 'Jan: $10.00\nFeb: -$2.50\nTotal: $7.50');
});

test('refund notice', () => {
  assert.equal(refundNotice({ id: 'A17', refundCents: 999 }, 'GBP'), 'Refund of £9.99 for order A17');
});
