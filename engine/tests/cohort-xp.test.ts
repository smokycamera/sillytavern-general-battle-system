import { describe, expect, it } from 'vitest';
import { generateUnit, traitRegistry, prepareCombatModel, V4_D20, V4_TW, SmallBattle, MassBattle, standardField,
  setStrength, applyRecovery, battleXpAwards, battleXpAwardsForBothSides, applyXp, type Combatant } from '../src/index.js';
import { unitRecordFromCombatant, materializeUnitRecord, commitBattleOutcome } from '../../panel/src/unit-state.js';

const registry = traitRegistry(), rng = { seed: 'xp-hit', next: () => 0, d: (n: number) => n };
function unit(id: string, side: 'ally' | 'enemy', count = 1000, hero = false): Combatant {
  const u = generateUnit({ rulesVersion: 'v2', name: id, side, scale: hero ? 'hero' : 'company', body: hero ? 'large' : 'human',
    level: 1, hpMax: hero ? 500 : count, weaponClass: 'sword', weaponLevel: 1, armorTier: 0, traits: ['steadfast'] }, { registry, seed: id, noVariance: true }).unit;
  u.id = id; u.morale = u.base.moraleMax = 100; prepareCombatModel(u, V4_D20, 100); return u;
}

describe('编队人均经验与敌军成长', () => {
  it('千人编队击倒300名T1敌人、剩700人：7500原始XP折为5.25，不再连升四级', () => {
    const u = unit('a', 'ally'); setStrength(u, 700);
    const award = battleXpAwards([u], new Map([['a', 300 * 25]]), { won: true, participationRate: 0, initialStrength: new Map([['a', 1000]]) })[0]!;
    expect(award).toMatchObject({ kills: 7500, rawTotal: 7500, startMembers: 1000, survivingMembers: 700, survivalRatio: .7, total: 5.25 });
    expect(applyXp(u, award.total, registry).levelsGained).toBe(0); expect(u.xp).toBe(5.25);
    expect(materializeUnitRecord(JSON.parse(JSON.stringify(unitRecordFromCombatant(u))), registry).xp).toBe(5.25);
    setStrength(u, 0); u.status = 'dead'; expect(battleXpAwards([u], new Map([['a', 7500]]), { won: true, initialStrength: new Map([['a', 1000]]) })[0]!.total).toBe(0);
  });
  it('开战实到人数与编制区分，参战按人数分配；敌我经验池和胜负比例互不串用', () => {
    const a = unit('a', 'ally'), hero = unit('h', 'ally', 1, true), enemy = unit('e', 'enemy');
    setStrength(a, 400); setStrength(enemy, 800);
    const awards = battleXpAwardsForBothSides([a, hero, enemy], new Map([['a', 10000], ['e', 1000]]), {
      winner: 'ally', initialStrength: new Map([['a', 500], ['h', 1], ['e', 1000]]) });
    const row = (id: string) => awards.find(a => a.unitId === id)!;
    expect(row('a').startMembers).toBe(500); expect(row('a').survivalRatio).toBe(.8);
    expect(row('h').participation).toBe(2); expect(row('a').participation).toBe(1497);
    expect(row('e')).toMatchObject({ side: 'enemy', kills: 1000, participation: 50, command: 0, total: .84 });
    expect(row('a').total).toBeCloseTo((10000 + 1497) / 500 * .8);
    const summoned = { ...enemy, id: 'summon', summonerId: 'e' }; expect(battleXpAwardsForBothSides([summoned], new Map([['summon', 10000]]), { winner: 'enemy' })).toEqual([]);
  });
  it.each(['small', 'mass'] as const)('%s敌军实际击杀获经验，治疗重杀不重复；战后升级写回敌方档案且只提交一次', mode => {
    const a = unit('a', 'ally', 3), e = unit('e', 'enemy', 1, true); e.xp = 290; e.base.atk = 100;
    e.weapon = { ...e.weapon!, powerModel: 'anchors-v1', baseDice: '1d2+1000', damageScale: 1, penetration: 100, attacks: 1 };
    const records = [a, e].map(u => unitRecordFromCombatant(u));
    const field = standardField(); field.tiles.fill('open');
    let b: SmallBattle | MassBattle = mode === 'small'
      ? new SmallBattle({ combatants: [a, e], rules: V4_D20, battlefield: field, rng, traitRegistry: registry, seed: mode, nonLethal: true })
      : new MassBattle({ combatants: [a, e], rules: V4_TW, rng, traitRegistry: registry, seed: mode, nonLethal: true });
    b.start();
    const hit = () => {
      if (b instanceof SmallBattle) { b.byId('a').pos = 30; b.byId('e').pos = 23; b.attack('e', 'a', { bypassTurn: true }); }
      else { expect(b.issue({ unitId: 'e', type: 'attack', targetId: 'a' }).ok).toBe(true); b.issue({ unitId: 'a', type: 'hold' }); b.resolveRound(); }
    };
    hit(); expect(b.xpByUnit.get('e')).toBe(25); expect(b.xpGained).toBe(0); expect(b.xpInitialStrength.get('a')).toBe(3);
    expect(applyRecovery(b.byId('a'), 10000)).toBeGreaterThan(0);
    const snapshot = structuredClone(b.toSnapshot());
    b = mode === 'small' ? SmallBattle.fromSnapshot(snapshot) : MassBattle.fromSnapshot(snapshot); Object.assign(b.rng, rng);
    hit(); expect(b.xpByUnit.get('e')).toBe(25); expect(b.xpInitialStrength.get('a')).toBe(3);
    const awards = battleXpAwardsForBothSides(b.combatants, b.xpByUnit, { winner: 'enemy', initialStrength: b.xpInitialStrength });
    expect(awards.find(a => a.unitId === 'e')!.total).toBe(29);
    const outcome = commitBattleOutcome({ battleId: mode, committedIds: [], combatants: b.combatants, records, roster: [], awards, registry });
    expect(outcome.records.find(r => r.id === 'e')).toMatchObject({ side: 'enemy', xp: 319, level: 2 }); expect(e.xp).toBe(290);
    const repeated = commitBattleOutcome({ battleId: mode, committedIds: outcome.committedIds, combatants: b.combatants, records: outcome.records, roster: [], awards, registry });
    expect(repeated.records).toEqual(outcome.records); expect(repeated.applied).toBe(false);
  });
  it('旧快照没有开战人数时用编制上限；小数经验保存、重复入账与继续累积均正确', () => {
    const a = unit('a', 'ally', 1000), e = unit('e', 'enemy'); setStrength(a, 100);
    const b = new SmallBattle({ combatants: [a, e], rules: V4_D20, battlefield: standardField(), seed: 'old-xp' }); b.start();
    const snapshot = structuredClone(b.toSnapshot()); delete snapshot.xpInitialStrength;
    snapshot.xpMinimum = [['e', 1000]];
    const restored = SmallBattle.fromSnapshot(snapshot);
    expect(restored.xpMinimum.get('a')).toBe(100);
    const awards = battleXpAwards(restored.combatants, new Map([['a', 25]]), { won: true, participationRate: 0, initialStrength: restored.xpInitialStrength });
    expect(awards.find(a => a.unitId === 'a')).toMatchObject({ populationBasis: 'capacity', startMembers: 1000, total: .0025 });
    let record = unitRecordFromCombatant(restored.byId('a'));
    for (let i = 0; i < 4; i++) {
      const u = materializeUnitRecord(record, registry); applyXp(u, awards[0]!.total, registry);
      record = JSON.parse(JSON.stringify(unitRecordFromCombatant(u)));
    }
    expect(materializeUnitRecord(record, registry).xp).toBe(.01);
  });
});
