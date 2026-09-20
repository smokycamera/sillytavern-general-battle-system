import {describe,it,expect} from 'vitest';
import {traitRegistry,applyCombatDamage,memberHealth,SmallBattle,V4_D20,standardField} from '../../engine/src/index.js';
import {newUnitDraft,buildUnit,unitDraftFromRecord,editUnitBuild} from './unit-builder.js';
import {unitRecordFromCombatant,materializeUnitRecord,commitBattleOutcome} from './unit-state.js';
import {prepareInventoryState,createInventoryItem,prepareInventoryTransaction} from './inventory-state.js';
import {captureBattleStart,captureBattleArchive,prepareReportRestart,stampNewBattleReports} from './report-history.js';
import {battleEpilogue,battleIdOf} from './battle-reports.js';
import {narrativeProjection} from './narrative-controller.js';
import {memberHealthPanel} from './combat-model-view.js';
import {skillDefinitionId} from '../../engine/src/skill-catalog.js';
const registry=traitRegistry();
function vehicle(name='车辆',side='ally'){
 const d=newUnitDraft();d.name=name;d.side=side;d.scale='company';d.body='vehicle';d.hp='12';d.hpMax='12';d.memberHp='100';d.primary.mechanism='cannon';d.primary.body='vehicle';d.primary.power='6';return buildUnit(d,registry,name);
}
describe('成员生命的本地档案与重战',()=>{
 it('12辆×100生命可编辑、归档、治疗；改名与提高生命上限不补满伤口',()=>{
  const u=vehicle();applyCombatDamage(u,46,1);const record=unitRecordFromCombatant(u);
  const draft=unitDraftFromRecord(record);draft.name='重命名车辆';draft.memberHp='120';const edited=editUnitBuild(record,draft,registry),loaded=materializeUnitRecord(edited,registry);
  expect(loaded.formation!.memberHp).toBe(120);expect(memberHealth(loaded)).toBe(1154);expect(loaded.formation!.health![0]).toEqual({hp:54,count:1});
  const before=prepareInventoryState({storage:[record],rosterIds:[record.id],inventory:[createInventoryItem('aid','修理包',{kind:'consumable',mechanism:'heal',power:3},'aid',2)],factRevision:1});
  const after=prepareInventoryTransaction(before,{id:'repair',kind:'use',itemId:'aid',unitId:record.id,expectedRevision:1});
  const repaired=materializeUnitRecord(after.storage![0]!,registry);expect(repaired.hp).toBe(12);expect(memberHealth(repaired)).toBeGreaterThan(1154);expect(memberHealth(repaired)).toBeLessThan(1200);expect(after.inventory![0]!.qty).toBe(1);
  expect(memberHealthPanel(repaired)).toContain('12/12辆');expect(memberHealthPanel(repaired)).toContain('生命');
 });
 it('非零伤损进入终章和AI事实；提交与原局重战保留开局受伤成员',()=>{
  const a=vehicle(),d=vehicle('敌军','enemy');applyCombatDamage(a,27,1);
  const records=[a,d].map(u=>unitRecordFromCombatant(u)),before=prepareInventoryState({storage:records,rosterIds:records.map(r=>r.id),inventory:[],factRevision:1});
  const b=new SmallBattle({combatants:[a,d],rules:V4_D20,battlefield:standardField(),seed:'health-replay',traitRegistry:registry});b.start();
  const start=captureBattleStart(b,captureBattleArchive(before));applyCombatDamage(a,19,1);b.finishBattle('ceasefire');
  const id=battleIdOf(b),result=commitBattleOutcome({battleId:id,committedIds:[],records,roster:[a,d],combatants:b.combatants,awards:[],registry});
  const epilogue=battleEpilogue(b,start);expect(epilogue).toContain('73/100生命');expect(epilogue).toContain('54/100生命');
  const after={...before,storage:result.records,factRevision:2,committedOutcomeIds:result.committedIds,battle:{kind:'small' as const,snap:structuredClone(b.toSnapshot())},reports:[{id,card:'',digest:'',summary:'',epilogue,deliveries:{},start}]};
  stampNewBattleReports(before,after);const replay=prepareReportRestart(after,id,2,'health-retry');
  const restored=SmallBattle.fromSnapshot(replay.battle!.snap);expect(restored.byId(a.id).formation!.health![0]).toEqual({hp:73,count:1});
  const facts=narrativeProjection(after);expect(facts).toContain('memberHpMax');expect(facts).toContain('1154');expect(facts).toContain('载具数量');
 });
 it('高阶范围技能和机炮配方可以持久化，不因新规格记录被拒绝',()=>{
  const d=newUnitDraft();d.name='高阶施法者';d.skills=[{id:skillDefinitionId('魔法范围')!,name:'高阶法术',power:'9',prepared:true}];
  const inventory=prepareInventoryState({storage:[],rosterIds:[],inventory:[createInventoryItem('auto','机炮',{kind:'weapon',mechanism:'autocannon',power:6,body:'vehicle'},'auto')]});
  expect(inventory.inventory).toHaveLength(1);
  // 通用机制名称通过正式解析生成，检查升级后的范围参数能够通过档案验证。
  const caster=buildUnit(d,registry,'caster'),loaded=materializeUnitRecord(unitRecordFromCombatant(caster),registry);
  expect(loaded.abilities[0]!.effectVersion).toBe('skill-v4.1');expect(loaded.abilities[0]!.areaExposure).toBe(128);
 });
});
