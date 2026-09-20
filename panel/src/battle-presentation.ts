import { SmallBattle, FORMATION_NODES, type Combatant, type BattleLogEntry } from '../../engine/src/index.js';
import { publicBattleEvents, battleIdOf, type Battle } from './battle-reports.js';
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function actionCaption(entry: BattleLogEntry): string {
  const r=entry.resolution;
  if(r)return `${r.attackerName} → ${r.defenderName} · ${!r.hit?'未命中':r.finalDamage>0?`损失${r.finalDamage}${r.damageModel==='member-health'?'生命':''}${r.crit?' · 暴击':''}`:r.penetrationFactor===0?'命中·未穿透':'命中·无生命损失'}`;
  return entry.text.split('\n').filter(l=>!/^伤害 |d20\[/.test(l)).join('；');
}
export function lastBattleAction(b: Battle) {
  const events = publicBattleEvents(b);
  let at = events.length - 1;
  while (at >= 0) { const e = events[at]!.entry; if (e.resolution || ['move','ability'].includes(e.kind) && !/^布阵/.test(e.text) || e.kind==='attack' && !e.resolution) break; at--; }
  const last = events[at]; if (!last) return;
  const r = last.entry.resolution; if (!r || /借机|反击|反应/.test(last.entry.text)) return last;
  const volley = [last.entry];
  for (let i=at-1; i>=0; i--) {
    const previous = events[i]!, next = events[i+1]!;
    if (previous.index !== next.index-1 || previous.entry.kind !== 'attack' || previous.entry.round !== last.entry.round || /借机|反击|反应/.test(previous.entry.text)
      || previous.entry.resolution?.attackerId !== r.attackerId || previous.entry.resolution?.defenderId !== r.defenderId) break;
    volley.unshift(previous.entry);
  }
  return {index:last.index,entry:{...last.entry,resolution:{...r,hit:volley.some(e=>e.resolution!.hit),crit:volley.some(e=>e.resolution!.crit),hpBefore:volley[0]!.resolution!.hpBefore,finalDamage:volley.reduce((n,e)=>n+e.resolution!.finalDamage,0)}}};
}
export function renderBattleHighlights(b: Battle): string {
  const last=lastBattleAction(b),events=publicBattleEvents(b).filter(({entry:e})=>e.round>=Math.max(1,b.round-1));
  const significant=events.filter(({entry:e})=>['death','routing','battle-end'].includes(e.kind)||e.resolution?.crit||/恢复|治疗|救援|占领|护送|重整成功/.test(e.text));
  const picks=significant.slice(-3).reverse();
  if(!last&&!picks.length)return '';
  return `<aside class="battle-highlights" aria-label="行动与关键变化">${last?`<div class="latest-action" data-trace-key="${escapeHtml(battleIdOf(b)+':'+last.index)}"><span><b>上一行动</b> ${escapeHtml(actionCaption(last.entry))}</span><button data-action="battle-replay">重看</button></div>`:''}${picks.length?`<details data-detail-id="battle-highlights"><summary>关键变化 · ${picks.length}项</summary>${picks.map(({entry:e,index})=>`<button class="highlight-event" data-action="battle-highlight" data-event="${index}">第${e.round}轮 · ${escapeHtml(actionCaption(e))}</button>`).join('')}</details>`:''}</aside>`;
}
export function traceLocations(b: Battle, eventIndex?: number): {key:string;cells:number[];label:string;attack:boolean} | undefined {
  const selected=eventIndex===undefined?lastBattleAction(b):publicBattleEvents(b).find(e=>e.index===eventIndex);if(!selected)return;
  const {entry,index}=selected;let cells=Object.values(entry.locations??{}).filter(Number.isInteger);
  if(b instanceof SmallBattle&&b.battlefield&&entry.kind==='move'){
    const matches=[...entry.text.matchAll(/([A-Z])(\d+)/g)];
    if(matches.length===2)cells=matches.map(m=>(Number(m[2])-1)*b.battlefield!.width+m[1]!.charCodeAt(0)-65);
  }
  // 旧事件没有发生时坐标就只显示文字，不借用单位现在的位置伪造历史轨迹。
  const count=b instanceof SmallBattle?b.battlefield?.tiles.length??0:FORMATION_NODES.length;
  cells=cells.filter(c=>c>=0&&c<count);if(!cells.length)return;
  return {key:battleIdOf(b)+':'+index,cells,label:actionCaption(entry),attack:!!entry.resolution};
}
export function traceOverlay(b: Battle): string {
  const trace=traceLocations(b);if(!trace||trace.cells.length<2)return '';
  const grid=b instanceof SmallBattle?b.battlefield:undefined;
  const width=grid?.width??3,height=grid?.height??6;
  const point=(cell:number)=>grid?{x:cell%width+.5,y:Math.floor(cell/width)+.5}:{x:(FORMATION_NODES[cell]?.x??0)+.5,y:(FORMATION_NODES[cell]?.y??0)+.5};
  const from=point(trace.cells[0]!),to=point(trace.cells.at(-1)!);
  return `<svg class="battle-trace ${trace.attack?'trace-attack':'trace-move'}" data-trace-key="${escapeHtml(trace.key)}" viewBox="0 0 ${width*100} ${height*100}" preserveAspectRatio="none" aria-hidden="true"><defs><marker id="trace-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="currentColor"/></marker></defs><line x1="${from.x*100}" y1="${from.y*100}" x2="${to.x*100}" y2="${to.y*100}" marker-end="url(#trace-arrow)" vector-effect="non-scaling-stroke"/></svg>`;
}
const symbols: Record<string,string>={infantry:'M5 5L19 19M19 5L5 19',ranged:'M4 16L18 5M13 5H20V12M4 16L9 20',vehicle:'M4 12H20V18H4ZM10 12V8H16V12M16 8H22M6 21H18',cavalry:'M5 20L9 8L15 4L19 8L15 12L17 20M9 8L5 5',magic:'M6 20L17 5M15 3L17 5L21 5L19 8L19 12L16 10L12 11L13 7Z',artillery:'M3 11L19 5L21 9L7 15M9 15L15 20M7 17A3 3 0 1 0 7 23A3 3 0 1 0 7 17'};
export function unitSymbol(u: Combatant): string {
  const kind=u.body==='vehicle'?'vehicle':u.mount?'cavalry':u.weapon?.recipe?.mechanism==='cannon'||u.weapon?.recipe?.mechanism==='autocannon'?'artillery':u.weapon?.recipe?.mechanism==='staff'?'magic':u.weapon?.tags?.includes('ranged')?'ranged':'infantry';
  return `<svg class="unit-symbol" viewBox="0 0 24 24" aria-hidden="true"><path d="${symbols[kind]}"/></svg>`;
}
