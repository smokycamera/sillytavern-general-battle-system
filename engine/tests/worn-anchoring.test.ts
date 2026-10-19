import { describe, expect, it } from 'vitest';
import { compileItem, compileWornEffects, gearItem, generateUnit, historicalWornItem,
  itemSpecText, movementPoints, prepareCombatModel, prepareItemModel, prepareTraitLevelModel, previewAttack,
  traitRegistry, standardConditionMap, upgradeWornItemBudget, validateItemValue, V23_OVERFLOW_D20,
  wornEffects, type ItemValue } from '../src/index.js';
import { ENHANCEMENT_STATS, type BonusStat, type Enhancements } from '../src/enhancements.js';
import { itemEffectRows, itemValueSummary, overshadowedGear } from '../../panel/src/item-description.js';

function item(power: number, bonuses: Enhancements): ItemValue {
  const m = compileItem({ kind: 'item', form: 'worn', power, bonuses }, { id: 'g', seed: 'g' });
  if (m.kind !== 'item') throw Error('fixture');
  return m.value;
}
function unit(id = 'a') {
  const u = generateUnit({ name: id, side: id === 'a' ? 'ally' : 'enemy', scale: 'hero', rulesVersion: 'v2',
    damageModel: 'wounds-v2', level: 5, weaponClass: 'sword', armorTier: 0, traits: [] }, { seed: id, noVariance: true }).unit;
  u.id = id;
  prepareCombatModel(u, V23_OVERFLOW_D20); prepareItemModel(u, V23_OVERFLOW_D20); prepareTraitLevelModel(u, V23_OVERFLOW_D20);
  return u;
}

describe('佩戴等级锚定修正', () => {
  it('十二个方向的+1至+10在十级逐级增加，满额速度每级多走一格', () => {
    for (const stat of ENHANCEMENT_STATS.gear) for (let points = 1; points <= 10; points++) {
      let last = 0;
      for (let level = 1; level <= 10; level++) {
        const value = item(level, { [stat]: points });
        validateItemValue(JSON.parse(JSON.stringify(value)));
        const actual = value.passive!.actualEffects!.values[stat]!;
        expect(actual, `${stat}+${points} L${level}`).toBeGreaterThan(last); last = actual;
      }
    }
    const u = unit(), base = movementPoints(u);
    for (let level = 1; level <= 10; level++) {
      u.gear = [gearItem('g', 'g', item(level, { speed: 10 }))];
      expect(movementPoints(u) - base).toBeCloseTo(level);
    }
  });

  it('精度和防御升级在实际命中概率中兑现，伤害与通道修正保持原上限', () => {
    const a = unit(), e = unit('e'), options = { attacker: a, defender: e, rules: V23_OVERFLOW_D20,
      conditionDefs: standardConditionMap(), traitRegistry: traitRegistry(), ranged: false };
    const base = previewAttack(options); a.base.atk += base.defenseScore! - base.attackScore! - 10;
    let hit = previewAttack(options).hitChance, defended = hit;
    for (let level = 1; level <= 10; level++) {
      a.gear = [gearItem('g', 'g', item(level, { accuracy: 10 }))]; e.gear = [];
      const chance = previewAttack(options).hitChance;
      expect(chance).toBeGreaterThan(hit); hit = chance;
      a.gear = []; e.gear = [gearItem('g', 'g', item(level, { defense: 10 }))];
      const reduced = previewAttack(options).hitChance;
      expect(reduced).toBeLessThan(defended); defended = reduced;
    }
    const caps = compileWornEffects({ damage: 10, kineticDamage: 10, protection: 10, kineticProtection: 10 }, 10);
    expect(caps.values.damage! + caps.values.kineticDamage!).toBeCloseTo(1.25 * 1.82);
    expect(caps.values.protection! + caps.values.kineticProtection!).toBeCloseTo(.75 * 5.2);
    for (const stat of ENHANCEMENT_STATS.gear) expect(compileWornEffects({ [stat]: -10 }, 10).values[stat]).toBe(compileWornEffects({ [stat]: -10 }, 5).values[stat]);
  });

  it('历史实物读取不变；显式更新统一新旧换算并恢复速度移动', () => {
    const old = item(1, { defense: 2, speed: 1 }); delete old.recipe.wornEffectModel;
    old.passive!.actualEffects = compileWornEffects(old.passive!.bonuses, 1, 'worn-progression-v1');
    const before = JSON.stringify(old), up = upgradeWornItemBudget(old);
    expect(JSON.stringify(old)).toBe(before); expect(historicalWornItem(up)).toBe(false);
    expect(up.passive).toEqual(item(1, { defense: 2, speed: 1 }).passive);
    delete old.passive!.actualEffects; delete old.recipe.progressionModel;
    const legacy = JSON.stringify(old), upgradedLegacy = upgradeWornItemBudget(old);
    expect(JSON.stringify(old)).toBe(legacy); expect(upgradedLegacy.passive).toEqual(up.passive);
    const u = unit(); u.gear = [gearItem('g', 'g', upgradedLegacy)];
    expect(wornEffects(u).speed).toBeCloseTo(.1);
    const custom = item(1, { defense: 2 }); delete custom.recipe.wornEffectModel;
    custom.passive!.actualEffects!.values.defense = 999;
    expect(() => upgradeWornItemBudget(custom)).toThrow('可信配方');
  });

  it('效果带单位、配方独立、升级收益可见，覆盖提示使用实际值且速度也参与取强', () => {
    const value = item(1, { defense: 2, speed: 1 });
    expect(itemEffectRows(value)).toEqual([
      { stat: 'defense', name: '防御', actual: '+0.2格', written: '+2', next: '+0.06格' },
      { stat: 'speed', name: '速度', actual: '+0.1步', written: '+1', next: '+0.1步' },
    ]);
    expect(itemValueSummary(value, itemSpecText(value.recipe))).toBe('防御+0.2格、速度+0.1步');
    const u = unit(); u.gear = [gearItem('old', 'old', value), gearItem('new', 'new', item(2, { defense: 2, speed: 1 }))];
    expect(overshadowedGear(u, 'old')).toEqual(['防御+0.2格', '速度+0.1步']);
    for (const stat of ['protection', 'morale', 'kineticDamage'] as BonusStat[]) expect(itemEffectRows(item(2, { [stat]: 10 }))[0]!.actual).toMatch(/(?:抗穿|点|%)$/);
  });
});
