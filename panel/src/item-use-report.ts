import type { BattleLogEntry, Combatant } from '../../engine/src/types.js';
import type { ItemUseLog } from '../../engine/src/item-use-log.js';
import { compactEvents, compactFactLine } from '../../engine/src/inject/format.js';

interface ItemRow extends Omit<ItemUseLog, 'consumed'> { uses: number; consumed?: number }

/** 优先读使用当时的回执；旧档只补可核实的次数、消耗和明确署名的效果日志。 */
export function itemUseReport(units: Combatant[], log: BattleLogEntry[]): string[] {
  const rows = new Map<string, ItemRow>(), key = (actorId: string, itemId: string) => JSON.stringify([actorId, itemId]);
  for (const event of log) {
    const item = event.itemUse;
    if (!item) continue;
    const id = key(item.actorId, item.itemId), row = rows.get(id) ?? { ...item, uses: 0, consumed: 0, effects: [] };
    row.uses++; row.consumed = (row.consumed ?? 0) + item.consumed;
    const effects = item.effects.flatMap(effect => effect.split('\n')).map(compactFactLine).filter(Boolean);
    if (effects.length) row.effects.push(`第${event.round}轮：${effects.join('；')}`);
    rows.set(id, row);
  }
  for (const actor of units) for (const ability of actor.abilities) {
    const id = ability.itemSourceId ?? ability.equipmentSourceId;
    const used = actor.abilityState.find(state => state.abilityId === ability.id)?.used ?? 0;
    if (!id || used <= 0) continue;
    const rowId = key(actor.id, id), recorded = rows.get(rowId);
    if (recorded && recorded.uses >= used) continue;
    const carried = actor.carriedItems?.find(item => item.id === id);
    const gear = actor.gear?.find(item => item.id === id) ?? Object.values(actor.accessories ?? {}).find(item => item?.id === id);
    const remaining = ability.cost && actor.resources[ability.cost.resource];
    const consumed = carried && typeof remaining === 'number' && Number.isSafeInteger(remaining) && remaining >= 0 && remaining <= carried.quantity
      ? carried.quantity - remaining : undefined;
    const effects = log.filter(event => !event.itemUse && event.kind === 'ability' && event.participants?.[0] === actor.id
      && event.text.includes(`使用【${ability.name}】`)).flatMap(event => { const text = compactEvents([event]).join('；'); return text ? [`第${event.round}轮：${text}`] : []; });
    rows.set(rowId, { actorId: actor.id, actorName: actor.name, itemId: id,
      itemName: carried?.name ?? gear?.name ?? (ability.itemSourceId ? ability.name.replace(/^使用/, '') : ability.name),
      form: ability.itemSourceId ? 'single' : 'charged', uses: used,
      consumed: consumed ?? recorded?.consumed, effects: [...(recorded?.effects ?? []), ...effects] });
  }
  return [...rows.values()].flatMap(row => [
    `${row.actorName} 使用【${row.itemName}】：共${row.uses}次，${row.form === 'charged' ? '使用充能，不消耗道具本体' : row.consumed === undefined ? '消耗数量未记录' : `消耗${row.consumed}件`}。`,
    ...(row.effects.length ? row.effects.map(effect => '效果：' + effect) : ['效果：实际结算详情未记录，不推测治疗量、伤害或状态效果。']),
  ]);
}
