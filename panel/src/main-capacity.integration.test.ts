// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { nativeFixture } from '../../runtime/tests/native-fixture.js';
import { generateUnit, SmallBattle, V11_OVERFLOW_D20 } from '../../engine/src/index.js';
import { unitRecordFromCombatant } from './unit-state.js';
vi.mock('./panel-runtime.js', async () => import('../../extension/src/panel-runtime.js'));
afterEach(()=>{window.dispatchEvent(new Event('pagehide'));vi.unstubAllGlobals();});
it('native panel starts 32-card tactics and 33/64-card mass through the actual save transaction', async()=>{
  const f=nativeFixture();await f.service.start();localStorage.clear();
  const units=Array.from({length:64},(_,i)=>{const side=i%2?'enemy':'ally';const u=generateUnit({name:'card'+i,side,scale:'hero',level:3,rulesVersion:'v2',weaponClass:'blunt',traits:[]},{seed:'native-capacity'+i,noVariance:true}).unit;u.id='card'+i;return u;});
  // Materialize current combat/resource specifications without starting or assigning positions.
  new SmallBattle({combatants:units,rules:V11_OVERFLOW_D20});
  Object.assign(window,{__tavernBattleNative:{service:f.service,messages:{}},__TAURITAVERN__:{},SillyTavern:{getContext:()=>f.context}});
  const request=vi.fn(()=>Promise.reject(Error('unexpected model call')));vi.stubGlobal('fetch',request);
  document.body.innerHTML='<div id="app"></div><div id="toast"></div>';
  await f.service.transact(()=>({schemaVersion:2,storage:units.map(u=>unitRecordFromCombatant(u)),rosterIds:units.slice(0,32).map(u=>u.id),autoTurn:false,protagonistId:units[0]!.id}));
  await import('./main.js');
  for(const count of [32,33,64]) {
    await f.service.transact(()=>({schemaVersion:2,storage:units.map(u=>unitRecordFromCombatant(u)),rosterIds:units.slice(0,count).map(u=>u.id),autoTurn:false,protagonistId:units[0]!.id}));
    document.querySelector<HTMLButtonElement>('[data-action="workspace-tab"][data-tab="battle"]')!.click();
    const kind=count<=32?'small':'mass',button=document.querySelector<HTMLButtonElement>(`[data-action="${kind}-start"]`);
    expect(button).not.toBeNull();expect(button!.disabled).toBe(false);button!.click();
    await vi.waitFor(()=>expect(document.body.getAttribute('aria-busy')).not.toBe('true'),{timeout:15000});
    expect(f.service.snapshot().battle,document.querySelector('#toast')?.textContent??'').toMatchObject({kind});
    const snap=f.service.snapshot().battle!.snap as any;
    expect(snap.combatants).toHaveLength(count);expect(snap.combatants.every((u:any)=>u.scale==='hero')).toBe(true);
    if(count>32)expect(snap.formationSlots).toBeGreaterThanOrEqual(3);
    expect(f.service.snapshot().storage).toHaveLength(64);
  }
  expect(request).not.toHaveBeenCalled();f.service.dispose();
},60000);
