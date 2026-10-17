import { ITEM_FORM_NAMES, itemSpecText, traitRegistry, standardConditionMap, isGradedTrait, traitLadderSummary, traitLevelsV16, canonicalTraitId, sourceTraitLevel,
  type Ability, type Combatant, type EffectOp, type ItemPassive, type ItemValue } from '../../engine/src/index.js';
import { enhancementLabel } from '../../engine/src/enhancements.js';
import { gridAbility } from '../../engine/src/small/skill-range.js';

const ZONES: Record<string, string> = { fire: '火墙', poison: '毒雾', smoke: '烟幕', healing: '治疗区域', trap: '陷阱' };
const MOVES: Record<string, string> = { dash: '突进', blink: '闪现', withdraw: '后撤' };
function effectText(e: EffectOp): string {
  switch (e.op) {
    case 'heal': return `恢复${e.amount ?? e.dice}生命或可救伤兵`;
    case 'damage': return `伤害${e.baseDice}${e.shape === 'burst' ? '（范围）' : ''}`;
    case 'condition': return `${standardConditionMap().get(e.conditionId)?.name ?? e.conditionId}${e.dur}轮${e.magnitude !== undefined ? '（效力' + Math.round(e.magnitude * 100) + '%）' : ''}`;
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
/** 行动道具：怎么用、多远、效果；编队件数口径另注。 */
export function itemAbilitySummary(a: Ability): string {
  return [a.itemQuick ? '自身或相邻友军，可用加速动作' : a.usesPerBattle ? `装备后每战${a.usesPerBattle}次，占主行动` : '占主行动',
    a.range && a.range.max > 1 ? `射程${gridAbility(a, 'arms-v2').range!.max}格` : '', ...a.effects.map(effectText), a.delivery === 'magic' ? '魔法' : '',
    // 件数口径只对一次性道具有意义；充能道具不消耗件数。
    a.usesPerBattle ? '' : a.itemScaling === 'member' ? '编队齐用时每次最多消耗现员数件' : a.itemScaling === 'object' ? '一件一个效果' : '',
    !a.usesPerBattle && a.itemScaling === 'member' && a.effects.length && a.effects.every(e => e.op === 'heal') ? '按实际伤量使用所需件数' : '',
    !a.usesPerBattle && a.itemScaling === 'member' && a.effects.some(e => e.op === 'barrier') ? '护盾容量按本次件数累加，全队共用；重复施放取较强保护' : ''].filter(Boolean).join('，');
}
export function itemPassiveSummary(p: ItemPassive): string {
  const traits = p.traits.map((t) => {
    const name = traitRegistry().get(t.id)?.name ?? t.id;
    return isGradedTrait(t.id) ? `${name}（${traitLadderSummary(t.id, t.level ?? 5)}）` : name;
  });
  return ['装备后获得', traits.join('、'), p.bonuses ? '单位修正' + enhancementLabel(p.bonuses) + '（同方向只取最高一件）' : ''].filter(Boolean).join(' ');
}
/** 库存卡片、审批预览与事实清单共用的一句话说明。 */
export function itemValueSummary(value: ItemValue): string {
  const r = value.recipe;
  return [ITEM_FORM_NAMES[r.form] + ' · ' + itemSpecText(r), value.ability ? itemAbilitySummary(value.ability) : '', value.passive ? itemPassiveSummary(value.passive) : ''].filter(Boolean).join(' · ');
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
  for (const [stat, points] of Object.entries(item.passive.bonuses ?? {}) as [keyof NonNullable<ItemPassive['bonuses']>, number][]) {
    if (points <= 0) continue;
    if (gear.some((other, n) => n !== index && beats(other.passive?.bonuses?.[stat] ?? 0, n, points))) covered.push(enhancementLabel({ [stat]: points }));
  }
  return covered;
}
