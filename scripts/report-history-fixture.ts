import {generateUnit,SmallBattle,MassBattle,V3_D20,V3_TW,standardField,traitRegistry,applyHealthLoss,battleXpAwards} from '../engine/src/index.js';
import {unitRecordFromCombatant,materializeUnitRecord,commitBattleOutcome} from '../panel/src/unit-state.js';
import {prepareInventoryState,createInventoryItem} from '../panel/src/inventory-state.js';
import {prepareBattleItems,prepareBattleItemWrite} from '../panel/src/battle-items.js';
import {captureBattleArchive,captureBattleStart,stampNewBattleReports} from '../panel/src/report-history.js';
import {battleEpilogue,narrativeEvents,completedBattleRounds} from '../panel/src/battle-reports.js';
import type {NarrativeSave} from '../panel/src/narrative-state.js';
const mass=process.argv.includes('--mass'),registry=traitRegistry();
const storage=['A','D'].map(id=>{
 const u=generateUnit({rulesVersion:'v2',name:id==='A'?'重战验证队':'敌方守备队',side:id==='A'?'ally':'enemy',scale:'company',hp:id==='A'?400:500,hpMax:500,level:4,weaponClass:'rifle',traits:[]},{seed:id,registry,noVariance:true}).unit;
 u.id=id;if(id==='A')u.recoverableWounded=50;return unitRecordFromCombatant(u);
});
const before=prepareInventoryState({schemaVersion:2,factRevision:1,storage,rosterIds:['A','D'],protagonistId:'A',commanderId:'A',autoTurn:false,autoAllyOrders:false,autoSettleXp:true,
 inventory:[{...createInventoryItem('dose','重战急救剂',{kind:'consumable',mechanism:'heal',power:3},'dose',2),assignedTo:'A'}]}) as NarrativeSave;
const units=prepareBattleItems(before.storage!.map(r=>materializeUnitRecord(r,registry)),before);
const b=mass?new MassBattle({combatants:units,rules:V3_TW,seed:'report-original',traitRegistry:registry,commanderId:'A'}):new SmallBattle({combatants:units,rules:V3_D20,seed:'report-original',battlefield:standardField(),traitRegistry:registry});
b.start();const start=captureBattleStart(b,captureBattleArchive(before)),initial={...before,battle:{kind:start.kind,snap:structuredClone(b.toSnapshot())}};
const actor=b.byId('A'),dose=actor.abilities.find(a=>a.itemSourceId==='dose')!;applyHealthLoss(actor,20);
actor.resources[dose.cost!.resource]=1;actor.abilityState.push({abilityId:dose.id,used:1,cdLeft:0});b.xpByUnit.set('A',50);b.finishBattle('ceasefire');
const result=commitBattleOutcome({battleId:start.battleId,committedIds:[],records:before.storage!,roster:units,combatants:b.combatants,awards:battleXpAwards(b.combatants,b.xpByUnit,{won:false}),registry});
const finished=prepareBattleItemWrite(initial,{...before,storage:result.records,rosterIds:result.roster.map(u=>u.id),committedOutcomeIds:result.committedIds,battle:{kind:start.kind,snap:structuredClone(b.toSnapshot())},factRevision:2,mode:start.kind,xpSettled:true,
 activeBattleStart:start,selectedReportId:start.battleId,reports:[{id:start.battleId,card:'战斗结算：原战果',digest:'原战斗过程，用于重战对照。',summary:'原战损与经验已经归档。',roundCount:completedBattleRounds(b),epilogue:battleEpilogue(b),narrativeEvents:narrativeEvents(b),eventCount:b.log.length,deliveries:{},start}]}) as NarrativeSave;
stampNewBattleReports(before,finished);console.log(JSON.stringify({before,finished}));
