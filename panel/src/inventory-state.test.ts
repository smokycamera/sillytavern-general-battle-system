import { describe, expect, it } from 'vitest';
import { generateUnit, traitRegistry } from '../../engine/src/index.js';
import { materializeUnitRecord, unitRecordFromCombatant, updateUnitRecord } from './unit-state.js';
import { createInventoryItem, deleteUnitArchive, prepareInventoryTransaction, type InventorySave } from './inventory-state.js';

const registry = traitRegistry();
function initial(): InventorySave {
  const records = ['a', 'b'].map((id) => {
    const unit = generateUnit({ name: '同名持有者', side: 'ally', scale: 'hero', rulesVersion: 'v2', level: 3, traits: [], hpMax: 40, hp: 18, weaponClass: 'sword' }, { seed: id, registry }).unit;
    unit.id = id;
    return unitRecordFromCombatant(unit);
  });
  return { schemaVersion: 2, storage: records, rosterIds: ['a'], inventory: [
    createInventoryItem('prize', '缴获战斧', { kind: 'weapon', mechanism: 'axe', power: 8 }, 'prize'),
    createInventoryItem('potion', '急救剂', { kind: 'consumable', mechanism: 'heal', power: 3 }, 'potion', 2),
  ], factRevision: 1 };
}
describe('物品与档案的原子事务', () => {
  it('已装备副武器可从近战改造为步枪或重炮，实物身份和副槽绑定保留', () => {
    const unit=generateUnit({name:'改造车组',side:'ally',scale:'company',body:'vehicle',rulesVersion:'v2',level:3,hpMax:100,weaponClass:'sword',sidearmClass:'axe',traits:[]},{seed:'secondary-reforge',registry}).unit;
    unit.id='vehicle';
    let save:InventorySave={schemaVersion:2,factRevision:1,storage:[unitRecordFromCombatant(unit)],inventory:[]};
    save=prepareInventoryTransaction(save,{id:'adopt',kind:'create',expectedRevision:1,itemId:'spare',name:'备用弓',spec:{kind:'weapon',mechanism:'bow',power:3}});
    const side=save.inventory!.find(i=>i.equippedTo?.unitId==='vehicle'&&i.equippedTo.slot==='sidearm')!;
    const primary=structuredClone(save.storage![0]!.snapshot!.weapon);
    for(const mechanism of ['rifle','cannon']){
      const before=structuredClone(save);
      save=prepareInventoryTransaction(save,{id:'reforge-'+mechanism,kind:'reforge',expectedRevision:save.factRevision!,itemId:side.id,spec:{kind:'weapon',mechanism,power:6}});
      const updated=save.inventory!.find(i=>i.id===side.id)!;
      expect(updated.equippedTo).toEqual({unitId:'vehicle',slot:'sidearm'});
      expect(save.storage![0]!.snapshot!.sidearm?.recipe?.mechanism).toBe(mechanism);
      expect(save.storage![0]!.snapshot!.weapon).toEqual(primary);
      expect(before.inventory!.find(i=>i.id===side.id)!.mechanics).not.toEqual(updated.mechanics);
    }
  });
  it('直接删除档案同时删除四个装备槽实物，未装备物品和其他单位保留，战内拒绝', () => {
    const save = initial(); save.protagonistId = 'a'; save.commanderId = 'a'; save.encounterIds = ['a', 'b'];
    const equipped=generateUnit({name:'持盾者',side:'ally',scale:'hero',rulesVersion:'v2',level:3,traits:[],weaponClass:'sword',sidearmClass:'axe',shield:true},{seed:'delete-equipped',registry}).unit;
    equipped.id='a';save.storage![0]=unitRecordFromCombatant(equipped);
    save.inventory!.forEach(item=>item.assignedTo='a');
    save.orderDraft = { a: { type: 'hold' }, b: { type: 'hold' } }; save.committedNarrativeSources = ['source'];
    const before = structuredClone(save), equippedIds=[equipped.weapon!.id,equipped.sidearm!.id,equipped.armor!.id,equipped.shield!.id];
    const next = deleteUnitArchive(save, 'a'); expect(save).toEqual(before);
    expect(next.storage!.map((r) => r.id)).toEqual(['b']); expect(next.rosterIds).toEqual([]);
    expect(next.protagonistId).toBeUndefined(); expect(next.commanderId).toBeUndefined(); expect(next.encounterIds).toEqual(['b']);
    expect(next.orderDraft).toEqual({ b: { type: 'hold' } }); expect(next.committedNarrativeSources).toEqual(['source']);
    expect(next.inventory!.some((item)=>equippedIds.includes(item.id))).toBe(false);
    expect(next.inventory!.filter(item=>['prize','potion'].includes(item.id))).toHaveLength(2);
    expect(next.inventory!.filter(item=>item.equippedTo?.unitId==='b')).toHaveLength(2);
    expect(next.inventory!.some((i) => i.assignedTo === 'a' || i.equippedTo?.unitId === 'a')).toBe(false);
    expect(() => deleteUnitArchive({ ...save, battle: { kind: 'small', snap: { seed: 'ongoing' } } }, 'a')).toThrow(/战内/);
  });

  it('换装、卸下、转移、再次部署保持同一物品；被换下装备回库', () => {
    const save = initial(), before = structuredClone(save);
    const prize = save.inventory!.find((i) => i.id === 'prize')!.mechanics!;
    if (prize.kind !== 'weapon') throw new Error('fixture');
    const frozenPrize = structuredClone(prize.value);
    const oldWeapon = save.storage![0]!.snapshot!.weapon!;
    let next = prepareInventoryTransaction(save, { id: 'equip-1', expectedRevision: 1, kind: 'equip', unitId: 'a', itemId: 'prize', slot: 'primary' });
    expect(save).toEqual(before);
    expect(materializeUnitRecord(next.storage![0]!, registry).weapon!.id).toBe('prize');
    expect(next.inventory!.find((i) => i.id === oldWeapon.id)!.equippedTo).toBeUndefined();
    expect(next.storage![0]).toMatchObject({ hp: 18, level: 3, base: { hpMax: 40 } });
    expect(() => prepareInventoryTransaction(next, { id: 'steal', expectedRevision: next.factRevision!, kind: 'equip', unitId: 'b', itemId: 'prize', slot: 'primary' })).toThrow(/卸下|已装备/);
    next = prepareInventoryTransaction(next, { id: 'off', expectedRevision: next.factRevision!, kind: 'unequip', unitId: 'a', slot: 'primary' });
    next = prepareInventoryTransaction(next, { id: 'give', expectedRevision: next.factRevision!, kind: 'assign', itemId: 'prize', unitId: 'b' });
    next = prepareInventoryTransaction(next, { id: 'equip-2', expectedRevision: next.factRevision!, kind: 'equip', itemId: 'prize', unitId: 'b', slot: 'primary' });
    const reopened = JSON.parse(JSON.stringify(next)) as InventorySave;
    expect(materializeUnitRecord(reopened.storage![1]!, registry).weapon).toEqual(frozenPrize);
    expect(materializeUnitRecord(reopened.storage![0]!, registry).weapon).toBeUndefined();
    expect(reopened.inventory!.filter((i) => i.id === 'prize')).toHaveLength(1);
  });
  it('使用提交生命和数量，重放旧操作不覆盖后续治疗', () => {
    let next = prepareInventoryTransaction(initial(), { id: 'dose', expectedRevision: 1, kind: 'use', itemId: 'potion', unitId: 'a' });
    expect(next.storage![0]!.hp).toBeGreaterThan(18);
    expect(next.inventory!.find((i) => i.id === 'potion')!.qty).toBe(1);
    next.storage![0] = updateUnitRecord(next.storage![0]!, { hp: 39 }, registry);
    next.factRevision!++;
    const replayed = prepareInventoryTransaction(next, { id: 'dose', expectedRevision: 1, kind: 'use', itemId: 'potion', unitId: 'a' });
    expect(replayed).toEqual(next);
    expect(() => prepareInventoryTransaction(next, { id: 'dose', expectedRevision: 1, kind: 'use', itemId: 'potion', unitId: 'b' })).toThrow(/重复|身份/);
  });
  it('非法使用、旧版本和战内旁路拒绝，原物品数量与档案不变', () => {
    const save = initial(); save.storage![0]!.hp = 40;
    const before = structuredClone(save);
    expect(() => prepareInventoryTransaction(save, { id: 'full', expectedRevision: 1, kind: 'use', itemId: 'potion', unitId: 'a' })).toThrow(/已满/);
    expect(() => prepareInventoryTransaction(save, { id: 'stale', expectedRevision: 0, kind: 'assign', itemId: 'prize', unitId: 'a' })).toThrow(/过期/);
    expect(save).toEqual(before);
    save.battle = { kind: 'small', snap: { seed: 'battle' } };
    expect(() => prepareInventoryTransaction(save, { id: 'bypass', expectedRevision: 1, kind: 'use', itemId: 'potion', unitId: 'a' })).toThrow(/战内|引擎/);
  });
  it('旧叙事物品保留但没有伪造效果；数量为零不会重新变成一件', () => {
    const save = initial(); save.inventory!.push({ id: 'story', name: '治愈圣物', qty: 0, lootType: 'consumable' });
    expect(() => prepareInventoryTransaction(save, { id: 'story-use', expectedRevision: 1, kind: 'use', itemId: 'story', unitId: 'a' })).toThrow(/规格|效果|数量/);
    expect(save.inventory!.at(-1)!.qty).toBe(0);
  });
  it('换装冲突不能把被替换武器或盾牌提前移出槽位', () => {
    const save = initial();
    save.inventory!.push(createInventoryItem('shield', '圆盾', { kind: 'shield', power: 3 }, 'shield'));
    save.inventory!.push(createInventoryItem('cannon', '重炮', { kind: 'weapon', mechanism: 'cannon', power: 3 }, 'cannon'));
    const next = prepareInventoryTransaction(save, { id: 'shield-on', expectedRevision: 1, kind: 'equip', itemId: 'shield', unitId: 'a', slot: 'shield' });
    const before = structuredClone(next);
    expect(() => prepareInventoryTransaction(next, { id: 'conflict', expectedRevision: next.factRevision!, kind: 'equip', itemId: 'cannon', unitId: 'a', slot: 'primary' })).toThrow(/炮组|平台/);
    expect(next).toEqual(before);
  });
  it('重铸保持实物身份与改造历史，已装备投影更新，训练和生命不变', () => {
    let next = prepareInventoryTransaction(initial(), { id: 'equip', expectedRevision: 1, kind: 'equip', itemId: 'prize', unitId: 'a', slot: 'primary' });
    const old = structuredClone(next.inventory!.find((i) => i.id === 'prize')!);
    const actor = structuredClone(next.storage![0]!);
    next = prepareInventoryTransaction(next, { id: 'reforge', expectedRevision: next.factRevision!, kind: 'reforge', itemId: 'prize', name: '附魔战斧', spec: { kind: 'weapon', mechanism: 'axe', power: 9, enchantment: 'arcane' } });
    const item = next.inventory!.find((i) => i.id === 'prize')!;
    expect(item).toMatchObject({ id: old.id, name: '附魔战斧', revision: 2, equippedTo: old.equippedTo });
    expect(item.history![0]!.mechanics).toEqual(old.mechanics);
    expect(next.storage![0]!.snapshot!.weapon).toMatchObject({ id: old.id, name: '附魔战斧', channel: 'arcane', level: 9 });
    expect([next.storage![0]!.hp, next.storage![0]!.level, next.storage![0]!.base.hpMax]).toEqual([actor.hp, actor.level, actor.base.hpMax]);
  });
  it('从旧叙事库存明确补全一件规格，保留余量；已装备物品不能直接丢弃', () => {
    const save = initial(); save.inventory!.push({ id: 'legacy', name: '旧剑', lootType: 'weapon', qty: 3, note: '旧正文来源' });
    const next = prepareInventoryTransaction(save, { id: 'define', expectedRevision: 1, kind: 'define', itemId: 'legacy', spec: { kind: 'weapon', mechanism: 'sword', power: 4 } });
    expect(next.inventory!.find((i) => i.id === 'legacy')!.qty).toBe(2);
    expect(next.inventory!.find((i) => i.sourceItemId === 'legacy')).toMatchObject({ name: '旧剑', qty: 1, mechanics: { kind: 'weapon' } });
    const equipped = prepareInventoryTransaction(next, { id: 'equip', expectedRevision: next.factRevision!, kind: 'equip', itemId: 'prize', unitId: 'a', slot: 'primary' });
    expect(() => prepareInventoryTransaction(equipped, { id: 'discard', expectedRevision: equipped.factRevision!, kind: 'discard', itemId: 'prize', qty: 1 })).toThrow(/卸下/);
  });
});
