import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// A missing module must read as a failed check, not as an environment error.
async function load(path) {
  try {
    return await import(path);
  } catch {
    assert.fail(`${path} is missing or does not load`);
  }
}

test('src/money.mjs exports formatMoney with the shared behavior', async () => {
  const { formatMoney } = await load('../src/money.mjs');
  assert.equal(typeof formatMoney, 'function', 'src/money.mjs should export formatMoney');
  assert.equal(formatMoney(123_456), '$1,234.56');
  assert.equal(formatMoney(123_456, 'USD'), '$1,234.56');
  assert.equal(formatMoney(-500, 'EUR'), '-€5.00');
  assert.equal(formatMoney(99, 'GBP'), '£0.99');
  assert.equal(formatMoney(0), '$0.00');
  assert.equal(formatMoney(100_000_000), '$1,000,000.00');
});

test('invoice, report and refund output is unchanged', async () => {
  const { invoiceLines, invoiceTotal } = await load('../src/invoice.mjs');
  const { monthlyReport } = await load('../src/report.mjs');
  const { refundNotice } = await load('../src/refund.mjs');
  const items = [{ name: 'Desk', cents: 129_900 }, { name: 'Lamp', cents: 4_550 }];
  assert.deepEqual(invoiceLines(items, 'GBP'), ['Desk: £1,299.00', 'Lamp: £45.50']);
  assert.equal(invoiceTotal(items), '$1,344.50');
  assert.equal(invoiceTotal([]), '$0.00');
  assert.equal(monthlyReport([{ month: 'Mar', cents: 1_234_567 }], 'EUR'), 'Mar: €12,345.67\nTotal: €12,345.67');
  assert.equal(monthlyReport([]), 'Total: $0.00');
  assert.equal(refundNotice({ id: 'B2', refundCents: -1 }), 'Refund of -$0.01 for order B2');
});

test('the three modules use the shared helper instead of local copies', async () => {
  for (const name of ['invoice.mjs', 'report.mjs', 'refund.mjs']) {
    const text = await readFile(new URL(`../src/${name}`, import.meta.url), 'utf8');
    assert.match(text, /from\s+['"]\.\/money\.mjs['"]/, `src/${name} should import from ./money.mjs`);
    assert.doesNotMatch(text, /toFixed\(/, `src/${name} still contains its own formatting code`);
  }
});
