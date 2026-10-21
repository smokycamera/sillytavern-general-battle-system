import { describe, it, expect } from 'vitest';
import { generatedLayeredField, generateUnit, prepareGridDeployment, SmallBattle, V11_OVERFLOW_D20 } from '../src/index.js';
import { groundBlocked } from '../src/small/layers.js';
import { neighbors, type BattlefieldSpec } from '../src/small/spatial.js';
import { COMPOUND_PATTERNS, TRENCH_PATTERNS } from '../src/small/position-plan.js';
import { compileLayout, type LayoutContext } from '../../panel/src/llm-layout.js';

function connected(field: BattlefieldSpec, cells: number[]): number {
  const allowed = new Set(cells), reached = new Set([cells[0]!]), queue = [cells[0]!];
  for (let i = 0; i < queue.length; i++) for (const n of neighbors(field, queue[i]!))
    if (allowed.has(n) && !reached.has(n)) { reached.add(n); queue.push(n); }
  return reached.size;
}
function roster(count = 8, large = false) {
  return Array.from({ length: count }, (_, i) => {
    const id = `unit${i}`, side = i < count / 2 ? 'ally' : 'enemy';
    const u = generateUnit({ name: id, side, body: large ? 'vehicle' : 'human', scale: 'hero', rulesVersion: 'v2', level: 3,
      weaponClass: 'sword', weaponLevel: 3, traits: [] }, { seed: id, noVariance: true }).unit;
    u.id = id; return u;
  });
}
describe('compound and trench organizations', () => {
  it.each(COMPOUND_PATTERNS)('%s keeps the yard and every room reachable without cutting an intact perimeter', pattern => {
    for (const size of ['compact', 'standard', 'large'] as const) for (const attackingSide of ['ally', 'enemy'] as const) {
      const f = generatedLayeredField('compound-' + pattern + size, 7, 13, [], { attackingSide,
        plan: { scene: 'building_siege', size, compound: { pattern }, breaches: { count: 0 } } });
      const inside = f.city!.inside.filter(p => !groundBlocked(f, p));
      expect(connected(f, inside), `${pattern} ${size} ${attackingSide}`).toBe(inside.length);
      expect(f.generation!.compound!.areas.length).toBeGreaterThan(1);
      expect(f.generation!.compound!.areas.some(a => a.kind === 'room' && a.cells.length > 1)).toBe(true);
      expect(f.generation!.compound!.areas.some(a => a.kind === 'court' && a.cells.length > 1)).toBe(true);
      expect(f.city!.frontline.every(p => f.structures![p]!.hp > 0)).toBe(true);
      const door = f.city!.gates[0]!;
      expect(neighbors(f, door).some(p => inside.includes(p))).toBe(true);
      expect(neighbors(f, door).some(p => !f.city!.inside.includes(p) && !f.city!.frontline.includes(p))).toBe(true);
    }
  });
  it.each(TRENCH_PATTERNS)('%s builds two connected systems with a separate contested gap', pattern => {
    for (const size of ['compact', 'standard', 'large'] as const) for (const seed of ['position-a', 'position-b']) {
      const f = generatedLayeredField(seed, 7, 13, [], { plan: { scene: 'trenches', size, trenches: { pattern } } });
      const record = f.generation!.trenches!;
      expect(record.noMansLand.length).toBeGreaterThan(0);
      expect(record.networks[0]!.cells.some(p => record.networks[1]!.cells.includes(p))).toBe(false);
      for (const n of record.networks) {
        expect(connected(f, n.cells), `${pattern} ${size} ${seed}`).toBe(n.cells.length);
        expect(n.cells.every(p => f.structures![p]?.kind === 'fortification' && !groundBlocked(f, p))).toBe(true);
        expect(n.communication.length).toBeGreaterThan(0);
        if (pattern === 'depth' || pattern === 'strongpoints') expect(n.support.length).toBeGreaterThan(0);
        if (pattern === 'saps') expect(n.saps.length).toBeGreaterThan(0);
      }
    }
  });
  it('keeps exact external gate directions/states independent of the internal doors and named room destruction', () => {
    const ctx: LayoutContext = { scene: 'building_siege', size: 'standard', attacker: 'ally', objectiveMode: 'siege', units: [], map: [11, 17] };
    const plan = compileLayout({ compound: { pattern: 'forecourt' }, city: { gates: [
      { name: '南门', at: 'S', state: 'closed' }, { name: '东门', at: 'E', state: 'open' }, { name: '西门', at: 'W', state: 'destroyed' },
    ] }, places: [{ type: 'building', name: '主屋', at: 'N', state: 'destroyed' }] }, ctx).plan;
    const f = generatedLayeredField('gate-posts', 7, 13, [], { plan });
    expect(f.city!.gates).toHaveLength(3);
    const gates = f.city!.gates.map(p => ({ p, s: f.structures![p]! }));
    expect(gates.map(g => g.s.gateState)).toEqual(['closed', 'open', 'destroyed']);
    expect(gates[0]!.p).toBeGreaterThan(gates[1]!.p);
    expect(gates[1]!.p % f.width).toBeGreaterThan(gates[2]!.p % f.width);
    expect(f.city!.frontline.filter(p => f.structures![p]?.kind === 'wall').every(p => f.structures![p]!.hp > 0)).toBe(true);
    expect(f.scene!.regions.find(r => r.label === '主屋')!.cells.length).toBeGreaterThan(1);
  });
  it.each(['building_siege', 'trenches'] as const)('%s deploys a full large roster and freezes geometry through restore', scene => {
    const units = roster(32, true);
    const f = generatedLayeredField('position-capacity', 7, 13, [], { roster: units, plan: { scene } });
    expect(prepareGridDeployment(f, units, 'position-capacity')).toHaveLength(32);
    const battle = new SmallBattle({ battlefield: f, combatants: units, rules: V11_OVERFLOW_D20, seed: 'position-capacity' }); battle.start();
    expect(SmallBattle.fromSnapshot(structuredClone(battle.toSnapshot())).toSnapshot()).toEqual(battle.toSnapshot());
  });
  it('binds an explicitly named inner gate without adding another external entrance', () => {
    const ctx: LayoutContext = { scene: 'building_siege', size: 'compact', attacker: 'ally', objectiveMode: 'siege', units: [], map: [9, 15] };
    const plan = compileLayout({ compound: { pattern: 'bailey' }, city: { gates: [
      { name: '南门', at: 'S', state: 'closed' }, { name: '内门', state: 'open' },
    ] } }, ctx).plan;
    const f = generatedLayeredField('named-inner-door', 7, 13, [], { plan });
    expect(f.city!.gates).toHaveLength(1);
    const inner = f.scene!.regions.find(r => r.label === '内门')!.cells[0]!;
    expect(f.generation!.compound!.internalDoors).toContain(inner);
    expect(f.structures![inner]!.gateState).toBe('open');
  });
  it('keeps compound guards inside when a southern furnishing is placed outside, while preserving northern allied trenches', () => {
    const units = roster(), ctx: LayoutContext = { scene: 'building_siege', size: 'compact', attacker: 'ally', objectiveMode: 'siege',
      units: units.map((u, i) => ({ id: `u${i + 1}`, name: u.name, side: u.side, kind: '人物' })), map: [9, 15] };
    const plan = compileLayout({ city: { gates: [{ state: 'closed' }] }, enemy: { post: 'inside' },
      places: [{ type: 'cover', name: '南侧掩体', at: 'S' }], units: [{ unit: ['u5', 'u6', 'u7', 'u8'], place: '南侧掩体', relation: 'near' }] }, ctx).plan;
    const f = generatedLayeredField('guards-inside', 7, 13, [], { roster: units, plan,
      unitBindings: Object.fromEntries(units.map((u, i) => [`u${i + 1}`, u.id])) });
    expect(prepareGridDeployment(f, units, 'guards-inside').filter(u => u.side === 'enemy').every(u => f.city!.inside.includes(u.pos!))).toBe(true);
    const t = generatedLayeredField('reverse-trenches', 7, 13, [], { roster: units, plan: { scene: 'trenches', trenches: { pattern: 'opposed' },
      deployments: [{ subject: 'ally', at: ['north'] }, { subject: 'enemy', at: ['south'] }] } });
    const prepared = prepareGridDeployment(t, units, 'reverse-trenches');
    for (const network of t.generation!.trenches!.networks) expect(prepared.filter(u => u.side === network.side).every(u => network.cells.includes(u.pos!))).toBe(true);
    expect(prepared.filter(u => u.side === 'ally').every(u => Math.floor(u.pos! / t.width) < t.height / 2)).toBe(true);
  });
  it('binds grouped units to a whole compound room and a connected section of actual trench', () => {
    for (const scene of ['building_siege', 'trenches'] as const) {
      const units = roster(), ctx: LayoutContext = { scene, size: 'standard', attacker: 'ally', objectiveMode: 'annihilation',
        units: units.map((u, i) => ({ id: `u${i + 1}`, name: u.name, side: u.side, kind: '人物' })), map: [11, 17] };
      const plan = compileLayout({ compound: { pattern: 'courtyard' }, trenches: { pattern: 'depth' },
        places: [{ type: scene === 'building_siege' ? 'room' : 'fortification', name: '北部阵位', at: 'N' }],
        units: [{ unit: ['u5', 'u6', 'u7', 'u8'], place: '北部阵位', relation: 'inside' }] }, ctx).plan;
      const f = generatedLayeredField('bound-position', 7, 13, [], { roster: units, plan,
        unitBindings: Object.fromEntries(units.map((u, i) => [`u${i + 1}`, u.id])) });
      const region = f.scene!.regions.find(r => r.label === '北部阵位')!;
      expect(region.cells.length).toBeGreaterThan(1);
      expect(prepareGridDeployment(f, units, 'bound-position').filter(u => u.side === 'enemy').every(u => region.cells.includes(u.pos!))).toBe(true);
    }
  });
});
