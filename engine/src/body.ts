import type { BodyKind, Combatant, DamageChannel } from './types.js';

/** 实际身体统一决定结构与装备容量；体量特质只是这些事实的投影。 */
export const BODY: Record<BodyKind, { hp: number; strength: number; capacity: number; movement: number; protection: Record<DamageChannel, number> }> = {
  human: { hp: 1, strength: 1, capacity: 8, movement: 3, protection: { kinetic: 0, thermal: 0, arcane: 0 } },
  large: { hp: 2, strength: 1.4, capacity: 12, movement: 3, protection: { kinetic: 1, thermal: 0, arcane: 0 } },
  vehicle: { hp: 6, strength: 1, capacity: 24, movement: 3, protection: { kinetic: 0, thermal: 0, arcane: 0 } },
  giant: { hp: 10, strength: 1.8, capacity: 24, movement: 2, protection: { kinetic: 2, thermal: 1, arcane: 0 } },
};
export function bodyProtection(unit: Combatant, channel: DamageChannel): number {
  return unit.rulesVersion === 'v2' ? BODY[unit.body ?? 'human'].protection[channel] : 0;
}
export function physicalTraitIds(unit: Combatant): string[] {
  if (unit.rulesVersion !== 'v2') return [];
  return unit.body === 'giant' ? ['large', 'titan'] : unit.body === 'large' ? ['large'] : [];
}
export function bodyMovement(unit: Combatant): number {
  const body = unit.body ?? 'human';
  // 装甲车与重型火炮平台共用车体；重装或重型投送让出一格机动。
  return (unit.speedTier ?? BODY[body].movement) - Number(body === 'vehicle' && ((unit.armor?.tier ?? 0) >= 3 || [unit.weapon, unit.sidearm].some((w) => (w?.load ?? 0) >= 6)));
}
export function effectiveProtection(unit: Combatant, channel: DamageChannel): number {
  return Math.max(bodyProtection(unit, channel), unit.armor?.protection?.[channel] ?? unit.armor?.tier ?? 0);
}
