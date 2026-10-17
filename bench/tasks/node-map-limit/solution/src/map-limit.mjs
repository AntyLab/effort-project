/**
 * Map `items` through the async function `fn`, with at most `limit` calls in
 * flight at any time.
 *
 * Resolves to the results in input order. If a call rejects, the returned
 * promise rejects with that first error and no new calls are started.
 *
 * @template T, R
 * @param {T[]} items
 * @param {number} limit A positive integer.
 * @param {(item: T) => Promise<R>} fn
 * @returns {Promise<R[]>}
 */
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  let failed = false;

  async function worker() {
    while (!failed && next < items.length) {
      const index = next++;
      try {
        results[index] = await fn(items[index]);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(limit, items.length); i++) workers.push(worker());
  await Promise.all(workers);
  return results;
}
