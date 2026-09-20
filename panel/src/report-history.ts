import { SmallBattle } from '../../engine/src/small/battle.js';
import { MassBattle } from '../../engine/src/mass/battle.js';
import { materializeUnitRecord, type UnitRecord } from './unit-state.js';
import { validateInventoryItem, assertInventoryPanelWrite, type InventoryItem } from './inventory-state.js';
import { traitRegistry } from '../../engine/src/data/traits.js';
import type { NarrativeSave } from './narrative-state.js';
import type { BattleReport } from './battle-reports.js';

export interface BattleArchiveState {
  storage: UnitRecord[];
  inventory: InventoryItem[];
  rosterIds: string[];
  protagonistId?: string;
  commanderId?: string;
  encounterIds: string[];
  lastBattleUnitIds: string[];
}
export interface BattleStart {
  version: 1;
  battleId: string;
  kind: 'small' | 'mass';
  snapshot: Record<string, unknown>;
  before: BattleArchiveState;
  replacesReportId?: string;
}
export interface DeletedReport { report: BattleReport; index: number }

/** 不包括报告与界面选择；收兵和删除报告不构成档案成长/装备变更。 */
export function archiveStamp(save: Pick<NarrativeSave, 'storage' | 'inventory'>): string {
  const text = JSON.stringify([save.storage ?? [], save.inventory ?? []]);
  const hashes = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  for (let i=0;i<text.length;i++) for (let n=0;n<hashes.length;n++) hashes[n]=Math.imul(hashes[n]! ^ (text.charCodeAt(i)+n),[16777619,2246822519,3266489917,668265263][n]!);
  return text.length + ':' + hashes.map(h => (h>>>0).toString(16)).join(':');
}

export function captureBattleArchive(save: NarrativeSave): BattleArchiveState {
  return structuredClone({ storage:save.storage??[], inventory:save.inventory??[], rosterIds:save.rosterIds??[],
    protagonistId:save.protagonistId as string|undefined, commanderId:save.commanderId as string|undefined,
    encounterIds:(save.encounterIds as string[]|undefined)??[], lastBattleUnitIds:(save.lastBattleUnitIds as string[]|undefined)??[] });
}

export function captureBattleStart(battle: SmallBattle | MassBattle, before: BattleArchiveState): BattleStart {
  const kind=battle instanceof SmallBattle?'small':'mass';
  return {version:1,battleId:kind+':'+battle.seed,kind,snapshot:structuredClone(battle.toSnapshot()),before:structuredClone(before)};
}

/** 消耗品差额已写入后再记录守卫，保证比较的是实际落库的完整战果。 */
export function stampNewBattleReports(previous: NarrativeSave, next: NarrativeSave): void {
  for(const report of next.reports??[]) {
    if(!report.start || !(next.committedOutcomeIds??[]).includes(report.id))continue;
    if(!(previous.reports??[]).some(r=>r.id===report.id) || !(previous.committedOutcomeIds??[]).includes(report.id)) report.afterArchiveStamp=archiveStamp(next);
  }
}

export function reportRestartReason(save: NarrativeSave, report: BattleReport): string | undefined {
  if(!report.start || report.start.version!==1)return '这份旧战报没有开局快照；新版开战后保存的战报支持原局重战';
  if(report.supersededBy)return '这份战果已被重战替代，请选择最近一次战报';
  if((save.committedOutcomeIds??[]).at(-1)!==report.id)return '仅可重打最近一场已结算战斗';
  if(save.battle && `${save.battle.kind}:${String(save.battle.snap.seed)}`!==report.id)return '请先结束并收兵当前战斗';
  if(!report.afterArchiveStamp || archiveStamp(save)!==report.afterArchiveStamp)return '战后档案或库存已经变化，不能用旧开局覆盖后续进展';
  return undefined;
}

export function prepareReportDeletion(save: NarrativeSave, id: string): NarrativeSave {
  const reports=save.reports??[],index=reports.findIndex(r=>r.id===id);
  if(index<0)throw Error('战报已删除或不存在');
  const remaining=reports.filter(r=>r.id!==id);
  return {...structuredClone(save),reports:structuredClone(remaining),
    deletedReport:structuredClone({report:reports[index]!,index}),
    deletedReportIds:[...new Set([...(save.deletedReportIds??[]),id])],
    selectedReportId:save.selectedReportId===id?remaining[Math.min(index,remaining.length-1)]?.id:save.selectedReportId};
}

export function prepareReportRestore(save: NarrativeSave): NarrativeSave {
  const deleted=save.deletedReport;if(!deleted)throw Error('没有可撤销的删除');
  if((save.reports??[]).some(r=>r.id===deleted.report.id))throw Error('这份战报已经恢复');
  const reports=structuredClone(save.reports??[]);reports.splice(Math.min(deleted.index,reports.length),0,structuredClone(deleted.report));
  return {...structuredClone(save),reports,deletedReport:undefined,deletedReportIds:(save.deletedReportIds??[]).filter(id=>id!==deleted.report.id),selectedReportId:deleted.report.id};
}

/** 一次原子回退：保留原战斗的提交封口，新战斗使用独立身份，旧结果仅作对照。 */
export function prepareReportRestart(save: NarrativeSave, id: string, expectedRevision: number, seed: string): NarrativeSave {
  if(expectedRevision!==(save.factRevision??0))throw Error('重战预览已过期，请按最新状态重新打开');
  const report=save.reports?.find(r=>r.id===id);if(!report)throw Error('战报不存在');
  const reason=reportRestartReason(save,report);if(reason)throw Error(reason);
  const start=structuredClone(report.start!);
  if(start.battleId!==id || `${start.kind}:${String(start.snapshot.seed)}`!==id || start.snapshot.round!==1 || start.snapshot.started!==true
    || !Array.isArray(start.before?.storage) || !Array.isArray(start.before?.inventory) || !Array.isArray(start.before?.rosterIds))throw Error('开局快照不完整，无法重战');
  const newId=start.kind+':'+seed;
  if(!seed || newId===id || (save.committedOutcomeIds??[]).includes(newId) || (save.reports??[]).some(r=>r.id===newId))throw Error('重战身份重复');
  const records=start.before.storage,ids=new Set(records.map(r=>r.id));
  if(ids.size!==records.length || start.before.rosterIds.some(id=>typeof id!=='string'||!ids.has(id)))throw Error('开局档案身份或编制损坏');
  for(const record of records)materializeUnitRecord(record,traitRegistry());
  for(const item of start.before.inventory)validateInventoryItem(item);
  assertInventoryPanelWrite({...start.before},{...start.before});
  start.snapshot.seed=seed;
  // 加载完整引擎快照验证阵位、人数与规则；原开局RNG状态和实际装备均保留。
  const battle=start.kind==='small'?SmallBattle.fromSnapshot(structuredClone(start.snapshot)):MassBattle.fromSnapshot(structuredClone(start.snapshot));
  if(battle.isOver())throw Error('开局快照已结束，不能作为重战起点');
  if(battle.combatants.some(u=>!ids.has(u.id)||!start.before.rosterIds.includes(u.id)||u.recordRevision!==undefined&&u.recordRevision!==(records.find(r=>r.id===u.id)!.revision??1)))throw Error('开局单位与战前档案不一致');
  start.snapshot=structuredClone(battle.toSnapshot());start.battleId=newId;start.replacesReportId=id;
  const next: NarrativeSave={...structuredClone(save),...structuredClone(start.before),
    battle:{kind:start.kind,snap:structuredClone(start.snapshot)},activeBattleStart:start,
    mode:start.kind,smallTarget:'',orderDraft:{},xpSettled:false,selectedReportId:undefined,
    factRevision:expectedRevision+1};
  next.reports=next.reports!.map(r=>r.id===id?{...r,supersededBy:newId}:r);
  return next;
}
