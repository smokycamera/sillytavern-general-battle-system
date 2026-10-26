// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { nativeFixture } from '../../runtime/tests/native-fixture.js';
import { grantTraitSource, traitRegistry } from '../../engine/src/index.js';
import { buildUnit, newUnitDraft } from './unit-builder.js';
import { unitRecordFromCombatant } from './unit-state.js';
import { grantStoryEffects } from './story-effects.js';
import { parseAbilitySpec } from './tags.js';
vi.mock('./panel-runtime.js', async () => import('../../extension/src/panel-runtime.js'));
afterEach(() => { window.dispatchEvent(new Event('pagehide')); vi.unstubAllGlobals(); });

it('unit details hide revoked and expired effects and remove a newly revoked effect immediately', async () => {
  const f=nativeFixture();await f.service.start();localStorage.clear();
  try {
    const draft=newUnitDraft();draft.name='效果显示检查';const unit=buildUnit(draft,traitRegistry(),'effect-visibility');
    for(const id of ['live','revoked','expired']) grantTraitSource(unit,{id,name:'来源-'+id,kind:'effect',traitIds:[],conditionIds:['cursed'],duration:{kind:'battles',count:2}});
    grantStoryEffects(unit,parseAbilitySpec('剧情战意:buffL3+攻击L3'),{kind:'battles',count:2},'visibility');
    unit.traitSources!.find(s=>s.id==='revoked')!.revoked=true;unit.traitSources!.find(s=>s.id==='expired')!.remaining=0;
    await f.service.transact(()=>({schemaVersion:2,storage:[unitRecordFromCombatant(unit)],rosterIds:[unit.id]}));
    Object.assign(window,{__tavernBattleNative:{service:f.service,messages:{}},__TAURITAVERN__:{},SillyTavern:{getContext:()=>f.context}});
    document.body.innerHTML='<div id="app"></div><div id="toast"></div>';await import('./main.js');
    const click=async(selector:string)=>{const button=document.querySelector<HTMLButtonElement>(selector);expect(button,selector).not.toBeNull();button!.click();await vi.waitFor(()=>expect(document.body.getAttribute('aria-busy')).not.toBe('true'),{timeout:5000});};
    await click('[data-action="workspace-tab"][data-tab="units"]');await click(`[data-action="unit-detail"][data-id="${unit.id}"]`);
    expect(document.body.textContent).not.toContain('未能完整迁移');
    expect(document.body.textContent).not.toContain('效果来源记录损坏');
    expect(document.querySelector('[data-role="trait-sources"]')!.textContent).toContain('剧情战意');
    expect(document.querySelector('[data-role="trait-sources"]')!.textContent).toContain('来源-live');
    expect(document.body.textContent).not.toContain('来源-revoked');expect(document.body.textContent).not.toContain('来源-expired');
    await click('[data-action="trait-source-revoke"][data-source="live"]');
    await click('[data-action="trait-source-revoke"][data-source="effect:visibility:0"]');
    await vi.waitFor(()=>expect(document.querySelector('[data-role="trait-sources"]')).toBeNull());
    expect(f.service.snapshot().storage![0]!.snapshot!.traitSources!.find(s=>s.id==='live')!.revoked).toBe(true);
    expect(f.service.snapshot().storage![0]!.conditions).toEqual([]);
    await f.service.load(); expect(f.service.status().phase).toBe('ready');
  } finally {f.service.dispose();}
},30000);
