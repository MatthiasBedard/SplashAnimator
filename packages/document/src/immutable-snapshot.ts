// Only snapshots recursively checked and frozen here may use immutable-data
// memoization. Object.isFrozen alone would accept a shallow-frozen mutable tree.
const snapshots = new WeakSet<object>();
const freeze = Object.freeze;

export function isImmutableSnapshot(value: unknown): value is object {
  return !!value && typeof value === 'object' && snapshots.has(value);
}

/** Freeze caller-owned detached data, preserving every original field. This
 * supplies no authoring authority and never freezes an external source for it. */
export function freezeSnapshot<T>(value: T): T {
  const visiting = new WeakSet<object>();
  function visit(item: unknown): void {
    if (!item || typeof item !== 'object') {
      if (
        (typeof item === 'number' && !Number.isFinite(item)) ||
        (item !== null && !['undefined', 'number', 'string', 'boolean'].includes(typeof item))
      )
        throw Error('Immutable snapshots require finite serializable data.');
      return;
    }
    if (snapshots.has(item)) return;
    if (visiting.has(item)) throw Error('Immutable snapshots cannot contain cycles.');
    if (![Object.prototype, Array.prototype, null].includes(Object.getPrototypeOf(item)))
      throw Error('Immutable snapshots require original plain data.');
    visiting.add(item);
    const fields = Object.getOwnPropertyDescriptors(item);
    for (const key of Reflect.ownKeys(fields)) {
      if (typeof key !== 'string' || !('value' in fields[key]))
        throw Error('Immutable snapshots require original data fields.');
      visit(fields[key].value);
    }
    freeze(item);
    snapshots.add(item);
    visiting.delete(item);
  }
  visit(value);
  return value;
}
