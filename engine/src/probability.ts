import { parseDice } from './dice.js';
import type { Rng } from './rng.js';
/** 常规机制骰的精确有限分布；不访问战斗随机源。 */
const cache = new Map<string, Map<number, number>>();
export function diceDistribution(expression?: string, times = 1): Map<number, number> | undefined {
  if (!expression) return new Map([[0, 1]]);
  const key = expression + ':' + times;
  if (cache.has(key)) return cache.get(key)!;
  const parsed = parseDice(expression);
  const count = parsed.count * times, sides = parsed.sides, flat = parsed.flat;
  if (parsed.keepHigh !== undefined || parsed.keepLow !== undefined) {
    if (sides ** parsed.count > 65536) return undefined;
    const once = new Map<number, number>(), rolls: number[] = [], keep = parsed.keepHigh ?? parsed.keepLow!;
    const enumerate = () => {
      if (rolls.length === parsed.count) {
        const total = [...rolls].sort((a,b) => parsed.keepHigh !== undefined ? b-a : a-b).slice(0,keep).reduce((s,v)=>s+v,0);
        once.set(total, (once.get(total) ?? 0) + 1 / sides ** parsed.count); return;
      }
      for (let face = 1; face <= sides; face++) { rolls.push(face); enumerate(); rolls.pop(); }
    };
    enumerate();
    let result = new Map([[flat,1]]);
    for (let n=0;n<times;n++) {
      const next = new Map<number,number>();
      for (const [a,p] of result) for (const [b,q] of once) next.set(a+b,(next.get(a+b)??0)+p*q);
      result=next;
    }
    if (cache.size > 256) cache.clear(); cache.set(key,result); return result;
  }
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
