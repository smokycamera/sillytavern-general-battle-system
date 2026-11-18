import type { Combatant } from '../types.js';
import { clampShieldDurability, clampEnergyShield } from '../shield-state.js';
import { mergeHealth } from '../member-health.js';

// Seat numbers are zero-based. A vehicle owns a contiguous block of seats.
// Ranges keep large formations compact and preserve holes when another squad disembarks.
export type SeatRange = [start: number, count: number];
export function takeSeats(ranges: readonly SeatRange[], count: number): SeatRange[] {
  const result: SeatRange[] = [];
  for (const [start,length] of ranges) {
    const n = Math.min(count,length);
    if (n > 0) result.push([start,n]);
    count -= n;
  }
  return result;
}
export function availableSeats(occupied: SeatRange[], capacity: number): SeatRange[] {
  const free: SeatRange[] = [];
  let cursor = 0;
  for (const [start,count] of occupied.sort((a,b) => a[0]-b[0])) {
    if (start > cursor) free.push([cursor,Math.min(start,capacity)-cursor]);
    cursor = Math.max(cursor,start+count);
    if (cursor >= capacity) break;
  }
  if (cursor < capacity) free.push([cursor,capacity-cursor]);
  return free.filter(([,n]) => n > 0);
}

/** Move living members and their actual wounds. Missing members and recoverable casualties stay with the parent. */
export function detachMembers(parent: Combatant, count: number, id: string): Combatant {
  if (parent.scale === 'hero' || !Number.isSafeInteger(count) || count < 1 || count >= parent.hp) throw Error('分队人数无效');
  const child = structuredClone(parent), pf = parent.formation, cf = child.formation;
  if (pf?.health && cf) {
    let remaining = count;
    const moved = [], kept = [];
    for (const group of pf.health) {
      const n = Math.min(remaining,group.count);
      if (n) moved.push({hp:group.hp,count:n});
      if (group.count > n) kept.push({hp:group.hp,count:group.count-n});
      remaining -= n;
    }
    pf.health = kept; cf.health = moved;
  }
  parent.hp -= count; parent.base.hpMax -= count;
  if (pf) { pf.members = parent.hp; pf.capacity -= count; }
  child.id = id; child.transportOrigin = parent.transportOrigin ?? parent.id;
  child.name = parent.name.replace(/分队\d+$/,'') + '分队' + id.slice(id.lastIndexOf(':')+1); child.hp = child.base.hpMax = count;
  if (cf) { cf.members = cf.capacity = count; cf.woundedRemainder = 0; }
  child.recoverableWounded = child.woundedPercentRemainder = 0;
  // Personal equipment profiles represent issued kit; unique items, barriers and limited abilities remain with the original card.
  child.abilities = []; child.abilityState = []; child.preparedAbilityIds = []; child.resources = {};
  child.gear = []; delete child.carriedItems; delete child.accessories;
  clampShieldDurability(parent); clampEnergyShield(parent);
  if (parent.revivalState) {
    parent.revivalState.members = Math.min(parent.revivalState.members,parent.base.hpMax);
    child.revivalState = {members:0,used:0};
  }
  // A limited-area condition follows only as many members as it originally affected.
  parent.conditions.forEach((condition,i) => {
    if (condition.affectedMembers === undefined) return;
    const moved = Math.min(count,Math.max(0,condition.affectedMembers-parent.hp));
    child.conditions[i]!.affectedMembers = moved; condition.affectedMembers -= moved;
  });
  child.conditions = child.conditions.filter(c => c.affectedMembers !== 0);
  delete child.barrier; delete child.energyShield; delete child.shield;
  delete child.shieldDurability;
  child.engagedWith = [];
  delete child.ride; child.mount = false;
  return child;
}

/** Settlement projection only. The original battle and its report retain the positions of all detachments. */
export function reuniteTransportGroups(units: Combatant[]): Combatant[] {
  if (!units.some(u => u.transportOrigin)) return units;
  const parents = units.filter(u => !u.transportOrigin).map(u => structuredClone(u));
  const byId = new Map(parents.map(u => [u.id,u]));
  for (const child of units) if (child.transportOrigin) {
    const root = byId.get(child.transportOrigin);
    if (!root || !!root.formation !== !!child.formation) throw Error('缺少分队所属档案');
    const wasEmpty = root.hp === 0;
    if (child.hp > 0 && !wasEmpty && (root.ride?.platformId !== child.ride?.platformId || root.ride?.mode !== child.ride?.mode)) {
      delete root.ride; root.mount = false;
    } else if (child.hp > 0 && wasEmpty) { root.ride = child.ride && {...child.ride}; root.mount = child.mount; }
    root.hp += child.hp; root.base.hpMax += child.base.hpMax;
    if (root.formation && child.formation) {
      root.formation.capacity = root.base.hpMax; root.formation.members = root.hp;
      if (root.formation.health && child.formation.health) root.formation.health = mergeHealth([...root.formation.health,...child.formation.health]);
    }
    root.recoverableWounded = (root.recoverableWounded ?? 0) + (child.recoverableWounded ?? 0);
    if (child.hp > 0 && (wasEmpty || child.status === 'ready')) root.status = child.status;
  }
  for (const unit of parents) if (unit.ride) unit.ride = {platformId:unit.ride.platformId,mode:unit.ride.mode};
  return parents;
}
