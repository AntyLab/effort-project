function money(value, currency) {
  const symbol = currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : '$';
  const sign = value < 0 ? '-' : '';
  const [whole, fraction] = (Math.abs(value) / 100).toFixed(2).split('.');
  return `${sign}${symbol}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction}`;
}

export function monthlyReport(entries, currency = 'USD') {
  const lines = entries.map((entry) => `${entry.month}: ${money(entry.cents, currency)}`);
  const total = entries.reduce((sum, entry) => sum + entry.cents, 0);
  return [...lines, `Total: ${money(total, currency)}`].join('\n');
}
