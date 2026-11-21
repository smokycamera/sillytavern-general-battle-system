import { tacticalSelection, type TacticalView } from './tactical-view.js';
import { narrativeEvents } from './battle-reports.js';
import { smallCommandChoices } from './llm-command.js';
import {expect,it} from 'vitest';
import {captureGeneration, namespaceOf, prepareNarrativeTransaction, proposalFromMessage, type NarrativeSave} from './narrative-state.js';
import {assertInventoryPanelWrite,prepareInventoryState,prepareInventoryTransaction, type InventoryAction} from './inventory-state.js';
import {reviewMigration} from './migration-review.js';
import {availableCopies, batchWeapons, startBatchReload} from '../../engine/src/equipment-batches.js';
import {detachMembers,combinePersonnel} from '../../engine/src/small/transport-groups.js';
import {parseProtocol} from './protocol.js';
import {readFileSync} from 'node:fs';
import { narrativeIds } from './narrative-ids.js';

function apply(save: NarrativeSave,text: string,seq: number) {
  const source = {characterId:'c',chatId:'chat',branchId:'main',messageId:String(seq),swipeId:'0',role:'assistant' as const,complete:true,generationId:'g'+seq,text:'<tb>\n'+text+'\n</tb>'};
  const ns = namespaceOf(source),binding = captureGeneration(save,ns,source.generationId);
  binding.complete=true;
  return prepareNarrativeTransaction(save,proposalFromMessage(source,binding)!,ns,true);
}
it('accepts the published examples and keeps counted equipment through deployment and a partial split',()=>{
  const book = JSON.parse(readFileSync('assets/worldbook/!通用战斗系统约束.json','utf8'));
  for(const entry of Object.values(book.entries) as {content:string}[]) for(const block of entry.content.match(/^<tb>\n.*?^<\/tb>/gms)??[]) expect(parseProtocol(block).errors).toEqual([]);
  let save=apply({},'<spawn name="守军" side="ally" scale="company" hpMax="100" weapon="长矛:长兵器L3×60,火枪:火枪L3×40" armor="铁甲:重甲L3×30,皮甲:轻甲L2×50" items="屏障护符:佩戴L3+屏障L3×20"/>',1);
  expect(save.inventory!.filter(i=>i.batch)).toHaveLength(5);
  const id=save.storage![0]!.id;
  save=apply(save,'<unit_set id="'+id+'" weapon="火枪:火枪L3×200"/>',2);
  const u=save.storage![0]!.snapshot!;
  const guns=u.equipmentBatches!.filter(b=>b.mechanics.kind==='weapon');
  expect(guns.reduce((n,b)=>n+b.qty,0)).toBe(200);
  const part=detachMembers(u,30,'part');
  combinePersonnel(u,part);
  expect(u.equipmentBatches!.filter(b=>b.mechanics.kind==='weapon').reduce((n,b)=>n+b.qty,0)).toBe(200);
});
it('allows two operators to use two of six field guns and keeps unused spare muskets ready',()=>{
  const save=apply({},'<spawn name="炮兵" side="ally" scale="company" hp="2" hpMax="6" weapon="野战炮:直射火炮L4×6"/>\n<spawn name="步兵" side="ally" scale="company" hpMax="100" weapon="火枪:火枪L3×200"/>',1);
  const [gun,squad]=save.storage!.map(r=>r.snapshot!);
  expect(availableCopies(gun!,gun!.weapon!.id)).toBe(2);
  expect(startBatchReload(squad!,squad!.weapon,40,2)).toBe(true);
  expect(squad!.equipmentBatches![0]!.reloading).toEqual([{turns:2,count:40}]);
  expect(availableCopies(squad!,squad!.weapon!.id)).toBe(100);
});

import {commitBattleOutcome} from './unit-state.js';
import {SmallBattle,standardField,previewAttack,traitRegistry,standardConditionMap,V43_OVERFLOW_D20} from '../../engine/src/index.js';
import {engagementWidth,sharedParticipants} from '../../engine/src/exposure.js';
import {equipmentCapacity,equipmentLoad} from '../../engine/src/equipment-load.js';
import {protectionGroups,settleBatches} from '../../engine/src/equipment-batches.js';
it('retains formation frontage and target exposure while limiting actual shooters and carrying unused guns',()=>{
  const save=apply({},'<spawn name="步兵" side="ally" scale="company" hpMax="100" weapon="步枪:步枪L3×100"/>\n<spawn name="守军" side="enemy" scale="company" hpMax="100" armor="板甲:重甲L3×30,皮甲:轻甲L2×50"/>\n<spawn name="炮兵" side="ally" scale="company" hpMax="6" weapon="野战炮:直射火炮L4×6"/>',1);
  const [source,defender,gun]=save.storage!.map(r=>r.snapshot!);
  expect(protectionGroups(defender!).map(g=>g.size)).toEqual([30,50,20]);
  const target={...defender!,equipmentBatches:undefined};
  const preview=(actor:import('../../engine/src/types.js').Combatant,tags:string[],victim=target)=>{
    const width=engagementWidth(actor,victim,true,undefined,tags);
    return previewAttack({attacker:actor,defender:victim,participants:sharedParticipants(actor,[actor],width,victim,true),rules:V43_OVERFLOW_D20,conditionDefs:standardConditionMap(),traitRegistry:traitRegistry(),ranged:true});
  };
  const shot=(actor:import('../../engine/src/types.js').Combatant,tags:string[])=>preview(actor,tags).participants!;
  const hero={...target,scale:'hero' as const,hp:1,formation:undefined,body:'human' as const,targetWidthModel:'target-width-v1' as const};
  expect(preview(source!,[],hero).participants).toBe(12);
  for (const terrain of [[],['forest']]) {
    const old=shot({...source!,equipmentBatches:undefined},terrain);
    expect(shot(source!,terrain)).toBe(old);
    expect(preview(source!,terrain).expectedDamage).toBeCloseTo(preview({...source!,equipmentBatches:undefined},terrain).expectedDamage);
    const sparse=structuredClone(source!); sparse.equipmentBatches![0]!.qty=3;
    expect(shot(sparse,terrain)).toBe(Math.min(3,old));
  }
  const load=equipmentLoad(gun!),capacity=equipmentCapacity(gun!);
  gun!.hp=2; gun!.formation!.members=2;
  expect(shot(gun!,[])).toBe(2);
  expect(equipmentCapacity(gun!)).toBeCloseTo(capacity/3);
  expect(equipmentLoad(gun!)).toBe(load);
  expect(settleBatches(gun!).get(gun!.weapon!.id)).toBe(6);
});

it('fires a third weapon batch, restores its reload state, and settles only irreversible personnel losses',()=>{
  const save=apply({},'<spawn name="守军" side="ally" scale="company" hpMax="30" weapon="矛:长兵器L3×10,剑:剑L3×10,火枪:火枪L3×10" armor="护甲:轻甲L3×30"/>\n<spawn name="对手" side="enemy" scale="company" hpMax="30"/>',1);
  const actors=save.storage!.map(r=>structuredClone(r.snapshot!));
  const field=standardField(9,15); field.tiles.fill('open');
  const battle=new SmallBattle({combatants:actors,battlefield:field,rules:V43_OVERFLOW_D20,seed:'partial-weapon'});
  battle.start();
  const [attacker,defender]=actors;
  attacker!.pos=30; defender!.pos=32; battle.turnOrder=actors.map(u=>u.id); battle.turnIndex=0;
  const guns=attacker!.equipmentBatches!.find(b=>b.mechanics.kind==='weapon' && b.mechanics.value.name==='火枪')!;
  const mode=`batch:${guns.id}` as const;
  expect(battle.getActionOptions(attacker!.id).find(o=>o.id===mode)?.targets?.find(t=>t.targetId===defender!.id)?.enabled).toBe(true);
  const shot=battle.attack(attacker!.id,defender!.id,{weaponMode:mode});
  expect(shot.participants).toBeGreaterThan(0);
  expect(shot.participants).toBeLessThanOrEqual(10);
  const restored=SmallBattle.fromSnapshot(battle.toSnapshot()).byId(attacker!.id);
  expect(restored.equipmentBatches!.find(b=>b.id===guns.id)!.reloading?.[0]?.count).toBe(Math.ceil(shot.participants!));
  const damaged=structuredClone(save.storage![0]!.snapshot!);
  damaged.hp=21; damaged.recoverableWounded=5; damaged.formation!.members=21;
  const args={battleId:'small:partial',committedIds:[],records:save.storage!,roster:[damaged],combatants:[damaged],awards:[],registry:traitRegistry(),inventory:save.inventory};
  const settled=commitBattleOutcome(args);
  const armor=settled.inventory!.find(i=>i.equippedTo?.slot==='armor' && i.assignedTo===damaged.id)!;
  expect(armor.qty).toBe(26);
  expect(settled.inventory!.filter(i => i.name === armor.name && !i.assignedTo).reduce((n,i) => n+i.qty,0)).toBe(0);
  expect(() => assertInventoryPanelWrite(save, {...save,inventory:settled.inventory,storage:settled.records,
    committedOutcomeIds:['small:partial'],battle:{kind:'small',snap:{seed:'partial',combatants:[damaged]}}})).not.toThrow();
  expect(settled.records.find(r=>r.id===damaged.id)?.hp).toBe(21);
  expect(settled.roster[0]!.equipmentBatches!.find(b=>b.id===armor.id)?.qty).toBe(26);
});

it('assigns the higher level weapon and armor to the same members regardless of declaration order', () => {
  const save = apply({},'<spawn name="守军" side="ally" scale="company" hpMax="8" weapon="旧剑:剑L1×6,精剑:剑L6×2" armor="精甲:重甲L6×2,旧甲:轻甲L1×6"/>',1);
  const rows = protectionGroups(save.storage![0]!.snapshot!,true);
  expect(rows.map(g => [g.size,g.weapon?.name,g.armor?.name])).toEqual([[2,'精剑','精甲'],[6,'旧剑','旧甲']]);
});

it('reuses the named reforged lots in a counted vehicle battery', () => {
  const save = apply({},'<spawn name="试验车" side="ally" scale="hero" body="giantvehicle" platform="封闭载具L5" seats="2"/>\n<add item="原装发射器" spec="火箭筒L2"/>\n<add item="原装炮塔" spec="能量武器L2" qty="4"/>',1);
  const id = save.storage![0]!.id;
  const [first,second] = ['原装发射器','原装炮塔'].map(name => save.inventory!.find(i => i.name === name)!.id);
  const next = apply(save,`<reforge id="${first}" name="超重型导弹发射器" spec="火箭筒L7×1"/>
<reforge id="${second}" name="重型炮塔组" spec="能量武器L7×4"/>
<unit_set id="${id}" seats="200" weapon="超重型导弹发射器:火箭筒L7×1,重型炮塔组:能量武器L7×4,近防炮组:机炮L5×8"/>`,2);
  const armed = next.inventory!.filter(i => i.equippedTo?.slot === 'primary');
  expect(armed.map(i => [i.name,i.qty])).toEqual([['超重型导弹发射器',1],['重型炮塔组',4],['近防炮组',8]]);
  expect(armed.slice(0,2).map(i => i.id)).toEqual([first,second]);
  expect(next.storage![0]!.snapshot!.seats).toBe(200);
});

it.each([false, true])('preserves both original armor quantities and merges only equal frozen rolls (different rolls: %s)', different => {
  const save = apply({}, '<spawn name="主力佣兵" side="ally" scale="company" hpMax="60" armor="锁甲甲:轻甲L2×30,锁甲乙:轻甲L2×30"/>', 1);
  const unit = save.storage![0]!;
  const armors = save.inventory!.filter(item => item.equippedTo?.slot === 'armor');
  const [first, second] = armors.map(item => item.id);
  armors.forEach((item, i) => {
    if (item.mechanics?.kind !== 'armor') throw Error('missing armor fixture');
    item.mechanics.value.recipe!.variance = { version: 'normal-v1', rolls: { protection: different && i ? 70 : 0 } };
  });
  const next = apply(save, `<add item="干粮" qty="1"/>
    <reforge id="${first}" name="重型加铁锁甲衫" spec="中甲L2+1防御"/>
    <reforge id="${second}" name="重型加铁锁甲衫" spec="中甲L2+1防御"/>
    <unit_set id="${unit.id}" hp="60" hpMax="60" armor="重型加铁锁甲衫:中甲L2+1防御×60"/>`, 2);
  const equipped = next.inventory!.filter(item => item.equippedTo?.slot === 'armor');
  expect(equipped.map(item => item.qty)).toEqual(different ? [30, 30] : [60]);
  expect(next.storage![0]!.snapshot!.equipmentBatches!.filter(batch => batch.slot === 'armor').map(batch => batch.qty))
    .toEqual(different ? [30, 30] : [60]);
  if (!different) {
    const ids = narrativeIds(next);
    expect(ids.realId(ids.publicId(second!))).toBe(first);
    expect(() => prepareInventoryTransaction(next, { kind: 'add', itemId: second!, qty: 1, id: 'stale-holding', expectedRevision: next.factRevision! }))
      .toThrow('物品已合并');
    const updated = apply(next, `<take id="${ids.publicId(second!)}" qty="1"/>`, 3);
    expect(updated.inventory!.find(item => item.id === first)?.qty).toBe(59);
  }
});

it('does not charge carried spare gear, including when loading an old reserve weight', () => {
  const original = apply({}, '<spawn name="护卫" side="ally" scale="company" hpMax="5" weapon="长剑:剑L3×5"/>', 1);
  const unitId = original.storage![0]!.id;
  const added = apply(original, `<add item="备用锁甲" spec="重甲L3" qty="20"/>`, 2);
  const itemId = added.inventory!.find(item => item.name === '备用锁甲')!.id;
  const carried = prepareInventoryTransaction(added, { kind: 'assign', unitId, itemId, id: 'carry', expectedRevision: added.factRevision! });
  const before = original.storage![0]!.snapshot!, after = carried.storage![0]!.snapshot!;
  expect(equipmentLoad(after)).toBe(equipmentLoad(before));
  expect(equipmentLoad({ ...after, reserveEquipmentLoad: 1000 } as typeof after)).toBe(equipmentLoad(before));
  expect(equipmentCapacity({ ...after, reserveEquipmentLoad: 1000 } as typeof after)).toBe(equipmentCapacity(before));
  const equipped = prepareInventoryTransaction(carried, { kind: 'equip', slot: 'armor', unitId, itemId, qty: 5, id: 'equip', expectedRevision: carried.factRevision! });
  expect(equipmentLoad(equipped.storage![0]!.snapshot!)).toBeGreaterThan(equipmentLoad(before));
});

it('keeps the issue order of other armor between otherwise identical reforged lots', () => {
  const save = apply({}, '<spawn name="护卫" side="ally" scale="company" hpMax="12" armor="首批:中甲L2×4,不同:中甲L2×4,尾批:中甲L2×4"/>', 1);
  const armors = save.inventory!.filter(item => item.equippedTo?.slot === 'armor');
  const first = armors[0]!, last = armors[2]!;
  for (const item of [first, last]) {
    if (item.mechanics?.kind !== 'armor') throw Error('missing armor fixture');
    item.mechanics.value.recipe!.variance = { version: 'normal-v1', rolls: { protection: 0 } };
  }
  const next = apply(save, `<reforge id="${first.id}" name="制式锁甲" spec="中甲L2+1防御"/>
    <reforge id="${last.id}" name="制式锁甲" spec="中甲L2+1防御"/>`, 2);
  expect(next.inventory!.filter(item => item.equippedTo?.slot === 'armor').map(item => [item.id, item.qty]))
    .toEqual(armors.map(item => [item.id, 4]));
});

it('appends a third weapon on a hero and replaces the complete legacy loadout on unit_set',()=>{
  const save=apply({},'<spawn name="护卫" scale="hero" side="ally" weapon="长剑:剑L3" weapon2="长弓:弓L3"/>\n<add item="标枪" spec="投掷冷兵器L3" qty="6"/>',1);
  const unitId=save.storage![0]!.id, itemId=save.inventory!.find(i=>i.name==='标枪')!.id;
  const equipped=prepareInventoryTransaction(save,{kind:'equip',slot:'primary',unitId,itemId,qty:3,id:'append',expectedRevision:save.factRevision!});
  const unit=equipped.storage![0]!.snapshot!;
  expect(batchWeapons(unit).map(w=>w.name)).toEqual(['长剑','长弓','标枪']);
  const updated=apply(equipped,'<unit_set id="'+unitId+'" weapon="长弓:弓L3×1,标枪:投掷冷兵器L3×3"/>',2);
  expect(batchWeapons(updated.storage![0]!.snapshot!).map(w=>w.name)).toEqual(['长弓','标枪']);
  expect(updated.inventory!.find(i=>i.name==='长剑')?.equippedTo).toBeUndefined();
});

it('defaults each omitted quantity to one on deployment and refit', () => {
  let save = apply({}, '<spawn name="旗舰" side="ally" scale="company" hpMax="10" weapon="舰首炮:直射火炮L8+4伤害,等离子炮:能量武器L7×24" armor="舰甲:重甲L7" items="烟幕:烟幕L3"/>', 1);
  const counts = () => Object.fromEntries(save.inventory!.map(item => [item.name, item.qty]));
  expect(counts()).toMatchObject({ 舰首炮:1, 等离子炮:24, 舰甲:1, 烟幕:1 });
  const id = save.storage![0]!.id;
  save = apply(save, '<unit_set id="'+id+'" weapon="舰首炮:直射火炮L8+4伤害,近防炮:机炮L6"/>', 2);
  expect(save.inventory!.filter(i=>i.equippedTo?.slot==='primary').map(i=>[i.name,i.qty])).toEqual([['舰首炮',1],['近防炮',1]]);
  expect(parseProtocol('<spawn name="旗舰" side="ally" scale="hero" weapon="舰首炮:直射火炮L8×0"/>').errors.join()).toContain('舰首炮');
});

it('reuses holdings when repeatedly issuing, returning and replenishing one lot', () => {
  let save = apply({},'<spawn name="守军" side="ally" scale="company" hpMax="40"/>\n<add item="长矛" spec="长兵器L2" qty="40"/>',1);
  const unitId = save.storage![0]!.id, source = save.inventory!.find(i=>i.name==='长矛')!.id;
  const transact = (action: import('./inventory-state.js').InventoryAction) => {
    save = prepareInventoryTransaction(save,{...action,id:'op'+save.factRevision,expectedRevision:save.factRevision!});
  };
  transact({kind:'assign',itemId:source,unitId});
  const equip = (qty:number) => transact({kind:'equip',unitId,slot:'primary',itemId:source,qty});
  equip(7);
  const issued = save.inventory!.find(i=>i.name==='长矛' && i.equippedTo)!.id;
  const unload = (qty:number) => transact({kind:'unequip',unitId,slot:'primary',itemId:issued,qty});
  equip(8); unload(3); unload(12); equip(20);
  transact({kind:'add',itemId:issued,qty:10});
  expect(save.inventory!.filter(i=>i.name==='长矛').map(i=>[i.id,i.qty])).toEqual([[source,20],[issued,30]]);
  expect(save.storage![0]!.snapshot!.equipmentBatches).toContainEqual(expect.objectContaining({id:issued,qty:30}));
  transact({kind:'discard',itemId:source,qty:4});
  expect(save.inventory!.filter(i=>i.name==='长矛').map(i=>[i.id,i.qty])).toEqual([[source,16],[issued,30]]);
  expect(batchWeapons(save.storage![0]!.snapshot!).map(w=>w.id)).toEqual([issued]);
});

it('returns a partial public issue to its original holding and keeps discarded IDs empty after reload', () => {
  let save = apply({},'<spawn name="守军" side="ally" scale="company" hpMax="40"/>\n<add item="长矛" spec="长兵器L2" qty="30"/>',1);
  const unitId = save.storage![0]!.id, lot = save.inventory!.find(i=>i.name==='长矛')!.id;
  const act = (action: InventoryAction) => {
    save = prepareInventoryTransaction(save,{...action,id:'roundtrip'+save.factRevision,expectedRevision:save.factRevision!});
  };
  const equip = (qty:number) => act({kind:'equip',unitId,slot:'primary',itemId:lot,qty});
  equip(10);
  const issued = save.inventory!.find(i=>i.name==='长矛' && i.equippedTo)!.id;
  const unload = (qty:number) => act({kind:'unequip',unitId,slot:'primary',itemId:issued,qty});
  unload(4);
  expect(save.inventory!.find(i=>i.id===lot)?.qty).toBe(24);
  unload(6);
  expect(save.inventory!.filter(i=>i.name==='长矛' && i.qty>0).map(i=>[i.id,i.qty])).toEqual([[lot,30]]);
  equip(10);
  act({kind:'discard',itemId:issued,qty:10});
  equip(5);
  save = prepareInventoryState(JSON.parse(JSON.stringify(save)));
  expect(save.inventory!.find(i=>i.id===issued)?.qty).toBe(0);
  expect(save.inventory!.filter(i=>i.name==='长矛' && i.qty>0).map(i=>i.qty)).toEqual([15,5]);
});

it('reopens mixed slots, and previews only an untouched backup of falsely isolated holdings', () => {
  const save = apply({},'<spawn name="守军" side="ally" scale="company" hpMax="20" weapon="长矛:长兵器L2×10,火枪:火枪L2×10" armor="铁甲:重甲L2×5,皮甲:轻甲L2×10"/>',1);
  expect(reviewMigration(save)).toBeUndefined();
  const rows = save.inventory!;
  const accepted = prepareInventoryState({...save,inventory:[],inventoryMigrationBackup:rows,migrationBackups:[{source:save}],
    factRevision:save.factRevision!+1,unitMigrationWarnings:rows.map((_,i)=>`库存[${i}]已隔离：Error: 同一槽位有多件实物，不能猜测保留`)}, false);
  const review = reviewMigration(accepted)!;
  expect(review.quarantined).toBe(0);
  expect(review.candidate.inventory).toEqual(rows);
  expect(review.candidate.storage![0]!.snapshot!.equipmentBatches).toHaveLength(4);
  expect(accepted.inventory).toEqual([]);
  expect(reviewMigration({...accepted,factRevision:accepted.factRevision!+1})).toBeUndefined();
  expect(reviewMigration({...accepted,inventory:[{...rows[0]!,qty:0,equippedTo:undefined}]})).toBeUndefined();
});

it.each([
  ['volley:ranged','协同射击',['东营火枪','西营火枪']],
  ['volley:melee','协同近战',['长剑','短矛']],
  ['volley:all','总协同攻击',['东营火枪','西营火枪','长剑','短矛']],
] as const)('offers %s to both commanders and reports the weapons that acted', (mode,label,weapons) => {
  const save = apply({},'<spawn name="守军" side="ally" scale="company" hpMax="20" weapon="东营火枪:火枪L2×20,西营火枪:火枪L2×20,长剑:剑L2×20,短矛:长兵器L2×20"/>\n<spawn name="守卫" side="enemy" scale="company" hpMax="200"/>',1);
  const actors = save.storage!.map(r=>structuredClone(r.snapshot!)), [actor,target] = actors;
  const field = standardField(9,15); field.tiles.fill('open');
  const battle = new SmallBattle({combatants:actors,battlefield:field,rules:V43_OVERFLOW_D20,seed:'mixed-volley'});
  battle.start(); actor!.pos=30; target!.pos=31; battle.turnOrder=actors.map(u=>u.id); battle.turnIndex=0;
  const menu=battle.getActionOptions(actor!.id).find(o=>o.id===mode);
  const preview=menu!.targets![0]!.preview!;
  expect(preview.anyHitChance).toBeGreaterThan(0);
  expect(preview.damageOnHit).toBeGreaterThan(0);
  expect(preview.expectedDamage).toBeCloseTo(preview.anyHitChance! * preview.damageOnHit!);
  expect(preview.damageModel).toBe('member-health');
  expect(preview.effects).toHaveLength(weapons.length);
  const quick=battle.getActionOptions(actor!.id,{previews:false}).find(o=>o.id===mode);
  expect(quick?.targets?.[0]?.preview?.effects).toEqual(preview.effects);
  expect(smallCommandChoices(battle,actor!.id).some(c=>c.action?.weaponMode===mode && c.action.targetId===target!.id)).toBe(true);
  const from=battle.log.length;
  const result=battle.attack(actor!.id,target!.id,{weaponMode:mode});
  const digest=narrativeEvents(battle,from).map(e=>e.text).join(' ');
  expect(digest).toContain(label);
  for (const name of weapons) {
    expect(digest).toContain(name);
    expect(battle.log.slice(from).some(e=>e.volley?.weapon===name && e.text.includes(name))).toBe(true);
  }
  expect(result.participants).toBeLessThanOrEqual(actor!.hp);
  const fired=actor!.equipmentBatches!.map(b=>b.reloading?.[0]?.count ?? 0);
  expect(fired.filter(Boolean)).toHaveLength(mode==='volley:melee' ? 0 : 2);
  expect(fired.reduce((sum,n)=>sum+n,0)).toBeLessThanOrEqual(actor!.hp);
  expect(battle.getTurnEconomy(actor!.id).actionAvailable).toBe(false);
});

it('uses the per-vehicle channel budget and remembers the player’s weapon across turns and reloads', () => {
  const save = apply({}, '<spawn name="旗舰" side="ally" scale="hero" body="largevehicle" level="8" weapon="主炮:直射火炮L8×1,近防炮:机炮L4×90,发射器:火箭筒L3×10"/>\n<spawn name="目标" side="enemy" scale="company" hpMax="200"/>',1);
  const id = save.storage![0]!.id;
  const updated = apply(save,'<unit_set id="'+id+'" body="hugevehicle"/>',2);
  const [ship,target] = updated.storage!.map(r=>structuredClone(r.snapshot!));
  expect(ship!.body).toBe('hugevehicle');
  const guns = batchWeapons(ship!);
  expect(guns.map(w=>availableCopies(ship!,w.id))).toEqual([1,8,8]);
  const pair = {...ship!, scale:'company' as const, hp:2, equipmentPersonnel:2,
    equipmentBatches:ship!.equipmentBatches!.map(batch=>({...batch,qty:batch.qty*2}))};
  expect(guns.map(w=>availableCopies(pair,w.id))).toEqual([2,16,16]);
  const field = standardField(9,15); field.tiles.fill('open');
  const b = new SmallBattle({combatants:[ship!,target!],battlefield:field,rules:V43_OVERFLOW_D20,seed:'vehicle-memory'});
  b.start(); ship!.pos=30; target!.pos=33; b.turnOrder=[id,target!.id]; b.turnIndex=0;
  const options = b.getActionOptions(id);
  expect(options.find(o=>o.id==='weapon:sidearm')?.targets?.[0]?.preview?.participants).toBe(8);
  const effects = options.find(o=>o.id==='volley:ranged')?.targets?.[0]?.preview?.effects;
  expect(effects).toContain('主炮 ×1');
  expect(effects?.reduce((sum,text)=>sum+Number(text.split(' ×')[1]),0)).toBe(8);
  const mode = `batch:${guns[2]!.id}` as const;
  b.playerWeaponAttack(id,target!.id,mode);
  expect(b.lastWeaponOption(target!)).toBeUndefined();
  const restored = SmallBattle.fromSnapshot(structuredClone(b.toSnapshot()));
  restored.actedThisTurn.clear(); restored.round++;
  const view: TacticalView = {selectedId:id,mode:'weapon'};
  expect(tacticalSelection(restored,view).option?.id).toBe(mode);
  restored.playerWeaponAttack(id,target!.id,'volley:ranged');
  restored.actedThisTurn.clear(); restored.round++;
  expect(tacticalSelection(restored,view).option?.id).toBe('volley:ranged');
});

it('keeps a manual issue when the next inventory transaction declares more armor than exists', () => {
  let save = apply({}, '<spawn name="老兵" side="ally" scale="company" hpMax="10"/>',1);
  const id = save.storage![0]!.id;
  save = apply(save,'<add item="锁甲" spec="中甲L2" qty="5" to="'+id+'"/>',2);
  const lot = save.inventory!.find(i => i.name === '锁甲')!;
  save = prepareInventoryTransaction(save,{kind:'equip',unitId:id,itemId:lot.id,slot:'armor',qty:5,id:'manual-mail',expectedRevision:save.factRevision!});
  save = apply(save,'<give id="'+lot.id+'" to="'+id+'" qty="3"/>\n<unit_set id="'+id+'" armor="锁甲:中甲L2×8"/>',3);
  expect(save.inventory!.filter(i => i.name === '锁甲').reduce((n,i) => n+i.qty,0)).toBe(5);
  expect(save.storage![0]!.snapshot!.equipmentBatches!.find(b => b.id === lot.id)?.qty).toBe(5);
});
