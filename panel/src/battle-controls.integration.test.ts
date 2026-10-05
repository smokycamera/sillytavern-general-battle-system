// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { nativeFixture } from '../../runtime/tests/native-fixture.js';
import { generateUnit, SmallBattle, standardField, V12_OVERFLOW_D20 } from '../../engine/src/index.js';
import { unitRecordFromCombatant } from './unit-state.js';

vi.mock('./panel-runtime.js', async () => import('../../extension/src/panel-runtime.js'));
afterEach(() => { window.dispatchEvent(new Event('pagehide')); vi.unstubAllGlobals(); });

/** 我方 a1、lead（主控）、a2 与远处的敌方 foe，按此顺序行动。 */
function battle(): SmallBattle {
  const units = (['a1', 'lead', 'a2', 'foe'] as const).map(id => {
    const u = generateUnit({ name: id, side: id === 'foe' ? 'enemy' : 'ally', scale: 'hero', level: 4,
      rulesVersion: 'v2', weaponClass: 'sword', weaponLevel: 5, hpMax: 500, traits: [] }, { seed: id, noVariance: true }).unit;
    u.id = id; u.morale = u.base.moraleMax = 100; return u;
  });
  const field = standardField(7, 13); field.tiles.fill('open');
  const b = new SmallBattle({ combatants: units, battlefield: field, rules: V12_OVERFLOW_D20, seed: 'ally-ai' });
  b.start(); b.turnOrder = ['a1', 'lead', 'a2', 'foe']; b.turnIndex = 0;
  for (const [id, pos] of [['a1', 84], ['lead', 86], ['a2', 88], ['foe', 3]] as const) b.byId(id).pos = pos;
  return b;
}

it('战斗界面控件：AI托管按单位和「非主控」生效并随存档续行，非致命可在战中切换', async () => {
  const f = nativeFixture(); await f.service.start(); localStorage.clear();
  Object.assign(window, { __tavernBattleNative: { service: f.service, messages: {} }, __TAURITAVERN__: {}, SillyTavern: { getContext: () => f.context } });
  vi.stubGlobal('fetch', vi.fn());
  document.body.innerHTML = '<div id="app"></div><div id="toast"></div>';
  await import('./main.js');
  const idle = () => vi.waitFor(() => expect(document.body.getAttribute('aria-busy')).not.toBe('true'), { timeout: 10000 });
  const saved = () => f.service.snapshot(), snapshot = () => SmallBattle.fromSnapshot(saved().battle!.snap);
  const load = async (b: SmallBattle, autoTurn = false) => {
    const snap = b.toSnapshot(); delete snap.feedback;
    await f.service.transact(() => ({ schemaVersion: 2, storage: b.combatants.map(u => unitRecordFromCombatant(u)),
      rosterIds: b.combatants.map(u => u.id), protagonistId: 'lead', autoTurn, battle: { kind: 'small', snap } }));
    await idle();
  };
  const toggle = (role: string, checked: boolean) => {
    const box = document.querySelector<HTMLInputElement>(`.command-finish [data-role="${role}"]`)!;
    expect(box.disabled, role).toBe(false);
    box.checked = checked; box.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const select = async (id: string) => {
    const unit = document.querySelector<HTMLSelectElement>('[data-role="grid-unit"]')!;
    unit.value = id; unit.dispatchEvent(new Event('change', { bubbles: true })); await idle();
  };
  const endTurn = async () => { document.querySelector<HTMLButtonElement>('[data-action="grid-endturn"]')!.click(); await idle(); };
  const unitBox = () => document.querySelector<HTMLInputElement>('.command-finish [data-role="ally-ai"]')!;

  await load(battle());
  expect(document.querySelectorAll('[data-action="grid-auto"]')).toHaveLength(1);
  expect(document.querySelectorAll('.command-finish .ai-takeover input')).toHaveLength(3);
  expect(document.querySelector('.battle-toolbar [data-role="full-auto-battle"]')).toBeNull();
  expect(snapshot().active?.id).toBe('a1');

  // 托管当前单位：立刻替它行动，之后停在手动的主控。
  toggle('ally-ai', true); await idle();
  let s = snapshot();
  expect([...s.allyAiControl]).toEqual([['a1', true]]);
  expect(s.active?.id).toBe('lead');
  expect(s.log.some(l => l.text.startsWith('a1'))).toBe(true);
  expect(document.querySelector(`[data-unit-ids*='"a1"'] .grid-badges`)?.textContent).toContain('AI');
  expect(document.querySelector(`[data-unit-ids*='"lead"'] .grid-badges`)?.textContent ?? '').not.toContain('AI');

  // 未托管的 a2 仍等玩家；它的「此单位」未勾选。
  await endTurn();
  expect(snapshot().active?.id).toBe('a2'); expect(unitBox().checked).toBe(false);

  // 「非主控」：a2、下一轮的 a1 都交给AI，停在第2轮的主控；单独设置被清掉。
  toggle('auto-turn', true); await idle();
  s = snapshot();
  expect(s.round).toBe(2); expect(s.active?.id).toBe('lead');
  expect(s.allyAiControl.size).toBe(0); expect(saved().autoTurn).toBe(true);

  // 在「非主控」下单独收回 a1：下一轮轮到 a1 时停下等玩家。
  await select('a1'); expect(unitBox().checked).toBe(true);
  toggle('ally-ai', false); await idle();
  expect([...snapshot().allyAiControl]).toEqual([['a1', false]]); expect(snapshot().active?.id).toBe('lead');
  await endTurn();
  s = snapshot(); expect(s.round).toBe(3); expect(s.active?.id).toBe('a1');

  // 恢复存档时，轮到托管单位就继续由AI行动。
  const restored = battle(); restored.allyAiControl.set('a1', true);
  await load(restored);
  expect(snapshot().active?.id).toBe('lead');

  // 连续行动中取消「非主控」：保存还没结束也立即生效，并写入存档。
  const chain = battle(); chain.turnIndex = 1;
  await load(chain, true);
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const put = f.journal.put.bind(f.journal);
  const write = vi.spyOn(f.journal, 'put').mockImplementationOnce(async (...args) => { await blocked; await put(...args); });
  document.querySelector<HTMLButtonElement>('[data-action="grid-endturn"]')!.click();
  await vi.waitFor(() => expect(write).toHaveBeenCalled());
  expect(document.body.getAttribute('aria-busy')).toBe('true');
  toggle('auto-turn', false);
  expect(document.querySelector<HTMLInputElement>('.command-finish [data-role="auto-turn"]')!.checked).toBe(false);
  release(); await idle();
  await vi.waitFor(() => expect(saved().autoTurn).toBe(false));
  expect(snapshot().active?.id).toBe('a2');
  write.mockRestore();

  // 非致命在战斗工具栏里切换：改本场之后的规则，也记为下一场的默认。
  await load(battle());
  const lethality = () => document.querySelector<HTMLInputElement>('.battle-toolbar [data-role="non-lethal"]')!;
  expect(lethality().checked).toBe(false); expect(lethality().disabled).toBe(false);
  lethality().checked = true; lethality().dispatchEvent(new Event('change', { bubbles: true })); await idle();
  expect(snapshot().nonLethal).toBe(true); expect(saved().nonLethal).toBe(true);
  expect(snapshot().log.at(-1)).toMatchObject({ kind: 'rule', rule: { nonLethal: true } });
  expect(lethality().checked).toBe(true);
  f.service.dispose();
}, 60000);
