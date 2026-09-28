import { traitRegistry } from '../engine/src/index.js';
import { buildUnit, newUnitDraft } from '../panel/src/unit-builder.js';
import { unitRecordFromCombatant } from '../panel/src/unit-state.js';
import { createInventoryItem, prepareInventoryState } from '../panel/src/inventory-state.js';
const registry=traitRegistry();
const storage=['a','b','enemy'].map(id=>{const d=newUnitDraft();d.name=id==='a'?'先锋':id==='b'?'后卫':'敌军';d.side=id==='enemy'?'enemy':'ally';d.level='5';d.primary.power='5';d.armor.tier='1';const u=buildUnit(d,registry,'bulk-smoke:'+id);u.id=id;return unitRecordFromCombatant(u);});
const own=createInventoryItem('own','随身药剂',{kind:'consumable',mechanism:'heal',power:3},'own',9);own.assignedTo='a';
const other=createInventoryItem('other','后卫物资',{kind:'consumable',mechanism:'heal',power:3},'other',20);other.assignedTo='b';
console.log(JSON.stringify(prepareInventoryState({schemaVersion:2,factRevision:1,storage,rosterIds:['a','enemy'],protagonistId:'a',mode:'small',autoTurn:false,reports:[],committedOutcomeIds:[],inventory:[own,other,
  createInventoryItem('spare','备用长剑',{kind:'weapon',mechanism:'sword',power:5,bonuses:{damage:2}},'spare'),
  createInventoryItem('potion','公共药剂',{kind:'consumable',mechanism:'heal',power:3},'potion',99),
]})));
