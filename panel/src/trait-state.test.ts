import { describe, expect, it } from 'vitest';
import { generateUnit, grantTraitSource, activeTraitIds, traitRegistry, resolveAttack, V2_D20, V2_TW, SmallBattle, MassBattle, standardField, bracePose } from '../../engine/src/index.js';
import { commitBattleOutcome, editUnitRecord, materializeUnitRecord, unitRecordFromCombatant } from './unit-state.js';
import { assertTraitSourcePanelWrite, prepareBlessingRevocation } from './trait-state.js';
import { narrativeProjection } from './narrative-controller.js';
const registry = traitRegistry();
describe('祝福档案与完整战果', () => {
  it('飞行来源通过真实档案保存与两模式部署，不改永久知识或人数上限', () => {
    const u = generateUnit({ name: '受祝福编队', side: 'ally', scale: 'company', level: 3, rulesVersion: 'v2', hpMax: 560, hp: 70, traits: [] }, { seed: 'flight-blessing', registry }).unit;
    grantTraitSource(u, { id: 'wind', name: '风神赐福', kind: 'blessing', traitIds: ['flying'], duration: { kind: 'rounds', count: 1 } });
    const record = unitRecordFromCombatant(u); const before = JSON.stringify(record);
    for (const mode of ['small', 'mass']) {
      const actor = materializeUnitRecord(record, registry), enemy = generateUnit({ name: '敌军', side: 'enemy', scale: 'company', level: 3, rulesVersion: 'v2', traits: [] }, { seed: 'flight-enemy', registry }).unit;
      const battle = mode === 'small' ? new SmallBattle({ rules: V2_D20, combatants: [actor, enemy], battlefield: standardField(), seed: mode }) : new MassBattle({ rules: V2_TW, combatants: [actor, enemy], seed: mode }); battle.start();
      expect(actor.airborne).toBe(true); expect(actor.traits).not.toContain('flying'); expect(actor.hp).toBe(70); expect(actor.base.hpMax).toBe(560);
    }
    expect(JSON.stringify(record)).toBe(before);
  });
  it('固守只保存在战斗快照，归档与再次实体化不继承免费姿态', () => {
    const u = generateUnit({ name: '守兵', side: 'ally', scale: 'hero', rulesVersion: 'v2', level: 3, traits: [] }, { seed: 'pose-archive', registry }).unit;
    u.pos = 31; u.tacticalPose = bracePose(u, undefined, 'small', 7);
    u.tacticalEffort = 2;
    const record = unitRecordFromCombatant(u); expect(u.tacticalPose).toBeDefined(); expect(record.snapshot!.tacticalPose).toBeUndefined();
    expect(record.snapshot!.tacticalEffort).toBeUndefined(); expect(u.tacticalEffort).toBe(2);
    expect(narrativeProjection({ storage: [record], battle: { kind: 'small', snap: { seed: 'pose', combatants: [u] } } })).toContain('"posture":"固守朝北"');
    record.snapshot!.tacticalPose = u.tacticalPose;
    expect(materializeUnitRecord(record, registry).tacticalPose).toBeUndefined(); expect(record.snapshot!.tacticalPose).toBeDefined();
  });
  it('永久特质的编辑/撤销与临时同特质授予不会漏算、残留或重复烘焙', () => {
    const base = generateUnit({ name: '学习者', side: 'ally', scale: 'hero', level: 3, rulesVersion: 'v2', hpMax: 40, traits: [] }, { seed: 'trait-learning', registry }).unit;
    const record = unitRecordFromCombatant(base);
    const learned = editUnitRecord(record, { ...record, traits: ['berserk'] }, registry);
    const actor = materializeUnitRecord(learned, registry);
    const attack = (u: typeof actor) => resolveAttack({ attacker: u, defender: structuredClone(base), rules: V2_D20, rng: { seed: 'hit', next: () => 0, d: (n) => n }, conditionDefs: new Map(), traitRegistry: registry, ranged: false });
    expect(attack(actor).netAtk).toBe(base.base.atk + 2);
    grantTraitSource(actor, { id: 'same-skill', name: '同源战意', kind: 'blessing', traitIds: ['berserk'], duration: { kind: 'permanent' } });
    expect(attack(actor).netAtk).toBe(base.base.atk + 2);
    const removed = editUnitRecord(learned, { ...learned, traits: [] }, registry);
    expect(attack(materializeUnitRecord(removed, registry)).netAtk).toBe(base.base.atk);
    const born = generateUnit({ name: '初始狂暴', side: 'ally', scale: 'hero', level: 3, rulesVersion: 'v2', hpMax: 40, traits: ['berserk'] }, { seed: 'born-berserk', registry }).unit;
    const old = unitRecordFromCombatant(born); const stripped = editUnitRecord(old, { ...old, traits: [] }, registry);
    expect(attack(materializeUnitRecord(stripped, registry)).netAtk).toBe(born.base.atk - 2);
  });
  it.each(['blessing', 'effect'] as const)('按场%s来源只在整场提交时减少一次，编辑/重放/再次部署不洗来源', (kind) => {
    const u = generateUnit({ name: '军团', side: 'ally', scale: 'company', level: 3, rulesVersion: 'v2', hpMax: 560, hp: 70, traits: [] }, { seed: 'blessing-archive', registry }).unit;
    grantTraitSource(u, { id: 'deity', name: '两场裁定', kind, traitIds: kind === 'blessing' ? ['guardian'] : [], ...(kind === 'effect' ? { conditionIds: ['cursed'] } : {}), duration: { kind: 'battles', count: 2 } });
    const record = unitRecordFromCombatant(u);
    const renamed = editUnitRecord(record, { ...record, name: '更名军团' }, registry);
    expect(renamed.snapshot!.traitSources).toEqual(record.snapshot!.traitSources);
    const first = commitBattleOutcome({ battleId: 'one', committedIds: [], records: [record], roster: [u], combatants: [u], awards: [], registry });
    expect(first.records[0]!.snapshot!.traitSources![0]!.remaining).toBe(1);
    expect(u.traitSources![0]!.remaining).toBe(2);
    const secondUnit = materializeUnitRecord(first.records[0]!, registry);
    const second = commitBattleOutcome({ battleId: 'two', committedIds: first.committedIds, records: first.records, roster: [secondUnit], combatants: [secondUnit], awards: [], registry });
    expect(activeTraitIds(materializeUnitRecord(second.records[0]!, registry))).not.toContain('guardian');
    expect(second.records[0]!.snapshot!.traitSources![0]!.remaining).toBe(0);
    const replay = commitBattleOutcome({ battleId: 'one', committedIds: second.committedIds, records: second.records, roster: [u], combatants: [u], awards: [], registry });
    expect(replay.records).toEqual(second.records);
    const save = { storage: [record], factRevision: 1 };
    const fake = structuredClone(save); fake.storage[0]!.snapshot!.traitSources = [];
    expect(() => assertTraitSourcePanelWrite(save, fake)).toThrow(/来源/);
    const revoked = prepareBlessingRevocation(save, u.id, 'deity');
    expect(revoked.storage![0]!.snapshot!.traitSources![0]!.revoked).toBe(true);
    expect(prepareBlessingRevocation(revoked, u.id, 'deity')).toEqual(revoked);
    expect(record.hp).toBe(70); expect(record.snapshot!.traitSources![0]!.remaining).toBe(2);
  });
});
