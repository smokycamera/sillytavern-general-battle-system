import { LOAD_MODEL, revisedLoad } from '../../engine/src/load-model.js';
import { compileItem, type ItemMechanics, type ItemSpecification } from '../../engine/src/items.js';
import type { InventorySave } from './inventory-state.js';

/** Upgrade only a trustworthy recipe's default load. Other frozen stats stay intact. */
function migrateMechanics<T extends ItemMechanics>(mechanics: T): T {
  if (mechanics.kind === 'item') return mechanics;
  const value = mechanics.value, recipe = value.recipe;
  if (!recipe || revisedLoad(recipe) || value.loadOverride || value.load === undefined
    || !['mechanism-v2.1', 'mechanism-v2.2', 'mechanism-v2.3', 'mechanism-v2.3+autocannon-v2'].includes(recipe.version)) return mechanics;
  try {
    const spec: ItemSpecification = mechanics.kind === 'weapon'
      ? { kind: 'weapon', mechanism: recipe.mechanism, power: recipe.power }
      : mechanics.kind === 'armor' ? { kind: 'armor', tier: mechanics.value.tier, power: recipe.power }
        : { kind: 'shield', mechanism: recipe.mechanism as 'shield', power: recipe.power };
    if (mechanics.kind === 'armor' && recipe.mechanism !== `armor:${mechanics.value.tier}`) return mechanics;
    const originalSpec = { ...spec, body: recipe.size, quality: recipe.quality, bonuses: recipe.bonuses };
    const context = { id: value.id, name: 'name' in value ? value.name : undefined, seed: recipe.seed,
      numericModel: recipe.numericModel, variance: false as const, noVariance: true };
    const original = compileItem(originalSpec, context);
    if (original.kind === 'item' || original.value.load === undefined || !Number.isFinite(value.load)
      || Math.abs(value.load - original.value.load) > 1e-9 * Math.max(1, Math.abs(original.value.load))) return mechanics;
    const updated = compileItem(originalSpec, { ...context, loadModel: LOAD_MODEL });
    if (updated.kind === 'item') return mechanics;
    return { ...mechanics, value: { ...value, load: updated.value.load, recipe: { ...recipe, loadModel: LOAD_MODEL } } } as T;
  } catch { return mechanics; } // Unknown/incomplete recipes cannot establish the original default.
}

/** Copy on write; no battle, replay, report, or migration backup is rewritten. */
export function migrateOutOfBattleLoads<T extends InventorySave>(save: T): T {
  if (save.battle && !(save.committedOutcomeIds ?? []).includes(`${save.battle.kind}:${String(save.battle.snap.seed)}`)) return save;
  let changed = false;
  const inventory = save.inventory?.map(item => {
    const mechanics = item.mechanics && migrateMechanics(item.mechanics);
    if (mechanics === item.mechanics) return item;
    changed = true;
    return { ...item, mechanics, revision: (item.revision ?? 1) + 1 };
  });
  const byId = new Map(inventory?.map(item => [item.id, item]));
  const storage = save.storage?.map(record => {
    const unit = record.snapshot;
    if (!unit || unit.rulesVersion !== 'v2') return record;
    let next = unit;
    const update = (key: 'weapon' | 'sidearm' | 'armor' | 'shield') => {
      const previous = unit[key];
      if (!previous) return;
      const kind = key === 'sidearm' ? 'weapon' : key;
      // Update only load fields from the bound inventory instance.
      const item = record.equipmentManaged ? byId.get(previous.id) : undefined;
      const slot = key === 'weapon' ? 'primary' : key;
      const migrated = item?.equippedTo?.unitId === record.id && item.equippedTo.slot === slot && item.mechanics?.kind === kind ? item.mechanics
        : record.equipmentManaged ? undefined : migrateMechanics({ kind, value: previous } as ItemMechanics);
      if (!migrated || migrated.kind === 'item' || migrated.value === previous
        || previous.load === migrated.value.load && previous.recipe?.loadModel === migrated.value.recipe?.loadModel) return;
      if (next === unit) next = { ...unit };
      Object.assign(next, { [key]: { ...previous, load: migrated.value.load,
        ...(previous.recipe ? { recipe: { ...previous.recipe, loadModel: migrated.value.recipe?.loadModel } } : {}) } });
    };
    for (const key of ['weapon', 'sidearm', 'armor', 'shield'] as const) update(key);
    if (!revisedLoad(unit)) next = { ...next, loadModel: LOAD_MODEL };
    if (next === unit) return record;
    changed = true;
    return { ...record, snapshot: next, revision: (record.revision ?? 1) + 1 };
  });
  return changed ? { ...save, ...(inventory ? { inventory } : {}), ...(storage ? { storage } : {}), factRevision: (save.factRevision ?? 0) + 1 } : save;
}
