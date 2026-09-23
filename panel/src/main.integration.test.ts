// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { nativeFixture } from '../../runtime/tests/native-fixture.js';
import { generateUnit, SmallBattle, standardField, V4_OVERFLOW_D20 } from '../../engine/src/index.js';
import { unitRecordFromCombatant } from './unit-state.js';
import { defaultJevSettings } from './jev-command.js';

vi.mock('./panel-runtime.js', async () => import('../../extension/src/panel-runtime.js'));

afterEach(() => { window.dispatchEvent(new Event('pagehide')); vi.unstubAllGlobals(); });

it('ends the player turn through the real native panel, executes JEV, and restores next-turn budgets', async () => {
  const f = nativeFixture(); await f.service.start();
  const units = ['ally', 'enemy'].map((side, i) => {
    const u = generateUnit({ name: side, side: side as 'ally' | 'enemy', scale: 'hero', level: 3, rulesVersion: 'v2', weaponClass: 'sword', traits: [] }, {seed:side}).unit;
    u.id = 'u' + i; u.morale = u.base.moraleMax = 100; return u;
  });
  const field = standardField(7, 13); field.tiles.fill('open');
  const b = new SmallBattle({combatants:units, battlefield:field, rules:V4_OVERFLOW_D20, seed:'panel-jev'});
  b.start(); b.turnOrder = ['u0', 'u1']; b.turnIndex = 0;
  b.byId('u0').pos = 79; b.byId('u1').pos = 9;
  b.movementSpent.set('u0', 2); b.actedThisTurn.add('u0');
  const settings = {...defaultJevSettings(), mode:'jev' as const};
  await f.service.transact(() => ({schemaVersion:2, storage:units.map(u=>unitRecordFromCombatant(u)), rosterIds:units.map(u=>u.id), jevSettings:settings, autoTurn:false, protagonistId:'u0', battle:{kind:'small',snap:b.toSnapshot()}}));
  Object.assign(window, {__tavernBattleNative:{service:f.service,messages:{}}, __TAURITAVERN__:{}, SillyTavern:{getContext:()=>f.context}});
  localStorage.setItem('tb:jev:url','https://gateway.example/v1'); localStorage.setItem('tb:jev:protocol','openai');
  let release: (() => void) | undefined;
  const releaseRequest = () => release?.();
  let delayed = false;
  const request = vi.fn(async (_url: unknown, init?: RequestInit) => {
    if (delayed) await new Promise<void>(resolve => { release = resolve; });
    const payload = JSON.parse(String(init?.body));
    const body = JSON.parse(payload.messages[1].content);
    const answer = {confidence:.9,scores:Object.fromEntries(body.candidates.map((c:{id:string})=>[c.id,.5]))};
    return new Response(JSON.stringify({model:'fixture',choices:[{message:{content:'```json\n'+JSON.stringify(answer)+'\n```'}}]}));
  });
  vi.stubGlobal('fetch', request);
  document.body.innerHTML = '<div id="app"></div><div id="toast"></div>';
  await import('./main.js');
  const endTurn = document.querySelector<HTMLButtonElement>('[data-action="grid-endturn"]')!;
  expect(endTurn).not.toBeNull(); endTurn.click();
  await vi.waitFor(() => expect(document.body.getAttribute('aria-busy')).not.toBe('true'), {timeout:5000});
  expect(request).toHaveBeenCalled();
  expect(request.mock.calls[0]![0]).toBe('/api/backends/chat-completions/generate');
  expect(document.querySelector('#toast')?.textContent).not.toMatch(/失败|取消|错误/);
  const after = SmallBattle.fromSnapshot(f.service.snapshot().battle!.snap);
  expect(after.round).toBe(2); expect(after.active?.id).toBe('u0');
  expect(after.actedThisTurn.has('u0')).toBe(false); expect(after.movementSpent.has('u0')).toBe(false);
  expect(after.byId('u1').pos).not.toBe(9);

  // Ending a player's activation must be durable while the remote AI is still pending.
  delayed = true; request.mockClear();
  document.querySelector<HTMLButtonElement>('[data-action="grid-endturn"]')!.click();
  await vi.waitFor(() => expect(request).toHaveBeenCalled());
  expect(SmallBattle.fromSnapshot(f.service.snapshot().battle!.snap).active?.id).toBe('u1');
  document.querySelector<HTMLButtonElement>('[data-action="jev-stop"]')!.click();
  releaseRequest();
  await vi.waitFor(() => expect(document.body.getAttribute('aria-busy')).not.toBe('true'));
  expect(SmallBattle.fromSnapshot(f.service.snapshot().battle!.snap).active?.id).toBe('u1');

  // Switching back to built-in AI resumes the saved enemy activation exactly once.
  delayed = false;
  const mode = document.querySelector<HTMLSelectElement>('[data-workspace="battle"] [data-role="jev-mode"]')!;
  mode.value = 'builtin'; mode.dispatchEvent(new Event('change', {bubbles:true}));
  await vi.waitFor(() => expect(f.service.snapshot().battle?.snap.round).toBe(3));
  await vi.waitFor(() => expect(document.body.getAttribute('aria-busy')).not.toBe('true'));

  // Two host updates while an automatic resume is pending must not lose its wake-up.
  const saved = f.service.snapshot();
  const enemy = SmallBattle.fromSnapshot(structuredClone(saved.battle!.snap)); enemy.endTurn();
  delayed = true; request.mockClear(); release = undefined;
  await f.service.persistPanel({...saved, jevSettings:settings, battle:{kind:'small',snap:enemy.toSnapshot()}}, saved.factRevision ?? 0);
  await vi.waitFor(() => expect(request).toHaveBeenCalled());
  delayed = false;
  await f.service.setStorySync(true);
  releaseRequest();
  await vi.waitFor(() => expect(f.service.snapshot().battle?.snap.round).toBe(4), {timeout:5000});
  await vi.waitFor(() => expect(document.body.getAttribute('aria-busy')).not.toBe('true'));
  expect(SmallBattle.fromSnapshot(f.service.snapshot().battle!.snap).active?.id).toBe('u0');

  const setAuto = (checked: boolean) => {
    const toggle = document.querySelector<HTMLInputElement>('[data-role="full-auto-battle"]')!;
    toggle.checked = checked; toggle.dispatchEvent(new Event('change', {bubbles:true}));
  };
  setAuto(true);
  await vi.waitFor(() => expect(Number(f.service.snapshot().battle?.snap.round)).toBeGreaterThanOrEqual(5), {timeout:5000});
  setAuto(false);
  await vi.waitFor(() => expect(document.body.getAttribute('aria-busy')).not.toBe('true'));

  // A late response from the old chat cannot execute or save into the new chat.
  const beforeLate = f.service.snapshot();
  await f.service.persistPanel({...beforeLate, battle:{kind:'small',snap:structuredClone(b.toSnapshot())}, jevBattle:undefined}, beforeLate.factRevision ?? 0);
  const confirmed = structuredClone(f.service.snapshot().battle);
  delayed = true; request.mockClear(); setAuto(true);
  await vi.waitFor(() => expect(request).toHaveBeenCalled(), {timeout:5000});
  f.switchTo('b'); await f.service.load(); releaseRequest();
  await vi.waitFor(() => expect(document.body.getAttribute('aria-busy')).not.toBe('true'));
  expect(f.service.snapshot().battle).toBeUndefined(); expect(f.disk.has('b')).toBe(false);
  f.switchTo('a'); await f.service.load();
  expect(f.service.snapshot().battle).toEqual(confirmed);
  f.service.dispose();
}, 15000);
