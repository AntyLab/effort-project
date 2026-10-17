// Cart helpers. Prices are integer cents.

export function calcualteTotal(items, { taxRate = 0 } = {}) {
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  return Math.round(subtotal * (1 + taxRate));
}

export function itemCount(items) {
  return items.reduce((count, item) => count + item.quantity, 0);
}
