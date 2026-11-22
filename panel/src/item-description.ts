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
import { ui, uiLanguage } from './ui-language.js';
import { skillMechanismName, skillMechanismFromId } from '../../engine/src/data/skill-mechanisms.js';

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
    case 'heal': return ui('治疗{amount}生命', { amount: e.amount !== undefined ? displayNumber(e.amount) : e.dice ?? '0' });
    case 'damage': return ui(e.shape === 'burst' ? '伤害约{amount}（范围）' : '伤害约{amount}', { amount: Math.round(diceAvg(e.baseDice) * (a.damageScale ?? 1)) });
    case 'condition': return ui('{effect}{rounds}轮', { effect: ui(standardConditionMap().get(e.conditionId)?.name ?? e.conditionId), rounds: displayNumber(e.dur) })
      + (e.magnitude !== undefined ? ui('（效力{value}%）', { value: Math.round(e.magnitude * 100) }) : '')
      + (e.saveDC ? ui('，抵抗难度{value}', { value: displayNumber(e.saveDC) }) : '');
    case 'barrier': return ui('屏障{amount}点，{rounds}轮', { amount: displayNumber(e.amount), rounds: displayNumber(e.dur) });
    case 'dispel': return ui(e.polarity === 'negative' ? '清除{count}项不利状态' : '驱散{count}项增益', { count: displayNumber(e.count) });
    case 'resource': return ui('精力{value}', { value: (e.amount > 0 ? '+' : '') + displayNumber(e.amount) });
    case 'morale': return ui('士气{value}', { value: (e.amount > 0 ? '+' : '') + displayNumber(e.amount) });
    case 'trait': return ui('{effect}，{rounds}轮', { effect: ui(traitRegistry().get(e.traitId)?.name ?? e.traitId) + (e.level ? 'L' + e.level : ''), rounds: displayNumber(e.dur) });
    case 'zone': return [
      ui('{effect}{rounds}轮', { effect: ui(ZONES[e.kind] ?? '区域'), rounds: displayNumber(e.dur) }),
      e.amount === undefined ? '' : ui(e.kind === 'healing' ? '每轮治疗{amount}' : '每轮伤害{amount}', { amount: displayNumber(e.amount) }),
      e.effects?.filter(child => !(e.kind === 'healing' && e.amount !== undefined && child.op === 'heal')).map(child => effectText(child, a)).join(ui('、')),
    ].filter(Boolean).join(ui('，'));
    case 'summon': return ui('召唤{count}个单位', { count: displayNumber(e.count) });
    case 'push': return ui(e.direction === 'towards' ? '拉拽1步，强度{force}' : '击退1步，强度{force}', { force: displayNumber(e.force) });
    case 'move': return ui('{move}{range}格', { move: ui(MOVES[e.mode] ?? e.mode), range: displayNumber(e.reach) });
  }
}
/** 行动道具：怎么用、多远、效果。 */
export function itemAbilitySummary(a: Ability): string {
  return [a.usesPerBattle ? ui('每战{value}次', { value: a.usesPerBattle }) : '', ui(a.itemQuick ? '自身或相邻友军' : '占主行动'),
    a.range && a.range.max > 1 ? ui('射程{range}格', { range: displayNumber(gridAbility(a, 'arms-v2').range!.max) }) : '', ...a.effects.map((e) => effectText(e, a)), a.delivery === 'magic' ? ui('魔法') : ''].filter(Boolean).join(ui('，'));
}

export function abilityDescription(a: Ability): string {
  const description = (a.desc ?? '').replace('，可用加速动作', '');
  if (uiLanguage() === 'zh-CN') return description;
  if (a.itemSourceId) return itemAbilitySummary(a);
  const mechanism = a.recipe ?? skillMechanismFromId(a.definitionId ?? a.id);
  const separator = description.indexOf('；强度与装备/目标条件共同决定结果，');
  return mechanism && separator >= 0
    ? skillMechanismName(mechanism, ui) + ui(description.slice(separator))
    : ui(description);
}
export function itemPassiveSummary(p: ItemPassive, model?: unknown, detailed = true): string {
  const traits = p.traits.map((t) => {
    const trait = traitRegistry().get(t.id), name = ui(trait?.name ?? t.id);
    return isGradedTrait(t.id) ? `${name}L${t.level ?? 5}${detailed ? '（' + playerTraitLevelDescription(t.id, t.level ?? 5, model) + '）' : ''}` : trait && detailed ? `${name}（${playerTraitDescription(trait)}）` : name;
  });
  const values = wornItemEffects({ passive: p }).values;
  const actual = [...new Set([...Object.keys(p.bonuses ?? {}), ...Object.keys(values)])].map(k => ui(BONUS_NAMES[k as EffectStat]) + wornEffectAmount(k as EffectStat, values[k as EffectStat] ?? 0)
    + (k === 'speed' && p.actualEffects?.uncappedNegative ? ui('（先攻{value}）', { value: wornEffectAmount('speed', 2 * (values.speed ?? 0)) }) : '')).join(ui('、'));
  return [traits.join(ui('；')), p.barrier ? ui('开战屏障{amount}点（L{power}），每战一次', { amount: displayNumber(p.barrier.amount), power: p.barrier.power }) : '', actual].filter(Boolean).join(ui('；'));
}
/** 库存卡片与审批预览共用的一句话说明；形态已在卡片标题里。 */
export function itemValueSummary(value: ItemValue, name?: string): string {
  const r = value.recipe;
  const spec = itemSpecText(r), historical = value.passive?.bonuses && r.wornEffectModel !== WORN_ANCHORED_MODEL;
  return [name !== undefined ? '' : spec, value.ability ? itemAbilitySummary(value.ability) : '', value.passive ? itemPassiveSummary(value.passive, STACKING_MODEL, false) : '', historical ? ui('旧版数值') : ''].filter(Boolean).join(' · ');
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
