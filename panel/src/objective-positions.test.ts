import { describe, expect, it } from 'vitest';
import { generateUnit, generatedLayeredField, standardField, SmallBattle, V11_OVERFLOW_D20, type Combatant } from '../../engine/src/index.js';
import { groundBlocked } from '../../engine/src/small/layers.js';
import { validateField } from '../../engine/src/small/spatial.js';
import { prepareBattleObjective } from './battle-setup.js';
import { compileLayout, layoutTask, type LayoutContext } from './llm-layout.js';
import { renderTacticalBattle } from './tactical-view.js';
function units(third = false): Combatant[] {
  return (third ? ['ally', 'enemy', 'neutral'] as const : ['ally', 'enemy'] as const).map(side => {
    const u = generateUnit({ name: side, side, scale: 'hero', rulesVersion: 'v2', level: 3, weaponClass: 'sword', traits: [] }, { seed: side, noVariance: true }).unit;
    u.id = side; return u;
  });
}
const edge = (f: ReturnType<typeof standardField>, p: number) => p % f.width === 0 || p % f.width === f.width - 1 || p < f.width || p >= f.tiles.length - f.width;
describe('objective locations in bounded layouts', () => {
  it.each(['ring', 'wings', 'broken'] as const)('%s chooses a usable boundary instead of the blocked middle of an indoor edge', pattern => {
    const roster = units();
    for (const mode of ['escort', 'intercept'] as const) {
      const f = generatedLayeredField('objective-a', 7, 13, [], { roster, plan: { scene: 'interior', interior: { pattern } } });
      const before = structuredClone(f);
      const result = prepareBattleObjective(f, roster, mode);
      expect(edge(result, result.objective.cell)).toBe(true);
      expect(groundBlocked(result, result.objective.cell)).toBe(false);
      expect(() => validateField(result)).not.toThrow();
      expect(f).toEqual(before);
    }
  });
  it('plans a neutral point through closed gates without opening them, and lets a platform VIP descend to a ground exit', () => {
    const roster = units();
    for (const scene of ['building_siege', 'city_siege'] as const) {
      const f = generatedLayeredField('objective-a', 7, 13, [], { roster, plan: { scene } });
      const gates = f.city!.gates.map(p => structuredClone(f.structures![p]));
      const result = prepareBattleObjective(f, roster, 'control');
      expect(result.objective).toMatchObject({ kind: 'control', rounds: 2 });
      expect(result.objective).not.toHaveProperty('attackingSide');
      expect(result.city!.gates.map(p => result.structures![p])).toEqual(gates);
      expect(() => validateField(prepareBattleObjective(f, roster, 'intercept'))).not.toThrow();
    }
  });
  it('keeps an explicit compass exit on its requested edge after avoiding a partition', () => {
    const roster = units(), ctx: LayoutContext = { scene: 'interior', size: 'standard', attacker: 'ally', objectiveMode: 'escort',
      units: [], map: [7, 13] };
    for (const direction of ['N', 'E'] as const) {
      const plan = compileLayout({ interior: { pattern: 'ring' }, objective: direction }, ctx).plan;
      const f = prepareBattleObjective(generatedLayeredField('edge-exit', 7, 13, [], { roster, plan }), roster, 'escort');
      expect(direction === 'N' ? Math.floor(f.objective.cell / f.width) === 0 : f.objective.cell % f.width === f.width - 1).toBe(true);
      expect(() => validateField(f)).not.toThrow();
    }
    const named = compileLayout({ interior: { pattern: 'ring' }, places: [{ type: 'room', name: '东侧接应室', at: 'E' }], objective: '东侧接应室' }, ctx).plan;
    const f = prepareBattleObjective(generatedLayeredField('named-exit', 7, 13, [], { roster, plan: named }), roster, 'escort');
    expect(f.scene!.regions.find(r => r.label === '东侧接应室')!.cells).toContain(f.objective.cell);
  });
  it('binds a named neutral target for all three sides and retains third-party capture and interruption', () => {
    const roster = units(true), ctx: LayoutContext = { scene: 'field', attacker: 'ally', objectiveMode: 'control',
      units: roster.map(u => ({ id: u.id, name: u.name, side: u.side, kind: '人物' })), map: [7, 13] };
    const plan = compileLayout({ places: [{ type: 'square', name: '争夺空地', at: 'C' }], objective: '争夺空地' }, ctx).plan;
    const f = prepareBattleObjective(generatedLayeredField('three-point', 7, 13, [], { roster, plan }), roster, 'control');
    expect(f.objective).not.toHaveProperty('attackingSide');
    expect(f.objective.kind === 'control' && f.objective.cells).toEqual(f.scene!.regions.find(r => r.label === '争夺空地')!.access);
    expect(layoutTask(ctx)).toContain('各方争夺并连续控制目标地点');
    expect(layoutTask(ctx)).toContain('- objective：各方争夺的地点');
    const battle = new SmallBattle({ battlefield: f, combatants: roster, rules: V11_OVERFLOW_D20, seed: 'three-point' }); battle.start();
    const goal = f.objective.cell;
    battle.byId('neutral').pos = goal; battle.byId('ally').pos = 0; battle.byId('enemy').pos = f.tiles.length - 1;
    battle.turnOrder = ['ally', 'enemy', 'neutral']; battle.turnIndex = 0;
    for (let n = 0; n < 6; n++) battle.endTurn();
    expect(battle.controlRounds.neutral).toBe(1);
    battle.byId('ally').pos = goal - 1;
    for (let n = 0; n < 3; n++) battle.endTurn();
    expect(battle.controlRounds.neutral).toBe(0);
    battle.byId('ally').pos = 0;
    for (let n = 0; n < 9 && !battle.isOver(); n++) battle.endTurn();
    expect(battle.winner()).toBe('neutral');
  });
  it('includes the third deployment in local point selection and marks an escape distinctly from a capture flag', () => {
    const roster = units(true), f = standardField(7, 13); f.tiles.fill('open');
    f.initialDeployment = { ally: { pos: 83 }, enemy: { pos: 13 }, neutral: { pos: 42 } };
    const two = prepareBattleObjective(f, roster.slice(0, 2), 'control'), three = prepareBattleObjective(f, roster, 'control');
    expect(three.objective.cell).not.toBe(two.objective.cell);
    const display = structuredClone(f); delete display.initialDeployment;
    const b = new SmallBattle({ battlefield: prepareBattleObjective(display, roster, 'escort'), combatants: roster, rules: V11_OVERFLOW_D20, seed: 'exit-display' }); b.start();
    const html = renderTacticalBattle(b, { mode: 'move' });
    expect(html).toContain('>出口</span>'); expect(html).toContain('护送撤离点');
    expect(html).not.toContain('>旗</span>');
  });
});
