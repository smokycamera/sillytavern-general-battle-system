import { describe, it, expect } from 'vitest';
import { generateUnit, prepareCombatModel, prepareArmsModel, prepareSkillModel, upgradeCombatSkills, resolveAttack, rechargeEnergyShield, energyHeavyHit, energyShieldCapacity,
  shieldDurabilityMax, gradeOvermatch, compileSkill, skillDefinitionId, standardConditionMap, SmallBattle, V6_D20, V18_OVERFLOW_D20, V20_OVERFLOW_D20, V21_OVERFLOW_D20, V21_OVERFLOW_TW,
  RULES_BY_ID, type Combatant, type AttackOpts, type GenerateInput } from '../src/index.js';

const defs = standardConditionMap(), curve = V21_OVERFLOW_D20.overmatchCurve;
function unit(id: string, extra: Partial<GenerateInput> = {}, rules = V21_OVERFLOW_D20): Combatant {
  const u = generateUnit({ name: id, side: id.startsWith('a') ? 'ally' : 'enemy', scale: 'hero', level: 5, traits: [], rulesVersion: 'v2', damageModel: 'wounds-v2', weaponClass: 'rifle', weaponLevel: 5, armorTier: 0, ...extra }, { seed: id, noVariance: true }).unit;
  u.id = id; prepareCombatModel(u, rules); prepareArmsModel(u, rules); return u;
}
const shielded = (L: number, extra: Partial<GenerateInput> = {}, rules = V21_OVERFLOW_D20) => unit('d', { shield: true, shieldClass: 'energy-shield', shieldLevel: L, ...extra }, rules);
const hit = { seed: 'v21', d: (s: number) => s === 20 ? 19 : s, next: () => .1 };
const attack = (a: Combatant, d: Combatant, rules = V21_OVERFLOW_D20): AttackOpts => { a.pos = 0; return { attacker: a, defender: d, distance: 1, ranged: !!a.weapon?.tags?.includes('ranged'), rules, conditionDefs: defs, rng: hit }; };

describe('V21 等级锚定：能量盾', () => {
  it('每份容量 = 同级单体创伤预算 × 平台倍率，回充每次激活同级预算三成且不随平台放大', () => {
    const human = shielded(5), ship = shielded(8, { body: 'vehicle' });
    expect([energyShieldCapacity(human), human.energyShield, energyShieldCapacity(ship)]).toEqual([32, { remaining: 32, overloaded: 0 }, 288]);
    ship.energyShield!.remaining = 100; rechargeEnergyShield(ship); expect(ship.energyShield!.remaining).toBe(114);
    human.energyShield = { remaining: 30, overloaded: 0 }; rechargeEnergyShield(human); expect(human.energyShield!.remaining).toBe(32);
    human.energyShield = { remaining: 5, overloaded: 1 }; rechargeEnergyShield(human); expect(human.energyShield).toEqual({ remaining: 5, overloaded: 0 });
  });
  it('低级火力按反向跨代倍率少耗，高级火力按跨代倍率多耗，同级一比一', () => {
    const low = shielded(8, { level: 8 }), r1 = resolveAttack(attack(unit('a'), low));
    expect(r1.energyAbsorbed! > 0 && Math.abs(r1.energySpent! - r1.energyAbsorbed! / gradeOvermatch(8, 5, 1, 0, curve)) < 1e-9).toBe(true);
    expect(Math.abs(low.energyShield!.remaining - (48 - r1.energySpent!)) < 1e-9).toBe(true);
    const same = shielded(8, { level: 8 }), r2 = resolveAttack(attack(unit('a', { weaponLevel: 8, level: 8 }), same));
    expect([r2.energySpent, 48 - same.energyShield!.remaining]).toEqual([undefined, r2.energyAbsorbed]);
    // 高一代步枪换算后成了重击：只动用一份的四分之一，挡下的伤害再按倍率折小，然后过载。
    const high = shielded(8, { level: 9 }), r3 = resolveAttack(attack(unit('a', { weaponLevel: 9, level: 9 }), high));
    expect([r3.energySpent, high.energyShield]).toEqual([12, { remaining: 36, overloaded: 1 }]);
    expect(Math.abs(r3.energyAbsorbed! - 12 / gradeOvermatch(9, 8, 1, 0, curve)) < 1e-9).toBe(true);
    expect(r1.text).toContain('（耗盾');
  });
  it('盾按自身规格吸收：低训练持盾者被同级火力跨代命中时，盾只耗同级的量', () => {
    const d = shielded(8), r = resolveAttack(attack(unit('a', { weaponLevel: 8, level: 8 }), d));
    expect((r.overmatchMultiplier ?? 1) > 1 && Math.abs(r.energySpent! * r.overmatchMultiplier! - r.energyAbsorbed!) < 1e-6).toBe(true);
  });
  it('重击阈值随平台放大，并按换算后的单段均值判定', () => {
    expect([energyHeavyHit(shielded(8), 230.4), energyHeavyHit(shielded(8, { body: 'vehicle' }), 230.4), energyHeavyHit(shielded(8), 156.4, 1 / gradeOvermatch(8, 5, 1, 0, curve))]).toEqual([true, false, false]);
    expect(energyHeavyHit(shielded(8, {}, V20_OVERFLOW_D20), 156.4)).toBe(true);
  });
  it('实体盾耐久只在 V21 随平台放大', () => {
    const v21 = unit('d', { body: 'vehicle', shield: true, shieldClass: 'shield', shieldLevel: 5 }), v20 = unit('d', { body: 'vehicle', shield: true, shieldClass: 'shield', shieldLevel: 5 }, V20_OVERFLOW_D20);
    expect([shieldDurabilityMax(v20), shieldDurabilityMax(v21)]).toEqual([128, 768]);
  });
  it('旧规则：重击后剩余量为小数也能存档读档', () => {
    const a = unit('a', {}, V18_OVERFLOW_D20), d = shielded(8, {}, V18_OVERFLOW_D20);
    d.energyShield = { remaining: 10.5, overloaded: 1 };
    const b = new SmallBattle({ combatants: [a, d], rules: V18_OVERFLOW_D20, seed: 'fraction' });
    expect(SmallBattle.fromSnapshot(structuredClone(b.toSnapshot())).combatants.find(u => u.id === 'd')!.energyShield).toEqual({ remaining: 10.5, overloaded: 1 });
  });
});

describe('V21 等级锚定：技能量', () => {
  const amount = (text: string, L: number, formula: 'skills-v3' | 'skills-v4') => compileSkill(skillDefinitionId(text)!, L, 'x', formula).effects[0]!;
  it('屏障基础量 = 同级预算，状态效力与士气按预算比例；skills-v3 不变', () => {
    expect([1, 5, 10].map(L => (amount('buff+屏障', L, 'skills-v4') as { amount: number }).amount)).toEqual([8, 32, 64]);
    expect([1, 5, 10].map(L => (amount('buff+屏障', L, 'skills-v3') as { amount: number }).amount)).toEqual([13, 33, 58]);
    expect([1, 5, 8, 10].map(L => (amount('buff+攻击', L, 'skills-v4') as { magnitude: number }).magnitude)).toEqual([.25, 1, 1.5, 2]);
    expect([1, 5, 10].map(L => (amount('buff+攻击', L, 'skills-v3') as { magnitude: number }).magnitude)).toEqual([.6, 1, 1.5]);
    expect([1, 5, 10].map(L => (amount('buff+士气', L, 'skills-v4') as { amount: number }).amount)).toEqual([2, 8, 16]);
  });
  it('入场升级的效力上限：V21 为 2，旧规则 1.5', () => {
    const magnitude = (rules: typeof V21_OVERFLOW_D20, formula: 'skills-v3' | 'skills-v4') => {
      const u = generateUnit({ name: 'a', side: 'ally', scale: 'hero', level: 5, traits: [], rulesVersion: 'v2', damageModel: 'wounds-v2', weaponClass: 'sword', weaponLevel: 5, armorTier: 0,
        abilityBlueprints: [{ id: skillDefinitionId('buff+攻击')!, level: 9, name: '战吼', bonuses: { power: 10 } }] as unknown as GenerateInput['abilityBlueprints'] }, { seed: 'a', noVariance: true, skillModel: formula }).unit;
      prepareSkillModel(u, rules); prepareCombatModel(u, V6_D20); upgradeCombatSkills(u);
      return (u.abilities[0]!.effects[0] as { magnitude: number }).magnitude;
    };
    expect([magnitude(V20_OVERFLOW_D20, 'skills-v3'), magnitude(V21_OVERFLOW_D20, 'skills-v4')]).toEqual([1.5, 2]);
  });
  it('V21 规则包登记并启用 arms-v3 与 skills-v4', () => {
    expect([RULES_BY_ID['v21-overflow-d20'], RULES_BY_ID['v21-overflow-tw'], V21_OVERFLOW_TW.armsModel, V21_OVERFLOW_TW.skillModel]).toEqual([V21_OVERFLOW_D20, V21_OVERFLOW_TW, 'arms-v3', 'skills-v4']);
  });
});
