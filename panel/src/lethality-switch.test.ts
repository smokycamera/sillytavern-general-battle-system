import { describe, expect, it } from 'vitest';
import { generateUnit, traitRegistry, SmallBattle, MassBattle, V3_D20, V3_TW, standardField, type Combatant } from '../../engine/src/index.js';
import { battleEpilogue, makeNarrativeBatch, type BattleDeliveries } from './battle-reports.js';

const registry = traitRegistry(), rng = { seed: 'fixed', next: () => 0, d: (sides: number) => sides };
function unit(id: string, scale: 'hero' | 'company' = 'hero'): Combatant {
  const u = generateUnit({ rulesVersion: 'v2', name: id, side: id === 'A' ? 'ally' : 'enemy', scale, body: 'large', level: 5, weaponClass: 'sword', armorTier: 0, traits: [] },
    { seed: id, registry, noVariance: true }).unit;
  u.id = id; u.weapon!.penetration = 30; u.weapon!.baseDice = '100d6'; u.weapon!.apDice = '100d6'; u.base.atk = 100; u.morale = 100; u.base.moraleMax = 100; return u;
}
function small(nonLethal: boolean): SmallBattle {
  const b = new SmallBattle({ combatants: ['A', 'D', 'E', 'F'].map(id => unit(id)), nonLethal, rng, seed: 'lethality', traitRegistry: registry, rules: V3_D20, battlefield: standardField() });
  b.start(); return b;
}
function hit(b: SmallBattle, target: string): void { b.byId('A').pos = 28; b.byId(target).pos = 21; b.attack('A', target, { bypassTurn: true }); }
const restore = (b: SmallBattle) => SmallBattle.fromSnapshot(structuredClone(b.toSnapshot()));

describe('战中切换致命规则', () => {
  it('改为非致命：之前阵亡的不复活，之后倒下的只会濒死；规则事件双方可见并随快照保存', () => {
    const b = small(false);
    hit(b, 'D'); expect(b.byId('D').status).toBe('dead');
    b.setNonLethal(true);
    expect(b.nonLethal).toBe(true); expect(b.combatants.every(u => u.nonLethal)).toBe(true);
    const event = b.log.at(-1)!;
    expect(event).toMatchObject({ kind: 'rule', rule: { nonLethal: true } });
    expect(b.visibleLog('ally').at(-1)?.text).toContain('改为非致命'); expect(b.visibleLog('enemy').at(-1)?.kind).toBe('rule');
    hit(b, 'E'); expect(b.byId('E').status).toBe('dying'); expect(b.byId('D').status).toBe('dead');
    const restored = restore(b);
    expect(restored.nonLethal).toBe(true); expect(restored.combatants.every(u => u.nonLethal)).toBe(true);
    b.setNonLethal(true); expect(b.log.filter(e => e.kind === 'rule')).toHaveLength(1); // 不变时不重复记录
  });

  it('改回致命：已经濒死的保持濒死，战斗结束也不补记阵亡；之后倒下的阵亡', () => {
    const b = small(true);
    hit(b, 'D'); expect(b.byId('D').status).toBe('dying');
    b.setNonLethal(false); expect(b.combatants.every(u => u.nonLethal === false)).toBe(true);
    hit(b, 'E'); expect(b.byId('E').status).toBe('dead');
    const midway = restore(b); // 重新载入后仍记得 D 倒在非致命阶段
    hit(b, 'F'); expect(b.isOver()).toBe(true);
    b.finalizeCasualties(); expect(b.byId('D').status).toBe('dying');
    hit(midway, 'F'); midway.finalizeCasualties(); expect(midway.byId('D').status).toBe('dying');
    expect(() => b.setNonLethal(true)).toThrow('进行中的战斗');
    // 没切换过的致命战斗照旧结清旧战场遗留的零生命濒死。
    const legacy = small(false); legacy.byId('D').hp = 0; legacy.byId('D').status = 'dying';
    hit(legacy, 'E'); hit(legacy, 'F'); legacy.finalizeCasualties(); expect(legacy.byId('D').status).toBe('dead');
  });

  it('终章与逐轮战报写明开局规则和切换轮次', () => {
    const b = small(true);
    hit(b, 'D'); b.setNonLethal(false); hit(b, 'E'); hit(b, 'F');
    const epilogue = battleEpilogue(b);
    expect(epilogue).toContain('【本场规则】开局非致命，第1轮起改为致命。单位按倒下时的规则记录');
    expect(battleEpilogue(small(false))).toContain('【本场规则】致命：生命归零按阵亡结算。');
    const deliveries: BattleDeliveries = {};
    expect(makeNarrativeBatch(b, undefined, deliveries, 'delta').text).toContain('改为致命');
  });

  it('会战在回合之间切换，之后的倒地按新规则', () => {
    const units = ['A', 'D', 'E'].map(id => unit(id));
    const b = new MassBattle({ combatants: units, nonLethal: true, rng, seed: 'lethality-mass', traitRegistry: registry, rules: V3_TW }); b.start();
    expect(b.issue({ unitId: 'A', type: 'attack', targetId: 'D' }).ok).toBe(true); b.issue({ unitId: 'D', type: 'hold' }); b.issue({ unitId: 'E', type: 'hold' }); b.resolveRound();
    expect(b.byId('D').status).toBe('dying');
    b.setNonLethal(false);
    expect(b.log.at(-1)).toMatchObject({ kind: 'rule', round: b.round, rule: { nonLethal: false } });
    expect(b.issue({ unitId: 'A', type: 'attack', targetId: 'E' }).ok).toBe(true); b.issue({ unitId: 'E', type: 'hold' }); b.resolveRound();
    expect(b.byId('E').status).toBe('dead'); expect(b.byId('D').status).toBe('dying');
    const restored = MassBattle.fromSnapshot(structuredClone(b.toSnapshot()));
    expect(restored.nonLethal).toBe(false); expect(restored.log.filter(e => e.kind === 'rule')).toHaveLength(1);
  });
});
