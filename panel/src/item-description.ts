import { displayNumber } from '../../engine/src/display-number.js';
import { progression, wornItemEffects, STACKING_MODEL } from '../../engine/src/index.js';
import { BONUS_NAMES } from '../../engine/src/enhancements.js';
import { ITEM_FORM_NAMES, wornItemBonuses, wornLevelScale, ITEM_MODEL_V2, itemSpecText, traitRegistry, standardConditionMap, isGradedTrait, traitLadderSummary, traitLevelsV16, canonicalTraitId, sourceTraitLevel,
  type Ability, type Combatant, type EffectOp, type ItemPassive, type ItemValue } from '../../engine/src/index.js';
import { enhancementLabel, type Enhancements } from '../../engine/src/enhancements.js';
import { diceAvg } from '../../engine/src/data/weapons.js';
import { gridAbility } from '../../engine/src/small/skill-range.js';
import { historicalRecoveryItem } from '../../engine/src/items.js';

const ZONES: Record<string, string> = { fire: '火墙', poison: '毒雾', smoke: '烟幕', healing: '治疗区域', trap: '陷阱' };
const MOVES: Record<string, string> = { dash: '突进', blink: '闪现', withdraw: '后撤' };
function effectText(e: EffectOp, a: Ability): string {
  switch (e.op) {
    case 'heal': return `基础治疗预算${e.amount !== undefined ? Number(e.amount.toFixed(2)) : e.dice}生命，受伤口及可救伤兵限制`;
    case 'damage': return `伤害约${Math.round(diceAvg(e.baseDice) * (a.damageScale ?? 1))}${e.shape === 'burst' ? '（范围）' : ''}`;
    case 'condition': return `${standardConditionMap().get(e.conditionId)?.name ?? e.conditionId}${displayNumber(e.dur)}轮${e.magnitude !== undefined ? '（效力'+Math.round(e.magnitude*100)+'%）' : ''}${e.saveDC ? '，DC'+displayNumber(e.saveDC) : ''}`;
    case 'barrier': return `屏障${displayNumber(e.amount)}点，${displayNumber(e.dur)}轮`;
    case 'dispel': return e.polarity === 'negative' ? `清除${displayNumber(e.count)}项不利状态` : `驱散${displayNumber(e.count)}项增益`;
    case 'resource': return `精力${e.amount > 0 ? '+' : ''}${displayNumber(e.amount)}`;
    case 'morale': return `士气${e.amount > 0 ? '+' : ''}${displayNumber(e.amount)}`;
    case 'trait': return `${traitRegistry().get(e.traitId)?.name ?? e.traitId}${e.level ? 'L' + e.level : ''}，${displayNumber(e.dur)}轮`;
    case 'zone': return `${ZONES[e.kind] ?? '区域'}${displayNumber(e.dur)}轮${e.amount !== undefined ? '，每周期预算' + displayNumber(e.amount) : ''}${e.effects?.length ? '，' + e.effects.map(child=>effectText(child,a)).join('、') : ''}`;
    case 'summon': return '召唤';
    case 'push': return (e.direction === 'towards' ? '拉拽' : '击退') + '，force=' + displayNumber(e.force) + '，位移1步';
    case 'move': return `${MOVES[e.mode]}${displayNumber(e.reach)}格`;
  }
}
/** 行动道具：怎么用、多远、效果。 */
export function itemAbilitySummary(a: Ability): string {
  return [a.itemQuick ? '自身或相邻友军，可用加速动作' : a.usesPerBattle ? `每战${a.usesPerBattle}次，占主行动` : '占主行动',
    a.range && a.range.max > 1 ? `射程${displayNumber(gridAbility(a, 'arms-v2').range!.max)}格` : '', ...a.effects.map((e) => effectText(e, a)), a.delivery === 'magic' ? '魔法' : ''].filter(Boolean).join('，');
}
export function itemPassiveSummary(p: ItemPassive, model?: unknown): string {
  const traits = p.traits.map((t) => {
    const name = traitRegistry().get(t.id)?.name ?? t.id;
    return isGradedTrait(t.id) ? `${name}（${traitLadderSummary(t.id, t.level ?? 5, model)}）` : name;
  });
  const actual = p.actualEffects ? Object.entries(p.actualEffects.values).filter(([,v]) => v).map(([k,v]) => {
    const percent = k === 'damage' || k.endsWith('Damage');
    const amount = Number(((v ?? 0) * (percent ? 100 : 1)).toFixed(2));
    return BONUS_NAMES[k as keyof typeof BONUS_NAMES] + (amount >= 0 ? '+' : '') + amount + (percent ? '%' : '');
  }).join('、') : '';
  return ['装备后获得', traits.join('、'), actual ? '实际效果：' + actual + '（同方向正负分别取强；通用与单通道合并有上限）' : p.bonuses ? '单位修正' + enhancementLabel(p.bonuses) + '（同方向只取最高一件）' : ''].filter(Boolean).join(' ');
}
/** 库存卡片与审批预览共用的一句话说明；形态已在卡片标题里。 */
export function itemValueSummary(value: ItemValue): string {
  const r = value.recipe;
  return [ITEM_FORM_NAMES[r.form] + ' · ' + itemSpecText(r), historicalRecoveryItem(value) ? '历史规则数值（可在库存显式升级）' : '', value.ability ? itemAbilitySummary(value.ability) : '', value.passive ? itemPassiveSummary(value.passive, STACKING_MODEL) + '；特质组合以本场战斗规则为准' : ''].filter(Boolean).join(' · ');
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
    const mine = progression(unit) && stat !== 'speed' ? wornItemEffects(item).values[stat] ?? 0 : points;
    if (gear.some((other, n) => n !== index && beats(progression(unit) && stat !== 'speed' ? wornItemEffects(other).values[stat] ?? 0 : actual(other)[stat] ?? 0, n, mine))) covered.push(enhancementLabel({ [stat]: written }));
  }
  return covered;
}
