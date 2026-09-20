import { describe, expect, it } from 'vitest';
import { generateUnit, traitRegistry, applyHealthLoss, type Combatant } from '../../engine/src/index.js';
import { unitRecordFromCombatant, materializeUnitRecord, updateUnitRecord, commitBattleOutcome, editUnitRecord, migratePanelUnits, deployUnitRecord } from './unit-state.js';
import { prepareInventoryTransaction, createInventoryItem } from './inventory-state.js';
import { narrativeProjection } from './narrative-controller.js';
const registry = traitRegistry();
function unit(): Combatant {
  return generateUnit({ name: '伤后编队', side: 'ally', rulesVersion: 'v2', scale: 'company', level: 4, hp: 70, hpMax: 560, traits: [], weaponClass: 'sword' }, { seed: 'recovery-record', registry }).unit;
}
describe('伤兵持久化与后续更新', () => {
  it('新战损随战果一次归档，升级/改名/重开/再部署守恒，后续补员不被旧战果覆盖', () => {
    const a = unit(), record = unitRecordFromCombatant(a); a.recordRevision = record.revision; applyHealthLoss(a, 20);
    const args = { battleId: 'one', committedIds: [], records: [record], roster: [a], combatants: [a], awards: [], registry };
    const result = commitBattleOutcome(args), archived = result.records[0]!;
    expect(archived).toMatchObject({ hp: 50, recoverableWounded: 10, base: { hpMax: 560 } }); expect(archived.snapshot!.recoverableWounded).toBe(10);
    const edited = editUnitRecord(archived, { ...archived, name: '改名', level: 5 }, registry);
    expect(materializeUnitRecord(edited, registry)).toMatchObject({ hp: 50, recoverableWounded: 10 });
    expect(deployUnitRecord([edited], [], a.id, registry)[0]!.recoverableWounded).toBe(10);
    const filled = updateUnitRecord(edited, { hp: 500 }, registry);
    expect(filled).toMatchObject({ hp: 500, recoverableWounded: 0, base: { hpMax: 560 } });
    const replay = commitBattleOutcome({ ...args, records: [filled], committedIds: result.committedIds }); expect(replay.records).toEqual([filled]);
    expect(a).toMatchObject({ hp: 50, recoverableWounded: 10 }); expect(record.hp).toBe(70);
  });
  it('战外用药按实际伤兵扣量，重放与耗尽后拒绝均不重复恢复；正文显示独立伤兵语义', () => {
    const a = unit(); applyHealthLoss(a, 20); const record = unitRecordFromCombatant(a);
    const save = { storage: [record], inventory: [createInventoryItem('dose', '急救剂', { kind: 'consumable', mechanism: 'heal', power: 3 }, 'dose', 3)], factRevision: 1 };
    const next = prepareInventoryTransaction(save, { id: 'heal-one', kind: 'use', unitId: a.id, itemId: 'dose', expectedRevision: 1 });
    expect(next.storage![0]).toMatchObject({ hp: 57, recoverableWounded: 3 }); expect(next.inventory![0]!.qty).toBe(2);
    const final = prepareInventoryTransaction(next, { id: 'heal-two', kind: 'use', unitId: a.id, itemId: 'dose', expectedRevision: next.factRevision! });
    expect(final.storage![0]).toMatchObject({ hp: 60, recoverableWounded: 0 }); expect(final.inventory![0]!.qty).toBe(1);
    expect(() => prepareInventoryTransaction(final, { id: 'heal-three', kind: 'use', unitId: a.id, itemId: 'dose', expectedRevision: final.factRevision! })).toThrow(/伤员|伤兵/);
    expect(prepareInventoryTransaction(final, { id: 'heal-one', kind: 'use', unitId: a.id, itemId: 'dose', expectedRevision: 1 })).toEqual(final);
    expect(narrativeProjection(save)).toContain('可救伤兵10'); expect(record.hp).toBe(50);
  });
  it('旧档无池不推测伤亡，非法池隔离，缩编不能暗删伤兵，编辑恢复先消耗池', () => {
    const old = unitRecordFromCombatant(unit()); expect(materializeUnitRecord(old, registry).recoverableWounded).toBeUndefined();
    const a = unit(); applyHealthLoss(a, 20); const record = unitRecordFromCombatant(a);
    expect(() => updateUnitRecord(record, { hpMax: 55 }, registry)).toThrow(/伤兵/);
    expect(editUnitRecord(record, { ...record, hp: 56 }, registry)).toMatchObject({ hp: 56, recoverableWounded: 4 });
    const bad = { ...record, recoverableWounded: -1 };
    const migrated = migratePanelUnits({ storage: [old, bad], registry }); expect(migrated.backup).toContainEqual(bad); expect(migrated.records).toHaveLength(1);
  });
});
