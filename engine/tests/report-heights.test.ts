import { describe, it, expect } from 'vitest';
import { standardField, SmallBattle, V11_OVERFLOW_D20, generateUnit, createStructure, compileGenericSkill, reportsHeights, type BattlefieldSpec, type BattleLogEntry } from '../src/index.js';
import { compactEvents, roundDigest, smallStateSummary } from '../src/inject/format.js';

function sceneUnit(id: string, side: 'ally' | 'enemy', ranged = false) {
  const u = generateUnit({ name: id, side, scale: 'hero', rulesVersion: 'v2', level: 3, weaponClass: ranged ? 'bow' : 'sword', weaponLevel: 3, traits: [] }, { seed: id, noVariance: true }).unit;
  u.id = id; return u;
}
/** 7×9 real-height map, all open ground at height 0; A5 is cell 28, G5 is cell 34. */
function reliefField(): BattlefieldSpec {
  const f = standardField(7, 9); f.tiles.fill('open'); f.layerVersion = 1; f.structures = f.tiles.map(() => null);
  f.spatialRulesVersion = 2; f.groundHeight = f.tiles.map(() => 0); return f;
}
function battleOn(f: BattlefieldSpec, ally = sceneUnit('a', 'ally'), enemy = sceneUnit('b', 'enemy'), at: [number, number] = [28, 34]) {
  f.deploymentZones = [{ side: 'ally', cells: [at[0]] }, { side: 'enemy', cells: [at[1]] }];
  const b = new SmallBattle({ rules: V11_OVERFLOW_D20, battlefield: f, combatants: [ally, enemy], seed: 'report-heights' });
  b.start(); b.turnOrder = [ally.id, enemy.id]; b.turnIndex = 0; return b;
}

describe('战报的位置与高度', () => {
  it('只有存在高处可站的实际高度地图才写高度', () => {
    const f = reliefField();
    expect(reportsHeights(f)).toBe(false);
    expect(reportsHeights(standardField())).toBe(false);
    f.groundHeight![30] = 1; expect(reportsHeights(f)).toBe(true);
    const walls = reliefField(); walls.structures![30] = createStructure('wall', 3, { top: true }); expect(reportsHeights(walls)).toBe(true);
  });

  it('逐格移动记录起止高度，战报合并为一行并保留起点高度', () => {
    const f = reliefField(); f.groundHeight![29] = 1; f.groundHeight![30] = 1; f.tiles[30] = 'cover';
    const b = battleOn(f);
    b.moveTo('a', 30);
    const steps = b.log.filter(e => e.kind === 'move' && e.move);
    expect(steps.map(e => e.text)).toEqual(['a A5(高度0)→B5(高度1)', 'a B5→C5(掩体·高度1)']);
    expect(steps[0]!.move).toEqual({ from: 28, to: 29, fromHeight: 0, toHeight: 1 });
    expect(compactEvents(b.log)).toContain('a A5(高度0)→C5(掩体·高度1)');
    expect(SmallBattle.fromSnapshot(structuredClone(b.toSnapshot())).log.at(-1)).toEqual(b.log.at(-1));
  });

  it('平地进入地形格的连续移动也能合并；不同回合或不相接的移动保持分开', () => {
    const f = standardField(); f.tiles.fill('open'); f.tiles[29] = f.tiles[30] = 'cover';
    const b = battleOn(f);
    b.moveTo('a', 30);
    expect(b.log.filter(e => e.move).map(e => e.text)).toEqual(['a A5→B5(掩体)', 'a B5→C5(掩体)']);
    expect(compactEvents(b.log)).toContain('a A5→C5(掩体)');
    const step = (from: number, to: number, text: string, round = 1): BattleLogEntry => ({ round, kind: 'move', participants: ['a'], move: { from, to }, text });
    expect(compactEvents([step(0, 1, 'a A1→B1'), step(1, 2, 'a B1→C1', 2)])).toEqual(['a A1→B1', 'a B1→C1']);
    expect(compactEvents([step(0, 1, 'a A1→B1'), step(5, 6, 'a F1→G1')])).toEqual(['a A1→B1', 'a F1→G1']);
  });

  it('攻击行按双方站立高度写居高或仰攻，同高与空中不写', () => {
    const f = reliefField(); f.groundHeight![28] = 2;
    const archer = sceneUnit('a', 'ally', true), shooter = sceneUnit('c', 'enemy', true);
    const b = battleOn(f, archer, shooter, [28, 31]);
    const down = b.attack('a', 'c', { bypassTurn: true });
    expect([down.attackerHeight, down.defenderHeight]).toEqual([2, 0]);
    const up = b.attack('c', 'a', { bypassTurn: true });
    expect([up.attackerHeight, up.defenderHeight]).toEqual([0, 2]);
    const lines = compactEvents(b.log);
    expect(lines.some(l => l.includes('a→c 居高（高度2→0），'))).toBe(true);
    expect(lines.some(l => l.includes('c→a 仰攻（高度0→2），'))).toBe(true);
    b.battlefield!.groundHeight![30] = 2; b.byId('c').pos = 30;
    const level = b.attack('a', 'c', { bypassTurn: true });
    expect([level.attackerHeight, level.defenderHeight]).toEqual([2, 2]);
    expect(compactEvents(b.log).at(-1)).not.toMatch(/居高|仰攻/);
    const flyer = b.byId('c'); flyer.traits.push('flying'); flyer.airborne = true;
    const air = b.attack('a', 'c', { bypassTurn: true });
    expect([air.attackerHeight, air.defenderHeight]).toEqual([undefined, undefined]);
  });

  it('速射合并行写成员减员', () => {
    const shot = (before: number, after: number, membersBefore: number, membersAfter: number) => ({
      round: 1, kind: 'attack', text: 'x', resolution: { attackerId: 'a', defenderId: 'd', attackerName: '甲', defenderName: '乙', hit: true, crit: false, finalDamage: before - after,
        hpBefore: before, hpAfter: after, damageModel: 'member-health', defenderScale: 'company', membersBefore, membersAfter, text: 'x' },
    }) as unknown as BattleLogEntry;
    expect(compactEvents([shot(100, 80, 10, 8), shot(80, 70, 8, 7)])).toEqual(['甲→乙 2段/2中，损失30生命（100→70），减员3']);
  });

  it('状态摘要逐个列出地标与高度，环境写中文，布阵写格子', () => {
    const f = reliefField(); f.environment = ['mountain', 'night'];
    f.tiles[29] = f.tiles[30] = 'hill'; f.groundHeight![29] = 1; f.groundHeight![30] = 2;
    f.landmarks = [{ kind: 'hill', label: '北坡', cells: [29, 30], scale: 'minor' }, { kind: 'position', label: '旧井', cells: [33], scale: 'minor' }];
    const b = battleOn(f);
    const text = smallStateSummary(b);
    expect(text).toContain('环境：山地/夜间｜高度按层计，约一层楼，0为地面');
    expect(text).toContain('地标：北坡 B5、C5（山地·高度1–2）；旧井 F5（高度0）');
    expect(text).toContain('a(A5·高度0·');
    expect(roundDigest(b, undefined, undefined, { wholeBattle: true }) + b.log.map(e => e.text).join('\n')).toContain('布阵：a A5(高度0)，b G5(高度0)');
    const flat = battleOn(standardField(), sceneUnit('a', 'ally'), sceneUnit('b', 'enemy'));
    expect(smallStateSummary(flat)).not.toContain('高度');
  });

  it('状态行不列已准备技能；战斗结束后不再写距敌', () => {
    const f = reliefField(); f.groundHeight![28] = 1;
    const ally = sceneUnit('a', 'ally');
    const skill = { ...compileGenericSkill('generic:magic-single:arcane', 3, ally.id), id: 'hidden', name: '秘传·影步', cooldownGroup: 'hidden', customized: true };
    ally.abilities.push(skill); ally.preparedAbilityIds = ['hidden'];
    const b = battleOn(f, ally);
    expect(smallStateSummary(b)).toContain('a(A5·高度1·距已知敌6格) 血量');
    expect(smallStateSummary(b)).not.toContain('秘传·影步');
    b.finishBattle('ceasefire');
    const ended = smallStateSummary(b);
    expect(ended).toContain('a(A5·高度1) 血量'); expect(ended).not.toMatch(/距已知敌|未定位敌军|秘传·影步/);
  });
});
