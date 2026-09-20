import { describe, expect, it } from 'vitest';
import { generateUnit, SmallBattle, standardField, traitRegistry, V2_D20, type Combatant } from '../src/index.js';
const registry = traitRegistry();
function unit(id: string, side: 'ally' | 'enemy', weaponClass = 'rifle'): Combatant {
  const u = generateUnit({ name: id, side, scale: 'hero', rulesVersion: 'v2', level: 4, weaponClass, weaponLevel: 5, armorTier: 1, hpMax: 500, traits: [], archetype: 'mobile' }, { registry, seed: id, noVariance: true }).unit;
  u.id = id; return u;
}
function battle(weapon = 'rifle') {
  const field = standardField(); field.tiles.fill('open'); field.objective = { kind: 'control', cell: 31, rounds: 2, limit: 60 };
  const b = new SmallBattle({ combatants: [unit('a', 'ally', weapon), unit('b', 'enemy')], battlefield: field, rules: V2_D20, seed: 'grid-tests', traitRegistry: registry });
  b.start(); b.turnOrder = ['a', 'b']; b.turnIndex = 0;
  return b;
}
describe('真实二维战斗行为', () => {
  it('敌军贴近目标形成争夺，不能隔着相邻交战敌军累计占领胜利', () => {
    const b = battle(); b.byId('a').pos = b.battlefield!.objective.cell; b.byId('b').pos = b.byId('a').pos! + 1;
    for (let i = 0; i < 6 && !b.isOver(); i++) b.endTurn();
    expect(b.objectiveWinner).toBeUndefined(); expect(b.controlRounds.ally).toBe(0);
  });
  it('室内护送到点获胜，途中倒下不能交付目标；任务随快照锁定', () => {
    const field = standardField(5, 7); field.tiles.fill('open'); field.objective = { kind: 'escape', unitId: 'a', cell: 2, limit: 12 };
    const b = new SmallBattle({ combatants: [unit('a', 'ally'), unit('b', 'enemy')], battlefield: field, rules: V2_D20, seed: 'escort', traitRegistry: registry });
    b.start(); b.turnOrder = ['a', 'b']; b.turnIndex = 0; b.byId('a').pos = 7; b.byId('b').pos = 4;
    const restored = SmallBattle.fromSnapshot(JSON.parse(JSON.stringify(b.toSnapshot())), { traitRegistry: registry });
    b.moveTo('a', 2); expect(b.winner()).toBe('ally'); expect(b.byId('b').hp).toBe(500);
    restored.byId('a').status = 'dead'; restored.byId('a').hp = 0;
    expect(() => restored.moveTo('a', 2)).toThrow(); expect(restored.objectiveWinner).toBeUndefined();
  });
  it('同格两支群体共享射击展开，预览和实际都不重复占满10人宽度', () => {
    const b = battle(); const a = b.byId('a'); const c = structuredClone(a); c.id = 'c';
    a.scale = c.scale = 'company'; a.pos = c.pos = 42; b.byId('b').pos = 28;
    b.combatants.push(c); b.turnOrder = ['a', 'c', 'b'];
    b.attack('a', 'b'); b.endTurn(); b.attack('c', 'b');
    const shots = b.log.filter((l) => l.resolution && ['a', 'c'].includes(l.resolution.attackerId));
    expect(shots.filter((l) => l.resolution?.hit).every((l) => l.resolution!.participants === 5)).toBe(true);
    expect(shots.some((l) => l.resolution?.hit)).toBe(true);
  });
  it('召唤消耗有限预备，落点失败不扣费；新生单位下轮才可激活', () => {
    const summoner = generateUnit({ name: '召唤者', side: 'ally', scale: 'hero', rulesVersion: 'v2', level: 4, reserves: 2,
      traits: [], abilityBlueprints: ['bp-call-reinforce'] }, { registry, seed: 'summoner' }).unit;
    const field = standardField(); field.tiles.fill('open'); field.objective = { kind: 'control', cell: 31, rounds: 2, limit: 60 };
    const b = new SmallBattle({ combatants: [summoner, unit('enemy', 'enemy')], battlefield: field, rules: V2_D20, seed: 'summons', traitRegistry: registry,
      summonUnit: (_template, side) => unit('temporary', side as 'ally' | 'enemy', 'sword') });
    b.start(); b.turnOrder = [summoner.id, 'enemy']; b.turnIndex = 0;
    const before = JSON.stringify(b.toSnapshot());
    for (const cell of [summoner.pos! - 7, summoner.pos! + 1, summoner.pos! + 7]) b.battlefield!.tiles[cell] = 'wall';
    expect(b.useAbility(summoner.id, summoner.abilities[0]!.id).ok).toBe(false);
    expect(summoner.resources.reserve).toBe(2); expect(b.combatants).toHaveLength(2);
    const restored = SmallBattle.fromSnapshot(JSON.parse(before), { traitRegistry: registry, summonUnit: (_template, side) => unit('temporary', side as 'ally' | 'enemy', 'sword') });
    expect(restored.useAbility(summoner.id, summoner.abilities[0]!.id).ok).toBe(true);
    const born = restored.combatants.at(-1)!;
    expect(born.summonerId).toBe(summoner.id); expect(restored.turnOrder).not.toContain(born.id);
    expect(restored.byId(summoner.id).resources.reserve).toBe(1);
    restored.endTurn(); restored.endTurn(); expect(restored.turnOrder).toContain(born.id);
  });
  it('移动一格→攻击→再移动，移动与主行动分离且地图/RNG可恢复', () => {
    const b = battle(); b.byId('a').pos = 42; b.byId('b').pos = 28;
    b.moveTo('a', 35); expect(b.movementLeft('a')).toBe(2);
    b.attack('a', 'b'); expect(b.actedThisTurn.has('a')).toBe(true);
    b.moveTo('a', 36); expect(b.movementLeft('a')).toBe(1);
    expect(() => b.attack('a', 'b')).toThrow('主行动');
    const snapshot = JSON.stringify(b.toSnapshot());
    for (let i = 0; i < 10; i++) { b.pathPreview('a', 37); b.getActionOptions('a'); }
    expect(JSON.stringify(b.toSnapshot())).toBe(snapshot);
    const restored = SmallBattle.fromSnapshot(JSON.parse(snapshot), { traitRegistry: registry });
    expect(restored.battlefield).toEqual(b.battlefield); expect(restored.movementLeft('a')).toBe(1);
    expect(restored.rng.next()).toBe(b.rng.next());
  });
  it('敌占格、超预算、遮挡射击、越障冲锋都拒绝且无状态/随机变化', () => {
    const b = battle('sword'); b.byId('a').pos = 42; b.byId('b').pos = 21;
    b.battlefield!.tiles[35] = 'wall';
    const before = JSON.stringify(b.toSnapshot());
    expect(() => b.moveTo('a', 21)).toThrow(); expect(() => b.moveTo('a', 0)).toThrow();
    expect(() => b.attack('a', 'b', { charge: true })).toThrow('冲锋');
    expect(JSON.stringify(b.toSnapshot())).toBe(before);
    const ranged = battle(); ranged.byId('a').pos = 42; ranged.byId('b').pos = 21; ranged.battlefield!.tiles[35] = 'wall';
    expect(() => ranged.attack('a', 'b')).toThrow('视线');
  });
  it('冲锋沿合法路径移动后在相邻格攻击，不与敌人共格', () => {
    const b = battle('sword'); b.byId('a').pos = 42; b.byId('b').pos = 21;
    b.attack('a', 'b', { charge: true });
    expect(b.dist(b.byId('a'), b.byId('b'))).toBe(1);
    expect(b.byId('a').pos).not.toBe(b.byId('b').pos);
    expect(b.movementLeft('a')).toBe(1);
    expect(b.log.filter((l) => l.kind === 'move').length).toBeGreaterThanOrEqual(3);
  });
  it('反复离开同一敌人只触发一次反应；途中倒下终止路径', () => {
    const b = battle(); b.byId('a').pos = 42; b.byId('b').pos = 35;
    b.byId('b').weapon = unit('blade', 'enemy', 'sword').weapon;
    b.moveTo('a', 43); b.moveTo('a', 42); b.moveTo('a', 43);
    expect(b.log.filter((l) => l.text.startsWith('借机反应'))).toHaveLength(1);
    const c = battle(); c.byId('a').pos = 42; c.byId('a').hp = 1; c.byId('b').pos = 35;
    c.byId('b').weapon = unit('blade', 'enemy', 'sword').weapon; c.byId('b').base.atk = 100;
    c.moveTo('a', 45);
    expect(c.byId('a').status).not.toBe('ready'); expect(c.byId('a').pos).toBe(43);
  });
  it('压制独立于生命伤害并关闭警戒；占点能在双方存活时获胜', () => {
    const b = battle(); b.byId('a').pos = 42; b.byId('b').pos = 28;
    const hp = b.byId('b').hp; b.overwatch.add('b'); b.suppress('a', 'b');
    expect(b.byId('b').hp).toBe(hp); expect(b.byId('b').suppression).toBe(2); expect(b.overwatch.has('b')).toBe(false);
    const c = battle(); c.byId('a').pos = c.battlefield!.objective.cell;
    c.endTurn(); c.endTurn(); expect(c.controlRounds.ally).toBe(0);
    c.endTurn(); c.endTurn(); expect(c.controlRounds.ally).toBe(1);
    c.endTurn(); c.endTurn(); expect(c.winner()).toBe('ally'); expect(c.byId('b').hp).toBeGreaterThan(0);
  });
  it('AI使用移动+动作短组合并按目标结束，不消耗预览随机', () => {
    const b = battle(); b.battlefield!.objective.limit = 12; let guard = 0;
    while (!b.isOver() && guard++ < 150) b.autoAction(b.active!.id);
    expect(b.isOver()).toBe(true); expect(b.log.some((l) => l.kind === 'move' && l.text.includes('→'))).toBe(true);
    expect(b.round).toBeLessThanOrEqual(12);
  });
});
