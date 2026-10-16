import { validateInstanceVariance } from '../../engine/src/instance-variance.js';
import { validateEnhancements, type Enhancements } from '../../engine/src/enhancements.js';
import { calibrateAutocannon, calibrateWeaponHands } from '../../engine/src/gen/equipment.js';
import {hasMemberHealth} from '../../engine/src/member-health.js';
import {applyRecovery} from '../../engine/src/recovery.js';
import { syncGearAbilities, gearItem, validateItemValue, migrateLegacyItem, isLegacyItemMechanics, type LegacyItemMechanics } from '../../engine/src/items.js';
import { skillResourceChange } from '../../engine/src/skill-runtime.js';
import { applyDispel, dispelCandidates } from '../../engine/src/skill-effects.js';
/** 库存实物为装备权威；UnitRecord.snapshot 中的装备是供战斗使用的冻结投影。 */
import { calibrateWeaponRange, compileItem, equipmentReason, healingAmount, traitRegistry, parseDice,
  type Combatant, type EquipmentSlot, type ItemMechanics, type ItemSpecification } from '../../engine/src/index.js';
import { unitRecordFromCombatant, updateUnitRecord, type UnitRecord } from './unit-state.js';
import { prepareNarrativeIds, type NarrativeIdState } from './narrative-ids.js';

export interface InventoryItem {
  id: string; name: string; qty: number; lootType: string; note?: string; assignedTo?: string;
  mechanics?: ItemMechanics;
  equippedTo?: { unitId: string; slot: EquipmentSlot };
  sourceItemId?: string;
  revision?: number;
  history?: { revision: number; name: string; mechanics: ItemMechanics; sourceId: string }[];
}
export interface InventorySave {
  schemaVersion?: number; storage?: UnitRecord[]; rosterIds?: string[]; inventory?: InventoryItem[]; factRevision?: number;
  narrativeIdState?: NarrativeIdState;
  inventoryOperations?: { id: string; fingerprint: string }[];
  battle?: { kind: 'small' | 'mass'; snap: Record<string, unknown> } | null;
  committedOutcomeIds?: string[];
  [key: string]: unknown;
}
export type InventoryAction =
  | { kind: 'create'; itemId: string; name: string; spec: ItemSpecification; qty?: number }
  | { kind: 'reforge'; itemId: string; name?: string; spec: ItemSpecification }
  | { kind: 'define'; itemId: string; spec: ItemSpecification }
  | { kind: 'discard'; itemId: string; qty: number }
  | { kind: 'discard-many'; items: { itemId: string; qty: number }[] }
  | { kind: 'assign'; itemId: string; unitId?: string }
  | { kind: 'equip'; itemId: string; unitId: string; slot: EquipmentSlot }
  /** 佩戴与充能道具不限件数，卸下时用 itemId 指明哪一件。 */
  | { kind: 'unequip'; unitId: string; slot: EquipmentSlot; itemId?: string }
  | { kind: 'use'; itemId: string; unitId: string }
  /** 收缴：阵亡、撤离或解散的敌方单位身上剩余的道具转入公共库存。 */
  | { kind: 'collect'; unitId: string };
export type InventoryIntent = InventoryAction & { id: string; expectedRevision: number };
const slots: EquipmentSlot[] = ['primary', 'sidearm', 'armor', 'shield', 'gear'];
/** 每个单位各只有一件的装备位；gear 不限件数。 */
const uniqueSlots: EquipmentSlot[] = ['primary', 'sidearm', 'armor', 'shield'];
const clone = <T>(value: T): T => structuredClone(value);
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** 旧版药剂与护符（V15 之前）一次性换成新道具：效果按对照表、等级与名称不变，装在配件栏的改为已佩戴。幂等。 */
export function migrateLegacyInventory(items: InventoryItem[] | undefined): InventoryItem[] | undefined {
  if (!items?.some((item) => isLegacyItemMechanics(item.mechanics as { kind?: unknown } | undefined) || ['accessory1', 'accessory2'].includes(String(item.equippedTo?.slot))
    || item.history?.some((h) => isLegacyItemMechanics(h.mechanics as { kind?: unknown } | undefined)))) return items;
  return items.map((source) => {
    const item = clone(source);
    if (isLegacyItemMechanics(item.mechanics as { kind?: unknown } | undefined)) {
      item.mechanics = migrateLegacyItem(item.mechanics as unknown as LegacyItemMechanics, item.name, item.id);
      item.lootType = 'item';
    }
    if (item.equippedTo && ['accessory1', 'accessory2'].includes(String(item.equippedTo.slot))) item.equippedTo = { unitId: item.equippedTo.unitId, slot: 'gear' };
    if (item.history) item.history = item.history.map((entry) => {
      if (!isLegacyItemMechanics(entry.mechanics as { kind?: unknown } | undefined)) return entry;
      try { return { ...entry, mechanics: migrateLegacyItem(entry.mechanics as unknown as LegacyItemMechanics, entry.name, item.id) }; }
      catch { return entry; }
    });
    return item;
  });
}
/** 进行中战斗的携行记录随库存一起转换；快照里已编译的行动原样冻结在 action 中，这场战斗的结算不变。 */
function migrateBattleCarriedItems(save: InventorySave): void {
  const combatants = (save.battle?.snap as { combatants?: unknown } | undefined)?.combatants;
  if (!Array.isArray(combatants)) return;
  for (const unit of combatants as Combatant[]) for (const carried of unit?.carriedItems ?? []) {
    if (!isLegacyItemMechanics(carried.mechanics as { kind?: unknown })) continue;
    const action = unit.abilities?.find((a) => a.itemSourceId === carried.id);
    carried.mechanics = migrateLegacyItem(carried.mechanics as LegacyItemMechanics, carried.name, carried.id);
    if (action && !carried.action) carried.action = clone(action);
  }
}

/** 验证冻结数据的结构，不按当前公式重算旧实例。 */
export function validateInventoryItem(value: unknown): asserts value is InventoryItem {
  if (!object(value) || typeof value.id !== 'string' || !value.id || typeof value.name !== 'string' || !value.name
    || !Number.isSafeInteger(value.qty) || Number(value.qty) < 0) throw new Error('库存身份、名称或数量损坏');
  if (value.revision !== undefined && (!Number.isSafeInteger(value.revision) || Number(value.revision) < 1)) throw new Error('物品版本损坏');
  if (value.mechanics === undefined) {
    if (value.equippedTo !== undefined) throw new Error('叙事物品不能提供装备效果');
    return;
  }
  const m = value.mechanics;
  if (!object(m) || !['weapon', 'armor', 'shield', 'item'].includes(String(m.kind))) throw new Error('物品执行效果未知或损坏');
  if (m.kind === 'item') {
    validateItemValue(m.value);
    const form = (m.value as { recipe: { form: string } }).recipe.form;
    if (form === 'single' ? Number(value.qty) > 9999 || value.equippedTo !== undefined : Number(value.qty) > 1) throw new Error(form === 'single' ? '一次性道具数量为0–9999，不能装备' : '佩戴、充能道具必须逐件建档');
    if (value.equippedTo !== undefined && (!object(value.equippedTo) || value.equippedTo.slot !== 'gear')) throw new Error('道具只能装在佩戴位');
  } else {
    const recipe = object(m.value) ? m.value.recipe : undefined;
    if (object(recipe) && (recipe.stabilized !== undefined && typeof recipe.stabilized !== 'boolean' || recipe.protectionProfile !== undefined && !['balanced', 'kinetic', 'thermal', 'arcane'].includes(String(recipe.protectionProfile)))) throw new Error('武器稳定或防护类型记录损坏');
    if (recipe !== undefined && (!object(recipe) || !['mechanism-v2.1', 'mechanism-v2.2', 'mechanism-v2.3','mechanism-v2.3+autocannon-v2'].includes(String(recipe.version))
      || !Number.isInteger(recipe.power) || Number(recipe.power) < 1 || Number(recipe.power) > 10
      || !Number.isInteger(recipe.quality) || Number(recipe.quality) < 1 || Number(recipe.quality) > 5
      || !['human', 'large', 'vehicle', 'giant'].includes(String(recipe.size)) || typeof recipe.seed !== 'string' || !recipe.seed)) throw new Error('已保存的属性损坏或版本未知');
    if (object(recipe) && (recipe.balanceVersion !== undefined && recipe.balanceVersion !== 'unified-v1' || recipe.noVariance !== undefined && typeof recipe.noVariance !== 'boolean')) throw Error('装备数值版本损坏');
    if(object(recipe))validateInstanceVariance(recipe.variance);
    if(object(recipe))validateEnhancements(recipe.bonuses as Enhancements | undefined, m.kind as 'weapon'|'armor'|'shield');
    const gear = m.value;
    if (!object(gear) || gear.id !== value.id || Number(value.qty) > 1) throw new Error('装备唯一编号/数量冲突');
    if (m.kind === 'weapon') {
      if (typeof gear.baseDice !== 'string') throw new Error('武器缺少伤害规格'); parseDice(gear.baseDice);
      if (gear.apDice !== undefined) { if (typeof gear.apDice !== 'string') throw new Error('武器破甲骰损坏'); parseDice(gear.apDice); }
      if (gear.channel !== undefined && !['kinetic', 'thermal', 'arcane'].includes(String(gear.channel))) throw new Error('武器伤害通道未知');
      for (const key of ['penetration', 'load', 'range', 'minRange', 'reload', 'attacks', 'hands']) if (gear[key] !== undefined && (!Number.isFinite(gear[key]) || Number(gear[key]) < 0)) throw new Error('武器参数损坏');
    } else if (m.kind === 'armor') {
      if (![0, 1, 2, 3, 4].includes(Number(gear.tier))) throw new Error('护甲档位损坏');
      if (gear.protection !== undefined && (!object(gear.protection) || ['kinetic', 'thermal', 'arcane'].some((c) => !Number.isFinite((gear.protection as Record<string, unknown>)[c]) || Number((gear.protection as Record<string, unknown>)[c]) < 0))) throw new Error('护甲通道防护损坏');
    }
    if (gear.load !== undefined && (!Number.isFinite(gear.load) || Number(gear.load) < 0)) throw new Error('装备负重损坏');
  }
  if (value.equippedTo !== undefined && (!object(value.equippedTo) || typeof value.equippedTo.unitId !== 'string'
    || !slots.includes(value.equippedTo.slot as EquipmentSlot) || value.qty !== 1)) throw new Error('装备槽位损坏');
  if (value.history !== undefined && (!Array.isArray(value.history) || value.history.some((h) => !object(h) || typeof h.name !== 'string' || typeof h.sourceId !== 'string' || !Number.isInteger(h.revision)))) throw new Error('物品改造记录损坏');
}
function fingerprint(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(fingerprint).join(',') + ']';
  return '{' + Object.keys(value).sort().filter((key) => (value as Record<string, unknown>)[key] !== undefined)
    .map((key) => JSON.stringify(key) + ':' + fingerprint((value as Record<string, unknown>)[key])).join(',') + '}';
}
const stackable = (spec: ItemSpecification) => spec.kind === 'item' && spec.form === 'single';
export function createInventoryItem(id: string, name: string, spec: ItemSpecification, seed: string, qty = 1): InventoryItem {
  if (!id || !name.trim()) throw new Error('物品缺少身份或名称');
  if (!Number.isSafeInteger(qty) || qty < 1 || qty > 9999 || !stackable(spec) && qty !== 1) throw new Error('装备与佩戴、充能道具逐件建档；一次性道具数量为1–9999');
  return { id, name: name.trim(), qty, revision: 1, lootType: spec.kind === 'shield' ? 'armor' : spec.kind,
    mechanics: compileItem(spec, { id, name: name.trim(), seed, damageModel:'wounds-v2' }) };
}
function gearAt(unit: Combatant, slot: EquipmentSlot): unknown {
  switch (slot) {
    case 'primary': return unit.weapon ? { kind: 'weapon', value: unit.weapon } : undefined;
    case 'sidearm': return unit.sidearm ? { kind: 'weapon', value: unit.sidearm } : undefined;
    case 'armor': return unit.armor ? { kind: 'armor', value: unit.armor } : undefined;
    case 'shield': return unit.shield ? { kind: 'shield', value: unit.shield } : undefined;
    case 'gear': return unit.gear?.length ? unit.gear : undefined;
  }
}
export function fitsEquipmentSlot(mechanics: ItemMechanics, slot: EquipmentSlot): boolean {
  if (slot === 'gear') return mechanics.kind === 'item' && mechanics.value.recipe.form !== 'single';
  return (slot === 'primary' || slot === 'sidearm') ? mechanics.kind === 'weapon' : mechanics.kind === slot;
}

/** 首次接入只登记已有V2精确实例，绝不按名称生成或重掷旧装备。 */
export function prepareInventoryState(save: InventorySave, adoptExisting = true): InventorySave {
  const next = clone(prepareNarrativeIds(save));
  calibrateSavedWeaponRanges(next);
  next.inventory = migrateLegacyInventory(next.inventory) ?? []; next.storage ??= [];
  migrateBattleCarriedItems(next);
  const ids = new Set<string>();
  for (const item of next.inventory) {
    validateInventoryItem(item);
    if (!item.id || ids.has(item.id) || !Number.isSafeInteger(item.qty) || item.qty < 0) throw new Error('库存身份或数量损坏，需要先核对原档');
    ids.add(item.id);
    if (item.mechanics && item.mechanics.kind !== 'item' && (item.qty > 1 || item.mechanics.value.id !== item.id)) throw new Error('装备唯一编号/数量冲突');
  }
  for (const record of next.storage) {
    if (!adoptExisting || record.equipmentManaged || record.snapshot?.rulesVersion !== 'v2') continue;
    for (const slot of uniqueSlots) {
      const mechanics = gearAt(record.snapshot, slot) as ItemMechanics | undefined;
      if (!mechanics || mechanics.kind === 'item') continue;
      const gear = mechanics.value;
      let item = next.inventory.find((entry) => entry.id === gear.id);
      if (item && (fingerprint(item.mechanics) !== fingerprint(mechanics) || item.equippedTo && (item.equippedTo.unitId !== record.id || item.equippedTo.slot !== slot))) throw new Error('已有装备记录重复或内容冲突，不能猜测合并');
      if (!item) {
        item = { id: gear.id, name: 'name' in gear && gear.name ? gear.name : '盾牌', qty: 1,
          lootType: mechanics.kind === 'weapon' ? 'weapon' : 'armor', mechanics: clone(mechanics), revision: 1 };
        next.inventory.push(item);
      }
      item.assignedTo = record.id; item.equippedTo = { unitId: record.id, slot };
    }
    record.equipmentManaged = true;
  }
  const occupied = new Set<string>();
  for (const item of next.inventory) {
    if (!item.equippedTo) continue;
    const { unitId, slot } = item.equippedTo;
    const key = JSON.stringify([unitId, slot === 'gear' ? 'gear:' + item.id : slot]);
    if (!next.storage.some((r) => r.id === unitId && r.equipmentManaged) || occupied.has(key) || !slots.includes(slot)
      || !item.mechanics || !fitsEquipmentSlot(item.mechanics, slot) || item.assignedTo !== unitId || item.qty !== 1) throw new Error('装备槽位或持有者关系损坏');
    occupied.add(key);
  }
  for (const record of next.storage) if (record.equipmentManaged) projectEquipment(record, next.inventory);
  return next;
}

function projectEquipment(record: UnitRecord, inventory: InventoryItem[]): void {
  const unit = record.snapshot;
  if (!unit) throw new Error('装备显示记录缺少单位精确存档记录');
  delete unit.weapon; delete unit.sidearm; delete unit.armor; delete unit.shield; delete unit.accessories; delete unit.gear;
  for (const item of inventory.filter((i) => i.equippedTo?.unitId === record.id)) {
    const mechanics = item.mechanics!;
    if (mechanics.kind === 'weapon') {
      if (item.equippedTo!.slot === 'primary') unit.weapon = clone(mechanics.value);
      else unit.sidearm = clone(mechanics.value);
    } else if (mechanics.kind === 'armor') unit.armor = clone(mechanics.value);
    else if (mechanics.kind === 'shield') unit.shield = clone(mechanics.value);
    else (unit.gear ??= []).push(gearItem(item.id, item.name, mechanics.value));
  }
  syncGearAbilities(unit);
  const fields = {
    weaponId: undefined, weaponName: unit.weapon?.name, weaponClass: unit.weapon?.recipe?.mechanism, weaponLevel: unit.weapon?.level,
    sidearmId: undefined, sidearmName: unit.sidearm?.name, sidearmClass: unit.sidearm?.recipe?.mechanism, sidearmLevel: unit.sidearm?.level,
    armorId: undefined, armorName: unit.armor?.name, armorTier: unit.armor?.tier, armorLevel: unit.armor?.level,
  };
  Object.assign(record, fields);
  if (unit.genAudit) Object.assign(unit.genAudit.input, fields, { shield: !!unit.shield, shieldName: unit.shield?.name, shieldLevel: unit.shield?.recipe?.power, shieldBonuses: unit.shield?.recipe?.bonuses, weaponStabilized: unit.weapon?.recipe?.stabilized, sidearmStabilized: unit.sidearm?.recipe?.stabilized, armorProfile: unit.armor?.recipe?.protectionProfile, weaponEnchantment: unit.weapon?.recipe?.enchantment, sidearmEnchantment: unit.sidearm?.recipe?.enchantment });
}
function requireOutOfBattle(save: InventorySave): void {
  if (save.battle && !(save.committedOutcomeIds ?? []).includes(`${save.battle.kind}:${String(save.battle.snap.seed)}`)) throw new Error('战内物品必须通过引擎行动使用；未结算前不能换装或修改档案');
}
function recordById(save: InventorySave, id: string): UnitRecord {
  const record = save.storage?.find((r) => r.id === id);
  if (!record) throw new Error('目标档案不存在');
  return record;
}
function rewriteRecord(next: InventorySave, record: UnitRecord, sourceId: string): void {
  next.storage = next.storage!.map((r) => r.id === record.id ? unitRecordFromCombatant({ ...record.snapshot!, hp: record.hp, recoverableWounded: record.recoverableWounded, status: record.status ?? 'ready' }, record, { sourceId }) : r);
}

/** 普通面板保存不能绕过物品事务，或把失去库存绑定的旧投影写回。旧版道具先按同一对照表转换再比较。 */
export function assertInventoryPanelWrite(previous: InventorySave, next: InventorySave): void {
  const previousItems = migrateLegacyInventory(previous.inventory) ?? [], nextItems = migrateLegacyInventory(next.inventory) ?? [];
  for (const item of previousItems.filter((i) => i.mechanics)) {
    const incoming = nextItems.find((i) => i.id === item.id);
    if (fingerprint(incoming) !== fingerprint(item)) throw new Error('装备与物品数量/归属须通过库存事务修改');
  }
  if (nextItems.some((i) => i.mechanics && !previousItems.some((old) => old.id === i.id && old.mechanics))) throw new Error('新有效果的物品须先预览并通过库存事务入库');
  for (const old of previous.storage ?? []) if (old.equipmentManaged && !next.storage?.some((r) => r.id === old.id && r.equipmentManaged)) throw new Error('不能移除装备档案的库存绑定');
  if (!(next.storage ?? []).some((r) => r.equipmentManaged)) return;
  // This check projects archive equipment only. Battle history and reports do not
  // participate and copying them on every action grows with the entire fight.
  const projected = prepareInventoryState({ storage: next.storage, inventory: next.inventory, narrativeIdState: next.narrativeIdState });
  for (const record of next.storage ?? []) {
    if (!record.equipmentManaged || !record.snapshot) continue;
    const expected = projected.storage!.find((r) => r.id === record.id)!.snapshot!;
    // 旧档配件栏在投影后会改成已佩戴道具；比较时同样按投影后的结果看。
    if (record.snapshot.accessories && !expected.accessories) continue;
    for (const slot of slots) if (fingerprint(gearAt(record.snapshot, slot)) !== fingerprint(gearAt(expected, slot))) throw new Error('单位装备显示记录与库存不一致，请通过换装事务修改');
  }
}

/** 战外可以直接使用的一次性道具：效果只含治疗、净化、回能。 */
export function outOfBattleUse(item: InventoryItem): boolean {
  const m = item.mechanics;
  return m?.kind === 'item' && m.value.recipe.form === 'single' && !!m.value.ability?.effects.length
    && m.value.ability.effects.every((e) => e.op === 'heal' && e.amount !== undefined || e.op === 'dispel' && e.polarity === 'negative' || e.op === 'resource' && e.amount > 0);
}

/** 仅准备副本，调用方成功持久化后才发布；重复操作先去重，不覆盖新事实。 */
export function prepareInventoryTransaction(save: InventorySave, intent: InventoryIntent): InventorySave {
  const { id, expectedRevision, ...action } = intent;
  if (!id) throw new Error('物品操作缺少身份');
  const key = fingerprint(action);
  const committed = save.inventoryOperations?.find((event) => event.id === id);
  if (committed) {
    if (committed.fingerprint !== key) throw new Error('重复操作身份对应不同内容');
    return clone(save);
  }
  if (expectedRevision !== (save.factRevision ?? 0)) throw new Error('物品操作已过期，请按最新状态重新预览');
  requireOutOfBattle(save);
  const next = prepareInventoryState(save);
  const inventory = next.inventory!;
  if (action.kind === 'create') {
    if (inventory.some((i) => i.id === action.itemId)) throw new Error('物品身份已存在');
    inventory.push(createInventoryItem(action.itemId, action.name, action.spec, id, action.qty));
  } else if (action.kind === 'discard-many') {
    if (!Array.isArray(action.items) || !action.items.length) throw new Error('请先选择要删除的物品');
    const ids = new Set<string>(), byId = new Map(inventory.map(item => [item.id, item]));
    for (const entry of action.items) {
      if (!entry || typeof entry.itemId !== 'string' || !entry.itemId || ids.has(entry.itemId)) throw new Error('批量删除包含重复或无效物品');
      ids.add(entry.itemId);
      const item = byId.get(entry.itemId);
      if (!item || item.qty <= 0) throw new Error('待删除物品不存在或已耗尽');
      if (item.equippedTo) throw new Error('先卸下已装备物品，再从库存移除');
      if (!Number.isSafeInteger(entry.qty) || entry.qty !== item.qty) throw new Error('物品数量已变化，请重新选择');
    }
    // Validate the entire batch before changing any quantity; publish/save exactly once.
    for (const itemId of ids) byId.get(itemId)!.qty = 0;
  } else if (action.kind === 'unequip') {
    const record = recordById(next, action.unitId);
    const item = inventory.find((i) => i.equippedTo?.unitId === record.id && i.equippedTo.slot === action.slot && (action.slot !== 'gear' || i.id === action.itemId));
    if (!item) throw new Error(action.slot === 'gear' ? '这件道具没有装备在该单位身上' : '这个装备槽已空');
    delete item.equippedTo;
    projectEquipment(record, inventory);
    rewriteRecord(next, record, id);
  } else if (action.kind === 'collect') {
    const record = recordById(next, action.unitId);
    if (record.side !== 'enemy' || !(record.status === 'dead' || record.status === 'fled' || record.hp <= 0 || record.retired)) throw new Error('只能收缴阵亡、撤离或解散的敌方单位身上的道具');
    const taken = inventory.filter((i) => i.assignedTo === record.id && i.qty > 0 && (!i.mechanics || i.mechanics.kind === 'item'));
    if (!taken.length) throw new Error('该单位身上没有可收缴的道具');
    for (const item of taken) { delete item.equippedTo; delete item.assignedTo; }
    projectEquipment(record, inventory);
    rewriteRecord(next, record, id);
  } else {
    const item = inventory.find((i) => i.id === action.itemId);
    if (!item) throw new Error('物品不存在');
    if (item.qty <= 0) throw new Error('物品数量不足');
    if (action.kind === 'discard') {
      if (item.equippedTo) throw new Error('先卸下已装备物品，再从库存移除');
      if (!Number.isSafeInteger(action.qty) || action.qty < 1 || action.qty > item.qty) throw new Error('移除数量超出库存');
      item.qty -= action.qty;
    } else if (action.kind === 'define') {
      if (item.mechanics) throw new Error('物品已有物品属性，请使用改造入口');
      // 一次性道具整叠一起设定；装备与佩戴、充能道具逐件设定。
      const whole = item.qty === 1 || stackable(action.spec);
      const newId = whole ? item.id : `defined:${id}`;
      if (newId !== item.id && inventory.some((i) => i.id === newId)) throw new Error('补全物品身份已存在');
      const defined = { ...createInventoryItem(newId, item.name, action.spec, id, whole ? item.qty : 1), note: item.note, assignedTo: item.assignedTo, sourceItemId: item.id };
      if (whole) Object.assign(item, defined);
      else { item.qty--; inventory.push(defined); }
    } else if (action.kind === 'reforge') {
      const mechanics = item.mechanics;
      if (!mechanics || mechanics.kind === 'item' && mechanics.value.recipe.form === 'single') throw new Error('一次性道具不能改造；可以移除后重新获得');
      if (mechanics.kind !== action.spec.kind) throw new Error('重铸不能把不同种类实物互相替换');
      const name = action.name?.trim() || item.name;
      let compiled: ItemMechanics;
      if (mechanics.kind === 'item') {
        if (action.spec.kind !== 'item' || action.spec.form === 'single') throw new Error('佩戴、充能道具只能改造成佩戴或充能道具');
        compiled = compileItem(action.spec, { id: item.id, name, seed: mechanics.value.recipe.seed });
      } else {
        const oldRecipe = mechanics.value.recipe;
        if (action.spec.kind === 'item') throw new Error('重铸不能把不同种类实物互相替换');
        if (action.spec.kind === 'weapon' && (oldRecipe?.mechanism === 'natural') !== (action.spec.mechanism === 'natural')) throw Error('天生武器不能改造成外部装备，普通武器也不能改成身体的一部分');
        const spec = { ...action.spec, bonuses: action.spec.bonuses ?? oldRecipe?.bonuses, quality: action.spec.quality ?? oldRecipe?.quality, body: action.spec.body ?? oldRecipe?.size };
        if (spec.kind === 'weapon' && spec.stabilized === undefined) spec.stabilized = oldRecipe?.stabilized;
        if (spec.kind === 'armor' && spec.profile === undefined) spec.profile = oldRecipe?.protectionProfile;
        if (spec.kind === 'weapon' && spec.enchantment === undefined) spec.enchantment = oldRecipe?.enchantment ?? 'none';
        compiled = compileItem(spec, { id: item.id, name, seed: oldRecipe?.seed ?? `reforge:${id}`, damageModel:'wounds-v2', noVariance: oldRecipe?.noVariance, variance: oldRecipe?.variance ?? false });
      }
      item.history = [...(item.history ?? []), { revision: item.revision ?? 1, name: item.name, mechanics: clone(mechanics), sourceId: id }];
      item.mechanics = compiled; item.name = name; item.revision = (item.revision ?? 1) + 1;
      if (item.equippedTo) {
        const record = recordById(next, item.equippedTo.unitId);
        projectEquipment(record, inventory);
        const reason = equipmentReason(record.snapshot!);
        if (reason) throw new Error(reason);
        rewriteRecord(next, record, id);
      }
    } else if (action.kind === 'assign') {
      if (item.mechanics?.kind === 'weapon' && item.mechanics.value.recipe?.mechanism === 'natural' && item.assignedTo && item.assignedTo !== action.unitId) throw Error('天生武器属于单位身体，不能交给其他人或放进公共库存');
      if (item.equippedTo) throw new Error('请先卸下已装备的物品，再转移归属');
      if (action.unitId) recordById(next, action.unitId);
      item.assignedTo = action.unitId;
    } else {
      const record = recordById(next, action.unitId);
      if (record.retired || record.status === 'dead') throw new Error('阵亡或解散目标不能装备/使用物品');
      if (item.assignedTo && item.assignedTo !== record.id) throw new Error(item.equippedTo ? '物品已装备，请先卸下并转移' : '物品属于其他单位，请先分配');
      if (action.kind === 'equip') {
        if (!record.equipmentManaged || !record.snapshot) throw new Error('请先预览并更新单位规则，再使用配装');
        if (!item.mechanics || !fitsEquipmentSlot(item.mechanics, action.slot)) throw new Error(item.mechanics?.kind === 'item' && item.mechanics.value.recipe.form === 'single' ? '一次性道具不用装备，交给单位后在战斗中使用' : '缺少可装备规格或槽位不匹配');
        if (item.equippedTo) throw new Error('物品已装备，请先卸下');
        if (action.slot !== 'gear') for (const old of inventory) if (old.equippedTo?.unitId === record.id && old.equippedTo.slot === action.slot) delete old.equippedTo;
        item.assignedTo = record.id; item.equippedTo = { unitId: record.id, slot: action.slot };
        projectEquipment(record, inventory);
        const reason = equipmentReason(record.snapshot);
        if (reason) throw new Error(reason);
        rewriteRecord(next, record, id);
      } else {
        if (item.mechanics?.kind !== 'item' || item.mechanics.value.recipe.form !== 'single') throw new Error('这件物品没有可使用的效果');
        if (!outOfBattleUse(item)) throw Error('这种道具需要在战斗中选择行动使用');
        const target={...record,...record.snapshot!,hp:record.hp,recoverableWounded:record.recoverableWounded,status:record.status??'ready' as const};
        const effects = item.mechanics.value.ability!.effects;
        let changed = false;
        for (const effect of effects) {
          if (effect.op === 'resource') { const amount = skillResourceChange(target, effect); if (amount) { target.resources[effect.resource] = (target.resources[effect.resource] ?? 0) + amount; changed = true; } }
          else if (effect.op === 'dispel') { const chosen = dispelCandidates(target, effect); if (chosen.length) { applyDispel(target, chosen); changed = true; } }
          else if (effect.op === 'heal' && effect.amount !== undefined) {
            let amount = 0;
            try { amount = healingAmount(target, effect.amount); } catch (error) { if (effects.length === 1) throw error; }
            if (amount) { if (hasMemberHealth(target)) applyRecovery(target, amount); else target.hp += amount; changed = true; }
          }
        }
        if (!changed) throw Error('目标不需要这件道具的效果');
        next.storage = next.storage!.map((r) => r.id === record.id ? hasMemberHealth(target) || effects.some((e) => e.op !== 'heal')
          ? unitRecordFromCombatant(target, r, { kind: 'update', sourceId: id }) : updateUnitRecord(r, { hp: target.hp }, traitRegistry(), id) : r);
        item.qty--;
      }
    }
  }
  next.inventoryOperations = [...(save.inventoryOperations ?? []), { id, fingerprint: key }];
  next.factRevision = (save.factRevision ?? 0) + 1;
  return next;
}

/** 2026-09 射程校准装载迁移：库存实物、档案快照与进行中战斗快照的旧远程实例
 *  一并补齐到分类新射程，保持「库存=投影」指纹一致；幂等，不重掷骰子。 */
export function calibrateSavedWeaponRanges(save: InventorySave): void {
  const calibrate = (weapon: Combatant['weapon']) => { if(weapon?.customized)return; calibrateWeaponRange(weapon); calibrateAutocannon(weapon); calibrateWeaponHands(weapon); };
  for (const item of save.inventory ?? []) if (item.mechanics?.kind === 'weapon') calibrate(item.mechanics.value);
  for (const record of save.storage ?? []) {
    if (record.snapshot?.rulesVersion !== 'v2') continue;
    calibrate(record.snapshot.weapon); calibrate(record.snapshot.sidearm);
  }
  const combatants = (save.battle?.snap as { combatants?: unknown } | undefined)?.combatants;
  if (Array.isArray(combatants)) for (const unit of combatants) {
    if (!unit || typeof unit !== 'object') continue;
    const combatant = unit as Pick<Combatant, 'weapon' | 'sidearm'>;
    calibrate(combatant.weapon); calibrate(combatant.sidearm);
  }
}

/** 删除当前档案、名单引用及该单位已装备实物；未装备携行物品解除归属，历史战报保留。 */
export function deleteUnitArchive(save: InventorySave, unitId: string): InventorySave {
  requireOutOfBattle(save); recordById(save, unitId);
  const next = prepareInventoryState(save);
  next.storage = next.storage!.filter((r) => r.id !== unitId);
  next.rosterIds = (next.rosterIds ?? []).filter((id) => id !== unitId);
  next.inventory = next.inventory!.filter((item) => item.equippedTo?.unitId !== unitId && !(item.assignedTo===unitId && item.mechanics?.kind==='weapon' && item.mechanics.value.recipe?.mechanism==='natural'));
  for (const item of next.inventory ?? []) {
    if (item.assignedTo === unitId) delete item.assignedTo;
  }
  for (const key of ['lastBattleUnitIds', 'encounterIds']) if (Array.isArray(next[key])) next[key] = (next[key] as unknown[]).filter((id) => id !== unitId);
  for (const key of ['protagonistId', 'commanderId']) if (next[key] === unitId) delete next[key];
  for (const key of ['orderDraft', 'orderMemory']) if (next[key] && typeof next[key] === 'object') delete (next[key] as Record<string, unknown>)[unitId];
  next.factRevision = (save.factRevision ?? 0) + 1;
  return next;
}
