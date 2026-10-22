import { describe, expect, it } from 'vitest';
import { generateUnit, SmallBattle, MassBattle, V24_OVERFLOW_D20, V25_OVERFLOW_D20, V25_OVERFLOW_TW,
  applyCombatDamage, prepareRevivalBattle, tryRevive, validateCombatModel, validateWounded, memberHealth,
  prepareTraitLevelModel, type Combatant } from '../src/index.js';
import { casualtyXp, initialXpStrength } from '../src/casualty-xp.js';

function unit(id: string, level = 8, scale: 'hero' | 'company' = 'hero'): Combatant {
  const u = generateUnit({ name: id, side: id === 'e' ? 'enemy' : 'ally', scale, level: 3,
    ...(scale === 'company' ? { hpMax: 100 } : {}), rulesVersion: 'v2', damageModel: 'wounds-v2',
    traits: level ? ['revival'] : [], traitLevels: level ? { revival: level } : {},
    weaponClass: 'bow', weaponLevel: 5, armorTier: 0, armorLevel: 1 }, { seed: id, noVariance: true }).unit;
  u.id = id; return u;
}

describe('V25 复活', () => {
  it.each([false, true])('小战真实攻击在非致命=%s时复起，读档保留已用次数，重复击倒不重复给经验', nonLethal => {
    const a = unit('a', 0), e = unit('e', 9);
    const b = new SmallBattle({ combatants: [a, e], rules: V25_OVERFLOW_D20, seed: 'revival', nonLethal });
    b.start(); a.pos = 0; e.pos = 2;
    Object.assign(b.rng, { d: (sides: number) => sides, next: () => .99 });
    const resource = structuredClone(e.resources);
    e.hp = 1; b.attack(a.id, e.id, { bypassTurn: true, ranged: true, autoHit: true });
    expect(e.hp).toBe(e.base.hpMax); expect(e.revivalState?.used).toBe(1); expect(e.resources).toEqual(resource);
    const restored = SmallBattle.fromSnapshot(JSON.parse(JSON.stringify(b.toSnapshot())));
    Object.assign(restored.rng, { d: (sides: number) => sides, next: () => .99 });
    const target = restored.byId(e.id), xp = restored.xpGained;
    target.hp = 1; restored.attack(a.id, e.id, { bypassTurn: true, ranged: true, autoHit: true });
    expect(target.hp).toBe(target.base.hpMax); expect(target.revivalState?.used).toBe(2);
    target.hp = 1; restored.attack(a.id, e.id, { bypassTurn: true, ranged: true, autoHit: true });
    expect(target.status).toBe(nonLethal ? 'dying' : 'dead'); expect(restored.xpGained).toBe(xp);
  });

  it.each([false, true])('会战持续伤害在非致命=%s时触发满血复活并保存次数', nonLethal => {
    const a = unit('a'), e = unit('e', 0);
    const b = new MassBattle({ combatants: [a, e], rules: V25_OVERFLOW_TW, seed: 'revival-dot', nonLethal, formationSlots: 3 });
    b.start(); a.hp = 1; a.conditions.push({ id: 'burning', dur: 2, magnitude: 1000 });
    b.issue({ unitId: a.id, type: 'hold' }); b.issue({ unitId: e.id, type: 'hold' }); b.resolveRound();
    expect(a.hp).toBe(a.base.hpMax); expect(a.status).toBe('ready'); expect(a.revivalState?.used).toBe(1);
    expect(MassBattle.fromSnapshot(JSON.parse(JSON.stringify(b.toSnapshot()))).byId(a.id).revivalState?.used).toBe(1);
  });

  it('编队以实际入场20人复起，非致命伤兵扣除复起成员，小编队保留零头生命', () => {
    const a = unit('a', 5, 'company'); a.hp = 20;
    new SmallBattle({ combatants: [a, unit('e', 0)], rules: V25_OVERFLOW_D20, nonLethal: true }).start();
    applyCombatDamage(a, 1e8, 20); expect(a.hp).toBe(0); expect(tryRevive(a)).toBeTruthy();
    expect(a.hp).toBe(10); expect(a.recoverableWounded).toBe(10); validateCombatModel(a); validateWounded(a);
    const car = unit('a', 2, 'company'); car.hp = 1;
    new SmallBattle({ combatants: [car, unit('e', 0)], rules: V25_OVERFLOW_D20 }).start();
    applyCombatDamage(car, 1e8); tryRevive(car);
    expect(car.hp).toBe(1); expect(memberHealth(car)).toBe(Math.ceil(car.formation!.memberHp * .2));
  });

  it('高阶三次封顶，来源重新出现不刷新，旧V24战斗不启用', () => {
    const a = unit('a', 10), b = new SmallBattle({ combatants: [a, unit('e', 0)], rules: V25_OVERFLOW_D20 }); b.start();
    const minimum = initialXpStrength([a]);
    for (let i = 1; i <= 3; i++) { applyCombatDamage(a, 1e8); casualtyXp(a, minimum); expect(tryRevive(a)).toBeTruthy(); expect(a.revivalState?.used).toBe(i); }
    a.traits = []; a.hp = 0; expect(tryRevive(a)).toBeUndefined(); a.traits = ['revival'];
    prepareRevivalBattle(a); expect(tryRevive(a)).toBeUndefined(); expect(casualtyXp(a, minimum)).toBe(0);
    prepareTraitLevelModel(a, V24_OVERFLOW_D20); expect(tryRevive(a)).toBeUndefined();
  });
});
