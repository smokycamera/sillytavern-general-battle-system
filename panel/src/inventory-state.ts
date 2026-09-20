import { validateEnhancements, type Enhancements } from '../../engine/src/enhancements.js';
import { calibrateAutocannon, calibrateWeaponHands } from '../../engine/src/gen/equipment.js';
import {hasMemberHealth} from '../../engine/src/member-health.js';
import {applyRecovery} from '../../engine/src/recovery.js';
/** 库存实物为装备权威；UnitRecord.snapshot 中的装备是供战斗使用的冻结投影。 */
import { calibrateWeaponRange, compileItem, equipmentReason, healingAmount, traitRegistry, parseDice,
  type Combatant, type EquipmentSlot, type ItemMechanics, type ItemSpecification } from '../../engine/src/index.js';
import { unitRecordFromCombatant, updateUnitRecord, type UnitRecord } from './unit-state.js';

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
  | { kind: 'assign'; itemId: string; unitId?: string }
  | { kind: 'equip'; itemId: string; unitId: string; slot: EquipmentSlot }
  | { kind: 'unequip'; unitId: string; slot: EquipmentSlot }
  | { kind: 'use'; itemId: string; unitId: string };
export type InventoryIntent = InventoryAction & { id: string; expectedRevision: number };
const slots: EquipmentSlot[] = ['primary', 'sidearm', 'armor', 'shield'];
const clone = <T>(value: T): T => structuredClone(value);
/** 验证冻结数据的结构，不按当前公式重算旧实例。 */
export function validateInventoryItem(value: unknown): asserts value is InventoryItem {
  const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  if (!object(value) || typeof value.id !== 'string' || !value.id || typeof value.name !== 'string' || !value.name
    || !Number.isSafeInteger(value.qty) || Number(value.qty) < 0) throw new Error('库存身份、名称或数量损坏');
  if (value.revision !== undefined && (!Number.isSafeInteger(value.revision) || Number(value.revision) < 1)) throw new Error('物品版本损坏');
  if (value.mechanics === undefined) {
    if (value.equippedTo !== undefined) throw new Error('叙事物品不能提供装备效果');
    return;
  }
  const m = value.mechanics;
  if (!object(m) || !['weapon', 'armor', 'shield', 'consumable'].includes(String(m.kind))) throw new Error('物品执行机制未知或损坏');
  const recipe = m.kind === 'consumable' ? m.recipe : object(m.value) ? m.value.recipe : undefined;
  if (object(recipe) && (recipe.stabilized !== undefined && typeof recipe.stabilized !== 'boolean' || recipe.protectionProfile !== undefined && !['balanced', 'kinetic', 'thermal', 'arcane'].includes(String(recipe.protectionProfile)))) throw new Error('武器稳定或防护构型记录损坏');
  if (recipe !== undefined && (!object(recipe) || !['mechanism-v2.1', 'mechanism-v2.2', 'mechanism-v2.3','mechanism-v2.3+autocannon-v2'].includes(String(recipe.version))
    || !Number.isInteger(recipe.power) || Number(recipe.power) < 1 || Number(recipe.power) > 10
    || !Number.isInteger(recipe.quality) || Number(recipe.quality) < 1 || Number(recipe.quality) > 5
    || !['human', 'large', 'vehicle', 'giant'].includes(String(recipe.size)) || typeof recipe.seed !== 'string' || !recipe.seed)) throw new Error('冻结配方损坏或版本未知');
  if(object(recipe))validateEnhancements(recipe.bonuses as Enhancements | undefined, m.kind as 'weapon'|'armor'|'shield'|'consumable');
  if (m.kind === 'consumable') {
    if (Number(value.qty) > 9999 || !recipe || !object(m.effect) || m.effect.op !== 'heal' || !Number.isSafeInteger(m.effect.amount) || Number(m.effect.amount) <= 0
      || value.equippedTo !== undefined) throw new Error('消耗品效果或装备关系损坏');
  } else {
    const gear = m.value;
    if (!object(gear) || gear.id !== value.id || Number(value.qty) > 1) throw new Error('装备实例身份/数量冲突');
    if (m.kind === 'weapon') {
      if (typeof gear.baseDice !== 'string') throw new Error('武器缺少伤害规格'); parseDice(gear.baseDice);
      if (gear.apDice !== undefined) { if (typeof gear.apDice !== 'string') throw new Error('武器破甲骰损坏'); parseDice(gear.apDice); }
      if (gear.channel !== undefined && !['kinetic', 'thermal', 'arcane'].includes(String(gear.channel))) throw new Error('武器伤害通道未知');
      for (const key of ['penetration', 'load', 'range', 'minRange', 'reload', 'attacks', 'hands']) if (gear[key] !== undefined && (!Number.isFinite(gear[key]) || Number(gear[key]) < 0)) throw new Error('武器参数损坏');
    } else if (m.kind === 'armor') {
      if (![0, 1, 2, 3, 4].includes(Number(gear.tier))) throw new Error('护甲档位损坏');
      if (gear.protection !== undefined && (!object(gear.protection) || ['kinetic', 'thermal', 'arcane'].some((c) => !Number.isFinite((gear.protection as Record<string, unknown>)[c]) || Number((gear.protection as Record<string, unknown>)[c]) < 0))) throw new Error('护甲通道防护损坏');
    }
    if (gear.load !== undefined && (!Number.isFinite(gear.load) || Number(gear.load) < 0)) throw new Error('装备负载损坏');
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
export function createInventoryItem(id: string, name: string, spec: ItemSpecification, seed: string, qty = 1): InventoryItem {
  if (!id || !name.trim()) throw new Error('物品缺少身份或名称');
  if (!Number.isSafeInteger(qty) || qty < 1 || qty > 9999 || spec.kind !== 'consumable' && qty !== 1) throw new Error('装备必须逐件建档，消耗品数量为1–9999');
  return { id, name: name.trim(), qty, revision: 1, lootType: spec.kind === 'shield' ? 'armor' : spec.kind,
    mechanics: compileItem(spec, { id, name, seed }) };
}
function gearAt(unit: Combatant, slot: EquipmentSlot): ItemMechanics | undefined {
  switch (slot) {
    case 'primary': return unit.weapon ? { kind: 'weapon', value: unit.weapon } : undefined;
    case 'sidearm': return unit.sidearm ? { kind: 'weapon', value: unit.sidearm } : undefined;
    case 'armor': return unit.armor ? { kind: 'armor', value: unit.armor } : undefined;
    case 'shield': return unit.shield ? { kind: 'shield', value: unit.shield } : undefined;
  }
}
function fits(mechanics: ItemMechanics, slot: EquipmentSlot): boolean {
  return (slot === 'primary' || slot === 'sidearm') ? mechanics.kind === 'weapon' : mechanics.kind === slot;
}

/** 首次接入只登记已有V2精确实例，绝不按名称生成或重掷旧装备。 */
export function prepareInventoryState(save: InventorySave, adoptExisting = true): InventorySave {
  const next = clone(save);
  calibrateSavedWeaponRanges(next);
  next.inventory ??= []; next.storage ??= [];
  const ids = new Set<string>();
  for (const item of next.inventory) {
    validateInventoryItem(item);
    if (!item.id || ids.has(item.id) || !Number.isSafeInteger(item.qty) || item.qty < 0) throw new Error('库存身份或数量损坏，需要先核对原档');
    ids.add(item.id);
    if (item.mechanics && item.mechanics.kind !== 'consumable' && (item.qty > 1 || item.mechanics.value.id !== item.id)) throw new Error('装备实例身份/数量冲突');
  }
  for (const record of next.storage) {
    if (!adoptExisting || record.equipmentManaged || record.snapshot?.rulesVersion !== 'v2') continue;
    for (const slot of slots) {
      const mechanics = gearAt(record.snapshot, slot);
      if (!mechanics || mechanics.kind === 'consumable') continue;
      const gear = mechanics.value;
      let item = next.inventory.find((entry) => entry.id === gear.id);
      if (item && (fingerprint(item.mechanics) !== fingerprint(mechanics) || item.equippedTo && (item.equippedTo.unitId !== record.id || item.equippedTo.slot !== slot))) throw new Error('已有装备实例重复或内容冲突，不能猜测合并');
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
    const key = JSON.stringify([unitId, slot]);
    if (!next.storage.some((r) => r.id === unitId && r.equipmentManaged) || occupied.has(key) || !slots.includes(slot)
      || !item.mechanics || !fits(item.mechanics, slot) || item.assignedTo !== unitId || item.qty !== 1) throw new Error('装备槽位或持有者关系损坏');
    occupied.add(key);
  }
  for (const record of next.storage) if (record.equipmentManaged) projectEquipment(record, next.inventory);
  return next;
}

function projectEquipment(record: UnitRecord, inventory: InventoryItem[]): void {
  const unit = record.snapshot;
  if (!unit) throw new Error('装备投影缺少单位精确快照');
  delete unit.weapon; delete unit.sidearm; delete unit.armor; delete unit.shield;
  for (const item of inventory.filter((i) => i.equippedTo?.unitId === record.id)) {
    const mechanics = item.mechanics!;
    if (mechanics.kind === 'weapon') {
      if (item.equippedTo!.slot === 'primary') unit.weapon = clone(mechanics.value);
      else unit.sidearm = clone(mechanics.value);
    } else if (mechanics.kind === 'armor') unit.armor = clone(mechanics.value);
    else if (mechanics.kind === 'shield') unit.shield = clone(mechanics.value);
  }
  const fields = {
    weaponId: undefined, weaponName: unit.weapon?.name, weaponClass: unit.weapon?.recipe?.mechanism, weaponLevel: unit.weapon?.level,
    sidearmId: undefined, sidearmName: unit.sidearm?.name, sidearmClass: unit.sidearm?.recipe?.mechanism, sidearmLevel: unit.sidearm?.level,
    armorId: undefined, armorName: unit.armor?.name, armorTier: unit.armor?.tier, armorLevel: unit.armor?.level,
  };
  Object.assign(record, fields);
  if (unit.genAudit) Object.assign(unit.genAudit.input, fields, { shield: !!unit.shield, weaponStabilized: unit.weapon?.recipe?.stabilized, sidearmStabilized: unit.sidearm?.recipe?.stabilized, armorProfile: unit.armor?.recipe?.protectionProfile, weaponEnchantment: unit.weapon?.recipe?.enchantment, sidearmEnchantment: unit.sidearm?.recipe?.enchantment });
}
function requireOutOfBattle(save: InventorySave): void {
  if (save.battle && !(save.committedOutcomeIds ?? []).includes(`${save.battle.kind}:${String(save.battle.snap.seed)}`)) throw new Error('战内物品必须通过引擎行动使用；未结算前不能换装或修改档案');
}
function recordById(save: InventorySave, id: string): UnitRecord {
  const record = save.storage?.find((r) => r.id === id);
  if (!record) throw new Error('目标档案不存在');
  return record;
}

/** 普通面板保存不能绕过物品事务，或把失去库存绑定的旧投影写回。 */
export function assertInventoryPanelWrite(previous: InventorySave, next: InventorySave): void {
  const previousItems = previous.inventory ?? [], nextItems = next.inventory ?? [];
  for (const item of previousItems.filter((i) => i.mechanics)) {
    const incoming = nextItems.find((i) => i.id === item.id);
    if (fingerprint(incoming) !== fingerprint(item)) throw new Error('装备与物品数量/归属须通过库存事务修改');
  }
  if (nextItems.some((i) => i.mechanics && !previousItems.some((old) => old.id === i.id && old.mechanics))) throw new Error('新机械物品须先预览并通过库存事务入库');
  for (const old of previous.storage ?? []) if (old.equipmentManaged && !next.storage?.some((r) => r.id === old.id && r.equipmentManaged)) throw new Error('不能移除装备档案的库存绑定');
  if (!(next.storage ?? []).some((r) => r.equipmentManaged)) return;
  const projected = prepareInventoryState(next);
  for (const record of next.storage ?? []) {
    if (!record.equipmentManaged || !record.snapshot) continue;
    const expected = projected.storage!.find((r) => r.id === record.id)!.snapshot!;
    for (const slot of slots) if (fingerprint(gearAt(record.snapshot, slot)) !== fingerprint(gearAt(expected, slot))) throw new Error('单位装备投影与库存不一致，请通过换装事务修改');
  }
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
  } else if (action.kind === 'unequip') {
    const record = recordById(next, action.unitId);
    const item = inventory.find((i) => i.equippedTo?.unitId === record.id && i.equippedTo.slot === action.slot);
    if (!item) throw new Error('这个装备槽已空');
    delete item.equippedTo;
    projectEquipment(record, inventory);
    next.storage = next.storage!.map((r) => r.id === record.id ? unitRecordFromCombatant({ ...record.snapshot!, hp: record.hp, recoverableWounded: record.recoverableWounded, status: record.status ?? 'ready' }, record, { sourceId: id }) : r);
  } else {
    const item = inventory.find((i) => i.id === action.itemId);
    if (!item) throw new Error('物品不存在');
    if (item.qty <= 0) throw new Error('物品数量不足');
    if (action.kind === 'discard') {
      if (item.equippedTo) throw new Error('先卸下已装备物品，再从库存移除');
      if (!Number.isSafeInteger(action.qty) || action.qty < 1 || action.qty > item.qty) throw new Error('移除数量超出库存');
      item.qty -= action.qty;
    } else if (action.kind === 'define') {
      if (item.mechanics) throw new Error('物品已有机械规格，请使用改造入口');
      const newId = item.qty === 1 ? item.id : `defined:${id}`;
      if (newId !== item.id && inventory.some((i) => i.id === newId)) throw new Error('补全物品身份已存在');
      const defined = { ...createInventoryItem(newId, item.name, action.spec, id), note: item.note, assignedTo: item.assignedTo, sourceItemId: item.id };
      if (item.qty === 1) Object.assign(item, defined);
      else { item.qty--; inventory.push(defined); }
    } else if (action.kind === 'reforge') {
      if (!item.mechanics || item.mechanics.kind === 'consumable') throw new Error('此物品没有可改造的装备规格');
      if (item.mechanics.kind !== action.spec.kind) throw new Error('重铸不能把不同种类实物互相替换');
      const oldRecipe = item.mechanics.value.recipe;
      const spec = { ...action.spec, bonuses: action.spec.bonuses ?? oldRecipe?.bonuses, quality: action.spec.quality ?? oldRecipe?.quality, body: action.spec.body ?? oldRecipe?.size };
      if (spec.kind === 'weapon' && spec.stabilized === undefined) spec.stabilized = oldRecipe?.stabilized;
      if (spec.kind === 'armor' && spec.profile === undefined) spec.profile = oldRecipe?.protectionProfile;
      if (spec.kind === 'weapon' && spec.enchantment === undefined) spec.enchantment = oldRecipe?.enchantment ?? 'none';
      const name = action.name?.trim() || item.name;
      const mechanics = compileItem(spec, { id: item.id, name, seed: oldRecipe?.seed ?? `reforge:${id}` });
      item.history = [...(item.history ?? []), { revision: item.revision ?? 1, name: item.name, mechanics: clone(item.mechanics), sourceId: id }];
      item.mechanics = mechanics; item.name = name; item.revision = (item.revision ?? 1) + 1;
      if (item.equippedTo) {
        const record = recordById(next, item.equippedTo.unitId);
        projectEquipment(record, inventory);
        const reason = equipmentReason(record.snapshot!);
        if (reason) throw new Error(reason);
        next.storage = next.storage!.map((r) => r.id === record.id ? unitRecordFromCombatant({ ...record.snapshot!, hp: record.hp, recoverableWounded: record.recoverableWounded, status: record.status ?? 'ready' }, record, { sourceId: id }) : r);
      }
    } else if (action.kind === 'assign') {
      if (item.equippedTo) throw new Error('请先卸下已装备的物品，再转移归属');
      if (action.unitId) recordById(next, action.unitId);
      item.assignedTo = action.unitId;
    } else {
      const record = recordById(next, action.unitId);
      if (record.retired || record.status === 'dead') throw new Error('阵亡或解散目标不能装备/使用物品');
      if (item.assignedTo && item.assignedTo !== record.id) throw new Error(item.equippedTo ? '物品已装备，请先卸下并转移' : '物品属于其他单位，请先分配');
      if (action.kind === 'equip') {
        if (!record.equipmentManaged || !record.snapshot) throw new Error('请先预览转制为V2再使用新配装');
        if (!item.mechanics || !fits(item.mechanics, action.slot)) throw new Error('缺少可装备规格或槽位不匹配');
        if (item.equippedTo) throw new Error('物品已装备，请先卸下');
        for (const old of inventory) if (old.equippedTo?.unitId === record.id && old.equippedTo.slot === action.slot) delete old.equippedTo;
        item.assignedTo = record.id; item.equippedTo = { unitId: record.id, slot: action.slot };
        projectEquipment(record, inventory);
        const reason = equipmentReason(record.snapshot);
        if (reason) throw new Error(reason);
        next.storage = next.storage!.map((r) => r.id === record.id ? unitRecordFromCombatant({ ...record.snapshot!, hp: record.hp, recoverableWounded: record.recoverableWounded, status: record.status ?? 'ready' }, record, { sourceId: id }) : r);
      } else {
        if (item.mechanics?.kind !== 'consumable' || item.mechanics.effect.op !== 'heal') throw new Error('物品没有可执行治疗规格，叙事说明不会自动产生效果');
        const target={...record,...record.snapshot!,hp:record.hp,recoverableWounded:record.recoverableWounded,status:record.status??'ready' as const};
        const amount = healingAmount(target, item.mechanics.effect.amount);
        if(hasMemberHealth(target)){applyRecovery(target,amount);next.storage=next.storage!.map(r=>r.id===record.id?unitRecordFromCombatant(target,r,{kind:'update',sourceId:id}):r);}
        else next.storage = next.storage!.map((r) => r.id === record.id ? updateUnitRecord(r, { hp: r.hp + amount }, traitRegistry(), id) : r);
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
  next.inventory = next.inventory!.filter((item) => item.equippedTo?.unitId !== unitId);
  for (const item of next.inventory ?? []) {
    if (item.assignedTo === unitId) delete item.assignedTo;
  }
  for (const key of ['lastBattleUnitIds', 'encounterIds']) if (Array.isArray(next[key])) next[key] = (next[key] as unknown[]).filter((id) => id !== unitId);
  for (const key of ['protagonistId', 'commanderId']) if (next[key] === unitId) delete next[key];
  for (const key of ['orderDraft', 'orderMemory']) if (next[key] && typeof next[key] === 'object') delete (next[key] as Record<string, unknown>)[unitId];
  next.factRevision = (save.factRevision ?? 0) + 1;
  return next;
}
