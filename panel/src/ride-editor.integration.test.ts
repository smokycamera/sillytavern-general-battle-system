// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import { generateUnit, SmallBattle, standardField, V42_OVERFLOW_D20 } from '../../engine/src/index.js';
import { nativeFixture } from '../../runtime/tests/native-fixture.js';
import { knownBattleUnits } from './battle-reports.js';
import { unitRecordFromCombatant } from './unit-state.js';
vi.mock('./panel-runtime.js', async () => import('../../extension/src/panel-runtime.js'));

it('从队伍载具卡装载，在配装乘员卡离开，再绑定并从载具卡解绑', async () => {
  const f = nativeFixture();
  await f.service.start();
  localStorage.clear();
  const make = (id: string) => {
    const {unit} = generateUnit({name:id,side:'ally',scale:'hero',level:4,rulesVersion:'v2',traits:[]}, {seed:id});
    unit.id = id;
    if (id === 'carrier') { unit.body = 'vehicle'; unit.platform = {kind:'transport',power:4}; unit.seats = 4; }
    return unitRecordFromCombatant(unit);
  };
  await f.service.transact(() => ({schemaVersion:2,storage:[make('rider'),make('carrier')],rosterIds:['rider','carrier']}));
  Object.assign(window,{__tavernBattleNative:{service:f.service,messages:{}},__TAURITAVERN__:{},SillyTavern:{getContext:()=>f.context}});
  document.body.innerHTML = '<div id="app"></div><div id="toast"></div>';
  const click = (selector: string) => {
    const button = document.querySelector<HTMLButtonElement>(selector);
    expect(button,selector).toBeTruthy(); button!.click();
  };
  const ride = () => f.service.snapshot().storage?.find(r => r.id === 'rider')?.snapshot?.ride;
  try {
    await import('./main.js');
    click('[data-action="workspace-tab"][data-tab="units"]');
    click('.ride-editor[data-carrier="carrier"] [data-mode="aboard"]');
    await vi.waitFor(() => expect(ride()).toEqual({platformId:'carrier',mode:'aboard'}));
    click('[data-action="workspace-tab"][data-tab="inventory"]');
    click('#inventory-panel .ride-editor button[data-rider="rider"]');
    await vi.waitFor(() => expect(ride()).toBeUndefined());
    click('#inventory-panel .ride-editor [data-mode="mount"]');
    await vi.waitFor(() => expect(ride()?.mode).toBe('mount'));
    click('[data-action="workspace-tab"][data-tab="units"]');
    expect(document.querySelectorAll('.team-transport-group [data-unit]')).toHaveLength(2);
    click('.ride-editor[data-carrier="carrier"] button[data-rider="rider"]');
    await vi.waitFor(() => expect(ride()).toBeUndefined());
    expect(document.querySelector('.ride-editor[data-carrier="carrier"]')?.textContent).toContain('已用 0 / 4 席');

    const [rider, carrier, opponent, hidden] = ['rider','carrier','opponent','hidden'].map(id => make(id).snapshot!);
    rider!.ride = {platformId:'carrier',mode:'aboard'};
    opponent!.side = hidden!.side = 'enemy';
    opponent!.body = 'vehicle'; opponent!.platform = {kind:'transport',power:4}; opponent!.seats = 4;
    hidden!.ride = {platformId:'opponent',mode:'aboard'};
    const battle = new SmallBattle({combatants:[rider!,carrier!,opponent!,hidden!],battlefield:standardField(),rules:V42_OVERFLOW_D20,seed:'live-team'});
    battle.start();
    const known = knownBattleUnits(battle).map(u => u.id);
    expect(known).toContain('rider'); expect(known).not.toContain('hidden');
    await f.service.transact(current => ({...current,battle:{kind:'small',snap:battle.toSnapshot()}}));
    click('[data-action="workspace-tab"][data-tab="units"]');
    expect(document.querySelector('.team-transport-group [data-unit="rider"]')).toBeTruthy();
    expect(document.querySelector('.team-workspace [data-unit="hidden"]')).toBeNull();
  } finally { window.dispatchEvent(new Event('pagehide')); }
});
