import { describe, expect, it } from 'vitest';
import { WEAPON_CLASSES } from '../../engine/src/data/weapons.js';
import type { Weapon } from '../../engine/src/types.js';
import { UNIT_ICON_NAMES, UNIT_ICONS, unitIconKey } from './unit-icons.js';

const weapon = (w: Partial<Weapon>) => w as Weapon;

describe('unit icons', () => {
  it('gives every weapon class its own icon and name', () => {
    const keys = Object.keys(WEAPON_CLASSES).map(id => [id, unitIconKey({ weapon: weapon({ recipe: { mechanism: id } as Weapon['recipe'] }) }), !!UNIT_ICONS[id], !!UNIT_ICON_NAMES[id]]);
    expect(keys).toEqual(Object.keys(WEAPON_CLASSES).map(id => [id, id, true, true]));
  });
  it('puts vehicle and mount first and keeps the legacy fallbacks', () => {
    const rocket = weapon({ recipe: { mechanism: 'rocket' } as Weapon['recipe'] });
    expect([
      unitIconKey({ body: 'vehicle', mount: true, weapon: rocket }),
      unitIconKey({ mount: true, weapon: rocket }),
      unitIconKey({ weapon: weapon({ tags: ['mechanism:crossbow'] }) }),
      unitIconKey({ weapon: weapon({ tags: ['ranged'] }) }),
      unitIconKey({ weapon: weapon({ tags: [] }) }),
      unitIconKey({}),
    ]).toEqual(['vehicle', 'cavalry', 'crossbow', 'bow', 'sword', 'shield']);
  });
});
