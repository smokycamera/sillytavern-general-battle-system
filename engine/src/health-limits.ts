import { UNIFIED_HP } from './balance.js';
import { ARCHETYPE_MODS } from './data/curves.js';
import { BODY, bodyProfile } from './body.js';
import type { Combatant } from './types.js';

/** V6 default max is 988; reserve the full legal health+power multiplier (2×). */
export const MAX_DEFAULT_SINGLE_LIFE = Math.max(...UNIFIED_HP) * Math.max(...(Object.keys(BODY) as (keyof typeof BODY)[]).map(body => bodyProfile(body, 'wounds-v2').hp))
  + Math.max(...Object.values(ARCHETYPE_MODS).map(archetype => archetype.hp));
export const SINGLE_LIFE_LIMIT = Math.ceil(MAX_DEFAULT_SINGLE_LIFE * 2 / 1000) * 1000;
export const singleLifeLimit = (model?: Combatant['damageModel']) => model === 'wounds-v2' ? SINGLE_LIFE_LIMIT : 1000;
export const capSingleLife = (value: number, model?: Combatant['damageModel']): number => Math.min(value, singleLifeLimit(model));

/** 只限制生命，不限制编制；保持合法的较低当前值和零生命，不补满、不复活。 */
export function limitCombatantLife(unit: Combatant, model = unit.damageModel): boolean {
  let changed = false;
  const limit = singleLifeLimit(model);
  if (unit.scale === 'hero' && Number.isSafeInteger(unit.base.hpMax) && unit.base.hpMax > limit) {
    unit.base.hpMax = limit; unit.hp = Math.min(unit.hp, limit); changed = true;
  }
  const formation = unit.formation;
  if (unit.scale !== 'hero' && formation && Number.isSafeInteger(formation.memberHp) && formation.memberHp > limit) {
    formation.memberHp = limit;
    if (formation.health) {
      const counts = new Map<number, number>();
      for (const group of formation.health) {
        const hp = capSingleLife(group.hp, model); counts.set(hp, (counts.get(hp) ?? 0) + group.count);
      }
      formation.health = [...counts].sort((a, b) => a[0] - b[0]).map(([hp, count]) => ({ hp, count }));
    }
    changed = true;
  }
  return changed;
}
