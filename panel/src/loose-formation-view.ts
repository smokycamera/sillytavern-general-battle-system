import { looseFormation } from '../../engine/src/tactics.js';
import { phase2Value } from '../../engine/src/phase2-traits.js';
import { traitPrerequisiteReason } from '../../engine/src/trait-sources.js';
import type { Combatant } from '../../engine/src/types.js';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** 散兵的疏散/收拢选择：按钮写明效果，下方显示当前状态与按散兵等级换算的数值。小战与会战共用。 */
export function looseFormationChoiceHtml(actor: Combatant, disabled: boolean, timing: string): string {
  const pct = Math.round(phase2Value(actor, 'loose-formation', 'formationReduction', .5) * 100), group = actor.scale !== 'hero';
  const loose = `未被近敌贴身时受到的范围伤害−${pct}%` + (group ? `、榴弹溅射波及人数−${pct}%；代价是近战只展开一半人数、近战防御−1` : '');
  const closed = group ? '取消疏散的减免与代价，被贴身肉搏时更稳' : '取消范围伤害减免';
  const choice = actor.looseFormationChoice ?? 'loose';
  const blocked = choice === 'loose' && !looseFormation(actor)
    ? traitPrerequisiteReason(actor, 'loose-formation') ?? (actor.tacticalPose ? '固守时收拢' : actor.suppression ? '受压制' : '失能或人数不足') : undefined;
  const now = choice === 'closed' ? '当前：收拢。' : blocked ? `当前：疏散，暂不生效（${blocked}）。` : '当前：疏散，生效中。';
  const button = (value: 'loose' | 'closed', label: string, effect: string) =>
    `<button data-action="trait-formation-choice" data-unit="${esc(actor.id)}" data-choice="${value}" aria-pressed="${choice === value}" title="${esc(label + '：' + effect)}"${disabled ? ' disabled' : ''}>${label}</button>`;
  return `<div class="formation-choice" aria-label="散兵阵形">${button('loose', '疏散', loose)}${button('closed', '收拢', closed)}`
    + `<small>${esc(now + (choice === 'closed' ? '收拢：' + closed : '疏散：' + loose))}。${esc(actor.looseChoiceLocked ? '本次已选定，下次正常激活可再改。' : timing)}</small></div>`;
}
