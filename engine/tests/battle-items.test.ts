import { describe, expect, it } from 'vitest';
import { attachCarriedItems, compileItem, generateUnit, MassBattle, SmallBattle, standardField, stripCarriedItems, traitRegistry, V2_D20, V2_TW } from '../src/index.js';
const registry = traitRegistry();
const hero = (id: string, side: 'ally' | 'enemy' = 'ally') => {
  const unit = generateUnit({ name: id, side, scale: 'hero', rulesVersion: 'v2', level: 3, hpMax: 40, hp: 10, traits: [], weaponClass: 'sword' }, { seed: id, registry }).unit;
  unit.id = id; unit.tags.push('zone:中军', 'rank:front'); return unit;
};
function carrier() {
  const mechanics = compileItem({ kind: 'consumable', mechanism: 'heal', power: 3 }, { id: 'dose', seed: 'dose' });
  if (mechanics.kind !== 'consumable') throw new Error('fixture');
  return attachCarriedItems(hero('a'), [{ id: 'dose', name: '急救剂', quantity: 2, revision: 1, mechanics }]);
}
describe('实物战内行动', () => {
  it('物品不占准备槽，预览不消费；治疗占主行动，双击不重复，重开保持次数', () => {
    const a = carrier(); const b = new SmallBattle({ rules: V2_D20, battlefield: standardField(), combatants: [a, hero('e', 'enemy')], seed: 'items', traitRegistry: registry });
    b.start(); while (b.active?.id !== a.id) b.endTurn();
    const ability = a.abilities.find((s) => s.itemSourceId)!;
    expect(a.preparedAbilityIds).not.toContain(ability.id);
    const before = structuredClone(b.toSnapshot());
    const option = b.getActionOptions(a.id).find((o) => o.id === ability.id)!;
    expect(option.targets!.find((t) => t.targetId === a.id)!.preview!.healing).toBe(7);
    expect(b.toSnapshot()).toEqual(before);
    expect(b.useAbility(a.id, ability.id, a.id).ok).toBe(true);
    expect(a.hp).toBe(17); expect(a.resources['item:dose']).toBe(1);
    const after = structuredClone(b.toSnapshot());
    expect(b.useAbility(a.id, ability.id, a.id).ok).toBe(false); expect(b.toSnapshot()).toEqual(after);
    const restored = SmallBattle.fromSnapshot(after, { traitRegistry: registry });
    expect(restored.byId(a.id).resources['item:dose']).toBe(1);
    expect(stripCarriedItems(restored.byId(a.id)).abilities.some((s) => s.itemSourceId)).toBe(false);
    expect(stripCarriedItems(restored.byId(a.id)).resources['item:dose']).toBeUndefined();
  });
  it('满血/阵亡/群体/越距/无库存不能扣物品，预览与执行同拒绝', () => {
    const a = carrier(), target = hero('b');
    const b = new SmallBattle({ rules: V2_D20, battlefield: standardField(), combatants: [a, target, hero('e', 'enemy')], seed: 'invalid-items', traitRegistry: registry });
    b.start(); while (b.active?.id !== a.id) b.endTurn();
    const ability = a.abilities.find((s) => s.itemSourceId)!;
    for (const invalid of [{ hp: 40, status: 'ready', scale: 'hero', pos: a.pos }, { hp: 0, status: 'dead', scale: 'hero', pos: a.pos },
      { hp: 10, status: 'ready', scale: 'company', pos: a.pos }, { hp: 10, status: 'ready', scale: 'hero', pos: 0 }] as const) {
      Object.assign(target, invalid); const before = structuredClone(b.toSnapshot());
      expect(b.useAbility(a.id, ability.id, target.id).ok).toBe(false); expect(b.toSnapshot()).toEqual(before);
    }
    a.resources['item:dose'] = 0;
    expect(b.useAbility(a.id, ability.id, a.id).ok).toBe(false);
  });
  it('军团随队人物排令不扣库存，支援执行占宿主主任务，旧轮重放无效', () => {
    const a = carrier(), host = hero('host'); host.scale = 'company';
    const e = hero('enemy', 'enemy'); e.scale = 'company';
    const b = new MassBattle({ rules: V2_TW, combatants: [host, a, e], seed: 'mass-items', traitRegistry: registry }); b.start();
    const ability = a.abilities.find((s) => s.itemSourceId)!;
    expect(b.useAbility(a.id, ability.id, a.id).ok).toBe(true);
    expect(a.resources['item:dose']).toBe(2); expect(b.orders.get(host.id)?.type).toBe('ability');
    expect(b.issue({ unitId: host.id, type: 'attack', targetId: e.id }).ok).toBe(false);
    b.resolveRound(1); expect(a.hp).toBe(17); expect(a.resources['item:dose']).toBe(1);
    const after = structuredClone(b.toSnapshot()); expect(() => b.resolveRound(1)).toThrow(/过期/); expect(b.toSnapshot()).toEqual(after);
  });
});
