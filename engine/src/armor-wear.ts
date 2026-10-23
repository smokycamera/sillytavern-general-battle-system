import { hasNaturalArmor } from './equipment-load.js';
import { displayNumber } from './display-number.js';
import type { Combatant, RulePack } from './types.js';

/** V30 opts in per unit; saved battles and physical equipment retain their original rules. */
export const ARMOR_WEAR_MODEL = 'wear-v1' as const;
export type ArmorWearModel = typeof ARMOR_WEAR_MODEL;
type WearUnit = Partial<Pick<Combatant, 'armorWearModel' | 'rulesVersion' | 'body' | 'armor' | 'traits' | 'traitSources'>>;
const UNRESTRICTED = { movement: 1, initiative: 0, fatigue: 1 } as const;
export const ARMOR_WEAR = [UNRESTRICTED, UNRESTRICTED,
  { movement: .95, initiative: .5, fatigue: 1.1 },
  { movement: .85, initiative: 1, fatigue: 1.25 },
  { movement: .75, initiative: 2, fatigue: 1.5 }] as const;

export function validateArmorWearModel(value: unknown): void {
  if (value !== undefined && value !== ARMOR_WEAR_MODEL) throw Error('未知护甲穿戴规则');
}
export function prepareArmorWearModel(unit: Combatant, rules: Pick<RulePack, 'armorWearModel'>): void {
  validateArmorWearModel(unit.armorWearModel); validateArmorWearModel(rules.armorWearModel);
  if (rules.armorWearModel) unit.armorWearModel = rules.armorWearModel;
  else delete unit.armorWearModel;
}
export function armorWear(unit: WearUnit) {
  return unit.rulesVersion === 'v2' && unit.armorWearModel === ARMOR_WEAR_MODEL && unit.body !== 'vehicle' && !hasNaturalArmor(unit)
    ? ARMOR_WEAR[unit.armor?.tier ?? 0] ?? UNRESTRICTED : UNRESTRICTED;
}
export function armorWearLabel(unit: WearUnit): string {
  const wear = armorWear(unit);
  return wear.movement === 1 ? '' : `穿戴：移动×${displayNumber(wear.movement)}、先攻−${displayNumber(wear.initiative)}、活动疲劳×${displayNumber(wear.fatigue)}`;
}
