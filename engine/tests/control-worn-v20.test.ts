import { describe, expect, it } from 'vitest';
import { generateUnit, SmallBattle, standardField, traitRegistry, compileItem, compileSkill, upgradeCombatSkills, gearItem, gearBonuses, combatBonuses, wornLevelScale,
  parseSkillMechanism, skillMechanismId, prepareItemModel, rulesById, V19_OVERFLOW_D20, V20_OVERFLOW_D20, V15_OVERFLOW_D20,
  type Ability, type Combatant, type ItemSpecification } from '../src/index.js';
import { anchoredProtection } from '../src/power-anchors.js';
import { bonusMultiplier } from '../src/enhancements.js';
import { prepareCombatModel } from '../src/combat-model.js';
import { V6_D20 } from '../src/rules.js';
import { itemValueSummary, overshadowedGear } from '../../panel/src/item-description.js';
import { materializeUnitRecord, unitRecordFromCombatant } from '../../panel/src/unit-state.js';

const registry = traitRegistry();
const mechanism = (text: string) => skillMechanismId(parseSkillMechanism(text)!);
/** 与道具模板同一条路径：按指定技能规则编译，再走入场升级。 */
function compiled(text: string, model: 'skills-v2' | 'skills-v3', power = 5): Ability {
  const ability = compileSkill({ id: mechanism(text), name: text }, power, 'u', model);
  const host = { id: 'u', name: 'u', side: 'ally', scale: 'hero', level: power, tags: [], base: { atk: 0, def: 0, spd: 0, hpMax: 1 }, hp: 1, conditions: [],
    abilities: [ability], abilityState: [], resources: {}, traits: [], engagedWith: [], status: 'ready', fatigue: 0,
    rulesVersion: 'v2', damageModel: 'wounds-v2', combatModel: 'cohort-v2', skillModel: model } as unknown as Combatant;
  upgradeCombatSkills(host);
  return host.abilities[0]!;
}
const dcs = (a: Ability) => Object.fromEntries(a.effects.flatMap((e) => e.op === 'condition' ? [[e.conditionId, e.saveDC]] : []));
function worn(id: string, power: number, bonuses: Record<string, number>) {
  const mechanics = compileItem({ kind: 'item', form: 'worn', power, bonuses } as ItemSpecification, { id, seed: id });
  if (mechanics.kind !== 'item') throw Error('fixture');
  return gearItem(id, id, mechanics.value);
}
function hero(id: string, extra: Record<string, unknown> = {}): Combatant {
  const u = generateUnit({ name: id, side: 'ally', scale: 'hero', rulesVersion: 'v2', damageModel: 'wounds-v2', level: 5, traits: [], weaponClass: 'sword', armorTier: 1, ...extra },
    { registry, seed: id, noVariance: true, skillModel: 'skills-v3' }).unit;
  u.id = id; prepareCombatModel(u, V6_D20); return u;
}

describe('V20 组合控制抵抗难度', () => {
  it('每多一项效果 −1，不封顶；眩晕另 −2；单项不变', () => {
    expect(dcs(compiled('减益眩晕', 'skills-v2'))).toEqual({ stunned: 11 });
    expect(dcs(compiled('减益眩晕', 'skills-v3'))).toEqual({ stunned: 11 });
    expect(dcs(compiled('减益眩晕+定身', 'skills-v2'))).toEqual({ stunned: 9, restrained: 11 });
    expect(dcs(compiled('减益眩晕+定身', 'skills-v3'))).toEqual({ stunned: 10, restrained: 12 });
    expect(dcs(compiled('减益眩晕+定身+沉默+缴械', 'skills-v3'))).toEqual({ stunned: 8, restrained: 10, silenced: 10, disarmed: 10 });
    // 权重 9（诅咒、虚弱等改两项属性的状态各算两项）：继续逐项降低，没有封顶。
    expect(dcs(compiled('减益眩晕+定身+沉默+缴械+减速+诅咒+虚弱+易伤', 'skills-v3')).restrained).toBe(5);
  });
  it('嘲讽、致盲、混乱、魅惑不降，仍计入项数', () => {
    expect(dcs(compiled('减益魅惑+眩晕', 'skills-v3'))).toEqual({ charmed: 13, stunned: 10 });
    expect(dcs(compiled('减益致盲+定身', 'skills-v3'))).toEqual({ blinded: 13, restrained: 11 });
  });
  it('精力、冷却、效力与伤害分摊不变', () => {
    for (const text of ['减益眩晕+定身', '物理单体近战+定身+沉默']) {
      const [old, next] = [compiled(text, 'skills-v2'), compiled(text, 'skills-v3')];
      expect(next.cost).toEqual(old.cost); expect(next.cooldown).toBe(old.cooldown); expect(next.weaponDamageMult).toBe(old.weaponDamageMult);
      expect(next.effects.map((e) => e.op === 'condition' ? e.magnitude : 0)).toEqual(old.effects.map((e) => e.op === 'condition' ? e.magnitude : 0));
    }
  });
  it('V20 战斗入场按 skills-v3 重建；V19 战斗保持原难度', () => {
    for (const [rules, expected] of [[V19_OVERFLOW_D20, { stunned: 9, restrained: 11 }], [V20_OVERFLOW_D20, { stunned: 10, restrained: 12 }]] as const) {
      const caster = hero('c', { abilityBlueprints: [{ id: mechanism('减益眩晕+定身'), level: 5 }] }), foe = { ...hero('f'), side: 'enemy' as const };
      const field = standardField(); field.tiles.fill('open');
      const battle = new SmallBattle({ combatants: [caster, foe], battlefield: field, rules, seed: 'v20', traitRegistry: registry });
      expect(dcs(battle.combatants.find((u) => u.id === 'c')!.abilities.find((a) => a.definitionId === mechanism('减益眩晕+定身'))!)).toEqual(expected);
    }
    expect(rulesById('v20-overflow-d20')).toMatchObject({ skillModel: 'skills-v3', itemModel: 'items-v2', commandModel: 'command-v2' });
    expect(rulesById('v19-overflow-d20')).toMatchObject({ skillModel: 'skills-v2', itemModel: 'items-v1' });
  });
  it('新建的控制道具按新难度冻结', () => {
    const mechanics = compileItem({ kind: 'item', form: 'charged', power: 5, active: mechanism('减益眩晕+定身') }, { id: 'w', seed: 'w' });
    expect(mechanics.kind === 'item' && dcs(mechanics.value.ability!)).toEqual({ stunned: 9, restrained: 11 });
  });
  it('新规则的技能存档后可以读回', () => {
    const u = hero('s', { abilityBlueprints: [{ id: mechanism('物理单体近战'), level: 5 }, { id: mechanism('魔法范围热能'), level: 7 }] });
    u.skillModel = 'skills-v3'; upgradeCombatSkills(u);
    expect(u.abilities.every((a) => a.effectVersion === 'skill-v9.0')).toBe(true);
    expect(materializeUnitRecord(unitRecordFromCombatant(u), registry).abilities.map((a) => a.weaponDamageMult)).toEqual(u.abilities.map((a) => a.weaponDamageMult));
  });
});

describe('V20 佩戴修正按道具 L 换算', () => {
  it('比例取锚定表同级单体创伤预算 ÷ L5', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(wornLevelScale)).toEqual([0.25, 0.5, 0.75, 0.875, 1, 1.125, 1.3125, 1.5, 1.75, 2]);
  });
  it('L1+2伤害与L2+2伤害不同；L5不变；正负一起换算', () => {
    const u = hero('a'); prepareItemModel(u, V20_OVERFLOW_D20);
    const damage = (power: number) => { u.gear = [worn('g', power, { damage: 2 })]; return bonusMultiplier(combatBonuses(u), 'damage'); };
    expect([1, 2, 5, 10].map(damage)).toEqual([1.025, 1.05, 1.1, 1.2]);
    u.gear = [worn('m', 2, { damage: 4, defense: -2 })];
    expect(gearBonuses(u)).toEqual({ damage: 2, defense: -1 });
  });
  it('同方向按换算后的数值取最高一件；合计仍限±10', () => {
    const u = hero('b'); prepareItemModel(u, V20_OVERFLOW_D20);
    u.gear = [worn('low', 3, { damage: 5 }), worn('high', 8, { damage: 3 })];
    expect(gearBonuses(u)).toEqual({ damage: 4.5 });
    expect(overshadowedGear(u, 'low')).toEqual(['+5伤害']);
    expect(overshadowedGear(u, 'high')).toEqual([]);
    u.bonuses = { damage: 7 }; expect(combatBonuses(u)!.damage).toBe(10);
  });
  it('佩戴防护也换算；V19 及以前照写的点数', () => {
    const u = hero('p'); u.gear = [worn('plate', 10, { protection: 4 })];
    prepareItemModel(u, V15_OVERFLOW_D20);
    const before = anchoredProtection(u, 'kinetic');
    expect(gearBonuses(u)).toEqual({ protection: 4 });
    prepareItemModel(u, V20_OVERFLOW_D20);
    expect(gearBonuses(u)).toEqual({ protection: 8 });
    expect(anchoredProtection(u, 'kinetic') - before).toBeCloseTo(0.8);
  });
  it('道具说明写出折算后的数值', () => {
    const mechanics = compileItem({ kind: 'item', form: 'worn', power: 2, bonuses: { damage: 2 } }, { id: 'r', seed: 'r' });
    expect(mechanics.kind === 'item' && itemValueSummary(mechanics.value)).toContain('伤害+4.4%');
    const l5 = compileItem({ kind: 'item', form: 'worn', power: 5, bonuses: { damage: 2 } }, { id: 'r5', seed: 'r5' });
    expect(l5.kind === 'item' && itemValueSummary(l5.value)).toContain('伤害+13.4%');
  });
});
