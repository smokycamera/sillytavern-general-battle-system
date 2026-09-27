import { afterEach, expect, it, vi } from 'vitest';
import { AutoBattleLoop, yieldBattleFrame } from './auto-battle.js';
import { extendSmallRoundLimit, prepareBattleObjective } from './battle-setup.js';
import { generateUnit, generatedField, standardField, SmallBattle, V2_D20 } from '../../engine/src/index.js';
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('异步保存未结束前不开始下一步，关闭重开不会接续旧回调', async () => {
  vi.useFakeTimers(); const loop = new AutoBattleLoop(); let release!: (value: boolean) => void;
  const step = vi.fn(() => new Promise<boolean>(resolve => { release = resolve; })); const changed = vi.fn();
  loop.start(step, changed, vi.fn()); await vi.advanceTimersByTimeAsync(2000);
  expect(step).toHaveBeenCalledTimes(1); expect(changed).not.toHaveBeenCalled();
  loop.stop(); const current = vi.fn(() => false); loop.start(current, changed, vi.fn());
  release(true); await vi.advanceTimersByTimeAsync(1000);
  expect(step).toHaveBeenCalledTimes(1); expect(current).toHaveBeenCalledTimes(1); expect(changed).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it('全自动分步越过200次激活并在结束时停下，不重复启动或留下定时器', () => {
  vi.useFakeTimers(); const loop = new AutoBattleLoop(), changed = vi.fn(), failed = vi.fn(); let actions = 0;
  const step = () => ++actions < 240;
  loop.start(step, changed, failed); loop.start(step, changed, failed);
  expect(actions).toBe(0); vi.advanceTimersByTime(250); expect(actions).toBe(1);
  vi.runAllTimers(); expect(actions).toBe(240); expect(loop.running).toBe(false);
  expect(vi.getTimerCount()).toBe(0); expect(failed).not.toHaveBeenCalled();
});
it('关闭或切换上下文会取消后续行动，异常停止且只报告一次', () => {
  vi.useFakeTimers(); const loop = new AutoBattleLoop(), step = vi.fn(() => true), failed = vi.fn();
  loop.start(step, () => {}, failed); vi.advanceTimersByTime(250); loop.stop(); vi.runAllTimers(); expect(step).toHaveBeenCalledTimes(1);
  loop.start(() => false, () => {}, failed); vi.runAllTimers(); expect(loop.running).toBe(false);
  loop.start(() => { throw Error('保存失败'); }, () => {}, failed); vi.runAllTimers();
  expect(failed).toHaveBeenCalledTimes(1); expect(loop.running).toBe(false); expect(vi.getTimerCount()).toBe(0);
});
it('小战各任务默认60轮，旧未结束12轮档续期，满60轮判限期而非12轮', () => {
  const units = ['ally', 'enemy'].map((side, i) => {
    const u = generateUnit({ rulesVersion: 'v2', name: side, side: side as 'ally' | 'enemy', scale: 'hero', level: 3, weaponClass: 'sword', traits: [] }, { seed: side }).unit;
    u.id = String(i); return u;
  });
  for (const field of [standardField(), generatedField('limit'), generatedField('indoor', 5, 7)]) {
    for (const mode of ['control', 'escort', 'intercept'] as const) expect(prepareBattleObjective(field, units, mode).objective.limit).toBe(60);
  }
  const field = standardField(); field.tiles.fill('open'); field.objective = { kind: 'control', cell: 3, rounds: 2, limit: 12 };
  const battle = new SmallBattle({ combatants: units, battlefield: field, rules: V2_D20, seed: 'limit' }); battle.start();
  units[0]!.pos = 45; units[1]!.pos = 10;
  extendSmallRoundLimit(battle); expect(battle.battlefield!.objective.limit).toBe(60);
  for (let i = 0; i < 24; i++) battle.endTurn(); expect(battle.isOver()).toBe(false);
  for (let i = 24; i < 120 && !battle.isOver(); i++) battle.endTurn();
  expect(battle.isOver()).toBe(true); expect(battle.round).toBe(60); expect(battle.winner()).toBe('draw');
  battle.battlefield!.objective.limit = 12; extendSmallRoundLimit(battle); expect(battle.battlefield!.objective.limit).toBe(12);
});

it('下一次同步决策让出绘制机会；隐藏页面也能继续推进', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('document', { hidden: false });
  let paint!: FrameRequestCallback;
  const frame = vi.fn((callback: FrameRequestCallback) => { paint = callback; return 1; });
  vi.stubGlobal('requestAnimationFrame', frame);
  const next = vi.fn(); const waiting = yieldBattleFrame().then(next);
  expect(frame).toHaveBeenCalledOnce(); expect(next).not.toHaveBeenCalled();
  paint(0); expect(next).not.toHaveBeenCalled();
  await vi.runAllTimersAsync(); await waiting; expect(next).toHaveBeenCalledOnce();
  vi.stubGlobal('document', { hidden: true });
  const hidden = yieldBattleFrame(); await vi.runAllTimersAsync(); await hidden;
  expect(frame).toHaveBeenCalledOnce();
});
