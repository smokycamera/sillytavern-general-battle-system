import { displayNumber } from './display-number.js';
/** Frozen generation variation, separate from combat dice and deployment RNG. */
import { SeededRng } from './rng.js';
import { bonusMultiplier, bonusRating, BONUS_NAMES, type BonusStat, type Enhancements } from './enhancements.js';
import type { DamageChannel } from './types.js';

export const INSTANCE_VARIANCE_VERSION = 'normal-v1' as const;
export const VARIANCE_STATS = ['damage', 'health', 'penetration', 'protection', 'power'] as const;
export type VarianceStat = typeof VARIANCE_STATS[number];
/** Integer rolls are persisted, not regenerated when inspecting or using an instance. */
export interface InstanceVariance {
  version: typeof INSTANCE_VARIANCE_VERSION | 'enhancement-bands-v1';
  rolls: Partial<Record<VarianceStat, number>>;
}
export function validateInstanceVariance(value: unknown): asserts value is InstanceVariance | undefined {
  if (value === undefined) return;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('固定浮动记录损坏');
  const v = value as InstanceVariance;
  if (!['normal-v1', 'enhancement-bands-v1'].includes(v.version) || !v.rolls || typeof v.rolls !== 'object' || Array.isArray(v.rolls)
    || Object.entries(v.rolls).some(([key, roll]) => !VARIANCE_STATS.includes(key as VarianceStat) || !Number.isInteger(roll) || Math.abs(roll) > (v.version === 'normal-v1' ? 300 : 2))) throw Error('固定浮动记录损坏或版本未知');
}
export function rollInstanceVariance(seed: string, stats: readonly VarianceStat[], version: InstanceVariance['version'] = INSTANCE_VARIANCE_VERSION): InstanceVariance {
  if (!seed) throw Error('固定浮动缺少随机记录号');
  return { version, rolls: Object.fromEntries(stats.map(stat => {
    const rng = new SeededRng(JSON.stringify([version, seed, stat]));
    if (version === 'enhancement-bands-v1') return [stat, Math.floor(rng.next() * 5) - 2];
    const z = Math.sqrt(-2 * Math.log(1 - rng.next())) * Math.cos(2 * Math.PI * rng.next());
    return [stat, Math.round(Math.max(-3, Math.min(3, z)) * 100)];
  })) };
}
/** Five equiprobable offsets: -0.4, -0.2, 0, +0.2, +0.4 enhancement points.
 * Adjacent uncapped bands leave a 0.2-point gap. Capped endpoints stay exactly capped.
 * Rounding and other combat factors may tie/invert final outcomes, not these bands. */
export function instanceOffset(variance: InstanceVariance | undefined, stat: VarianceStat): number {
  return variance?.version === 'normal-v1' ? (variance.rolls[stat] ?? 0) * .003 : (variance?.rolls[stat] ?? 0) / 5;
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
  if (variance.version === 'normal-v1') return '品相：' + instanceQuality(variance) + '（' + Object.keys(variance.rolls).map(key => {
    const stat = key as VarianceStat, offset = instanceOffset(variance, stat), value = ['penetration', 'protection'].includes(stat) ? offset / 5 : offset * 5;
    return `${BONUS_NAMES[stat as BonusStat]}${value >= 0 ? '+' : ''}${Number(value.toFixed(2))}${['penetration', 'protection'].includes(stat) ? '' : '%'}`;
  }).join('，') + '）';
  return '固定浮动：' + Object.keys(variance.rolls).map(key => {
    const stat = key as VarianceStat, offset = instanceOffset(variance, stat);
    return `${BONUS_NAMES[stat as BonusStat]}${offset > 0 ? '+' : ''}${displayNumber(offset)}档`;
  }).join(' / ');
}

export function instanceQuality(variance?: InstanceVariance): string {
  if (!variance || variance.version !== 'normal-v1') return '普通';
  const rolls = Object.values(variance.rolls), mean = rolls.reduce((sum, roll) => sum + roll, 0) / rolls.length / 100;
  return mean >= 1.5 ? '精品' : mean >= .75 ? '优良' : mean <= -1.5 ? '残次' : mean <= -.75 ? '劣质' : '普通';
}
