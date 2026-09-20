import { describe, expect, it } from 'vitest';
import { applyXp, generateUnit, traitRegistry, type Combatant, type XpAward } from '../../engine/src/index.js';
import {
  battleOutcomeId,
  commitBattleOutcome,
  commitBattleState,
  materializeUnitRecord,
  mergeLegacyUnitRecord,
  migratePanelUnits,
  unitRecordFromCombatant,
  updateUnitRecord,
  deployUnitRecord,
  editUnitRecord,
} from './unit-state.js';

const reg = traitRegistry();

function makeUnit(
  id: string,
  opts: { side?: 'ally' | 'enemy'; scale?: 'hero' | 'mook' | 'company'; level?: number } = {},
): Combatant {
  const { unit } = generateUnit(
    {
      name: id,
      side: opts.side ?? 'ally',
      scale: opts.scale ?? 'hero',
      archetype: 'infantry',
      level: opts.level ?? 1,
      traits: [],
      era: 'modern',
      weaponName: '测试主武器',
      weaponClass: 'rifle',
      weaponLevel: 4,
      armorName: '测试护甲',
      armorTier: 2,
      armorLevel: 3,
      abilityBlueprints: [{ id: 'bp-firestorm', level: 5, name: '测试技能' }],
    },
    { seed: 'unit-state-' + id, noVariance: true, registry: reg },
  );
  unit.id = id;
  return unit;
}

describe('UnitRecord 精确实体化', () => {
  it('保留装备、技能、XP 与战损，并重置仅属于战斗的字段', () => {
    const unit = makeUnit('hero-1');
    unit.hp -= 3;
    unit.xp = 123;
    unit.conditions = [{ id: 'bleeding', dur: 2 }];
    unit.abilityState = [{ abilityId: unit.abilities[0]!.id, cdLeft: 2, used: 1 }];
    unit.engagedWith = ['enemy-1'];
    unit.pos = 4;
    unit.fatigue = 3;

    const record = unitRecordFromCombatant(unit, undefined);
    const restored = materializeUnitRecord(record, reg, { era: 'modern' });

    expect(record.skills?.[0]?.level).toBe(5);
    expect(record.skills?.[0]?.blueprintId).toBe('bp-firestorm');
    expect(restored.id).toBe(unit.id);
    expect(restored.weapon).toEqual(unit.weapon);
    expect(restored.armor).toEqual(unit.armor);
    expect(restored.abilities).toEqual(unit.abilities);
    expect(restored.hp).toBe(unit.hp);
    expect(restored.xp).toBe(123);
    expect(restored.conditions).toEqual(unit.conditions);
    expect(restored.abilityState).toEqual([]);
    expect(restored.engagedWith).toEqual([]);
    expect(restored.pos).toBeUndefined();
    expect(restored.fatigue).toBe(0);
  });
});

describe('战斗状态提交', () => {
  it('C06：完整旧战果不能覆盖其后补员，提交也不能修改原战斗快照', () => {
    const unit = makeUnit('corp-a', { scale: 'company', level: 4 });
    unit.base.hpMax = 560;
    unit.hp = 70;
    const before = structuredClone(unit);
    const first = commitBattleOutcome({
      battleId: 'mass:battle-a', committedIds: [], records: [unitRecordFromCombatant(unit)],
      roster: [structuredClone(unit)], combatants: [unit],
      awards: [{ unitId: unit.id, name: unit.name, kills: 100, participation: 0, command: 0, total: 100 }], registry: reg,
    });
    const replenished = { ...first.records[0]!, hp: 500, note: '战后补员' };
    const roster = [materializeUnitRecord(replenished, reg)];
    const replay = commitBattleOutcome({
      battleId: 'mass:battle-a', committedIds: first.committedIds, records: [replenished],
      roster, combatants: [unit], awards: [], registry: reg,
    });
    expect(replay.applied).toBe(false);
    expect(replay.records).toEqual([replenished]);
    expect(replay.roster).toEqual(roster);
    expect([replay.records[0]!.hp, replay.records[0]!.base.hpMax]).toEqual([500, 560]);
    expect(replay.records[0]!.xp).toBe(100);
    expect(unit).toEqual(before);
  });
  it('覆没保留墓碑、晋升已建档的遭遇幸存者，战中召唤不进入永久库', () => {
    const survivor = makeUnit('survivor');
    const lost = makeUnit('lost');
    const summon = makeUnit('summon', { side: 'enemy', scale: 'company' });
    const records = [
      unitRecordFromCombatant(survivor, undefined, { transient: true }),
      unitRecordFromCombatant(lost),
    ];
    survivor.hp -= 2;
    survivor.status = 'fled';
    lost.hp = 0;
    lost.status = 'dead';
    summon.hp -= 5;

    const result = commitBattleState({
      records,
      roster: [makeUnit('survivor'), makeUnit('lost')],
      combatants: [survivor, lost, summon],
    });

    expect(result.lostIds).toEqual(['lost']);
    expect(result.survivingIds).toEqual(['survivor', 'summon']);
    expect(result.records.map((r) => r.id)).toEqual(['survivor', 'lost']);
    expect(result.records.find((r) => r.id === 'survivor')!.transient).toBeUndefined();
    expect(result.records.find((r) => r.id === 'survivor')!.status).toBe('fled');
    expect(result.records.find((r) => r.id === 'lost')).toMatchObject({ hp: 0, status: 'dead' });
    expect(() => deployUnitRecord(result.records, [], 'lost', reg)).toThrow('不能出场');
    expect(result.roster.map((u) => u.id)).toEqual(['survivor']);
    expect(result.roster[0]!.hp).toBe(survivor.hp);
  });

  it('同一个 BattleOutcome 只加一次 XP，且成长与战损一起写回档案', () => {
    const unit = makeUnit('xp-hero');
    unit.hp -= 4;
    const record = unitRecordFromCombatant(unit);
    const awards: XpAward[] = [{
      unitId: unit.id,
      name: unit.name,
      kills: 300,
      participation: 0,
      command: 0,
      total: 300,
    }];
    const id = battleOutcomeId('small', 'stable-seed');

    const first = commitBattleOutcome({
      battleId: id,
      committedIds: [],
      records: [record],
      roster: [materializeUnitRecord(record, reg)],
      combatants: [unit],
      awards,
      registry: reg,
    });
    expect(first.applied).toBe(true);
    expect(first.total).toBe(300);
    expect(first.records[0]!.xp).toBe(300);
    expect(first.records[0]!.level).toBe(2);
    expect(first.records[0]!.hp).toBe(unit.hp);
    expect(first.roster[0]!.xp).toBe(300);
    expect(first.roster[0]!.level).toBe(2);

    const second = commitBattleOutcome({
      battleId: id,
      committedIds: first.committedIds,
      records: first.records,
      roster: first.roster,
      combatants: [unit],
      awards,
      registry: reg,
    });
    expect(second.applied).toBe(false);
    expect(second.total).toBe(0);
    expect(second.records[0]!.xp).toBe(300);
    expect(second.records[0]!.level).toBe(2);
    expect(second.committedIds).toEqual([id]);
  });

  it('mook 不成长，但仍按战斗结果写回剩余 HP', () => {
    const mook = makeUnit('mook', { scale: 'mook' });
    mook.base.hpMax = 10;
    mook.hp = 4;
    const before = makeUnit('mook', { scale: 'mook' });
    before.base.hpMax = 10;
    before.hp = 10;
    const record = unitRecordFromCombatant(before);
    const result = commitBattleOutcome({
      battleId: 'small:mook-test',
      committedIds: [],
      records: [record],
      roster: [materializeUnitRecord(record, reg)],
      combatants: [mook],
      awards: [{ unitId: 'mook', name: 'mook', kills: 999, participation: 0, command: 0, total: 999 }],
      registry: reg,
    });
    expect(result.total).toBe(0);
    expect(result.records.find((r) => r.id === 'mook')!.hp).toBe(4);
    expect(result.records.find((r) => r.id === 'mook')!.xp).toBe(0);
  });
});

describe('持续档案完整时间线', () => {
  it('560→70→再次战损→500→再战损→560→560/1000→1000 保持身份装备经验与历史', () => {
    const unit = makeUnit('army', { scale: 'company', level: 4 });
    unit.hp = unit.base.hpMax = 560;
    let records = [unitRecordFromCombatant(unit)];
    let roster: Combatant[] = [];
    let committedIds: string[] = [];
    const equipment = structuredClone(unit.weapon);
    const battle = (id: string, hp: number) => {
      roster = deployUnitRecord(records, roster, unit.id, reg);
      const combatants = structuredClone(roster);
      combatants[0]!.hp = hp;
      const result = commitBattleOutcome({ battleId: id, records, roster, combatants, committedIds,
        awards: [{ unitId: unit.id, name: unit.name, kills: 5, participation: 0, command: 0, total: 5 }], registry: reg });
      records = result.records; roster = result.roster; committedIds = result.committedIds;
    };
    battle('a', 70); battle('b', 65); battle('c', 60);
    expect(records[0]!.hp).toBe(60);
    records = [updateUnitRecord(records[0]!, { hp: 500 }, reg, 'recruit-1')];
    roster = deployUnitRecord(records, roster, unit.id, reg);
    expect(roster[0]!.hp).toBe(500);
    expect(deployUnitRecord(records, roster, unit.id, reg)).toHaveLength(1);
    battle('d', 470);
    records = [updateUnitRecord(records[0]!, { hp: 560 }, reg)];
    records = [updateUnitRecord(records[0]!, { hpMax: 1000 }, reg)];
    expect([records[0]!.hp, records[0]!.base.hpMax]).toEqual([560, 1000]);
    records = [updateUnitRecord(records[0]!, { hp: 1000 }, reg)];
    roster = deployUnitRecord(JSON.parse(JSON.stringify(records)), [], unit.id, reg);
    expect([roster[0]!.id, roster[0]!.hp, roster[0]!.base.hpMax, roster[0]!.xp]).toEqual(['army', 1000, 1000, 20]);
    expect(roster[0]!.weapon).toEqual(equipment);
    expect(records[0]!.history?.filter((e) => e.kind === 'battle').map((e) => e.sourceId)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('英雄 18/40→34/40，长期伤势保留，同名 id 不混合，旧版本战果拒绝整批', () => {
    const unit = makeUnit('hero-a');
    unit.name = '同名'; unit.base.hpMax = 40; unit.hp = 18;
    unit.conditions = [{ id: 'bleeding', dur: 2 }];
    const record = unitRecordFromCombatant(unit);
    const old = materializeUnitRecord(record, reg);
    const treated = updateUnitRecord(record, { hp: 34 }, reg);
    const namesake = { ...record, id: 'hero-b' };
    const records = [treated, namesake];
    const roster = deployUnitRecord(records, [], treated.id, reg);
    expect(roster[0]).toMatchObject({ hp: 34, base: { hpMax: 40 }, conditions: unit.conditions });
    expect(records[1]!.hp).toBe(18);
    expect(() => commitBattleOutcome({ battleId: 'stale', committedIds: [], records, roster, combatants: [old], awards: [], registry: reg })).toThrow('旧战斗无权覆盖');
    expect(records).toEqual([treated, namesake]);
    expect(() => updateUnitRecord(treated, { hp: 41 }, reg)).toThrow('超出上限');
    expect(() => updateUnitRecord(treated, { hpMax: 20 }, reg)).toThrow('缩编减员');
  });

  it('战内濒死归档不自动判阵亡，明确急救后可再部署，旧战果不能覆盖急救', () => {
    const alive = unitRecordFromCombatant(makeUnit('rescue'));
    const wounded = materializeUnitRecord(alive, reg); wounded.hp = 0; wounded.status = 'dying'; wounded.conditions = [{ id: 'wounded', dur: 3 }];
    const outcome = commitBattleOutcome({ battleId: 'rescue-battle', committedIds: [], records: [alive], roster: [wounded], combatants: [wounded], awards: [], registry: reg });
    const record = outcome.records[0]!;
    expect(record.status).toBe('dying'); expect(() => deployUnitRecord([record], [], record.id, reg)).toThrow('濒死');
    const treated = updateUnitRecord(record, { hp: 5 }, reg);
    expect(treated).toMatchObject({ hp: 5, status: 'ready', conditions: wounded.conditions });
    expect(deployUnitRecord([treated], [], treated.id, reg)[0]?.hp).toBe(5);
    const repeated = commitBattleOutcome({ battleId: 'rescue-battle', committedIds: outcome.committedIds, records: [treated], roster: [], combatants: [wounded], awards: [], registry: reg });
    expect(repeated.records[0]).toEqual(treated);
    expect(() => updateUnitRecord({ ...record, status: 'dead' }, { hp: 5 }, reg)).toThrow('复活');
  });

  it('改名/手动补员/训练编辑不重新生成，单个技能改造不洗武器护甲', () => {
    const record = unitRecordFromCombatant(makeUnit('edit'));
    const updated = editUnitRecord(record, { ...record, name: '新名', hp: 10, level: 5 }, reg);
    const changedSkill = editUnitRecord(updated, { ...updated, skills: [{ category: 'heal', level: 1 }] }, reg);
    expect(changedSkill.snapshot?.weapon).toEqual(record.snapshot?.weapon);
    expect(changedSkill.snapshot?.armor).toEqual(record.snapshot?.armor);
    expect(updated.snapshot?.abilities).toEqual(record.snapshot?.abilities);
    expect(changedSkill.snapshot?.abilities).not.toEqual(record.snapshot?.abilities);
    expect(changedSkill.hp).toBe(10);
    expect(changedSkill.revision).toBe(3);
  });

  it('超过 100 场后仍拒绝最早的旧战果', () => {
    const record = unitRecordFromCombatant(makeUnit('history'));
    const committedIds = Array.from({ length: 110 }, (_, i) => `battle-${i}`);
    const result = commitBattleOutcome({ battleId: 'next', committedIds, records: [record], roster: [], combatants: [], awards: [], registry: reg });
    expect(result.committedIds).toContain('battle-0');
  });
});

describe('V1 单位迁移', () => {
  it('战损取 storage，等级与 XP 取进度更高的 roster，并保留备注', () => {
    const oldUnit = makeUnit('legacy');
    const oldRecord = unitRecordFromCombatant(oldUnit);
    oldRecord.hp = Math.max(1, oldRecord.hp - 5);
    oldRecord.status = 'routing';
    oldRecord.note = '不可丢失的旧备注';
    delete oldRecord.snapshot;

    const progressed = makeUnit('legacy');
    applyXp(progressed, 300, reg);
    const merged = mergeLegacyUnitRecord(oldRecord, progressed);

    expect(merged.level).toBe(2);
    expect(merged.xp).toBe(300);
    expect(merged.hp).toBe(oldRecord.hp);
    expect(merged.status).toBe('routing');
    expect(merged.note).toBe('不可丢失的旧备注');
  });

  it('完整迁移 V1 roster/storage，并隔离、备份损坏条目', () => {
    const oldUnit = makeUnit('migrated');
    const oldRecord = unitRecordFromCombatant(oldUnit);
    oldRecord.hp -= 3;
    delete oldRecord.snapshot;
    const progressed = makeUnit('migrated');
    applyXp(progressed, 300, reg);
    const broken = { id: 'broken', name: '坏档案', side: 'ally', scale: 'hero' };

    const migrated = migratePanelUnits({
      schemaVersion: 1,
      roster: [progressed],
      storage: [oldRecord, broken],
      encounterIds: [],
      registry: reg,
      era: 'modern',
    });

    expect(migrated.records.find((r) => r.id === 'migrated')!.level).toBe(2);
    expect(migrated.records.find((r) => r.id === 'migrated')!.xp).toBe(300);
    expect(migrated.records.find((r) => r.id === 'migrated')!.hp).toBe(oldRecord.hp);
    expect(migrated.roster.map((u) => u.id)).toEqual(['migrated']);
    expect(migrated.warnings[0]).toContain('storage[1]');
    expect(migrated.backup).toEqual([broken]);
  });
});
