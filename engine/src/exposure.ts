import type { Combatant } from './types.js';
import type { BattlefieldSpec } from './small/spatial.js';
import { isAirborne } from './aerial.js';
import { isCohort, personnel, COHORT_REFERENCE } from './combat-model.js';

export const LEGACY_ENGAGEMENT_WIDTH = { ranged: 10, melee: 8, difficultPenalty: 2 } as const;
export const ENGAGEMENT_WIDTH = { ranged: 20, melee: 16, difficultPenalty: 4 } as const;
export function difficultEngagementDescription(model: Combatant['damageModel'] = 'wounds-v2'): string {
  const width = model === 'wounds-v2' ? ENGAGEMENT_WIDTH : LEGACY_ENGAGEMENT_WIDTH;
  return `武器交战展开减少${width.difficultPenalty}人（远程${width.ranged}→${width.ranged - width.difficultPenalty}，近战${width.melee}→${width.melee - width.difficultPenalty}）`;
}

/** 普通攻击和武器技法共用展开规则，困难地形限制不能被技能入口绕过。 */
export function engagementWidth(actor: Combatant, target: Combatant, ranged: boolean, field?: BattlefieldSpec, fieldTags: string[] = []): number {
  const constrained = [actor, target].some((u) => !isAirborne(u) && (field
    ? ['rough', 'forest', 'hill'].includes(field.tiles[u.pos!] ?? '') : fieldTags.some((tag) => tag === 'forest' || tag === 'mountain')));
  const width = actor.damageModel === 'wounds-v2' ? ENGAGEMENT_WIDTH : LEGACY_ENGAGEMENT_WIDTH;
  return (ranged ? width.ranged : width.melee) - (constrained ? width.difficultPenalty : 0);
}
/** 同阵位共用展开；V3按现员比例分配，旧规则继续按稳定id轮流分配。 */
export function sharedParticipants(actor: Combatant, cohort: Combatant[], width: number, target?: Combatant): number {
  if (actor.scale === 'hero') return 1;
  const units = [actor, ...cohort.filter((u) => u.id !== actor.id)].filter((u) => u.side === actor.side && u.status === 'ready' && u.scale !== 'hero').sort((a, b) => a.id.localeCompare(b.id));
  if(isCohort(actor)){
    const total=units.reduce((n,u)=>n+personnel(u),0);
    const throughput=width*(target?.scale==='hero'?1:Math.max(1,total/COHORT_REFERENCE));
    return total>0?Math.min(personnel(actor),throughput*personnel(actor)/total):0;
  }
  const assigned = new Map(units.map((u) => [u.id, 0]));
  let remaining = width;
  while (remaining > 0) {
    let placed = false;
    for (const u of units) if (remaining > 0 && assigned.get(u.id)! < Math.min(u.hp, 12)) { assigned.set(u.id, assigned.get(u.id)! + 1); remaining--; placed = true; }
    if (!placed) break;
  }
  return assigned.get(actor.id) ?? 0;
}
