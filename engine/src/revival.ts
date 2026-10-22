import type { Combatant } from './types.js';
import { effectiveTraitLevel } from './trait-sources.js';
import { traitParameter } from './trait-parameters.js';
import { hasMemberHealth } from './member-health.js';
import { changeMorale, fullMorale } from './morale.js';
import { displayNumber } from './display-number.js';

/** 本场实到人数和已用次数独立于来源；卸装、重授和读档均不刷新。 */
export function prepareRevivalBattle(unit: Combatant, reset = false): void {
  if (unit.revivalModel !== 'revival-v1') { delete unit.revivalState; return; }
  if (reset || !unit.revivalState) unit.revivalState = { members: unit.hp > 0 ? unit.scale === 'hero' ? 1 : unit.hp : 0, used: 0 };
  const state = unit.revivalState;
  if (!Number.isSafeInteger(state.members) || state.members < 0 || state.members > (unit.scale === 'hero' ? 1 : unit.base.hpMax)
    || !Number.isSafeInteger(state.used) || state.used < 0 || state.used > 3) throw Error('复活次数或入场人数记录损坏');
}

/** 仅在实际伤害造成归零时调用；普通治疗、撤军和归档不会进入此处。 */
export function tryRevive(unit: Combatant): string | undefined {
  if (unit.revivalModel !== 'revival-v1' || unit.rulesVersion !== 'v2' || unit.hp > 0 || !['ready', 'routing'].includes(unit.status)) return;
  const state = unit.revivalState, level = effectiveTraitLevel(unit, 'revival');
  if (!state?.members || !level || state.used >= traitParameter('revivalUses', level)) return;
  const percent = traitParameter('revivalPercent', level);
  state.used++;
  if (unit.scale === 'hero') unit.hp = Math.max(1, Math.ceil(unit.base.hpMax * percent / 100));
  else if (hasMemberHealth(unit) && unit.formation) {
    const members = Math.min(state.members, unit.base.hpMax), full = Math.floor(members * percent / 100), fraction = members * percent % 100;
    const health = full ? [{ hp: unit.formation.memberHp, count: full }] : [];
    if (fraction) health.unshift({ hp: Math.max(1, Math.ceil(unit.formation.memberHp * fraction / 100)), count: 1 });
    unit.hp = full + (fraction ? 1 : 0);
    unit.formation.members = unit.hp;
    unit.formation.health = health;
    unit.formation.woundedRemainder = 0;
  } else {
    unit.hp = Math.max(1, Math.ceil(Math.min(state.members, unit.base.hpMax) * percent / 100));
    if (unit.formation) unit.formation.members = unit.hp;
  }
  if (unit.recoverableWounded !== undefined) unit.recoverableWounded = Math.min(Math.max(0, unit.recoverableWounded - (unit.scale === 'hero' ? 0 : unit.hp)), unit.base.hpMax - unit.hp);
  unit.woundedPercentRemainder = 0;
  unit.status = unit.moraleState?.forcedRetreat ? 'routing' : 'ready';
  if (unit.moraleState) { unit.moraleState.damage = 0; unit.moraleState.damagePenalty = 0; delete unit.moraleState.cause; }
  changeMorale(unit, Math.max(0, Math.ceil(fullMorale(unit) / 2) - (unit.morale ?? unit.moraleState?.personal ?? fullMorale(unit))));
  return `${unit.name} 复活，恢复至${displayNumber(unit.hp)}${unit.scale === 'hero' ? '生命' : unit.body === 'vehicle' ? '辆' : '人'}${percent === 100 ? '，满血复生' : ''}（本场剩余${Math.max(0, traitParameter('revivalUses', level) - state.used)}次）`;
}
