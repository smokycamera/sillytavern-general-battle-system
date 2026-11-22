import { ui } from './ui-language.js';
import { displayNumber } from '../../engine/src/display-number.js';
import { cellLabel, approxDelta, type SmallBattle, type UnitChange, type RoundFeedback } from '../../engine/src/index.js';
import { battleUnitName } from './battle-display.js';
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const statusNames: Record<string, string> = { ready: '恢复行动', dying: '濒死倒地', dead: '阵亡', routing: '惊退', fled: '撤出战场' };
const meaningful = (u: UnitChange) => u.lost || u.recovered || u.morale || u.fatigue || u.gained.length || u.ended.length || u.statuses.length || Object.values(u.resources).some((r) => r.delta) || u.sight || u.fromCell !== u.toCell;
const signed = (n: number) => approxDelta(n);
const amount = (value: number, hero: boolean) => ui(hero ? '{amount}生命' : '{amount}人', { amount: displayNumber(value) });
const name = (battle: SmallBattle, id: string | undefined, fallback: string) => {
  const unit = id === undefined ? undefined : battle.combatants.find(u => u.id === id);
  return unit ? battleUnitName(unit) : fallback;
};
function detail(battle: SmallBattle, u: UnitChange): string {
  const parts = [
    u.lost ? ui('损失{amount}', { amount: amount(u.lost, u.scale === 'hero') }) : '',
    u.recovered ? ui('恢复{amount}', { amount: amount(u.recovered, u.scale === 'hero') }) : '',
    ...Object.values(u.resources).filter((r) => r.delta).map((r) => ui(r.name) + signed(r.delta)),
    ...u.statuses.map((s) => ui(statusNames[s] ?? '状态变化')),
    u.morale ? ui('士气{value}', { value: signed(u.morale) }) : '', u.fatigue ? ui('疲劳{value}', { value: signed(u.fatigue) }) : '',
    u.gained.length ? ui('获得{effects}', { effects: u.gained.map(effect => ui(effect)).join(ui('、')) }) : '',
    u.ended.length ? ui('{effects}结束', { effects: u.ended.map(effect => ui(effect)).join(ui('、')) }) : '',
    u.fromCell !== undefined && u.toCell !== undefined && u.fromCell !== u.toCell ? cellLabel(battle.battlefield!, u.fromCell) + '→' + cellLabel(battle.battlefield!, u.toCell) : '',
    u.sight === 'found' ? ui('进入视野') : u.sight === 'lost' ? ui('脱离视野，后续情况未知') : '',
  ].filter(Boolean);
  return '<li><b class="' + u.side + '">' + esc(name(battle, u.id, u.name)) + '</b><span>' + parts.map(esc).join(ui('；')) + '</span></li>';
}
function headline(round: RoundFeedback): string {
  const lines: string[] = [];
  for (const side of ['ally', 'enemy'] as const) {
    const units = round.changes.filter((u) => u.side === side);
    const sums = (field: 'lost' | 'recovered', hero: boolean) => units.filter((u) => (u.scale === 'hero') === hero).reduce((n, u) => n + u[field], 0);
    const losses = [true, false].flatMap(hero => sums('lost', hero) ? [amount(sums('lost', hero), hero)] : []);
    const heals = [true, false].flatMap(hero => sums('recovered', hero) ? [amount(sums('recovered', hero), hero)] : []);
    if (losses.length || heals.length) lines.push(ui('{side}{changes}', { side: ui(side === 'ally' ? '我方' : '可见敌方'),
      changes: [losses.length ? ui('损失{amount}', { amount: losses.join(ui('、')) }) : '', heals.length ? ui('恢复{amount}', { amount: heals.join(ui('、')) }) : ''].filter(Boolean).join(ui('，')),
    }));
  }
  if (round.objective) {
    const after = round.objective.after;
    lines.push(after.winner ? ui(after.winner === 'ally' ? '任务胜利' : after.winner === 'enemy' ? '任务失败' : '任务期限已到')
      : ui('占领进度：我方{ally}，敌方{enemy}', { ally: displayNumber(after.ally), enemy: displayNumber(after.enemy) }));
  }
  return lines.join(' · ') || ui('无显著战损 · 行动与资源详见明细');
}
export function renderRoundFeedback(battle: SmallBattle): string {
  const rounds = battle.roundFeedback().filter((r) => r.changes.some(meaningful) || r.objective);
  if (!rounds.length) return '';
  const completed = battle.activationFeedback();
  const lastAction = completed && ui('上一行动 · {name}', { name: name(battle, battle.combatants.find(u => u.name === completed.actorName)?.id, completed.actorName ?? ui('未定位单位')) });
  const selected = rounds[0]!, rows = selected.changes.filter(meaningful);
  const significant = rows.filter((u) => u.statuses.length || u.lost || u.recovered || u.gained.length || u.ended.length);
  const lead = (significant.length ? significant : rows.filter(u => u.sight || u.fromCell !== u.toCell)).slice(0, 2);
  return `<aside class="round-feedback" aria-label="${ui("已知回合变化")}"><div class="feedback-heading"><b>${ui(selected.round < battle.round ? '第{round}轮已结束' : '第{round}轮变化', { round: selected.round })}</b><span>${esc(headline(selected))}</span></div>
    ${completed && (completed.changes.some(meaningful) || completed.objective) ? '<div class="activation-feedback">' + esc(ui('{label}：{status}', { label: lastAction!, status: headline(completed) })) + '</div>' : ''}
    <ul class="feedback-lead">${lead.map((u) => detail(battle, u)).join('')}</ul>
    <details data-detail-id="round-feedback"><summary>${ui(rounds.length > 1 ? '查看{count}个单位的变化与上一轮' : '查看{count}个单位的变化', { count: rows.length })}</summary>
      ${completed ? '<h4>' + esc(lastAction!) + '</h4><ul>' + completed.changes.filter(meaningful).map((u) => detail(battle, u)).join('') + '</ul>' : ''}
      ${rounds.map((r) => '<h4>' + ui('第{round}轮', { round: r.round }) + '</h4><ul>' + r.changes.filter(meaningful).map((u) => detail(battle, u)).join('') + '</ul>').join('')}
      <p>${ui("只汇总观测到的变化；生命和人数分开累计。脱离视野期间的行动与战损不作推测。")}</p>
    </details></aside>`;
}
