import type { Combatant, Weapon } from './types.js';
import type { Modifier, ResolveContext } from './bonus.js';
import { phase2Traits } from './trait-level-model.js';
import { effectiveTraitLevel, traitPrerequisiteReason } from './trait-sources.js';
import { traitParameter } from './trait-parameters.js';

export const phase2Value = (unit: Combatant, id: string, parameter: Parameters<typeof traitParameter>[0], legacy: number): number =>
  phase2Traits(unit) ? traitParameter(parameter, effectiveTraitLevel(unit, id)) : legacy;
export function agileCost(unit: Combatant | undefined, cost: number): number {
  if (!unit || !effectiveTraitLevel(unit, 'agile') || traitPrerequisiteReason(unit, 'agile')) return cost;
  return 1 + Math.max(0, cost - 1) * phase2Value(unit, 'agile', 'agileTerrain', 0);
}
export function straightGridPath(cells: readonly number[], width: number): boolean {
  if (cells.length < 2) return true;
  const dx = cells[1]! % width - cells[0]! % width, dy = Math.floor(cells[1]! / width) - Math.floor(cells[0]! / width);
  return cells.every((cell, i) => i === 0 || cell % width - cells[i - 1]! % width === dx && Math.floor(cell / width) - Math.floor(cells[i - 1]! / width) === dy);
}
export function sharpshooterAttack(level: number, moved: boolean, distance: number, maxRange: number): number {
  if (!level || level === 1 && moved || level <= 2 && distance > maxRange / 2) return 0;
  return level >= 9 ? 4 : level >= 7 ? 3 : level >= 5 || level === 4 && !moved ? 2 : 1;
}
/** 武器协作只改变命中/伤害，不改武器power或投送资格。 */
export function phase2WeaponMods(unit: Combatant, context: ResolveContext): Modifier[] {
  if (!phase2Traits(unit)) return [];
  const out: Modifier[] = [], magic = context.skillDelivery === 'magic', ranged = !!context.ranged;
  const take = (id: string, attack: number, damage = 1) => {
    if (attack) out.push({ source: 'intrinsic', sourceId: id + ':p2-atk', name: id, kind: 'atk', type: 'flat', value: attack });
    if (damage !== 1) out.push({ source: 'intrinsic', sourceId: id + ':p2-dmg', name: id, kind: 'dmg', type: 'mult', value: damage });
  };
  const level = (id: string) => effectiveTraitLevel(unit, id);
  if (level('melee-master') && !magic && !ranged) take('近战特化', phase2Value(unit, 'melee-master', 'meleeAttack', 2), phase2Value(unit, 'melee-master', 'meleeDamage', 1.15));
  if (level('sharpshooter') && !magic && ranged) take('射击专家', sharpshooterAttack(level('sharpshooter'), !!context.moved, context.distance ?? 0, context.maxRange ?? context.weapon?.range ?? 0));
  if (level('charge-strong') && context.charge && !magic) {
    const L = level('charge-strong'), straight = context.chargeStraight ?? false;
    take('冲锋强化', L === 1 && !straight ? 0 : L === 3 && !straight ? 1 : phase2Value(unit, 'charge-strong', 'chargeAttack', 3), phase2Value(unit, 'charge-strong', 'chargeDamage', 1));
  }
  if (level('berserk')) {
    const L = level('berserk'), applies = L >= 3 || !magic && (L >= 2 || !ranged);
    if (applies) take('狂暴', magic && L === 4 ? 1 : phase2Value(unit, 'berserk', 'berserkAttack', 2), phase2Value(unit, 'berserk', 'berserkDamage', 1));
  }
  return out;
}
