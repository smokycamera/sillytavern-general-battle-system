import { describe, expect, it } from 'vitest';
import { WEAPON_CLASSES } from '../../engine/src/data/weapons.js';
import { generateUnit, grantTraitSource } from '../../engine/src/index.js';
import type { Combatant, Weapon } from '../../engine/src/types.js';
import { UNIT_ICON_NAMES, UNIT_ICONS, unitIcon, unitIconKey } from './unit-icons.js';

const weapon = (w: Partial<Weapon>) => w as Weapon;
const base = generateUnit({ name: '图标', side: 'ally', scale: 'hero', level: 1, rulesVersion: 'v2', weaponClass: 'sword', weaponLevel: 1, armorTier: 0, traits: [] }, { seed: 'unit-icons', noVariance: true }).unit;
const unit = (u: Partial<Combatant> = {}): Combatant => ({ ...base, weapon: undefined, ...u });

describe('unit icons', () => {
  it('gives every weapon class its own icon and name', () => {
    const keys = Object.keys(WEAPON_CLASSES).map(id => [id, unitIconKey(unit({ weapon: weapon({ recipe: { mechanism: id } as Weapon['recipe'] }) })), !!UNIT_ICONS[id], !!UNIT_ICON_NAMES[id]]);
    expect(keys).toEqual(Object.keys(WEAPON_CLASSES).map(id => [id, id, true, true]));
  });
  it('puts vehicle and mount first and keeps the legacy fallbacks', () => {
    const rocket = weapon({ recipe: { mechanism: 'rocket' } as Weapon['recipe'] });
    expect([
      unitIconKey(unit({ body: 'vehicle', mount: true, weapon: rocket })),
      unitIconKey(unit({ mount: true, weapon: rocket })),
      unitIconKey(unit({ weapon: weapon({ tags: ['mechanism:crossbow'] }) })),
      unitIconKey(unit({ weapon: weapon({ tags: ['ranged'] }) })),
      unitIconKey(unit({ weapon: weapon({ tags: [] }) })),
      unitIconKey(unit()),
    ]).toEqual(['vehicle', 'cavalry', 'crossbow', 'bow', 'sword', 'shield']);
  });
  it('uses the ship silhouette for active sailing, including vehicles and temporary grants', () => {
    const ship = unit({ body: 'vehicle', mount: true, traits: ['sailing'] });
    expect(unitIconKey(ship)).toBe('ship');
    expect(UNIT_ICON_NAMES.ship).toBe('船'); expect(unitIcon('ship')).toContain(UNIT_ICONS.ship);
    ship.traits = ['water-crossing']; expect(unitIconKey(ship)).toBe('vehicle');
    grantTraitSource(ship, { id: 'sail', kind: 'blessing', name: '舟行', traitIds: ['sailing'], duration: { kind: 'rounds', count: 2 } });
    expect(unitIconKey(ship)).toBe('vehicle');
    ship.traits = [];
    expect(unitIconKey(ship)).toBe('ship');
    ship.traitSources![0]!.remaining = 0; expect(unitIconKey(ship)).toBe('vehicle');
    ship.traitSources![0]!.remaining = 1; ship.traitSources![0]!.revoked = true; expect(unitIconKey(ship)).toBe('vehicle');
  });
  it('two water traits preserve the original vehicle, mount or weapon silhouette', () => {
    for (const [props, icon] of [[{ body: 'vehicle' }, 'vehicle'], [{ mount: true }, 'cavalry'], [{ weapon: base.weapon }, 'sword']] as const)
      expect(unitIconKey(unit({ ...props, traits: ['sailing', 'water-crossing'] }))).toBe(icon);
  });
});
