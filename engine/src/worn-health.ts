import type { Combatant } from './types.js';
import { wornEffects } from './gear-bonuses.js';
import { setMemberMaximum } from './member-health.js';
import { capSingleLife } from './health-limits.js';
import { STACKING_MODEL } from './progression.js';

/** 生命佩戴品同步增减当前生命与上限；脱下时活着的个体/成员最低保留1生命。 */
export function syncWornHealth(unit: Combatant, enabled = unit.enhancementModel === 'channels-life-v1'): void {
  if (unit.rulesVersion !== 'v2') return;
  const previous = unit.wornHealthState?.amount ?? 0;
  if (!Number.isFinite(previous)) throw Error('佩戴生命记录损坏');
  const ratio = enabled ? wornEffects({ ...unit, traitLevelModel: STACKING_MODEL }).health ?? 0 : 0;
  if (!previous && !ratio) { delete unit.wornHealthState; return; }
  const maximum = unit.scale === 'hero' ? unit.base.hpMax : unit.formation?.memberHp;
  if (maximum === undefined) return;
  const base = Math.max(1, maximum - previous);
  const next = capSingleLife(Math.max(1, Math.round(base * (1 + ratio))), unit.damageModel);
  const delta = next - maximum;
  if (unit.scale === 'hero') { unit.base.hpMax = next; if (unit.hp > 0) unit.hp = Math.max(1, Math.min(next, unit.hp + delta)); }
  else {
    if (unit.formation?.health) unit.formation.health = unit.formation.health.map(group => ({ ...group, hp: Math.max(1, Math.min(next, group.hp + delta)) }));
    setMemberMaximum(unit, next);
  }
  if (enabled && next !== base) unit.wornHealthState = { amount: next - base };
  else delete unit.wornHealthState;
}
