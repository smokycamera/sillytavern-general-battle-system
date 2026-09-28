import { describe, expect, it } from 'vitest';
import { generateUnit, traitRegistry } from '../../engine/src/index.js';
import { unitRecordFromCombatant, materializeUnitRecord } from './unit-state.js';
import { createInventoryItem, prepareInventoryState, prepareInventoryTransaction, type InventoryIntent } from './inventory-state.js';
import { compileItem } from '../../engine/src/items.js';
import { nominalLife } from '../../engine/src/combat-model.js';
import { buildUnit, editUnitBuild, newUnitDraft, unitDraftFromRecord } from './unit-builder.js';
const registry=traitRegistry();
function fixture() {
  const u=generateUnit({name:'owner',side:'ally',scale:'hero',rulesVersion:'v2',damageModel:'wounds-v2',level:3,weaponClass:'sword',armorTier:1,traits:[]},{seed:'bulk',registry}).unit; u.id='owner';
  return prepareInventoryState({factRevision:1,schemaVersion:2,storage:[unitRecordFromCombatant(u)],inventory:[
    createInventoryItem('a','剑',{kind:'weapon',mechanism:'sword',power:3},'a'),
    createInventoryItem('b','药',{kind:'consumable',mechanism:'heal',power:3},'b',99),
    {id:'story',name:'战利品',qty:24,lootType:'misc'},
  ]});
}
const intent=(items:{itemId:string;qty:number}[],expectedRevision=1):Extract<InventoryIntent,{kind:'discard-many'}>=>({id:'bulk:1',kind:'discard-many',expectedRevision,items});
describe('atomic inventory deletion',()=>{
  it('whole stacks in one operation / one revision, original input unchanged, replay idempotent',()=>{
    const save=fixture(),before=structuredClone(save),action=intent([{itemId:'a',qty:1},{itemId:'b',qty:99},{itemId:'story',qty:24}]);
    const next=prepareInventoryTransaction(save,action);
    expect(save).toEqual(before);expect(next.factRevision).toBe(2);expect(next.inventoryOperations).toHaveLength(1);
    expect(next.inventory!.filter(i=>['a','b','story'].includes(i.id)).every(i=>i.qty===0)).toBe(true);
    expect(next.storage).toEqual(before.storage);expect(next.inventory!.filter(i=>i.equippedTo)).toEqual(before.inventory!.filter(i=>i.equippedTo));
    expect(prepareInventoryTransaction(JSON.parse(JSON.stringify(next)),action)).toEqual(JSON.parse(JSON.stringify(next)));
    expect(()=>prepareInventoryTransaction(next,{...action,items:[{itemId:'a',qty:1}]})).toThrow(/重复|身份/);
  });
  it.each([
    [],[{itemId:'a',qty:1},{itemId:'missing',qty:1}], [{itemId:'a',qty:1},{itemId:'a',qty:1}],
    [{itemId:'a',qty:1},{itemId:'b',qty:98}], [{itemId:'b',qty:100}], [{itemId:'b',qty:0}],
    [{itemId:'b',qty:-1}], [{itemId:'b',qty:1.2}], [{itemId:'b',qty:Infinity}], [{itemId:'',qty:1}],
  ].map(items=>({items})))('invalid selection rolls back the entire batch: %j',({items})=>{
    const save=fixture(),before=structuredClone(save);expect(()=>prepareInventoryTransaction(save,intent(items))).toThrow();expect(save).toEqual(before);
  });
  it('equipped, stale, vanished, in-battle and malformed requests never delete an earlier valid entry',()=>{
    const save=fixture(),before=structuredClone(save),equipped=save.inventory!.find(i=>i.equippedTo)!.id;
    expect(()=>prepareInventoryTransaction(save,intent([{itemId:'a',qty:1},{itemId:equipped,qty:1}]))).toThrow(/卸下|装备/);
    expect(()=>prepareInventoryTransaction(save,intent([{itemId:'a',qty:1}],0))).toThrow(/过期/);
    expect(()=>prepareInventoryTransaction({...save,battle:{kind:'small',snap:{seed:'x'}}},intent([{itemId:'a',qty:1}]))).toThrow(/战内/);
    for(const items of [null,undefined,[null],[1]]) expect(()=>prepareInventoryTransaction(save,{...intent([]),items} as unknown as InventoryIntent)).toThrow();
    expect(save).toEqual(before);
  });
  it('new frozen roll survives reforge, ownership/equipment changes and save/reload; old item stays old',()=>{
    let save=fixture();const item=save.inventory!.find(i=>i.id==='a')!;if(item.mechanics?.kind!=='weapon')throw Error();
    const roll=structuredClone(item.mechanics.value.recipe!.variance),seed=item.mechanics.value.recipe!.seed;
    expect(roll).toBeDefined();
    for(let power=4;power<=10;power++) save=prepareInventoryTransaction(save,{id:'reforge:'+power,expectedRevision:save.factRevision!,kind:'reforge',itemId:'a',spec:{kind:'weapon',mechanism:'sword',power,bonuses:{damage:2}}});
    save=prepareInventoryTransaction(save,{id:'equip',expectedRevision:save.factRevision!,kind:'equip',itemId:'a',unitId:'owner',slot:'primary'});
    const reloaded=prepareInventoryState(JSON.parse(JSON.stringify(save))),u=materializeUnitRecord(reloaded.storage![0]!,registry);
    expect(u.weapon!.recipe!.variance).toEqual(roll);expect(u.weapon!.recipe!.seed).toBe(seed);
    const legacy=fixture();legacy.inventory![0]!.mechanics=compileItem({kind:'weapon',mechanism:'sword',power:3},{id:'a',name:'剑',seed:'old',damageModel:'wounds-v2',variance:false});
    const next=prepareInventoryTransaction(legacy,{id:'legacy',expectedRevision:1,kind:'reforge',itemId:'a',spec:{kind:'weapon',mechanism:'sword',power:4}});
    const m=next.inventory![0]!.mechanics;if(m?.kind!=='weapon')throw Error();expect(m.value.recipe!.variance).toBeUndefined();
  });
});

it('unit editor preserves fixed rolls through renaming and equipment edits',()=>{
  const d=newUnitDraft();d.name='rng unit';d.armor.tier='1';
  const u=buildUnit(d,registry,'editor-rng'),record=unitRecordFromCombatant(u),edit=unitDraftFromRecord(record);
  const roll=structuredClone(u.genAudit!.variance),gearRoll=structuredClone(u.weapon!.recipe!.variance);
  record.equipmentManaged=false;edit.name='renamed';edit.primary.power='4';
  const next=editUnitBuild(record,edit,registry);
  expect(next.snapshot!.genAudit!.variance).toEqual(roll);
  expect(next.snapshot!.weapon!.recipe!.variance).toEqual(gearRoll);
  expect(materializeUnitRecord(JSON.parse(JSON.stringify(next)),registry).genAudit!.variance).toEqual(roll);
});
