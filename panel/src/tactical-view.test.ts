import { describe, expect, it, vi } from 'vitest';
import { tacticalFixture } from '../../scripts/p4-tactical-fixture.js';
import { renderTacticalBattle, selectTacticalElement, tacticalSelection, type TacticalView } from './tactical-view.js';

describe('战术地图查看与确认', () => {
  it('点选与渲染不改事实；敌军不成为查询者，治疗可点友军，同格友军可预览移动', () => {
    const { b } = tacticalFixture(), view: TacticalView = { mode: 'weapon', selectedId: 'a' };
    const before = JSON.stringify(b.toSnapshot()), query = vi.spyOn(b, 'getActionOptions');
    selectTacticalElement(b, view, { cell: 31 });
    const html = renderTacticalBattle(b, view);
    expect(html).toContain('无法穿透，不造成生命或人数损失');
    expect(html).toContain('连续守住2个完整回合');
    expect(html).not.toContain('未发现的伏兵');
    expect(tacticalSelection(b, view).target?.preview).toMatchObject({ penetrationFactor: 0, expectedDamage: 0 });
    const heal = b.byId('a').abilities.find((a) => a.definitionId === 'bp-mending')!;
    selectTacticalElement(b, view, { mode: heal.id }); selectTacticalElement(b, view, { cell: 44 });
    expect(view.selectedId).toBe('a'); expect(view.targetId).toBe('c');
    expect(tacticalSelection(b, view).target?.preview?.healing).toBeGreaterThan(0);
    selectTacticalElement(b, view, { mode: 'move' }); selectTacticalElement(b, view, { cell: 44 });
    expect(view.selectedId).toBe('a'); expect(view.cell).toBe(44);
    expect(b.pathPreview('a', view.cell!).path?.cost).toBe(2);
    renderTacticalBattle(b, view);
    view.selectedId = 'b'; renderTacticalBattle(b, view);
    expect(query.mock.calls.every(([id]) => b.byId(id).side === 'ally')).toBe(true);
    expect(JSON.stringify(b.toSnapshot())).toBe(before);
    query.mockRestore();
  });

  it('范围高亮与实际两目标同源；查看墙体无动作，失能者不产生移动反应风险', () => {
    const { b } = tacticalFixture(), a = b.byId('a');
    b.byId('d').name = b.byId('b').name;
    const ability = a.abilities.find((a) => a.definitionId === 'bp-firestorm')!;
    const view: TacticalView = { mode: ability.id, selectedId: 'a', targetId: 'b' };
    const preview = tacticalSelection(b, view).target!;
    expect(preview.enabled).toBe(true);
    expect(preview.preview?.areaTargetIds).toEqual(['b', 'd']);
    const areaDamage = preview.preview!.areaPreviews!.map((p) => p.expectedDamage);
    expect(areaDamage[0]).toBeGreaterThan(0); expect(areaDamage[0]).toBeLessThan(areaDamage[1]!);
    expect(renderTacticalBattle(b, view).match(/class="grid-cell [^"]*area-hit/g)).toHaveLength(2);
    const result = b.useAbility('a', ability.id, 'b');
    expect(result.ok).toBe(true);
    expect(result.resolutions.map((r) => r.defenderId)).toEqual(preview.preview!.areaTargetIds);
    selectTacticalElement(b, view, { cell: 29 });
    expect(renderTacticalBattle(b, view)).toContain('地面不可通行');
    const { b: movement } = tacticalFixture();
    const foe = movement.byId('b'); foe.pos = 38; foe.weapon = { id: 'blade', name: '近战剑', range: 0, baseDice: '1d6' };
    expect(movement.getActionOptions('b').find((o) => o.id === 'weapon')?.range?.max).toBe(1);
    expect(movement.pathPreview('a', 46).risks).toHaveLength(1);
    foe.conditions.push({ id: 'stunned', dur: 2 });
    expect(movement.pathPreview('a', 46).risks).toHaveLength(0);
  });
});
