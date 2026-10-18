import {describe,it,expect} from 'vitest';
import {generateUnit, classMismatchHint, type ItemMechanics, prepareArmsModel, V18_OVERFLOW_D20, traitRegistry} from '../../engine/src/index.js';
import {parseItemSpecification, parseSpawnItem} from './item-spec.js';
import {equipmentDraft,equipmentFields} from './equipment-form.js';
import {classMigrationCandidates,prepareClassMigration} from './arms-v2.js';
import {prepareInventoryState,createInventoryItem} from './inventory-state.js';
import {unitRecordFromCombatant,commitBattleOutcome} from './unit-state.js';
import {NarrativeController} from './narrative-controller.js';
import type {NarrativeSave} from './narrative-state.js';
import type {TavernAdapter} from './tavern.js';

const classOf=(m:ItemMechanics)=>m.kind==='item'?'':m.value.recipe!.mechanism;
describe('arms-v2 parsing and archives',()=>{
  it('uses every specification example, including the user decision that machine gun has no hint',()=>{
    const cases=[["匕首:剑L4","sword","短兵器"],["匕首:短兵器L4","dagger",""],["影刃:短兵器L4","dagger",""],["短剑:剑L3","sword",""],["斩马刀:剑L6","sword","巨剑"],["斩马刀:巨剑L6","greatsword",""],["霜之哀伤:剑L7","sword",""],["双手巨斧:斧L5","axe","巨型冷兵器"],["双手巨斧:巨型冷兵器L5","great-weapon",""],["开山斧:巨斧L5","great-weapon",""],["大锤:钝器L4","blunt","巨型冷兵器"],["战锤:钝器L4","blunt",""],["战斧:斧L4","axe",""],["骑枪:长兵器L3","spear",""],["骑士枪:骑枪L3","spear",""],["削尖长矛:长兵器L3","spear",""],["长枪:长兵器L4","spear",""],["方天画戟:长兵器L6","spear","重型长兵器"],["方天画戟:重型长兵器L6","heavy-polearm",""],["猎弩:弓弩L5","bow","弩"],["十字弩:弩L4","crossbow",""],["长弓:弓弩L5","bow",""],["泵动霰弹枪:步枪L5","rifle","霰弹枪"],["霰弹枪L5","shotgun",""],["冲锋枪:步枪L4","rifle",""],["MP5 SMG:步枪L4","rifle",""],["MG42:步枪L4","rifle",""],["马克沁重机枪:火枪L4","firearm",""],["RPG-7:直射火炮L5","cannon","火箭筒"],["RPG-7:火箭筒L5","rocket",""],["标枪导弹:直射火炮L6","cannon",""],["反坦克导弹:直射火炮L5","cannon",""],["标枪:投掷冷兵器L3","throwing",""],["标枪导弹:投掷冷兵器L3","throwing",""],["60毫米迫击炮:曲射火炮L4","indirect-cannon",""],["火焰喷射器:喷射武器L4","sprayer",""],["火焰喷射器:步枪L4","rifle","喷射武器"],["塔盾:盾L5+2防御","shield","大盾"],["塔盾:大盾L5+2防御","tower-shield",""],["力场发生器:能量盾L7","energy-shield",""],["护盾:盾L4","shield",""],["圆盾:中盾L4","shield",""]];
    for(const [text,expected,hint]of cases){const notes:string[]=[],s=parseItemSpecification(text!,{},notes); if(s.kind!=='weapon'&&s.kind!=='shield')throw Error(text); expect([s.mechanism??'shield',notes.some(n=>n.includes('名称像'+hint))&&!!hint,notes.some(n=>n.includes('名称像'))]).toEqual([expected,!!hint,!!hint]);}
  });
  it('explains a name mismatch without altering the declared class',()=>{expect(classMismatchHint('塔盾','shield')).toBe('名称像大盾，当前按中盾结算，可在面板修改');});
  it('applies only selected equipment classes, backs up, preserves identities and variance, and leaves battle equipment frozen',()=>{
    const u=generateUnit({name:'刺客',side:'ally',scale:'hero',level:5,traits:[],rulesVersion:'v2',damageModel:'wounds-v2',weaponName:'匕首',weaponClass:'sword',weaponLevel:4},{seed:'class-update'}).unit;
    const original=prepareInventoryState({storage:[unitRecordFromCombatant(u)],inventory:[createInventoryItem('tower','塔盾',{kind:'shield',power:5},'tower')],battle:{kind:'small',snap:{weapon:structuredClone(u.weapon)}}});
    const chosen=classMigrationCandidates(original).find(c=>c.item.name==='匕首')!,before=chosen.item.mechanics!;if(before.kind!=='weapon')throw Error();
    const result=prepareClassMigration(original,[chosen.item.id],'update'),after=result.inventory!.find(i=>i.id===chosen.item.id)!.mechanics!;if(after.kind!=='weapon')throw Error();
    expect([after.value.recipe!.mechanism,after.value.id,after.value.recipe!.seed,after.value.recipe!.variance,classOf(result.inventory!.find(i=>i.id==='tower')!.mechanics!),result.classMigration,classMigrationCandidates(result).length,result.battle,Array.isArray(result.migrationBackups)]).toEqual(['dagger',before.value.id,before.value.recipe!.seed,before.value.recipe!.variance,'shield','arms-v2',0,original.battle,true]);
  });
  it('can keep all original classes and writes the completed marker',()=>{const save={inventory:[createInventoryItem('tower','塔盾',{kind:'shield',power:5},'tower')]};const next=prepareClassMigration(save,[],'skip');expect([next.classMigration,classOf(next.inventory![0]!.mechanics!),classMigrationCandidates(next).length]).toEqual(['arms-v2','shield',0]);});
  it('preserves the completed marker when the panel saves its other settings',()=>{
    let save: NarrativeSave=prepareInventoryState({schemaVersion:2,storage:[],inventory:[createInventoryItem('tower','塔盾',{kind:'shield',power:5},'tower')]});
    const adapter={load:()=>save,save:(_key:string,next:NarrativeSave)=>{save=next;return {status:'saved',host:true,local:false};},identity:()=> 'arms',namespace:()=> 'arms',subscribe:()=>({available:false,stop(){}}),injectPrompts:()=>true,uninjectPrompts(){}} as unknown as TavernAdapter;
    const controller=new NarrativeController(adapter);try{controller.migrateWeaponClasses([],0);const next=controller.snapshot();delete next.classMigration;controller.persistPanel(next,next.factRevision!);expect([save.classMigration,classMigrationCandidates(save).length]).toEqual(['arms-v2',0]);}finally{controller.dispose();}
  });
  it('lists all shields and restricts two-handed primary weapons to buckler and energy shield',()=>{const d=equipmentDraft('shield'),all=equipmentFields('s',d),restricted=equipmentFields('s',d,{primaryHands:2}).replace(/<option[^>]*hidden[^>]*>[\s\S]*?<\/option>/g,'');expect([all.includes('value="tower-shield"'),all.includes('value="shield"'),restricted.includes('value="tower-shield"'),restricted.includes('value="shield"'),restricted.includes('value="buckler"'),restricted.includes('value="energy-shield"')]).toEqual([true,true,false,false,true,true]);});
  it('maps inherited ranged classes and sprayer into item effects',()=>{for(const name of ['火箭筒','霰弹枪','弩','喷射武器']) expect(parseSpawnItem('道具:'+name+'L5').spec?.kind).toBe('item');});
});

it('removes a shattered shield from equipment and inventory and restores intact shields for the next battle',()=>{
  const reg=traitRegistry(),u=generateUnit({name:'盾兵',side:'ally',scale:'hero',level:5,traits:[],rulesVersion:'v2',damageModel:'wounds-v2',weaponClass:'sword',shield:true,shieldLevel:5},{seed:'broken',noVariance:true}).unit;prepareArmsModel(u,V18_OVERFLOW_D20);
  const save=prepareInventoryState({storage:[unitRecordFromCombatant(u)]}),shieldId=u.shield!.id;u.shieldDurability!.remaining=0;
  const broken=commitBattleOutcome({battleId:'small:broken',committedIds:[],records:save.storage!,roster:[u],combatants:[u],inventory:save.inventory,awards:[],registry:reg});expect([broken.records[0]!.snapshot!.shield,broken.inventory!.some(i=>i.id===shieldId),broken.brokenShieldNotes]).toEqual([undefined,false,['盾兵的盾牌碎了，已移出装备']]);
  u.shieldDurability!.remaining=32;const intact=commitBattleOutcome({battleId:'small:intact',committedIds:[],records:save.storage!,roster:[u],combatants:[u],inventory:save.inventory,awards:[],registry:reg});const next=intact.records[0]!.snapshot!;prepareArmsModel(next,V18_OVERFLOW_D20);expect(next.shieldDurability!.remaining).toBe(128);
});
