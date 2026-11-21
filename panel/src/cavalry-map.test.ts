// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { generateUnit, SmallBattle, standardField, V42_OVERFLOW_D20 } from '../../engine/src/index.js';
import { renderTacticalBattle, selectTacticalElement, type TacticalView } from './tactical-view.js';
import { unitIcon } from './unit-icons.js';

function cavalryBattle(enemyCavalry = false) {
  const side = enemyCavalry ? 'enemy' : 'ally';
  const make = (id: string, name: string, side: 'ally' | 'enemy') => {
    const unit = generateUnit({name, side, scale:'hero', level:3, rulesVersion:'v2', traits:[], weaponClass:'sword', hpMax:2000, hp:2000}, {seed:id}).unit;
    unit.id = id;
    unit.morale = unit.base.moraleMax = 100;
    return unit;
  };
  const mount = make('horse', '青原战马', side), rider = make('rider', '赤羽骑士', side);
  mount.body = 'large';
  mount.platform = {kind:'animal', power:2};
  rider.ride = {platformId:mount.id, mode:'mount'};
  const foe = make('opponent', '持剑卫士', enemyCavalry ? 'ally' : 'enemy');
  const field = standardField();
  field.tiles.fill('open');
  const battle = new SmallBattle({combatants:[mount, rider, foe], battlefield:field, rules:V42_OVERFLOW_D20, seed:'cavalry-map'});
  battle.start();
  mount.pos = 31;
  foe.pos = 24;
  const first = enemyCavalry ? foe : rider;
  for (let i = 0; i < battle.turnOrder.length && battle.active !== first; i++) battle.endTurn();
  expect(battle.active).toBe(first);
  return {battle, mount, rider, foe};
}

function render(battle: SmallBattle, cell: number, view: TacticalView) {
  const root = document.createElement('div');
  root.innerHTML = renderTacticalBattle(battle, view);
  return {root, cell:root.querySelector<HTMLElement>(`[data-action="grid-cell"][data-cell="${cell}"]`)!};
}

describe('战术地图上的骑兵', () => {
  it('骑手与战马共用旧骑兵棋子，切到战马仍显示骑手名字；下马后各自显示', () => {
    const {battle, mount, rider} = cavalryBattle();
    const pos = mount.pos!;
    const icon = document.createElement('span');
    icon.innerHTML = unitIcon('cavalry');
    for (const actor of [rider, mount]) {
      if (actor === mount) battle.platforms.act(rider, 'select', mount.id);
      const {root, cell} = render(battle, pos, {mode:'move', selectedId:actor.id, inspectedCell:pos});
      expect(cell.querySelectorAll('.grid-piece')).toHaveLength(1);
      expect(cell.querySelector('.grid-piece.actor .grid-token')?.innerHTML).toBe(icon.innerHTML);
      expect(cell.querySelector('.grid-piece-name')?.textContent).toBe(rider.name);
      expect(cell.getAttribute('aria-label')).not.toContain(mount.name);
      expect(cell.classList.contains('stacked')).toBe(false);
      expect(cell.querySelector('.grid-stack-count')).toBeNull();
      expect(JSON.parse(cell.dataset.unitIds!)).toEqual(expect.arrayContaining([mount.id, rider.id]));
      expect(root.querySelectorAll('.inspector-units button')).toHaveLength(2);
    }
    battle.platforms.act(mount, 'leave', rider.id);
    const {root} = render(battle, pos, {mode:'move'});
    const pieces = Array.from(root.querySelectorAll('.grid-piece-name'), piece => piece.textContent);
    expect(pieces).toContain(mount.name);
    expect(pieces).toContain(rider.name);
    expect(root.querySelector(`[title="${rider.name}"].grid-piece-name`)?.parentElement?.querySelector('.grid-token')?.innerHTML).not.toBe(icon.innerHTML);
  });

  it('同格敌方骑兵只画一个棋子，仍可轮选骑手和马为攻击目标', () => {
    const {battle, mount, rider, foe} = cavalryBattle(true);
    const pos = mount.pos!, view: TacticalView = {mode:'weapon', selectedId:foe.id};
    const {cell} = render(battle, pos, view);
    expect(cell.querySelectorAll('.grid-piece')).toHaveLength(1);
    expect(cell.classList.contains('legal-target')).toBe(true);
    selectTacticalElement(battle, view, {cell:pos});
    const first = view.targetId;
    selectTacticalElement(battle, view, {cell:pos});
    expect(new Set([first, view.targetId])).toEqual(new Set([mount.id, rider.id]));

    foe.pos = pos;
    const stacked = render(battle, pos, view).cell;
    expect(stacked.querySelectorAll('.grid-piece')).toHaveLength(2);
    expect(stacked.querySelector('.grid-stack-count')?.textContent).toBe('2队');
  });

  it('两者都有加速时，花掉加速攻击再切换仍只剩一次普通主攻击', () => {
    const {battle, mount, rider, foe} = cavalryBattle();
    for (const unit of [mount, rider]) unit.conditions.push({id:'hasted', dur:2, magnitude:1});
    battle.selectHaste(rider.id, true);
    battle.playerWeaponAttack(rider.id, foe.id, 'primary');
    battle.platforms.act(rider, 'select', mount.id);
    expect(battle.hasteAvailable(mount.id)).toBe(false);
    battle.playerWeaponAttack(mount.id, foe.id, 'primary');
    expect(() => battle.playerWeaponAttack(mount.id, foe.id, 'primary')).toThrow(/主行动已使用/);
  });

  it.each(['骑手', '坐骑'])('%s出手后切换或下马都不能多拿一次主攻击，读档也一样', source => {
    const {battle, mount, rider, foe} = cavalryBattle();
    battle.platforms.act(rider, 'select', mount.id);
    if (source === '骑手') battle.platforms.act(mount, 'select', rider.id);
    const actor = battle.active!, other = actor === rider ? mount : rider;
    battle.playerWeaponAttack(actor.id, foe.id, 'primary');
    const saved = SmallBattle.fromSnapshot(structuredClone(battle.toSnapshot()));
    expect(saved.turnOrder).not.toContain(mount.id);
    expect(() => saved.platforms.act(saved.active!, 'select', other.id)).toThrow();
    expect(() => saved.playerWeaponAttack(other.id, foe.id, 'primary')).toThrow(/回合/);
    expect(saved.getTurnEconomy(actor.id).actionAvailable).toBe(false);
    saved.platforms.act(saved.active!, 'leave', rider.id);
    expect(saved.active?.id).toBe(rider.id);
    expect(() => saved.playerWeaponAttack(rider.id, foe.id, 'primary')).toThrow(/主行动已使用/);
    expect(saved.turnOrder).not.toContain(mount.id);
  });
});
