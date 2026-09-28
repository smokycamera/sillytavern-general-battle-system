import { describe, expect, it } from 'vitest';
import { deployOnGrid, generateUnit, generatedField, gridDeploymentCells, prepareCombatModel, SmallBattle,
  standardField, V7_OVERFLOW_D20, type Combatant, type GenerateInput } from '../src/index.js';
import { rangedScreen } from '../src/guard-screen.js';

function unit(id: string, side: 'ally' | 'enemy' = 'ally', extra: Partial<GenerateInput> = {}) {
  const u = generateUnit({ name: id, side, scale: 'hero', rulesVersion: 'v2', level: 3, weaponClass: 'sword', traits: [], ...extra }, { seed: id, noVariance: true }).unit;
  u.id = id; prepareCombatModel(u, V7_OVERFLOW_D20); return u;
}
function openField() { const f = standardField(7, 13); f.tiles.fill('open'); return f; }
function positions(roster: Combatant[], cells: number[]) { return Object.fromEntries(roster.map((u, i) => [u.id, cells[i]])); }

describe('带种子扰动的战术部署', () => {
  it('同种子、不同数组顺序结果一致；不同种子会改变合理位置，不再固定靠左', () => {
    const field = openField(), roster = [unit('a'), unit('b'), unit('c', 'enemy'), unit('d', 'enemy')];
    const before = structuredClone(roster), layouts = new Set<string>(), columns = new Set<number>();
    for (let n = 0; n < 24; n++) {
      const seed = 'deployment-' + n, cells = deployOnGrid(field, roster, seed);
      expect(deployOnGrid(field, roster, seed)).toEqual(cells);
      const reversed = [...roster].reverse();
      expect(positions(reversed, deployOnGrid(field, reversed, seed))).toEqual(positions(roster, cells));
      layouts.add(JSON.stringify(cells)); columns.add(cells[0]! % 7);
      for (const [i, u] of roster.entries()) expect(Math.floor(cells[i]! / 7)).toBe(u.side === 'enemy' ? 2 : 10);
    }
    expect(layouts.size).toBeGreaterThan(12); expect(columns.size).toBeGreaterThan(1);
    expect(roster).toEqual(before);
  });

  it('近战前排展开，远程后排留位；空格充足时不把两人挤进同格', () => {
    const field = openField(), roster = [unit('m1'), unit('m2'), unit('m3'), unit('r1', 'ally', { weaponClass: 'bow' }), unit('r2', 'ally', { weaponClass: 'rifle' })];
    for (let n = 0; n < 16; n++) {
      const cells = deployOnGrid(field, roster, 'spread-' + n);
      expect(new Set(cells).size).toBe(roster.length);
      for (let i = 0; i < 3; i++) expect(Math.floor(cells[i]! / 7)).toBe(10);
      for (let i = 3; i < 5; i++) expect(Math.floor(cells[i]! / 7)).toBe(12);
    }
  });

  it('直射避开已部署友军；弓弩、法杖和高于友军的载具按真实遮挡规则利用中路掩体', () => {
    const field = openField(); field.tiles[87] = 'cover';
    const guards = [1, 2, 3, 4, 5].map(x => ({ ...unit('guard' + x), pos: 70 + x }));
    for (const kind of ['rifle', 'bow', 'magic', 'vehicle'] as const) {
      const actor = unit('shooter', 'ally', { weaponClass: kind === 'vehicle' ? 'rifle' : kind, body: kind === 'vehicle' ? 'vehicle' : 'human' });
      for (let n = 0; n < 8; n++) {
        const cells = deployOnGrid(field, [...guards, actor], 'sight-' + n), column = cells.at(-1)! % 7;
        expect(cells.slice(0, -1)).toEqual(guards.map(u => u.pos));
        if (kind === 'rifle') {
          expect(column).not.toBe(3);
          const deployed = { ...actor, pos: cells.at(-1)! };
          expect([63, 69].some(pos => !rangedScreen(deployed, { ...unit('target', 'enemy'), pos }, actor.weapon, guards, { mode: 'small', width: 7 }, new Map()))).toBe(true);
        } else expect(column).toBe(3);
      }
    }
  });

  it('同排优先可用掩体，射界被墙封死时另选位置，不把弓弩当穿墙武器', () => {
    const cover = openField(); cover.tiles[73] = 'cover';
    expect(deployOnGrid(cover, [unit('melee')], 'cover')).toEqual([73]);
    const field = openField(); field.tiles[87] = 'cover';
    for (let x = 1; x < 6; x++) field.tiles[77 + x] = 'wall';
    for (const weaponClass of ['rifle', 'bow', 'magic'] as const) {
      const cell = deployOnGrid(field, [unit('ranged', 'ally', { weaponClass })], 'wall')[0]!;
      expect([0, 6]).toContain(cell % 7); expect(field.tiles[cell]).not.toBe('wall');
    }
  });

  it('先保留大型单位整格，再分散小型单位；满容量和先锋扩展域仍可用', () => {
    const field = openField(), roster = [
      ...Array.from({ length: 20 }, (_, n) => unit('a-human-' + n)),
      ...Array.from({ length: 11 }, (_, n) => unit('z-vehicle-' + n, 'ally', { body: 'vehicle' })),
      ...Array.from({ length: 6 }, (_, n) => unit('vanguard-' + n, 'ally', { body: 'vehicle', traits: ['vanguard'] })),
    ];
    const before = structuredClone(roster);
    for (let n = 0; n < 8; n++) {
      const cells = deployOnGrid(field, roster, 'capacity-' + n);
      for (const [i, u] of roster.entries()) {
        expect(gridDeploymentCells(field, u)).toContain(cells[i]);
        const load = roster.reduce((sum, v, j) => sum + (cells[i] === cells[j] ? v.body === 'vehicle' ? 2 : 1 : 0), 0);
        expect(load).toBeLessThanOrEqual(2);
      }
    }
    expect(roster).toEqual(before);
    expect(() => deployOnGrid(field, [...roster, unit('overflow', 'ally', { body: 'vehicle' })], 'capacity')).toThrow('容量');
  });

  it('室内墙体与随机部署使用同一场种子，紧凑混编仍能开战且不改名单', () => {
    const roster = ['ally', 'enemy'].flatMap(side => [
      ...Array.from({ length: 6 }, (_, n) => unit(side + '-foot-' + n, side as 'ally' | 'enemy')),
      ...Array.from({ length: 8 }, (_, n) => unit(side + '-vehicle-' + n, side as 'ally' | 'enemy', { body: 'vehicle', weaponClass: 'rifle' })),
    ]);
    const before = structuredClone(roster);
    for (let n = 0; n < 16; n++) {
      const seed = 'indoor-' + n, field = generatedField(seed, 5, 7, ['urban'], { roster });
      const b = new SmallBattle({ rules: V7_OVERFLOW_D20, combatants: structuredClone(roster), battlefield: field, seed });
      expect(() => b.start()).not.toThrow();
    }
    expect(roster).toEqual(before);
  });

  it('布阵不消费战斗骰子，读档和重复start不重新随机，敌方隐藏位置不影响己方选位', () => {
    const field = openField(), roster = [unit('a'), unit('b', 'enemy')], seed = 'replay';
    const cells = deployOnGrid(field, roster, seed);
    const a = new SmallBattle({ rules: V7_OVERFLOW_D20, combatants: structuredClone(roster), battlefield: field, seed });
    const b = new SmallBattle({ rules: V7_OVERFLOW_D20, combatants: roster.map((u, i) => ({ ...structuredClone(u), pos: cells[i] })), battlefield: field, seed });
    a.start(); b.start(); expect(a.toSnapshot()).toEqual(b.toSnapshot());
    const snapshot = structuredClone(a.toSnapshot()); a.start(); expect(a.toSnapshot()).toEqual(snapshot);
    const restored = SmallBattle.fromSnapshot(snapshot); restored.start(); expect(restored.toSnapshot()).toEqual(snapshot);
    const left = deployOnGrid(field, [roster[0]!, { ...roster[1]!, pos: 0 }], seed);
    const right = deployOnGrid(field, [roster[0]!, { ...roster[1]!, pos: 6 }], seed);
    expect(left[0]).toBe(right[0]);
  });

  it('错误的明确部署仍整批拒绝，不因优化而覆盖指定位置', () => {
    const field = openField(), roster = [{ ...unit('fixed'), pos: 3 }, unit('auto')], before = structuredClone(roster);
    expect(() => deployOnGrid(field, roster, 'fixed')).toThrow('部署越界'); expect(roster).toEqual(before);
  });
});
