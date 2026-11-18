/**
 * replay(events, initial = {}) reconstructs a ledger without changing either
 * input. All amounts and balances are integer cents; inputs and intermediate
 * balances are within the safe integer range. Account names are nonempty ASCII
 * letters/digits/underscores beginning with a letter. Missing accounts start at 0.
 *
 * Every event has a nonempty string key, a finite numeric time, a positive
 * integer amount, and type 'deposit' (account) or 'transfer' (from, to).
 * Inputs have this shape; extra metadata fields do not affect replay.
 * A key identifies one event: repeated copies count once. If copies disagree
 * on time, type, amount or their applicable account fields, throw an Error with
 * code 'duplicate_conflict' and key equal to that key, before applying any event.
 *
 * Apply unique events in ascending time, breaking ties by key in JavaScript
 * string order (<), independent of their input order. Deposits add to account.
 * A transfer subtracts from from and adds to to atomically; a self transfer
 * leaves its balance unchanged but still requires sufficient funds. Insufficient
 * funds throws an Error with code 'insufficient_funds' and the event's key.
 * Return { balances, applied }, where balances is a plain object containing
 * initial accounts and every account touched, and applied is the ordered list
 * of unique event keys. Errors must also leave both inputs unchanged.
 */
function payload(event) {
  return event.type === 'deposit'
    ? [event.time, event.type, event.amount, event.account]
    : [event.time, event.type, event.amount, event.from, event.to];
}

export function replay(events, initial = {}) {
  const unique = new Map();
  for (const event of events) {
    const previous = unique.get(event.key);
    if (previous && JSON.stringify(payload(previous)) !== JSON.stringify(payload(event))) {
      throw Object.assign(new Error('Conflicting event'), { code: 'duplicate_conflict', key: event.key });
    }
    if (!previous) unique.set(event.key, event);
  }
  const ordered = [...unique.values()].sort((a, b) => a.time - b.time || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const balances = { ...initial };
  const balance = (account) => Object.hasOwn(balances, account) ? balances[account] : 0;
  const applied = [];
  for (const event of ordered) {
    if (event.type === 'deposit') {
      balances[event.account] = balance(event.account) + event.amount;
    } else {
      const funds = balance(event.from);
      if (funds < event.amount) {
        throw Object.assign(new Error('Insufficient funds'), { code: 'insufficient_funds', key: event.key });
      }
      balances[event.from] = funds - event.amount;
      balances[event.to] = balance(event.to) + event.amount;
    }
    applied.push(event.key);
  }
  return { balances, applied };
}
