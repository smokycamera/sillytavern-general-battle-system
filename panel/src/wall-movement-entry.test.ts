import { describe, it, expect } from 'vitest';
import { SmallBattle, generateUnit, standardField, traitRegistry, V34_OVERFLOW_D20 } from '../../engine/src/index.js';
import { createStructure } from '../../engine/src/small/layers.js';
import { tacticalMovementPreview, renderTacticalBattle } from './tactical-view.js';
const registry = traitRegistry();
function setup() {
  const unit = (id: string, side: 'ally' | 'enemy') => { const u = generateUnit({ name: id, side, scale: 'hero', level: 3, rulesVersion: 'v2', traits: [] }, { seed: id, registry, noVariance: true }).unit; u.id = id; return u; };
  const a = unit('a', 'ally'), e = unit('e', 'enemy'), f = standardField(8, 10);
  f.tiles.fill('open'); f.layerVersion = 1; f.structures = f.tiles.map(() => null);
  f.structures[33] = createStructure('wall', 3, { top: true, access: [34] }); // B5 <- C5
  for (const p of [37, 45, 53]) f.structures[p] = createStructure('wall', 3, { top: true }); // F5-F7
  const b = new SmallBattle({ combatants: [a, e], battlefield: f, rules: V34_OVERFLOW_D20, seed: 'wall-entry' });
  b.start(); b.turnOrder = ['a', 'e']; b.turnIndex = 0; a.pos = 34; e.pos = 79;
  return { a, b };
}
describe('截图坐标的墙体移动入口', () => {
  it('C5→B5在移动模式预览真正的登城动作，完整消耗主行动及移动点', () => {
    const { a, b } = setup(), before = b.movementLeft('a');
    expect(b.pathPreview('a', 33).path).toBeUndefined();
    const preview = tacticalMovementPreview(b, 'a', 33); expect(preview.climb).toBe(true); expect(preview.path).toBeDefined();
    const html = renderTacticalBattle(b, { mode: 'move', selectedId: 'a', cell: 33, inspectedCell: 33 });
    expect(html).toContain('执行登城'); expect(html).toContain('登城到B5 · 花费2移动 · 消耗主行动');
    b.climb('a', 33); expect(a.elevation).toBe(1); expect(b.actedThisTurn.has('a')).toBe(true); expect(b.movementLeft('a')).toBe(before - preview.path!.cost);
  });
  it('城外无登城特质仍拒绝，已花主行动不能借移动按钮免费登墙', () => {
    const { a, b } = setup(); a.pos = 32;
    expect(tacticalMovementPreview(b, 'a', 33).reason).toContain('登城特质');
    a.pos = 34; b.actedThisTurn.add('a'); expect(tacticalMovementPreview(b, 'a', 33).reason).toContain('主行动');
  });
  it('F7→F6→F5连续完好墙顶可直行；缺少墙顶时反馈实际墙格', () => {
    const { a, b } = setup(); a.pos = 53; a.elevation = 1;
    expect(tacticalMovementPreview(b, 'a', 37).path?.cells).toEqual([53, 45, 37]); b.moveTo('a', 37); expect(a.pos).toBe(37); expect(a.elevation).toBe(1);
    a.pos = 53; b.battlefield!.structures![45]!.top = false;
    expect(tacticalMovementPreview(b, 'a', 37).reason).toContain('F6城墙没有可通行墙顶');
  });
});
