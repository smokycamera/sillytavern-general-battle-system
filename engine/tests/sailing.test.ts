import { describe, expect, it } from 'vitest';
import { generateUnit, SmallBattle, V32_OVERFLOW_D20, standardField, generatedLayeredField, grantTraitSource,
  resolveTraitId, isGradedTrait, parseSkillMechanism, type Combatant } from '../src/index.js';
import { canOccupy, deployOnGrid, prepareGridDeployment, tileCost } from '../src/small/spatial.js';
import { canClimbFrom, createStructure } from '../src/small/layers.js';
import { findIntentRoute } from '../src/small/intent-path.js';

function unit(id: string, side: Combatant['side'] = 'ally', traits = ['sailing']): Combatant {
  const u = generateUnit({ name: id, side, scale: 'hero', level: 3, hpMax: 300, rulesVersion: 'v2',
    weaponClass: 'bow', weaponLevel: 3, armorTier: 0, traits }, { seed: id, noVariance: true }).unit;
  u.id = id; return u;
}
function field() {
  const f = standardField(); f.tiles.fill('open'); f.layerVersion = 1;
  f.structures = f.tiles.map(() => null); f.overlays = {};
  return f;
}

describe('两栖与航行', () => {
  it('正式名称、旧名和技能机制兼容，两个水域特质均不分级', () => {
    for (const name of ['两栖', '航渡', '浮渡', '泅渡']) expect(resolveTraitId(name)).toBe('water-crossing');
    expect(resolveTraitId('航行')).toBe('sailing');
    expect(isGradedTrait('sailing')).toBe(false); expect(isGradedTrait('water-crossing')).toBe(false);
    expect(parseSkillMechanism('buff航渡')).toEqual(parseSkillMechanism('buff两栖'));
    expect(parseSkillMechanism('buff航行')?.modifiers).toContain('trait-sailing');
  });
  it('单独航行只准进入深浅水，拒绝陆地、沼泽、平台和跨陆地寻路', () => {
    const f = field(), a = unit('a', 'ally', ['sailing', 'siege-assault']); a.pos = 45;
    f.tiles[45] = 'deep_water'; f.tiles[44] = 'shallow_water'; f.tiles[46] = 'swamp'; f.tiles[47] = 'shallow_water';
    expect(canOccupy(f, [], a, 44)).toBe(true); expect(canOccupy(f, [], a, 45)).toBe(true);
    expect(tileCost(f, 44, a)).toBe(2); expect(tileCost(f, 45, a)).toBe(3);
    for (const p of [38, 46]) { expect(canOccupy(f, [], a, p)).toBe(false); expect(tileCost(f, p, a)).toBe(Infinity); }
    f.structures![44] = createStructure('tower', 3, { top: true });
    expect(canClimbFrom(f, a, 44)).toBe(false); expect(canOccupy(f, [], { ...a, elevation: 1 }, 44)).toBe(false);
    expect(findIntentRoute(f, a, [a], u => u.pos === 47, () => false, 1, 1)).toBeUndefined();
    delete f.layerVersion; delete f.structures; delete f.overlays;
    expect(canOccupy(f, [], a, 38)).toBe(false);
  });
  it('同时拥有两栖时保留陆地部署与水陆移动，临时两栖到期后恢复航行限制', () => {
    const f = field(), a = unit('a', 'ally', ['sailing', 'water-crossing']); a.pos = 45;
    f.tiles[44] = 'shallow_water'; f.tiles[43] = 'deep_water';
    expect(deployOnGrid(f, [a])).toEqual([45]);
    expect(canOccupy(f, [], a, 45)).toBe(true); expect(tileCost(f, 44, a)).toBe(1);
    expect(canOccupy(f, [], a, 43)).toBe(true);
    expect(findIntentRoute(f, a, [a], u => u.pos === 43, () => false, 1, 1)).toBeDefined();
    a.traits = ['sailing'];
    grantTraitSource(a, { id: 'amphibious', name: '两栖', kind: 'blessing', traitIds: ['water-crossing'], duration: { kind: 'rounds', count: 1 } });
    expect(canOccupy(f, [], a, 45)).toBe(true);
    a.traitSources![0]!.remaining = 0; expect(canOccupy(f, [], a, 45)).toBe(false);
  });
  it('陆地指定位置移到最近可用水格，先保留已有占位，最近平局稳定且不修改输入', () => {
    const f = field(), a = unit('a'), occupied = unit('b'); a.pos = 52; occupied.pos = 44; occupied.body = 'vehicle';
    f.tiles[44] = 'deep_water'; f.tiles[46] = 'shallow_water'; f.tiles[24] = 'deep_water';
    const before = structuredClone([a, occupied]);
    expect(deployOnGrid(f, [a, occupied])).toEqual([46, 44]); expect([a, occupied]).toEqual(before);
    expect(deployOnGrid(f, [a])).toEqual([44]);
    f.tiles[44] = 'open'; f.tiles[46] = 'open';
    expect(deployOnGrid(f, [a])).toEqual([24]);
  });
  it('祝福来源也会校正部署；城头指令不把航行单位抬上平台；冻结开局与读档保留水格', () => {
    const f = field(), a = unit('a', 'ally', []), e = unit('e', 'enemy', []); a.pos = 52; e.pos = 3;
    grantTraitSource(a, { id: 'boat', kind: 'blessing', name: '舟行', traitIds: ['sailing'], duration: { kind: 'permanent' } });
    f.tiles[24] = 'deep_water'; f.deploymentZones = [{ unitId: 'a', side: 'ally', cells: [52], platform: true }];
    const prepared = prepareGridDeployment(f, [a, e]);
    expect(prepared[0]).toMatchObject({ pos: 24, airborne: false }); expect(prepared[0]!.elevation).toBeUndefined();
    f.initialDeployment = { a: { pos: 24 } }; delete a.pos;
    const b = new SmallBattle({ combatants: [a, e], battlefield: f, rules: V32_OVERFLOW_D20, seed: 'sailing-restore' }); b.start();
    expect(b.byId('a').pos).toBe(24);
    const restored = SmallBattle.fromSnapshot(JSON.parse(JSON.stringify(b.toSnapshot())));
    expect(restored.byId('a').pos).toBe(24); expect(restored.battlefield!.tiles[24]).toBe('deep_water');
    f.city = { shape: 'front', defender: 'ally', inside: [52], reserve: [], frontline: [], gates: [], core: [] };
    expect(prepareGridDeployment(f, [unit('unplaced-guard')])[0]!.pos).toBe(24);
  });
  it('真实战斗移动可在水中执行，移动预览和实际动作都拒绝上岸', () => {
    const f = field(), a = unit('a'), e = unit('e', 'enemy', []); a.pos = 45; e.pos = 3;
    f.tiles[45] = 'shallow_water'; f.tiles[44] = 'shallow_water';
    const b = new SmallBattle({ combatants: [a, e], battlefield: f, rules: V32_OVERFLOW_D20, seed: 'sailing-move' }); b.start();
    b.turnOrder = ['a', 'e']; b.turnIndex = 0;
    expect(b.pathPreview('a', 44).path).toBeDefined(); b.moveTo('a', 44); expect(a.pos).toBe(44);
    expect(b.pathPreview('a', 43).path).toBeUndefined(); expect(() => b.moveTo('a', 43)).toThrow();
  });
  it('指定无水地图报告具体原因；纯本地生成的室内和野外回退能部署航行单位', () => {
    expect(() => prepareGridDeployment(field(), [unit('a')])).toThrow(/航行.*没有可用.*水/);
    for (const scene of ['field', 'interior', 'city_siege', 'city_streets', 'building_siege', 'trenches'] as const) {
      const roster = [unit('a'), unit('e', 'enemy', [])];
      const f = generatedLayeredField('sailing-local-' + scene, 7, 13, ['plains'], { scene, roster });
      expect(['deep_water', 'shallow_water']).toContain(f.tiles[f.initialDeployment!.a!.pos]);
    }
    const roster = [...Array.from({ length: 8 }, (_, i) => unit('ship' + i)), unit('enemy', 'enemy', [])];
    const crowded = generatedLayeredField('sailing-local-fleet', 7, 13, ['plains'], { roster });
    expect(roster.every(u => canOccupy(crowded, prepareGridDeployment(crowded, roster), { ...u, pos: crowded.initialDeployment![u.id]!.pos }, crowded.initialDeployment![u.id]!.pos))).toBe(true);
  });
});
