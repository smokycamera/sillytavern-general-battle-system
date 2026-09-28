import { ABILITY_BLUEPRINTS } from './data/ability-blueprints.js';
import type { Ability, Combatant, EffectOp, RulePack } from './types.js';

type ReserveUnit = Pick<Combatant, 'level' | 'rulesVersion' | 'resourceModel' | 'weapon' | 'sidearm' | 'abilities' | 'preparedAbilityIds'>;
/** Both versions share fatigue, costs and recovery; V11 only changes capacity. */
export const isEnduranceModel = (model: unknown): boolean => model === 'endurance-v1' || model === 'endurance-v2';
export const resourceRound = (value: number): number => Math.round(value * 100) / 100;

/** V9 doubles endurance space, not penalty strength; saved pre-V9 units retain 0–4. */
export function fatigueLimit(unit: Pick<Combatant, 'resourceModel'>): number {
  return isEnduranceModel(unit.resourceModel) ? 8 : 4;
}
export function fatiguePenalty(unit: Pick<Combatant, 'resourceModel' | 'fatigue'>): number {
  return Math.floor(unit.fatigue / (fatigueLimit(unit) / 2));
}

/** Read actual, equipped/prepared magic. Labels, armor, inventory and unprepared skills do not count. */
export function casterReserve(unit: ReserveUnit): boolean {
  return [unit.weapon, unit.sidearm].some(w => w?.recipe?.mechanism === 'magic')
    || unit.abilities.some(a => a.delivery === 'magic' && !a.itemSourceId && !a.equipmentSourceId && unit.preparedAbilityIds?.includes(a.id));
}
/** Training determines reserve, not skill or equipment power. Changing loadout never refills it. */
export function spCapacity(unit: ReserveUnit): number {
  if (unit.rulesVersion !== 'v2') return 3 + unit.level;
  if (unit.resourceModel === 'endurance-v2') return casterReserve(unit) ? 6 + 2 * unit.level : 4 + unit.level;
  // Frozen V9–V10 reserve; saved battles retain their original economy.
  if (unit.resourceModel === 'endurance-v1') return casterReserve(unit) ? 10 + 3 * unit.level : 6 + 2 * unit.level;
  // Frozen pre-V9 classification and capacity.
  const caster = unit.weapon?.recipe?.mechanism === 'magic'
    || unit.abilities.some(a => a.delivery === 'magic' && !a.itemSourceId && unit.preparedAbilityIds?.includes(a.id));
  return caster ? 12 + unit.level * 2 : 6 + Math.floor(unit.level / 2);
}
/** The battle's saved rules are authoritative. Re-loading is idempotent; explicit/depleted SP stays spent. */
export function prepareResourceModel(unit: Combatant, rules: Pick<RulePack, 'resourceModel'>): void {
  if (unit.rulesVersion !== 'v2' || unit.resourceModel === rules.resourceModel) return;
  const previousCap = spCapacity(unit), previousFatigueLimit = fatigueLimit(unit), have = unit.resources.SP ?? 0;
  if (rules.resourceModel) unit.resourceModel = rules.resourceModel; else delete unit.resourceModel;
  // Crossing rule versions preserves fatigue proportion; reloading the same model never rescales it.
  unit.fatigue = resourceRound(Math.max(0, Math.min(fatigueLimit(unit), unit.fatigue * fatigueLimit(unit) / previousFatigueLimit)));
  unit.resources.SP = !unit.storyState?.resources && have >= previousCap ? spCapacity(unit) : Math.min(have, spCapacity(unit));
}
function managedSkill(actor: Pick<Combatant, 'resourceModel'>, ability: Ability): boolean {
  return isEnduranceModel(actor.resourceModel) && (!!ability.recipe || !!ABILITY_BLUEPRINTS[ability.definitionId ?? '']) && !ability.customized && !ability.itemSourceId && !ability.equipmentSourceId && !ability.fixedPower;
}
function primitives(ability: Ability): EffectOp[] {
  return ability.effects.flatMap<EffectOp>(e => e.op === 'zone' ? [e, ...(e.effects ?? [])] : [e]);
}
/** A runtime quote shared by UI, legality, AI, preview and payment. Never mutate saved skill recipes. */
export function abilityCost(actor: Pick<Combatant, 'resourceModel'>, ability: Ability): Ability['cost'] {
  const original = ability.cost;
  if (!original || original.resource !== 'SP' || !managedSkill(actor, ability)) return original;
  const effects = primitives(ability), area = ability.shape === 'burst' || !!ability.area || effects.some(e => e.op === 'zone');
  const power = Math.max(1, Math.min(10, ability.power ?? ability.recipe?.power ?? 1));
  const hardControl = effects.some(e => e.op === 'condition' && ['stunned', 'restrained', 'disarmed', 'silenced'].includes(e.conditionId));
  const summon = effects.some(e => e.op === 'summon');
  const computed = 2 + Math.ceil(power / 2) + Math.max(0, effects.length - 1) + Number(hardControl) + (summon ? 2 : 0);
  // Energy transfer retains its existing budget floor and finite uses; it is not a free self-rest action.
  const transferred = ability.effects.reduce((n, e) => n + (e.op === 'resource' && e.resource === 'SP' && e.amount > 0 ? e.amount : 0), 0);
  const transferFloor = transferred * (ability.area?.maxTargets ?? (area ? 2 : 1));
  // Generated pre-V9 templates include a one-SP area premium (notably low-grade buffs).
  // Remove that inherited surcharge too; explicit/custom costs never reach this branch.
  // Positive energy transfers retain their anti-arbitrage budget instead.
  const originalFloor = area && transferred === 0 ? Math.max(0, original.amount - 1) : original.amount;
  return { resource: 'SP', amount: Math.max(originalFloor, computed, transferFloor) };
}
/** Skill grade is independent of training. Overcasting and area casting place additional strain. */
export function skillExertion(actor: Combatant, ability: Ability): number {
  if (!isEnduranceModel(actor.resourceModel)) return 1;
  if (ability.itemSourceId || ability.equipmentSourceId) return 1;
  return resourceRound(1 + Math.max(0, (ability.power ?? 1) - actor.level) * 0.15 + (ability.shape === 'burst' || ability.area ? 0.25 : 0));
}
/** Called only at the existing end-of-activation/end-of-round boundary, never from preview or load. */
export function spRecovery(unit: Combatant, fullRest = false, incapacitated = false): number {
  if (!isEnduranceModel(unit.resourceModel) || unit.status !== 'ready' || unit.hp <= 0 || incapacitated) return 0;
  const base = 0.5 + (unit.level - 1) / 18;
  const penalty = fatiguePenalty(unit);
  const fatigue = penalty >= 2 ? 0.25 : penalty >= 1 ? 0.5 : 1;
  return resourceRound(Math.min(Math.max(0, spCapacity(unit) - (unit.resources.SP ?? 0)), base * fatigue * (fullRest ? 3 : 1)));
}
export function recoverSp(unit: Combatant, fullRest = false, incapacitated = false): number {
  const amount = spRecovery(unit, fullRest, incapacitated);
  if (amount > 0) unit.resources.SP = resourceRound((unit.resources.SP ?? 0) + amount);
  return amount;
}
