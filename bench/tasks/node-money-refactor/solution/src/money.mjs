export function formatMoney(cents, currency = 'USD') {
  const symbol = currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : '$';
  const sign = cents < 0 ? '-' : '';
  const [whole, fraction] = (Math.abs(cents) / 100).toFixed(2).split('.');
  return `${sign}${symbol}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction}`;
}
