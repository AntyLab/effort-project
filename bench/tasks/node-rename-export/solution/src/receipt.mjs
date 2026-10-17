import { calculateTotal, itemCount } from './cart.mjs';

export function formatReceipt(items, options) {
  const total = calculateTotal(items, options);
  return `${itemCount(items)} items, total ${(total / 100).toFixed(2)}`;
}
