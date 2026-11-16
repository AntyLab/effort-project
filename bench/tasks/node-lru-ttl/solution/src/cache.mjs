/**
 * A bounded LRU cache with lazy expiration and an injected monotonic clock.
 * new LruCache(capacity, { ttl = Infinity, now = Date.now } = {})
 * capacity must be a positive integer; ttl (also the optional third argument
 * of set) must be nonnegative and finite, or Infinity. Otherwise throw RangeError.
 * Each operation samples now() once and removes ALL entries with expires <= now
 * before doing anything else. Expiration is measured from set, never from get.
 * set(key, value, ttl) returns this, replaces a live entry and makes it newest.
 * A zero ttl removes that key without evicting other entries. A new live entry
 * evicts the least recently used live entry only if capacity would be exceeded.
 * get(key) returns its value (or undefined) and makes a hit newest. has(key)
 * does not change recency. Undefined is a valid stored value. delete(key)
 * returns whether a live key was removed. size and keys() include live entries
 * only; keys() returns a new array ordered least to most recently used.
 * Keys have Map semantics. The caller only supplies a nondecreasing clock.
 */
function checkTtl(ttl) {
  if (typeof ttl !== 'number' || ttl < 0 || (!Number.isFinite(ttl) && ttl !== Infinity)) {
    throw new RangeError('ttl');
  }
}

export class LruCache {
  constructor(capacity, { ttl = Infinity, now = Date.now } = {}) {
    if (!Number.isInteger(capacity) || capacity <= 0) throw new RangeError('capacity');
    checkTtl(ttl);
    this.capacity = capacity;
    this.ttl = ttl;
    this.now = now;
    this.entries = new Map();
  }
  purge() {
    const now = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.expires <= now) this.entries.delete(key);
    }
    return now;
  }
  get(key) {
    this.purge();
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }
  set(key, value, ttl = this.ttl) {
    const now = this.purge();
    checkTtl(ttl);
    this.entries.delete(key);
    if (ttl === 0) return this;
    this.entries.set(key, { value, expires: now + ttl });
    if (this.entries.size > this.capacity) this.entries.delete(this.entries.keys().next().value);
    return this;
  }
  has(key) { this.purge(); return this.entries.has(key); }
  delete(key) { this.purge(); return this.entries.delete(key); }
  get size() { this.purge(); return this.entries.size; }
  keys() { this.purge(); return [...this.entries.keys()]; }
}
