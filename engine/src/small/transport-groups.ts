import { syncGearAbilities } from '../items.js';
import { abilityUsageKey } from '../ability-state.js';
import { splitBatchEquipment, mergeBatchEquipment } from '../equipment-batches.js';
import { unitCount } from '../platforms.js';
import type { Combatant } from '../types.js';
import { clampShieldDurability, clampEnergyShield } from '../shield-state.js';
import { mergeWounded } from '../recovery.js';
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
  if (parent.xpValue !== undefined) {
    child.xpValue = Math.floor(parent.xpValue * count / parent.base.hpMax);
    parent.xpValue -= child.xpValue;
  }
  if (parent.lifestealState && child.lifestealState) {
    for (const key of ['baseline','spent'] as const) {
      const share = Math.floor(parent.lifestealState[key] * count / parent.hp);
      child.lifestealState[key] = share; parent.lifestealState[key] -= share;
    }
    child.lifestealState.remainder = 0;
  }
  child.regenerationRemainder = 0; delete child.battleZones;
  delete child.reserveEquipmentLoad;
  splitBatchEquipment(parent,child,count);
  parent.hp -= count; parent.base.hpMax -= count;
  if (pf) { pf.members = parent.hp; pf.capacity -= count; }
  child.id = id; child.transportOrigin = parent.transportOrigin ?? parent.id;
  child.name = parent.name.replace(/分队\d+$/,'') + '分队' + id.slice(id.lastIndexOf(':')+1); child.hp = child.base.hpMax = count;
  if (cf) { cf.members = cf.capacity = count; cf.woundedRemainder = 0; }
  child.recoverableWounded = child.woundedPercentRemainder = 0;
  if (child.equipmentBatches) {
    const share=count/(parent.hp+count);
    child.abilities=child.abilities.filter(a=>!a.itemSourceId && (a.usesPerBattle===undefined || a.equipmentSourceId));
    child.gear=child.gear?.filter(g=>child.equipmentBatches!.some(b=>b.id===g.id && b.qty>0));
    for (const key of Object.keys(child.resources)) {
      if (key!=='SP') { delete child.resources[key]; continue; }
      child.resources[key]=Math.floor(child.resources[key]!*share*100)/100;
      parent.resources[key]!-=child.resources[key]!;
    }
    for (const a of child.abilities.filter(a=>a.equipmentSourceId)) {
      const state=child.abilityState.find(row=>row.abilityId===abilityUsageKey(a));
      const original=parent.abilityState.find(row=>row.abilityId===abilityUsageKey(a));
      const moved=child.equipmentBatches.find(b=>b.id===a.equipmentSourceId)?.qty ?? 0;
      const kept=parent.equipmentBatches?.find(b=>b.id===a.equipmentSourceId)?.qty ?? 0;
      if (state && original) { state.used=Math.floor(original.used*moved/Math.max(1,moved+kept)); original.used-=state.used; }
    }
    child.preparedAbilityIds=child.preparedAbilityIds?.filter(id=>child.abilities.some(a=>a.id===id));
    delete child.accessories;
    syncGearAbilities(child);
  } else {
    child.abilities=[]; child.abilityState=[]; child.preparedAbilityIds=[]; child.resources={};
    child.gear=[]; delete child.accessories;
  }
  delete child.carriedItems;

  if (parent.revivalState) {
    const retained = Math.min(parent.revivalState.members,parent.base.hpMax);
    child.revivalState = {members:parent.revivalState.members-retained,used:0};
    parent.revivalState.members = retained;
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
  const splitShield=child.equipmentBatches?.find(b=>b.slot==='shield' && b.qty>0);
  if (splitShield?.mechanics.kind==='shield') {
    child.shield=splitShield.mechanics.value;
    const kept=parent.equipmentBatches?.find(b=>b.id===splitShield.id)?.qty ?? 0;
    const share=splitShield.qty/(splitShield.qty+kept);
    if (parent.shieldDurability) {
      const moved=parent.shieldDurability.remaining*share;
      child.shieldDurability={remaining:moved}; parent.shieldDurability.remaining-=moved;
    }
    if (parent.energyShield) {
      const remaining=parent.energyShield.remaining*share,overloaded=Math.floor(parent.energyShield.overloaded*share);
      child.energyShield={remaining,overloaded}; parent.energyShield.remaining-=remaining; parent.energyShield.overloaded-=overloaded;
    }
  }
  clampShieldDurability(parent); clampEnergyShield(parent);
  child.engagedWith = [];
  delete child.ride; child.mount = false;
  return child;
}

/** Plan on copies so map previews and failed deployments never divide an archive card. */
export function planTransportDeployment(units: readonly Combatant[]) {
  const deployed = [...units], remaining = new Map<string,number>();
  const overflow: {rider: Combatant; foot: Combatant; carrierId: string}[] = [];
  for (const u of units) if (u.platform) remaining.set(u.id,unitCount(u) * (u.seats ?? 1));
  const ids = new Set(units.map(u => u.id));
  // Reserve seats for the controlling card first, then other passengers in roster order.
  for (const mode of ['mount','aboard'] as const) {
    for (const [index,u] of units.entries()) {
      if (u.ride?.mode !== mode || u.hp <= 0) continue;
      const carrierId = u.ride.platformId, free = remaining.get(carrierId);
      if (free === undefined) continue; // Missing carriers are reported by ride validation.
      const count = unitCount(u), seated = Math.min(count,free);
      remaining.set(carrierId,free-seated);
      if (count === seated) continue;
      const rider = structuredClone(u);
      deployed[index] = rider;
      let foot = rider;
      if (seated) {
        let n = 1;
        while (ids.has(u.id+':part:'+n)) n++;
        foot = detachMembers(rider,count-seated,u.id+':part:'+n);
        ids.add(foot.id); deployed.push(foot);
      }
      delete foot.ride; foot.mount = false;
      delete foot.pos; delete foot.elevation; delete foot.airborne;
      overflow.push({rider,foot,carrierId});
    }
  }
  return {deployed,overflow};
}

/** Combine the member health ledger without healing or generating a casualty event. */
export function combinePersonnel(root: Combatant, child: Combatant): void {
  mergeBatchEquipment(root,child);
  root.hp += child.hp;
  root.base.hpMax += child.base.hpMax;
  if (root.formation && child.formation) {
    root.formation.capacity = root.base.hpMax;
    root.formation.members = root.hp;
    if (root.formation.health && child.formation.health) root.formation.health = mergeHealth([...root.formation.health,...child.formation.health]);
  }
  mergeWounded(root,child);
  if (child.equipmentBatches) {
    if (child.resources.SP) root.resources.SP=(root.resources.SP ?? 0)+child.resources.SP;
    for (const a of child.abilities.filter(a=>a.equipmentSourceId)) {
      const used=child.abilityState.find(row=>row.abilityId===abilityUsageKey(a));
      const original=root.abilityState.find(row=>row.abilityId===abilityUsageKey(a));
      if (used && original) original.used+=used.used;
    }
    if (child.shieldDurability && root.shieldDurability) root.shieldDurability.remaining+=child.shieldDurability.remaining;
    if (child.energyShield && root.energyShield) {
      root.energyShield.remaining+=child.energyShield.remaining; root.energyShield.overloaded+=child.energyShield.overloaded;
    }
  }
  if (root.revivalState && child.revivalState) root.revivalState.members += child.revivalState.members;
  if (child.xpValue !== undefined) root.xpValue = (root.xpValue ?? 0) + child.xpValue;
  if (root.lifestealState && child.lifestealState) {
    root.lifestealState.baseline += child.lifestealState.baseline;
    root.lifestealState.spent += child.lifestealState.spent;
  }
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
    combinePersonnel(root,child);
    if (child.hp > 0 && (wasEmpty || child.status === 'ready')) root.status = child.status;
  }
  for (const unit of parents) if (unit.ride) unit.ride = {platformId:unit.ride.platformId,mode:unit.ride.mode};
  return parents;
}
