import { formatMoney } from './money.mjs';

export function refundNotice(order, currency = 'USD') {
  return `Refund of ${formatMoney(order.refundCents, currency)} for order ${order.id}`;
}
