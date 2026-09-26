import type { DamageChannel } from './types.js';
/** 有符号同级修正；倍率、连续穿透和离散格数分别换算。 */
export const BONUS_NAMES = {
  power: '强度', damage: '伤害', accuracy: '精度', penetration: '穿透',
  defense: '防御', protection: '防护', health: '生命', speed: '速度',
  range: '射程', healing: '治疗', duration: '持续', resource: '回能', morale: '士气',
  kineticDamage: '动能伤害', thermalDamage: '热能伤害', arcaneDamage: '奥术伤害',
  kineticPenetration: '动能穿透', thermalPenetration: '热能穿透', arcanePenetration: '奥术穿透',
  kineticProtection: '动能防护', thermalProtection: '热能防护', arcaneProtection: '奥术防护',
} as const;
export type BonusStat = keyof typeof BONUS_NAMES;
export type Enhancements = Partial<Record<BonusStat, number>>;
export type BonusKind = 'unit' | 'weapon' | 'armor' | 'shield' | 'consumable' | 'accessory' | 'skill';
const damageChannels: BonusStat[] = ['kineticDamage','thermalDamage','arcaneDamage'];
const penetrationChannels: BonusStat[] = ['kineticPenetration','thermalPenetration','arcanePenetration'];
const protectionChannels: BonusStat[] = ['kineticProtection','thermalProtection','arcaneProtection'];
export const ENHANCEMENT_STATS: Record<BonusKind, BonusStat[]> = {
  unit: ['power', 'damage', 'accuracy', 'defense', 'health', 'speed', 'morale', ...damageChannels],
  weapon: ['power', 'damage', 'accuracy', 'penetration', 'range', ...damageChannels, ...penetrationChannels],
  armor: ['power', 'defense', 'protection', ...protectionChannels], shield: ['power', 'defense', 'protection', ...protectionChannels],
  consumable: ['power', 'healing'],
  accessory: [],
  skill: ['power', 'damage', 'accuracy', 'penetration', 'range', 'healing', 'duration', 'resource', 'morale', ...damageChannels, ...penetrationChannels],
};
export function validateEnhancements(value: Enhancements | undefined, kind: BonusKind): void {
  if (value === undefined) return;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('强化配置损坏');
  for (const [key, points] of Object.entries(value)) {
    if (!ENHANCEMENT_STATS[kind].includes(key as BonusStat) || !Number.isInteger(points) || points < -10 || points > 10) throw Error(`${kind}不支持此强化方向或点数：${key}（须为-10至+10整数）`);
  }
}
export function parseEnhancementSuffix(text: string, kind: BonusKind): { text: string; bonuses?: Enhancements } {
  const match = text.trim().match(/^(.*?[lL]\s*\d{1,2})((?:[+-].*)?)$/);
  if (!match || !match[2]) return { text: text.trim() };
  const bonuses: Enhancements = {};
  const parts = [...match[2].matchAll(/([+-])(\d{1,2})([^\d+\-\s]*)/g)];
  if (parts.map(m=>m[0]).join('')!==match[2]) throw Error('强化使用L5+3伤害-2精度，每项-10至+10');
  for (const m of parts) {
    const label = m[3] || '强度';
    const key = Object.entries(BONUS_NAMES).find(([id, name]) => id === label || name === label)?.[0] as BonusStat | undefined;
    if (!key || bonuses[key] !== undefined) throw Error('强化方向未知或重复：' + label);
    bonuses[key] = Number(m[2]) * (m[1]==='-'?-1:1);
  }
  validateEnhancements(bonuses, kind);
  return { text: match[1]!, bonuses };
}
export const bonusPoints = (value: Enhancements | undefined, stat: BonusStat) => value?.[stat] ?? 0;
export function channelPoints(value: Enhancements | undefined, stat: BonusStat, channel?: DamageChannel): number {
  if (!channel || !['damage','penetration','protection'].includes(stat)) return 0;
  return bonusPoints(value, (channel + stat[0]!.toUpperCase() + stat.slice(1)) as BonusStat);
}
/** 原有两项正强化上限仍为2倍；新增通道不再叠出第三级倍率，负面最多降至一半。 */
export const bonusMultiplier = (value: Enhancements | undefined, stat: BonusStat, channel?: DamageChannel) => 1 + 0.05 * Math.max(-10,Math.min(20,bonusPoints(value, stat) + (stat === 'power' ? 0 : bonusPoints(value, 'power')) + channelPoints(value,stat,channel)));
/** 穿透/防护每点0.2档，通用与相应通道合并后最多正负2档。 */
export const bonusRating = (value: Enhancements | undefined, stat: 'penetration'|'protection', channel?: DamageChannel) => Math.max(-10,Math.min(10,bonusPoints(value,stat)+channelPoints(value,stat,channel)))/5;
export const bonusSteps = (value: Enhancements | undefined, stat: BonusStat, every = 3) => Math.sign(bonusPoints(value,stat))*Math.ceil(Math.abs(bonusPoints(value,stat))/every);
export function enhancementLabel(value: Enhancements | undefined): string {
  return Object.entries(value ?? {}).filter(([,points])=>points!==0).map(([key, points]) => `${points!>0?'+':''}${points}${key === 'power' ? '' : BONUS_NAMES[key as BonusStat]}`).join('');
}
export function validateChannelProtection(value: unknown): void {
  if (!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).some(k=>!['kinetic','thermal','arcane'].includes(k))
    || ['kinetic','thermal','arcane'].some(k=>typeof (value as Record<string,unknown>)[k]!=='number' || !Number.isFinite((value as Record<string,number>)[k]) || (value as Record<string,number>)[k]!<0)) throw Error('通道防护须为完整的非负有限数，可使用小数');
}
/** 训练不改变科技层级；在原有攻防差之外增强命中、规避和实际输出。 */
export const trainingEdge = (level: number) => Math.floor((Math.max(1, Math.min(10, level)) - 1) / 2);
export const trainingDamage = (level: number) => 1 + 0.12 * (Math.max(1, Math.min(10, level)) - 1);
