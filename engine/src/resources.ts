import type { Combatant } from './types.js';

/** 战技储备由训练与实际施法配置决定；换武器/学技能不会在战内凭空回满。 */
export function spCapacity(unit: Pick<Combatant, 'level' | 'rulesVersion' | 'weapon' | 'abilities' | 'preparedAbilityIds'>): number {
  if (unit.rulesVersion !== 'v2') return 3 + unit.level;
  const caster = unit.weapon?.recipe?.mechanism === 'magic'
    || unit.abilities.some((a) => a.delivery === 'magic' && !a.itemSourceId && unit.preparedAbilityIds?.includes(a.id));
  return caster ? 12 + unit.level * 2 : 6 + Math.floor(unit.level / 2);
}
