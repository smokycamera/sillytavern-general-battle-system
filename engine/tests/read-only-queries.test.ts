import { describe, expect, it } from 'vitest';
import { applySkillCondition, beginPreviewScope, endPreviewScope, generateUnit, previewScopeEpoch,
  SmallBattle, standardField, traitRegistry, V12_OVERFLOW_D20 } from '../src/index.js';

function fixture() {
  const registry = traitRegistry();
  const units = ['rider', 'friend', 'foe'].map(id => {
    const u = generateUnit({ name: id, side: id === 'foe' ? 'enemy' : 'ally', scale: 'company', hpMax: 20,
      rulesVersion: 'v2', level: 4, weaponClass: 'spear', weaponLevel: 4, armorTier: 1, traits: [],
      archetype: 'mobile' }, { registry, seed: `query:${id}`, noVariance: true }).unit;
    u.id = id; u.mount = true; return u;
  });
  const field = standardField(7, 13); field.tiles.fill('open');
  field.layerVersion = 1; field.structures = field.tiles.map(() => null);
  const b = new SmallBattle({ combatants: units, battlefield: field, rules: V12_OVERFLOW_D20, seed: 'query-scope', traitRegistry: registry });
  b.start(); b.turnOrder = units.map(u => u.id); b.turnIndex = 0;
  b.byId('rider').pos = 45; b.byId('friend').pos = 52; b.byId('foe').pos = 24;
  return { b, registry, field: b.battlefield! };
}

describe('同步战术查询范围', () => {
  it('只读点选不改战斗；正常或异常退出后，地形、占位、移动和回合变化都重新查询', () => {
    const { b, registry, field } = fixture(), before = b.toSnapshot();
    const fresh = () => SmallBattle.fromSnapshot(structuredClone(b.toSnapshot()), { traitRegistry: registry });
    const charge = () => b.getActionOptions('rider').find(o => o.id === 'charge')!;
    expect(charge().enabled).toBe(true);
    b.withReadOnlyQueries(() => {
      const first = b.getActionOptions('rider');
      expect(b.withReadOnlyQueries(() => b.getActionOptions('rider'))).toEqual(first);
      expect(b.reachableCells('rider')).toEqual(fresh().reachableCells('rider'));
    });
    expect(b.toSnapshot()).toEqual(before);
    expect(previewScopeEpoch()).toBeUndefined();
    expect(() => b.withReadOnlyQueries(() => { b.getActionOptions('rider'); throw Error('interrupted render'); })).toThrow('interrupted render');
    expect(previewScopeEpoch()).toBeUndefined();
    for (const cell of [17, 23, 25, 31]) field.tiles[cell] = 'shallow_water';
    expect(charge().enabled).toBe(false);
    expect(b.getActionOptions('rider')).toEqual(fresh().getActionOptions('rider'));
    field.tiles.fill('open'); b.fieldTags.push('night'); b.byId('foe').pos = 0;
    expect(charge().targets?.some(t => t.targetId === 'foe')).toBe(false);
    b.byId('foe').pos = 24; b.byId('friend').pos = 46;
    b.moveTo('rider', 44);
    expect(b.getActionOptions('rider')).toEqual(fresh().getActionOptions('rider'));
    b.endTurn();
    expect(b.getActionOptions('rider')).toEqual(fresh().getActionOptions('rider'));
  });

  it('加速移动与普通冲锋按各自预算查询，嵌套菜单保留调用者的抽样范围', () => {
    const { b } = fixture(), rider = b.byId('rider');
    rider.pos = 73; b.byId('friend').pos = 25;
    applySkillCondition(rider, { id: 'hasted', dur: 5, magnitude: 1 });
    b.selectHaste('rider', true);
    const budget = b.movementLeft('rider', false);
    beginPreviewScope();
    const outer = previewScopeEpoch();
    try {
      b.withReadOnlyQueries(() => {
        const paths = b.reachableCells('rider');
        expect(paths.some(p => p.cost > budget)).toBe(true);
        expect(paths.some(p => [17, 23, 25, 31].includes(p.cells.at(-1)!))).toBe(true);
        expect(b.getActionOptions('rider').find(o => o.id === 'charge')?.enabled).toBe(false);
        expect(b.reachableCells('rider')).toEqual(paths);
        expect(previewScopeEpoch()).toBe(outer);
      });
      expect(previewScopeEpoch()).toBe(outer);
    } finally { endPreviewScope(); }
  });
});
