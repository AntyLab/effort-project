function formatCents(cents, currency) {
  const symbol = currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : '$';
  const sign = cents < 0 ? '-' : '';
  const [whole, fraction] = (Math.abs(cents) / 100).toFixed(2).split('.');
  return `${sign}${symbol}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction}`;
}

export function invoiceLines(items, currency = 'USD') {
  return items.map((item) => `${item.name}: ${formatCents(item.cents, currency)}`);
}

export function invoiceTotal(items, currency = 'USD') {
  return formatCents(items.reduce((sum, item) => sum + item.cents, 0), currency);
}
