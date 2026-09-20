import { CURVES, ARCHETYPE_MODS } from './data/curves.js';
import { BODY } from './body.js';
import type { Combatant } from './types.js';

/** 最高训练×最大体型+最高原型修正=844，向上取整到千位留出自定义空间。 */
export const MAX_DEFAULT_SINGLE_LIFE = Math.max(...CURVES.map(row => row.hp)) * Math.max(...Object.values(BODY).map(body => body.hp))
  + Math.max(...Object.values(ARCHETYPE_MODS).map(archetype => archetype.hp));
export const SINGLE_LIFE_LIMIT = Math.ceil(MAX_DEFAULT_SINGLE_LIFE / 1000) * 1000;
export const capSingleLife = (value: number): number => Math.min(value, SINGLE_LIFE_LIMIT);

/** 只限制生命，不限制编制；保持合法的较低当前值和零生命，不补满、不复活。 */
export function limitCombatantLife(unit: Combatant): boolean {
  let changed = false;
  if (unit.scale === 'hero' && Number.isSafeInteger(unit.base.hpMax) && unit.base.hpMax > SINGLE_LIFE_LIMIT) {
    unit.base.hpMax = SINGLE_LIFE_LIMIT; unit.hp = Math.min(unit.hp, SINGLE_LIFE_LIMIT); changed = true;
  }
  const formation = unit.formation;
  if (unit.scale !== 'hero' && formation && Number.isSafeInteger(formation.memberHp) && formation.memberHp > SINGLE_LIFE_LIMIT) {
    formation.memberHp = SINGLE_LIFE_LIMIT;
    if (formation.health) {
      const counts = new Map<number, number>();
      for (const group of formation.health) {
        const hp = capSingleLife(group.hp); counts.set(hp, (counts.get(hp) ?? 0) + group.count);
      }
      formation.health = [...counts].sort((a, b) => a[0] - b[0]).map(([hp, count]) => ({ hp, count }));
    }
    changed = true;
  }
  return changed;
}
