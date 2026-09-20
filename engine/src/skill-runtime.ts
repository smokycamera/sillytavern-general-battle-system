import { spCapacity } from './resources.js';
import type { Ability, Combatant, EffectOp, Weapon } from './types.js';
import { isRangedWeapon } from './loadout.js';
import { meleeWeapon } from './loadout.js';
import { generateUnit } from './gen/generator.js';

export function skillWeapon(actor: Combatant, ability: Ability, distance?: number): Weapon | undefined {
  if (ability.damageBasis !== 'weapon') return undefined;
  if (!ability.weaponUse || ability.weaponUse === 'melee') return meleeWeapon(actor);
  const weapons = [actor.weapon, actor.sidearm].filter((w): w is Weapon => !!w);
  if (ability.weaponUse === 'ranged') return weapons.find(isRangedWeapon);
  return actor.weapon ?? actor.sidearm;
}
export function skillResourceChange(target: Combatant, effect: Extract<EffectOp, { op: 'resource' }>): number {
  const have = target.resources[effect.resource] ?? 0;
  return Math.max(-have, Math.min(effect.amount, effect.maximum === 'training' ? Math.max(0, (effect.resource === 'SP' ? spCapacity(target) : 6 + Math.floor(target.level / 2)) - have) : Infinity));
}
/** 回能与支付使用同一估值，避免净亏/零收益的回能被当成免费收益。 */
export function skillResourceCost(ability: Ability): number {
  const cost = ability.cost;
  if (!cost) return 0;
  const restoresPayment = ability.effects.some(e => e.op === 'resource' && e.resource === cost.resource && e.amount > 0);
  return cost.amount * (restoresPayment ? 1.5 : 0.5);
}
export function conjuredTemplate(template: string): boolean { return /^conjured:(?:[1-9]|10)$/.test(template); }
export function conjureSkillUnit(template: string, side: Combatant['side'], id: string, mode: 'small' | 'mass'): Combatant | undefined {
  if (!conjuredTemplate(template)) return undefined;
  const power = Number(template.split(':')[1]);
  const unit = generateUnit({ rulesVersion: 'v2', name: '召唤造物', side, scale: mode === 'mass' ? 'company' : 'hero',
    ...(mode === 'mass' ? { hpMax: 4 + power * 2 } : {}), level: power, weaponClass: 'sword', weaponLevel: power, armorTier: 1, armorLevel: power, traits: [] },
    { seed: id, noVariance: true }).unit;
  unit.id = id; return unit;
}
