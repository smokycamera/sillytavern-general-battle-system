import type { Combatant, EquipmentBatch, Weapon } from './types.js';

type Bearer = Pick<Combatant,'equipmentBatches'|'equipmentPersonnel'|'scale'|'hp'|'body'|'recoverableWounded'>;
const members = (unit: Bearer) => unit.scale === 'hero' ? Number(unit.hp > 0) : unit.hp;
export function crewEquipment(unit: Bearer, batch: EquipmentBatch): boolean {
  return unit.body !== 'vehicle' && batch.mechanics.kind === 'weapon' && ['autocannon','cannon','indirect-cannon'].includes(batch.mechanics.value.recipe?.mechanism ?? '');
}
/** Consecutive copies fill a rank before issuing the next copy to a member. */
export function issuedTo(qty: number, start: number, members: number, rank: number): number {
  if (!rank || !members) return 0;
  const end = start + qty % rank;
  return Math.floor(qty / rank) * members + Math.max(0,Math.min(members,end)-start) + Math.min(members,Math.max(0,end-rank));
}
function rankOffset(unit: Bearer,batch: EquipmentBatch,rank: number): number {
  if (batch.slot === 'gear') return 0;
  let offset = 0;
  for (const other of unit.equipmentBatches ?? []) {
    if (other.id === batch.id) break;
    if (other.slot === batch.slot && !crewEquipment(unit,other)) offset = (offset + other.qty) % rank;
  }
  return offset;
}
export function batchCount(unit: Bearer,batch: EquipmentBatch,retained = false): number {
  const people = members(unit);
  const survivors = people + (unit.scale === 'hero' ? 0 : unit.recoverableWounded ?? 0);
  const rank = Math.max(1,unit.equipmentPersonnel ?? people,survivors);
  if (crewEquipment(unit,batch)) return retained ? (survivors || unit.scale === 'hero' ? batch.qty : 0) : Math.min(people,batch.qty);
  if ((retained ? survivors : people) === rank) return batch.qty;
  return issuedTo(batch.qty,rankOffset(unit,batch,rank),Math.min(rank,retained ? survivors : people),rank);
}
export function readyCopies(unit: Bearer,batch: EquipmentBatch): number {
  const busy = batch.reloading?.reduce((total,row)=>total+row.count,0) ?? 0;
  const held = crewEquipment(unit,batch) ? batch.qty : batchCount(unit,batch);
  return Math.max(0,held-busy);
}
export function availableCopies(unit: Bearer,id: string | undefined): number {
  const batch = unit.equipmentBatches?.find(b=>b.id===id);
  return batch ? Math.min(members(unit),readyCopies(unit,batch)) : Infinity;
}
/** Remove personal kit only for deaths that cannot be recovered. */
export function loseIssuedEquipment(unit: Combatant,dead: number,start: number): void {
  if (!dead || unit.scale==='hero' || !unit.equipmentBatches?.length) return;
  const survivors = unit.hp+(unit.recoverableWounded ?? 0);
  const rank = Math.max(1,survivors,unit.equipmentPersonnel ?? 0);
  const from = Math.min(start,Math.max(0,unit.hp-dead));
  const amounts = unit.equipmentBatches.map(b=>{
    const kept = batchCount(unit,b,true);
    if (crewEquipment(unit,b)) return kept;
    const offset = rankOffset(unit,b,rank);
    return kept-issuedTo(b.qty,offset,from+dead,rank)+issuedTo(b.qty,offset,from,rank);
  });
  for (const [i,b] of unit.equipmentBatches.entries()) {
    b.qty=Math.max(0,amounts[i]!);
    let left=b.qty;
    for (const timer of b.reloading ?? []) { timer.count=Math.min(timer.count,left); left-=timer.count; }
  }
  unit.equipmentPersonnel=survivors-dead;
}
export function batchWeapons(unit: Pick<Combatant,'weapon'|'sidearm'|'equipmentBatches'>): Weapon[] {
  const weapons = new Map<string,Weapon>();
  for (const weapon of [unit.weapon,unit.sidearm]) if (weapon) weapons.set(weapon.id,weapon);
  for (const b of unit.equipmentBatches ?? []) if (b.mechanics.kind === 'weapon' && !weapons.has(b.id)) weapons.set(b.id,b.mechanics.value);
  return [...weapons.values()];
}
export function startBatchReload(unit: Combatant,weapon: Weapon|undefined,count: number,turns: number): boolean {
  const batch = unit.equipmentBatches?.find(b => b.id === weapon?.id);
  if (!batch) return false;
  const used = Math.min(availableCopies(unit,batch.id),Math.ceil(count));
  if (used > 0) {
    const rows = batch.reloading ??= [], row = rows.find(r => r.turns === turns);
    if (row) row.count += used; else rows.push({turns,count:used});
  }
  return true;
}
export function advanceBatchReload(batch: EquipmentBatch): void {
  if (batch.reloading) batch.reloading = batch.reloading.filter(r => --r.turns > 0);
}
export function splitBatchEquipment(parent: Combatant,child: Combatant,count: number): void {
  if (!parent.equipmentBatches || !child.equipmentBatches) return;
  const people = members(parent), survivors = people+(parent.recoverableWounded ?? 0);
  const shares = parent.equipmentBatches.map(b => ({
    retained:batchCount(parent,b,true),
    moved:crewEquipment(parent,b) ? 0 : batchCount(parent,b)-batchCount({...parent,hp:people-count},b)
  }));
  for (const [i,b] of parent.equipmentBatches.entries()) {
    const part = child.equipmentBatches[i]!, {retained,moved} = shares[i]!;
    b.qty = retained-moved; part.qty = moved;
    for (const [j,row] of (b.reloading ?? []).entries()) {
      const used = Math.min(moved,Math.floor(row.count*moved/Math.max(1,retained)));
      part.reloading![j]!.count = used; row.count -= used;
    }
  }
  parent.equipmentPersonnel=survivors-count; child.equipmentPersonnel=count;
}
export function mergeBatchEquipment(unit: Combatant,other: Combatant): void {
  if (!unit.equipmentBatches || !other.equipmentBatches) return;
  const retained = unit.equipmentBatches.map(b => batchCount(unit,b,true));
  for (const [i,b] of unit.equipmentBatches.entries()) b.qty = retained[i]!;
  for (const b of other.equipmentBatches) {
    const qty = batchCount(other,b,true), row = unit.equipmentBatches.find(item => item.id === b.id);
    if (!row) unit.equipmentBatches.push({...structuredClone(b),qty});
    else { row.qty += qty; for (const r of b.reloading ?? []) {
      const timers = row.reloading ??= [], match = timers.find(t => t.turns === r.turns);
      if (match) match.count += r.count; else timers.push({...r});
    } }
  }
  unit.equipmentPersonnel = members(unit)+members(other)+(unit.recoverableWounded ?? 0)+(other.recoverableWounded ?? 0);
}
export type WeaponMode = 'primary'|'sidearm'|`batch:${string}`;
export function weaponModeFor(unit: Combatant,weapon?: Weapon): WeaponMode {
  return !weapon || weapon.id === unit.weapon?.id ? 'primary' : weapon.id === unit.sidearm?.id ? 'sidearm' : ('batch:'+weapon.id) as WeaponMode;
}
export function optionWeaponMode(id: string): WeaponMode {
  return id.startsWith('batch:') ? id as WeaponMode : id === 'weapon:sidearm' ? 'sidearm' : 'primary';
}
export function weaponForMode(unit: Combatant,mode: WeaponMode): Weapon | undefined {
  if (mode === 'primary') return unit.weapon;
  if (mode === 'sidearm') return unit.sidearm;
  const batch = unit.equipmentBatches?.find(b=>b.id===mode.slice(6));
  return batch?.mechanics.kind === 'weapon' ? batch.mechanics.value : undefined;
}
/** Freeze the surviving loadout once when a battle is archived. */
export function settleBatches(unit: Combatant): Map<string,number> {
  const totals = new Map<string,number>();
  for (const b of unit.equipmentBatches ?? []) {
    totals.set(b.id,b.shieldDurability?.remaining===0 || unit.status === 'dead' && !(unit.recoverableWounded ?? 0) ? 0 :
      unit.scale === 'hero' && unit.status === 'dying' ? b.qty : batchCount(unit,b,true));
  }
  for (const b of unit.equipmentBatches ?? []) {
    b.qty = totals.get(b.id)!;
    delete b.reloading; delete b.shieldDurability; delete b.energyShield;
    if (b.qty) continue;
    if (unit.weapon?.id===b.id) delete unit.weapon;
    if (unit.sidearm?.id===b.id) delete unit.sidearm;
    if (unit.armor?.id===b.id) delete unit.armor;
    if (unit.shield?.id===b.id) delete unit.shield;
    if (unit.gear) unit.gear=unit.gear.filter(g=>g.id!==b.id);
  }
  if (unit.equipmentBatches) {
    unit.equipmentBatches=unit.equipmentBatches.filter(b=>b.qty>0);
    unit.equipmentPersonnel=unit.scale==='hero'?1:unit.hp+(unit.recoverableWounded??0);
  }
  return totals;
}

/** Intersect worn ranges only at an actual change of equipment, never per soldier. */
export function protectionGroups(unit: Combatant, includeWeapons = false) {
  const people = members(unit);
  if (!unit.equipmentBatches?.length || !people) return [];
  const rank = Math.max(1,people,unit.equipmentPersonnel ?? 0);
  const batches = unit.equipmentBatches.filter(b=>b.slot==='armor' || b.slot==='shield' || b.slot==='gear');
  if (!batches.length && !includeWeapons) return [];
  if (unit.shield || includeWeapons) batches.push(...unit.equipmentBatches.filter(b=>b.slot==='primary' && !crewEquipment(unit,b)));
  const cuts = new Set([0,people]);
  const ranges = batches.map(b => {
    const start = rankOffset(unit,b,rank);
    const length = Math.min(rank,b.qty);
    for (const edge of [start,(start+length)%rank]) if (edge>0 && edge<people) cuts.add(edge);
    return {b,start,length};
  });
  const limits = [...cuts].sort((a,b)=>a-b);
  return limits.slice(0,-1).map((start,i)=>{
    const worn = ranges.filter(r=>(start-r.start+rank)%rank<r.length).map(r=>r.b);
    const armor = worn.find(b=>b.mechanics.kind==='armor')?.mechanics;
    const shield = worn.find(b=>b.mechanics.kind==='shield')?.mechanics;
    const weapon = worn.find(b=>b.slot==='primary')?.mechanics;
    return { start,size:limits[i+1]!-start,
      weapon:weapon?.kind==='weapon'?weapon.value:batches.some(b=>b.slot==='primary')?undefined:unit.weapon,
      armor:armor?.kind==='armor'?armor.value:batches.some(b=>b.slot==='armor')?undefined:unit.armor,
      shield:shield?.kind==='shield'?shield.value:batches.some(b=>b.slot==='shield')?undefined:unit.shield,
      gear:unit.gear?.filter(g=>!batches.some(b=>b.id===g.id) || worn.some(b=>b.id===g.id)) };
  });
}
