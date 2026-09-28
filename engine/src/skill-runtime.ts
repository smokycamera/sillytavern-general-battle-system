import { spCapacity, abilityCost } from './resources.js';
import type { Ability, Combatant, EffectOp, Weapon } from './types.js';
import { isRangedWeapon } from './loadout.js';
import { meleeWeapon } from './loadout.js';
import { generateUnit } from './gen/generator.js';
import { compileWeapon } from './gen/equipment.js';
import { ENHANCEMENT_STATS, type Enhancements, type BonusStat } from './enhancements.js';
import { nominalLife } from './combat-model.js';

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
export function skillResourceCost(ability: Ability, actor?: Combatant): number {
  const cost = actor ? abilityCost(actor, ability) : ability.cost;
  if (!cost) return 0;
  const restoresPayment = ability.effects.some(e => e.op === 'resource' && e.resource === cost.resource && e.amount > 0);
  const reserve = actor ? (actor.resources[cost.resource] ?? 0) : Infinity;
  return cost.amount * (restoresPayment ? 1.5 : 0.5) * (reserve <= cost.amount ? 2 : reserve <= cost.amount * 2 ? 1.5 : 1);
}
export function conjuredTemplate(template: string): boolean { return /^conjured:(?:(?:single|group):)?(?:[1-9]|10)$/.test(template); }
export function summonProfile(template: string, mode: 'small' | 'mass', bonuses?: Enhancements) {
  if (!conjuredTemplate(template)) return undefined;
  const parts = template.split(':'), power = Number(parts.at(-1));
  // 旧模板保留按战场选择类型；新模板的类型不随战场改变。
  const group = parts[1] === 'group' || parts.length === 2 && mode === 'mass';
  return { power, group, members: group ? 4 + power * 2 : 1, range: Math.max(1, 1 + (bonuses?.range ?? 0)) };
}
/** 群体分摊同级单体的生命池；取整后的总生命不会因人数成倍增加。 */
export function summonedMemberLife(unit: Combatant): number | undefined {
  return unit.scale !== 'hero' && unit.weapon?.recipe?.mechanism === 'summon'
    ? Math.max(1, Math.floor(nominalLife(unit) / unit.base.hpMax)) : undefined;
}
export function conjureSkillUnit(template: string, side: Combatant['side'], id: string, mode: 'small' | 'mass', bonuses?: Enhancements, damageModel?: Combatant['damageModel']): Combatant | undefined {
  const profile = summonProfile(template, mode, bonuses);
  if (!profile) return undefined;
  const { power, group, members } = profile;
  const unit = generateUnit({ rulesVersion: 'v2', damageModel, name: group ? '召唤群体' : '召唤个体', side, scale: group ? 'company' : 'hero',
    ...(group ? { hpMax: members } : {}), level: power, weaponClass: 'summon', weaponLevel: power, armorTier: 1, armorLevel: power, traits: [],
    bonuses: { health: bonuses?.power ?? 0, morale: bonuses?.morale ?? 0 } }, { seed: id, noVariance: true }).unit;
  const weaponBonuses = Object.fromEntries(Object.entries(bonuses ?? {}).filter(([key]) => ENHANCEMENT_STATS.weapon.includes(key as BonusStat)));
  unit.weapon = compileWeapon({ mechanism: 'summon', power, bonuses: weaponBonuses }, { id: `${id}:weapon`, seed: `${id}:weapon`, noVariance: true, damageModel });
  // 保留原始配方，在实际武器换算时只分摊一次，读档也不会再次缩小。
  unit.weapon.damageScale = 1 / members; unit.weapon.customized = true;
  unit.id = id; return unit;
}
