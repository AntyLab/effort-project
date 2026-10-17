import { formatMoney } from './money.mjs';

export function monthlyReport(entries, currency = 'USD') {
  const lines = entries.map((entry) => `${entry.month}: ${formatMoney(entry.cents, currency)}`);
  const total = entries.reduce((sum, entry) => sum + entry.cents, 0);
  return [...lines, `Total: ${formatMoney(total, currency)}`].join('\n');
}
