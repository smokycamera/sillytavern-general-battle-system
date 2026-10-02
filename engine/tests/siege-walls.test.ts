import { describe, it, expect } from 'vitest';
import { generatedLayeredField, generateUnit, groundBlocked, intactStructure, damageStructure, SmallBattle, V11_OVERFLOW_D20,
  type BattlefieldPlan, type BattlefieldSpec, type Combatant } from '../src/index.js';
import { regionalOrder } from '../src/small/team-tactics.js';

function unit(id: string, side: 'ally' | 'enemy'): Combatant {
  const u = generateUnit({ name: id, side, scale: 'hero', rulesVersion: 'v2', level: 3, weaponClass: 'blunt', weaponLevel: 3, traits: [] }, { seed: id, noVariance: true }).unit;
  u.id = id; u.morale = u.base.moraleMax = 100; return u;
}
const roster = () => [unit('a1', 'ally'), unit('a2', 'ally'), unit('a3', 'ally'), unit('e1', 'enemy'), unit('e2', 'enemy'), unit('e3', 'enemy')];
function siege(plan: BattlefieldPlan, seed: string, attackingSide: 'ally' | 'enemy' = 'ally', units = roster()): BattlefieldSpec {
  return generatedLayeredField(seed, 7, 13, ['siege'], { roster: units, attackingSide, plan: { scene: 'city_siege', ...plan } });
}
/** Ground reachable on foot from outside the walls, with every gate as generated. */
function outsideReach(field: BattlefieldSpec): Set<number> {
  const city = new Set([...field.city!.inside, ...field.city!.frontline]);
  const seen = new Set(field.tiles.map((_, p) => p).filter(p => !city.has(p) && !groundBlocked(field, p))), queue = [...seen];
  while (queue.length) {
    const p = queue.pop()!;
    for (const n of [p - field.width, p + field.width, p % field.width ? p - 1 : -1, p % field.width < field.width - 1 ? p + 1 : -1])
      if (n >= 0 && n < field.tiles.length && !seen.has(n) && !groundBlocked(field, n)) { seen.add(n); queue.push(n); }
  }
  return seen;
}
const xy = (field: BattlefieldSpec, p: number) => [p % field.width, Math.floor(p / field.width)] as const;
const POSITIONS = ['north', 'south', 'east', 'west', 'north_east', 'north_west', 'south_east', 'south_west', 'center'] as const;
const LAYOUTS: [string, BattlefieldPlan][] = [['front', { shape: 'front' }], ['ring', { shape: 'enclosure' }], ['double', { wallLayers: 2 }], ['unstated', {}]];

describe('siege walls close the city', () => {
  it.each(POSITIONS.flatMap(at => LAYOUTS.map(([name, plan]) => [at, name, plan] as const)))('a %s city with %s walls cannot be walked into', (at, _name, plan) => {
    for (const attackingSide of ['ally', 'enemy'] as const) for (const size of ['compact', 'large'] as const) {
      const field = siege({ ...plan, cityPosition: at, size }, `sealed-${at}-${size}-${attackingSide}`, attackingSide), reach = outsideReach(field);
      expect(field.city!.inside.filter(p => reach.has(p)), `${at}/${size}/${attackingSide}`).toEqual([]);
      for (const [id, start] of Object.entries(field.initialDeployment!)) {
        const inCity = field.city!.inside.includes(start.pos) || field.city!.frontline.includes(start.pos);
        expect(inCity, id).toBe(id.startsWith(attackingSide === 'ally' ? 'e' : 'a'));
      }
      // The assault can still reach the outer wall.
      expect(field.city!.frontage!.some(p => [p - 1, p + 1, p - field.width, p + field.width].some(n => reach.has(n)))).toBe(true);
    }
  });
  it('a front city runs off the map behind its wall; a corner city is walled on both open sides; a ring stands clear of the edges', () => {
    const front = siege({ shape: 'front', cityPosition: 'north' }, 'front-north'), wallRow = Math.max(...front.city!.frontline.map(p => xy(front, p)[1]));
    expect(front.city!.frontline.map(p => xy(front, p)[1]).every(y => y === wallRow)).toBe(true);
    expect(front.city!.frontline).toHaveLength(front.width);
    expect(front.city!.inside.some(p => xy(front, p)[1] === 0)).toBe(true);
    const corner = siege({ shape: 'front', cityPosition: 'north_east' }, 'front-corner'), cells = corner.city!.frontline.map(p => xy(corner, p));
    const left = Math.min(...cells.map(([x]) => x)), bottom = Math.max(...cells.map(([, y]) => y));
    expect(cells.every(([x, y]) => x === left || y === bottom)).toBe(true);
    expect(cells.some(([x, y]) => x === left && y === 0) && cells.some(([x, y]) => y === bottom && x === corner.width - 1)).toBe(true);
    const ring = siege({ shape: 'enclosure', cityPosition: 'north' }, 'ring-north');
    expect(ring.city!.shape).toBe('enclosure');
    expect([...ring.city!.inside, ...ring.city!.frontline].some(p => { const [x, y] = xy(ring, p); return x === 0 || y === 0 || x === ring.width - 1; })).toBe(false);
  });
  it('two walls leave a passage, pair every outer gate with an inner one, climb each wall from its shielded side and keep the core behind both', () => {
    for (const at of ['north', 'east', 'north_east', 'center'] as const) {
      const field = siege({ wallLayers: 2, cityPosition: at, size: 'large', gatePlan: [{ sector: 'front_center', state: 'destroyed' }, { sector: 'front_left', state: 'closed' }] }, 'double-' + at);
      const city = field.city!, terrace = new Set(city.terrace), gates = field.structures!.flatMap((s, p) => s?.kind === 'gate' ? [p] : []);
      expect(terrace.size, at).toBeGreaterThan(0);
      expect(city.gates).toHaveLength(2); expect(gates).toHaveLength(4);
      // The outer gate fell, its inner partner still holds.
      expect(gates.filter(p => !city.gates.includes(p)).every(p => field.structures![p]!.gateState === 'closed')).toBe(true);
      const outer = (p: number) => [p - 1, p + 1, p - field.width, p + field.width].some(n => n >= 0 && n < field.tiles.length && Math.abs(n % field.width - p % field.width) <= 1
        && !city.inside.includes(n) && !city.frontline.includes(n));
      for (const p of city.frontline) {
        const stairs = field.structures![p]!.access ?? [];
        expect(stairs.every(q => outer(p) ? terrace.has(q) : city.inside.includes(q) && !terrace.has(q)), `${at}:${p}`).toBe(true);
      }
      expect(city.core.some(p => terrace.has(p))).toBe(false);
      // Behind the fallen outer gate the passage is open ground, but the town is not.
      const reach = outsideReach(field);
      expect([...terrace].some(p => reach.has(p))).toBe(true);
      expect(city.inside.filter(p => !terrace.has(p)).some(p => reach.has(p))).toBe(false);
    }
  });
  it('outer wall stairs lead down to the passage and inner wall stairs to the town', () => {
    const field = siege({ wallLayers: 2, cityPosition: 'north' }, 'stairs'), city = field.city!, terrace = new Set(city.terrace);
    const outer = city.frontline.filter(p => city.frontage!.includes(p)), inner = city.frontline.filter(p => !city.frontage!.includes(p));
    expect(outer.flatMap(p => field.structures![p]!.access ?? []).every(q => terrace.has(q))).toBe(true);
    expect(inner.flatMap(p => field.structures![p]!.access ?? []).every(q => !terrace.has(q) && city.inside.includes(q))).toBe(true);
  });
  it('an unstated layout varies with the seed and a stated one is kept', () => {
    const kinds = new Set(Array.from({ length: 24 }, (_, i) => { const c = siege({ cityPosition: 'north' }, 'vary-' + i).city!; return c.shape + (c.terrace ? '+2' : ''); }));
    expect([...kinds].sort()).toEqual(['enclosure', 'front', 'front+2']);
    for (let i = 0; i < 6; i++) expect(siege({ shape: 'front', cityPosition: 'north' }, 'kept-' + i).city!.shape).toBe('front');
  });
  it('a gate named for a side opens through the wall on that side', () => {
    const field = siege({ shape: 'enclosure', cityPosition: 'south', gatePlan: [{ sector: 'north', state: 'closed' }, { sector: 'east', state: 'closed' }] }, 'sided-gates', 'enemy');
    const city = new Set([...field.city!.inside, ...field.city!.frontline]), [north, east] = field.city!.gates;
    expect(city.has(north! - field.width)).toBe(false); expect(city.has(north! + field.width)).toBe(true);
    expect(city.has(east! + 1)).toBe(false); expect(city.has(east! - 1)).toBe(true);
  });
  it('a garrison mans the face toward the assault, of a ring or of two walls, and nobody starts in a ford', () => {
    const units = [...roster(), unit('e4', 'enemy'), unit('e5', 'enemy'), unit('e6', 'enemy')];
    for (const [name, plan] of [['ring', { shape: 'enclosure' }], ['double', { wallLayers: 2 }]] as const) for (const seed of ['manned-1', 'manned-2', 'manned-3']) {
      const field = siege({ ...plan, cityPosition: 'south', water: 'river', bridgePlan: [], deployments: [{ subject: 'ally', at: ['north'] }, { subject: 'enemy', at: ['south'], post: 'wall' }] }, `${seed}-${name}`, 'ally', units);
      const city = field.city!, rows = [...city.inside, ...city.frontline].map(p => xy(field, p)[1]), middle = (Math.min(...rows) + Math.max(...rows)) / 2;
      const manned = Object.entries(field.initialDeployment!).filter(([id, d]) => id.startsWith('e') && d.elevation === 1);
      expect(manned.length, name).toBeGreaterThan(0);
      for (const [id, d] of manned) expect(xy(field, d.pos)[1], `${name}/${seed}/${id}`).toBeLessThan(middle);
      expect(Object.values(field.initialDeployment!).some(d => field.tiles[d.pos] === 'shallow_water'), `${name}/${seed}`).toBe(false);
    }
  });
  it('a map too small for two walls falls back to one and says so', () => {
    const field = siege({ wallLayers: 2, shape: 'enclosure', cityPosition: 'north', size: 'compact' }, 'tight', 'ally', roster().slice(0, 4));
    expect(field.city!.terrace).toBeUndefined();
    expect(field.generation!.notes).toContain('战区放不下两重城墙，改为一道城墙');
  });
});

describe('water before the walls', () => {
  it('a moat runs one cell out from the wall with its bridges in front of the gates', () => {
    const field = siege({ shape: 'front', cityPosition: 'north', water: 'moat', gatePlan: [{ sector: 'front_left', state: 'closed' }, { sector: 'front_right', state: 'closed' }] }, 'moat');
    const wallRow = xy(field, field.city!.frontage![0]!)[1], moat = field.tiles.flatMap((t, p) => t === 'deep_water' || field.structures![p]?.kind === 'bridge' ? [p] : []);
    expect(new Set(moat.map(p => xy(field, p)[1]))).toEqual(new Set([wallRow + 2]));
    const bridges = field.structures!.flatMap((s, p) => s?.kind === 'bridge' ? [xy(field, p)[0]] : []).sort((a, b) => a - b);
    expect(bridges).toEqual(field.city!.gates.map(p => xy(field, p)[0]).sort((a, b) => a - b));
  });
  it('a moat or river without a standing bridge keeps one fordable stretch, before the gate', () => {
    for (const water of ['moat', 'river'] as const) {
      const field = siege({ shape: 'front', cityPosition: 'north', water, bridgePlan: [] }, 'no-bridge-' + water);
      const ford = field.tiles.flatMap((t, p) => t === 'shallow_water' ? [p] : []);
      expect(ford, water).toHaveLength(2);
      if (water === 'moat') expect(ford.map(p => xy(field, p)[0])).toContain(xy(field, field.city!.gates[0]!)[0]);
      const reach = outsideReach(field), attackers = Object.entries(field.initialDeployment!).filter(([id]) => id.startsWith('a'));
      expect(attackers.every(([, d]) => reach.has(d.pos))).toBe(true);
      expect(field.city!.frontage!.some(p => [p - field.width, p + field.width].some(n => reach.has(n)))).toBe(true);
    }
  });
});

describe('an assault through two walls', () => {
  function breached() {
    const field = siege({ wallLayers: 2, cityPosition: 'north', size: 'large' }, 'assault'), city = field.city!;
    const outerGate = city.gates[0]!, innerGate = field.structures!.findIndex((s, p) => s?.kind === 'gate' && p !== outerGate);
    const passage = city.terrace!.find(p => [outerGate, innerGate].every(g => Math.abs(g - p) === field.width))!;
    return { field, city, outerGate, innerGate, passage };
  }
  it('attackers in the passage go for the inner wall, never back to the outer one', () => {
    const { field, city, outerGate, passage } = breached();
    damageStructure(field, outerGate, 1e9);
    const attacker = unit('a1', 'ally'), defender = unit('e1', 'enemy');
    defender.pos = city.core[0]; attacker.pos = passage + 2;
    const order = regionalOrder(field, attacker, [attacker, defender], { ability: 'expert', style: 'siege' })!;
    expect(city.frontage).not.toContain(order.breach);
    expect(city.frontline).toContain(order.breach);
    expect(order.goals.every(p => city.terrace!.includes(p))).toBe(true);
    // From the field the outer wall is still the one in the way.
    attacker.pos = outerGate + 3 * field.width;
    field.structures![outerGate] = { ...field.structures![outerGate]!, hp: field.structures![outerGate]!.hpMax, gateState: 'closed' };
    const outside = regionalOrder(field, attacker, [attacker, defender], { ability: 'expert', style: 'siege' })!;
    expect(city.frontage).toContain(outside.breach);
    expect(outside.goals.some(p => city.inside.includes(p))).toBe(false);
  });
  it('a gate is seized only from its own inner side: the passage opens the outer gate, not the inner one', () => {
    const { field, city, outerGate, innerGate, passage } = breached();
    const a = unit('a1', 'ally'), e = unit('e1', 'enemy');
    const battle = new SmallBattle({ combatants: [a, e], battlefield: field, rules: V11_OVERFLOW_D20, seed: 'gates' });
    battle.start(); battle.turnOrder = ['a1', 'e1']; battle.turnIndex = 0;
    const live = battle.battlefield!, attacker = battle.byId('a1');
    battle.byId('e1').pos = city.core[0]; attacker.pos = passage; delete attacker.elevation;
    expect(intactStructure(live, innerGate)?.owner).toBe('enemy');
    expect(battle.gateReason('a1', innerGate)).toContain('内部');
    expect(battle.gateReason('a1', outerGate)).toBeUndefined();
    attacker.pos = innerGate - field.width;
    expect(battle.gateReason('a1', innerGate)).toBeUndefined();
  });
});
