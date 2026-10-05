import { SmallBattle, type MassBattle, type BattleLogEntry, type Combatant, woundedLabel } from '../../engine/src/index.js';
import { observedLog } from '../../engine/src/observation.js';
import { smallBattleResult } from '../../engine/src/battle-result.js';
import { compactEventGroups, fieldFacts, reportPlaceText, reportStrengthLabel, HEIGHT_LEGEND } from '../../engine/src/inject/format.js';
import { reportsHeights } from '../../engine/src/small/height-map.js';
import { formationNode } from '../../engine/src/mass/formation.js';
import type { BattlefieldSpec } from '../../engine/src/small/spatial.js';
import { NARRATIVE_TASK } from '../../engine/src/inject/narrative-task.js';
import type { DeliveryReceipt } from './tavern.js';
import {memberNoun} from '../../engine/src/member-health.js';

export type Battle = SmallBattle | MassBattle;
export interface NarrativeEvent { index: number; round: number; text: string }
export interface BattleReport {
  id: string; card: string; digest: string; summary: string; deliveries: Record<string, DeliveryReceipt>;
  roundCount?: number; epilogue?: string; narrativeEvents?: NarrativeEvent[]; eventCount?: number;
  start?: import('./report-history.js').BattleStart;
  afterArchiveStamp?: string;
  supersededBy?: string;
}
export interface NarrativeBatch { battleId: string; key: string; kind: 'delta' | 'epilogue'; from: number; to: number; text: string }
export interface BattleDelivery { cursor: number; receipts: Record<string, DeliveryReceipt & { from: number; to: number; kind: NarrativeBatch['kind'] }> }
export type BattleDeliveries = Record<string, BattleDelivery>;
export const battleIdOf = (b: Battle) => `${b instanceof SmallBattle ? 'small' : 'mass'}:${b.seed}`;
export function completedBattleRounds(b: Battle): number {
  // 会战结算完成后计数器已走到下一轮计划；展示实际执行过的轮数。
  return b instanceof SmallBattle ? b.round : b.roundReport()?.round ?? b.round;
}
export function publicBattleEvents(b: Battle): { index: number; entry: BattleLogEntry }[] {
  return b.log.flatMap((entry, index) => (b.rules.resolutionVersion === 'v2' ? observedLog([entry], 'ally') : [entry]).map(entry => ({index,
    entry: entry.kind === 'battle-end' && b instanceof SmallBattle && b.objectiveWinner ? { ...entry, text: smallBattleResult(b) ?? entry.text } : entry })));
}
/** 日志区间[from,to)内可叙述的事件；连续逐格移动与速射在区间内合并，不跨过已发送的游标。 */
export function narrativeEvents(b: Battle, from = 0, to = b.log.length): NarrativeEvent[] {
  const picked = publicBattleEvents(b).filter(({index,entry}) => index >= from && index < to && !['initiative','round'].includes(entry.kind) && !/^布阵/.test(entry.text));
  return compactEventGroups(picked.map(p => p.entry), { unresolvedAttacks: true })
    .map(group => ({ index: picked[group.first]!.index, round: picked[group.first]!.entry.round, text: group.text }));
}
/** 归档时按已发送的游标分两段合并，之后从归档补发的增量不重复已经发出的移动。 */
export function archivedNarrativeEvents(b: Battle, deliveries: BattleDeliveries): NarrativeEvent[] {
  const cursor = Math.max(0, Math.min(deliveries[battleIdOf(b)]?.cursor ?? 0, b.log.length));
  return [...narrativeEvents(b, 0, cursor), ...narrativeEvents(b, cursor)];
}
export function knownBattleState(b: Battle): string {
  const field = b instanceof SmallBattle ? b.battlefield : undefined;
  return ['【最新状态】' + (reportsHeights(field) ? '（' + HEIGHT_LEGEND + '）' : ''), ...(b instanceof SmallBattle && b.isOver() ? [smallBattleResult(b)!] : []), ...b.visibleCombatants('ally').map(u=>epilogueUnit(b,u,field))].join('\n');
}
const RANK_NAMES = { front: '前列', rear: '后列', reserve: '预备列' } as const;
/** 小战写格子、地形与高度，会战写阵位；撤离的单位和没有位置的旧记录不写。 */
function unitPlace(b: Battle, u: Combatant, field?: BattlefieldSpec): string {
  if (u.status === 'fled') return '';
  if (b instanceof SmallBattle) return field && Number.isInteger(u.pos) && u.pos! >= 0 && u.pos! < field.tiles.length ? '(' + reportPlaceText(field, u.pos!, u) + ')' : '';
  if (u.rulesVersion !== 'v2') return '';
  try { const node = formationNode(b.effectiveUnit(u)); return '(' + node.wing + RANK_NAMES[node.rank] + ')'; } catch { return ''; }
}
function epilogueUnit(b: Battle, u: Combatant, field?: BattlefieldSpec): string {
  const statuses = {ready:'可行动',dying:'濒死',dead:u.scale==='hero'?'阵亡':'编队失去战斗力',routing:'溃退中',fled:'已撤离'};
  const conditions=u.conditions.filter(c=>c.dur>0).map(c=>`${b.conditions.get(c.id)?.name??c.id}（${c.dur}轮）`);
  return `${u.side==='ally'?'我方':u.side==='enemy'?'敌方':'中立'} ${u.name}${unitPlace(b,u,field)}：${reportStrengthLabel(u)}，${statuses[u.status]}${woundedLabel(u,true)?'，'+woundedLabel(u,true):''}${conditions.length?'，'+conditions.join('、'):''}`;
}
/** 按真实生命/现员损失累计，过量伤害不计入；来源按稳定id区分。成员生命编队另记减员人数。 */
function epilogueDamage(b: Battle): string[] {
  const totals=new Map<string,{source?:string;target:string;amount:number;life:boolean;members:number;membersPartial:boolean;causes:Set<string>;sourceName?:string;targetName?:string}>();
  for(const e of b.isOver()?b.log:publicBattleEvents(b).map(e=>e.entry)) {
    for (const r of e.resolutions?.length?e.resolutions:[e.resolution]) {
    const d=e.damage;
    const amount=r?Math.max(0,r.hpBefore-r.hpAfter):d?.amount??0;
    if(amount<=0 || !Number.isFinite(amount))continue;
    const source=r?.attackerId??d?.sourceId,target=r?.defenderId??d?.targetId;if(!target)continue;
    const life=r?.damageModel==='member-health'||d?.unit==='life';
    const key=JSON.stringify([source??null,target,life]);
    const row=totals.get(key)??{source,target,amount:0,life,members:0,membersPartial:false,causes:new Set<string>(),sourceName:r?.attackerName,targetName:r?.defenderName};
    row.amount+=amount;if(d?.cause)row.causes.add(d.cause);totals.set(key,row);
    // 更新前保存的持续伤害记录没有减员数，只能给出下限。
    const members=r?r.membersBefore!==undefined&&r.membersAfter!==undefined?r.membersBefore-r.membersAfter:undefined:d?.members;
    if(members===undefined)row.membersPartial=true;else row.members+=Math.max(0,members);
    }
  }
  return [...totals.values()].map(row=>{
    const source=b.combatants.find(u=>u.id===row.source),target=b.combatants.find(u=>u.id===row.target);
    const members=row.life&&target&&target.scale!=='hero'?`，${row.membersPartial?'减员至少':'减员'}${row.members}${memberNoun(target)}`:'';
    return `${source?.name??row.sourceName??'来源未记录'} → ${target?.name??row.targetName??row.target}：累计造成${row.amount}${row.life||target?.scale==='hero'?'生命损失':target?memberNoun(target)+'减员':'点损失'}${row.causes.size?'（含'+[...row.causes].join('、')+'）':''}${members}`;
  });
}
/** 致命规则；战中切换过时写明开局规则和每次切换的轮次，单位按倒下时的规则记录。 */
function lethalityRule(b: Battle): string {
  const changes = b.log.filter(e => e.kind === 'rule' && e.rule);
  if (!changes.length) return b.nonLethal ? '非致命：双方生命归零只会濒死失能，不视为死亡；编队减员为可救伤兵。' : '致命：生命归零按阵亡结算。';
  const name = (nonLethal: boolean) => nonLethal ? '非致命' : '致命';
  return `开局${name(!changes[0]!.rule!.nonLethal)}，${changes.map(e => `第${e.round}轮起改为${name(e.rule!.nonLethal)}`).join('，')}。`
    + '单位按倒下时的规则记录：致命阶段生命归零即阵亡；非致命阶段只会濒死失能，不视为死亡，编队减员为可救伤兵。';
}
export function battleEpilogue(b: Battle, start?: BattleReport['start']): string {
  const visible=b.isOver()?b.combatants:b.visibleCombatants('ally'),ids=new Set(visible.map(u=>u.id));
  const opening=start?.battleId===battleIdOf(b)&&Array.isArray(start.snapshot.combatants)?(start.snapshot.combatants as Combatant[]).filter(u=>ids.has(u.id)):undefined;
  // 开局位置按开战快照里的地图写，之后城墙被毁等变化不回写到开局。
  const openingField=b instanceof SmallBattle&&opening&&start!.snapshot.battlefield&&typeof start!.snapshot.battlefield==='object'?start!.snapshot.battlefield as BattlefieldSpec:undefined;
  const field=b instanceof SmallBattle?b.battlefield:undefined,facts=fieldFacts(b);
  const damage=epilogueDamage(b);
  const goal = b instanceof SmallBattle && b.battlefield?.objective;
  const mission = goal ? goal.kind === 'annihilation' ? '歼灭战' : goal.kind === 'control' ? goal.attackingSide ? goal.attackingSide === 'ally' ? '攻城战' : '守城战' : '占旗战' : '护送/拦截' : '军团会战';
  return [`【战阵·战斗终章】${mission}，共${completedBattleRounds(b)}轮；${b.isOver() ? b.winner()==='ally'?'我方胜利':b.winner()==='enemy'?'我方失利':'停战/僵持':'尚未结束'}`,
    ...(b instanceof SmallBattle && b.isOver() ? ['【胜负原因】' + smallBattleResult(b)] : []),
    `【本场规则】${lethalityRule(b)}`,
    ...(facts.length?['【战场】',...facts]:[]),
    '【开局单位状态与血量】',...(opening?.length?opening.map(u=>epilogueUnit(b,u,openingField)):['这场旧战斗没有开局存档记录，开局状态与血量未记录，不推测。']),
    '【结束单位状态与血量】',...visible.map(u=>epilogueUnit(b,u,field)),
    '【伤害来源】',...(damage.length?damage:['没有记录到可核实的伤害。']),
    NARRATIVE_TASK].join('\n');
}
export function makeNarrativeBatch(b: Battle | undefined, report: BattleReport | undefined, deliveries: BattleDeliveries, kind: NarrativeBatch['kind'], start?: BattleReport['start']): NarrativeBatch {
  const id=b ? battleIdOf(b) : report?.id; if(!id)throw Error('没有可发送的战况');
  if(kind==='epilogue') {
    if(b && !b.isOver())throw Error('战斗结束后可发送终章');
    return {battleId:id,kind,key:'epilogue',from:0,to:b?.log.length??report?.eventCount??0,text:b?battleEpilogue(b,start??report?.start):report?.epilogue??report?.summary??''};
  }
  const from=deliveries[id]?.cursor??0,to=b?.log.length??report?.eventCount??0;
  if(!b && !report?.narrativeEvents)throw Error('这份旧战报没有事件游标，可发送完整战报或状态摘要');
  const events=(b?narrativeEvents(b,from,to):report!.narrativeEvents!).filter(e=>e.index>=from && e.index<to);
  if(!events.length)throw Error('没有新的可叙述事件');
  let round=-1;const lines:string[]=[];
  for(const e of events){if(e.round!==round){round=e.round;lines.push(`【第${round}轮】`);}lines.push('▸ '+e.text);}
  return {battleId:id,kind,key:`delta:${from}:${to}`,from,to,text:['【战阵·新增战况】',...lines,b?knownBattleState(b):report!.summary.split('【叙述任务】')[0]!.trimEnd(),NARRATIVE_TASK].join('\n')};
}
export function beginNarrativeDelivery(deliveries: BattleDeliveries, batch: NarrativeBatch): void {
  const state=deliveries[batch.battleId]??={cursor:0,receipts:{}};
  if(batch.kind==='delta' && Object.values(state.receipts).some(r=>r.kind==='delta'&&['sending','unknown','inserted'].includes(r.status)))throw Error('上次战况投递待核对，请先在战报页确认结果');
  const prior=state.receipts[batch.key];if(prior&&['sent','sending','unknown','inserted'].includes(prior.status))throw Error('这份内容已经发送或结果待核对');
  state.receipts[batch.key]={kind:batch.kind,from:batch.from,to:batch.to,status:'sending'};
}
export function finishNarrativeDelivery(deliveries: BattleDeliveries, batch: Pick<NarrativeBatch,'battleId'|'key'>, receipt: DeliveryReceipt): void {
  const state=deliveries[batch.battleId], prior=state?.receipts[batch.key];if(!state||!prior)return;
  state.receipts[batch.key]={...prior,...receipt};
  if(prior.kind==='delta'&&receipt.status==='sent')state.cursor=Math.max(state.cursor,prior.to);
}
export function reportRoundCount(report: BattleReport): number | undefined {
  return report.roundCount ?? (Number(/共(\d+)回合/.exec(report.card)?.[1]) || undefined);
}
