import { SmallBattle, MassBattle, traitRegistry, rulesById, validateTraitSource, validateTacticalPose, validateTacticalEffort, validateConcealment, validateFlightState, validateWounded, validateMoraleState, validateVanguardOrigin, validateFormationPosition, normalizeV2Scale, type Combatant } from '../../engine/src/index.js';
import { combatantFromUnknown, migratePanelUnits } from './unit-state.js';
import type { NarrativeSave } from './narrative-state.js';
import { prepareInventoryState, validateInventoryItem } from './inventory-state.js';
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
    validateTacticalEffort(u.tacticalEffort);
    validateConcealment(u.tacticalRevealed);
    validateFlightState(u.airborne); validateMoraleState(u.moraleState); validateWounded(u);
    validateFormationPosition(u.formationPosition);
    if (kind === 'small' && u.formationPosition !== undefined) throw new Error('实际会战阵位不能放入小战快照');
    validateVanguardOrigin(u.vanguardOrigin, u.side);
    if (kind === 'small' && u.vanguardOrigin !== undefined) throw new Error('会战先锋来源不能放入小战快照');
    if (u.tacticalPose !== undefined) {
      validateTacticalPose(u.tacticalPose);
      const field = snap.battlefield as { width?: number } | undefined;
      if (u.tacticalPose.mode !== kind || kind === 'small' && u.tacticalPose.width !== field?.width) throw new Error('姿态与当前战场尺度不匹配');
    }
    if (u.traitSources !== undefined) {
      if (!Array.isArray(u.traitSources) || new Set(u.traitSources.map((s) => s?.id)).size !== u.traitSources.length) throw new Error('特质来源结构或身份损坏');
      for (const source of u.traitSources) validateTraitSource(source);
    }
    if (!Array.isArray(u.abilities) || !Array.isArray(u.tags) || !Array.isArray(u.conditions) || !u.resources) throw new Error('战斗单位状态缺失');
  }
  if (rules.resolutionVersion === 'v2' && (!Number.isInteger(snap.rngState) || units.some((u) => u.rulesVersion !== 'v2'))) throw new Error('V2快照缺少可恢复随机状态或混入旧规则单位');
  if (kind === 'small') {
    const b = SmallBattle.fromSnapshot(structuredClone(snap));
    if (b.turnOrder.some((id) => !ids.has(id))) throw new Error('激活顺序引用缺失单位');
    if (b.battlefield && units.some((u) => !Number.isInteger(u.pos) || u.pos! < 0 || u.pos! >= b.battlefield!.tiles.length)) throw new Error('地图坐标损坏');
  } else MassBattle.fromSnapshot(structuredClone(snap));
}

/** 纯预览：原始完整存档保留，运行中的旧规则不换版本，不重建已有装备。 */
export function reviewMigration(raw: NarrativeSave): MigrationReview | undefined {
  const original = structuredClone(raw);
  const units = migratePanelUnits({ schemaVersion: raw.schemaVersion, storage: raw.storage, roster: raw.roster, rosterIds: raw.rosterIds, registry: traitRegistry() });
  const changes = [...units.warnings];
  const legacy = raw.schemaVersion !== 2 && (Array.isArray(raw.roster) || Array.isArray(raw.storage) && raw.storage.length > 0);
  if (legacy) changes.unshift('转换旧单位容器为档案+参战id；保留原装备、人员、训练和进行中战斗规则');
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
  const items = Array.isArray(raw.inventory) ? raw.inventory : [];
  const badItems: unknown[] = [];
  candidate.inventory = items.filter((item, index) => {
    try {
      validateInventoryItem(item);
      if (items.some((other, n) => n !== index && other?.id === item.id)) throw new Error('重复实物id，不能选一条覆盖');
      if (item.assignedTo && !units.records.some((r) => r.id === item.assignedTo)) throw new Error('持有者档案缺失');
      if (item.equippedTo) {
        const { unitId, slot } = item.equippedTo;
        if (item.assignedTo !== unitId || !units.records.some((r) => r.id === unitId && r.equipmentManaged)
          || !item.mechanics || item.mechanics.kind !== ((slot === 'primary' || slot === 'sidearm') ? 'weapon' : slot)) throw new Error('装备关系与持有者/槽位不一致');
        if (items.some((other, n) => n !== index && other?.equippedTo?.unitId === unitId && other.equippedTo.slot === slot)) throw new Error('同一槽位有多件实物，不能猜测保留');
      }
      return true;
    } catch (error) { changes.push(`库存[${index}]已隔离：${String(error)}`); badItems.push(item); return false; }
  });
  if (raw.inventory !== undefined && !Array.isArray(raw.inventory)) { changes.push('库存容器已隔离：不是数组'); badItems.push(raw.inventory); }
  if (badItems.length) {
    quarantined += badItems.length; candidate.inventoryMigrationBackup = badItems;
    // 只重投影受库存管理的档案；隔离的实物不再提供效果，原实例仍在完整备份中。
    const projected = prepareInventoryState(candidate, false);
    candidate.inventory = projected.inventory; candidate.storage = projected.storage;
    changes.push('隔离实物的装备效果将解除；保留其他实物、训练、生命与原始备份，不重算旧配方');
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
  if (oldMookIds.size) changes.push(`旧V2刻度归为编队（${oldMookIds.size}个身份）；保留人数、训练、冻结实例与战斗随机进度，恢复正常成长`);
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
  if (!changes.length) return undefined;
  candidate.schemaVersion = 2;
  delete candidate.roster;
  candidate.unitMigrationWarnings = changes;
  candidate.unitMigrationBackup = units.backup;
  candidate.factRevision = (raw.factRevision ?? 0) + 1;
  return { original, candidate, changes, quarantined };
}
