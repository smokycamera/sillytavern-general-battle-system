import { describe, expect, it } from 'vitest';
import { generatedField } from '../src/small/field-generator.js';
import { deployOnGrid, neighbors, validateField, type BattlefieldSpec } from '../src/small/spatial.js';
import { generateUnit, SmallBattle, V7_OVERFLOW_D20, type Combatant } from '../src/index.js';

const sizes = [[7, 13], [7, 11], [7, 9], [5, 7]] as const;
const environments = ['plains', 'forest', 'mountain', 'urban', 'siege'];
function flood(field: BattlefieldSpec, starts: number[], blocked = -1) {
  const queue = starts.filter(p => p !== blocked && field.tiles[p] !== 'wall'), reached = new Set(queue);
  for (let i = 0; i < queue.length; i++) for (const p of neighbors(field, queue[i]!)) {
    if (p !== blocked && field.tiles[p] !== 'wall' && !reached.has(p)) { reached.add(p); queue.push(p); }
  }
  return reached;
}
function unit(id: string, side: 'ally' | 'enemy', body: 'human' | 'vehicle' = 'human', flying = false) {
  const u = generateUnit({ name: id, side, body, scale: 'company', hpMax: 5, rulesVersion: 'v2',
    level: 3, weaponClass: 'sword', traits: flying ? ['flying'] : [] }, { seed: id, noVariance: true }).unit;
  u.id = id; return u;
}

describe('非对称环境地图生成', () => {
  it('各尺寸/环境的320张地图可复现、任务与部署区域连通，不复制对侧地形', () => {
    for (const [w, h] of sizes) for (const environment of environments) {
      const variants = new Set<string>();
      for (let n = 0; n < 16; n++) {
        const field = generatedField('layout-' + n, w, h, [environment]);
        validateField(field);
        expect(field).toEqual(generatedField('layout-' + n, w, h, [environment]));
        const reached = flood(field, [field.objective.cell]);
        expect(reached.size).toBe(field.tiles.filter(t => t !== 'wall').length);
        for (const p of [0, w - 1, w * (h - 1), w * h - 1, Math.floor(w / 2), w * (h - 1) + Math.floor(w / 2)]) expect(reached.has(p)).toBe(true);
        expect(field.tiles.every((t, p) => t === field.tiles[field.tiles.length - 1 - p])).toBe(false);
        expect(field.tiles.every((t, p) => t === field.tiles[Math.floor(p / w) * w + w - 1 - p % w])).toBe(false);
        variants.add(field.tiles.join(','));
      }
      expect(variants.size).toBe(16);
    }
  });

  it('单个格子被占据也不会封死双方之间的所有通路', () => {
    for (const [w, h] of sizes) for (const environment of environments) for (let n = 0; n < 4; n++) {
      const field = generatedField('routes-' + n, w, h, [environment]);
      const entrances = Array.from({ length: w }, (_, x) => x);
      for (let blocked = w; blocked < w * (h - 1); blocked++) {
        if (field.tiles[blocked] === 'wall') continue;
        const reached = flood(field, entrances, blocked);
        expect([...reached].some(p => p >= w * (h - 1))).toBe(true);
      }
    }
  });

  it('墙体纵深、边路与中路随种子改变，不再固定中央墙或三条直道', () => {
    for (const [w, h] of sizes) {
      const walls = new Set<string>(), rows = new Set<number>(), obstructedColumns = new Set<number>();
      for (let n = 0; n < 32; n++) {
        const field = generatedField('walls-' + n, w, h, ['urban']);
        walls.add(field.tiles.map((t, p) => t === 'wall' ? p : '').join(','));
        field.tiles.forEach((t, p) => { if (t === 'wall') { rows.add(Math.floor(p / w)); obstructedColumns.add(p % w); } });
      }
      expect(walls.size).toBeGreaterThan(20);
      expect(rows.size).toBeGreaterThan(1);
      for (const x of [0, Math.floor(w / 2), w - 1]) expect(obstructedColumns.has(x)).toBe(true);
    }
  });

  it('自然环境保持主题且保留开阔地，夜战只叠加光照', () => {
    for (const [w, h] of sizes) for (const environment of environments) for (let n = 0; n < 8; n++) {
      const seed = 'theme-' + n, field = generatedField(seed, w, h, [environment]);
      expect(generatedField(seed, w, h, [environment, 'night']).tiles).toEqual(field.tiles);
      expect(field.tiles.filter(t => t === 'open').length).toBeGreaterThan(field.tiles.length / 4);
      if (w === 7 && ['plains', 'forest', 'mountain'].includes(environment)) expect(field.tiles).not.toContain('wall');
    }
    for (const [environment, terrain] of [['forest', 'forest'], ['mountain', 'hill']] as const) {
      let themed = 0, plains = 0;
      for (let n = 0; n < 16; n++) {
        themed += generatedField('theme-' + n, 7, 13, [environment]).tiles.filter(t => t === terrain).length;
        plains += generatedField('theme-' + n).tiles.filter(t => t === terrain).length;
      }
      expect(themed).toBeGreaterThan(plains * 2);
    }
  });

  it('攻城防线跟随守方且双方目标合法，不把反向攻城仅改成换旗', () => {
    for (const attackingSide of ['ally', 'enemy'] as const) {
      const field = generatedField('siege-direction', 7, 13, ['siege'], { attackingSide });
      const front = attackingSide === 'ally' ? 3 : 9;
      expect(field.tiles.slice(front * 7, front * 7 + 7)).toContain('wall');
      expect(field.objective).toMatchObject({ kind: 'control', attackingSide, cell: attackingSide === 'ally' ? 10 : 80 });
      expect(flood(field, [field.objective.cell]).size).toBe(field.tiles.filter(t => t !== 'wall').length);
    }
  });

  it('室内为真实名单保留满容量部署，空地混编和明确位置不被墙挤出', () => {
    for (const composition of ['human', 'vehicle', 'mixed'] as const) {
      const roster: Combatant[] = [];
      const perSide = composition === 'human' ? 16 : 15;
      for (const side of ['ally', 'enemy'] as const) for (let n = 0; n < perSide; n++) {
        const u = unit(side + n, side, composition === 'human' ? 'human' : 'vehicle', composition === 'mixed' && n % 2 === 0);
        if (n === 0) u.pos = side === 'enemy' ? 7 : 27;
        roster.push(u);
      }
      const before = structuredClone(roster);
      for (let n = 0; n < 8; n++) {
        const field = generatedField('roster-' + n, 5, 7, ['urban'], { roster });
        const battle = new SmallBattle({ rules: V7_OVERFLOW_D20, combatants: structuredClone(roster), battlefield: field, seed: 'deploy' });
        expect(() => battle.start()).not.toThrow();
        expect(battle.combatants.find(u => u.id === 'enemy0')!.pos).toBe(7);
        const restored = SmallBattle.fromSnapshot(structuredClone(battle.toSnapshot()));
        expect(restored.battlefield).toEqual(battle.battlefield);
      }
      expect(roster).toEqual(before);
    }
  });

  it('标准地图保留两侧前三排全部容量，非法尺寸仍拒绝', () => {
    for (const h of [9, 11, 13]) {
      const field = generatedField('capacity', 7, h, ['urban']);
      const roster = ['ally', 'enemy'].flatMap(side => Array.from({ length: 21 }, (_, n) => unit(side + n, side as 'ally' | 'enemy', 'vehicle')));
      expect(deployOnGrid(field, roster)).toHaveLength(42);
    }
    expect(() => generatedField('bad', 4, 6)).toThrow('支持');
  });
});
