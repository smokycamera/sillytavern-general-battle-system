import { validateRides, type PlatformUnit } from '../../engine/src/platforms.js';
import type { UnitRecord } from './unit-state.js';

export function platformUnits(records: UnitRecord[]): PlatformUnit[] {
  return records.filter(r => !r.retired).map(r => ({
    id:r.id, name:r.name, hp:r.hp, scale:r.scale, side:r.side, body:r.snapshot?.body,
    platform:r.snapshot?.platform, seats:r.snapshot?.seats, ride:r.snapshot?.ride,
  }));
}
export function platformRoster(records: UnitRecord[], roster: string[]): string[] {
  if (!records.some(r => r.snapshot?.platform || r.snapshot?.ride || r.snapshot?.seats !== undefined)) return roster;
  const units = platformUnits(records);
  validateRides(units,true);
  const selected = new Set(roster);
  for (const unit of units) if (selected.has(unit.id) && unit.ride) selected.add(unit.ride.platformId);
  return [...selected];
}
