import {expect,it} from 'vitest';
import {captureGeneration, namespaceOf, prepareNarrativeTransaction, proposalFromMessage, type NarrativeSave} from './narrative-state.js';
import {availableCopies, startBatchReload} from '../../engine/src/equipment-batches.js';
import {detachMembers,combinePersonnel} from '../../engine/src/small/transport-groups.js';
import {parseProtocol} from './protocol.js';
import {readFileSync} from 'node:fs';

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
  expect(settled.records.find(r=>r.id===damaged.id)?.hp).toBe(21);
  expect(settled.roster[0]!.equipmentBatches!.find(b=>b.id===armor.id)?.qty).toBe(26);
});
