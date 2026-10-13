/**
 * 五项专精的十级阶梯（V15）。L5 就是 V14 及以前的效果，省略等级时按 L5；V14 及更早的战斗不论记录多少级都按 L5。
 * 每一级比上一级多一项：L1–4 逐级减轻环境惩罚，L6–10 逐级获得环境优势。来源（自带、bless、技能、佩戴品）取最高一级，不叠加。
 *
 * | L | 林地 | 山地 | 夜战 | 平原 | 巷战 |
 * | 1 | 森林攻击−1免除 | 丘陵攻击−1免除 | 观测4格 | 先攻+1 | 防御+1 |
 * | 2 | 森林移动代价1.75 | 丘陵代价1.75、爬坡×0.75 | 夜间攻击−1 | 机动+1 | 近战攻击+1 |
 * | 3 | 1.5 | 1.5、×0.5 | 观测5格 | 先攻+2 | 防御+2 |
 * | 4 | 1.25 | 1.25、×0.25 | 夜间移动不减 | 冲锋攻击+1 | 2格内射击+1 |
 * | 5 | 森林代价1，会战行军不受限 | 全免，会战行军不受限 | 夜间攻击不减，观测6格 | 所有攻击+1 | 所有攻击+1 |
 * | 6 | 森林防御+1 | 居高防御额外+1 | 观测7格 | 防御+1 | 先攻+1 |
 * | 7 | 森林攻击+1 | 居高攻击+1 | 夜间攻击+1 | 先攻+3 | 防御+3 |
 * | 8 | 森林中视同潜伏 | 山地中视同潜伏 | 观测8格 | 冲锋攻击+2 | 近战攻击+2 |
 * | 9 | 森林防御+2 | 居高防御额外+2 | 夜间防御+1 | 机动+2 | 街巷建筑中视同潜伏 |
 * | 10 | 森林攻击+2 | 居高攻击+2 | 夜间攻击+2 | 所有攻击+2 | 所有攻击+2 |
 *
 * 移动减免按代价逐级递减而不是“每次移动前N格”，拆成多段移动也拿不到额外好处。会战观测阵位为小战格数×2/3向上取整。
 */
import type { Combatant } from './types.js';
import { activeTraitIds, traitSourceActive } from './trait-sources.js';
import { itemsV15 } from './item-model.js';
import { isGradedTrait } from './data/traits.js';

export const STANDARD_TRAIT_LEVEL = 5;

/** 单位当前的专精等级，没有该专精为 0。traits 可传入已算好的 activeTraitIds 以免重复计算。 */
export function traitLevel(unit: Combatant, id: string, traits: readonly string[] = activeTraitIds(unit)): number {
  if (!traits.includes(id)) return 0;
  if (unit.rulesVersion !== 'v2' || !itemsV15(unit)) return STANDARD_TRAIT_LEVEL;
  let level = 0;
  const take = (value: number | undefined) => { level = Math.max(level, value ?? STANDARD_TRAIT_LEVEL); };
  if (unit.traits.includes(id)) take(unit.traitLevels?.[id]);
  for (const source of unit.traitSources ?? []) if (source.traitIds.includes(id) && traitSourceActive(unit, source)) take(source.traitLevels?.[id]);
  for (const item of unit.gear ?? []) for (const grant of item.passive?.traits ?? []) if (grant.id === id) take(grant.level);
  for (const item of Object.values(unit.accessories ?? {})) if (item?.traitId === id) take(undefined);
  // 由身体或装备派生的同名特质（目前没有）按标准等级。
  return level || STANDARD_TRAIT_LEVEL;
}

// ---- 林地与山地：移动、攻击惩罚、会战行军 ----
/** 森林/丘陵格的移动代价：无专精或 L1 为 2，L2–4 为 1.75/1.5/1.25，L5 起为 1。 */
export const roughGroundCost = (level: number): number => level >= 5 ? 1 : level >= 2 ? 2 - 0.25 * (level - 1) : 2;
/** 爬坡代价倍率：L2–4 为 ×0.75/×0.5/×0.25，L5 起免除。 */
export const climbFactor = (level: number): number => level >= 5 ? 0 : level >= 2 ? 1 - 0.25 * (level - 1) : 1;
/** 站在森林/丘陵格不再攻击 −1：L1 起。 */
export const ignoresGroundPenalty = (level: number): boolean => level >= 1;
/** 会战林地/山地行军不受限：L5 起。 */
export const freeMarch = (level: number): boolean => level >= 5;
export const forestDefense = (level: number): number => level >= 9 ? 2 : level >= 6 ? 1 : 0;
export const forestAttack = (level: number): number => level >= 10 ? 2 : level >= 7 ? 1 : 0;
export const highGroundDefense = (level: number): number => level >= 9 ? 2 : level >= 6 ? 1 : 0;
export const highGroundAttack = (level: number): number => level >= 10 ? 2 : level >= 7 ? 1 : 0;
/** 林地、山地 L8 起站在对应地形中视同潜伏。 */
export const terrainStalk = (level: number): boolean => level >= 8;

// ---- 夜战 ----
/** 夜间攻击修正：无专精或 L1 为 −2，L2–4 为 −1，L5–6 为 0，L7–9 为 +1，L10 为 +2。 */
export const nightAttack = (level: number): number => level >= 10 ? 2 : level >= 7 ? 1 : level >= 5 ? 0 : level >= 2 ? -1 : -2;
/** 夜间移动 −1：L4 起免除。 */
export const nightMovePenalty = (level: number): number => level >= 4 ? 0 : 1;
export const nightDefense = (level: number): number => level >= 9 ? 1 : 0;
/** 夜间观测距离：无专精小战 3 格，L1、L3、L5、L6、L8 各 +1；会战为小战格数 × 2/3 向上取整。 */
export function nightSight(level: number, mode: 'small' | 'mass'): number {
  const cells = 3 + [1, 3, 5, 6, 8].filter((step) => level >= step).length;
  return mode === 'small' ? cells : Math.ceil(cells * 2 / 3);
}
/** 任何单位可能达到的最远夜间观测，用于提前剪枝。 */
export const MAX_NIGHT_SIGHT = { small: nightSight(10, 'small'), mass: nightSight(10, 'mass') } as const;

// ---- 平原 ----
export const plainsInitiative = (level: number): number => level >= 7 ? 3 : level >= 3 ? 2 : level >= 1 ? 1 : 0;
export const plainsMobility = (level: number): number => level >= 9 ? 2 : level >= 2 ? 1 : 0;
export const plainsAttack = (level: number): number => level >= 10 ? 2 : level >= 5 ? 1 : 0;
/** 冲锋（冲锋命令与冲锋、突进技能）时的攻击修正，已包含所有攻击修正。 */
export const plainsChargeAttack = (level: number): number => Math.max(plainsAttack(level), level >= 8 ? 2 : level >= 4 ? 1 : 0);
export const plainsDefense = (level: number): number => level >= 6 ? 1 : 0;

// ---- 巷战 ----
export const urbanDefense = (level: number): number => level >= 7 ? 3 : level >= 3 ? 2 : level >= 1 ? 1 : 0;
export const urbanAttack = (level: number): number => level >= 10 ? 2 : level >= 5 ? 1 : 0;
/** 近战攻击修正，已包含所有攻击修正。 */
export const urbanMeleeAttack = (level: number): number => Math.max(urbanAttack(level), level >= 8 ? 2 : level >= 2 ? 1 : 0);
/** 2 格内射击的攻击修正，已包含所有攻击修正。 */
export const urbanCloseShotAttack = (level: number): number => Math.max(urbanAttack(level), level >= 4 ? 1 : 0);
export const urbanInitiative = (level: number): number => level >= 6 ? 1 : 0;
export const urbanStalk = (level: number): boolean => level >= 9;

/** 面板与正文共用的单级说明（每级新增的一项）。 */
export const TRAIT_LADDER: Readonly<Record<string, readonly string[]>> = {
  'forest-lore': ['森林中攻击−1免除', '森林移动代价降为1.75', '森林移动代价降为1.5', '森林移动代价降为1.25', '森林移动只耗1点，会战林地行军不受限', '森林中防御+1', '森林中攻击+1', '在森林中视同潜伏', '森林中防御+2', '森林中攻击+2'],
  'mountain-born': ['丘陵攻击−1免除', '丘陵移动代价1.75、爬坡代价×0.75', '丘陵移动代价1.5、爬坡代价×0.5', '丘陵移动代价1.25、爬坡代价×0.25', '山地丘陵移动与爬坡不额外耗点，会战山地行军不受限', '居高时防御额外+1', '居高攻击+1', '在山地丘陵中视同潜伏', '居高时防御额外+2', '居高攻击+2'],
  'night-fighter': ['夜间观测4格', '夜间攻击−2减为−1', '夜间观测5格', '夜间移动不再−1', '夜间攻击惩罚免除，观测6格', '夜间观测7格', '夜间攻击+1', '夜间观测8格', '夜间防御+1', '夜间攻击+2'],
  'plains-runner': ['平原先攻+1', '平原机动+1', '平原先攻+2', '平原冲锋攻击+1', '平原所有攻击+1', '平原防御+1', '平原先攻+3', '平原冲锋攻击+2', '平原机动+2', '平原所有攻击+2'],
  'urban-fighter': ['巷战防御+1', '巷战近战攻击+1', '巷战防御+2', '巷战2格内射击攻击+1', '巷战所有攻击+1', '巷战先攻+1', '巷战防御+3', '巷战近战攻击+2', '在街道与建筑中视同潜伏', '巷战所有攻击+2'],
};
const signed = (value: number) => (value >= 0 ? '+' : '−') + Math.abs(value);
/** 某一级累计生效的效果，按实际数值合并成一句（面板、道具说明与说明文件共用）。 */
export function traitLadderSummary(id: string, level: number): string {
  const L = Math.max(1, Math.min(10, Math.round(level))), parts: string[] = [];
  const add = (when: boolean, text: string) => { if (when) parts.push(text); };
  if (id === 'forest-lore') {
    add(true, '森林中攻击不受−1'); add(roughGroundCost(L) < 2, roughGroundCost(L) === 1 ? '森林每格只耗1点' : `森林每格耗${roughGroundCost(L)}点`);
    add(freeMarch(L), '会战林地行军不受限'); add(forestDefense(L) > 0, `森林中防御+${forestDefense(L)}`); add(forestAttack(L) > 0, `森林中攻击+${forestAttack(L)}`); add(terrainStalk(L), '在森林中视同潜伏');
  } else if (id === 'mountain-born') {
    add(true, '丘陵攻击不受−1');
    add(roughGroundCost(L) < 2, roughGroundCost(L) === 1 ? '丘陵与爬坡不额外耗点' : `丘陵每格耗${roughGroundCost(L)}点、爬坡代价×${climbFactor(L)}`);
    add(freeMarch(L), '会战山地行军不受限'); add(highGroundDefense(L) > 0, `居高时防御额外+${highGroundDefense(L)}`); add(highGroundAttack(L) > 0, `居高攻击+${highGroundAttack(L)}`); add(terrainStalk(L), '在山地丘陵中视同潜伏');
  } else if (id === 'night-fighter') {
    add(true, nightAttack(L) === 0 ? '夜间攻击不受减值' : `夜间攻击${signed(nightAttack(L))}`); add(true, nightMovePenalty(L) ? '夜间移动−1' : '夜间移动不减');
    add(true, `夜间观测${nightSight(L, 'small')}格（会战${nightSight(L, 'mass')}阵位）`); add(nightDefense(L) > 0, `夜间防御+${nightDefense(L)}`);
  } else if (id === 'plains-runner') {
    add(true, `平原先攻+${plainsInitiative(L)}`); add(plainsMobility(L) > 0, `机动+${plainsMobility(L)}`); add(plainsAttack(L) > 0, `所有攻击+${plainsAttack(L)}`);
    add(plainsChargeAttack(L) > plainsAttack(L), `冲锋攻击+${plainsChargeAttack(L)}`); add(plainsDefense(L) > 0, `防御+${plainsDefense(L)}`);
  } else if (id === 'urban-fighter') {
    add(true, `巷战防御+${urbanDefense(L)}`); add(urbanAttack(L) > 0, `所有攻击+${urbanAttack(L)}`); add(urbanMeleeAttack(L) > urbanAttack(L), `近战攻击+${urbanMeleeAttack(L)}`);
    add(urbanCloseShotAttack(L) > urbanAttack(L), `2格内射击攻击+${urbanCloseShotAttack(L)}`); add(urbanInitiative(L) > 0, `先攻+${urbanInitiative(L)}`); add(urbanStalk(L), '在街道与建筑中视同潜伏');
  } else return '';
  return 'L' + L + '：' + parts.join('，');
}
/** 面板显示：V15 下专精带上当前等级（林地专精L8），其余特质原样。 */
export function traitDisplayName(unit: Combatant, id: string, name: string, traits?: readonly string[]): string {
  return isGradedTrait(id) && unit.rulesVersion === 'v2' && itemsV15(unit) ? name + 'L' + traitLevel(unit, id, traits) : name;
}

/** 站在对应地形中视同潜伏：林地 L8 在森林，山地 L8 在丘陵与山地，巷战 L9 在街道、建筑与城镇。旧规则从不生效。 */
export function terrainStalks(unit: Combatant, terrain: string | undefined, traits: readonly string[] = activeTraitIds(unit)): boolean {
  if (!terrain || unit.rulesVersion !== 'v2' || !itemsV15(unit)) return false;
  if (terrain === 'forest') return terrainStalk(traitLevel(unit, 'forest-lore', traits));
  if (terrain === 'hill' || terrain === 'mountain') return terrainStalk(traitLevel(unit, 'mountain-born', traits));
  if (terrain === 'street' || terrain === 'building' || terrain === 'urban') return urbanStalk(traitLevel(unit, 'urban-fighter', traits));
  return false;
}
