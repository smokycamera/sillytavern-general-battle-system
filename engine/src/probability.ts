import type { Rng } from './rng.js';
/** 常规机制骰的精确有限分布；不访问战斗随机源。 */
const cache = new Map<string, Map<number, number>>();
export function diceDistribution(expression?: string, times = 1): Map<number, number> | undefined {
  if (!expression) return new Map([[0, 1]]);
  const key = expression + ':' + times;
  if (cache.has(key)) return cache.get(key)!;
  const match = /^(\d+)d(\d+)([+-]\d+)?$/i.exec(expression.replace(/\s/g, ''));
  if (!match) return undefined;
  const count = Number(match[1]) * times, sides = Number(match[2]), flat = Number(match[3] ?? 0);
  if (count < 1 || sides < 2 || count * sides > 1000) return undefined;
  let distribution = new Map<number, number>([[flat, 1]]);
  for (let die = 0; die < count; die++) {
    const next = new Map<number, number>();
    for (const [value, probability] of distribution) for (let face = 1; face <= sides; face++) next.set(value + face, (next.get(value + face) ?? 0) + probability / sides);
    distribution = next;
  }
  if (cache.size > 256) cache.clear();
  cache.set(key, distribution); return distribution;
}

export function v2DamageAmount(base: number, ap: number, factor: number, multiplier: number): number {
  // 全部穿透、伤害与人数乘数算完后才离散化，避免逐段向下取整吞掉小额伤害。
  return Math.max(0, Math.round((base + ap) * factor * multiplier * 1e9) / 1e9);
}

/** 保持期望的概率取整：0.3点有30%概率兑现1点；整数和零伤害不消费额外随机数。 */
export function roundDamage(amount: number, rng: Pick<Rng, 'next'>): number {
  const low = Math.floor(amount), fraction = amount - low;
  return low + Number(fraction > 0 && rng.next() < fraction);
}

const momentsCache = new Map<string, { mean: number; second: number; min: number; max: number; positive: number }>();
export function damageMoments(base: string | undefined, ap: string | undefined, times: number, factor: number, multiplier: number) {
  const key = JSON.stringify([base, ap, times, factor, multiplier]);
  const cached = momentsCache.get(key); if (cached) return cached;
  const bases = diceDistribution(base, times), aps = diceDistribution(ap, times);
  if (!bases || !aps) return undefined;
  let mean = 0, second = 0, min = Infinity, max = 0, positive = 0;
  for (const [b, bp] of bases) for (const [a, ap] of aps) {
    const damage = v2DamageAmount(b, a, factor, multiplier), probability = bp * ap;
    const low = Math.floor(damage), fraction = damage - low;
    mean += damage * probability; second += (damage * damage + fraction * (1 - fraction)) * probability;
    min = Math.min(min, low); max = Math.max(max, Math.ceil(damage));
    positive += Math.min(1, damage) * probability;
  }
  const result = { mean, second, min, max, positive };
  if (momentsCache.size > 2048) momentsCache.clear();
  momentsCache.set(key, result); return result;
}
