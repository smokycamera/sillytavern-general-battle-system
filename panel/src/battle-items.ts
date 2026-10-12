import { attachCarriedItems, carriedItemAbility, migrateLegacyItem, isLegacyItemMechanics, type CarriedItem, type Combatant, type LegacyItemMechanics } from '../../engine/src/index.js';
import { migrateLegacyInventory, type InventorySave } from './inventory-state.js';

/** 只有实际分配给参战者的一次性道具能携行；公共库存不自动复制给全队。 */
export function prepareBattleItems(units: Combatant[], save: InventorySave): Combatant[] {
  const inventory = migrateLegacyInventory(save.inventory) ?? [];
  return units.map((unit) => attachCarriedItems(unit, inventory.flatMap((item): CarriedItem[] =>
    item.assignedTo === unit.id && item.qty > 0 && item.mechanics?.kind === 'item' && item.mechanics.value.recipe.form === 'single'
      ? [{ id: item.id, name: item.name, quantity: item.qty, revision: item.revision ?? 1, mechanics: item.mechanics }] : [])));
}
function actionDefinition(action: ReturnType<typeof carriedItemAbility>) { const {name:_name,desc:_desc,category:_category,...definition}=action;return JSON.stringify(definition); }
/** 旧版携行记录按库存同一对照表转换；行动取快照里已经编译好的那份。 */
function carriedRecord(actor: Combatant, item: CarriedItem): CarriedItem {
  if (!isLegacyItemMechanics(item.mechanics as { kind?: unknown })) return item;
  const action = item.action ?? actor.abilities.find((a) => a.itemSourceId === item.id);
  return { ...item, mechanics: migrateLegacyItem(item.mechanics as LegacyItemMechanics, item.name, item.id), ...(action ? { action: structuredClone(action) } : {}) };
}
function ledger(save: InventorySave): Map<string, { item: CarriedItem; actorId: string; left: number }> {
  const result = new Map<string, { item: CarriedItem; actorId: string; left: number }>();
  const units = save.battle?.snap.combatants as Combatant[] | undefined;
  for (const actor of units ?? []) {
    for (const raw of actor.carriedItems ?? []) {
      const item = carriedRecord(actor, raw);
      const action = carriedItemAbility(item), left = actor.resources[action.cost!.resource];
      const actual = actor.abilities.find((a) => a.itemSourceId === item.id);
      const used = actor.abilityState.find((s) => s.abilityId === action.id)?.used ?? 0;
      const consumed = item.quantity - (left ?? 0);
      // 编队一次齐用可以消耗多件：使用次数不超过消耗的件数，用过才有消耗。
      if (result.has(item.id) || !Number.isSafeInteger(left) || left! < 0 || left! > item.quantity
        || used > consumed || consumed > 0 && used < 1 || (!actual || actionDefinition(actual) !== actionDefinition(action))) throw new Error('战内物品来源/次数或行动定义损坏');
      result.set(item.id, { item, actorId: actor.id, left: left! });
    }
    if (actor.abilities.some((a) => a.itemSourceId && !actor.carriedItems?.some((i) => i.id === a.itemSourceId))) throw new Error('物品行动缺少实物来源');
  }
  return result;
}
/** 从新旧引擎快照差额扣实物，与该次行动和生命变化在同一次保存中生效。 */
export function prepareBattleItemWrite(previous: InventorySave, next: InventorySave): InventorySave {
  if (!next.battle) return next;
  const sameBattle = previous.battle?.kind === next.battle.kind && previous.battle?.snap.seed === next.battle.snap.seed;
  // 已归档快照只用于旧战报；后续战外用药/获得不能被旧快照重新结算。
  if (sameBattle && (previous.committedOutcomeIds ?? []).includes(`${next.battle.kind}:${String(next.battle.snap.seed)}`)) return next;
  const old = sameBattle ? ledger(previous) : new Map<string, { item: CarriedItem; actorId: string; left: number }>();
  const current = ledger(next), output = structuredClone(next);
  output.inventory = migrateLegacyInventory(output.inventory);
  const previousInventory = migrateLegacyInventory(previous.inventory) ?? [];
  if (sameBattle && [...old.keys()].some((id) => !current.has(id))) throw new Error('进行中战斗不能移除物品来源记录');
  for (const [id, entry] of current) {
    const before = old.get(id), item = previousInventory.find((i) => i.id === id);
    if (sameBattle && !before || before && (before.actorId !== entry.actorId || JSON.stringify(before.item) !== JSON.stringify(entry.item))) throw new Error('进行中战斗不能补发或修改携行物品');
    if (!item || item.assignedTo !== entry.actorId || item.name !== entry.item.name || (item.revision ?? 1) !== entry.item.revision
      || JSON.stringify(item.mechanics) !== JSON.stringify(entry.item.mechanics)) throw new Error('战内物品与库存来源不一致');
    const available = before?.left ?? entry.item.quantity, spent = available - entry.left;
    if (item.qty !== available || spent < 0 || spent > item.qty) throw new Error('物品数量不能恢复或超额消耗');
    output.inventory!.find((i) => i.id === id)!.qty -= spent;
  }
  return output;
}
