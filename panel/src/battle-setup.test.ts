import { describe, expect, it } from 'vitest';
import { generatedField, findGridPath, generateUnit, SmallBattle, traitRegistry, V2_D20, type GenerateInput } from '../../engine/src/index.js';
import { recommendBattleMode, normalizeObjectiveMode, prepareBattleObjective, prepareMassRoster, battleCapacityIssue } from './battle-setup.js';
import { MassBattle, V2_TW, formationNode } from '../../engine/src/index.js';
import { renderTacticalBattle } from './tactical-view.js';
const registry = traitRegistry();
function unit(id: string, side: 'ally' | 'enemy', input: Partial<GenerateInput> = {}) {
  const u = generateUnit({ rulesVersion: 'v2', name: id, side, scale: 'company', hpMax: 5, level: 3,
    weaponClass: 'sword', traits: [], ...input }, { seed: id, registry, noVariance: true }).unit;
  u.id = id; return u;
}
describe('按实际规模准备新战场', () => {
  it('32个未指定部署单位可自动利用支援/预备空位开战，33个提前拦截；明确部署不被擅改', () => {
    const units = Array.from({ length: 32 }, (_, n) => unit('team-' + n.toString().padStart(2, '0'), n < 16 ? 'ally' : 'enemy'));
    const before = structuredClone(units), prepared = prepareMassRoster(units);
    const b = new MassBattle({ combatants: prepared, rules: V2_TW, traitRegistry: registry, seed: 'capacity' });
    b.start(); expect(b.combatants).toHaveLength(32);
    expect(units).toEqual(before);
    const nodes = b.combatants.map((u) => formationNode(u).id);
    expect([...new Set(nodes)].every((id) => nodes.filter((n) => n === id).length <= 3)).toBe(true);
    expect(battleCapacityIssue([...units, unit('extra', 'enemy')])).toMatch(/33.*32/);
    const crowded = units.slice(0, 4).map((u) => ({ ...u, tags: ['zone:中军', 'rank:front'] }));
    expect(() => prepareMassRoster(crowded)).toThrow(/容量/);
  });
  it('护送与拦截镜像判胜；目标/期限冻结，旧任务超时仍为僵持', () => {
    for (const [width, height] of [[7, 9], [5, 7]] as const) for (const mode of ['escort', 'intercept'] as const) {
      const roster = [unit('a', 'ally'), unit('b', 'enemy')];
      const field = prepareBattleObjective(generatedField('mission', width, height), roster, normalizeObjectiveMode(mode), 'a');
      const owner = mode === 'escort' ? 'ally' : 'enemy', defender = owner === 'ally' ? 'enemy' : 'ally';
      expect(field.objective).toMatchObject({ unitId: owner === 'ally' ? 'a' : 'b', defenderWins: true });
      const b = new SmallBattle({ combatants: roster, rules: V2_D20, traitRegistry: registry, seed: 'mission', battlefield: field });
      b.start(); b.battlefield!.tiles.fill('open');
      const target = b.byId(owner === 'ally' ? 'a' : 'b'), blocker = b.byId(defender === 'ally' ? 'a' : 'b');
      target.pos = field.objective.cell + (owner === 'ally' ? width! : -width!);
      blocker.pos = owner === 'ally' ? width! * height! - 1 : 0;
      b.turnOrder = [target.id, blocker.id]; b.turnIndex = 0;
      const snap = structuredClone(b.toSnapshot());
      const html = renderTacticalBattle(b, { mode: 'move', inspectedCell: field.objective.cell });
      expect(html).toContain(mode === 'escort' ? '我方护送，敌方拦截' : '我方拦截，敌方护送');
      expect(b.toSnapshot()).toEqual(snap);
      b.moveTo(target.id, field.objective.cell); expect(b.winner()).toBe(owner);
      const restore = () => SmallBattle.fromSnapshot(structuredClone(snap), { traitRegistry: registry });
      const timed = restore(); timed.round = field.objective.limit; timed.turnIndex = 1; timed.endTurn();
      expect(timed.winner()).toBe(defender);
      expect(timed.byId(target.id).hp).toBeGreaterThan(0);
      const old = restore(); if (old.battlefield!.objective.kind === 'escape') delete old.battlefield!.objective.defenderWins;
      old.round = field.objective.limit; old.turnIndex = 1; old.endTurn(); expect(old.winner()).toBe('draw');
      const fled = restore(); fled.byId(target.id).pos = owner === 'ally' ? width! * height! - 2 : 1;
      fled.byId(blocker.id).pos = owner === 'ally' ? 0 : width! * height! - 1;
      fled.retreat(target.id); expect(fled.objectiveWinner).toBe(defender);
      const killed = restore(), guard = structuredClone(killed.byId(target.id)); guard.id = 'guard'; guard.pos = 0;
      killed.combatants.push(guard); killed.turnOrder = [blocker.id, target.id, guard.id]; killed.turnIndex = 0;
      killed.byId(blocker.id).pos = 17; killed.byId(target.id).pos = 18;
      killed.byId(blocker.id).base.atk = 100; killed.byId(blocker.id).weapon = { id: 'test-blade', name: '剑', range: 1, baseDice: '100d100' };
      killed.byId(target.id).hp = 1;
      killed.attack(blocker.id, target.id); expect(killed.objectiveWinner).toBe(defender);
      expect(guard.status).toBe('ready');
    }
  });
  it('地图按操作单位数选模式，较大编队仍可小战；无宿主的普通人物不能被强塞会战', () => {
    const small = [unit('a', 'ally'), unit('b', 'enemy')], before = JSON.stringify(small);
    expect(recommendBattleMode(small).mode).toBe('small');
    const large = [unit('a', 'ally', { hpMax: 10000 }), unit('b', 'enemy', { hpMax: 10000 })];
    expect(recommendBattleMode(large).mode).toBe('small');
    const hero = unit('person', 'enemy', { scale: 'hero', hpMax: 100 });
    expect(recommendBattleMode([large[0]!, hero]).mode).toBe('small');
    expect(recommendBattleMode([...large, hero]).mode).toBe('small');
    const many = Array.from({ length: 18 }, (_, n) => unit('team-' + n, n < 9 ? 'ally' : 'enemy', { hpMax: 1 }));
    expect(recommendBattleMode(many.slice(0, 16)).mode).toBe('small');
    expect(recommendBattleMode(many.slice(0, 17)).mode).toBe('mass');
    expect(recommendBattleMode(many).mode).toBe('mass');
    expect(recommendBattleMode(many.map((u) => ({ ...u, scale: 'hero' as const }))).mode).toBe('small');
    expect(JSON.stringify(small)).toBe(before);
  });
  it('本场种子固定地形，新场有变体；各边和目标相通，小编队存档仍保持人员语义', () => {
    const variants = new Set<string>();
    for (const [w, h] of [[7, 9], [5, 7]] as const) for (const tags of [[], ['forest'], ['mountain'], ['urban']]) {
      for (let seed = 0; seed < 4; seed++) {
        const field = generatedField(String(seed), w, h, tags);
        expect(field).toEqual(generatedField(String(seed), w, h, tags));
        variants.add(JSON.stringify(field.tiles));
        for (const from of [0, w - 1, (h - 1) * w, h * w - 1]) {
          expect(findGridPath(field, from, field.objective.cell, (n) => field.tiles[n] !== 'wall')).toBeDefined();
        }
        expect(field.tiles.every((tile, n) => tile === field.tiles[field.tiles.length - 1 - n])).toBe(true);
      }
    }
    expect(variants.size).toBeGreaterThan(8);
    const units = [unit('a', 'ally'), unit('b', 'enemy')];
    const b = new SmallBattle({ combatants: units, rules: V2_D20, traitRegistry: registry, seed: 'battle',
      battlefield: generatedField('battle', 7, 9, ['forest']) });
    b.start(); const snap = structuredClone(b.toSnapshot());
    const restored = SmallBattle.fromSnapshot(snap, { traitRegistry: registry });
    expect(restored.battlefield).toEqual(b.battlefield);
    expect(restored.byId('a')).toMatchObject({ id: 'a', scale: 'company', hp: 5, base: { hpMax: 5 } });
    expect(restored.byId('a').weapon).toEqual(units[0]!.weapon);
  });
});
