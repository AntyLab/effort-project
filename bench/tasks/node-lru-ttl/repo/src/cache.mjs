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
export class LruCache {
  constructor(capacity, { ttl = Infinity, now = Date.now } = {}) {
    if (!Number.isInteger(capacity) || capacity <= 0) throw new RangeError('capacity');
    this.capacity = capacity;
    this.ttl = ttl;
    this.now = now;
    this.entries = new Map();
  }
  get(key) {
    const entry = this.entries.get(key);
    if (!entry || entry.expires <= this.now()) { this.entries.delete(key); return undefined; }
    return entry.value;
  }
  set(key, value, ttl = this.ttl) {
    this.entries.delete(key);
    if (this.entries.size >= this.capacity) this.entries.delete(this.entries.keys().next().value);
    this.entries.set(key, { value, expires: this.now() + ttl });
    return this;
  }
  has(key) { return this.get(key) !== undefined; }
  delete(key) { return this.entries.delete(key); }
  get size() { return this.entries.size; }
  keys() { return [...this.entries.keys()]; }
}
