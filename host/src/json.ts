/** Stable across host locale and object insertion order. */
export function serialized(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item === 'number' && !Number.isFinite(item)) throw Error('存档含有非有限数字');
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      // Avoid allocating an entry tuple (and comparator tuples) for every field
      // of every historical event. Null prototype also preserves __proto__ keys.
      const ordered: Record<string, unknown> = Object.create(null);
      for (const key of Object.keys(item).sort()) ordered[key] = (item as Record<string, unknown>)[key];
      return ordered;
    }
    return item;
  });
}
