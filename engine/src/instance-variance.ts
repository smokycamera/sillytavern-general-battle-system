/** Frozen generation variation, separate from combat dice and deployment RNG. */
import { SeededRng } from './rng.js';
import { bonusMultiplier, bonusRating, BONUS_NAMES, type BonusStat, type Enhancements } from './enhancements.js';
import type { DamageChannel } from './types.js';

export const INSTANCE_VARIANCE_VERSION = 'enhancement-bands-v1' as const;
export const VARIANCE_STATS = ['damage', 'health', 'penetration', 'protection', 'power'] as const;
export type VarianceStat = typeof VARIANCE_STATS[number];
/** Integer rolls are persisted, not regenerated when inspecting or using an instance. */
export interface InstanceVariance {
  version: typeof INSTANCE_VARIANCE_VERSION;
  rolls: Partial<Record<VarianceStat, number>>;
}
export function validateInstanceVariance(value: unknown): asserts value is InstanceVariance | undefined {
  if (value === undefined) return;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('固定浮动记录损坏');
  const v = value as InstanceVariance;
  if (v.version !== INSTANCE_VARIANCE_VERSION || !v.rolls || typeof v.rolls !== 'object' || Array.isArray(v.rolls)
    || Object.entries(v.rolls).some(([key, roll]) => !VARIANCE_STATS.includes(key as VarianceStat) || !Number.isInteger(roll) || roll < -2 || roll > 2)) throw Error('固定浮动记录损坏或版本未知');
}
export function rollInstanceVariance(seed: string, stats: readonly VarianceStat[]): InstanceVariance {
  if (!seed) throw Error('固定浮动缺少随机记录号');
  return { version: INSTANCE_VARIANCE_VERSION, rolls: Object.fromEntries(stats.map(stat =>
    [stat, Math.floor(new SeededRng(JSON.stringify([INSTANCE_VARIANCE_VERSION, seed, stat])).next() * 5) - 2])) };
}
/** Five equiprobable offsets: -0.4, -0.2, 0, +0.2, +0.4 enhancement points.
 * Adjacent uncapped bands leave a 0.2-point gap. Capped endpoints stay exactly capped.
 * Rounding and other combat factors may tie/invert final outcomes, not these bands. */
export function instanceOffset(variance: InstanceVariance | undefined, stat: VarianceStat): number {
  return (variance?.rolls[stat] ?? 0) / 5;
}
const precise = (n: number) => Number(n.toPrecision(12));
export function instanceMultiplier(value: Enhancements | undefined, stat: VarianceStat, variance?: InstanceVariance, channel?: DamageChannel): number {
  const center = bonusMultiplier(value, stat, channel);
  if (!variance || center <= 0.5 || center >= 2) return center;
  return precise(center + 0.05 * instanceOffset(variance, stat));
}
export function instanceRating(value: Enhancements | undefined, stat: 'penetration' | 'protection', variance?: InstanceVariance, channel?: DamageChannel): number {
  const center = bonusRating(value, stat, channel);
  if (!variance || Math.abs(center) >= 2) return center;
  return precise(center + instanceOffset(variance, stat) / 5);
}
export function instanceVarianceLabel(variance?: InstanceVariance): string {
  if (!variance) return '';
  return '固定浮动：' + Object.keys(variance.rolls).map(key => {
    const stat = key as VarianceStat, offset = instanceOffset(variance, stat);
    return `${BONUS_NAMES[stat as BonusStat]}${offset > 0 ? '+' : ''}${offset}档`;
  }).join(' / ');
}
