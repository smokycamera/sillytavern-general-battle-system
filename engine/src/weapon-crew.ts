import type { Weapon } from './types.js';
import { baseMechanism } from './data/weapons.js';
import { isArmsModel, isArmsV2, type ArmsModel } from './arms-model.js';

/** Shared by firing and carrying: retain every historical crew size. */
export function weaponCrew(weapon: Weapon | undefined, model?: ArmsModel): number {
  const mechanism = weapon?.recipe?.mechanism ?? weapon?.tags?.find(t => t.startsWith('mechanism:'))?.slice(10);
  return mechanism === 'rocket' ? (isArmsV2(model) ? 2 : 4)
    : ['cannon', 'indirect-cannon'].includes(baseMechanism(weapon) ?? '') ? 4
      : mechanism === 'autocannon' ? (isArmsModel(model) ? 2 : 3) : 1;
}
