import { expect, it } from 'vitest';
import { generateUnit, generatedField, SmallBattle, V2_D20 } from '../../engine/src/index.js';
import { prepareBattleObjective, upgradeDefaultObjective } from './battle-setup.js';
import { renderTacticalBattle } from './tactical-view.js';
import { battleEpilogue, makeNarrativeBatch, publicBattleEvents } from './battle-reports.js';
import { smallStateSummary, roundDigest, settlementCard } from '../../engine/src/inject/format.js';
function battle(siege = true, attackingSide: 'ally' | 'enemy' = 'ally') {
  const units = (['ally', 'enemy'] as const).map((side) => {
    const unit = generateUnit({ name: side, side, rulesVersion: 'v2', scale: 'hero', level: 3, weaponClass: 'sword', traits: [] }, { seed: side }).unit;
    unit.id = side; return unit;
  });
  const field = prepareBattleObjective(generatedField('objectives', 7, 9, siege ? ['siege'] : ['plains']), units, 'auto', undefined, attackingSide);
  field.tiles.fill('open');
  const b = new SmallBattle({ combatants: units, battlefield: field, rules: V2_D20, seed: 'objectives' }); b.start();
  b.turnOrder = ['ally', 'enemy']; b.turnIndex = 0; units[0]!.pos = 45; units[1]!.pos = 56; return b;
}
const round = (b: SmallBattle) => { b.endTurn(); b.endTurn(); };
it('野战歼灭保持原任务，明确占旗与旧占旗档案保留占旗任务', () => {
  const b = battle(false); expect(b.battlefield!.objective.kind).toBe('annihilation');
  b.byId('ally').pos = b.battlefield!.objective.cell;
  for (let n = 0; n < 6; n++) round(b);
  expect(b.isOver()).toBe(false); expect(b.controlRounds.ally).toBe(0);
  const html = renderTacticalBattle(b, { mode: 'weapon' }); expect(html).toContain('歼灭战'); expect(html).not.toContain('class="grid-goal"');
  b.battlefield!.objective = { kind: 'control', cell: 31, rounds: 2, limit: 60 }; upgradeDefaultObjective(b);
  expect(b.battlefield!.objective.kind).toBe('control');
  b.byId('enemy').status = 'dying'; expect(b.winner()).toBe('ally');
  b.battlefield!.objective = { kind: 'control', cell: 31, rounds: 2, limit: 60 }; upgradeDefaultObjective(b); expect(b.battlefield!.objective.kind).toBe('control');
});
it('攻方连续占满两个完整回合即获胜，读档保留进度，离开重计且敌军仍存活', () => {
  let b = battle(); const point = b.battlefield!.objective.cell;
  expect(point).toBe(10); expect(b.battlefield!.objective).toMatchObject({ attackingSide: 'ally', rounds: 2 });
  b.byId('ally').pos = point + 7; b.moveTo('ally', point);
  round(b); expect(b.controlRounds.ally).toBe(0); round(b); expect(b.controlRounds.ally).toBe(1);
  b = SmallBattle.fromSnapshot(structuredClone(b.toSnapshot()));
  b.moveTo('ally', point + 1); b.moveTo('ally', point); expect(b.controlRounds.ally).toBe(0);
  round(b); expect(b.controlRounds.ally).toBe(0);
  round(b); expect(b.controlRounds.ally).toBe(1); expect(b.isOver()).toBe(false);
  round(b); expect(b.winner()).toBe('ally');
  expect(b.byId('enemy').hp).toBeGreaterThan(0); expect(b.log.at(-1)?.text).toContain('我方作为攻方占旗获胜');
});
it('攻守反转会镜像移动胜利点，守方占点不提前赢，守满期限获胜', () => {
  const b = battle(true, 'enemy'); expect(b.battlefield!.objective.cell).toBe(52);
  b.byId('ally').pos = 52; b.byId('enemy').pos = 3;
  for (let n = 0; n < 6; n++) round(b);
  expect(b.isOver()).toBe(false); expect(b.controlRounds).toEqual({ ally: 0, enemy: 0 });
  expect(renderTacticalBattle(b, { mode: 'weapon' })).toContain('我方防守，敌方进攻');
  b.round = 60; b.turnIndex = 1; b.endTurn(); expect(b.winner()).toBe('ally');
  expect(battleEpilogue(b)).toContain('我方作为守方守城成功');
});
it.each(['ally', 'enemy'] as const)('攻方%s占领取胜进入每一种战报，双方仍存活且读档后原因保持', side => {
  let b = battle(true, side); const other = side === 'ally' ? 'enemy' : 'ally';
  b.byId(side).pos = b.battlefield!.objective.cell; b.byId(other).pos = side === 'ally' ? 56 : 0;
  round(b); round(b); round(b);
  expect(b.isOver()).toBe(true); expect(b.winner()).toBe(side); expect(b.byId(other).hp).toBeGreaterThan(0);
  b = SmallBattle.fromSnapshot(structuredClone(b.toSnapshot()));
  const expected = (side === 'ally' ? '我方' : '敌方') + '作为攻方占旗获胜';
  for (const text of [settlementCard(publicBattleEvents(b).map(e => e.entry), b.round), roundDigest(b), smallStateSummary(b), battleEpilogue(b), makeNarrativeBatch(b, undefined, {}, 'delta').text]) {
    expect(text).toContain(expected); expect(text).toContain('2个完整回合'); expect(text).not.toContain('任务结束：' + side);
  }
});
