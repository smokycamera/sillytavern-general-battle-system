import { nameClassHint, WEAPON_CLASSES, SHIELD_CLASSES, type ShieldClass } from '../../engine/src/data/weapons.js';
import { prepareInventoryState, prepareInventoryTransaction, type InventoryItem, type InventorySave } from './inventory-state.js';

export function classMigrationCandidates(save: InventorySave): { item: InventoryItem; mechanism: string; from: string; to: string; owner: string }[] {
  if (save.classMigration === 'arms-v2') return [];
  const prepared = prepareInventoryState({ ...save, battle: null });
  return prepared.inventory!.flatMap(item => {
    const m = item.mechanics;
    if (!item.qty || !m || m.kind !== 'weapon' && m.kind !== 'shield') return [];
    const mechanism = nameClassHint(item.name), current = m.value.recipe?.mechanism ?? (m.kind === 'shield' ? 'shield' : '');
    if (!mechanism || current === mechanism || !m.value.recipe || (m.kind === 'shield') !== Object.hasOwn(SHIELD_CLASSES, mechanism)) return [];
    const label = (id: string) => WEAPON_CLASSES[id]?.name ?? SHIELD_CLASSES[id as ShieldClass].name;
    return [{ item, mechanism, from: label(current), to: label(mechanism), owner: prepared.storage!.find(r => r.id === item.equippedTo?.unitId)?.name ?? '库存' }];
  });
}
export function prepareClassMigration(save: InventorySave, selected: string[], id: string): InventorySave {
  const candidates = classMigrationCandidates(save);
  if (save.classMigration || selected.some(itemId => !candidates.some(c => c.item.id === itemId))) throw Error('类别更新已变化，请重新查看');
  const original = structuredClone(save);
  let next = prepareInventoryState({ ...save, battle: null });
  for (const candidate of candidates.filter(c => selected.includes(c.item.id))) {
    const m = candidate.item.mechanics!;
    if (m.kind !== 'weapon' && m.kind !== 'shield') continue;
    const r = m.value.recipe!;
    next = prepareInventoryTransaction(next, { kind: 'reforge', itemId: candidate.item.id, id: id + ':' + candidate.item.id, expectedRevision: next.factRevision ?? 0,
      spec: { kind: m.kind, mechanism: candidate.mechanism, power: r.power, bonuses: r.bonuses, quality: r.quality, body: r.size } as import('../../engine/src/items.js').ItemSpecification });
  }
  return { ...next, battle: original.battle, classMigration: 'arms-v2', factRevision: (save.factRevision ?? 0) + 1,
    migrationBackups: [...(Array.isArray(original.migrationBackups) ? original.migrationBackups : []), { createdAt: new Date().toISOString(), source: { ...original, migrationBackups: undefined } }] };
}
