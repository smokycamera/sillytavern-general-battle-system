/** 同级强化点：倍率、d20与格数使用各自曲线，不能把+10直接当成+10命中。 */
export const BONUS_NAMES = {
  power: '强度', damage: '伤害', accuracy: '精度', penetration: '穿透',
  defense: '防御', protection: '防护', health: '生命', speed: '速度',
  range: '射程', healing: '治疗', duration: '持续', resource: '回能', morale: '士气',
} as const;
export type BonusStat = keyof typeof BONUS_NAMES;
export type Enhancements = Partial<Record<BonusStat, number>>;
export type BonusKind = 'unit' | 'weapon' | 'armor' | 'shield' | 'consumable' | 'skill';
const allowed: Record<BonusKind, BonusStat[]> = {
  unit: ['power', 'damage', 'accuracy', 'defense', 'health', 'speed', 'morale'],
  weapon: ['power', 'damage', 'accuracy', 'penetration', 'range'],
  armor: ['power', 'defense', 'protection'], shield: ['power', 'defense', 'protection'],
  consumable: ['power', 'healing'],
  skill: ['power', 'damage', 'accuracy', 'penetration', 'range', 'healing', 'duration', 'resource', 'morale'],
};
export function validateEnhancements(value: Enhancements | undefined, kind: BonusKind): void {
  if (value === undefined) return;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('强化配置损坏');
  for (const [key, points] of Object.entries(value)) {
    if (!allowed[kind].includes(key as BonusStat) || !Number.isInteger(points) || points < 1 || points > 10) throw Error(`${kind}不支持此强化方向或点数：${key}`);
  }
}
export function parseEnhancementSuffix(text: string, kind: BonusKind): { text: string; bonuses?: Enhancements } {
  const match = text.trim().match(/^(.*?[lL]\s*\d{1,2})((?:\+.*)?)$/);
  if (!match || !match[2]) return { text: text.trim() };
  const bonuses: Enhancements = {};
  for (const part of match[2].split('+').slice(1)) {
    const m = part.match(/^(\d{1,2})([^\d+\s]*)$/);
    if (!m) throw Error('强化使用L1+1、L1+10或L5+3伤害+2精度');
    const label = m[2] || '强度';
    const key = Object.entries(BONUS_NAMES).find(([id, name]) => id === label || name === label)?.[0] as BonusStat | undefined;
    if (!key || bonuses[key] !== undefined) throw Error('强化方向未知或重复：' + label);
    bonuses[key] = Number(m[1]);
  }
  validateEnhancements(bonuses, kind);
  return { text: match[1]!, bonuses };
}
export const bonusPoints = (value: Enhancements | undefined, stat: BonusStat) => value?.[stat] ?? 0;
export const bonusMultiplier = (value: Enhancements | undefined, stat: BonusStat) => 1 + 0.05 * (bonusPoints(value, stat) + (stat === 'power' ? 0 : bonusPoints(value, 'power')));
export const bonusSteps = (value: Enhancements | undefined, stat: BonusStat, every = 3) => Math.ceil(bonusPoints(value, stat) / every);
export function enhancementLabel(value: Enhancements | undefined): string {
  return Object.entries(value ?? {}).map(([key, points]) => `+${points}${key === 'power' ? '' : BONUS_NAMES[key as BonusStat]}`).join('');
}
/** 训练不改变科技层级；在原有攻防差之外增强命中、规避和实际输出。 */
export const trainingEdge = (level: number) => Math.floor((Math.max(1, Math.min(10, level)) - 1) / 2);
export const trainingDamage = (level: number) => 1 + 0.12 * (Math.max(1, Math.min(10, level)) - 1);
