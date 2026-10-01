import type { Ability, Combatant } from './types.js';
import type { ObservationContext } from './observation.js';
import { standardConditionMap } from './conditions.js';
import { isEnduranceModel, abilityCost, resourceRound, skillExertion, spRecovery } from './resources.js';
import { fatigueAfter } from './tactics.js';
import { actionPotential } from './skill-tactics.js';
import { skillResourceCost } from './skill-runtime.js';
import { memberHealth } from './member-health.js';
import { spendAbility } from './ability-state.js';

const defaults = standardConditionMap();
const FUTURE_DISCOUNT = 0.65;
const forecasts = new WeakMap<ObservationContext, WeakMap<Combatant, Map<Ability | 'active' | 'rest', number>>>();

/** Pure, one-boundary resource forecast. Normal actions also recover SP and tick cooldowns.
 * It deliberately does not simulate hits, enemy orders, healing or random outcomes.
 */
export function nextResourceState(context: ObservationContext, source: Combatant, rest = false, cast?: Ability): Combatant {
  const next = { ...source, resources: { ...source.resources }, abilityState: source.abilityState.map(s => ({ ...s })) };
  const incapacitated = source.conditions.some(c => c.dur > 0 && (context.conditions ?? defaults).get(c.id)?.skipTurn);
  const fullRest = rest && !incapacitated && !source.suppression && !(source.tacticalEffort ?? 0);
  if (cast) {
    const cost = abilityCost(source, cast);
    if (cost) next.resources[cost.resource] = resourceRound(Math.max(0, (next.resources[cost.resource] ?? 0) - cost.amount));
    // The mass support phase reserves an additional boundary; preserve each mode's actual contract.
    spendAbility(next, cast, Number(context.mode === 'mass'));
  }
  if (next.status === 'ready') next.fatigue = fatigueAfter(source, (source.tacticalEffort ?? 0) + (rest ? 0 : cast ? skillExertion(source, cast) : 1), fullRest);
  next.resources.SP = resourceRound((next.resources.SP ?? 0) + spRecovery(next, fullRest, incapacitated));
  for (const state of next.abilityState) state.cdLeft = Math.max(0, state.cdLeft - 1);
  return next;
}

function futureAttack(context: ObservationContext, source: Combatant, action: Ability | 'active' | 'rest'): number {
  let cache = forecasts.get(context); if (!cache) forecasts.set(context, cache = new WeakMap());
  let values = cache.get(source); if (!values) cache.set(source, values = new Map());
  const known = values.get(action); if (known !== undefined) return known;
  const next = nextResourceState(context, source, action === 'rest', typeof action === 'string' ? undefined : action);
  // Restrict to damage: a future heal must not count the same current wound a second time.
  const value = Math.max(0, ...context.units.filter(t => t.side !== source.side && t.hp > 0 && ['ready', 'routing'].includes(t.status))
    .map(target => actionPotential(context, next, target)));
  values.set(action, value); return value;
}

/** Price lost next-action options in the same expected-life units as attacks, not just raw SP.
 * Only V9 changes. No forced rotation: repeating the best affordable move remains legal and sensible.
 */
export function tacticalSkillCost(context: ObservationContext, source: Combatant, ability: Ability, expectedDamage = 0): number {
  const base = skillResourceCost(ability, source), cost = abilityCost(source, ability);
  if (!isEnduranceModel(source.resourceModel) || cost?.resource !== 'SP' || cost.amount <= 0
    || ability.effects.some(e => e.op === 'resource' && e.resource === 'SP')) return base;
  const loss = Math.max(0, futureAttack(context, source, 'active') - futureAttack(context, source, ability));
  const remaining = context.units.filter(t => t.side !== source.side && t.hp > 0 && ['ready', 'routing'].includes(t.status))
    .reduce((sum, target) => sum + memberHealth(target), 0);
  // An attack likely to end the observed fight should not save SP for an imaginary extra round.
  const continuation = remaining > 0 ? Math.max(0, 1 - expectedDamage / remaining) : 0;
  return base + loss * FUTURE_DISCOUNT * continuation;
}

/** Compare *next normal activation* with *next rested activation*, not rested future vs current state.
 * Shared cooldown decay/natural SP recovery are therefore never credited exclusively to resting.
 */
export function tacticalRestValue(context: ObservationContext, source: Combatant): number {
  if (!isEnduranceModel(source.resourceModel) || source.status !== 'ready' || source.hp <= 0) return 0;
  return Math.max(0, futureAttack(context, source, 'rest') - futureAttack(context, source, 'active')) * FUTURE_DISCOUNT;
}
