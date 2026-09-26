import { validateAreas } from '../../engine/src/area-effects.js';
import { validateBarrier } from '../../engine/src/barrier.js';
import { validateAccessories } from '../../engine/src/items.js';
import { validateEnhancements, type Enhancements } from '../../engine/src/enhancements.js';
import { synchronizePersonnel, validateCombatModel } from '../../engine/src/combat-model.js';
import { capSingleLife, limitCombatantLife } from '../../engine/src/health-limits.js';
import { spCapacity } from '../../engine/src/resources.js';
import { traitRegistry } from '../../engine/src/data/traits.js';
import { skillMechanismFromId } from '../../engine/src/data/skill-mechanisms.js';
/**
 * 面板单位持久化与战后提交。
 *
 * UnitRecord 是跨会话的权威单位记录；roster 与 battle.combatants 都只是由记录
 * 实体化出来的运行时副本。所有战后 HP/状态/XP 回写都从战斗副本经这里一次提交，
 * 避免旧副本互相覆盖。
 */

import {
  applyXp,
  DEFAULT_BLUEPRINTS,
  learnAbilities,
  abilityPower,
  generateUnit,
  parseDice,
  stripCarriedItems,
  expireTraitSources,
  validateTraitSource,
  validateTacticalPose,
  validateTacticalEffort,
  validateConcealment,
  validateFlightState,
  validateWounded,
  validateMount,
  validateMoraleState,
  woundedAfterUpdate,
  validateVanguardOrigin,
  validateFormationPosition,
  restoreDeploymentPreference,
  bakedTraitStats,
  normalizeV2Scale,
  type Category,
  type Combatant,
  type GenerateInput,
  type Trait,
  type XpAward,
} from '../../engine/src/index.js';

export const PANEL_SAVE_SCHEMA_VERSION = 2;

export interface UnitRecord {
  recoverableWounded?: number;
  /** 库存实例管理装备；snapshot中的装备仅为该库存关系的冻结投影。 */
  equipmentManaged?: boolean;
  /** 显式转制前的原档；后续成长/战斗也保留，供导出核查。 */
  legacyRecord?: UnitRecord;
  preparedAbilityIds?: string[];
  revision?: number;
  history?: UnitHistoryEntry[];
  /** 解散/阵亡保留身份墓碑，不能被普通 deploy 或补员复活。 */
  retired?: boolean;
  id: string;
  name: string;
  level: number;
  side: Combatant['side'];
  scale: Combatant['scale'];
  archetype?: Combatant['archetype'];
  base: Combatant['base'];
  hp: number;
  morale?: number;
  status?: Combatant['status'];
  conditions?: Combatant['conditions'];
  zone?: '左翼' | '中军' | '右翼';
  rank?: 'front' | 'rear' | 'reserve';
  weaponName?: string;
  weaponId?: string;
  weaponClass?: string;
  weaponLevel?: number;
  loadout?: 'melee' | 'ranged';
  sidearmName?: string;
  sidearmId?: string;
  sidearmClass?: string;
  sidearmLevel?: number;
  armorName?: string;
  armorId?: string;
  armorTier?: 0 | 1 | 2 | 3 | 4;
  armorLevel?: number;
  abilityIds?: string[];
  skills?: { blueprintId?: string; category: Category; level?: number; name?: string }[];
  traits: string[];
  xp?: number;
  note?: string;
  /** AI 遭遇尚未经历战斗时只供当前编制使用，不注入历史储存器。 */
  transient?: boolean;
  /** 精确运行时定义，防止从名称反推装备/技能时发生数值漂移。 */
  snapshot?: Combatant;
}

export interface UnitHistoryEntry {
  recoverableWounded?: number;
  revision: number;
  kind: 'created' | 'battle' | 'update' | 'edit' | 'retired';
  sourceId?: string;
  hp: number;
  hpMax: number;
  level: number;
  xp: number;
  status?: Combatant['status'];
}

export interface CommitBattleStateResult {
  records: UnitRecord[];
  roster: Combatant[];
  survivingIds: string[];
  lostIds: string[];
}

export interface ApplyBattleXpResult {
  applied: boolean;
  committedIds: string[];
  total: number;
  levelUps: { name: string; from: number; to: number }[];
}

export interface CommitBattleOutcomeResult extends CommitBattleStateResult, ApplyBattleXpResult {}

export interface UnitSaveMigrationResult {
  records: UnitRecord[];
  roster: Combatant[];
  warnings: string[];
  backup: unknown[];
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function formationZone(u: Combatant): UnitRecord['zone'] {
  const zone = u.tags.find((t) => t.startsWith('zone:'))?.slice(5);
  return zone === '左翼' || zone === '中军' || zone === '右翼' ? zone : undefined;
}

function formationRank(u: Combatant): UnitRecord['rank'] {
  const rank = u.tags.find((t) => t.startsWith('rank:'))?.slice(5);
  return rank === 'front' || rank === 'rear' || rank === 'reserve' ? rank : undefined;
}

function auditInput(c: Combatant): Partial<GenerateInput> {
  const input = c.genAudit?.input;
  return input && typeof input === 'object' ? (input as Partial<GenerateInput>) : {};
}

function abilityLevelFromAudit(c: Combatant, abilityId: string): number {
  const input = auditInput(c);
  for (const item of input.abilityBlueprints ?? []) {
    const id = typeof item === 'string' ? item : item.id;
    if (id !== abilityId) continue;
    return typeof item === 'string' ? (input.level ?? c.level) : (item.level ?? input.level ?? c.level);
  }
  return c.level;
}

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validateBase(value: unknown): asserts value is Combatant['base'] {
  if (!isRecordObject(value)) throw new Error('缺少 base');
  for (const key of ['atk', 'def', 'spd', 'hpMax']) {
    if (!Number.isFinite(value[key])) throw new Error('base.' + key + ' 非数字');
  }
  if (!Number.isSafeInteger(value.hpMax) || Number(value.hpMax) < 1) throw new Error('base.hpMax 必须为正整数');
}

function validateRuntimeMetadata(value: Record<string, unknown>): void {
  if (value.status !== undefined && (typeof value.status !== 'string' || !['ready', 'dying', 'dead', 'routing', 'fled'].includes(value.status))) throw new Error('单位状态记录损坏');
  if (value.fatigue !== undefined && (!Number.isFinite(value.fatigue) || Number(value.fatigue) < 0)) throw new Error('疲劳记录损坏');
  if (value.resources !== undefined && (!isRecordObject(value.resources) || Object.values(value.resources).some(n => !Number.isFinite(n) || Number(n) < 0))) throw new Error('资源记录损坏');
  if (value.conditions !== undefined && !Array.isArray(value.conditions)) throw new Error('状态列表记录损坏');
  if (value.abilityState !== undefined) {
    if (!Array.isArray(value.abilityState)) throw new Error('技能冷却记录损坏');
    const groups = new Set<string>();
    for (const state of value.abilityState) {
      if (!isRecordObject(state) || typeof state.abilityId !== 'string' || !state.abilityId || !Number.isSafeInteger(state.cdLeft) || Number(state.cdLeft) < 0 || !Number.isSafeInteger(state.used) || Number(state.used) < 0 || groups.has(state.abilityId)) throw new Error('技能冷却/次数记录损坏');
      groups.add(state.abilityId);
    }
  }
  if ((value.xpCurve !== undefined || value.xpLevelStart !== undefined)
    && (value.xpCurve !== 'effort-v1' || !Number.isFinite(value.xpLevelStart))) throw new Error('本级经验进度记录损坏');
  if (Array.isArray(value.conditions)) for (const condition of value.conditions) {
    if (!isRecordObject(condition) || typeof condition.id !== 'string' || !condition.id || !Number.isSafeInteger(condition.dur) || Number(condition.dur) < 0) throw new Error('状态持续时间或结构损坏');
    if(isRecordObject(condition)&&condition.affectedMembers!==undefined&&(!Number.isFinite(condition.affectedMembers)||Number(condition.affectedMembers)<0||Number(condition.affectedMembers)>1e9))throw Error('状态波及人数损坏');
    if (isRecordObject(condition) && condition.potency !== undefined && (!Number.isInteger(condition.potency) || Number(condition.potency) < 1 || Number(condition.potency) > 3)) throw new Error('状态强度记录损坏');
    if (isRecordObject(condition) && condition.magnitude !== undefined && (!Number.isFinite(condition.magnitude) || Number(condition.magnitude) < 0.25 || Number(condition.magnitude) > 1.5)) throw new Error('状态效力记录损坏');
    if (isRecordObject(condition) && condition.sourceId !== undefined && typeof condition.sourceId !== 'string') throw new Error('状态来源记录损坏');
  }
  validateTacticalEffort(value.tacticalEffort);
  validateConcealment(value.tacticalRevealed);
  validateFlightState(value.airborne);
  validateMoraleState(value.moraleState);
  validateWounded(value as unknown as Combatant);
  validateMount(value as unknown as Combatant);
  validateFormationPosition(value.formationPosition);
  validateVanguardOrigin(value.vanguardOrigin, value.side as Combatant['side']);
  if (value.tacticalPose !== undefined) validateTacticalPose(value.tacticalPose as NonNullable<Combatant['tacticalPose']>);
  if (value.bakedTraitStats !== undefined && (!isRecordObject(value.bakedTraitStats) || Object.entries(value.bakedTraitStats).some(([key, n]) => !['atk', 'def', 'spd', 'morale'].includes(key) || !Number.isFinite(n)))) throw new Error('特质基础计入记录损坏');
  if (value.traitSources !== undefined) {
    if (!Array.isArray(value.traitSources)) throw new Error('特质来源结构损坏');
    const ids = new Set<string>();
    for (const source of value.traitSources) {
      validateTraitSource(source);
      if (ids.has(source.id)) throw new Error('特质来源身份重复'); ids.add(source.id);
    }
  }
}
function recordFromUnknown(value: unknown): UnitRecord {
  if (!isRecordObject(value)) throw new Error('不是对象');
  if (typeof value.id !== 'string' || !value.id) throw new Error('缺少 id');
  if (typeof value.name !== 'string' || !value.name) throw new Error('缺少 name');
  if (typeof value.side !== 'string' || !['ally', 'enemy', 'neutral'].includes(value.side)) throw new Error('side 非法');
  if (typeof value.scale !== 'string' || !['hero', 'mook', 'company'].includes(value.scale)) throw new Error('scale 非法');
  validateEnhancements(value.bonuses as Enhancements | undefined,'unit');
  validateBase(value.base);
  validateRuntimeMetadata(value); validateBarrier(value.barrier as Combatant['barrier']); validateAreas(value as unknown as Combatant);
  if (value.hp !== undefined && (!Number.isSafeInteger(value.hp) || Number(value.hp) < 0 || Number(value.hp) > value.base.hpMax)) throw new Error('hp 越界，禁止猜测补满或截断');
  const snapshot = value.snapshot ? combatantFromUnknown(value.snapshot) : undefined;
  return normalizeUnitRecord({
    ...(clone(value) as unknown as UnitRecord),
    ...(snapshot ? { snapshot } : {}),
    traits: Array.isArray(value.traits) ? value.traits.filter((x): x is string => typeof x === 'string') : [],
  });
}

export function combatantFromUnknown(value: unknown): Combatant {
  if (!isRecordObject(value)) throw new Error('不是对象');
  validateCombatModel(value as unknown as Combatant);
  if (typeof value.id !== 'string' || !value.id) throw new Error('缺少 id');
  if (typeof value.name !== 'string' || !value.name) throw new Error('缺少 name');
  if (typeof value.side !== 'string' || !['ally', 'enemy', 'neutral'].includes(value.side)) throw new Error('side 非法');
  if (typeof value.scale !== 'string' || !['hero', 'mook', 'company'].includes(value.scale)) throw new Error('scale 非法');
  validateBase(value.base);
  validateRuntimeMetadata(value);
  validateBarrier(value.barrier as Combatant['barrier']); validateAreas(value as unknown as Combatant); validateAccessories(value as unknown as Combatant);
  for (const slot of ['weapon', 'sidearm']) {
    const item = value[slot]; if (item === undefined) continue;
    if (!isRecordObject(item) || typeof item.name !== 'string' || typeof item.baseDice !== 'string') throw new Error(slot + ' 结构损坏');
    if(isRecordObject(item.recipe))validateEnhancements(item.recipe.bonuses as Enhancements | undefined,'weapon');
    parseDice(item.baseDice);
    if (item.apDice !== undefined) { if (typeof item.apDice !== 'string') throw new Error(slot + ' 破甲骰损坏'); parseDice(item.apDice); }
  }
  if (Array.isArray(value.abilities)) for (const a of value.abilities) {
    if (!isRecordObject(a) || typeof a.id !== 'string' || typeof a.name !== 'string' || !Array.isArray(a.effects)) throw new Error('技能结构损坏');
    validateEnhancements(a.bonuses as Enhancements | undefined,'skill');
    if (a.weaponUse !== undefined && (!['auto', 'melee', 'ranged'].includes(String(a.weaponUse)) || a.damageBasis !== 'weapon')) throw new Error('技能选用武器记录损坏');
    if (a.recipe !== undefined) {
      if (!isRecordObject(a.recipe) || !['skill-formula-v1','skill-formula-v2'].includes(String(a.recipe.version)) || !Number.isInteger(a.recipe.power) || Number(a.recipe.power) < 1 || Number(a.recipe.power) > 10 || a.recipe.power !== a.power
        || typeof a.definitionId !== 'string' || !skillMechanismFromId(a.definitionId) || JSON.stringify(skillMechanismFromId(a.definitionId)) !== JSON.stringify({ category: a.recipe.category, area: a.recipe.area, modifiers: a.recipe.modifiers })) throw new Error('通用技能配方损坏');
    }
    if (a.area !== undefined && (!isRecordObject(a.area) || !['cone','line','ring','chain','circle'].includes(String(a.area.shape)) || !Number.isInteger(a.area.radius) || Number(a.area.radius)<1 || Number(a.area.radius)>3 || !Number.isInteger(a.area.maxTargets) || Number(a.area.maxTargets)<1 || Number(a.area.maxTargets)>8)) throw Error('技能范围不正确');
    if (a.areaExposure !== undefined && (!Number.isInteger(a.areaExposure) || Number(a.areaExposure) < 1 || Number(a.areaExposure) > (['skill-v4.0','skill-v4.1','skill-v4.2'].includes(String(a.effectVersion))?1e9:4) || a.shape !== 'burst' || a.damageBasis !== undefined)) throw new Error('技能范围暴露参数损坏');
    if (a.damageBasis !== undefined && !['weapon', 'shield'].includes(String(a.damageBasis)) || a.weaponDamageMult !== undefined && (!Number.isFinite(a.weaponDamageMult) || Number(a.weaponDamageMult) <= 0 || Number(a.weaponDamageMult) > (['skill-v3.0','skill-v4.0','skill-v4.1','skill-v4.2'].includes(String(a.effectVersion)) ? 4 : 2)) || a.delivery !== undefined && !['melee', 'ranged', 'magic'].includes(String(a.delivery))) throw new Error('技能装备基准损坏');
    if(a.damageScale!==undefined&&(!Number.isFinite(a.damageScale)||Number(a.damageScale)<=0||Number(a.damageScale)>1e6))throw Error('技能等级倍率损坏');
    for (const effect of a.effects) {
      if (isRecordObject(effect) && effect.op === 'zone' && (!['fire','poison','smoke','healing','trap'].includes(String(effect.kind)) || !Number.isInteger(effect.power) || Number(effect.power)<1 || Number(effect.power)>10 || !Number.isInteger(effect.dur) || Number(effect.dur)<1 || Number(effect.dur)>99 || !Number.isInteger(effect.radius) || Number(effect.radius)<0 || Number(effect.radius)>3)) throw Error('持续区域的范围或时间不正确');
      if (isRecordObject(effect) && effect.op === 'barrier') validateBarrier({ remaining: effect.amount as number, duration: effect.dur as number });
      if (!isRecordObject(effect) || !['damage', 'heal', 'condition', 'trait', 'push', 'dispel', 'resource', 'morale', 'summon', 'barrier', 'zone'].includes(String(effect.op))) throw new Error('技能包含未支持的效果处理');
      if (effect.magnitude !== undefined && (!Number.isFinite(effect.magnitude) || Number(effect.magnitude) < 0.25 || Number(effect.magnitude) > 1.5) || effect.onDamage !== undefined && typeof effect.onDamage !== 'boolean') throw new Error('技能效力或损伤前提损坏');
      if (effect.op === 'trait' && (!traitRegistry().get(String(effect.traitId))?.v2SourceReady || !Number.isInteger(effect.dur) || Number(effect.dur) < 1 || Number(effect.dur) > 99)) throw new Error('技能授予来源损坏');
      if (effect.direction !== undefined && !['away', 'towards'].includes(String(effect.direction)) || effect.maximum !== undefined && effect.maximum !== 'training') throw new Error('技能位移或资源边界损坏');
      if (effect.onHit !== undefined && typeof effect.onHit !== 'boolean' || effect.shape !== undefined && !['single', 'burst'].includes(String(effect.shape))) throw new Error('技能触发或范围参数损坏');
      if (effect.op === 'push' && (effect.steps !== 1 || !Number.isInteger(effect.force) || Number(effect.force) < 1 || Number(effect.force) > 4)) throw new Error('推动参数损坏');
      if (effect.op === 'dispel' && (!['positive', 'negative'].includes(String(effect.polarity)) || !Number.isInteger(effect.count) || ![1, 2].includes(Number(effect.count)))) throw new Error('解除参数损坏');
      if (effect.op === 'condition' && (effect.potency !== undefined && (!Number.isInteger(effect.potency) || Number(effect.potency) < 1 || Number(effect.potency) > 3) || effect.saveDC !== undefined && (!Number.isInteger(effect.saveDC) || Number(effect.saveDC) < 1 || Number(effect.saveDC) > 30))) throw new Error('技能状态强度或抵抗参数损坏');
      if (effect.op === 'heal' && effect.amount !== undefined) {
        if (!Number.isSafeInteger(effect.amount) || Number(effect.amount) < 1 || effect.dice !== undefined) throw new Error('治疗量损坏');
      } else if (effect.op === 'damage' || effect.op === 'heal') {
        const dice = effect.op === 'damage' ? effect.baseDice : effect.dice;
        if (typeof dice !== 'string') throw new Error('技能骰子缺失'); parseDice(dice);
      }
    }
  }
  const hp = value.hp === undefined ? value.base.hpMax : value.hp;
  if (typeof hp !== 'number' || !Number.isSafeInteger(hp) || hp < 0 || hp > value.base.hpMax) throw new Error('战斗存档记录生命/人数越界');
  return {
    ...(clone(value) as unknown as Combatant),
    level: Number.isFinite(value.level) ? Math.max(1, Math.round(Number(value.level))) : 1,
    hp,
    tags: Array.isArray(value.tags) ? value.tags.filter((x): x is string => typeof x === 'string') : [],
    conditions: Array.isArray(value.conditions) ? clone(value.conditions as Combatant['conditions']) : [],
    abilities: Array.isArray(value.abilities) ? clone(value.abilities as Combatant['abilities']) : [],
    abilityState: Array.isArray(value.abilityState) ? clone(value.abilityState as Combatant['abilityState']) : [],
    resources: isRecordObject(value.resources) ? clone(value.resources as Combatant['resources']) : {},
    traits: Array.isArray(value.traits) ? value.traits.filter((x): x is string => typeof x === 'string') : [],
    engagedWith: Array.isArray(value.engagedWith) ? value.engagedWith.filter((x): x is string => typeof x === 'string') : [],
    status: ['ready', 'dying', 'dead', 'routing', 'fled'].includes(String(value.status))
      ? value.status as Combatant['status']
      : hp > 0 ? 'ready' : 'dead',
    fatigue: Number.isFinite(value.fatigue) ? Number(value.fatigue) : 0,
  };
}

/** PanelSave V1/V2 的单位部分迁移；逐条隔离坏数据并返回原样备份。 */
export function migratePanelUnits(opts: {
  schemaVersion?: number;
  rosterIds?: unknown;
  roster?: unknown;
  storage?: unknown;
  encounterIds?: Iterable<string>;
  registry: Map<string, Trait>;
  era?: string;
}): UnitSaveMigrationResult {
  const warnings: string[] = [];
  const backup: unknown[] = [];
  const records: UnitRecord[] = [];
  const encounters = new Set(opts.encounterIds ?? []);
  const rawStorage = Array.isArray(opts.storage) ? opts.storage : [];

  rawStorage.forEach((raw, index) => {
    try {
      const record = recordFromUnknown(raw);
      if (encounters.has(record.id)) record.transient = true;
      const oldIndex = records.findIndex((r) => r.id === record.id);
      if (oldIndex >= 0) {
        warnings.push('storage[' + index + '] 与已有 id=' + record.id + ' 重复，隔离冲突项，保留首条待核查');
        backup.push(raw);
      } else {
        records.push(record);
      }
    } catch (error) {
      warnings.push('storage[' + index + '] 无法迁移：' + (error instanceof Error ? error.message : String(error)));
      backup.push(raw);
    }
  });

  const roster: Combatant[] = [];
  // 已有明确出场id时优先恢复；早期正文事务可能遗漏schemaVersion，不能把名单当旧格式丢掉。
  if (Array.isArray(opts.rosterIds)) {
    for (const rawId of opts.rosterIds) {
      if (typeof rawId !== 'string') {
        warnings.push('rosterIds 中存在非字符串 id');
        backup.push(rawId);
        continue;
      }
      if (roster.some((u) => u.id === rawId)) { warnings.push('rosterIds 重复引用 id=' + rawId + '，仅部署一次'); continue; }
      const record = records.find((r) => r.id === rawId);
      if (!record) {
        warnings.push('roster 引用了缺失档案 id=' + rawId);
        continue;
      }
      try {
        roster.push(materializeUnitRecord(record, opts.registry, { era: opts.era }));
      } catch (error) {
        warnings.push('id=' + rawId + ' 无法还原：' + (error instanceof Error ? error.message : String(error)));
        backup.push(record);
      }
    }
  } else {
    const rawRoster = Array.isArray(opts.roster) ? opts.roster : [];
    rawRoster.forEach((raw, index) => {
      try {
        const unit = combatantFromUnknown(raw);
        const recordIndex = records.findIndex((r) => r.id === unit.id);
        const merged = mergeLegacyUnitRecord(recordIndex >= 0 ? records[recordIndex] : undefined, unit);
        if (encounters.has(unit.id)) merged.transient = true;
        if (recordIndex >= 0) records[recordIndex] = merged;
        else records.push(merged);
        roster.push(materializeUnitRecord(merged, opts.registry, { era: opts.era }));
      } catch (error) {
        warnings.push('roster[' + index + '] 无法迁移：' + (error instanceof Error ? error.message : String(error)));
        backup.push(raw);
      }
    });
  }

  return { records, roster, warnings, backup };
}

/** 旧记录归一化；不会用默认值覆盖已有 0 HP。 */
export function normalizeUnitRecord(r: UnitRecord): UnitRecord {
  const hpMax = Math.max(1, Number(r.base?.hpMax) || 1);
  const moraleMax = r.base?.moraleMax;
  const normalized: UnitRecord = {
    ...r,
    revision: Number.isSafeInteger(r.revision) && r.revision! > 0 ? r.revision : 1,
    history: clone(r.history ?? []),
    base: { ...r.base, hpMax },
    hp: Number.isFinite(r.hp) ? Math.max(0, Math.min(hpMax, r.hp)) : hpMax,
    status: r.status ?? (Number.isFinite(r.hp) && r.hp <= 0 ? 'dead' : 'ready'),
    conditions: Array.isArray(r.conditions) ? clone(r.conditions) : [],
    traits: Array.isArray(r.traits) ? [...new Set(r.traits)] : [],
    xp: Number.isFinite(r.xp) ? Math.max(0, r.xp!) : 0,
  };
  if (moraleMax !== undefined) {
    normalized.morale = Number.isFinite(r.morale)
      ? Math.max(0, Math.min(moraleMax, r.morale!))
      : moraleMax;
  } else {
    delete normalized.morale;
  }
  if (r.snapshot) normalized.snapshot = clone(r.snapshot);
  const lifeChanged = limitCombatantLife(normalized as unknown as Combatant);
  const membersChanged = normalized.snapshot ? limitCombatantLife(normalized.snapshot) : false;
  if (lifeChanged || membersChanged) {
    if (normalized.snapshot && normalized.scale === 'hero') {
      normalized.snapshot.hp = normalized.hp; normalized.snapshot.base.hpMax = normalized.base.hpMax;
    }
    // 规则归一化保留记录版本；进行中战斗仍须能按其原始recordRevision提交。
  }
  validateWounded(normalized);
  return normalized;
}

/** Combatant → 权威记录；每次合法写入递增版本并保留身份历史。 */
export function unitRecordFromCombatant(
  c: Combatant,
  previous?: UnitRecord,
  opts: { transient?: boolean; kind?: UnitHistoryEntry['kind']; sourceId?: string } = {},
): UnitRecord {
  c = stripCarriedItems(c); delete c.barrier; delete c.battleZones;
  if(opts.kind==='battle')delete c.storyState;
  limitCombatantLife(c);
  delete c.nonLethal;delete c.cannonAmmo;
  delete c.airborne; delete c.formationPosition;
  restoreDeploymentPreference(c);
  delete c.tacticalPose;
  delete c.moraleState;
  delete c.tacticalEffort;
  delete c.tacticalRevealed;
  delete c.airborne;
  normalizeV2Scale(c);
  synchronizePersonnel(c, true);
  if (c.rulesVersion === 'v2') c.bakedTraitStats ??= bakedTraitStats(c);
  const input = auditInput(c);
  const record: UnitRecord = {
    id: c.id,
    ...(previous?.equipmentManaged ? { equipmentManaged: true } : {}),
    preparedAbilityIds: c.preparedAbilityIds ? [...c.preparedAbilityIds] : input.preparedAbilityIds ? [...input.preparedAbilityIds] : undefined,
    revision: previous ? (previous.revision ?? 1) + 1 : 1,
    history: clone(previous?.history ?? []),
    ...(previous?.retired ? { retired: true } : {}),
    ...(previous?.legacyRecord ? { legacyRecord: clone(previous.legacyRecord) } : {}),
    name: c.name,
    level: c.level,
    side: c.side,
    scale: c.scale,
    archetype: c.archetype,
    base: clone(c.base),
    hp: Math.max(0, Math.min(c.base.hpMax, c.hp)),
    ...(c.recoverableWounded !== undefined ? { recoverableWounded: c.recoverableWounded } : {}),
    ...(c.morale !== undefined ? { morale: c.morale } : {}),
    status: c.status,
    conditions: clone(c.conditions),
    ...(formationZone(c) ? { zone: formationZone(c) } : {}),
    ...(formationRank(c) ? { rank: formationRank(c) } : {}),
    ...(c.weapon
      ? {
          weaponName: c.weapon.name,
          weaponId: input.weaponId,
          weaponClass: input.weaponClass,
          weaponLevel: input.weaponLevel,
          loadout: input.loadout,
        }
      : {}),
    ...(c.sidearm
      ? {
          sidearmName: c.sidearm.name,
          sidearmId: input.sidearmId,
          sidearmClass: input.sidearmClass,
          sidearmLevel: input.sidearmLevel,
        }
      : {}),
    ...(c.armor
      ? {
          armorName: c.armor.name,
          armorId: input.armorId,
          armorTier: c.armor.tier,
          armorLevel: input.armorLevel,
        }
      : {}),
    ...(input.abilityIds?.length ? { abilityIds: [...input.abilityIds] } : {}),
    skills: c.abilities
      .filter((a) => a.definitionId?.startsWith('bp-') || a.id.startsWith('bp-'))
      .map((a) => ({
        blueprintId: a.definitionId ?? a.id,
        category: (a.category ?? 'phys-single') as Category,
        level: a.fixedPower ? undefined : c.rulesVersion === 'v2' ? abilityPower(c, a) : abilityLevelFromAudit(c, a.definitionId ?? a.id),
        name: a.name,
      })),
    traits: [...c.traits],
    xp: c.xp ?? 0,
    ...(previous?.note ? { note: previous.note } : {}),
    ...(opts.transient ?? previous?.transient ? { transient: true } : {}),
    snapshot: clone(c),
  };
  record.history!.push({
    revision: record.revision!, kind: opts.kind ?? (previous ? 'edit' : 'created'),
    ...(opts.sourceId ? { sourceId: opts.sourceId } : {}),
    hp: record.hp, hpMax: record.base.hpMax, ...(record.recoverableWounded !== undefined ? { recoverableWounded: record.recoverableWounded } : {}), level: record.level, xp: record.xp ?? 0, status: record.status,
  });
  return normalizeUnitRecord(record);
}

export function blueprintIdForCategory(cat: Category): string {
  return DEFAULT_BLUEPRINTS[cat] ?? 'bp-crushing-blow';
}

export function unitRecordToGenerateInput(r: UnitRecord, era = 'medieval'): GenerateInput {
  return {
    weaponStabilized: r.snapshot?.weapon?.recipe?.stabilized,
    sidearmStabilized: r.snapshot?.sidearm?.recipe?.stabilized,
    armorProfile: r.snapshot?.armor?.recipe?.protectionProfile,
    weaponEnchantment: r.snapshot?.weapon?.recipe?.enchantment,
    sidearmEnchantment: r.snapshot?.sidearm?.recipe?.enchantment,
    rulesVersion: r.snapshot?.rulesVersion,
    body: r.snapshot?.body,
    mount: r.snapshot?.mount,
    quality: r.snapshot?.genAudit?.input.quality,
    shield: !!r.snapshot?.shield,
    hp: r.hp,
    hpMax: r.base.hpMax,
    preparedAbilityIds: r.preparedAbilityIds ?? r.snapshot?.genAudit?.input.preparedAbilityIds,
    name: r.name,
    scale: r.scale,
    archetype: r.archetype,
    level: r.level,
    traits: [...r.traits],
    side: r.side,
    era,
    ...(r.loadout ? { loadout: r.loadout } : {}),
    ...(r.weaponId ? { weaponId: r.weaponId } : {}),
    ...(r.weaponName ? { weaponName: r.weaponName } : {}),
    ...(r.weaponClass ? { weaponClass: r.weaponClass } : {}),
    ...(r.weaponLevel ? { weaponLevel: r.weaponLevel } : {}),
    ...(r.sidearmName ? { sidearmName: r.sidearmName } : {}),
    ...(r.sidearmId ? { sidearmId: r.sidearmId } : {}),
    ...(r.sidearmClass ? { sidearmClass: r.sidearmClass } : {}),
    ...(r.sidearmLevel ? { sidearmLevel: r.sidearmLevel } : {}),
    ...(r.armorId ? { armorId: r.armorId } : {}),
    ...(r.armorName ? { armorName: r.armorName } : {}),
    ...(r.armorTier !== undefined ? { armorTier: r.armorTier } : {}),
    ...(r.armorLevel ? { armorLevel: r.armorLevel } : {}),
    ...(r.abilityIds?.length ? { abilityIds: [...r.abilityIds] } : {}),
    ...(r.skills?.length
      ? {
          abilityBlueprints: r.skills.map((s) => ({
            id: s.blueprintId ?? blueprintIdForCategory(s.category),
            ...(s.level ? { level: s.level } : {}),
            ...(s.name ? { name: s.name } : {}),
          })),
        }
      : {}),
  };
}

/** 转制只生成可审查副本；不改源记录、不自动扩编或补满。 */
export function previewUnitConversion(record: UnitRecord, registry: Map<string, Trait>): UnitRecord {
  if (record.snapshot?.rulesVersion === 'v2') throw new Error('该单位已使用V2效果');
  if (record.traits.some((id) => ['large', 'titan', 'flying'].includes(id))) throw new Error('旧体量/飞行标签不能猜测转换，请先明确身体效果');
  const input = unitRecordToGenerateInput(record);
  const source = record.snapshot;
  const weaponId = input.weaponId ?? source?.genAudit?.weapon?.profileId;
  if (!weaponId && !input.weaponClass) throw new Error('旧武器缺少明确效果来源，请先编辑武器类型再更新规则');
  if (source?.abilities.some((a) => !a.definitionId?.startsWith('bp-') && !a.id.startsWith('bp-'))) throw new Error('旧固定技能缺少明确配方，请先在编辑中替换为已支持的技能');
  const unit = generateUnit({ ...input, rulesVersion: 'v2', era: undefined,
    weaponId,
    weaponLevel: source?.weapon?.level ?? record.weaponLevel ?? 5,
    sidearmLevel: source?.sidearm?.level ?? record.sidearmLevel ?? 5,
    armorLevel: source?.armor?.level ?? record.armorLevel ?? 5,
    reserves: source?.resources.reserve ?? 0,
  }, { registry, seed: `conversion:${record.id}:${record.revision ?? 1}` }).unit;
  unit.id = record.id; unit.xp = record.xp ?? 0; unit.status = record.status ?? unit.status;
  unit.xpCurve = source?.xpCurve; unit.xpLevelStart = source?.xpLevelStart;
  unit.conditions = clone(record.conditions ?? []); unit.morale = record.morale;
  for (const ability of unit.abilities) ability.sourceId = record.id;
  const next = unitRecordFromCombatant(unit, record, { kind: 'edit', sourceId: 'mechanism-v2-conversion' });
  next.legacyRecord = clone(record); next.zone = record.zone; next.rank = record.rank;
  return next;
}

/** 仅撤销刚执行的转制；发生新战损/补员/成长后禁止旧备份覆盖新事实。 */
export function undoUnitConversion(record: UnitRecord): UnitRecord {
  if (!record.legacyRecord || record.history?.at(-1)?.sourceId !== 'mechanism-v2-conversion') throw new Error('更新规则后已有新战斗记录，不能用旧备份覆盖；原档仍可导出核查');
  const original = clone(record.legacyRecord); original.revision = (record.revision ?? 1) + 1;
  original.history = [...clone(record.history ?? []), { revision: original.revision, kind: 'edit', sourceId: 'undo-v2-conversion', hp: original.hp, hpMax: original.base.hpMax, level: original.level, xp: original.xp ?? 0, status: original.status }];
  return original;
}

/**
 * 权威记录 → 新战斗单位。snapshot 保留精确装备与技能；战斗态字段重置。
 * forceRegenerate 供储存器编辑保存后按新配置重建 snapshot。
 */
export function materializeUnitRecord(
  r0: UnitRecord,
  registry: Map<string, Trait>,
  opts: { forceRegenerate?: boolean; era?: string } = {},
): Combatant {
  const r = normalizeUnitRecord(r0);
  const generated = opts.forceRegenerate || !r.snapshot
    ? generateUnit(unitRecordToGenerateInput(r, opts.era), {
        registry,
        seed: r.snapshot?.genAudit?.seed ?? 'unit-record:' + r.id,
      }).unit
    : combatantFromUnknown(r.snapshot);
  generated.id = r.id;
  if (generated.rulesVersion === 'v2') generated.bakedTraitStats ??= bakedTraitStats(generated, registry);
  generated.recordRevision = r.revision;
  generated.name = r.name;
  generated.level = r.level;
  generated.side = r.side;
  generated.scale = r.scale;
  generated.archetype = r.archetype;
  generated.base = clone(r.base);
  generated.hp = Math.max(0, Math.min(generated.base.hpMax, r.hp));
  if (r.recoverableWounded !== undefined) generated.recoverableWounded = r.recoverableWounded;
  else delete generated.recoverableWounded;
  generated.morale =
    r.base.moraleMax !== undefined
      ? Math.max(0, Math.min(r.base.moraleMax, r.morale ?? r.base.moraleMax))
      : undefined;
  generated.conditions = clone(r.conditions ?? []);
  generated.xp = r.xp ?? 0;
  generated.xpCurve = r.snapshot?.xpCurve; generated.xpLevelStart = r.snapshot?.xpLevelStart;
  generated.traits = [...r.traits];
  if (generated.rulesVersion === 'v2' && r.preparedAbilityIds) {
    generated.preparedAbilityIds = generated.abilities.filter((a) => r.preparedAbilityIds!.includes(a.id) || r.preparedAbilityIds!.includes(a.definitionId ?? a.id)).map((a) => a.id);
  }
  generated.tags = [
    ...generated.tags.filter((t) => !t.startsWith('zone:') && !t.startsWith('rank:')),
    ...(r.zone ? ['zone:' + r.zone] : []),
    ...(r.rank ? ['rank:' + r.rank] : []),
  ];
  if(!generated.storyState?.abilityState)generated.abilityState = [];
  generated.engagedWith = [];
  normalizeV2Scale(generated);
  generated.status = r.status === 'dying' ? 'dying' : generated.hp > 0 ? (r.status ?? 'ready') : 'dead';
  if(!generated.storyState?.fatigue)generated.fatigue = 0;
  delete generated.suppression;
  delete generated.tacticalPose;
  delete generated.moraleState;
  delete generated.tacticalEffort;
  delete generated.tacticalRevealed;
  delete generated.airborne;
  delete generated.formationPosition;
  delete generated.vanguardOrigin;
  delete generated.pos;
  if (!generated.storyState?.resources) {
    if (generated.rulesVersion === 'v2') generated.resources = { ...generated.resources, SP: spCapacity(generated) };
    else if (generated.scale === 'hero') generated.resources = { ...generated.resources, SP: 3 + generated.level };
  }
  synchronizePersonnel(generated,true);
  return generated;
}

/** 合并旧版 roster/storage：战损取 storage，成长取 XP/等级更高的一侧。 */
export function mergeLegacyUnitRecord(existing: UnitRecord | undefined, rosterUnit: Combatant): UnitRecord {
  const fromRoster = unitRecordFromCombatant(rosterUnit, existing, { transient: existing?.transient });
  if (!existing) return fromRoster;
  const old = normalizeUnitRecord(existing);
  const progression = fromRoster.level > old.level
    || (fromRoster.level === old.level && (fromRoster.xp ?? 0) >= (old.xp ?? 0))
    ? fromRoster
    : old;
  return normalizeUnitRecord({
    ...progression,
    // 旧 roster 等级不能把 storage 的明确编制上限降回曲线。
    base: { ...progression.base, ...(old.scale !== 'hero' ? { hpMax: old.base.hpMax } : {}) },
    hp: old.hp,
    recoverableWounded: old.recoverableWounded,
    morale: old.morale,
    status: old.status,
    conditions: old.conditions,
    zone: old.zone,
    rank: old.rank,
    note: old.note,
    transient: old.transient,
  });
}

/** 战斗 id：种子会进入快照，关闭/恢复后仍稳定。 */
export function battleOutcomeId(kind: 'small' | 'mass', seed: string): string {
  return kind + ':' + seed;
}

/** XP 只应用到战斗权威副本一次；之后由 commitBattleState 统一回写。 */
export function applyBattleXpOnce(opts: {
  battleId: string;
  committedIds: string[];
  combatants: Combatant[];
  awards: XpAward[];
  registry: Map<string, Trait>;
}): ApplyBattleXpResult {
  if (opts.committedIds.includes(opts.battleId)) {
    return {
      applied: false,
      committedIds: [...opts.committedIds],
      total: 0,
      levelUps: [],
    };
  }
  let total = 0;
  const levelUps: ApplyBattleXpResult['levelUps'] = [];
  for (const award of opts.awards) {
    const unit = opts.combatants.find((c) => c.id === award.unitId);
    if (!unit || unit.scale === 'mook' && unit.rulesVersion !== 'v2') continue;
    const result = applyXp(unit, award.total, opts.registry);
    total += award.total;
    if (result.levelsGained > 0) {
      levelUps.push({ name: unit.name, from: result.fromLevel, to: result.toLevel });
    }
  }
  return {
    applied: true,
    committedIds: [...opts.committedIds, opts.battleId],
    total,
    levelUps,
  };
}

/**
 * 内部结果准备：只更新已有身份，阵亡保留墓碑，战中召唤不自动建档；
 * roster 中只更新已上场的同 id 单位，是否把撤离者移出上场编制由战后归档动作决定。
 */
export function commitBattleState(opts: {
  records: UnitRecord[];
  roster: Combatant[];
  combatants: Combatant[];
  battleId?: string;
}): CommitBattleStateResult {
  const lostIds = opts.combatants
    .filter((c) => c.hp <= 0 || c.status === 'dead')
    .map((c) => c.id);
  const lost = new Set(lostIds);
  const live = new Map(
    opts.combatants
      .filter((c) => !lost.has(c.id))
      .map((c) => [c.id, c] as const),
  );

  const records = opts.records.map((previous) => {
    const combatant = opts.combatants.find((c) => c.id === previous.id);
    if (!combatant) return clone(previous);
    const next = unitRecordFromCombatant(combatant, previous, {
      transient: false, kind: 'battle', sourceId: opts.battleId,
    });
    if (lost.has(combatant.id)) {
      next.hp = 0;
      next.status = combatant.status === 'dying' ? 'dying' : 'dead';
    }
    return next;
  });

  const roster = opts.roster
    .filter((u) => !lost.has(u.id))
    .map((u) => {
      const current = live.get(u.id);
      const next = current ? clone(current) : clone(u);
      next.recordRevision = records.find((r) => r.id === next.id)?.revision;
      return next;
    });

  return {
    records,
    roster,
    survivingIds: [...live.keys()],
    lostIds,
  };
}

/**
 * 战后唯一提交入口：先在战斗事实源上幂等应用 XP，再把战损、成长与阵亡作为
 * 同一结果写回记录和编制。调用方只需一次替换全部返回字段。
 */
export function commitBattleOutcome(opts: {
  battleId: string;
  committedIds: string[];
  records: UnitRecord[];
  roster: Combatant[];
  combatants: Combatant[];
  awards: XpAward[];
  registry: Map<string, Trait>;
}): CommitBattleOutcomeResult {
  // 必须在任何 HP/状态/XP 写回之前检查完整结果；历史 id 不能滚动淘汰后再次生效。
  if (opts.committedIds.includes(opts.battleId)) {
    return {
      records: clone(opts.records), roster: clone(opts.roster),
      survivingIds: [], lostIds: [], applied: false,
      committedIds: [...opts.committedIds], total: 0, levelUps: [],
    };
  }
  // 准备结果不得修改输入，保存失败可按同一原始战斗快照重试。
  const combatants = clone(opts.combatants);
  for (const combatant of combatants) {
    const record = opts.records.find((r) => r.id === combatant.id);
    if (record && combatant.recordRevision !== undefined && combatant.recordRevision !== (record.revision ?? 1)) {
      throw new Error(`档案 ${record.id} 已更新，旧战斗无权覆盖（${combatant.recordRevision} → ${record.revision ?? 1}）`);
    }
  }
  const xp = applyBattleXpOnce({
    battleId: opts.battleId,
    committedIds: opts.committedIds,
    combatants,
    awards: opts.awards,
    registry: opts.registry,
  });
  for (const unit of combatants) expireTraitSources(unit, 'battles');
  const committed = commitBattleState({
    battleId: opts.battleId,
    records: opts.records,
    roster: opts.roster,
    combatants,
  });
  return { ...committed, ...xp };
}

export type UnitUpdate = {
  hp?: number; hpMax?: number; morale?: number; state?: Combatant['status']; clear?: string[]; reason?: string;
};

/** 战外稀疏绝对更新：拒绝越界与隐式减员，不修改输入或旧战斗副本。 */
export function updateUnitRecord(record: UnitRecord, patch: UnitUpdate, registry: Map<string, Trait>, sourceId?: string): UnitRecord {
  record = normalizeUnitRecord(record);
  const dyingHero = record.status === 'dying';
  if (record.retired || record.status === 'dead' || record.hp <= 0 && !dyingHero) throw new Error('阵亡/解散档案不能通过普通补员复活');
  const requestedMax = patch.hpMax ?? record.base.hpMax, requestedHp = patch.hp ?? record.hp;
  if (!Number.isSafeInteger(requestedMax) || requestedMax < 1 || !Number.isSafeInteger(requestedHp) || requestedHp < 0) throw new Error('生命/人数必须是有效整数');
  const hpMax = record.scale === 'hero' ? capSingleLife(requestedMax) : requestedMax;
  const hp = record.scale === 'hero' ? capSingleLife(requestedHp) : requestedHp;
  if (!Number.isSafeInteger(hpMax) || hpMax < 1 || hpMax > 1_000_000_000) throw new Error('上限必须是 1–1000000000 的整数');
  if (!Number.isSafeInteger(hp) || hp < 0 || hp > hpMax) throw new Error('当前值不能超出上限；缩编减员需明确 hp');
  if (patch.state === 'dead' && hp > 0) throw new Error('阵亡必须明确 hp=0');
  if (hp === 0 && patch.state && patch.state !== 'dead') throw new Error('0 生命/兵力不能处于可出场状态');
  const unit = materializeUnitRecord(record, registry);
  const wounded = woundedAfterUpdate(unit, hp, hpMax);
  if (wounded !== undefined) unit.recoverableWounded = wounded;
  unit.base.hpMax = hpMax;
  unit.hp = hp; synchronizePersonnel(unit,true);
  if (patch.morale !== undefined) {
    if (unit.base.moraleMax === undefined || !Number.isSafeInteger(patch.morale) || patch.morale < 0 || patch.morale > unit.base.moraleMax) throw new Error('士气超出合法范围');
    unit.morale = patch.morale;
  }
  unit.status = patch.state ?? (hp === 0 ? dyingHero ? 'dying' : 'dead' : dyingHero && patch.hp !== undefined ? 'ready' : unit.status);
  if (patch.clear?.length) {
    unit.conditions = patch.clear.includes('all') || patch.clear.includes('全部') ? [] : unit.conditions.filter((c) => !patch.clear!.includes(c.id));
  }
  return unitRecordFromCombatant(unit, record, { kind: 'update', sourceId });
}

/** 每次部署从权威档案派生；幂等只针对 id，不保留过期 roster 内容。 */
export function deployUnitRecord(records: UnitRecord[], roster: Combatant[], id: string, registry: Map<string, Trait>): Combatant[] {
  const record = records.find((r) => r.id === id);
  if (!record) throw new Error(`缺少档案 ${id}`);
  if (record.retired || record.hp <= 0 || record.status === 'dead' || record.status === 'dying') throw new Error('阵亡、解散或濒死单位不能出场');
  const unit = materializeUnitRecord(record, registry);
  // 撤离/溃逃属于上一战；仍保留士气与长期伤势，重新部署只清战斗位置和行动状态。
  if (unit.status === 'fled' || unit.status === 'routing') unit.status = 'ready';
  return roster.some((u) => u.id === id)
    ? roster.map((u) => u.id === id ? unit : clone(u))
    : [...clone(roster), unit];
}

/** 有来源的战外学习，保留既有数值、资源与历史；新战斗再按生命周期重置预算。 */
export function learnUnitRecord(record: UnitRecord, skills: NonNullable<Combatant['genAudit']>['input']['abilityBlueprints'], registry: Map<string, Trait>, sourceId: string): UnitRecord {
  if (record.retired || record.hp <= 0 || record.status === 'dead') throw new Error('阵亡或解散档案不能学习');
  const unit = materializeUnitRecord(record, registry);
  if (record.snapshot) { unit.abilityState = clone(record.snapshot.abilityState); unit.resources = clone(record.snapshot.resources); }
  const learned = learnAbilities(unit, skills ?? [], { rebuildRequested: true });
  return unitRecordFromCombatant(learned, record, { kind: 'edit', sourceId });
}

/** 编辑档案只重建显式变更的装备/技能；改名、补员、升级不洗其他实例。 */
export function editUnitRecord(previous: UnitRecord, edited: UnitRecord, registry: Map<string, Trait>, era?: string): UnitRecord {
  edited = clone(edited);
  const wounded = woundedAfterUpdate(previous, edited.hp, edited.base.hpMax);
  if (wounded !== undefined) edited.recoverableWounded = wounded;
  const keys = {
    weapon: ['weaponName', 'weaponId', 'weaponClass', 'weaponLevel', 'loadout'],
    sidearm: ['sidearmName', 'sidearmId', 'sidearmClass', 'sidearmLevel'],
    armor: ['armorName', 'armorId', 'armorTier', 'armorLevel'],
    abilities: ['abilityIds', 'skills', 'preparedAbilityIds'],
  } as const;
  const changed = (fields: readonly (keyof UnitRecord)[]) => fields.some((key) => JSON.stringify(previous[key]) !== JSON.stringify(edited[key]));
  const old = materializeUnitRecord(previous, registry, { era });
  const unit = materializeUnitRecord(edited, registry, { era });
  const gearChanged = [keys.weapon, keys.sidearm, keys.armor].some(changed);
  if (gearChanged || unit.rulesVersion !== 'v2' && changed(keys.abilities)) {
    const generated = materializeUnitRecord(edited, registry, { forceRegenerate: true, era });
    unit.weapon = changed(keys.weapon) ? generated.weapon : old.weapon;
    unit.sidearm = changed(keys.sidearm) ? generated.sidearm : old.sidearm;
    unit.armor = changed(keys.armor) ? generated.armor : old.armor;
    unit.abilities = unit.rulesVersion !== 'v2' && changed(keys.abilities) ? generated.abilities : old.abilities;
    if (unit.rulesVersion !== 'v2' && changed(keys.abilities)) unit.preparedAbilityIds = generated.preparedAbilityIds;
    if (unit.genAudit) {
      const preservedSkills = unit.genAudit.input.abilityBlueprints;
      unit.genAudit.input = { ...unit.genAudit.input, ...unitRecordToGenerateInput(edited, era) };
      if (unit.rulesVersion === 'v2') unit.genAudit.input.abilityBlueprints = preservedSkills;
    }
  }
  if (unit.rulesVersion === 'v2' && changed(keys.abilities)) {
    if (changed(['abilityIds']) && edited.abilityIds?.length) throw new Error('V2学习需要明确技能蓝图');
    if (previous.snapshot) { unit.abilityState = clone(previous.snapshot.abilityState); unit.resources = clone(previous.snapshot.resources); }
    const specs = changed(['skills']) ? (edited.skills ?? []).map((skill) => {
      const id = skill.blueprintId ?? blueprintIdForCategory(skill.category), oldSpec = previous.skills?.find((s) => (s.blueprintId ?? blueprintIdForCategory(s.category)) === id);
      return { id, name: skill.name, ...(oldSpec?.level === skill.level ? {} : { level: skill.level }) };
    }) : [];
    Object.assign(unit, learnAbilities(unit, specs, { replace: changed(['skills']), prepared: changed(['preparedAbilityIds']) ? edited.preparedAbilityIds : undefined }));
  }
  const result = unitRecordFromCombatant(unit, previous, { kind: edited.retired ? 'retired' : 'edit' });
  // 精确实例为真值；稀疏编辑配方必须与其一起保存，供下次显式换装使用。
  for (const fields of unit.rulesVersion === 'v2' ? [keys.weapon, keys.sidearm, keys.armor] : Object.values(keys)) for (const key of fields) {
    Object.assign(result, { [key]: edited[key] });
  }
  result.note = edited.note;
  result.retired = edited.retired;
  return result;
}
