import { describe, expect, it } from 'vitest';
import { activeTraitIds, equipmentTraitIds, traitStatAdjustments, grantTraitSource, expireTraitSources, generateUnit, traitRegistry,
  standardConditionMap, collectMods, resolveStack, SmallBattle, MassBattle, V4_D20, V4_TW, standardField, anchoredProtection,
  applyXp, type Combatant } from '../src/index.js';
import { trainingEdge } from '../src/enhancements.js';
import { materializeUnitRecord, unitRecordFromCombatant } from '../../panel/src/unit-state.js';
import { createInventoryItem, prepareInventoryTransaction, prepareInventoryState, type InventorySave } from '../../panel/src/inventory-state.js';
import { assertTraitSourcePanelWrite } from '../../panel/src/trait-state.js';
import { itemDescription } from '../../panel/src/inventory-view.js';
import { buildPreview, unitForm } from '../../panel/src/unit-form.js';
import { newUnitDraft } from '../../panel/src/unit-builder.js';

const registry = traitRegistry(), conditionDefs = standardConditionMap();
function unit(tier: 0 | 1 | 2 | 3 | 4, traits: string[] = [], id = 'd'): Combatant {
  const u = generateUnit({ name: id, side: id === 'a' ? 'ally' : 'enemy', scale: 'company', rulesVersion: 'v2', level: 4,
    hpMax: 10, hp: 8, armorTier: tier, armorLevel: 4, quality: 3, weaponClass: 'rifle', weaponLevel: 4, traits }, { registry, seed: id, noVariance: true }).unit;
  u.id = id; u.morale = u.base.moraleMax = 100; return u;
}
const stats = (u: Combatant) => Object.fromEntries((['def', 'spd'] as const).map(key => [key, u.base[key] + (traitStatAdjustments(u, registry)[key] ?? 0)]));

describe('装备自动重装特质', () => {
  it('不填写traits也自动获得对应重装性质；只有实际护甲构型生效，不改写原生特质', () => {
    for (const tier of [0, 1, 2, 3, 4] as const) {
      const u = unit(tier), before = JSON.stringify(u);
      const expected = tier === 4 ? ['super-heavy'] : tier === 3 ? ['heavy-armor'] : [];
      expect(equipmentTraitIds(u)).toEqual(expected); expect(activeTraitIds(u)).toEqual(expected);
      expect(traitStatAdjustments(u)).toEqual(tier >= 3 ? { spd: -(tier - 2) } : {});
      expect(JSON.stringify(u)).toBe(before); expect(u.traits).toEqual([]); expect(u.traitSources).toBeUndefined();
    }
    const misleading = unit(1); misleading.armor!.name = '神器超重甲'; expect(equipmentTraitIds(misleading)).toEqual([]);
    misleading.rulesVersion = undefined; misleading.armor!.tier = 4; expect(equipmentTraitIds(misleading)).toEqual([]);
  });
  it('原生、祝福和装备来源取强不重复；临时来源到期不撤销仍然穿戴的护甲效果', () => {
    const plain = unit(4), manual = unit(4, ['heavy-armor', 'super-heavy']);
    expect(stats(manual)).toEqual(stats(plain));
    grantTraitSource(plain, { id: 'temporary', name: '临时重装', kind: 'blessing', traitIds: ['heavy-armor', 'super-heavy'], duration: { kind: 'rounds', count: 1 } });
    grantTraitSource(plain, { id: 'item-source', name: '实物重装', kind: 'equipment', equipmentId: plain.armor!.id, traitIds: ['super-heavy'], duration: { kind: 'permanent' } });
    expect(stats(plain)).toEqual(stats(manual)); expireTraitSources(plain, 'rounds'); expect(stats(plain)).toEqual(stats(manual));
    delete plain.armor; delete manual.armor;
    expect(stats(plain)).toEqual(stats(unit(0))); expect(stats(manual)).toEqual(stats(unit(0)));
    expect(manual.traits).toEqual(['heavy-armor', 'super-heavy']);
  });
  it('库存装备、同实物改造、降为轻甲与卸下即时更新，刷新不残留、不重复加成', () => {
    const u = unit(0), original = structuredClone(u);
    let save: InventorySave = prepareInventoryState({ schemaVersion: 2, factRevision: 1, storage: [unitRecordFromCombatant(u)], inventory: [createInventoryItem('plate', '护卫铠甲', { kind: 'armor', tier: 3, power: 4, quality: 3 }, 'plate')] });
    const getUnit = () => materializeUnitRecord(save.storage![0]!, registry);
    const equip = () => { const old = save; save = prepareInventoryTransaction(save, { id: 'equip-' + save.factRevision, expectedRevision: save.factRevision!, kind: 'equip', itemId: 'plate', unitId: u.id, slot: 'armor' }); assertTraitSourcePanelWrite(old, save); };
    equip(); expect(activeTraitIds(getUnit())).toContain('heavy-armor');
    const seed = getUnit().armor!.recipe!.seed;
    for (const tier of [4, 1, 3] as const) {
      const old = save;
      save = prepareInventoryTransaction(save, { id: 'reforge-' + tier, expectedRevision: save.factRevision!, kind: 'reforge', itemId: 'plate', spec: { kind: 'armor', tier, power: 4, quality: 3 } });
      assertTraitSourcePanelWrite(old, save);
      save = prepareInventoryState(JSON.parse(JSON.stringify(save)));
      expect(equipmentTraitIds(getUnit())).toEqual(tier === 4 ? ['super-heavy'] : tier === 3 ? ['heavy-armor'] : []);
      expect(getUnit().armor!.id).toBe('plate'); expect(getUnit().armor!.recipe!.seed).toBe(seed);
      expect([getUnit().hp, getUnit().level, getUnit().traits]).toEqual([original.hp, original.level, original.traits]);
    }
    save = prepareInventoryTransaction(save, { id: 'unequip', expectedRevision: save.factRevision!, kind: 'unequip', unitId: u.id, slot: 'armor' });
    expect(equipmentTraitIds(getUnit())).toEqual([]); expect(traitStatAdjustments(getUnit())).toEqual({});
    equip(); expect(traitStatAdjustments(getUnit())).toEqual({ spd: -1 });
  });
  it.each(['small', 'mass'] as const)('%s实际攻击和预览不再叠加重装防御，先攻代价与护甲防护仍然生效', mode => {
    for (const tier of [3, 4] as const) {
      const a = unit(0, [], 'a'), d = unit(tier), rng = { seed: 'hit', next: () => 0, d: (n: number) => n };
      const field = standardField(); field.tiles.fill('open');
      const b = mode === 'small' ? new SmallBattle({ combatants: [a, d], rules: V4_D20, battlefield: field, rng, traitRegistry: registry })
        : new MassBattle({ combatants: [a, d], rules: V4_TW, rng, traitRegistry: registry });
      b.start();
      expect(resolveStack(collectMods(d, {}, conditionDefs, [], registry), 'spd', {}).flatTotal).toBe(-(tier - 2));
      let preview, result;
      if (b instanceof SmallBattle) {
        b.turnOrder = ['a', 'd']; b.turnIndex = 0; a.pos = 30; d.pos = 16;
        preview = b.getActionOptions('a').find(o => o.id === 'weapon')!.targets![0]!.preview!; result = b.attack('a', 'd');
      } else {
        const order = { unitId: 'a', type: 'volley' as const, targetId: 'd' }; preview = b.orderPreview(order).preview!;
        expect(b.issue(order).ok).toBe(true); b.issue({ unitId: 'd', type: 'hold' }); b.resolveRound(); result = b.log.find(e => e.resolution?.attackerId === 'a')!.resolution!;
      }
      expect(preview.defenseScore).toBe(d.base.def + trainingEdge(d.level)); expect(result.targetDef).toBe(preview.defenseScore);
      expect(result.resistance).toBe(anchoredProtection(d, 'kinetic'));
      const restored = b instanceof SmallBattle ? SmallBattle.fromSnapshot(structuredClone(b.toSnapshot())) : MassBattle.fromSnapshot(structuredClone(b.toSnapshot()));
      expect(equipmentTraitIds(restored.byId('d'))).toEqual([tier === 4 ? 'super-heavy' : 'heavy-armor']); expect(stats(restored.byId('d'))).toEqual(stats(d));
    }
  });
  it('旧档案无需重新生成；升级与反复保存不烘焙第二份装备加成', () => {
    for (const traits of [[], ['heavy-armor', 'super-heavy']]) {
      let u = unit(4, traits), weapon = structuredClone(u.weapon), armor = structuredClone(u.armor);
      delete u.bakedTraitStats; // 兼容只有旧生成审计的档案
      const before = stats(u);
      for (let n = 0; n < 3; n++) u = materializeUnitRecord(unitRecordFromCombatant(u), registry);
      expect(stats(u)).toEqual(before); expect(u.weapon).toEqual(weapon); expect(u.armor).toEqual(armor);
      applyXp(u, 9999, registry);
      const equipped = stats(u); delete u.armor;
      expect(equipped.def! - stats(u).def!).toBe(0); expect(equipped.spd! - stats(u).spd!).toBe(-2);
    }
    // 上一版手动超重特质可能已把防御+2计入基础；读取时净修正必须抵消它。
    const old = unit(4, ['super-heavy']); old.base.def += 2; old.bakedTraitStats!.def = 2;
    const restored = materializeUnitRecord(unitRecordFromCombatant(old), registry);
    expect(stats(restored)).toEqual(stats(unit(4)));
    expect(traitStatAdjustments(restored).def).toBe(-2);
  });
  it('建档预览与库存说明标明自动来源，无需用户另行勾选', () => {
    const d = newUnitDraft(); d.armor.tier = '4';
    expect(unitForm('test', d, registry)).toContain('装备自动特质：超重装甲');
    expect(buildPreview(unit(3))).toContain('重甲（先攻−1，无额外防御）');
    const item = createInventoryItem('plate', '铠甲', { kind: 'armor', tier: 4, power: 4 }, 'plate');
    expect(itemDescription(item)).toContain('装备自动特质：超重装甲');
  });
});
