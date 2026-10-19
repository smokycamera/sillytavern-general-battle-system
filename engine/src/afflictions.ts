import { collectMods, resolveStack } from './bonus.js';
import { standardConditionMap } from './conditions.js';
import { progression } from './progression.js';
import type { ActiveCondition, Combatant, Trait, Weapon } from './types.js';
import { activeTraitIds } from './trait-sources.js';
import { TRAITS } from './data/traits.js';
import { isCohort, personnel, memberDurability, COHORT_REFERENCE } from './combat-model.js';
import { phase2Traits } from './trait-level-model.js';
import { effectiveTraitLevel } from './trait-sources.js';
import { traitParameter } from './trait-parameters.js';
import { baseMechanism } from './data/weapons.js';
import { isArmsV2 } from './arms-model.js';

export function conditionExposure(source: Combatant, target: Combatant, area = false): number {
  const count=source.scale==='hero'?1:Math.min(personnel(source),10*Math.max(1,personnel(source)/COHORT_REFERENCE));
  return Math.min(target.hp,count*(area?(source.scale==='hero'?4:2):1));
}
/** V3的持续伤害共用成员耐久换算；无历史来源的状态只按一个接触组处理。 */
export function conditionDamage(unit: Combatant, roll: number, condition: ActiveCondition): number {
  const ctx = { attacker: unit, damageChannel: condition.damageChannel ?? standardConditionMap().get(condition.id)?.dot?.channel };
  const ward = progression(unit) ? resolveStack(collectMods(unit, ctx, standardConditionMap(), [], new Map(TRAITS.map(t => [t.id, t]))), 'ward', ctx).multTotal : 1;
  const factor=(condition.id==='poisoned'?poisonFactor(unit):1)*ward;
  return Math.max(0,roll*(condition.magnitude??1)*factor*(unit.scale==='hero'?1:Math.min(unit.hp,condition.affectedMembers??10)/(unit.combatModel==='cohort-v2'?1:memberDurability(unit))));
}

export function poisonFactor(unit: Combatant): number {
  if (unit.rulesVersion === 'v2' && activeTraitIds(unit).includes('inorganic')) return 0;
  return unit.body === 'vehicle' ? 0 : unit.body === 'giant' ? 0.25 : unit.body === 'large' ? 0.5 : 1;
}
export function poisonDamage(unit: Combatant, roll: number): number {
  return Math.max(0, Math.round(roll * poisonFactor(unit) * (unit.scale === 'hero' ? 1 : 0.25)));
}
export function poisonDeliveryReason(target: Combatant, weapon?: Weapon): string | undefined {
  if (!poisonFactor(target)) return target.body === 'vehicle' ? '封闭车体不受生物毒性影响' : '非生物不受毒性影响';
  if (weapon?.channel !== 'kinetic' || !['sword', 'axe', 'spear', 'throwing', 'natural', 'bow', 'light-ranged', 'blunt'].includes(baseMechanism(weapon) ?? '')) return '毒击需要接触武器或适用投射，热能、奥术和重炮不携带涂毒';
  return undefined;
}
export function weaponConditions(attacker: Combatant, target: Combatant, weapon: Weapon | undefined, damage: number, registry?: Map<string, Trait>): ActiveCondition[] {
  if (target.hp <= 0) return [];
  const result = new Map<string, ActiveCondition>();
  for (const id of activeTraitIds(attacker)) for (const effect of (registry?.get(id) ?? TRAITS.find((t) => t.id === id))?.effects ?? []) {
    if (effect.kind !== 'onHitCondition' || effect.conditionId === 'poisoned' && (damage <= 0 || poisonDeliveryReason(target, weapon))) continue;
    result.set(effect.conditionId, { id: effect.conditionId, dur: Math.max(effect.dur, result.get(effect.conditionId)?.dur ?? 0), sourceId: attacker.id, ...(standardConditionMap().get(effect.conditionId)?.dot?.channel ? {damageChannel: standardConditionMap().get(effect.conditionId)!.dot!.channel} : {}),
      ...(effect.conditionId === 'poisoned' && phase2Traits(attacker) ? { magnitude: traitParameter(progression(attacker) ? 'poisonMultiplier' : 'woundRatio', effectiveTraitLevel(attacker, 'poison-strike'), attacker.traitLevelModel) } : {}),
      ...(isCohort(target)&&target.scale!=='hero'?{affectedMembers:conditionExposure(attacker,target)}:{}) });
  }
  // R16 喷射武器：造成实际生命损失的目标燃烧2轮，编队按范围接触人数。
  if (isArmsV2(attacker.armsModel) && weapon?.recipe?.mechanism === 'sprayer' && damage > 0 && !result.has('burning'))
    result.set('burning', { id: 'burning', dur: 2, sourceId: attacker.id, ...(isCohort(target)&&target.scale!=='hero'?{affectedMembers:conditionExposure(attacker,target,true)}:{}) });
  return [...result.values()];
}
/** 每种毒性只保留一份，重复命中不叠层、不刷新旧毒的期限。 */
export function applyWeaponConditions(target: Combatant, conditions: ActiveCondition[] = []): void {
  if (target.hp <= 0) return;
  for (const condition of conditions) if (!target.conditions.some((c) => c.id === condition.id && c.dur > 0)) target.conditions.push({ ...condition });
}
export function poisonHint(attacker: Combatant, target: Combatant, weapon?: Weapon): string | undefined {
  if (!activeTraitIds(attacker).includes('poison-strike')) return undefined;
  return poisonDeliveryReason(target, weapon) ?? `造成损伤后中毒3次，不叠层、不续期、不替换；冻结毒伤×${phase2Traits(attacker) ? traitParameter(progression(attacker) ? 'poisonMultiplier' : 'woundRatio', effectiveTraitLevel(attacker, 'poison-strike'), attacker.traitLevelModel) : 1}；体型影响毒伤`;
}
/** AI的有界后续收益估值，独立于界面展示的即时伤害；不是额外伤害结算。 */
export function poisonValue(attacker: Combatant, target: Combatant, weapon: Weapon | undefined, hitChance: number): number {
  if (!activeTraitIds(attacker).includes('poison-strike') || poisonDeliveryReason(target, weapon) || target.conditions.some((c) => c.id === 'poisoned' && c.dur > 0)) return 0;
  const magnitude = phase2Traits(attacker) ? traitParameter(progression(attacker) ? 'poisonMultiplier' : 'woundRatio', effectiveTraitLevel(attacker, 'poison-strike'), attacker.traitLevelModel) : 1;
  const average = [1, 2, 3, 4].reduce((n, roll) => n + (isCohort(target)?conditionDamage(target,roll,{id:'poisoned',dur:3,magnitude,affectedMembers:conditionExposure(attacker,target)}):poisonDamage(target, roll * magnitude)), 0) / 4;
  return Math.min(target.hp, average * 3 + 1) * hitChance;
}
