import { expect, it } from 'vitest';
import { SmallBattle, MassBattle, V2_D20, V2_TW, generateUnit, standardField, traitRegistry } from '../../engine/src/index.js';
import { applySettlementPrompt } from './prompt-settings.js';
import { renderTacticalBattle } from './tactical-view.js';
const registry = traitRegistry();
function units() {
  return (['ally', 'enemy'] as const).map((side) => {
    const u = generateUnit({ name: side, side, rulesVersion: 'v2', scale: 'company', level: 4, weaponClass: 'rifle', weaponLevel: 5, armorTier: 0, traits: [], hpMax: 100 }, { registry, seed: side }).unit;
    u.id = side; return u;
  });
}
function small() {
  const field = standardField(); field.tiles.fill('open');
  const b = new SmallBattle({ combatants: units(), battlefield: field, rules: V2_D20, seed: 'priority', traitRegistry: registry });
  b.start(); b.turnOrder = ['ally', 'enemy']; b.turnIndex = 0;
  b.byId('ally').pos = 31; b.byId('enemy').pos = 17; return b;
}
it('溃兵仍能追击，已经离场不能攻击或继续占据地图', () => {
  const b = small(); b.byId('enemy').status = 'routing';
  expect(b.isOver()).toBe(false);
  expect(b.getActionOptions('ally').find((o) => o.id === 'weapon')!.targets!.find((t) => t.targetId === 'enemy')!.enabled).toBe(true);
  b.attack('ally', 'enemy');
  expect(b.log.some((e) => e.resolution?.defenderId === 'enemy')).toBe(true);
  b.byId('enemy').status = 'fled';
  expect(renderTacticalBattle(b, { selectedId: 'ally', mode: 'weapon' })).not.toContain('data-unit="enemy"');
  expect(b.isOver()).toBe(true);
});
it('双方均溃退时跳过空激活，直至可行动或结束', () => {
  const b = small(); for (const u of b.combatants) { u.status = 'routing'; u.morale = 0; }
  b.endTurn(); expect(b.isOver() || b.active?.status === 'ready').toBe(true);
});
it('停战和投降保存真实伤亡与结束结果，两种战场重开后保持', () => {
  const b = small(), hp = b.byId('enemy').hp;
  b.finishBattle('ceasefire'); expect(b.winner()).toBe('draw'); expect(b.byId('enemy').hp).toBe(hp);
  expect(SmallBattle.fromSnapshot(b.toSnapshot(), { traitRegistry: registry }).winner()).toBe('draw');
  const m = new MassBattle({ combatants: units(), rules: V2_TW, seed: 'surrender', traitRegistry: registry });
  m.start(); m.finishBattle('surrender'); expect(m.winner()).toBe('enemy');
  expect(MassBattle.fromSnapshot(m.toSnapshot(), { traitRegistry: registry }).winner()).toBe('enemy');
  expect(m.combatants.every((u) => u.hp > 0 && u.status !== 'dead')).toBe(true);
});
it('军团允许射击溃退目标', () => {
  const m = new MassBattle({ combatants: units(), rules: V2_TW, seed: 'pursuit', traitRegistry: registry });
  m.start(); m.byId('enemy').status = 'routing';
  expect(m.orderPreview({ unitId: 'ally', type: 'volley', targetId: 'enemy' }).reason).toBeUndefined();
  m.issue({ unitId: 'ally', type: 'volley', targetId: 'enemy' }); m.resolveRound();
  expect(m.log.some((e) => e.resolution?.defenderId === 'enemy')).toBe(true);
});
it('结算提示词使用指定短句，可替换或关闭而保留事实', () => {
  const input = '【结算记录】事实\n【叙述任务】旧提示';
  expect(applySettlementPrompt(input)).toBe('【结算记录】事实\n根据战斗情况描写战斗过程，不得出现血量，骰子点数等词');
  expect(applySettlementPrompt(input, { sections: { settlement: { enabled: false } } })).toBe('【结算记录】事实');
  expect(applySettlementPrompt(input, { sections: { settlement: { template: '自定义提示' } } })).toBe('【结算记录】事实\n自定义提示');
});
