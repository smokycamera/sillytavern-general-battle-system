import { isRangedWeapon } from './loadout.js';
import { meleeReach } from './melee.js';
import { skillWeapon, skillResourceChange } from './skill-runtime.js';
import { skillTraitReason } from './skill-effects.js';
import { standardConditionMap } from './conditions.js';
import { dispelCandidates, conditionChance } from './skill-effects.js';
import { meleeWeapon } from './loadout.js';
import { recoveryCapacity } from './recovery.js';
/**
 * 战斗动作的共用查询与合法性判定。
 *
 * 这里不掷骰、不改状态；执行器、自动行动与面板只消费同一份结果，避免各自
 * 重写射程、目标和行动额度规则。
 */

import type { Ability, Combatant, RangeSpec, Weapon } from './types.js';
import { healingAmount } from './items.js';
import { activeTraitIds } from './trait-sources.js';
import { aerialTargetReason, sameLayer } from './aerial.js';

export type ActionKind = 'move' | 'weapon' | 'charge' | 'ability' | 'brace' | 'retreat' | 'end-turn';

export type ActionIntent =
  | { kind: 'move'; actorId: string; direction: 'advance' | 'withdraw' }
  | { kind: 'weapon'; actorId: string; targetId: string; weaponMode: 'primary' | 'sidearm' }
  | { kind: 'charge'; actorId: string; targetId: string }
  | { kind: 'ability'; actorId: string; abilityId: string; targetId?: string }
  | { kind: 'retreat'; actorId: string }
  | { kind: 'brace'; actorId: string }
  | { kind: 'end-turn'; actorId: string };

export interface TurnEconomy {
  moveAvailable: boolean;
  actionAvailable: boolean;
  reactionAvailable: boolean;
}

export interface TargetOption {
  targetId: string;
  enabled: boolean;
  reason?: string;
  distance?: number;
  preview?: ActionPreview;
}

export interface ActionPreview {
  weaponOverflow?:boolean;
  armorScale?:number;
  damageModel?:'member-health';
  expectedCasualties?:number;
  participants?: number;
  memberHp?: number;
  aggregationSamples?: number;
  /** 整个聚合动作至少一组命中的概率；用于命中后控制。 */
  anyHitChance?: number;
  /** 整次攻击实际造成至少1点损失的概率，区别于命中概率。 */
  damageChance?: number;
  onHit?: string;
  weaponName?: string;
  areaTargets?: string[];
  areaTargetIds?: string[];
  areaPreviews?: { targetId: string; hitChance: number; expectedDamage: number }[];
  channel?: import('./types.js').DamageChannel;
  penetration?: number;
  resistance?: number;
  penetrationFactor?: number;
  attackScore?: number;
  defenseScore?: number;
  attackModifiers?: string;
  defenseModifiers?: string;
  effects?: string[];
  fallChance?: number;
  moraleBefore?: number;
  moraleAfter?: number;
  breakChance?: number;
  rallyChance?: number;
  movementCost?: number;
  lands?: boolean;
  fallDamage?: number;
  landingCell?: number;
  forcedExit?: boolean;
  healing?: number;
  exact?: boolean;
  variance?: number;
  minDamage?: number;
  maxDamage?: number;
  /** 0~1 的命中概率；是当前公开属性下的估算，不消耗随机数。 */
  hitChance?: number;
  /** 含命中率后的平均伤害估算。 */
  expectedDamage?: number;
  movePenalty?: number;
  pointBlankPenalty?: number;
  resource?: { name: string; cost: number; available: number };
  cooldownLeft?: number;
  usesLeft?: number;
}

export interface ActionOption {
  id: string;
  kind: ActionKind;
  label: string;
  enabled: boolean;
  reason?: string;
  targets?: TargetOption[];
  range?: RangeSpec;
  preview?: ActionPreview;
}

/** 无随机数的命中率估算，供 UI 与 AI 预览；执行时仍由伤害管线掷骰。 */
export function estimateHitChance(rules: import('./types.js').RulePack, netAtk: number, targetDef: number): number {
  if (rules.hitMode === 'tw') {
    const diff = netAtk - (targetDef - rules.tw.defOffset);
    return Math.max(rules.tw.min, Math.min(rules.tw.max, rules.tw.base + diff * rules.tw.perDiff));
  }
  let hits = 0;
  for (let natural = 1; natural <= 20; natural++) {
    if (natural <= 1) continue;
    if (natural >= rules.critMin || natural + netAtk >= targetDef) hits += 1;
  }
  return hits / 20;
}

/** 支持引擎常用 NdM±K 表达式的期望值。 */
export function averageDice(expr?: string): number {
  if (!expr) return 0;
  const match = expr.trim().match(/^(\d*)d(\d+)(?:\s*([+-])\s*(\d+))?$/i);
  if (!match) return Number(expr) || 0;
  const count = Number(match[1] || 1);
  const sides = Number(match[2]);
  const flat = Number(match[4] || 0) * (match[3] === '-' ? -1 : 1);
  return count * (sides + 1) / 2 + flat;
}

export function estimateExpectedDamage(input: {
  baseDice?: string;
  apDice?: string;
  armorReduction: number;
  hitChance: number;
  attacks?: number;
}): number {
  const perHit = Math.max(0, averageDice(input.baseDice) * (1 - input.armorReduction) + averageDice(input.apDice));
  return perHit * Math.max(1, input.attacks ?? 1) * input.hitChance;
}

export function turnEconomy(input: {
  isTurn: boolean;
  ready: boolean;
  moved: boolean;
  acted: boolean;
}): TurnEconomy {
  const canUseTurn = input.isTurn && input.ready;
  return {
    moveAvailable: canUseTurn && !input.moved,
    actionAvailable: canUseTurn && !input.acted,
    reactionAvailable: input.ready,
  };
}

export function weaponRangeSpec(weapon: Weapon | undefined, ranged: boolean): RangeSpec {
  const max = Math.max(0, weapon?.range ?? (ranged ? 3 : 0));
  return {
    min: Math.max(0, weapon?.minRange ?? (ranged ? 1 : 0)),
    max,
    metric: 'grid',
    allowEngaged: !ranged || weapon?.pointBlankPolicy === 'allow' || weapon?.pointBlankPolicy === 'penalty',
  };
}

export function pointBlankModifier(weapon: Weapon | undefined, ranged: boolean, distance: number, actor?: Combatant): number {
  // 兼容已冻结的旧爆破装备：移除旧抵近惩罚，远距惩罚由共用伤害管线计算。
  if (actor?.rulesVersion === 'v2' && weapon?.tags?.includes('blast')) return 0;
  if (!ranged || distance !== 0 || weapon?.pointBlankPolicy !== 'penalty') return 0;
  if (actor?.rulesVersion === 'v2' && activeTraitIds(actor).includes('versatile')) return 0;
  return weapon.pointBlankPenalty ?? -2;
}

export function weaponTargetReason(input: {
  actor: Combatant;
  target: Combatant;
  weapon?: Weapon;
  ranged: boolean;
  distance: number;
  reloadLeft?: number;
  charge?: boolean;
}): string | undefined {
  const { actor, target, weapon, ranged, distance } = input;
  if (target.side === actor.side) return '武器攻击只能选择敌方目标';
  if (target.status === 'dead' || target.status === 'fled') return target.name + ' 已离场';
  if (target.status !== 'ready' && target.status !== 'dying' && target.status !== 'routing') return target.name + ' 当前无法作为攻击目标';
  if (!weapon) return actor.name + ' 没有可用武器';
  const aerial = aerialTargetReason(actor, target, ranged); if (aerial) return aerial;
  if (input.charge) {
    if (actor.rulesVersion === 'v2' && ranged) return '冲锋需要近战武器';
    if (distance < 2) return '距离太近，无从冲锋（需 ≥2 带）';
    if (actor.archetype !== 'mobile' && !activeTraitIds(actor).includes('charge-strong')) {
      return '只有机动单位（或带冲锋特质）可以冲锋';
    }
    return undefined;
  }
  if ((input.reloadLeft ?? 0) > 0 && ranged) {
    return actor.name + ' 装填中（剩 ' + Math.max(0, (input.reloadLeft ?? 0) - 1) + ' 回合）';
  }
  const range = weaponRangeSpec(weapon, ranged);
  if (distance < range.min) {
    if (distance === 0 && ranged) return target.name + ' 贴身缠斗，该武器不能抵近射击';
    return '未达最小射程（距离' + distance + ' < 最小射程' + range.min + '）';
  }
  if (distance > range.max) {
    return ranged
      ? '超出射程（距离' + distance + ' > 射程' + range.max + '）'
      : '距离不足（距离' + distance + ' > 武器触及' + range.max + '），先移动接近';
  }
  if (distance === 0 && ranged && weapon.pointBlankPolicy === 'forbid') {
    return target.name + ' 贴身缠斗，该武器不能抵近射击';
  }
  return undefined;
}

export function fallbackAbilityRange(actor: Combatant, ability: Ability): RangeSpec {
  if (ability.weaponUse) {
    const weapon = skillWeapon(actor, ability);
    return { min: 0, max: weapon ? Math.min(ability.range?.max ?? 7, skillWeaponReach(actor, weapon)) : 0, metric: 'grid', allowEngaged: true };
  }
  if (actor.rulesVersion === 'v2' && ability.requires === 'melee' && ability.range) return { ...ability.range, max: Math.max(1, ability.range.max) };
  if (ability.range) return ability.range;
  if (ability.target === 'self') return { min: 0, max: 0, metric: 'self', allowEngaged: true };
  if (ability.target === 'zone') return { min: 0, max: 99, metric: 'global', allowEngaged: true };
  const damage = ability.effects.find((effect) => effect.op === 'damage');
  if (!damage) return { min: 0, max: 99, metric: 'global', allowEngaged: true };
  if (damage.tag === 'ranged') {
    return { min: 1, max: Math.max(1, actor.weapon?.range ?? 3), metric: 'grid', allowEngaged: false };
  }
  if (actor.weapon?.tags?.includes('ranged') || actor.archetype === 'ranged') {
    return { min: 0, max: Math.max(1, actor.weapon?.range ?? 3), metric: 'grid', allowEngaged: true };
  }
  return { min: 0, max: Math.max(0, actor.weapon?.range ?? 0), metric: 'grid', allowEngaged: true };
}

function skillWeaponReach(actor: Combatant, weapon: Weapon): number {
  return actor.combatModel === 'cohort-v2' && !isRangedWeapon(weapon) ? meleeReach(weapon) : Math.max(1, weapon.range ?? 0);
}

export function abilityUsabilityReason(actor: Combatant, ability: Ability): string | undefined {
  if (ability.unavailableReason) return ability.unavailableReason;
  if (actor.rulesVersion === 'v2') {
    if (ability.weaponUse && !skillWeapon(actor, ability)) return ability.weaponUse === 'ranged' ? '需要实际远程武器' : '需要实际可用武器';
    if (ability.damageBasis && skillWeapon(actor,ability)?.recipe?.mechanism !== 'natural' && actor.conditions.some((c) => c.dur > 0 && standardConditionMap().get(c.id)?.preventAttack)) return '缴械状态不能使用武器技法';
    if (ability.delivery === 'magic' && actor.conditions.some((c) => c.dur > 0 && standardConditionMap().get(c.id)?.preventMagic)) return '沉默状态不能施放魔法技能';
    if (ability.itemSourceId && !actor.carriedItems?.some((i) => i.id === ability.itemSourceId)) return '携行物品来源已失效';
    if (ability.equipmentSourceId && !Object.values(actor.accessories ?? {}).some(item => item?.id === ability.equipmentSourceId)) return '提供这项能力的配件已卸下';
    if (!ability.itemSourceId && !ability.equipmentSourceId && !actor.preparedAbilityIds?.includes(ability.id)) return '已学但尚未准备';
    if (ability.requires === 'shield' && !actor.shield) return '需要实际盾牌';
    if (ability.requires === 'melee' && !meleeWeapon(actor)) return '需要近战武器';
  }
  const state = actor.abilityState.find((item) => item.abilityId === (ability.cooldownGroup ?? ability.id));
  if (state && state.cdLeft > 0) return '冷却中（剩 ' + state.cdLeft + ' 回合）';
  if (ability.usesPerBattle !== undefined && (state?.used ?? 0) >= ability.usesPerBattle) {
    return '本战次数已用尽';
  }
  if (ability.cost) {
    const have = actor.resources[ability.cost.resource] ?? 0;
    if (have < ability.cost.amount) {
      return (ability.itemSourceId ? '物品数量' : ability.cost.resource) + ' 不足（' + have + '/' + ability.cost.amount + '）';
    }
  }
  return undefined;
}

export function abilityTargetReason(input: {
  actor: Combatant;
  ability: Ability;
  target?: Combatant;
  distance?: number;
}): string | undefined {
  const { actor, ability } = input;
  const target = ability.target === 'self' ? actor : input.target ?? (ability.target === 'ally' ? actor : undefined);
  if (target && ability.targetBody && target.body !== ability.targetBody) return '维修用品只能修理车辆';
  if (target && ability.effects.length && ability.effects.every(e => e.op === 'barrier' && (target.barrier?.remaining ?? 0) >= e.amount && (target.barrier?.duration ?? 0) >= e.dur
    || e.op === 'resource' && !skillResourceChange(target, e))) return '目标已经有足够的屏障或精力';
  if (target && ability.weaponUse) {
    const weapon = skillWeapon(actor, ability, input.distance);
    if (!weapon) return '没有符合技法的武器';
    if (!isRangedWeapon(weapon) && !sameLayer(actor, target)) return '接触技能需要处于同一空地层';
    const distance = input.distance ?? 0;
    if (distance > skillWeaponReach(actor, weapon) || distance < (weapon.minRange ?? 0)) return '目标超出实际武器射程';
    if (isRangedWeapon(weapon) && weapon.pointBlankPolicy === 'forbid' && distance <= 1 && sameLayer(actor, target)) return '实际武器不能抵近射击';
  }
  if (target && ability.recipe && ability.effects.every((e) => e.op === 'trait' && !!skillTraitReason(target, e)
    || e.op === 'resource' && (!skillResourceChange(target, e) || target.id === actor.id && e.amount > 0 && (ability.cost?.amount ?? 0) >= e.amount))) return '目标没有可生效的能力或资源变化';
  if (target && !sameLayer(actor, target) && (ability.requires === 'melee' || ability.requires === 'shield')) return '接触技能需要处于同一空地层';
  if (target && actor.rulesVersion === 'v2' && ability.effects.length && ability.effects.every((e) => e.op === 'dispel' && !dispelCandidates(target, e).length || e.op === 'condition' && !conditionChance(target, e))) return '目标没有可解除的效果，或已免疫/处于同类控制';
  if (target && ability.itemSourceId && actor.id !== target.id && !sameLayer(actor, target)) return '向他人使用携行物品需要处于同一空地层';
  if (actor.rulesVersion === 'v2' && ability.effects.every((e) => e.op === 'heal') && target && !recoveryCapacity(target)) return target.scale === 'hero' ? '当前目标没有可恢复损伤或已离场' : '群体治疗需要可救伤员记录，不能凭技能招募新兵';
  if (ability.target === 'enemy' && (!target || target.side === actor.side)) {
    return '该技能必须指定一名敌方目标';
  }
  if (ability.target === 'ally' && target && target.side !== actor.side) {
    return '该技能只能以友方单位为目标';
  }
  if (ability.target === 'self' && input.target && input.target.id !== actor.id) {
    return '该技能只能对自己施放';
  }
  if (target && (target.status === 'dead' || target.status === 'fled')) return target.name + ' 已离场';
  if (ability.itemSourceId && target) {
    try { for (const effect of ability.effects) if (effect.op === 'heal' && effect.amount !== undefined) healingAmount(target, effect.amount); }
    catch (error) { return error instanceof Error ? error.message : String(error); }
  }
  const range = fallbackAbilityRange(actor, ability);
  if (range.metric === 'self') {
    return target && target.id !== actor.id ? '该技能只能对自己施放' : undefined;
  }
  if (!target || range.metric === 'global') return undefined;
  const distance = input.distance ?? 0;
  if (distance === 0 && range.allowEngaged === false) return '该技能不能对贴身目标施放';
  if (distance < range.min) return '未达技能最小射程（距离' + distance + ' < ' + range.min + '）';
  if (distance > range.max) return '超出技能射程（距离' + distance + ' > ' + range.max + '）';
  return undefined;
}
