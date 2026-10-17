import { calcualteTotal, itemCount } from './cart.mjs';

export function formatReceipt(items, options) {
  const total = calcualteTotal(items, options);
  return `${itemCount(items)} items, total ${(total / 100).toFixed(2)}`;
}
