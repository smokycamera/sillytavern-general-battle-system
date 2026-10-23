import { expect, it } from 'vitest';
import { generateUnit, SmallBattle, V25_OVERFLOW_D20, type Combatant } from '../../engine/src/index.js';
import { compileItem, type ItemSpecification } from '../../engine/src/items.js';
import { equipmentCapacity, equipmentLoad } from '../../engine/src/equipment-load.js';
import { movementPoints } from '../../engine/src/tactics.js';
import { equipmentLoadLabel } from '../../engine/src/body.js';
import { autoTraitLabel } from '../../engine/src/trait-sources.js';
import { migrateOutOfBattleLoads } from './load-migration.js';
import { prepareInventoryState, type InventorySave, type InventoryItem } from './inventory-state.js';
import { unitRecordFromCombatant } from './unit-state.js';

export function oldLoadSave(): InventorySave {
  const unit = generateUnit({ name: '旧炮兵', side: 'ally', scale: 'company', level: 4, body: 'human', rulesVersion: 'v2', damageModel: 'wounds-v2', traits: [], weaponClass: 'cannon', armorTier: 3 }, { seed: 'old-load' }).unit;
  return prepareInventoryState({ schemaVersion: 2, storage: [unitRecordFromCombatant(unit)], rosterIds: [unit.id], factRevision: 3 });
}
function item(id: string, spec: ItemSpecification): InventoryItem {
  return { id, name: id, qty: 1, lootType: spec.kind, revision: 1, mechanics: compileItem(spec, { id, seed: id }) };
}
it('战外同时更新库存和配装，仅改默认负载与容量版本，保存其他实物属性', () => {
  const before = oldLoadSave(), frozen = structuredClone(before);
  const after = migrateOutOfBattleLoads(before), oldUnit = before.storage![0]!.snapshot!, unit = after.storage![0]!.snapshot!;
  expect(oldUnit.weapon!.load).toBe(6); expect(unit.weapon!.load).toBe(12);
  expect(oldUnit.armor!.load).toBe(4); expect(unit.armor!.load).toBe(6);
  expect(after.inventory!.find(i => i.id === unit.weapon!.id)!.mechanics).toEqual({ kind: 'weapon', value: unit.weapon });
  expect(after.inventory!.map(i => i.revision)).toEqual(before.inventory!.map(i => (i.revision ?? 1) + 1));
  expect(after.factRevision).toBe(4); expect(after.storage![0]!.revision).toBe((before.storage![0]!.revision ?? 1) + 1);
  const stripLoad = (u: Combatant) => {
    const copy = structuredClone(u); delete copy.loadModel;
    for (const value of [copy.weapon, copy.armor]) { delete value!.load; delete value!.recipe!.loadModel; }
    return copy;
  };
  expect(stripLoad(unit)).toEqual(stripLoad(oldUnit)); expect(before).toEqual(frozen);
  expect(migrateOutOfBattleLoads(after)).toBe(after);
});
it('手工负载、不可信配方保留；只手改伤害不阻止默认负载更新', () => {
  const manual = item('manual', { kind: 'weapon', mechanism: 'cannon', power: 4 });
  const same = item('same', { kind: 'weapon', mechanism: 'cannon', power: 4 });
  const damage = item('damage', { kind: 'weapon', mechanism: 'cannon', power: 4 });
  const unknown = item('unknown', { kind: 'weapon', mechanism: 'cannon', power: 4 });
  if (manual.mechanics!.kind !== 'weapon' || same.mechanics!.kind !== 'weapon' || damage.mechanics!.kind !== 'weapon' || unknown.mechanics!.kind !== 'weapon') throw Error();
  manual.mechanics!.value.load = 9; same.mechanics!.value.loadOverride = true;
  damage.mechanics!.value.customized = true; damage.mechanics!.value.baseDice = '99d6';
  delete unknown.mechanics!.value.recipe;
  const save = { inventory: [manual, same, damage, unknown] }, next = migrateOutOfBattleLoads(save);
  expect(next.inventory[0]).toBe(manual); expect(next.inventory[1]).toBe(same); expect(next.inventory[3]).toBe(unknown);
  expect(next.inventory[2]!.mechanics).toMatchObject({ value: { baseDice: '99d6', customized: true, load: 12 } });
});
it('车载护甲、机炮、弩、法杖、能量盾与重量修正按各自原配方升级', () => {
  const specs: ItemSpecification[] = [
    { kind: 'armor', tier: 4, power: 5, body: 'vehicle' },
    { kind: 'weapon', mechanism: 'autocannon', power: 5, body: 'vehicle', bonuses: { weight: -2 } },
    { kind: 'weapon', mechanism: 'crossbow', power: 3 }, { kind: 'weapon', mechanism: 'magic', power: 3 },
    { kind: 'shield', mechanism: 'shield', power: 3 }, { kind: 'shield', mechanism: 'energy-shield', power: 3 },
  ];
  const inventory = specs.map((spec, index) => item('gear' + index, spec));
  const next = migrateOutOfBattleLoads({ inventory });
  specs.forEach((spec, index) => {
    const expected = compileItem(spec, { id: 'gear' + index, seed: 'gear' + index, loadModel: 'capacity-v2' });
    expect(next.inventory[index]!.mechanics).toMatchObject({ value: { load: expected.kind !== 'item' ? expected.value.load : undefined, recipe: { loadModel: 'capacity-v2' } } });
  });
});
it('进行中完全跳过；结算只更新档案，原战斗快照和战报保持逐字相同', () => {
  const save = oldLoadSave(), unit = save.storage![0]!.snapshot!;
  const enemy = generateUnit({ name: '敌', side: 'enemy', scale: 'company', level: 4, rulesVersion: 'v2', traits: [] }, { seed: 'enemy' }).unit;
  const battle = new SmallBattle({ combatants: [unit, enemy], seed: 'frozen', rules: V25_OVERFLOW_D20 }); battle.start();
  const active = { ...save, battle: { kind: 'small' as const, snap: battle.toSnapshot() }, reports: [{ old: '原战报' }] };
  const snapshot = JSON.stringify(active.battle);
  expect(migrateOutOfBattleLoads(active)).toBe(active);
  const settled = { ...active, committedOutcomeIds: ['small:frozen'] }, after = migrateOutOfBattleLoads(settled);
  expect(after.battle).toBe(active.battle); expect(JSON.stringify(after.battle)).toBe(snapshot); expect(after.reports).toBe(active.reports);
  expect(after.storage![0]!.snapshot!.weapon!.load).toBe(12);
  expect(JSON.stringify(SmallBattle.fromSnapshot(after.battle.snap).toSnapshot())).toBe(JSON.stringify(SmallBattle.fromSnapshot(active.battle.snap).toSnapshot()));
});
it('没有numericModel的旧档也更新容量、体型倍率和负担，基础属性不变', () => {
  const old = oldLoadSave(), unit = old.storage![0]!.snapshot!;
  delete unit.numericModel; delete unit.armsModel; unit.scale = 'hero';
  const after = migrateOutOfBattleLoads(old).storage![0]!.snapshot!;
  expect(after.base).toEqual(unit.base); expect(after.hp).toBe(unit.hp); expect(after.numericModel).toBeUndefined();
  expect(equipmentCapacity(after)).toBe(12); expect(equipmentCapacity({ ...after, body: 'large' })).toBe(18);
  expect(equipmentCapacity({ ...after, body: 'giant' })).toBe(24); expect(equipmentCapacity({ ...after, body: 'vehicle', level: 5 })).toBe(28);
  expect(equipmentLoadLabel(after)).toContain('/12'); expect(autoTraitLabel('heavy-armor', after)).toContain('容量占比');
  expect(equipmentLoad(after)).toBeGreaterThan(12);
  expect(movementPoints(after)).toBeLessThan(3);
});
