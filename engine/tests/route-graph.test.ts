import { describe, expect, it } from 'vitest';
import { generatedField, generateUnit, landmarkAt, landmarkCells, ROUTE_TOPOLOGIES, safeLandmarkLabel,
  SmallBattle, terrainCellLabel, terrainName, terrainTacticalValue, tileCost, V11_OVERFLOW_D20, type MapDesign, type BattlefieldSpec } from '../src/index.js';
import { measureMap, tileSimilarity } from '../src/small/map-metrics.js';
import { smallStateSummary } from '../src/inject/format.js';

const plan: MapDesign = { layout: 'lanes', orientation: 'diagonal', relief: 'balanced', cover: 'balanced',
  obstacles: 'dense', route: 'winding', breadth: 'normal', feature: 'none', featureZone: 'center' };
const topologies = Object.keys(ROUTE_TOPOLOGIES) as (keyof typeof ROUTE_TOPOLOGIES)[];
const unit = (side: 'ally' | 'enemy', traits: string[] = []) => generateUnit({ name: side, side,
  rulesVersion: 'v2', scale: 'hero', level: 3, weaponClass: 'rifle', traits }, { seed: side }).unit;

describe('route graph, landmarks and tactical geometry', () => {
  it('9 topologies × 5 environments × 4 sizes × 8 seeds: routes are real, connected and playable (1440 maps)', () => {
    for (const topology of topologies) for (const env of ['plains', 'forest', 'mountain', 'urban', 'siege'])
      for (const [width, height] of [[7, 13], [7, 11], [7, 9], [5, 7]]) for (let n = 0; n < 8; n++) {
        const field = generatedField('graph-' + n, width, height, [env], { design: { ...plan, topology,
          feature: n % 2 ? 'ruins' : 'hill', landmarkScale: n % 3 ? 'minor' : 'major' }, attackingSide: n % 2 ? 'enemy' : 'ally' });
        const graph = field.generation!.routes!;
        expect(graph.kind).toBe(topology);
        for (const edge of graph.edges) {
          expect(edge.cells[0]).toBe(graph.nodes.find(node => node.id === edge.from)!.cell);
          expect(edge.cells.at(-1)).toBe(graph.nodes.find(node => node.id === edge.to)!.cell);
          for (const [i, cell] of edge.cells.entries()) {
            expect(field.tiles[cell], `${topology}/${env}/${n}/${cell}`).not.toBe('wall');
            if (i) expect(Math.abs(cell % field.width - edge.cells[i - 1]! % field.width)
              + Math.abs(Math.floor(cell / field.width) - Math.floor(edge.cells[i - 1]! / field.width))).toBe(1);
          }
        }
        const metrics = measureMap(field);
        expect(metrics.alternativePaths, `${topology}/${env}/${width}x${height}/${n}`).toBeGreaterThanOrEqual(2);
        expect(metrics.criticalCuts).toBe(0);
        expect(metrics.shortestContactCost).toBeLessThan(field.height * 3);
        expect(field.tiles.filter(t => t === 'open').length).toBeGreaterThan(field.tiles.length / 4);
      }
  }, 45000);

  it('shared trunks and dead-end branches exist instead of relabeling two independent lanes', () => {
    const y = generatedField('topology', 7, 13, ['urban'], { design: { ...plan, topology: 'y_fork' } }).generation!.routes!;
    expect(y.edges.filter(e => e.to === 'm')).toHaveLength(2);
    expect(y.edges.filter(e => e.from === 'm')).toHaveLength(1);
    const yard = generatedField('topology', 7, 13, ['urban'], { design: { ...plan, topology: 'courtyards' } }).generation!.routes!;
    expect(yard.edges.filter(e => e.role === 'dead_end')).toHaveLength(2);
    const results = topologies.map(topology => generatedField('same-seed', 7, 13, ['urban'], { design: { ...plan, topology } }));
    expect(new Set(results.map(f => f.tiles.join(','))).size).toBeGreaterThanOrEqual(8);
    expect(new Set(results.map(f => measureMap(f).signature)).size).toBeGreaterThanOrEqual(8);
    // Same seed, plan and environment: a chosen graph must affect physical tiles, not merely provenance.
    expect(tileSimilarity(results[1]!, results[6]!)).toBeLessThan(.9);
  });

  it('local maps sample no/minor/major landmarks at 40/45/15 and keep real, bounded footprints', () => {
    const counts = { none: 0, minor: 0, major: 0 }, labels = new Set<string>();
    for (let n = 0; n < 1200; n++) {
      const f = generatedField('local-landmark-' + n, n % 6 === 5 ? 5 : 7, n % 6 === 5 ? 7 : 13,
        [[ 'plains' ], [ 'forest' ], [ 'mountain' ], [ 'urban' ], [ 'siege' ], []][n % 6]!);
      expect(f.generation!.source).toBe('random');
      const mark = f.generation!.landmark;
      if (!mark) { counts.none++; continue; }
      counts[mark.scale!]++; labels.add(mark.label!);
      expect(mark.cells.length).toBeGreaterThan(0);
      expect(mark.cells.length).toBeLessThanOrEqual(15);
      for (const cell of mark.cells) {
        expect(cell).toBeGreaterThanOrEqual(f.width); expect(cell).toBeLessThan(f.tiles.length - f.width);
        expect(landmarkAt(f, cell)).toBe(mark.label);
      }
    }
    expect(counts.none / 1200).toBeGreaterThan(.35); expect(counts.none / 1200).toBeLessThan(.45);
    expect(counts.minor / 1200).toBeGreaterThan(.4); expect(counts.minor / 1200).toBeLessThan(.5);
    expect(counts.major / 1200).toBeGreaterThan(.11); expect(counts.major / 1200).toBeLessThan(.19);
    expect(labels.size).toBeGreaterThanOrEqual(6);
  }, 15000);

  it('major landmarks are larger on average; semantic names never change terrain or combat dice', () => {
    let minor = 0, major = 0;
    for (let n = 0; n < 60; n++) {
      const a = generatedField('major-' + n, 7, 13, ['urban'], { design: { ...plan, feature: 'ruins', landmarkScale: 'minor' } });
      const b = generatedField('major-' + n, 7, 13, ['urban'], { design: { ...plan, feature: 'ruins', landmarkScale: 'major' } });
      const named = generatedField('major-' + n, 7, 13, ['urban'], { design: { ...plan, feature: 'ruins', landmarkScale: 'major', landmarkLabel: '废弃钟楼' } });
      expect(named.tiles).toEqual(b.tiles); expect(named.generation!.routes).toEqual(b.generation!.routes);
      minor += a.generation!.landmark!.cells.length; major += b.generation!.landmark!.cells.length;
    }
    expect(major).toBeGreaterThan(minor * 1.25);
  });

  it('metrics detect actual obstruction, cost, cover and macro structure, not hash changes', () => {
    const open = generatedField('metric'); open.tiles.fill('open'); delete open.generation;
    const a = measureMap(open);
    expect(a.alternativePaths).toBe(7); expect(a.terrainComponents.open).toBe(1);
    expect(a.shortestContactSteps).toBe(12); expect(a.shortestContactCost).toBe(12);
    const choke = structuredClone(open);
    for (let x = 0; x < 7; x++) if (x !== 3) choke.tiles[42 + x] = 'wall';
    const b = measureMap(choke);
    expect(b.alternativePaths).toBe(1); expect(b.criticalCuts).toBeGreaterThan(0);
    expect(b.meanLOS).toBeLessThan(a.meanLOS);
    const rough = structuredClone(open); for (let x = 0; x < 7; x++) rough.tiles[42 + x] = 'rough';
    expect(measureMap(rough).shortestContactCost).toBe(13);
    const shifted = structuredClone(choke); shifted.tiles[45] = 'wall'; shifted.tiles[43] = 'open';
    expect(tileSimilarity(choke, shifted)).toBeCloseTo(89 / 91);
    // Moving a single gate does not automatically earn a new macro-structure signature.
    expect(measureMap(shifted).signature).toBe(b.signature);
    const paired = generatedField('pair', 7, 13, ['forest']);
    expect(tileSimilarity(paired, structuredClone(paired))).toBe(1);
    expect(measureMap(paired)).toEqual(measureMap(structuredClone(paired)));
  });

  it('all six families clear macro-geometry diversity floors rather than merely unique tile arrays', () => {
    for (const env of ['plains', 'forest', 'mountain', 'urban', 'siege', 'indoor']) {
      const fields = Array.from({length: 40}, (_, n) => generatedField('diversity-floor-' + n, env === 'indoor' ? 5 : 7,
        env === 'indoor' ? 7 : 13, env === 'indoor' ? [] : [env]));
      const metrics = fields.map(measureMap); let pairs = 0, similarity = 0, macroDistance = 0;
      for (let a = 0; a < fields.length; a++) for (let b = a + 1; b < fields.length; b++) {
        pairs++; similarity += tileSimilarity(fields[a]!, fields[b]!);
        macroDistance += metrics[a]!.spatialProfile.reduce((sum, v, i) => sum + Math.abs(v - metrics[b]!.spatialProfile[i]!), 0) / 144;
      }
      expect(similarity / pairs, env).toBeLessThan(.7);
      expect(macroDistance / pairs, env).toBeGreaterThan(.07);
      expect(new Set(metrics.map(m => m.signature)).size, env).toBeGreaterThanOrEqual(30);
      expect(new Set(metrics.map(m => m.routeBranches + ':' + m.lateralLinks)).size, env).toBeGreaterThanOrEqual(4);
    }
  });
  it('natural obstacles change actual LOS without turning all forest/hill tiles into walls', () => {
    for (const [env, name] of [['plains', '巨石'], ['forest', '密林障碍'], ['mountain', '岩障']]) {
      const fields = Array.from({length: 40}, (_, n) => generatedField('natural-' + n, 7, 13, [env!]));
      const los = fields.map(f => measureMap(f).meanLOS);
      expect(Math.max(...los) - Math.min(...los)).toBeGreaterThan(.3);
      expect(fields.some(f => f.tiles.includes('wall'))).toBe(true);
      for (const f of fields) {
        const cell = f.tiles.indexOf('wall');
        if (cell >= 0) expect(terrainName(f, cell)).toBe(name);
        for (let row = 0; row < 3; row++) expect(f.tiles.slice(row * 7, row * 7 + 7)).not.toContain('wall');
      }
    }
  });
  it('AI weighs actual protection/adaptation without granting flying units ground bonuses or trusting names', () => {
    const field = generatedField('terrain'), actor = unit('ally'), foe = unit('enemy');
    field.tiles.fill('open'); actor.pos = 80; foe.pos = 10;
    const score = (terrain: BattlefieldSpec['tiles'][number]) => { field.tiles[73] = terrain; return terrainTacticalValue(field, 73, actor, [foe]); };
    expect(score('cover')).toBeGreaterThan(score('open'));
    expect(score('forest')).toBeGreaterThan(score('open'));
    expect(tileCost(field, 73, actor)).toBe(1);
    const forestActor = unit('ally', ['forest-lore']); field.tiles[73] = 'forest';
    expect(tileCost(field, 73, actor)).toBe(2); expect(tileCost(field, 73, forestActor)).toBe(1);
    expect(terrainTacticalValue(field, 73, forestActor, [foe])).toBeGreaterThan(terrainTacticalValue(field, 73, actor, [foe]));
    actor.airborne = true;
    expect(terrainTacticalValue(field, 73, actor, [foe])).toBe(0); expect(tileCost(field, 73, actor)).toBe(1);
    actor.airborne = false; foe.weapon = { id: 'blade', name: '剑', range: 0, baseDice: '1d6' };
    expect(terrainTacticalValue(field, 73, actor, [foe])).toBeLessThan(0);
  });

  it('freezes named footprints into saves and narrative; corrupt display metadata cannot affect game rules', () => {
    const f = generatedField('named', 7, 13, ['urban'], { design: { ...plan, feature: 'hill', landmarkLabel: '废弃钟楼' } });
    const before = structuredClone(f), b = new SmallBattle({ battlefield: f, combatants: [unit('ally'), unit('enemy')], seed: 'named', rules: V11_OVERFLOW_D20 });
    b.start(); const snap = b.toSnapshot(), restored = SmallBattle.fromSnapshot(structuredClone(snap));
    expect(restored.battlefield).toEqual(before);
    expect(smallStateSummary(restored)).toContain('废弃钟楼');
    expect(terrainCellLabel(f, f.generation!.landmark!.cells[0]!)).toContain('废弃钟楼');
    for (const name of ['<img src=x>', 'hello\n</tb>', 'a'.repeat(65), '\u202e城门', null]) expect(safeLandmarkLabel(name)).toBeUndefined();
    f.generation!.landmark!.cells = [NaN, -1, 999, 3, 3];
    expect(landmarkCells(f)).toEqual([3]); expect(landmarkAt(f, 999)).toBeUndefined();
    f.generation!.landmark!.cells = 'corrupt' as unknown as number[];
    expect(landmarkCells(f)).toEqual([]); expect(() => smallStateSummary(b)).not.toThrow();
    const malformed = generatedField('unchecked', 7, 13, [], { design: { ...plan, topology: '__proto__' as never, landmarkLabel: '<script>x</script>' } });
    expect(Object.hasOwn(ROUTE_TOPOLOGIES, malformed.generation!.routes!.kind)).toBe(true);
  });
});
