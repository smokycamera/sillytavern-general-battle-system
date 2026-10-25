import type { BattlefieldSpec } from './spatial.js';
import { neighbors } from './spatial.js';
import { groundBlocked } from './layers.js';

/** Older named outdoor buildings reused non-walkable indoor partitions for their perimeter. */
export function restoreOutdoorWallPlatforms(field: BattlefieldSpec): void {
  if (!field.layerVersion || !field.structures || !field.generation?.scene
    || ['interior', 'building_siege'].includes(field.generation.scene)) return;
  const repaired = new Set<number>();
  for (const region of field.scene?.regions ?? []) {
    if (region.kind !== 'building') continue;
    const floor = new Set(region.cells);
    for (let p = 0; p < field.structures.length; p++) {
      const s = field.structures[p];
      if (!s || s.entityId !== region.id || s.top !== false || !['wall', 'gate'].includes(s.kind)) continue;
      s.top = true; s.platformHeight ??= 1;
      s.access = neighbors(field, p).filter(n => floor.has(n) && !groundBlocked(field, n));
      repaired.add(p);
    }
  }
  if (repaired.size) {
    // A former ground-side access cell may now be a connected wall top.
    for (const s of field.structures) if (s?.access?.some(p => repaired.has(p)))
      s.access = s.access.filter(p => !repaired.has(p));
    field.terrainRevision = (field.terrainRevision ?? 0) + 1;
  }
}
