function toMoney(amount, currency) {
  const symbol = currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : '$';
  const sign = amount < 0 ? '-' : '';
  const [whole, fraction] = (Math.abs(amount) / 100).toFixed(2).split('.');
  return `${sign}${symbol}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction}`;
}

export function refundNotice(order, currency = 'USD') {
  return `Refund of ${toMoney(order.refundCents, currency)} for order ${order.id}`;
}
