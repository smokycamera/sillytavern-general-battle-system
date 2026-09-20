import { cellLabel, type SmallBattle, type UnitChange, type RoundFeedback } from '../../engine/src/index.js';
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const statusNames: Record<string, string> = { ready: '恢复行动', dying: '濒死倒地', dead: '阵亡', routing: '惊退', fled: '撤出战场' };
const meaningful = (u: UnitChange) => u.lost || u.recovered || u.morale || u.fatigue || u.gained.length || u.ended.length || u.statuses.length || Object.values(u.resources).some((r) => r.delta) || u.sight || u.fromCell !== u.toCell;
const signed = (n: number) => n > 0 ? '+' + n : String(n);
function detail(battle: SmallBattle, u: UnitChange): string {
  const parts = [
    u.lost ? '损失' + u.lost + (u.scale === 'hero' ? '生命' : '人') : '',
    u.recovered ? '恢复' + u.recovered + (u.scale === 'hero' ? '生命' : '人') : '',
    ...Object.values(u.resources).filter((r) => r.delta).map((r) => r.name + signed(r.delta)),
    ...u.statuses.map((s) => statusNames[s] ?? '状态变化'),
    u.morale ? '士气' + signed(u.morale) : '', u.fatigue ? '疲劳' + signed(u.fatigue) : '',
    u.gained.length ? '获得' + u.gained.join('、') : '', u.ended.length ? u.ended.join('、') + '结束' : '',
    u.fromCell !== undefined && u.toCell !== undefined && u.fromCell !== u.toCell ? cellLabel(battle.battlefield!, u.fromCell) + '→' + cellLabel(battle.battlefield!, u.toCell) : '',
    u.sight === 'found' ? '进入视野' : u.sight === 'lost' ? '脱离视野，后续情况未知' : '',
  ].filter(Boolean);
  return '<li><b class="' + u.side + '">' + esc(u.name) + '</b><span>' + parts.map(esc).join('；') + '</span></li>';
}
function headline(round: RoundFeedback): string {
  const lines: string[] = [];
  for (const side of ['ally', 'enemy'] as const) {
    const units = round.changes.filter((u) => u.side === side);
    const sums = (field: 'lost' | 'recovered', hero: boolean) => units.filter((u) => (u.scale === 'hero') === hero).reduce((n, u) => n + u[field], 0);
    const losses = [sums('lost', true) ? sums('lost', true) + '生命' : '', sums('lost', false) ? sums('lost', false) + '人' : ''].filter(Boolean);
    const heals = [sums('recovered', true) ? sums('recovered', true) + '生命' : '', sums('recovered', false) ? sums('recovered', false) + '人' : ''].filter(Boolean);
    if (losses.length || heals.length) lines.push((side === 'ally' ? '我方' : '可见敌方') + [losses.length ? '损失' + losses.join('、') : '', heals.length ? '恢复' + heals.join('、') : ''].filter(Boolean).join('，'));
  }
  if (round.objective) {
    const after = round.objective.after;
    lines.push(after.winner ? after.winner === 'ally' ? '任务胜利' : after.winner === 'enemy' ? '任务失败' : '任务期限已到' : '占领进度：我方' + after.ally + '，敌方' + after.enemy);
  }
  return lines.join(' · ') || '无显著战损 · 行动与资源详见明细';
}
export function renderRoundFeedback(battle: SmallBattle): string {
  const rounds = battle.roundFeedback().filter((r) => r.changes.some(meaningful) || r.objective);
  if (!rounds.length) return '';
  const completed = battle.activationFeedback();
  const selected = rounds[0]!, rows = selected.changes.filter(meaningful);
  const significant = rows.filter((u) => u.statuses.length || u.lost || u.recovered || u.gained.length || u.ended.length);
  const lead = (significant.length ? significant : rows.filter(u => u.sight || u.fromCell !== u.toCell)).slice(0, 2);
  return `<aside class="round-feedback" aria-label="已知回合变化"><div class="feedback-heading"><b>第${selected.round}轮${selected.round < battle.round ? '已结束' : '变化'}</b><span>${esc(headline(selected))}</span></div>
    ${completed && (completed.changes.some(meaningful) || completed.objective) ? '<div class="activation-feedback">上一激活 · ' + esc(completed.actorName ?? '未定位单位') + '：' + esc(headline(completed)) + '</div>' : ''}
    <ul class="feedback-lead">${lead.map((u) => detail(battle, u)).join('')}</ul>
    <details data-detail-id="round-feedback"><summary>查看${rows.length}个单位的变化${rounds.length > 1 ? '与上一轮' : ''}</summary>
      ${completed ? '<h4>上一激活 · ' + esc(completed.actorName ?? '未定位单位') + '</h4><ul>' + completed.changes.filter(meaningful).map((u) => detail(battle, u)).join('') + '</ul>' : ''}
      ${rounds.map((r) => '<h4>第' + r.round + '轮</h4><ul>' + r.changes.filter(meaningful).map((u) => detail(battle, u)).join('') + '</ul>').join('')}
      <p>只汇总观测到的变化；生命和人数分开累计。脱离视野期间的行动与战损不作推测。</p>
    </details></aside>`;
}
