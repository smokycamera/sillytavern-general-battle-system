import { SmallBattle, type MassBattle, type Combatant, type Order } from '../../engine/src/index.js';
import { resolvePreparedSkills } from '../../engine/src/skill-catalog.js';

export function learnedSkills(unit: Combatant) {
  return unit.abilities.filter(a => !a.itemSourceId && !a.equipmentSourceId);
}

/** 施放列表只列已准备技能，物品与装备提供的能力不占技能位。 */
export function battleAbilities(unit: Combatant) {
  return unit.abilities.filter(a => unit.rulesVersion !== 'v2' || a.itemSourceId || a.equipmentSourceId || unit.preparedAbilityIds?.includes(a.id));
}

export function battleSkillChangeReason(battle: SmallBattle | MassBattle, unitId: string): string | undefined {
  if (battle.isOver()) return '战斗已结束，请先提交战果';
  const unit = battle.combatants.find(u => u.id === unitId);
  if (!unit || unit.rulesVersion !== 'v2' || unit.side !== 'ally' || unit.status !== 'ready') return '请选择可行动的我方参战单位';
  if (battle instanceof SmallBattle) {
    if (battle.active?.id !== unitId) return '轮到该单位行动时可更换技能';
    if (battle.actedThisTurn.has(unitId)) return '主行动已使用，下次行动前可更换技能';
  } else if (battle.planningLocked) return '本轮已锁定，下轮计划时可更换技能';
  return undefined;
}

export function removedSkillOrder(unitId: string, removed: Set<string>, order: Order): boolean {
  return order.type === 'ability' && (order.abilityActorId ?? order.unitId) === unitId && removed.has(order.abilityId ?? '');
}

/** 仅更换已学技能位；技能实例、冷却、次数、精力、行动与持续效果均保留。 */
export function setBattlePreparedSkills(battle: SmallBattle | MassBattle, unitId: string, selected: string[]): Set<string> {
  const reason = battleSkillChangeReason(battle, unitId); if (reason) throw Error(reason);
  const unit = battle.byId(unitId), learned = learnedSkills(unit);
  const prepared = resolvePreparedSkills(learned, selected);
  const removed = new Set(learned.filter(a => !prepared.includes(a.id)).map(a => a.id));
  unit.preparedAbilityIds = prepared;
  if (!(battle instanceof SmallBattle)) for (const [hostId, order] of battle.orders) {
    if (removedSkillOrder(unitId, removed, order)) battle.orders.set(hostId, { unitId: hostId, type: 'hold' });
  }
  return removed;
}
