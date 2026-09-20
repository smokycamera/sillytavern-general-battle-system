import { describe, expect, it } from 'vitest';
import { generateUnit, traitRegistry, grantTraitSource, activeTraitIds, type Combatant } from '../../engine/src/index.js';
import { unitRecordFromCombatant, materializeUnitRecord, commitBattleOutcome, migratePanelUnits } from './unit-state.js';
const registry = traitRegistry();
describe('士气来源与本场触发记录', () => {
  it('五项士气特质可授予且随档案保留，本场惊退记录不进入下一场', () => {
    const unit = generateUnit({ name: '统率者', side: 'ally', rulesVersion: 'v2', scale: 'company', level: 4, hp: 70, hpMax: 560, traits: [] }, { seed: 'morale-record', registry }).unit;
    grantTraitSource(unit, { id: 'morale-gift', name: '军神裁定', kind: 'blessing', traitIds: ['fear', 'terror', 'steadfast', 'stubborn', 'commander'], duration: { kind: 'battles', count: 2 } });
    const record = unitRecordFromCombatant(unit); unit.recordRevision = record.revision;
    unit.moraleState = { terrorSeen: ['enemy'], routs: 1, attempts: 1, routedRound: 1, lastRallyRound: 2, cause: 'terror' };
    const result = commitBattleOutcome({ battleId: 'morale-one', committedIds: [], records: [record], roster: [unit], combatants: [unit], awards: [], registry });
    const after = result.records[0]!; expect(after.snapshot!.moraleState).toBeUndefined(); expect(unit.moraleState.terrorSeen).toEqual(['enemy']);
    expect(materializeUnitRecord(after, registry).moraleState).toBeUndefined(); expect(activeTraitIds(materializeUnitRecord(after, registry))).toEqual(expect.arrayContaining(['fear', 'terror', 'steadfast', 'stubborn', 'commander']));
    expect(after.hp).toBe(70); expect(after.base.hpMax).toBe(560); expect(after.snapshot!.traitSources![0]!.remaining).toBe(1);
  });
  it('坏惊退记录隔离，不把人物本场精神鼓舞烘焙到永久基础', () => {
    const hero = generateUnit({ name: '个人', side: 'ally', rulesVersion: 'v2', scale: 'hero', level: 3, traits: [] }, { seed: 'personal-morale', registry }).unit;
    const before = structuredClone(hero.base); hero.moraleState = { terrorSeen: [], routs: 0, attempts: 0, personal: 90 };
    const record = unitRecordFromCombatant(hero); expect(record.snapshot!.moraleState).toBeUndefined(); expect(record.base).toEqual(before); expect(hero.moraleState.personal).toBe(90);
    const bad = structuredClone(record); (bad.snapshot as Combatant).moraleState = { terrorSeen: ['x', 'x'], routs: 1, attempts: 0 };
    const migrated = migratePanelUnits({ storage: [bad], registry }); expect(migrated.records).toHaveLength(0); expect(migrated.backup).toContainEqual(bad);
  });
});
