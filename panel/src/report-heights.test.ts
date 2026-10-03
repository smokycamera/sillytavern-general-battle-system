import { describe, it, expect } from 'vitest';
import { standardField, SmallBattle, MassBattle, V11_OVERFLOW_D20, V11_OVERFLOW_TW, generateUnit, type BattlefieldSpec } from '../../engine/src/index.js';
import { archivedNarrativeEvents, battleEpilogue, battleIdOf, knownBattleState, makeNarrativeBatch, narrativeEvents } from './battle-reports.js';
import { captureBattleArchive, captureBattleStart } from './report-history.js';

function unit(id: string, side: 'ally' | 'enemy', scale: 'hero' | 'company' = 'hero') {
  const u = generateUnit({ name: id, side, scale, ...(scale === 'company' ? { hpMax: 20 } : {}), rulesVersion: 'v2', level: 3, weaponClass: 'sword', weaponLevel: 3, traits: [] }, { seed: id, noVariance: true }).unit;
  u.id = id; return u;
}
/** A5 (28) on the ground, B5–D5 a slope rising to 北坡 at height 2; the enemy waits at A1, in view. */
function slope(): SmallBattle {
  const f: BattlefieldSpec = standardField(7, 9); f.tiles.fill('open'); f.layerVersion = 1; f.structures = f.tiles.map(() => null);
  f.spatialRulesVersion = 2; f.groundHeight = f.tiles.map(() => 0); f.groundHeight[29] = 1; f.groundHeight[30] = 1; f.groundHeight[31] = 2;
  f.landmarks = [{ kind: 'hill', label: '北坡', cells: [31], scale: 'minor' }];
  f.deploymentZones = [{ side: 'ally', cells: [28] }, { side: 'enemy', cells: [0] }];
  const b = new SmallBattle({ rules: V11_OVERFLOW_D20, battlefield: f, combatants: [unit('a', 'ally'), unit('b', 'enemy')], seed: 'report-slope' });
  b.start(); b.turnOrder = ['a', 'b']; b.turnIndex = 0; return b;
}

describe('新增战况与终章的位置', () => {
  it('新增战况合并连续移动，但不越过已发送的游标', () => {
    const b = slope();
    b.moveTo('a', 29); const cursor = b.log.length;
    b.moveTo('a', 30);
    expect(narrativeEvents(b).map(e => e.text)).toContain('a A5(高度0)→C5(高度1)');
    const later = makeNarrativeBatch(b, undefined, { [battleIdOf(b)]: { cursor, receipts: {} } }, 'delta').text;
    expect(later).toContain('▸ a B5→C5(高度1)'); expect(later).not.toContain('A5');
    expect(archivedNarrativeEvents(b, { [battleIdOf(b)]: { cursor, receipts: {} } }).map(e => e.text)).toEqual(['a A5(高度0)→B5(高度1)', 'a B5→C5(高度1)']);
  });

  it('最新状态写位置与站立高度，并说明高度的含义', () => {
    const b = slope(); b.moveTo('a', 30);
    const state = knownBattleState(b);
    expect(state).toContain('【最新状态】（高度按层计，约一层楼，0为地面）');
    expect(state).toContain('我方 a(C5·高度1)：血量'); expect(state).toContain('敌方 b(A1·高度0)：血量');
  });

  it('会战的最新状态写阵位', () => {
    const b = new MassBattle({ rules: V11_OVERFLOW_TW, combatants: [unit('a', 'ally', 'company'), unit('b', 'enemy', 'company')], seed: 'report-mass' }); b.start();
    expect(knownBattleState(b)).toMatch(/我方 a\((左翼|中军|右翼)(前列|后列|预备列)\)：剩余总人数20\/20/);
  });

  it('终章写战场地标，开局位置取开战快照，结束位置取当前', () => {
    const b = slope();
    const start = captureBattleStart(b, captureBattleArchive({ storage: [], rosterIds: [], inventory: [] }));
    b.moveTo('a', 30); b.finishBattle('ceasefire');
    const text = battleEpilogue(b, start);
    expect(text).toContain('【战场】\n环境：平原｜高度按层计，约一层楼，0为地面\n地标：北坡 D5（高度2）');
    expect(text.split('【结束单位状态与血量】')[0]).toContain('我方 a(A5·高度0)：血量');
    expect(text.split('【结束单位状态与血量】')[1]).toContain('我方 a(C5·高度1)：血量');
  });
});
