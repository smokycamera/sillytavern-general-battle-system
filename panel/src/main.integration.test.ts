// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { nativeFixture } from '../../runtime/tests/native-fixture.js';
import { generateUnit, SmallBattle, standardField, V4_OVERFLOW_D20 } from '../../engine/src/index.js';
import { unitRecordFromCombatant } from './unit-state.js';
import { readLlmSettings, LLM_SETTINGS_KEY } from './llm-settings.js';
vi.mock('./panel-runtime.js', async () => import('../../extension/src/panel-runtime.js'));
afterEach(() => { window.dispatchEvent(new Event('pagehide')); vi.unstubAllGlobals(); });

it('uses built-in turns for old JEV saves, persists independent connections, and applies only current-chat LLM preparation', async () => {
  const f = nativeFixture(); await f.service.start(); localStorage.clear();
  const units = (['ally', 'enemy'] as const).map((side, i) => {
    const u = generateUnit({ name: side, side, scale: 'hero', level: 3, rulesVersion: 'v2', weaponClass: 'sword', traits: [] }, {seed:side}).unit;
    u.id = 'u' + i; u.morale = u.base.moraleMax = 100; return u;
  });
  const field = standardField(7, 13); field.tiles.fill('open');
  const b = new SmallBattle({combatants:units, battlefield:field, rules:V4_OVERFLOW_D20, seed:'panel-builtin'});
  b.start(); b.turnOrder = ['u0', 'u1']; b.turnIndex = 0;
  b.byId('u0').pos = 79; b.byId('u1').pos = 9;
  b.movementSpent.set('u0', 2); b.actedThisTurn.add('u0');
  await f.service.transact(() => ({schemaVersion:2, storage:units.map(u=>unitRecordFromCombatant(u)), rosterIds:units.map(u=>u.id), jevSettings:{mode:'jev'}, autoTurn:false, protagonistId:'u0', battle:{kind:'small',snap:b.toSnapshot()}}));
  Object.assign(window, {__tavernBattleNative:{service:f.service,messages:{}}, __TAURITAVERN__:{}, SillyTavern:{getContext:()=>f.context}});
  let release: (() => void) | undefined, delayed = false, breakLayout = 0;
  const request = vi.fn(async (url: unknown, init?: RequestInit) => {
    if (String(url).endsWith('/status')) return new Response(JSON.stringify({data:[{id:'model-one'},{id:'model-two'}]}));
    if (delayed) await new Promise<void>(resolve => { release = resolve; });
    const payload = JSON.parse(String(init?.body)), task = payload.messages.at(-1).content as string;
    if (task.startsWith('【第2步')) {
      const layout = breakLayout > 0 ? '地图如下：无' : JSON.stringify({archetype:'forest_path',places:[{type:'hill',name:'敌左高地',at:'NW',height:2}],ally:{at:['S']},enemy:{at:['N']},objective:'S'});
      breakLayout = Math.max(0, breakLayout - 1);
      return new Response(JSON.stringify({model:'remote-alias',choices:[{message:{content:layout}}]}));
    }
    const body = JSON.parse(task.slice(task.lastIndexOf('\n') + 1));
    const values:Record<string,string> = {field:'forest',lighting:'night',battle_mode:'small',objective:'intercept',scene:'field',size:'standard',vip_ally:'unit_0',vip_enemy:'unit_0',siege_attacker:'ally',enemy_ability:'expert',enemy_style:'cautious',ally_ability:'master',ally_style:'aggressive'};
    return new Response(JSON.stringify({model:'remote-alias',choices:[{message:{content:JSON.stringify({selections:Object.fromEntries(body.fields.map((v:{id:string})=>[v.id,{value:values[v.id],confidence:.2}]))})}}]}));
  });
  vi.stubGlobal('fetch', request);
  document.body.innerHTML = '<div id="app"></div><div id="toast"></div>';
  await import('./main.js');
  const idle=()=>vi.waitFor(()=>expect(document.body.getAttribute('aria-busy')).not.toBe('true'),{timeout:5000});
  const button=(action:string)=>document.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!;
  const input=(role:string,value:string)=>{const el=document.querySelector<HTMLInputElement>(`[data-role="${role}"]`)!;expect(el).not.toBeNull();el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));};
  const select=(role:string,value:string)=>{const el=document.querySelector<HTMLSelectElement>(`[data-role="${role}"]`)!;el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));};
  const nav=(tab:string)=>document.querySelector<HTMLButtonElement>(`[data-action="workspace-tab"][data-tab="${tab}"]`)!.click();
  button('grid-endturn').click(); await idle();
  expect(request).not.toHaveBeenCalled();
  const after = SmallBattle.fromSnapshot(f.service.snapshot().battle!.snap);
  expect(after.round).toBe(2); expect(after.active?.id).toBe('u0');
  expect(after.actedThisTurn.has('u0')).toBe(false); expect(after.movementSpent.has('u0')).toBe(false);
  expect(after.byId('u1').pos).not.toBe(9);
  expect(document.querySelector('[data-role="jev-mode"]')).toBeNull();

  nav('settings');
  expect(document.querySelector<HTMLOptionElement>('[value="jev"]')!.disabled).toBe(true);
  expect(document.querySelector('[data-role="jev-relay"]')).toBeNull();
  input('llm-url','https://gateway.example/v1');input('llm-token','private-fixture-key');input('llm-window','2');
  button('llm-models').click();await vi.waitFor(()=>expect(readLlmSettings().models).toHaveLength(2));
  select('llm-model-list','model-two');select('llm-mode','llm');
  const scaleToggle=()=>document.querySelector<HTMLInputElement>('[data-role="llm-battle-scale"]')!;
  expect(scaleToggle().checked).toBe(false);expect(scaleToggle().disabled).toBe(false);
  scaleToggle().click();expect(readLlmSettings().selectBattleScale).toBe(true);scaleToggle().click();
  expect(readLlmSettings().selectBattleScale).toBe(false);
  const designToggle=()=>document.querySelector<HTMLInputElement>('[data-role="llm-map-design"]')!;
  const vipToggle=()=>document.querySelector<HTMLInputElement>('[data-role="llm-vip"]')!;
  expect(designToggle().checked).toBe(true);expect(vipToggle().checked).toBe(true);
  designToggle().click();expect(readLlmSettings()).toMatchObject({designMap:false,selectVip:true,selectBattleScale:false});
  vipToggle().click();expect(readLlmSettings()).toMatchObject({designMap:false,selectVip:false});
  designToggle().click();vipToggle().click();expect(readLlmSettings()).toMatchObject({designMap:true,selectVip:true});
  select('llm-mode','manual');expect(designToggle().disabled).toBe(true);expect(vipToggle().disabled).toBe(true);expect(scaleToggle().disabled).toBe(true);
  select('llm-mode','llm');expect(scaleToggle().checked).toBe(false);
  const config=localStorage.getItem(LLM_SETTINGS_KEY);
  expect(readLlmSettings()).toMatchObject({model:'model-two',windowSize:2,enabled:true});
  expect(request.mock.calls[0]![0]).toBe('/api/backends/chat-completions/status');
  expect(JSON.stringify(f.service.snapshot())).not.toContain('private-fixture-key');

  // Switch cards/chats, then delete the old card/chat. Global connection has no dependency on either.
  f.switchTo('b');f.context.characters!.push({avatar:'other.png',name:'Other'});f.context.characterId='1';await f.service.load();
  nav('settings');expect(localStorage.getItem(LLM_SETTINGS_KEY)).toBe(config);
  expect(scaleToggle().checked).toBe(false);
  f.disk.delete('a');f.chats.delete('a');f.context.characters!.splice(0,1);f.context.characterId='0';await f.service.load();
  expect(localStorage.getItem(LLM_SETTINGS_KEY)).toBe(config);
  expect(document.querySelector<HTMLInputElement>('[data-role="llm-token"]')!.value).toBe('private-fixture-key');
  await f.service.transact(()=>({schemaVersion:2,storage:units.map(u=>unitRecordFromCombatant(u)),rosterIds:units.map(u=>u.id),autoTurn:false,protagonistId:'u0'}));
  f.context.chat!.push({is_user:true,mes:'在森林迎敌。'}, {is_user:false,mes:'夜间，双方指挥官各有专长。',gen_finished:'done'});
  nav('battle');button('small-start').click();await idle();
  expect(f.service.snapshot().battle).toBeUndefined();
  expect(f.service.snapshot().storage![0]!.snapshot!.damageModel).not.toBe('wounds-v2');
  expect(button('migration-accept')).not.toBeNull();
  button('migration-accept').click();await idle();
  expect(f.service.snapshot().storage![0]!.snapshot!.damageModel).toBe('wounds-v2');
  // A layout answer that is not JSON fails only the second step. One start asks for it three times; the next start
  // still carries the failure back, even when the page was hidden in between.
  breakLayout=3;
  nav('battle');button('small-start').click();await idle();
  expect(f.service.snapshot().battle).toBeFalsy();expect(document.querySelector('#toast')?.textContent).toMatch(/布置地图.*有效布置 JSON.*已自动尝试3次/);
  window.dispatchEvent(new MessageEvent('message',{source:window.parent,origin:location.origin,data:{type:'tb:panel-hidden'}}));
  nav('battle');button('small-start').click();await idle();
  const retryTask=JSON.parse(String(request.mock.calls.at(-1)![1]?.body)).messages.at(-1).content as string;
  expect(retryTask).toContain('失败原因与改法：模型未返回有效布置 JSON。改法：只输出一个JSON对象');
  expect(f.service.snapshot().battle, document.querySelector('#toast')?.textContent ?? JSON.stringify(f.service.status())).toBeDefined();
  const selected=SmallBattle.fromSnapshot(f.service.snapshot().battle!.snap);
  expect(selected.commanderProfiles).toEqual({ally:{ability:'master',style:'aggressive',scoring:'tactical-v2'},enemy:{ability:'expert',style:'cautious',scoring:'tactical-v2'}});
  expect(f.service.snapshot()).toMatchObject({field:'forest',lighting:'night'});
  expect(selected.battlefield!.generation).toMatchObject({source:'context',scene:'field'});
  expect(selected.battlefield!.objective).toMatchObject({kind:'escape',unitId:'u1'});
  expect(Math.floor(selected.battlefield!.objective.cell/selected.battlefield!.width)).toBe(selected.battlefield!.height-1);
  expect(f.service.snapshot().encounterContext).toMatchObject({vipId:'u1',battlefieldPlan:{scene:'field',archetype:'forest_path'}});
  const frozen=structuredClone(f.service.snapshot().battle);
  nav('settings');designToggle().click();vipToggle().click();
  expect(f.service.snapshot().battle).toEqual(frozen);
  designToggle().click();vipToggle().click();nav('battle');
  expect(localStorage.getItem(LLM_SETTINGS_KEY)).toBe(config);
  expect(JSON.stringify(f.service.snapshot())).not.toContain('private-fixture-key');
  const payload=JSON.parse(String(request.mock.calls.at(-1)![1]?.body));
  expect(payload.model).toBe('model-two');expect(payload.messages[1].content).toMatch(/〔1 · 玩家〕[\s\S]*〔2 · 叙述〕/);
  const decided=JSON.parse(String(request.mock.calls.at(-2)![1]?.body)).messages.at(-1).content as string;
  expect(JSON.parse(decided.slice(decided.lastIndexOf('\n')+1)).fields.some((field:{id:string})=>field.id==='battle_mode')).toBe(false);

  // Any independent preparation toggle invalidates a pending response, never starts a stale battle.
  const beforeToggle=f.service.snapshot();await f.service.transact(()=>({...beforeToggle,battle:null,encounterContext:undefined}));
  for(const toggle of [scaleToggle,designToggle,vipToggle]) {
    delayed=true;request.mockClear();button('small-start').click();await vi.waitFor(()=>expect(request).toHaveBeenCalled());
    nav('settings');toggle().click();release?.();await idle();
    expect(f.service.snapshot().battle).toBeNull();
    toggle().click();expect(localStorage.getItem(LLM_SETTINGS_KEY)).toBe(config);nav('battle');
  }

  // Start a second preparation and switch chat before the model answers.
  const saved=f.service.snapshot();await f.service.transact(()=>({...saved,battle:null,encounterContext:undefined}));
  delayed=true;request.mockClear();button('small-start').click();await vi.waitFor(()=>expect(request).toHaveBeenCalled());
  expect(button('llm-stop')).not.toBeNull();
  f.switchTo('c');await f.service.load();release?.();await idle();
  expect(f.service.snapshot().battle).toBeUndefined();expect(localStorage.getItem(LLM_SETTINGS_KEY)).toBe(config);
  expect(f.disk.has('c')).toBe(false);
  // Broken optional model preferences must not take down either workspace.
  localStorage.setItem(LLM_SETTINGS_KEY, 'broken'); await f.service.load(); nav('settings');
  expect(document.body.textContent).toContain('原记录已保留'); nav('battle');
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('原记录已保留');
  expect(localStorage.getItem(LLM_SETTINGS_KEY)).toBe('broken');
  await f.service.transact(()=>({...beforeToggle,battle:null,encounterContext:undefined}));request.mockClear();
  nav('battle');button('small-start').click();await idle();
  expect(f.service.snapshot().battle).toBeDefined();expect(request).not.toHaveBeenCalled();
  expect(localStorage.getItem(LLM_SETTINGS_KEY)).toBe('broken');localStorage.setItem(LLM_SETTINGS_KEY, config!);
  // bfcache must not unsubscribe the panel from later archive updates.
  nav('units'); const cachedHide = new Event('pagehide'); Object.defineProperty(cachedHide, 'persisted', { value: true });
  window.dispatchEvent(cachedHide);
  await f.service.transact(() => ({ schemaVersion: 2, storage: units.map(u => unitRecordFromCombatant({ ...u, name: 'cached-' + u.name })), rosterIds: units.map(u => u.id) }));
  expect(document.body.textContent).toContain('cached-ally');
  f.service.dispose();
},15000);
