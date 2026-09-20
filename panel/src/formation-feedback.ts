import { FORMATION_NODES, type MassBattle, type UnitChange } from '../../engine/src/index.js';
import { orderLabels } from './formation-orders.js';
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const statusLabel: Record<string, string> = { ready: '恢复行动', dying: '濒死', dead: '阵亡', routing: '惊退', fled: '撤离' };
const frontLabel = { ally: '我方控制', enemy: '敌方控制', contested: '争夺', empty: '空缺' };
const sign = (n: number) => n > 0 ? '+' + n : String(n);
const at = (index: number) => { const n = FORMATION_NODES[index]; return n ? (n.side === 'ally' ? '我方' : '敌方') + n.wing + ({ front: '前线', rear: '支援', reserve: '预备' })[n.rank] : '原阵位'; };
function changeText(c: UnitChange): string {
  return [c.lost ? '损失' + c.lost + (c.scale === 'hero' ? '生命' : '人') : '', c.recovered ? '恢复' + c.recovered + (c.scale === 'hero' ? '生命' : '人') : '',
    ...c.statuses.map((s) => statusLabel[s] ?? '状态变化'), c.morale ? '士气' + sign(c.morale) : '', c.fatigue ? '疲劳' + sign(c.fatigue) : '',
    ...Object.values(c.resources).filter((r) => r.delta).map((r) => r.name + sign(r.delta)),
    c.gained.length ? '获得' + c.gained.join('、') : '', c.ended.length ? c.ended.join('、') + '结束' : '',
    c.fromCell !== undefined && c.toCell !== undefined && c.fromCell !== c.toCell ? at(c.fromCell) + '→' + at(c.toCell) : '',
    c.sight === 'found' ? '进入视野' : c.sight === 'lost' ? '脱离视野' : '',
  ].filter(Boolean).join('；');
}
function totals(changes: UnitChange[]): string {
  const pieces: string[] = [];
  for (const side of ['ally', 'enemy'] as const) for (const hero of [false, true]) {
    const subset = changes.filter((c) => c.side === side && (c.scale === 'hero') === hero), lost = subset.reduce((n, c) => n + c.lost, 0), recovered = subset.reduce((n, c) => n + c.recovered, 0);
    if (lost || recovered) pieces.push((side === 'ally' ? '我方' : '可见敌方') + (lost ? '损失' + lost + (hero ? '生命' : '人') : '') + (recovered ? ' 恢复' + recovered + (hero ? '生命' : '人') : ''));
  }
  return pieces.join(' · ') || '无已知生命或人数变化';
}
export function renderFormationFeedback(b: MassBattle): string {
  const report = b.roundReport(); if (!report) return '';
  const names = new Map(report.total.changes.map((c) => [c.id, c.name]));
  const blocked = report.orders.filter((o) => o.status === 'blocked');
  const front = Object.entries(report.frontAfter).filter(([wing, side]) => report.frontBefore[wing] !== side)
    .map(([wing, side]) => wing + '：' + (frontLabel[report.frontBefore[wing]!] ?? '未记录') + '→' + frontLabel[side]);
  return `<aside class="mass-round-feedback"><div class="feedback-heading"><b>第${report.round}轮已执行</b><span>${esc(totals(report.total.changes))}</span></div>
    ${front.length ? '<p class="front-change">' + front.map(esc).join('；') + '</p>' : ''}
    ${blocked.length ? '<p class="grid-reason">' + blocked.length + '个我方任务受阻：' + blocked.slice(0, 2).map((r) => esc(names.get(r.order.unitId) ?? b.combatants.find((u) => u.id === r.order.unitId)?.name ?? '编队') + '（' + esc(r.reason ?? '前序阶段改变局势') + '）').join('；') + '</p>' : ''}
    <details data-detail-id="mass-phase-feedback"><summary>阶段变化与任务结果</summary>
      <div class="mass-phase-feedback">${report.phases.map((phase) => '<details><summary><b>' + phase.phase + '</b> · ' + esc(totals(phase.changes)) + '</summary><ul>' + phase.changes.filter((c) => changeText(c)).map((c) => '<li><b>' + esc(c.name) + '</b> ' + esc(changeText(c)) + '</li>').join('') + '</ul></details>').join('')}</div>
      <ul class="mass-order-receipts">${report.orders.map((r) => '<li><b>' + esc(names.get(r.order.unitId) ?? b.combatants.find((u) => u.id === r.order.unitId)?.name ?? '编队') + '</b> · ' + orderLabels[r.order.type] + ' · ' + r.phase + ' · ' + ({ locked: '已锁定', executed: '已执行', blocked: '受阻' })[r.status] + (r.reason ? '：' + esc(r.reason) : '') + '</li>').join('')}</ul>
      <p class="sub">记录实际可观察到的变化；未发现敌军的行动与战损不作推测。</p>
    </details></aside>`;
}
