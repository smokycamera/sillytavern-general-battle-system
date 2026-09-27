import type { BodyKind, Combatant, DamageChannel } from './types.js';

/** 实际身体统一决定结构与装备容量；体量特质只是这些事实的投影。 */
export const BODY: Record<BodyKind, { hp: number; strength: number; capacity: number; movement: number; protection: Record<DamageChannel, number> }> = {
  human: { hp: 1, strength: 1, capacity: 14, movement: 3, protection: { kinetic: 0, thermal: 0, arcane: 0 } },
  large: { hp: 2, strength: 1.4, capacity: 18, movement: 3, protection: { kinetic: 1, thermal: 0, arcane: 0 } },
  vehicle: { hp: 6, strength: 1, capacity: 24, movement: 3, protection: { kinetic: 0, thermal: 0, arcane: 0 } },
  giant: { hp: 10, strength: 1.8, capacity: 24, movement: 2, protection: { kinetic: 2, thermal: 1, arcane: 0 } },
};
type EquippedLoad = Pick<Combatant, 'weapon' | 'sidearm' | 'armor' | 'shield' | 'accessories'>;
/** 主副武器、护甲、盾和两个配件共同占用身体容量。 */
export function equipmentLoad(unit: EquippedLoad): number {
  return (unit.weapon?.load ?? 0) + (unit.sidearm?.load ?? 0) + (unit.armor?.load ?? 0) + (unit.shield?.load ?? 0)
    + Object.values(unit.accessories ?? {}).reduce((sum, item) => sum + (item?.load ?? 0), 0);
}
/** 实时从实际配装推导，卸装/改变身体后不残留状态，也不改写基础属性。 */
export function humanEncumbered(unit: EquippedLoad & Pick<Combatant, 'body' | 'rulesVersion'>): boolean {
  return unit.rulesVersion === 'v2' && (unit.body ?? 'human') === 'human' && equipmentLoad(unit) >= 12;
}
export function equipmentLoadLabel(unit: EquippedLoad & Pick<Combatant, 'body' | 'rulesVersion'>): string {
  const load = equipmentLoad(unit), capacity = BODY[unit.body ?? 'human'].capacity;
  return `负重 ${load}/${capacity}${load > capacity ? ' · 超出容量' : ''}${humanEncumbered(unit) ? ' · 重载：移动−1、先攻−2（与护甲减益叠加，移动最低1）' : ''}`;
}
export function bodyProfile(body: BodyKind = 'human', model?: Combatant['damageModel']) {
  return model === 'wounds-v2' && body === 'giant' ? { ...BODY.giant, hp: 6, strength: 3 } : BODY[body];
}
export function bodyProtection(unit: Combatant, channel: DamageChannel): number {
  return unit.rulesVersion === 'v2' ? BODY[unit.body ?? 'human'].protection[channel] : 0;
}
export function physicalTraitIds(unit: Combatant): string[] {
  if (unit.rulesVersion !== 'v2') return [];
  return unit.body === 'giant' ? ['large', 'titan'] : unit.body === 'large' ? ['large'] : [];
}
/** 直射高度只比较实际体型；载具按大型，骑乘至少大型，不改变践踏、生命或负重。 */
export function canShootOverAlly(attacker: Combatant, ally: Combatant): boolean {
  const height = (unit: Combatant) => Math.max(unit.mount ? 2 : 1, { human: 1, large: 2, vehicle: 2, giant: 3 }[unit.body ?? 'human']);
  return ally.side === attacker.side && height(attacker) > height(ally);
}
export function bodyMovement(unit: Combatant): number {
  const body = unit.body ?? 'human';
  // 装甲车与重型火炮平台共用车体；重装或重型投送让出一格机动。
  return (unit.speedTier ?? BODY[body].movement) - Number(body === 'vehicle' && ((unit.armor?.tier ?? 0) >= 3 || [unit.weapon, unit.sidearm].some((w) => (w?.load ?? 0) >= 6)));
}
export function effectiveProtection(unit: Combatant, channel: DamageChannel): number {
  return Math.max(bodyProtection(unit, channel), unit.armor?.protection?.[channel] ?? unit.armor?.tier ?? 0);
}
