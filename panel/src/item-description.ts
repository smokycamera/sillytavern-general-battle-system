import { itemSpecText, traitRegistry, standardConditionMap, isGradedTrait, traitLevelsV16, canonicalTraitId, sourceTraitLevel, wornItemBonuses, wornLevelScale, ITEM_MODEL_V2,
  type Ability, type Combatant, type EffectOp, type ItemPassive, type ItemValue } from '../../engine/src/index.js';
import { enhancementLabel, type Enhancements } from '../../engine/src/enhancements.js';
import { diceAvg } from '../../engine/src/data/weapons.js';
import { gridAbility } from '../../engine/src/small/skill-range.js';

const ZONES: Record<string, string> = { fire: '火墙', poison: '毒雾', smoke: '烟幕', healing: '治疗区域', trap: '陷阱' };
const MOVES: Record<string, string> = { dash: '突进', blink: '闪现', withdraw: '后撤' };
function effectText(e: EffectOp, a: Ability): string {
  switch (e.op) {
    case 'heal': return `恢复${e.amount !== undefined ? Math.round(e.amount) : e.dice}生命`;
    case 'damage': return `伤害约${Math.round(diceAvg(e.baseDice) * (a.damageScale ?? 1))}${e.shape === 'burst' ? '（范围）' : ''}`;
    case 'condition': return `${standardConditionMap().get(e.conditionId)?.name ?? e.conditionId}${e.dur}轮`;
    case 'barrier': return `屏障${e.amount}点，${e.dur}轮`;
    case 'dispel': return e.polarity === 'negative' ? `清除${e.count}项不利状态` : `驱散${e.count}项增益`;
    case 'resource': return `精力${e.amount > 0 ? '+' : ''}${e.amount}`;
    case 'morale': return `士气${e.amount > 0 ? '+' : ''}${e.amount}`;
    case 'trait': return `${traitRegistry().get(e.traitId)?.name ?? e.traitId}${e.dur}轮`;
    case 'zone': return `${ZONES[e.kind] ?? '区域'}${e.dur}轮`;
    case 'summon': return '召唤';
    case 'push': return e.direction === 'towards' ? '拉拽' : '击退';
    case 'move': return `${MOVES[e.mode]}${e.reach}格`;
  }
}
/** 行动道具：怎么用、多远、效果。 */
export function itemAbilitySummary(a: Ability): string {
  return [a.itemQuick ? '自身或相邻友军，可用加速动作' : a.usesPerBattle ? `每战${a.usesPerBattle}次，占主行动` : '占主行动',
    a.range && a.range.max > 1 ? `射程${gridAbility(a, 'arms-v2').range!.max}格` : '', ...a.effects.map((e) => effectText(e, a)), a.delivery === 'magic' ? '魔法' : ''].filter(Boolean).join('，');
}
/** 佩戴修正按道具 L 折算后的实际数值（V20）；L5 与照写的一样，不另写。特质已经写在规格里。 */
export function itemPassiveSummary(p: ItemPassive, power?: number): string {
  const scale = power === undefined ? 1 : wornLevelScale(power);
  if (!p.bonuses || scale === 1) return '';
  return '实际' + enhancementLabel(Object.fromEntries(Object.entries(p.bonuses).map(([stat, points]) => [stat, Math.round((points ?? 0) * scale * 100) / 100])) as Enhancements);
}
/** 库存卡片与审批预览共用的一句话说明；形态已在卡片标题里。 */
export function itemValueSummary(value: ItemValue): string {
  const r = value.recipe;
  return [itemSpecText(r), value.ability ? itemAbilitySummary(value.ability) : '', value.passive ? itemPassiveSummary(value.passive, r.power) : ''].filter(Boolean).join(' · ');
}

/**
 * 同一单位已佩戴的道具里被更高的一件覆盖的效果：同方向修正只取最高的一件，同一特质只算一次、专精取最高一级；
 * 打平时先装上的那件生效。单位自带的特质也算作已覆盖。
 */
export function overshadowedGear(unit: Pick<Combatant, 'gear' | 'traits' | 'traitLevels'> & Partial<Pick<Combatant, 'rulesVersion' | 'traitLevelModel'>>, itemId: string): string[] {
  const gear = unit.gear ?? [], index = gear.findIndex((g) => g.id === itemId), item = gear[index];
  if (!item?.passive) return [];
  const beats = (other: number, otherIndex: number, mine: number) => other > mine || other === mine && otherIndex < index;
  const covered: string[] = [];
  const canonical = (id: string) => traitLevelsV16(unit) ? canonicalTraitId(id) : id;
  const grade = (id: string, level?: number) => traitLevelsV16(unit) ? sourceTraitLevel(id, level) : level ?? 5;
  for (const grant of item.passive.traits) {
    const id = canonical(grant.id), level = grade(grant.id, grant.level), name = traitRegistry().get(id)?.name ?? id;
    const own = unit.traits.some(raw => canonical(raw) === id && (!isGradedTrait(id) || grade(raw, unit.traitLevels?.[raw]) >= level));
    const better = gear.some((other, n) => n !== index && other.passive?.traits.some((t) => canonical(t.id) === id && beats(grade(t.id, t.level), n, level)));
    if (own || better) covered.push(isGradedTrait(id) ? name + 'L' + level : name);
  }
  // 修正按新战斗的规则（V20 按 L 折算）比较，与道具说明里的折算值一致；库存页看的单位快照可能还带着旧规则标记。
  const actual = (g: typeof item) => wornItemBonuses(g, { itemModel: ITEM_MODEL_V2 }) ?? {};
  for (const [stat, written] of Object.entries(item.passive.bonuses ?? {}) as [keyof NonNullable<ItemPassive['bonuses']>, number][]) {
    const points = actual(item)[stat] ?? 0;
    if (points <= 0) continue;
    if (gear.some((other, n) => n !== index && beats(actual(other)[stat] ?? 0, n, points))) covered.push(enhancementLabel({ [stat]: written }));
  }
  return covered;
}
