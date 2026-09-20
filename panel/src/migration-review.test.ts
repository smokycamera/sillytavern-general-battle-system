import { describe, expect, it } from 'vitest';
import { generateUnit, SmallBattle, traitRegistry, V2_D20 } from '../../engine/src/index.js';
import { reviewMigration } from './migration-review.js';
import { unitRecordFromCombatant, previewUnitConversion, undoUnitConversion, updateUnitRecord } from './unit-state.js';
import type { NarrativeSave } from './narrative-state.js';
import { createInventoryItem, prepareInventoryState } from './inventory-state.js';
const registry = traitRegistry();
const legacyUnit = () => generateUnit({ name: '脱敏旧单位', side: 'ally', scale: 'company', level: 4, traits: [], era: 'modern' }, { seed: 'legacy-save', registry }).unit;
describe('存档迁移预览与回退', () => {
  it('嵌套单位快照的姿态和来源也必须验证，坏项隔离且保留原备份', () => {
    for (const metadata of [
      { tacticalEffort: -1 },
      { tacticalPose: { kind: 'brace', mode: 'small', width: 7, anchor: { x: 1, y: 1 }, facing: { x: 9, y: 0 } } },
      { traitSources: [{ id: 'bad', name: '坏来源', kind: 'effect', traitIds: [], conditionIds: ['unknown'], duration: { kind: 'permanent' } }] },
    ]) {
      const record = unitRecordFromCombatant(legacyUnit()); Object.assign(record.snapshot!, metadata);
      const raw = { schemaVersion: 2, storage: [record], rosterIds: [record.id] };
      const result = reviewMigration(raw)!;
      expect(result.quarantined).toBeGreaterThan(0); expect(result.candidate.storage).toEqual([]); expect(result.original).toEqual(raw);
    }
  });
  it('旧V2 mook明确预览归为编队，不改生命/人数、装备、训练或战斗随机进度', () => {
    const u = generateUnit({ rulesVersion: 'v2', name: '旧杂兵档案', side: 'ally', scale: 'company', level: 3, hpMax: 20, hp: 7, traits: [], weaponClass: 'sword' }, { seed: 'old-v2-mook', registry }).unit;
    const r = unitRecordFromCombatant(u); r.scale = 'mook'; r.snapshot!.scale = 'mook'; r.snapshot!.tags = ['infantry', 'mook', 'human'];
    const b = new SmallBattle({ rules: V2_D20, combatants: [structuredClone(r.snapshot!)], seed: 'old-mook-battle', traitRegistry: registry }); b.start();
    const raw: NarrativeSave = { schemaVersion: 2, storage: [r], rosterIds: [r.id], battle: { kind: 'small', snap: b.toSnapshot() } };
    const before = structuredClone(raw), review = reviewMigration(raw)!;
    expect(review.changes.some((s) => /编队/.test(s))).toBe(true); expect(raw).toEqual(before); expect(review.original).toEqual(before);
    expect(review.candidate.storage![0]).toMatchObject({ id: r.id, scale: 'company', hp: 7, level: 3, base: { hpMax: 20 } });
    expect(review.candidate.storage![0]!.snapshot!.weapon).toEqual(r.snapshot!.weapon);
    expect(review.candidate.battle!.snap.rngState).toBe(raw.battle!.snap.rngState);
    expect((review.candidate.battle!.snap.combatants as typeof u[])[0]!.scale).toBe('company');
    expect(reviewMigration(review.candidate)).toBeUndefined();
  });
  it('坏库存与重复实物逐条隔离，未知名称不生成效果，冻结好物品不重算', () => {
    const valid = createInventoryItem('good', '冻结药剂', { kind: 'consumable', mechanism: 'heal', power: 3 }, 'fixed', 2);
    const duplicate = { id: 'duplicate', name: '同名重复', qty: 1, lootType: 'misc' };
    const raw: NarrativeSave = { schemaVersion: 2, storage: [], rosterIds: [], inventory: [valid,
      { id: 'bad', name: '坏治疗', qty: 1, lootType: 'consumable', mechanics: { kind: 'consumable', effect: { op: 'heal', amount: -50 } } as never },
      duplicate, { ...duplicate, qty: 2 }, { id: 'story', name: '万能神药', qty: 0, lootType: 'consumable' }] };
    const before = structuredClone(raw), review = reviewMigration(raw)!;
    expect(raw).toEqual(before); expect(review.original).toEqual(before); expect(review.quarantined).toBe(3);
    expect(review.candidate.inventory).toEqual([valid, raw.inventory![4]]);
    expect(prepareInventoryState(review.candidate).inventory).toEqual(review.candidate.inventory);
    expect(reviewMigration(review.candidate)).toBeUndefined();
  });
  it('坏装备撤销对应效果并隔离关联战斗，原装备/战场完整保留在备份', () => {
    const u = generateUnit({ name: '库存持有者', side: 'ally', scale: 'hero', level: 3, rulesVersion: 'v2', hp: 20, hpMax: 40, traits: [], weaponClass: 'sword' }, { seed: 'damaged-equipped', registry }).unit;
    const raw = prepareInventoryState({ schemaVersion: 2, storage: [unitRecordFromCombatant(u)], rosterIds: [u.id] }) as NarrativeSave;
    raw.inventory!.find((i) => i.mechanics?.kind === 'weapon')!.qty = 2;
    const b = new SmallBattle({ combatants: [u], seed: 'invalid-carrier' }); b.start(); raw.battle = { kind: 'small', snap: b.toSnapshot() };
    const preview = reviewMigration(raw)!;
    expect(preview.quarantined).toBe(2);
    expect(preview.candidate.storage![0]!.snapshot!.weapon).toBeUndefined();
    expect(preview.candidate.storage![0]!.snapshot!.armor).toEqual(u.armor);
    expect(preview.candidate.storage![0]!.hp).toBe(20); expect(preview.candidate.battle).toBeNull();
    expect(preview.original.battle).toEqual(raw.battle); expect(preview.original.inventory).toEqual(raw.inventory);
  });
  it('没有上场的坏技能档案也隔离，不能等到打开详情才崩溃', () => {
    const r = unitRecordFromCombatant(legacyUnit());
    r.snapshot!.abilities = [{ id: 'bad', name: '坏技能', effects: null } as never];
    const preview = reviewMigration({ schemaVersion: 2, storage: [r], rosterIds: [] })!;
    expect(preview.quarantined).toBe(1); expect(preview.candidate.storage).toEqual([]);
    expect(preview.original.storage?.[0]).toEqual(r);
  });
  it('显式V2转制保持身份/人员/XP并保存原档；发生新补员后不能盲目撤销覆盖', () => {
    const u = legacyUnit(); u.hp = 70; u.base.hpMax = 560; u.xp = 123;
    const record = unitRecordFromCombatant(u); const original = JSON.parse(JSON.stringify(record));
    const converted = previewUnitConversion(record, registry);
    expect(record).toEqual(original); expect(converted).toMatchObject({ id: record.id, hp: 70, xp: 123, base: { hpMax: 560 }, snapshot: { rulesVersion: 'v2' }, legacyRecord: original });
    expect(converted.snapshot?.weapon?.recipe?.mechanism).toBe('rifle');
    const undone = undoUnitConversion(converted);
    expect(undone.snapshot?.weapon).toEqual(original.snapshot?.weapon); expect(undone.hp).toBe(70);
    const replenished = updateUnitRecord(converted, { hp: 500 }, registry);
    expect(() => undoUnitConversion(replenished)).toThrow('新事实'); expect(replenished.hp).toBe(500);
  });
  it('旧容器预览不改原值，70/560和冻结装备保留，备份可重建同一候选', () => {
    const u = legacyUnit(); u.hp = 70; u.base.hpMax = 560;
    const raw: NarrativeSave = { schemaVersion: 1, roster: [u], storage: [] };
    const before = JSON.stringify(raw); const review = reviewMigration(raw)!;
    expect(JSON.stringify(raw)).toBe(before); expect(review.original).toEqual(raw);
    expect(review.candidate.storage?.[0]).toMatchObject({ id: u.id, hp: 70, base: { hpMax: 560 }, snapshot: { weapon: u.weapon } });
    expect(reviewMigration(JSON.parse(JSON.stringify(review.original)))!.candidate).toEqual(review.candidate);
  });
  it('重复id/坏人员逐条隔离，不让后一条偷偷覆盖；坏战斗保留完整备份', () => {
    const r = unitRecordFromCombatant(legacyUnit());
    const raw: NarrativeSave = { schemaVersion: 2, storage: [r, { ...r, hp: 1 }, { ...r, id: 'bad', hp: -8 }], rosterIds: [r.id, r.id], battle: { kind: 'small', snap: { rulesId: 'v2-unknown' } } };
    const review = reviewMigration(raw)!;
    expect(review.quarantined).toBe(3); expect(review.candidate.storage).toHaveLength(1);
    expect(review.candidate.storage?.[0]?.hp).toBe(r.hp); expect(review.candidate.rosterIds).toEqual([r.id]);
    expect(review.candidate.battle).toBeNull(); expect(review.original.battle).toEqual(raw.battle);
  });
  it('进行中的旧战斗保留原规则和随机进度；正常V2容器无需迁移', () => {
    const a = legacyUnit(), enemy = legacyUnit(); enemy.id = 'enemy'; enemy.side = 'enemy';
    const b = new SmallBattle({ combatants: [a, enemy], seed: 'legacy-round' }); b.start();
    const raw: NarrativeSave = { schemaVersion: 1, roster: [a, enemy], battle: { kind: 'small', snap: b.toSnapshot() } };
    expect(reviewMigration(raw)!.candidate.battle).toEqual(raw.battle);
    expect(reviewMigration({ schemaVersion: 2, storage: [unitRecordFromCombatant(a)], rosterIds: [] })).toBeUndefined();
  });
});
