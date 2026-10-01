import type { Ability, Combatant } from './types.js';

/** Mechanism identity survives renaming/relearning; cooldown families stay separate. */
export function abilityUsageKey(ability: Ability): string {
  if (ability.itemSourceId) return ability.id;
  return 'uses:' + (ability.equipmentSourceId || ability.itemSourceId ? ability.id : ability.definitionId ?? ability.id);
}
export function abilityUsed(actor: Combatant, ability: Ability): number {
  return (actor.abilityState.find(s => s.abilityId === abilityUsageKey(ability))
    ?? actor.abilityState.find(s => s.abilityId === (ability.cooldownGroup ?? ability.id)))?.used ?? 0;
}
export function spendAbility(actor: Combatant, ability: Ability, cooldownOffset = 0): void {
  // Freeze all legacy family counts before changing one skill. Old saves did not
  // record which sibling spent the shared count, so preserve that lower bound.
  for (const a of actor.abilities) if (!actor.abilityState.some(s => s.abilityId === abilityUsageKey(a)))
    actor.abilityState.push({ abilityId: abilityUsageKey(a), cdLeft: 0, used: abilityUsed(actor, a) });
  let usage = actor.abilityState.find(s => s.abilityId === abilityUsageKey(ability));
  if (!usage) { usage = { abilityId: abilityUsageKey(ability), cdLeft: 0, used: 0 }; actor.abilityState.push(usage); }
  usage.used++;
  const key = ability.cooldownGroup ?? ability.id;
  let cooldown = actor.abilityState.find(s => s.abilityId === key);
  if (!cooldown) { cooldown = { abilityId: key, cdLeft: 0, used: 0 }; actor.abilityState.push(cooldown); }
  cooldown.cdLeft = (ability.cooldown ?? 0) + cooldownOffset;
}
