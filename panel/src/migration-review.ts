import { displayNumber } from '../../engine/src/display-number.js';
import { prepareCombatModel } from '../../engine/src/combat-model.js';
import { V6_D20 } from '../../engine/src/rules.js';
import { upgradeCombatSkills } from '../../engine/src/skill-upgrade.js';
import { unitRecordFromCombatant, materializeUnitRecord } from './unit-state.js';
import { SmallBattle, MassBattle, traitRegistry, rulesById, validateTraitSource, validateTacticalPose, validateTacticalEffort, validateConcealment, validateFlightState, validateWounded, validateMoraleState, validateVanguardOrigin, validateFormationPosition, normalizeV2Scale, ITEM_FORM_NAMES, itemSpecText, type Combatant } from '../../engine/src/index.js';
import { combatantFromUnknown, migratePanelUnits } from './unit-state.js';
import type { NarrativeSave } from './narrative-state.js';
import { prepareInventoryState, occupiedEquipmentSlot, validateInventoryItem, fitsEquipmentSlot, migrateLegacyInventory, type InventoryItem } from './inventory-state.js';
import { prepareBattleItemWrite } from './battle-items.js';

export interface MigrationReview { original: NarrativeSave; candidate: NarrativeSave; changes: string[]; quarantined: number }

function validateBattle(save: NarrativeSave): void {
  if (!save.battle) return;
  const { kind, snap } = save.battle;
  if (!['small', 'mass'].includes(kind) || !snap || !Array.isArray(snap.combatants)) throw new Error('战斗结构不完整');
  const rules = rulesById(String(snap.rulesId));
  const units = snap.combatants as Combatant[];
  const ids = new Set<string>();
  for (const u of units) {
    if (!u || !u.id || ids.has(u.id) || !u.base || !Number.isSafeInteger(u.hp) || u.hp < 0 || u.hp > u.base.hpMax) throw new Error('战斗单位身份或生命值损坏');
    combatantFromUnknown(u);
    ids.add(u.id);
    validateTacticalEffort(u.tacticalEffort, u.resourceModel);
    validateConcealment(u.tacticalRevealed);
    validateFlightState(u.airborne); validateMoraleState(u.moraleState); validateWounded(u);
    validateFormationPosition(u.formationPosition);
    if (kind === 'small' && u.formationPosition !== undefined) throw new Error('实际会战阵位不能放入小战存档记录');
    validateVanguardOrigin(u.vanguardOrigin, u.side);
    if (kind === 'small' && u.vanguardOrigin !== undefined) throw new Error('会战先锋来源不能放入小战存档记录');
    if (u.tacticalPose !== undefined) {
      validateTacticalPose(u.tacticalPose);
      const field = snap.battlefield as { width?: number; height?: number } | undefined;
      if (u.tacticalPose.mode !== kind || kind === 'small' && (u.tacticalPose.width !== field?.width || u.tacticalPose.height !== undefined && u.tacticalPose.height !== field?.height)) throw new Error('姿态与当前战场尺度不匹配');
    }
    if (u.traitSources !== undefined) {
      if (!Array.isArray(u.traitSources) || new Set(u.traitSources.map((s) => s?.id)).size !== u.traitSources.length) throw new Error('特质来源结构或身份损坏');
      for (const source of u.traitSources) validateTraitSource(source);
    }
    if (!Array.isArray(u.abilities) || !Array.isArray(u.tags) || !Array.isArray(u.conditions) || !u.resources) throw new Error('战斗单位状态缺失');
  }
  if (rules.resolutionVersion === 'v2' && (!Number.isInteger(snap.rngState) || units.some((u) => u.rulesVersion !== 'v2'))) throw new Error('存档缺少可恢复随机状态，或单位规则不一致');
  if (kind === 'small') {
    const b = SmallBattle.fromSnapshot(structuredClone(snap));
    if (b.turnOrder.some((id) => !ids.has(id))) throw new Error('行动顺序引用缺失单位');
    if (b.battlefield && units.some((u) => !Number.isInteger(u.pos) || u.pos! < 0 || u.pos! >= b.battlefield!.tiles.length)) throw new Error('地图坐标损坏');
  } else MassBattle.fromSnapshot(structuredClone(snap));
}

/** Recover only the exact rows excluded by the old single-slot check in the last accepted preview. */
function recoverQuarantinedLoadout(save: NarrativeSave): InventoryItem[] | undefined {
  if (!Array.isArray(save.inventory) || !Array.isArray(save.migrationBackups) || !Array.isArray(save.unitMigrationWarnings)
    || !Array.isArray(save.inventoryMigrationBackup) || !save.inventoryMigrationBackup.length) return;
  const before: NarrativeSave | undefined = save.migrationBackups.at(-1)?.source;
  if (!Array.isArray(before?.inventory) || save.factRevision !== (before.factRevision ?? 0) + 1) return;
  const quarantined = new Map<string, InventoryItem>();
  for (const item of save.inventoryMigrationBackup) {
    if (!item?.equippedTo || !item.id || quarantined.has(item.id)) return;
    quarantined.set(item.id,item);
  }
  const current = new Map(save.inventory.map(item => [item?.id,item]));
  if (current.size !== save.inventory.length || before.inventory.length !== current.size + quarantined.size) return;
  const warnings = new Set(save.unitMigrationWarnings);
  const inventory: InventoryItem[] = [];
  for (const [index,item] of before.inventory.entries()) {
    if (!item?.id) return;
    const archived = quarantined.get(item.id);
    if (archived) {
      if (current.has(item.id) || !warnings.has(`库存[${index}]已隔离：Error: 同一槽位有多件实物，不能猜测保留`)
        || JSON.stringify(item) !== JSON.stringify(archived)) return;
      inventory.push(archived);
    } else {
      const retained = current.get(item.id);
      if (!retained) return;
      inventory.push(retained);
    }
  }
  // Reapply the current relation and slot checks before offering the repair.
  try { prepareInventoryState({...save,inventory},false); } catch { return; }
  return inventory;
}

/** 纯预览：原始完整存档保留，运行中的旧规则不换版本，不重建已有装备。 */
export function reviewMigration(raw: NarrativeSave, unifiedBalance = false): MigrationReview | undefined {
  const original = structuredClone(raw);
  const units = migratePanelUnits({ schemaVersion: raw.schemaVersion, storage: raw.storage, roster: raw.roster, rosterIds: raw.rosterIds, registry: traitRegistry() });
  const changes = [...units.warnings];
  const legacy = raw.schemaVersion !== 2 && (Array.isArray(raw.roster) || Array.isArray(raw.storage) && raw.storage.length > 0);
  if (legacy) changes.unshift('整理单位档案与参战名单；保留装备、人员、训练和进行中的战斗');
  const candidate = structuredClone(raw);
  candidate.storage = units.records; candidate.rosterIds = units.roster.map((u) => u.id);
  const oldMookIds = new Set([
    ...(Array.isArray(raw.storage) ? raw.storage : []).filter((r) => r?.scale === 'mook' && r.snapshot?.rulesVersion === 'v2').map((r) => r.id),
    ...(Array.isArray(raw.roster) ? raw.roster : []).filter((u) => u?.scale === 'mook' && u.rulesVersion === 'v2').map((u) => u.id),
  ]);
  for (const record of candidate.storage) if (record.snapshot?.rulesVersion === 'v2' && record.scale === 'mook') {
    record.scale = 'company'; normalizeV2Scale(record.snapshot); oldMookIds.add(record.id);
  }
  let quarantined = units.backup.length;
  // 旧版药剂与护符逐件按对照表转换（V15）；转换不了的与其他坏项一样隔离，原件留在备份里。
  let converted = 0;
  const recovered = recoverQuarantinedLoadout(raw);
  if (recovered) {
    changes.push(`从上次迁移备份找回 ${recovered.length - raw.inventory!.length} 批混装装备，保留原编号、件数和配装`);
    delete candidate.inventoryMigrationBackup;
  }
  const items = (recovered ?? (Array.isArray(raw.inventory) ? raw.inventory : [])).map((item: InventoryItem) => {
    try {
      const next = migrateLegacyInventory([item])?.[0] ?? item;
      if (next === item) return item;
      converted++;
      const m = next.mechanics;
      if (m?.kind === 'item') changes.push(`道具「${next.name}」转为${ITEM_FORM_NAMES[m.value.recipe.form]}道具 ${itemSpecText(m.value.recipe)}${next.equippedTo?.slot === 'gear' ? '，仍装备在原单位' : ''}`);
      return next;
    } catch { return item; }
  });
  const slotCounts = new Map<string,number>(), idCounts = new Map<string,number>();
  for (const item of items) if (item && typeof item === 'object') {
    idCounts.set(item.id,(idCounts.get(item.id) ?? 0)+1);
    const key = occupiedEquipmentSlot(item);
    if (key) slotCounts.set(key,(slotCounts.get(key) ?? 0)+1);
  }
  const badItems: unknown[] = [];
  candidate.inventory = items.filter((item, index) => {
    try {
      validateInventoryItem(item);
      if (idCounts.get(item.id)! > 1) throw new Error('重复实物id，不能选一条覆盖');
      if (item.assignedTo && !units.records.some((r) => r.id === item.assignedTo)) throw new Error('持有者档案缺失');
      if (item.equippedTo) {
        const { unitId, slot } = item.equippedTo;
        if (item.assignedTo !== unitId || !units.records.some((r) => r.id === unitId && r.equipmentManaged)
          || !item.mechanics || !fitsEquipmentSlot(item.mechanics,slot)) throw new Error('装备关系与持有者/槽位不一致');
        if (slotCounts.get(occupiedEquipmentSlot(item)!)! > 1) throw new Error('同一槽位有多件实物，不能猜测保留');
      }
      return true;
    } catch (error) { changes.push(`库存[${index}]已隔离：${String(error)}`); badItems.push(item); return false; }
  });
  if (raw.inventory !== undefined && !Array.isArray(raw.inventory)) { changes.push('库存容器已隔离：不是数组'); badItems.push(raw.inventory); }
  if ((converted || recovered) && !badItems.length) {
    // 原配件栏的投影换成已佩戴道具；单位档案的其他内容不变。
    const projected = prepareInventoryState(candidate, false);
    candidate.inventory = projected.inventory; candidate.storage = projected.storage;
  }
  if (badItems.length) {
    quarantined += badItems.length; candidate.inventoryMigrationBackup = badItems;
    // 只重投影受库存管理的档案；隔离的实物不再提供效果，原实例仍在完整备份中。
    const projected = prepareInventoryState(candidate, false);
    candidate.inventory = projected.inventory; candidate.storage = projected.storage;
    changes.push('隔离物品的装备效果将解除；保留其他物品、训练、生命与原始备份');
  }
  try {
    validateBattle(raw);
    if (candidate.battle?.snap.rulesId === 'v2-d20' || candidate.battle?.snap.rulesId === 'v2-tw') {
      for (const unit of candidate.battle.snap.combatants as Combatant[]) {
        if (unit.rulesVersion === 'v2' && unit.scale === 'mook') { oldMookIds.add(unit.id); normalizeV2Scale(unit); }
      }
    }
  }
  catch (error) {
    changes.push('战斗已隔离：' + String(error));
    candidate.battle = null; quarantined++;
  }
  if (oldMookIds.size) changes.push(`人数形式整理为编队（${oldMookIds.size}个身份）；保留人数、训练、已保存的物品与战斗随机进度，恢复正常成长`);
  if (candidate.battle && badItems.length) {
    try {
      const combatants = candidate.battle.snap.combatants as Combatant[];
      if (badItems.some((item) => {
        if (!item || typeof item !== 'object' || !('equippedTo' in item)) return false;
        const relation = item.equippedTo;
        return relation && typeof relation === 'object' && 'unitId' in relation && combatants.some((u) => u.id === relation.unitId);
      })) throw new Error('本场使用的装备已隔离，不能结算到新档案');
      prepareBattleItemWrite(candidate, candidate);
    }
    catch (error) { changes.push('受损库存关联战斗已隔离：' + String(error)); candidate.battle = null; quarantined++; }
  }
  if (unifiedBalance) {
    if (raw.battle) throw Error('请先收兵归档，再更新档案');
    candidate.storage = (candidate.storage ?? []).map(record => {
      const snapshot = record.snapshot;
      if (!snapshot || snapshot.rulesVersion !== 'v2' || snapshot.damageModel === 'wounds-v2') return record;
      // Apply authoritative record fields (including deployment preferences) before conversion.
      // This is an archive migration, so preserve the saved resources and action ledger.
      const unit = materializeUnitRecord(record, traitRegistry());
      unit.resources = structuredClone(snapshot.resources);
      unit.abilityState = structuredClone(snapshot.abilityState);
      unit.fatigue = snapshot.fatigue;
      const before = unit.scale === 'hero' ? unit.base.hpMax : unit.formation?.memberHp;
      prepareCombatModel(unit, V6_D20); upgradeCombatSkills(unit);
      const after = unit.scale === 'hero' ? unit.base.hpMax : unit.formation?.memberHp;
      changes.push(`${unit.name}：${unit.scale==='hero'?'生命上限':'成员生命'} ${before ?? '未记录'} → ${displayNumber(after)}；保留身份、人数、伤损、资源与冷却，自定义上限保留`);
      return unitRecordFromCombatant(unit, record, {kind:'edit', sourceId:'balance:unified-v1'});
    });
    if (changes.length) changes.push('新生命按原伤损点数换算，零生命不复活；较低新上限下存活者最低保留1生命。保留物品、战报与已保存的战斗。');
  }
  if (!changes.length) return undefined;
  candidate.schemaVersion = 2;
  delete candidate.roster;
  candidate.unitMigrationWarnings = changes;
  candidate.unitMigrationBackup = units.backup;
  candidate.factRevision = (raw.factRevision ?? 0) + 1;
  return { original, candidate, changes, quarantined };
}
