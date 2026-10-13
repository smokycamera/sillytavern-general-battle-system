/**
 * 依赖战场其他单位的特质修正，小战与会战的攻击环境共用，预览与实际结算一致。
 * - 偷袭：从潜伏中出手，或目标正与己方另一单位近战时，武器与物理技能伤害×1.5。
 * - 侦察校射：己方曲射火力攻击侦察单位看得见的目标时命中+2，多名侦察不叠加。
 */
import type { Combatant, Weapon } from './types.js';
import type { Modifier } from './bonus.js';
import { activeTraitIds } from './trait-sources.js';
import { canSpot, type ObservationContext } from './observation.js';

export interface SituationalInput {
  /** 出手前是否仍在潜伏；实际结算须在暴露前读取。 */
  ambush: boolean;
  /** 目标是否正与出手方以外的己方单位近战（按各自战场几何判断）。 */
  flanked: () => boolean;
  magic: boolean;
  ranged: boolean;
  weapon?: Weapon;
}
export function situationalTraitMods(context: ObservationContext, attacker: Combatant, target: Combatant, input: SituationalInput): Modifier[] {
  if (attacker.rulesVersion !== 'v2' || attacker.side === target.side) return [];
  const out: Modifier[] = [];
  if (!input.magic && activeTraitIds(attacker).includes('sneak-attack') && (input.ambush || input.flanked()))
    out.push({ source: 'stance', sourceId: 'sneak-attack', name: input.ambush ? '偷袭·潜伏出手' : '偷袭·趁敌缠斗', kind: 'dmg', type: 'mult', value: 1.5 });
  if (input.ranged && input.weapon?.indirect && context.units.some((u) => u.side === attacker.side && u.status === 'ready' && u.rulesVersion === 'v2'
    && activeTraitIds(u).includes('recon') && canSpot(context, u, target)))
    out.push({ source: 'stance', sourceId: 'recon:spotting', name: '侦察校射', kind: 'atk', type: 'flat', value: 2 });
  return out;
}
