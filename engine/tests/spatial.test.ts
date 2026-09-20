import { describe, expect, it } from 'vitest';
import { canOccupy, deployOnGrid, findGridPath, gridDistance, lineOfSight, standardField } from '../src/small/spatial.js';
import { generatedField } from '../src/small/field-generator.js';
import { makeCombatant } from '../src/small/battle.js';
describe('二维空间查询', () => {
  it('地图63格，寻路绕过硬遮挡，困难格单独计成本', () => {
    const field = standardField();
    expect(field.tiles).toHaveLength(63);
    const start = 3 * 7 + 1; const end = 5 * 7 + 1;
    const path = findGridPath(field, start, end, (cell) => field.tiles[cell] !== 'wall')!;
    expect(gridDistance(field, start, end)).toBe(2); expect(path.cost).toBeGreaterThan(2);
    expect(path.cells).not.toContain(4 * 7 + 1);
  });
  it('7×11标准图：双方部署前沿相距6格，常规3移动一回合无法接敌', () => {
    const field = generatedField('gap-check', 7, 11);
    expect(field.tiles).toHaveLength(77);
    const units = [
      makeCombatant({ id: 'ally-1', name: '我方前排', side: 'ally' }),
      makeCombatant({ id: 'enemy-1', name: '敌方前排', side: 'enemy' }),
    ];
    const positions = deployOnGrid(field, units);
    expect(gridDistance(field, positions[0]!, positions[1]!)).toBe(6);
  });
  it('双向视线一致，拐角不能擦过遮挡射击', () => {
    const field = standardField();
    for (let a = 0; a < 63; a++) for (let b = 0; b < 63; b++) {
      if (field.tiles[a] === 'wall' || field.tiles[b] === 'wall') continue;
      expect(lineOfSight(field, a, b)).toBe(lineOfSight(field, b, a));
    }
    expect(lineOfSight(field, 22, 36)).toBe(false);
  });
  it('敌我不共格，大型占2容量，部署原子且不能进入敌方区域', () => {
    const field = standardField();
    const a = makeCombatant({ id: 'a', name: '甲', side: 'ally', pos: 42 });
    const b = makeCombatant({ id: 'b', name: '乙', side: 'ally', body: 'vehicle' });
    expect(canOccupy(field, [a], b, 42)).toBe(false);
    b.side = 'enemy'; expect(canOccupy(field, [a], b, 42)).toBe(false);
    const wrong = { ...b, pos: 42 };
    expect(() => deployOnGrid(field, [a, wrong])).toThrow('部署越界');
    expect(a.pos).toBe(42); expect(b.pos).toBeUndefined();
  });
});
