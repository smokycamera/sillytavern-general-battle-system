import { createInventoryItem, moveCopies, type InventoryItem } from './inventory-state.js';
import { sameGear } from './unit-set.js';
import type { BodyKind } from '../../engine/src/types.js';
import type { EquipmentSlot, ItemSpecification } from '../../engine/src/items.js';
import { parseItemSpecification, splitItemSpecification } from './item-spec.js';

export interface EquipmentIssue { name: string; unnamed?: boolean; text: string; qty: number; spec: ItemSpecification }
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
    const name = splitItemSpecification(item).name;
    return { name: name ?? item, unnamed: name === undefined, text:item, qty, spec };
  });
}

interface IssueOptions {
  allowStash?: boolean;
  defaultBody?: BodyKind;
  includeSidearm?: boolean;
  fallen?: readonly InventoryItem[];
  claim?: (item: InventoryItem, qty: number, index: number) => InventoryItem;
  stockOnly?: ReadonlySet<EquipmentIssue>;
  matchName?: (item: InventoryItem, entry: EquipmentIssue) => boolean;
}

/** Reserve specific copies before changing any holding. Keep the declared slot order when issuing them. */
export function assignIssue(inventory: InventoryItem[], unitId: string, side: string, slot: EquipmentSlot,
  entries: EquipmentIssue[], source: string, options: IssueOptions = {}): string | undefined {
  const previous = new Set(inventory.filter(item => item.equippedTo?.unitId === unitId
    && (item.equippedTo.slot === slot || options.includeSidearm && item.equippedTo.slot === 'sidearm')));
  const publicStock = options.allowStash !== false && side === 'ally';
  const known = new Set(inventory.map(item => item.id));
  const fallen = new Set(options.fallen?.filter(item => !known.has(item.id)));
  const candidates = [...previous, ...inventory.filter(item => !item.equippedTo
    && (item.assignedTo === unitId || publicStock && !item.assignedTo)), ...fallen].filter(item => item.qty > 0);
  const available = new Map(candidates.map(item => [item, item.qty]));
  const matchName = options.matchName ?? ((item, entry) => item.name === entry.name);
  const rows = entries.map(entry => ({
    entry,
    candidates: candidates.filter(item => matchName(item, entry) && sameGear(item.mechanics, entry.spec)),
    parts: new Map<InventoryItem, number>(),
    missing: entry.qty,
  }));
  type IssueRow = typeof rows[number];
  const reserve = (row: IssueRow, item: InventoryItem, qty: number) => {
    const total = (row.parts.get(item) ?? 0) + qty;
    if (total) row.parts.set(item, total);
    else row.parts.delete(item);
    available.set(item, available.get(item)! - qty);
  };
  // A looser row can have reserved a batch that a later row needs. Relocate its reservation
  // to another eligible batch before reporting a shortage. Each step moves a quantity, not one copy.
  const reallocate = (row: IssueRow, needed: number, visited: Set<InventoryItem>): number => {
    for (const item of row.candidates) {
      if (visited.has(item)) continue;
      visited.add(item);
      const free = Math.min(needed, available.get(item)!);
      if (free) { reserve(row, item, free); return free; }
      for (const owner of rows) {
        if (owner === row) continue;
        const held = owner.parts.get(item);
        if (!held) continue;
        const moved = reallocate(owner, Math.min(needed, held), visited);
        if (!moved) continue;
        reserve(owner, item, -moved);
        reserve(row, item, moved);
        return moved;
      }
    }
    return 0;
  };
  const ordered = [...rows].sort((a, b) => Number(!!options.stockOnly?.has(b.entry)) - Number(!!options.stockOnly?.has(a.entry))
    || a.candidates.length - b.candidates.length);
  for (const row of ordered) {
    for (const item of row.candidates) {
      if (!row.missing) break;
      const qty = Math.min(row.missing, available.get(item)!);
      if (qty) reserve(row, item, qty);
      row.missing -= qty;
    }
    while (row.missing) {
      const moved = reallocate(row, row.missing, new Set());
      if (!moved) break;
      row.missing -= moved;
    }
  }
  const short = rows.find(row => row.missing && options.stockOnly?.has(row.entry));
  if (short) {
    const { entry, missing } = short;
    return '「'+entry.name+'」需要'+entry.qty+'件，本队、公共库存和战利品库合计可用'+(entry.qty-missing)+'件';
  }

  for (const item of previous) delete item.equippedTo;
  const issuedOrder = new Set<InventoryItem>();
  for (const [index, { entry, parts, missing }] of rows.entries()) {
    let issued: InventoryItem | undefined;
    for (const item of candidates) {
      const qty = parts.get(item);
      if (!qty) continue;
      const batch = fallen.has(item) ? options.claim!(item, qty, index) : item;
      issued = moveCopies(inventory,batch,qty,unitId,slot,source+':'+slot+':'+index+':'+batch.id);
      issuedOrder.add(issued);
      issued.batch = true; issued.assignedTo = unitId;
      issued.equippedTo = {unitId,slot};
    }
    if (missing && issued) issued.qty += missing;
    else if (missing) {
      const id = source+':'+unitId+':'+slot+':'+index;
      const spec = options.defaultBody && entry.spec.kind !== 'item' ? {...entry.spec,body:entry.spec.body ?? options.defaultBody} : entry.spec;
      const item = createInventoryItem(id,entry.name,spec,source+':'+entry.name+':'+JSON.stringify(entry.spec),missing);
      item.batch = true; item.assignedTo = unitId; item.equippedTo = {unitId,slot};
      inventory.push(item); issuedOrder.add(item);
    }
  }
  const selected = issuedOrder.values();
  for (let i=0;i<inventory.length;i++) if (issuedOrder.has(inventory[i]!)) inventory[i]=selected.next().value!;
}
