/**
 * Return one page of `items`.
 *
 * Pages are 1-based: page 1 holds items[0] to items[pageSize - 1].
 * `totalPages` counts every page that has at least one item.
 * Pages past the end have no items.
 *
 * @param {unknown[]} items
 * @param {number} page
 * @param {number} [pageSize=10]
 * @returns {{ items: unknown[], page: number, totalPages: number }}
 */
export function paginate(items, page, pageSize = 10) {
  const totalPages = Math.floor(items.length / pageSize);
  const start = page * pageSize;
  return { items: items.slice(start, start + pageSize), page, totalPages };
}
