/**
 * structuredClone 对纯数据的同语义快速版：保留共享引用、空位、undefined 字段与键序。
 * 战斗单位只含普通对象、数组与基本值；Map/Set 逐项复制，其他对象仍交给 structuredClone。
 * 用于 AI 预演中的高频副本，结果与 structuredClone 完全一致。
 */
export function cloneData<T>(value: T): T {
  return copy(value, new Map()) as T;
}

function copy(value: unknown, seen: Map<object, unknown>): unknown {
  if (typeof value !== 'object' || value === null) return value;
  const known = seen.get(value);
  if (known !== undefined) return known;
  if (Array.isArray(value)) {
    const out: unknown[] = new Array(value.length);
    seen.set(value, out);
    for (const key of Object.keys(value)) assign(out, key, copy((value as unknown as Record<string, unknown>)[key], seen));
    return out;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype === Object.prototype || prototype === null) {
    const out: Record<string, unknown> = {};
    seen.set(value, out);
    for (const key of Object.keys(value)) assign(out, key, copy((value as Record<string, unknown>)[key], seen));
    return out;
  }
  if (value instanceof Map) {
    const out = new Map();
    seen.set(value, out);
    for (const [key, entry] of value) out.set(copy(key, seen), copy(entry, seen));
    return out;
  }
  if (value instanceof Set) {
    const out = new Set();
    seen.set(value, out);
    for (const entry of value) out.add(copy(entry, seen));
    return out;
  }
  const out = structuredClone(value);
  seen.set(value, out);
  return out;
}

function assign(target: object, key: string, value: unknown): void {
  if (key === '__proto__') Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
  else (target as Record<string, unknown>)[key] = value;
}
