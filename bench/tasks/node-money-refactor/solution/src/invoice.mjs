import { formatMoney } from './money.mjs';

export function invoiceLines(items, currency = 'USD') {
  return items.map((item) => `${item.name}: ${formatMoney(item.cents, currency)}`);
}

export function invoiceTotal(items, currency = 'USD') {
  return formatMoney(items.reduce((sum, item) => sum + item.cents, 0), currency);
}
