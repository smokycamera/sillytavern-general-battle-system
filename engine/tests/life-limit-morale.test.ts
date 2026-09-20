import { describe, expect, it } from 'vitest';
import { generateUnit, traitRegistry, prepareCombatModel, SmallBattle, MassBattle, standardField, V3_D20, V4_D20, V4_TW,
  applyHealthLoss, memberHealth, memberHealthMax, type Combatant } from '../src/index.js';
import { SINGLE_LIFE_LIMIT, MAX_DEFAULT_SINGLE_LIFE } from '../src/health-limits.js';
import { moraleRisk, moraleProfile, reconcileDamageMorale } from '../src/morale.js';
import { setMemberMaximum } from '../src/member-health.js';
const registry = traitRegistry();
function hero(id = 'a', body: 'human' | 'vehicle' | 'giant' = 'vehicle', maximum = 1000): Combatant {
  const unit = generateUnit({ rulesVersion: 'v2', name: id, side: id === 'a' ? 'ally' : 'enemy', scale: 'hero', body,
    level: 6, hpMax: maximum, weaponClass: 'cannon', weaponLevel: 10, armorTier: 3, armorLevel: 10, traits: [] }, { registry, seed: id }).unit;
  unit.id = id; prepareCombatModel(unit, V4_D20); return unit;
}
const context = (unit: Combatant) => ({ units: [unit], mode: 'small' as const, fieldTags: [] });

describe('单体生命硬上限与真实受创比例', () => {
  it('上限覆盖最高默认844生命，10万生命输入截为1000，默认体型生命不抬高', () => {
    expect(MAX_DEFAULT_SINGLE_LIFE).toBe(844); expect(SINGLE_LIFE_LIMIT).toBe(1000);
    for (const body of ['human', 'vehicle', 'giant'] as const) { const unit = hero('a', body, 100000); expect(unit.hp).toBe(1000); expect(unit.base.hpMax).toBe(1000); }
    const giant = generateUnit({ name: '最大模板', side: 'ally', scale: 'hero', body: 'giant', rulesVersion: 'v2', level: 10, traits: [] }, { registry, seed: 'max' }).unit;
    expect(giant.base.hpMax).toBe(844);
    const wounded = generateUnit({ name: '旧伤', side: 'ally', scale: 'hero', rulesVersion: 'v2', level: 6, hpMax: 100000, hp: 73, traits: [] }, { registry, seed: 'wounded' }).unit;
    expect(wounded.hp).toBe(73); expect(wounded.base.hpMax).toBe(1000);
  });
  it('限制的是每个成员生命，十万人编队和整队总生命不截成1000', () => {
    const unit = generateUnit({ rulesVersion: 'v2', name: '编队', side: 'ally', scale: 'company', level: 6, hpMax: 100000, traits: [] }, { registry, seed: 'company' }).unit;
    prepareCombatModel(unit, V4_D20, 100000);
    expect(unit.hp).toBe(100000); expect(unit.base.hpMax).toBe(100000); expect(unit.formation!.memberHp).toBe(1000);
    expect(memberHealthMax(unit)).toBe(100000000); expect(memberHealth(unit)).toBe(100000000);
    unit.formation!.health = [{ hp: 73, count: 1 }, { hp: 1000, count: 99999 }]; setMemberMaximum(unit, 10000000000);
    expect(unit.formation!.memberHp).toBe(1000); expect(unit.formation!.health![0]).toEqual({ hp: 73, count: 1 });
  });
  it('相同受伤比例产生相同压力，10万旧生命损失700不会按几百血模板惩罚', () => {
    const historical = hero(); historical.hp = historical.base.hpMax = 100000;
    applyHealthLoss(historical, 700);
    expect(historical.moraleState!.damagePenalty).toBe(0); expect(moraleRisk(context(historical), historical, 25, registry).breakChance).toBe(0);
    const a = hero('a', 'human', 1000), b = hero('b', 'vehicle', 500);
    applyHealthLoss(a, 100); applyHealthLoss(b, 50);
    expect(a.moraleState!.damagePenalty).toBe(3); expect(b.moraleState!.damagePenalty).toBe(3);
    expect(moraleProfile(context(a), a, registry).effective).toBe(moraleProfile(context(b), b, registry).effective);
  });
  it('1000生命下三次共700伤害累计压力为21，并计入真实伤势，不逐段重复扣除', () => {
    const unit = hero(); for (const amount of [200, 250, 250]) applyHealthLoss(unit, amount);
    expect(unit.hp).toBe(300); expect(unit.moraleState).toMatchObject({ damage: 700, damagePenalty: 21, personal: 54 });
    expect(moraleProfile(context(unit), unit, registry).effective).toBe(26);
    expect(moraleRisk(context(unit), unit, 25, registry).breakChance).toBe(0);
    const once = hero(); applyHealthLoss(once, 700); expect(once.moraleState).toEqual(unit.moraleState);
  });
  it.each(['small', 'mass'] as const)('%s旧V4快照截断生命并校正压力，加载幂等且不撤销已有溃退', mode => {
    const a = hero(), b = hero('b');
    const battle = mode === 'small' ? new SmallBattle({ combatants: [a, b], rules: V4_D20, battlefield: standardField(), seed: 'saved-life' })
      : new MassBattle({ combatants: [a, b], rules: V4_TW, seed: 'saved-life' }); battle.start();
    const saved = structuredClone(battle.toSnapshot()) as any;
    const old = saved.combatants.find((unit: Combatant) => unit.id === a.id); old.hp = 99300; old.base.hpMax = 100000; old.status = 'routing';
    old.moraleState = { damage: 700, damagePenalty: 69, personal: 6, terrorSeen: [], routs: 1, attempts: 0, routedRound: 1, cause: 'morale' };
    const restored = mode === 'small' ? SmallBattle.fromSnapshot(saved) : MassBattle.fromSnapshot(saved);
    expect(restored.byId(a.id)).toMatchObject({ hp: 1000, base: { hpMax: 1000 }, status: 'routing', moraleState: { damagePenalty: 21, personal: 54 } });
    expect(restored.log.some(entry => entry.text.includes('不计战斗伤害'))).toBe(true);
    const again = mode === 'small' ? SmallBattle.fromSnapshot(structuredClone(restored.toSnapshot()) as any) : MassBattle.fromSnapshot(structuredClone(restored.toSnapshot()) as any);
    expect(again.toSnapshot()).toEqual(restored.toSnapshot());
  });
  it('校准饱和的旧压力不把士气提高到训练基准以上', () => {
    const unit = hero(); unit.moraleState = { damage: 700, damagePenalty: 400, personal: 0, terrorSeen: [], routs: 0, attempts: 0 };
    reconcileDamageMorale(unit); expect(unit.moraleState.personal).toBe(75); expect(unit.moraleState.damagePenalty).toBe(21);
    reconcileDamageMorale(unit); expect(unit.moraleState.personal).toBe(75);
  });
  it('旧V3进行中快照保留其生命规则', () => {
    const a = hero(), b = hero('b'); for (const unit of [a, b]) { unit.combatModel = 'cohort-v1'; unit.hp = unit.base.hpMax = 100000; }
    const battle = new SmallBattle({ combatants: [a, b], rules: V3_D20, seed: 'old-life' }); battle.start();
    const restored = SmallBattle.fromSnapshot(structuredClone(battle.toSnapshot()) as any);
    expect(restored.byId(a.id).base.hpMax).toBe(100000);
  });
});
