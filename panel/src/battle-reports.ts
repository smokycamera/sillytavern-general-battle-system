import { SmallBattle, type MassBattle, type BattleLogEntry, type Combatant, woundedLabel } from '../../engine/src/index.js';
import { observedLog } from '../../engine/src/observation.js';
import { compactEvents } from '../../engine/src/inject/format.js';
import { NARRATIVE_TASK } from '../../engine/src/inject/narrative-task.js';
import type { DeliveryReceipt } from './tavern.js';
import {hasMemberHealth,memberHealth,memberHealthMax,memberHealthSummary,memberNoun} from '../../engine/src/member-health.js';

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
  return b.log.flatMap((entry, index) => (b.rules.resolutionVersion === 'v2' ? observedLog([entry], 'ally') : [entry]).map(entry => ({index,entry})));
}
export function narrativeEvents(b: Battle): NarrativeEvent[] {
  return publicBattleEvents(b).filter(({entry}) => !['initiative','round'].includes(entry.kind) && !/^布阵/.test(entry.text)).flatMap(({index,entry}) => {
    const text = compactEvents([entry]).join('；') || (entry.kind === 'attack' && !entry.resolution ? entry.text : '');
    return text ? [{index,round:entry.round,text}] : [];
  });
}
export function knownBattleState(b: Battle): string {
  return ['【最新状态】', ...b.visibleCombatants('ally').map(u=>epilogueUnit(b,u))].join('\n');
}
function epilogueUnit(b: Battle, u: Combatant): string {
  const statuses = {ready:'可行动',dying:'濒死',dead:u.scale==='hero'?'阵亡':'编队失去战斗力',routing:'溃退中',fled:'已撤离'};
  const health=u.scale==='hero'?`生命${u.hp}/${u.base.hpMax}`:hasMemberHealth(u)?`现员${u.hp}/${u.base.hpMax}${memberNoun(u)}，总生命${memberHealth(u)}/${memberHealthMax(u)}；${memberHealthSummary(u,Infinity)}`:`现员${u.hp}/${u.base.hpMax}人${u.formation?`，成员耐久${u.formation.memberHp}`:''}`;
  const conditions=u.conditions.filter(c=>c.dur>0).map(c=>`${b.conditions.get(c.id)?.name??c.id}（${c.dur}轮）`);
  return `${u.side==='ally'?'我方':u.side==='enemy'?'敌方':'中立'} ${u.name}：${health}，${statuses[u.status]}${woundedLabel(u)?'，'+woundedLabel(u):''}${conditions.length?'，'+conditions.join('、'):''}`;
}
/** 按真实生命/现员损失累计，过量伤害不计入；来源按稳定id区分。 */
function epilogueDamage(b: Battle): string[] {
  const totals=new Map<string,{source?:string;target:string;amount:number;life:boolean;causes:Set<string>;sourceName?:string;targetName?:string}>();
  for(const e of b.isOver()?b.log:publicBattleEvents(b).map(e=>e.entry)) {
    for (const r of e.resolutions?.length?e.resolutions:[e.resolution]) {
    const d=e.damage;
    const amount=r?Math.max(0,r.hpBefore-r.hpAfter):d?.amount??0;
    if(amount<=0 || !Number.isFinite(amount))continue;
    const source=r?.attackerId??d?.sourceId,target=r?.defenderId??d?.targetId;if(!target)continue;
    const life=r?.damageModel==='member-health'||d?.unit==='life';
    const key=JSON.stringify([source??null,target,life]);
    const row=totals.get(key)??{source,target,amount:0,life,causes:new Set<string>(),sourceName:r?.attackerName,targetName:r?.defenderName};
    row.amount+=amount;if(d?.cause)row.causes.add(d.cause);totals.set(key,row);
    }
  }
  return [...totals.values()].map(row=>{
    const source=b.combatants.find(u=>u.id===row.source),target=b.combatants.find(u=>u.id===row.target);
    return `${source?.name??row.sourceName??'来源未记录'} → ${target?.name??row.targetName??row.target}：累计造成${row.amount}${row.life||target?.scale==='hero'?'生命损失':target?memberNoun(target)+'减员':'点损失'}${row.causes.size?'（含'+[...row.causes].join('、')+'）':''}`;
  });
}
export function battleEpilogue(b: Battle, start?: BattleReport['start']): string {
  const visible=b.isOver()?b.combatants:b.visibleCombatants('ally'),ids=new Set(visible.map(u=>u.id));
  const opening=start?.battleId===battleIdOf(b)&&Array.isArray(start.snapshot.combatants)?(start.snapshot.combatants as Combatant[]).filter(u=>ids.has(u.id)):undefined;
  const damage=epilogueDamage(b);
  const goal = b instanceof SmallBattle && b.battlefield?.objective;
  const mission = goal ? goal.kind === 'annihilation' ? '歼灭战' : goal.kind === 'control' ? '攻城夺点' : '护送/拦截' : '军团会战';
  return [`【战阵·战斗终章】${mission}，共${completedBattleRounds(b)}轮；${b.isOver() ? b.winner()==='ally'?'我方胜利':b.winner()==='enemy'?'我方失利':'停战/僵持':'尚未结束'}`,
    `【本场规则】${b.nonLethal?'非致命：双方生命归零只会濒死失能，不视为死亡；编队减员为可救伤兵。':'致命：生命归零按阵亡结算。'}`,
    '【开局单位状态与血量】',...(opening?.length?opening.map(u=>epilogueUnit(b,u)):['这场旧战斗没有开局存档记录，开局状态与血量未记录，不推测。']),
    '【结束单位状态与血量】',...visible.map(u=>epilogueUnit(b,u)),
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
  const events=(b?narrativeEvents(b):report!.narrativeEvents!).filter(e=>e.index>=from && e.index<to);
  if(!events.length)throw Error('没有新的可叙述事件');
  let round=-1;const lines:string[]=[];
  for(const e of events){if(e.round!==round){round=e.round;lines.push(`【第${round}轮】`);}lines.push('▸ '+e.text);}
  return {battleId:id,kind,key:`delta:${from}:${to}`,from,to,text:['【战阵·未发送战况】',...lines,b?knownBattleState(b):report!.summary.split('【叙述任务】')[0]!.trimEnd(),NARRATIVE_TASK].join('\n')};
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
