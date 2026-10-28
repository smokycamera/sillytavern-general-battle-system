import { diceDistribution, v2DamageAmount } from './probability.js';

interface SequenceMoments { mean: number; second: number; positive: number; max: number }
const cache = new Map<string, SequenceMoments>();
/** Exact independent packets for one unshielded individual. Clip their SUM, never each expected value. */
export function exactSequenceMoments(base: string | undefined, ap: string | undefined, multiplier: number, hit: number, critical: number, criticalTimes: number, count: number, hp: number, criticalScale = 1): SequenceMoments | undefined {
  if (!Number.isSafeInteger(hp) || hp < 1 || hp > 4096 || !Number.isSafeInteger(count) || count < 2 || count > 3) return undefined;
  const key = JSON.stringify([base, ap, multiplier, hit, critical, criticalTimes, count, hp, criticalScale]);
  const prior = cache.get(key); if (prior) return prior;
  const packet = new Map<number, number>([[0, Math.max(0, 1 - hit)]]);
  for (const [times, chance, scale] of [[1, Math.max(0, hit - critical), 1], [criticalTimes, critical, criticalScale]] as const) {
    if (!chance) continue;
    const bases = diceDistribution(base, times), aps = diceDistribution(ap, times);
    if (!bases || !aps || bases.size * aps.size > 65536) return undefined;
    for (const [b, bp] of bases) for (const [a, apb] of aps) {
      const raw = v2DamageAmount(b, a, 1, multiplier * scale), low = Math.floor(raw), fraction = raw - low;
      for (const [amount, probability] of [[low, 1 - fraction], [low + 1, fraction]]) {
        if (!probability) continue;
        const loss = Math.min(hp, amount!);
        packet.set(loss, (packet.get(loss) ?? 0) + chance * bp * apb * probability!);
      }
    }
  }
  let totals = new Map<number, number>([[0, 1]]);
  for (let shot = 0; shot < count; shot++) {
    const next = new Map<number, number>();
    for (const [before, p] of totals) {
      if (before === hp) { next.set(hp, (next.get(hp) ?? 0) + p); continue; }
      for (const [loss, q] of packet) {
        const total = Math.min(hp, before + loss);
        next.set(total, (next.get(total) ?? 0) + p * q);
      }
    }
    totals = next;
  }
  const result = { mean: 0, second: 0, positive: 0, max: 0 };
  for (const [loss, probability] of totals) {
    result.mean += loss * probability; result.second += loss * loss * probability;
    if (loss > 0) { result.positive += probability; if (probability > 0) result.max = Math.max(result.max, loss); }
  }
  result.mean = Math.max(0, Math.min(hp, result.mean));
  result.positive = Math.max(0, Math.min(1, result.positive));
  if (cache.size >= 512) cache.delete(cache.keys().next().value!);
  cache.set(key, result); return result;
}
