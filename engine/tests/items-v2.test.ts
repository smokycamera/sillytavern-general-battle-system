import { describe, expect, it } from 'vitest';
import { generateUnit, traitRegistry } from '../src/index.js';
import { compileItem, equipmentReason, healingAmount } from '../src/items.js';

const hero = () => generateUnit({ name: '携行者', side: 'ally', scale: 'hero', level: 3, rulesVersion: 'v2', traits: [], weaponClass: 'sword', armorTier: 1 }, { seed: 'carrier', registry: traitRegistry() }).unit;

describe('V2独立物品与真实配装规则', () => {
  it('独立L1武器与单位默认L1武器复用同一公式、槽位种子和冻结结果', () => {
    const unit = hero();
    const item = compileItem({ kind: 'weapon', mechanism: 'sword', power: 1 }, { id: unit.weapon!.id, name: unit.weapon!.name, seed: 'carrier:primary' });
    expect(item).toEqual({ kind: 'weapon', value: unit.weapon });
    expect(compileItem({ kind: 'weapon', mechanism: 'sword', power: 5 }, { id: unit.weapon!.id, name: unit.weapon!.name, seed: 'carrier:primary' })).toEqual(item);
  });
  it('双手武器可以配盾，检查不得卸装或变更武器', () => {
    const unit = hero();
    const rifle = compileItem({ kind: 'weapon', mechanism: 'rifle', power: 6 }, { id: 'rifle', name: '配发步枪', seed: 'rifle' });
    if (rifle.kind !== 'weapon') throw new Error('fixture');
    unit.weapon = rifle.value; unit.shield = { id: 'shield', load: 2 };
    const before = structuredClone(unit);
    expect(equipmentReason(unit)).toBeUndefined();
    expect(unit).toEqual(before);
  });
  it('库存中的重炮不能由普通单兵装备，炮组和明确平台有合法入口', () => {
    const gun = compileItem({ kind: 'weapon', mechanism: 'cannon', power: 8 }, { id: 'gun', name: '重炮', seed: 'gun' });
    if (gun.kind !== 'weapon') throw new Error('fixture');
    const unit = hero(); unit.weapon = gun.value;
    expect(equipmentReason(unit)).toMatch(/炮组|平台/);
    unit.body = 'vehicle'; expect(equipmentReason(unit)).toBeUndefined();
  });
  it('机械规格未知时拒绝，不按物品名字猜测；治疗不会招募兵员', () => {
    expect(() => compileItem({ kind: 'weapon', mechanism: 'arbitrary-god-gun', power: 5 }, { id: 'x', name: '普通剑', seed: 'x' })).toThrow(/机制/);
    const unit = hero(); unit.hp = 1;
    expect(healingAmount(unit, 999)).toBe(unit.base.hpMax - 1);
    unit.hp = unit.base.hpMax; expect(() => healingAmount(unit, 5)).toThrow(/已满/);
    unit.hp = 1; unit.scale = 'company'; expect(() => healingAmount(unit, 5)).toThrow(/兵员|群体/);
  });
});
