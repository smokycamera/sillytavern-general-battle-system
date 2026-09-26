import {describe,it,expect} from 'vitest';
import {generateUnit,SmallBattle,MassBattle,V3_D20,V3_TW,standardField,traitRegistry,applyHealthLoss,battleXpAwards,type Combatant} from '../../engine/src/index.js';
import {unitRecordFromCombatant,materializeUnitRecord,commitBattleOutcome,updateUnitRecord} from './unit-state.js';
import {prepareInventoryState,createInventoryItem} from './inventory-state.js';
import {prepareBattleItems,prepareBattleItemWrite} from './battle-items.js';
import {captureBattleArchive,captureBattleStart,archiveStamp,stampNewBattleReports,prepareReportDeletion,prepareReportRestore,prepareReportRestart,reportRestartReason} from './report-history.js';
import {renderReportWorkspace} from './report-view.js';
import {factsOf,type NarrativeSave} from './narrative-state.js';
const registry=traitRegistry();

function finished(mode:'small'|'mass'='small') {
 const storage=['A','D'].map(id=>{
  const unit=generateUnit({rulesVersion:'v2',name:id,side:id==='A'?'ally':'enemy',scale:'company',hp:90,hpMax:100,level:3,weaponClass:'rifle',traits:[]},{seed:id,registry,noVariance:true}).unit;
  unit.id=id;return unitRecordFromCombatant(unit);
 });
 const before=prepareInventoryState({schemaVersion:2,factRevision:1,storage,rosterIds:['A','D'],protagonistId:'A',inventory:[{...createInventoryItem('dose','急救剂',{kind:'consumable',mechanism:'heal',power:3},'dose',3),assignedTo:'A'}]}) as NarrativeSave;
 const units=prepareBattleItems(before.storage!.map(r=>materializeUnitRecord(r,registry)),before);
 const battle=mode==='small'?new SmallBattle({combatants:units,seed:'original',rules:V3_D20,battlefield:standardField(),traitRegistry:registry}):new MassBattle({combatants:units,seed:'original',rules:V3_TW,traitRegistry:registry});
 battle.start();const start=captureBattleStart(battle,captureBattleArchive(before)),initial={...before,battle:{kind:mode,snap:structuredClone(battle.toSnapshot())}};
 const actor=battle.byId('A'),dose=actor.abilities.find(a=>a.itemSourceId==='dose')!;
 applyHealthLoss(actor,20);actor.resources[dose.cost!.resource]=2;actor.abilityState.push({abilityId:dose.id,used:1,cdLeft:0});
 battle.xpByUnit.set('A',50);battle.finishBattle('ceasefire');
 const result=commitBattleOutcome({battleId:start.battleId,committedIds:[],records:before.storage!,roster:units,combatants:battle.combatants,awards:battleXpAwards(battle.combatants,battle.xpByUnit,{won:false}),registry});
 const next=prepareBattleItemWrite(initial,{...before,storage:result.records,rosterIds:result.roster.map(u=>u.id),committedOutcomeIds:result.committedIds,battle:{kind:mode,snap:structuredClone(battle.toSnapshot())},factRevision:2,
  activeBattleStart:start,reports:[{id:start.battleId,card:'结算',digest:'过程',summary:'状态',deliveries:{},start}],selectedReportId:start.battleId}) as NarrativeSave;
 stampNewBattleReports(before,next);return {before,next,start,battle};
}

describe('战报删除与原局重战',()=>{
 it.each(['small','mass'] as const)('%s原局恢复生命/XP/物品，旧编号继续封口，新一轮物品能正常扣除',mode=>{
  const {before,next,start}=finished(mode),original=structuredClone(next);
  expect(next.inventory!.find(i=>i.id==='dose')!.qty).toBe(2);expect(next.storage![0]!.xp).toBeGreaterThan(before.storage![0]!.xp??0);
  const replay=prepareReportRestart(next,start.battleId,2,'retry');expect(next).toEqual(original);
  expect(replay.storage).toEqual(before.storage);expect(replay.inventory).toEqual(before.inventory);expect(replay.committedOutcomeIds).toEqual([start.battleId]);
  expect(replay.battle!.snap.seed).toBe('retry');expect(replay.battle!.snap.rngState).toBe(start.snapshot.rngState);expect(replay.battle!.snap.combatants).toEqual(start.snapshot.combatants);
  expect(replay.reports![0]!.supersededBy).toBe(mode+':retry');expect(replay.factRevision).toBe(3);
  expect(()=>prepareReportRestart(replay,start.battleId,3,'again')).toThrow(/替代/);
  const spending=structuredClone(replay),actors=spending.battle!.snap.combatants as Combatant[];
  const actor=actors.find(u=>u.id==='A')!,ability=actor.abilities.find(a=>a.itemSourceId==='dose')!;actor.resources[ability.cost!.resource]!--;actor.abilityState.push({abilityId:ability.id,used:1,cdLeft:0});
  expect(prepareBattleItemWrite(replay,spending).inventory!.find(i=>i.id==='dose')!.qty).toBe(2);
 });
 it('收兵、报告选择与删除不改变重战资格；后续单位或库存更新立即阻止回退',()=>{
  const {next,start}=finished();const closed={...next,battle:null,rosterIds:['A'],selectedReportId:undefined};
  expect(reportRestartReason(closed,next.reports![0]!)).toBeUndefined();
  for(const edited of [
   {...closed,storage:closed.storage!.map(r=>r.id==='A'?updateUnitRecord(r,{hp:r.hp+1},registry):r)},
   {...closed,inventory:closed.inventory!.map(i=>i.id==='dose'?{...i,qty:i.qty+1}:i)},
  ])expect(()=>prepareReportRestart(edited,start.battleId,2,'retry')).toThrow(/已经变化/);
  expect(()=>prepareReportRestart({...closed,committedOutcomeIds:[start.battleId,'small:later']},start.battleId,2,'retry')).toThrow(/最近/);
  expect(()=>prepareReportRestart(closed,start.battleId,1,'retry')).toThrow(/过期/);
 });
 it('删除可以撤销，保留已结算编号和发送回执，不能通过删除重复奖励',()=>{
  const {next,start}=finished();next.reportDeliveries={[start.battleId]:{cursor:4,receipts:{}}};
  const deleted=prepareReportDeletion(next,start.battleId);
  expect(deleted.reports).toEqual([]);expect(deleted.deletedReportIds).toEqual([start.battleId]);expect(deleted.committedOutcomeIds).toEqual(next.committedOutcomeIds);
  expect(factsOf(deleted)).toBe(factsOf(next));expect(deleted.reportDeliveries).toEqual(next.reportDeliveries);
  const restored=prepareReportRestore(deleted);expect(restored.reports).toEqual(next.reports);expect(restored.deletedReportIds).toEqual([]);expect(archiveStamp(restored)).toBe(archiveStamp(next));
  expect(renderReportWorkspace(null,[],undefined,{},()=>'',{canUndo:true})).toContain('撤销删除');
 });
 it('没有快照的旧战报可删除但不能伪造重战，损坏或重复开局编号拒绝写入',()=>{
  const {next,start}=finished();const old=structuredClone(next);delete old.reports![0]!.start;
  expect(reportRestartReason(old,old.reports![0]!)).toMatch(/没有开局存档记录/);expect(prepareReportDeletion(old,start.battleId).reports).toEqual([]);
  const broken=structuredClone(next);broken.reports![0]!.start!.snapshot.round=3;
  expect(()=>prepareReportRestart(broken,start.battleId,2,'retry')).toThrow(/开局/);
  const missing=structuredClone(next);missing.reports![0]!.start!.before.storage=[];
  expect(()=>prepareReportRestart(missing,start.battleId,2,'retry')).toThrow(/档案/);
  expect(()=>prepareReportRestart(next,start.battleId,2,'original')).toThrow(/重复/);
 });
});
