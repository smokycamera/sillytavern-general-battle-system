import { describe, expect, it } from 'vitest';
import { generateUnit, prepareCombatModel, prepareTraitModel, prepareItemModel, prepareTraitLevelModel, grantTraitSource, narrativeTraitLevel, traitLadderSummary,
  V20_OVERFLOW_D20, type Combatant } from '../src/index.js';
import { anchoredProtection, defensePower } from '../src/power-anchors.js';
import { penetrationContext } from '../src/damage.js';

function unit(id: string, armorTier: 0 | 2, traits: Record<string, number> = {}, weaponClass = 'rifle'): Combatant {
  const u = generateUnit({ name: id, side: id === 'e' ? 'enemy' : 'ally', scale: 'company', level: 5, hpMax: 50, rulesVersion: 'v2', damageModel: 'wounds-v2',
    traits: Object.keys(traits), traitLevels: traits, weaponClass, weaponLevel: 5, armorTier, armorLevel: 5 }, { seed: id, noVariance: true }).unit;
  u.id = id;
  prepareCombatModel(u, V20_OVERFLOW_D20); prepareTraitModel(u, V20_OVERFLOW_D20); prepareItemModel(u, V20_OVERFLOW_D20); prepareTraitLevelModel(u, V20_OVERFLOW_D20);
  return u;
}
const protection = (u: Combatant) => (['kinetic', 'thermal', 'arcane'] as const).map(c => anchoredProtection(u, c));

describe('动能/热能/奥术抵抗', () => {
  it.each([
    [0, {}, [0, 0, 0]],
    [0, { 'thermal-resist': 1 }, [0, 0.5, 0]],
    [0, { 'thermal-resist': 10 }, [0, 4, 0]],
    [2, {}, [10, 9, 8]],
    [2, { 'kinetic-resist': 5 }, [12, 9, 8]],
    [2, { 'arcane-resist': 7 }, [10, 9, 10.625]],
    [2, { 'kinetic-resist': 3, 'thermal-resist': 4, 'arcane-resist': 6 }, [11.5, 10.75, 10.25]],
  ] as const)('护甲档%s %j：防护与护甲相加', (tier, traits, expected) => {
    expect(protection(unit('d', tier, { ...traits }))).toEqual(expected);
  });
  it('防御规格只随提高后的防护按现有换算变化', () => {
    expect(defensePower(unit('d', 2, { 'thermal-resist': 5 }), 'thermal')).toBe(6);
    expect(defensePower(unit('d', 2, { 'thermal-resist': 5 }), 'kinetic')).toBe(5);
    expect(defensePower(unit('d', 0, { 'thermal-resist': 10 }), 'thermal')).toBe(5);
  });
  it('伤害管线读到抵抗：L5能量武器打中甲L5', () => {
    const attacker = unit('e', 2, {}, 'energy');
    const pass = (traits: Record<string, number>) => penetrationContext({ attacker, defender: unit('d', 2, traits), ranged: true, rules: V20_OVERFLOW_D20 });
    const none = pass({}), l5 = pass({ 'thermal-resist': 5 }), l10 = pass({ 'thermal-resist': 10 });
    expect([none.resistance, l5.resistance, l10.resistance]).toEqual([9, 11, 13]);
    expect(none.factor).toBeGreaterThan(l5.factor);
    expect(l5.factor).toBeGreaterThan(l10.factor);
  });
  it('bless与佩戴品来源取最高一级，不叠加', () => {
    const d = unit('d', 2, { 'thermal-resist': 3 });
    grantTraitSource(d, { id: 's1', name: '抗火祝福', kind: 'blessing', traitIds: ['thermal-resist'], traitLevels: { 'thermal-resist': 7 }, duration: { kind: 'permanent' } });
    expect(anchoredProtection(d, 'thermal')).toBe(11.625);
    const g = unit('g', 2);
    g.gear = [{ id: 'g1', name: '抗魔护符', passive: { traits: [{ id: 'arcane-resist', level: 4 }] } } as never];
    expect(anchoredProtection(g, 'arcane')).toBe(9.75);
  });
  it('没有第二阶段特质规则时不生效', () => {
    const d = unit('d', 2, { 'thermal-resist': 10 });
    delete d.traitLevelModel;
    expect(anchoredProtection(d, 'thermal')).toBe(9);
  });
  it('正文写法、别名与等级说明', () => {
    expect(narrativeTraitLevel('热能抵抗L6')).toMatchObject({ kind: 'trait', id: 'thermal-resist', level: 6 });
    expect(narrativeTraitLevel('抗魔')).toMatchObject({ kind: 'trait', id: 'arcane-resist', level: 1 });
    expect(narrativeTraitLevel('刀枪不入L12')).toMatchObject({ kind: 'trait', id: 'kinetic-resist', level: 10 });
    expect(traitLadderSummary('thermal-resist', 7)).toBe('L7：热能防护+2.625，与护甲同通道相加');
  });
});
