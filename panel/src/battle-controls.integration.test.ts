// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { nativeFixture } from '../../runtime/tests/native-fixture.js';
import { generateUnit, SmallBattle, standardField, V12_OVERFLOW_D20 } from '../../engine/src/index.js';
import { unitRecordFromCombatant } from './unit-state.js';
import * as viewDom from './view-dom.js';

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

it('战斗界面控件：「除主控」自动停在主控，全自动包含主控，托管随存档续行', async () => {
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

  // 点选和下拉都同步响应，同一状态不重算菜单，也不写档；真正行动后必须重新查询。
  const menu = vi.spyOn(SmallBattle.prototype, 'getActionOptions'), beforeInspection = JSON.stringify(saved().battle);
  for (const mode of ['move', 'guard', 'weapon']) {
    document.querySelector<HTMLButtonElement>(`[data-action="grid-mode"][data-mode="${mode}"]`)!.click();
    expect(document.body.getAttribute('aria-busy')).not.toBe('true');
  }
  await select('a2'); await select('a1');
  expect(menu).toHaveBeenCalledTimes(1); expect(menu).toHaveBeenLastCalledWith('a2');
  expect(JSON.stringify(saved().battle)).toBe(beforeInspection);
  await endTurn();
  expect(menu).toHaveBeenCalledWith('lead');
  await select('a1');
  expect(document.querySelector<HTMLButtonElement>('[data-action="grid-endturn"]')!.disabled).toBe(true);
  await load(battle()); menu.mockClear();
  document.querySelector<HTMLButtonElement>('[data-action="grid-mode"][data-mode="guard"]')!.click();
  expect(menu).not.toHaveBeenCalled(); menu.mockRestore();

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

  // 从界面开启「除主控」后推进其余单位，自然停在主控，无需给主控单独设为手动。
  toggle('auto-turn', true); await idle();
  expect(snapshot().active?.id).toBe('lead');
  expect(unitBox().checked).toBe(false);
  expect(snapshot().allyAiControl.size).toBe(0);
  expect(document.querySelector('.command-finish [data-role="auto-turn"]')!.parentElement!.textContent).toBe('除主控');

  // 全自动包含主控，取消后暂停在下一个单位。
  toggle('full-auto-battle', true);
  await vi.waitFor(() => expect(snapshot().active?.id).toBe('a2'), { timeout: 10000 });
  toggle('full-auto-battle', false); await idle();
  expect(snapshot().active?.id).toBe('a2');

  // 旧存档 autoTurn=true 沿用为「除主控」，恢复后也会停在主控。
  const all = battle(); all.turnIndex = 2;
  await load(all, true);
  s = snapshot();
  expect(s.round).toBe(2); expect(s.active?.id).toBe('lead');
  expect([...s.allyAiControl]).toEqual([]); expect(saved().autoTurn).toBe(true);

  // 在「除主控」下仍可单独收回a1。
  await select('a1'); expect(unitBox().checked).toBe(true);
  toggle('ally-ai', false); await idle();
  expect([...snapshot().allyAiControl]).toEqual([['a1', false]]); expect(snapshot().active?.id).toBe('lead');
  await endTurn();
  s = snapshot(); expect(s.round).toBe(3); expect(s.active?.id).toBe('a1');

  // 恢复存档时，轮到托管单位就继续由AI行动。
  const restored = battle(); restored.allyAiControl.set('a1', true);
  await load(restored);
  expect(snapshot().active?.id).toBe('lead');

  // 连续行动中取消「除主控」：内存更新尚未结束也立即生效，全程不写档。
  const chain = battle(); chain.turnIndex = 1; chain.allyAiControl.set('lead', false);
  await load(chain, true);
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const publish = f.service.persistPanel.bind(f.service), diskWrite = vi.spyOn(f.journal, 'put');
  const write = vi.spyOn(f.service, 'persistPanel').mockImplementationOnce(async (...args) => { await blocked; return publish(...args); });
  document.querySelector<HTMLButtonElement>('[data-action="grid-endturn"]')!.click();
  await vi.waitFor(() => expect(write).toHaveBeenCalled());
  expect(document.body.getAttribute('aria-busy')).toBe('true');
  toggle('auto-turn', false);
  expect(document.querySelector<HTMLInputElement>('.command-finish [data-role="auto-turn"]')!.checked).toBe(false);
  release(); await idle();
  await vi.waitFor(() => expect(saved().autoTurn).toBe(false));
  expect(snapshot().active?.id).toBe('a2');
  expect(diskWrite).not.toHaveBeenCalled(); write.mockRestore(); diskWrite.mockRestore();

  // 非致命在战斗工具栏里切换：改本场之后的规则，也记为下一场的默认。
  await load(battle());
  const lethality = () => document.querySelector<HTMLInputElement>('.battle-toolbar [data-role="non-lethal"]')!;
  expect(lethality().checked).toBe(false); expect(lethality().disabled).toBe(false);
  lethality().checked = true; lethality().dispatchEvent(new Event('change', { bubbles: true })); await idle();
  expect(snapshot().nonLethal).toBe(true); expect(saved().nonLethal).toBe(true);
  expect(snapshot().log.at(-1)).toMatchObject({ kind: 'rule', rule: { nonLethal: true } });
  expect(lethality().checked).toBe(true);
  // 手动交给下一名我方行动者，只保存/重绘一次，保留地图节点。
  await load(battle());
  await select('a1');
  const camera = document.querySelector('.grid-camera');
  const patches = vi.spyOn(viewDom, 'updateRegion');
  await endTurn();
  expect(snapshot().active?.id).toBe('lead');
  expect(document.querySelector('.command-actor h3')!.textContent).toBe('lead');
  expect(document.querySelector('.grid-camera')).toBe(camera);
  expect(patches.mock.calls.filter(([root]) => root.dataset.workspace === 'battle')).toHaveLength(1);
  patches.mockRestore();
  f.service.dispose();
}, 60000);
