import { createInventoryItem, moveCopies, type InventoryItem } from './inventory-state.js';
import { sameGear } from './unit-set.js';
import type { BodyKind } from '../../engine/src/types.js';
import type { EquipmentSlot, ItemSpecification } from '../../engine/src/items.js';
import { parseItemSpecification, splitItemSpecification } from './item-spec.js';

export interface EquipmentIssue { name: string; text: string; qty: number; spec: ItemSpecification }
export const equipmentFields = { weapon: 'primary', weapon2: 'sidearm', sidearm: 'sidearm', armor: 'armor', shield: 'shield' } as const;
export function parseIssue(text: unknown, slot: EquipmentSlot, attrs: Record<string, unknown> = {}): EquipmentIssue[] | undefined {
  if (typeof text !== 'string') return;
  const parts = text.split(/[,，、;；]/);
  // Plain inventory references, boolean shield flags and old forms are handled by their original readers.
  if (parts.length === 1 && !text.includes('×') && !/[lL]\d/.test(text)) return;
  const kind = slot === 'primary' || slot === 'sidearm' ? 'weapon' : slot;
  return parts.map(part => {
    const [description, count, ...extra] = part.trim().split('×');
    const item = description!.trim(), qty = count === undefined ? 1 : Number(count.trim());
    if (!item || extra.length || count !== undefined && !/^[1-9]\d*$/.test(count.trim()) || !Number.isSafeInteger(qty))
      throw Error('「' + part.trim() + '」的装备件数须为正整数');
    const config: Record<string,string> = {};
    for (const field of ['body','quality',...(kind === 'weapon' ? ['enchant','stabilized'] : kind === 'armor' ? ['protection'] : [])]) {
      if (attrs[field] !== undefined) config[field] = String(attrs[field]);
    }
    const spec = parseItemSpecification(item,config);
    if (spec.kind !== kind) throw Error('配装规格与装备栏不符');
    return { name:splitItemSpecification(item).name ?? item, text:item, qty, spec };
  });
}

/** Check the entire slot before unequipping. Hidden loot is only used for the remaining deficit. */
export function planEquipmentIssue(inventory: InventoryItem[], unitId: string, slot: EquipmentSlot,
  entries: EquipmentIssue[], includesSidearm: boolean, fallen: readonly InventoryItem[], stockOnly: ReadonlySet<EquipmentIssue>) {
  const known = new Set(inventory.map(item => item.id));
  const loot = fallen.filter(item => !known.has(item.id));
  const sources = [...inventory, ...loot];
  const available = new Map(sources.map(item => [item.id, item.qty]));
  const claimed = new Map<InventoryItem, number>();
  const hidden = new Set(loot);
  let shortage: string | undefined;
  for (const entry of entries) {
    let needed = entry.qty;
    for (const item of sources) {
      if (needed === 0) break;
      if (item.name !== entry.name) continue;
      if (item.assignedTo && item.assignedTo !== unitId || item.equippedTo && item.equippedTo.slot !== slot
        && !(includesSidearm && item.equippedTo.slot === 'sidearm') || !sameGear(item.mechanics,entry.spec)) continue;
      const left = available.get(item.id)!, used = Math.min(needed,left);
      available.set(item.id,left-used); needed -= used;
      if (used && hidden.has(item)) claimed.set(item, (claimed.get(item) ?? 0) + used);
    }
    if (needed && stockOnly.has(entry) && !shortage) shortage = '「'+entry.name+'」需要'+entry.qty+'件，本队、公共库存和战利品库合计可用'+(entry.qty-needed)+'件';
  }
  return { shortage, claimed };
}

/** Keep the original roll when a batch is reissued, including partial transfers. */
export function assignIssue(inventory: InventoryItem[], unitId: string, side: string, slot: EquipmentSlot,
  entries: EquipmentIssue[], source: string, allowStash = true, defaultBody?: BodyKind, stockOnly?: ReadonlySet<EquipmentIssue>): void {
  const previous = inventory.filter(i => i.equippedTo?.unitId === unitId && i.equippedTo.slot === slot);
  for (const item of previous) delete item.equippedTo;
  const candidates = [...previous,...inventory.filter(i => !previous.includes(i) && !i.equippedTo &&
    (i.assignedTo === unitId || allowStash && side === 'ally' && !i.assignedTo))];
  const issuedOrder: InventoryItem[] = [];
  for (const [index,entry] of entries.entries()) {
    let needed = entry.qty;
    let issued: InventoryItem | undefined;
    for (const item of candidates) {
      if (!needed) break;
      if (item.equippedTo || item.qty <= 0 || item.name !== entry.name || !sameGear(item.mechanics,entry.spec)) continue;
      const moved = Math.min(needed,item.qty);
      const equipped = moveCopies(inventory,item,moved,unitId,slot,source+':'+slot+':'+index+':'+item.id);
      if (!issuedOrder.includes(equipped)) issuedOrder.push(equipped);
      issued = equipped;
      equipped.batch = true; equipped.assignedTo = unitId;
      equipped.equippedTo = {unitId,slot}; needed -= moved;
    }
    if (needed && stockOnly?.has(entry)) throw Error('「'+entry.name+'」的可配发数量不足，请核对实物');
    if (needed && issued) issued.qty += needed;
    else if (needed) {
      const id = source+':'+unitId+':'+slot+':'+index;
      const spec = defaultBody && entry.spec.kind !== 'item' ? {...entry.spec,body:entry.spec.body ?? defaultBody} : entry.spec;
      const item = createInventoryItem(id,entry.name,spec,source+':'+entry.name+':'+JSON.stringify(entry.spec),needed);
      item.batch = true; item.assignedTo = unitId; item.equippedTo = {unitId,slot};
      inventory.push(item); issuedOrder.push(item);
    }
  }
  // Match the declared issue order without changing inventory identities.
  const selected=new Set(issuedOrder);
  let index=0;
  for (let i=0;i<inventory.length;i++) if (selected.has(inventory[i]!)) inventory[i]=issuedOrder[index++]!;
}
