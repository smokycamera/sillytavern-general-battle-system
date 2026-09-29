import { describe, expect, it } from 'vitest';
import { generatedField, MAP_DESIGN_OPTIONS, validMapDesign, type MapDesign, type BattlefieldSpec, neighbors, SmallBattle, generateUnit, V11_OVERFLOW_D20 } from '../src/index.js';

const design: MapDesign = { layout: 'lanes', orientation: 'longitudinal', relief: 'dense', cover: 'balanced', obstacles: 'dense', route: 'winding', breadth: 'normal', feature: 'none', featureZone: 'center' };
function flood(field: BattlefieldSpec, blocked = -1) {
  const queue = Array.from({ length: field.width }, (_, n) => n).filter(n => n !== blocked && field.tiles[n] !== 'wall'), seen = new Set(queue);
  for (let i = 0; i < queue.length; i++) for (const p of neighbors(field, queue[i]!)) if (p !== blocked && field.tiles[p] !== 'wall' && !seen.has(p)) { queue.push(p); seen.add(p); }
  return seen;
}
describe('bounded contextual map director', () => {
  it('six macro layouts × five environments × four sizes × twenty seeds: 2400 legal, reproducible maps', () => {
    for (const layout of Object.keys(MAP_DESIGN_OPTIONS.layout).filter(k => k !== 'automatic') as MapDesign['layout'][]) {
      for (const env of ['plains', 'forest', 'mountain', 'urban', 'siege']) for (const [w, h] of [[7, 13], [7, 11], [7, 9], [5, 7]]) {
        const variants = new Set<string>();
        for (let n = 0; n < 20; n++) {
          const plan: MapDesign = { ...design, layout, orientation: (['longitudinal', 'transverse', 'diagonal'] as const)[n % 3]!,
            cover: (['sparse', 'balanced', 'dense'] as const)[n % 3]!, route: (['direct', 'winding', 'flank'] as const)[n % 3]!,
            breadth: (['broad', 'normal', 'narrow'] as const)[n % 3]!, feature: n % 2 ? 'hill' : 'clearing', featureZone: n % 2 ? 'enemy_left' : 'ally_right' };
          const seed = 'director-' + n, field = generatedField(seed, w, h, [env], { design: plan, attackingSide: n % 2 ? 'enemy' : 'ally' });
          const before = structuredClone(plan);
          expect(field).toEqual(generatedField(seed, w, h, [env], { design: plan, attackingSide: n % 2 ? 'enemy' : 'ally' }));
          expect(plan).toEqual(before);
          expect(field.generation).toMatchObject({ version: 3, source: 'context', design: plan });
          expect(flood(field).size).toBe(field.tiles.filter(t => t !== 'wall').length);
          expect(field.tiles.filter(t => t === 'open').length).toBeGreaterThan(field.tiles.length / 4);
          for (let blocked = w!; blocked < w! * (h! - 1); blocked++) if (field.tiles[blocked] !== 'wall') {
            expect([...flood(field, blocked)].some(p => p >= w! * (h! - 1)), `${env}/${w}x${h}/${layout}/${n}/${blocked}`).toBe(true);
          }
          variants.add(field.tiles.join(','));
        }
        expect(variants.size).toBe(20);
      }
    }
  }, 30000);
  it('layout, orientation, density, path shape/width and landmark position change actual tiles', () => {
    for (const key of Object.keys(MAP_DESIGN_OPTIONS) as (keyof MapDesign)[]) {
      const differences = new Set<string>();
      for (let n = 0; n < 12; n++) for (const value of Object.keys(MAP_DESIGN_OPTIONS[key])) {
        const field = generatedField('effect-' + n, 7, 13, ['urban'], { design: { ...design, feature: 'forest', [key]: value } });
        differences.add(n + ':' + field.tiles.join(','));
      }
      expect(differences.size, key).toBeGreaterThan(12);
    }
    for (const [key, terrain] of [['cover', 'cover'], ['obstacles', 'wall'], ['relief', 'forest']] as const) {
      const counts = { sparse: 0, dense: 0 };
      for (const level of ['sparse', 'dense'] as const) for (let n = 0; n < 100; n++) {
        counts[level] += generatedField('density-' + n, 7, 13, [key === 'relief' ? 'forest' : 'urban'], { design: { ...design, [key]: level } }).tiles.filter(t => t === terrain).length;
      }
      expect(counts.dense, key).toBeGreaterThan(counts.sparse * 1.1);
    }
  });
  it('invalid and incomplete plans fall back deterministically, without trusting external tiles or commands', () => {
    for (const value of [null, [], {}, { ...design, route: 'teleport' }, { ...design, cover: 9 }, { ...design, feature: '__proto__' }]) {
      expect(validMapDesign(value)).toBe(false);
      expect(generatedField('invalid', 7, 13, ['urban'], { design: value as MapDesign })).toEqual(generatedField('invalid', 7, 13, ['urban']));
    }
    const auto = generatedField('auto', 7, 13, ['forest'], { design: { ...design, layout: 'automatic' } });
    expect(auto.generation!.design.layout).not.toBe('automatic');
  });
  it('freezes the actual plan, terrain and selected VIP across snapshots; old maps need no metadata', () => {
    const units = (['ally', 'enemy'] as const).map(side => generateUnit({ name: side, side, scale: 'company', level: 3, hpMax: 5, rulesVersion: 'v2', traits: [] }, { seed: side }).unit);
    const plan = structuredClone(design), field = generatedField('frozen', 7, 13, ['urban'], { design: plan, roster: units });
    field.objective = { kind: 'escape', unitId: units[1]!.id, cell: 87, limit: 60, defenderWins: true };
    const battle = new SmallBattle({ combatants: structuredClone(units), rules: V11_OVERFLOW_D20, seed: 'frozen', battlefield: field });
    battle.start(); const snap = structuredClone(battle.toSnapshot());
    plan.layout = 'broken'; generatedField('another', 7, 13, ['forest']);
    const restored = SmallBattle.fromSnapshot(structuredClone(snap));
    expect(restored.toSnapshot()).toEqual(snap);
    delete (snap.battlefield as BattlefieldSpec).generation;
    expect(SmallBattle.fromSnapshot(structuredClone(snap)).battlefield!.generation).toBeUndefined();
  });
});
