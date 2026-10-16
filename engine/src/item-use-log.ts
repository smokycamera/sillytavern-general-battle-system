import type { Ability, BattleLogEntry, Combatant } from './types.js';

export type ItemUseLog = NonNullable<BattleLogEntry['itemUse']>;

/** 在扣费成功后建立回执；佩戴道具的被动效果不算主动使用。 */
export function itemUseLog(actor: Combatant, ability: Ability, consumed = 0): ItemUseLog | undefined {
  const id = ability.itemSourceId ?? ability.equipmentSourceId;
  if (!id) return;
  const carried = actor.carriedItems?.find(item => item.id === id);
  const gear = actor.gear?.find(item => item.id === id) ?? Object.values(actor.accessories ?? {}).find(item => item?.id === id);
  return { actorId: actor.id, actorName: actor.name, itemId: id,
    itemName: carried?.name ?? gear?.name ?? (ability.itemSourceId ? ability.name.replace(/^使用/, '') : ability.name),
    form: ability.itemSourceId ? 'single' : 'charged', consumed: ability.itemSourceId ? consumed : 0, effects: [] };
}

/** 会战效果延后执行：只捕获这一个道具对应的效果日志，不混入同阶段的其他技能。 */
export function captureItemEffects(log: BattleLogEntry[], item: ItemUseLog | undefined, apply: () => void): void {
  if (!item) { apply(); return; }
  const start = log.length;
  apply();
  for (let i = start; i < log.length; i++) item.effects.push(log[i]!.text);
}
