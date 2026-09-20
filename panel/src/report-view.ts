import { battleIdOf, makeNarrativeBatch, reportRoundCount, type Battle, type BattleReport, type BattleDeliveries } from './battle-reports.js';
import { escapeHtml as esc } from './battle-presentation.js';
import { applySettlementPrompt, type PromptSettings } from './prompt-settings.js';
import type { DeliveryReceipt } from './tavern.js';
const deliveryWords = {sent:'已发送',inserted:'已插入，尚未生成',copied:'已复制，需手动发送',failed:'发送失败',unknown:'结果未知',sending:'发送中，待核对'};
export function renderReportWorkspace(b: Battle | null, reports: BattleReport[], selectedId: string | undefined, deliveries: BattleDeliveries, renderLog: (b: Battle) => string,
  controls: {native?:boolean;restartReason?:string;restartPreview?:{id:string;revision:number};canUndo?:boolean;deletedCurrent?:boolean;start?:BattleReport['start'];promptSettings?:PromptSettings} = {}): string {
  const report=b?reports.find(r=>r.id===battleIdOf(b)):reports.find(r=>r.id===selectedId)??reports.at(-1);
  const undo=controls.canUndo?'<div class="row"><span>最近删除的战报可以恢复。</span><button data-action="report-restore">撤销删除</button></div>':'';
  if(!b&&!report)return undo?`<section class="report-workspace"><h2>战报</h2><p>没有归档战报。</p>${undo}</section>`:'';
  const id=b?battleIdOf(b):report!.id, dispatch=deliveries[id];
  const over=!b||b.isOver();let delta='',epilogue='';
  try{delta=makeNarrativeBatch(b??undefined,report,deliveries,'delta').text;}catch{/*旧战报或无新事件*/}
  try{epilogue=makeNarrativeBatch(b??undefined,report,deliveries,'epilogue',controls.start).text;}catch{/*战斗未结束*/}
  delta=applySettlementPrompt(delta,controls.promptSettings);epilogue=applySettlementPrompt(epilogue,controls.promptSettings);
  const blocked=Object.values(dispatch?.receipts??{}).some(r=>r.kind==='delta'&&['sending','inserted','unknown'].includes(r.status));
  const finished=dispatch?.receipts.epilogue?.status==='sent';
  const title=(r:BattleReport,i:number)=>`第${i+1}场${r.id.startsWith('mass:')?'会战':'交战'}${reportRoundCount(r)?' · '+reportRoundCount(r)+'回合':''}`;
  const retry = (receipt: DeliveryReceipt, key?: string, label?: string) => controls.native && receipt.deliveryId && ['inserted','unknown','sending'].includes(receipt.status)
    ? `<button data-action="delivery-generate" data-battle="${esc(id)}" data-delivery="${esc(receipt.deliveryId)}" ${key ? `data-key="${esc(key)}"` : `data-label="${esc(label ?? '')}"`}>仅重试生成，不重发战报</button>` : '';
  return `<section class="report-workspace"><h2>${over?'战报与叙述':'当前战况'}</h2><p class="sub">战报独立保存，收兵后仍可发送。增量战况只从上次确认发送的位置继续。</p>${!b?`<label>历史战报<select data-role="report-select">${reports.map((r,i)=>`<option value="${esc(r.id)}" ${r.id===report?.id?'selected':''}>${esc(title(r,i))}</option>`).join('')}</select></label>`:''}
    ${report?'<span class="tag">'+(report.supersededBy?'已被重战替代，仅供对照':'已归档')+'</span>':''}${controls.deletedCurrent?'<p>本场归档报告已删除；当前战场过程仍保留到收兵。</p>':''}
    ${report?`<div class="row report-manage-actions"><button data-action="report-restart" data-id="${esc(report.id)}" ${controls.restartReason?'disabled':''}>重新战斗</button><button class="danger" data-action="report-delete" data-id="${esc(report.id)}">删除战报</button></div>${controls.restartReason?'<p class="sub">'+esc(controls.restartReason)+'</p>':''}<p class="sub">删除只清理报告，不撤销已入账的经验、伤亡或聊天消息。</p>`:''}${undo}
    ${controls.restartPreview&&report?`<div class="report-restart-preview"><p>恢复本场开战前的阵容、生命、经验与物品数量，保留原地图和开局随机状态。重战结束后以新战果为准，原报告保留作对照；已经发送到聊天的内容不会自动撤回。</p><div class="row"><button class="primary" data-action="report-restart-confirm" data-id="${esc(report.id)}" data-revision="${controls.restartPreview.revision}">确认恢复原局并重战</button><button data-action="report-restart-cancel">取消</button></div></div>`:''}
    <div class="report-send-actions">${over?`<button class="primary" data-action="out-epilogue" ${finished?'disabled':''}>${finished?'终章已发送':'叙述战斗终章'}</button>`:''}<button data-action="out-digest">发送完整逐轮战报</button><button class="${over?'':'primary'}" data-action="out-delta" ${!delta||blocked?'disabled':''}>叙述未发送战况</button></div>
    ${blocked?'<p class="grid-reason">上次投递结果需要核对；确认后才能继续发送增量。</p>':''}
    <div class="report-receipts">${Object.entries(dispatch?.receipts??{}).map(([key,r])=>`<div><p>${r.kind==='epilogue'?'战斗终章':'战况区间 '+r.from+'–'+r.to}：${deliveryWords[r.status]}${r.detail?' · '+esc(r.detail):''}</p>${retry(r,key)}${['sending','unknown','inserted','copied'].includes(r.status)?`<div class="row"><button data-action="delivery-review" data-battle="${esc(id)}" data-key="${esc(key)}" data-result="sent">已核对聊天，确认已发送</button><button data-action="delivery-review" data-battle="${esc(id)}" data-key="${esc(key)}" data-result="failed">已核对未送达，允许重试</button></div>`:''}</div>`).join('')}${Object.entries(report?.deliveries??{}).map(([label,r])=>`<p>${esc(label)}：${deliveryWords[r.status]}${r.detail?' · '+esc(r.detail):''}</p>${retry(r,undefined,label)}`).join('')}</div>
    <details data-detail-id="report-send-preview"><summary>预览${over?'终章':'未发送战况'} · ${(over?epilogue:delta).length.toLocaleString()}字符</summary><pre class="report-preview">${esc((over?epilogue:delta)||'没有新的可叙述内容。')}</pre></details>
    <details class="report-options" data-detail-id="report-options"><summary>其他发送内容</summary><div class="row"><button data-action="out-card">发送完整结算</button><button data-action="out-inject">只发送状态摘要</button></div></details>
    ${b?`<details class="report-log" data-detail-id="report-log"><summary>战斗过程与骰子明细</summary><div class="log" id="logview">${renderLog(b)}</div></details>`:`<details data-detail-id="report-document"><summary>查看完整逐轮战报</summary><div class="report-document"><pre>${esc(report!.digest||report!.card)}</pre></div></details>`}</section>`;
}
