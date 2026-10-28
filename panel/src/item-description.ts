import { strongestWornBarrier } from '../../engine/src/worn-barrier.js';
import { displayNumber } from '../../engine/src/display-number.js';
import { progression, wornItemEffects, STACKING_MODEL, compileWornEffects, WORN_ANCHORED_MODEL } from '../../engine/src/index.js';
import { BONUS_NAMES } from '../../engine/src/enhancements.js';
import { wornItemBonuses, ITEM_MODEL_V2, itemSpecText, traitRegistry, standardConditionMap, isGradedTrait, traitLevelsV16, canonicalTraitId, sourceTraitLevel,
  type Ability, type Combatant, type EffectOp, type ItemPassive, type ItemValue } from '../../engine/src/index.js';
import { enhancementLabel, type Enhancements } from '../../engine/src/enhancements.js';
import { diceAvg } from '../../engine/src/data/weapons.js';
import { gridAbility } from '../../engine/src/small/skill-range.js';
import { playerTraitDescription, playerTraitLevelDescription } from './player-trait-description.js';

const ZONES: Record<string, string> = { fire: '火墙', poison: '毒雾', smoke: '烟幕', healing: '治疗区域', trap: '陷阱' };
const MOVES: Record<string, string> = { dash: '突进', blink: '闪现', withdraw: '后撤' };
type EffectStat = keyof typeof BONUS_NAMES;
export function wornEffectAmount(stat: EffectStat, value: number): string {
  const percent = stat === 'damage' || stat === 'health' || stat.endsWith('Damage');
  const unit = percent ? '%' : '';
  return (value > 0 ? '+' : '') + displayNumber(value * (percent ? 100 : 1)) + unit;
}
/** 所有文字出口读取冻结实效；旧配方点数只作配方展示。 */
export function itemEffectRows(value: ItemValue): { stat: EffectStat; name: string; actual: string; written: string; next?: string }[] {
  if (!value.passive) return [];
  const effects = wornItemEffects(value).values;
  const next = value.recipe.wornEffectModel === WORN_ANCHORED_MODEL && value.recipe.power < 10 ? compileWornEffects(value.passive.bonuses, value.recipe.power + 1).values : undefined;
  return [...new Set([...Object.keys(value.passive.bonuses ?? {}), ...Object.keys(effects)])].map(key => {
    const stat = key as EffectStat, amount = effects[stat] ?? 0, points = value.passive!.bonuses?.[stat];
    return { stat, name: BONUS_NAMES[stat], actual: wornEffectAmount(stat, amount), written: points === undefined ? '—' : (points > 0 ? '+' : '') + points,
      ...(next && (next[stat] ?? 0) !== amount ? { next: wornEffectAmount(stat, (next[stat] ?? 0) - amount) } : {}) };
  });
}
function effectText(e: EffectOp, a: Ability): string {
  switch (e.op) {
    case 'heal': return `治疗${e.amount !== undefined ? displayNumber(e.amount) : e.dice}生命`;
    case 'damage': return `伤害约${Math.round(diceAvg(e.baseDice) * (a.damageScale ?? 1))}${e.shape === 'burst' ? '（范围）' : ''}`;
    case 'condition': return `${standardConditionMap().get(e.conditionId)?.name ?? e.conditionId}${displayNumber(e.dur)}轮${e.magnitude !== undefined ? '（效力'+Math.round(e.magnitude*100)+'%）' : ''}${e.saveDC ? '，抵抗难度'+displayNumber(e.saveDC) : ''}`;
    case 'barrier': return `屏障${displayNumber(e.amount)}点，${displayNumber(e.dur)}轮`;
    case 'dispel': return e.polarity === 'negative' ? `清除${displayNumber(e.count)}项不利状态` : `驱散${displayNumber(e.count)}项增益`;
    case 'resource': return `精力${e.amount > 0 ? '+' : ''}${displayNumber(e.amount)}`;
    case 'morale': return `士气${e.amount > 0 ? '+' : ''}${displayNumber(e.amount)}`;
    case 'trait': return `${traitRegistry().get(e.traitId)?.name ?? e.traitId}${e.level ? 'L' + e.level : ''}，${displayNumber(e.dur)}轮`;
    case 'zone': return `${ZONES[e.kind] ?? '区域'}${displayNumber(e.dur)}轮${e.amount !== undefined ? '，每轮' + (e.kind === 'healing' ? '治疗' : '伤害') + displayNumber(e.amount) : ''}${e.effects?.length ? '，' + e.effects.filter(child => !(e.kind === 'healing' && e.amount !== undefined && child.op === 'heal')).map(child=>effectText(child,a)).join('、') : ''}`.replace(/，$/, '');
    case 'summon': return `召唤${displayNumber(e.count)}个单位`;
    case 'push': return (e.direction === 'towards' ? '拉拽' : '击退') + '1步，强度' + displayNumber(e.force);
    case 'move': return `${MOVES[e.mode]}${displayNumber(e.reach)}格`;
  }
}
/** 行动道具：怎么用、多远、效果。 */
export function itemAbilitySummary(a: Ability): string {
  return [a.usesPerBattle ? `每战${a.usesPerBattle}次` : '', a.itemQuick ? '自身或相邻友军，可用加速动作' : '占主行动',
    a.range && a.range.max > 1 ? `射程${displayNumber(gridAbility(a, 'arms-v2').range!.max)}格` : '', ...a.effects.map((e) => effectText(e, a)), a.delivery === 'magic' ? '魔法' : ''].filter(Boolean).join('，');
}
export function itemPassiveSummary(p: ItemPassive, model?: unknown, detailed = true): string {
  const traits = p.traits.map((t) => {
    const trait = traitRegistry().get(t.id), name = trait?.name ?? t.id;
    return isGradedTrait(t.id) ? `${name}L${t.level ?? 5}${detailed ? '（' + playerTraitLevelDescription(t.id, t.level ?? 5, model) + '）' : ''}` : trait && detailed ? `${name}（${playerTraitDescription(trait)}）` : name;
  });
  const values = wornItemEffects({ passive: p }).values;
  const actual = [...new Set([...Object.keys(p.bonuses ?? {}), ...Object.keys(values)])].map(k => BONUS_NAMES[k as EffectStat] + wornEffectAmount(k as EffectStat, values[k as EffectStat] ?? 0)
    + (k === 'speed' && p.actualEffects?.uncappedNegative ? '（先攻' + wornEffectAmount('speed', 2 * (values.speed ?? 0)) + '）' : '')).join('、');
  return [traits.join('；'), p.barrier ? `开战屏障${displayNumber(p.barrier.amount)}点（L${p.barrier.power}），每战一次` : '', actual].filter(Boolean).join('；');
}
/** 库存卡片与审批预览共用的一句话说明；形态已在卡片标题里。 */
export function itemValueSummary(value: ItemValue, name?: string): string {
  const r = value.recipe;
  const spec = itemSpecText(r), historical = value.passive?.bonuses && r.wornEffectModel !== WORN_ANCHORED_MODEL;
  return [name !== undefined ? '' : spec, value.ability ? itemAbilitySummary(value.ability) : '', value.passive ? itemPassiveSummary(value.passive, STACKING_MODEL, false) : '', historical ? '旧版数值' : ''].filter(Boolean).join(' · ');
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
  if (item.passive.barrier && strongestWornBarrier(unit)?.id !== itemId) covered.push('开战屏障');
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
    const mine = progression(unit) ? wornItemEffects(item).values[stat] ?? 0 : points;
    if (mine > 0 && gear.some((other, n) => n !== index && beats(progression(unit) ? wornItemEffects(other).values[stat] ?? 0 : actual(other)[stat] ?? 0, n, mine))) covered.push(progression(unit) ? BONUS_NAMES[stat] + wornEffectAmount(stat, mine) : enhancementLabel({ [stat]: written }));
  }
  return covered;
}
