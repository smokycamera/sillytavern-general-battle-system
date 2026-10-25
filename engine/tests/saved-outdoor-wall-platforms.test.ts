import { describe, it, expect } from 'vitest';
import { generateUnit, SmallBattle, standardField, traitRegistry, V34_OVERFLOW_D20, type BattlefieldSpec } from '../src/index.js';
import { restoreOutdoorWallPlatforms } from '../src/small/outdoor-wall-platforms.js';
import { buildEnterableBuilding } from '../src/small/region-layout.js';
import { canClimbFrom, groundBlocked, type FieldStructure } from '../src/small/layers.js';
import { neighbors } from '../src/small/spatial.js';
import { tacticalMovementPreview } from '../../panel/src/tactical-view.js';
import fixture from './fixtures/saved-outdoor-wall-perimeter.json';
const registry = traitRegistry();
function field(): BattlefieldSpec {
  const f = standardField(fixture.width, fixture.height); f.tiles.fill('street'); f.layerVersion = 1;
  f.spatialRulesVersion = 2; f.groundHeight = f.tiles.map(() => 0); f.structures = f.tiles.map(() => null); f.overlays = {};
  for (const [p, s] of Object.entries(fixture.structures)) f.structures[+p] = structuredClone(s) as FieldStructure;
  f.generation = structuredClone(fixture.generation) as BattlefieldSpec['generation'];
  f.scene = { version: 1, regions: [{ id: 'place3', kind: 'building', label: '建筑', cells: fixture.floor, access: fixture.floor }], fulfilled: [] };
  return f;
}
function battle(f = field()) {
  const unit = (id: string, side: 'ally' | 'enemy') => { const u = generateUnit({ name: id, side, scale: 'hero', level: 3, rulesVersion: 'v2', traits: [] }, { seed: id, registry, noVariance: true }).unit; u.id = id; return u; };
  const a = unit('a', 'ally'), e = unit('e', 'enemy'), b = new SmallBattle({ combatants: [a, e], battlefield: f, rules: V34_OVERFLOW_D20, seed: 'saved-walls' });
  b.start(); b.turnOrder = ['a', 'e']; b.turnIndex = 0; e.pos = 566;
  return { a, b };
}
describe('用户存档的室外建筑外墙', () => {
  it('旧存档加载仅修复建筑外墙平台和内侧梯道，不改原输入或地面格局，恢复幂等', () => {
    const f = field(), before = structuredClone(f), { b } = battle(f), actual = b.battlefield!;
    expect(f).toEqual(before); expect(actual.tiles).toEqual(f.tiles); expect(actual.groundHeight).toEqual(f.groundHeight);
    expect(actual.structures!.map(s => s && [s.hp, s.hpMax, s.gateState])).toEqual(f.structures!.map(s => s && [s.hp, s.hpMax, s.gateState]));
    expect(actual.structures![85]).toMatchObject({ top: true, platformHeight: 1, access: [86] });
    expect(actual.structures![131]!.access).toEqual([]);
    const snap = b.toSnapshot(); expect(SmallBattle.fromSnapshot(structuredClone(snap)).toSnapshot()).toEqual(snap);
  });
  it('存档墙段C5→B5可从内侧登墙，F7→F6→F5可花2移动沿墙走通', () => {
    const left = battle(); left.a.pos = 86;
    expect(tacticalMovementPreview(left.b, 'a', 85).climb).toBe(true); left.b.climb('a', 85); expect(left.a.pos).toBe(85); expect(left.a.elevation).toBe(1);
    const right = battle(); right.a.pos = 131; right.a.elevation = 1; const before = right.b.movementLeft('a');
    expect(right.b.pathPreview('a', 89).path?.cells).toEqual([131, 110, 89]); right.b.moveTo('a', 89);
    expect(right.a.pos).toBe(89); expect(right.a.elevation).toBe(1); expect(right.b.movementLeft('a')).toBe(before - 2);
  });
  it('保留已毁墙段、外侧攀登限制及室内隔墙', () => {
    const f = field(); f.structures![89]!.hp = 0; restoreOutdoorWallPlatforms(f);
    expect(f.structures![89]!.hp).toBe(0); expect(groundBlocked(f, 89, { ...battle().a, elevation: 1 })).toBe(true);
    const a = battle().a; a.pos = 84; expect(canClimbFrom(f, a, 85)).toBe(false);
    for (const scene of ['interior', 'building_siege'] as const) { const indoor = field(); indoor.generation!.scene = scene; const before = structuredClone(indoor); restoreOutdoorWallPlatforms(indoor); expect(indoor).toEqual(before); }
  });
  it('新生成室外建筑直接带墙顶与内侧入口，不依赖读档修复', () => {
    const f = field(), attached = f.structures![131]; f.structures!.fill(null); f.structures![131] = attached!;
    const floor = buildEnterableBuilding(f, { id: 'house', kind: 'building', anchor: 'A1' }, 66, new Set(), new Set());
    const walls = f.structures!.flatMap((s, p) => s?.entityId === 'house' ? [p] : []);
    expect(walls.length).toBeGreaterThan(4);
    for (const p of walls) { expect(f.structures![p]!.top).toBe(true); expect(f.structures![p]!.access).toEqual(neighbors(f, p).filter(n => floor.includes(n))); }
    expect(f.structures!.some(s => s?.kind === 'gate' && s.top && s.gateState === 'open')).toBe(true);
    expect(f.structures![131]!.access).toEqual([]);
  });
});
