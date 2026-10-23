// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { nativeFixture } from '../../runtime/tests/native-fixture.js';
import { generateUnit, SmallBattle, standardField, V29_OVERFLOW_D20 } from '../../engine/src/index.js';
import { unitRecordFromCombatant } from './unit-state.js';
import { captureBattleArchive, captureBattleStart, stampNewBattleReports } from './report-history.js';
import { LLM_SETTINGS_KEY } from './llm-settings.js';
import type { LlmEncounterContext } from './llm-context.js';
import type { NarrativeSave } from './narrative-state.js';
vi.mock('./panel-runtime.js', async () => import('../../extension/src/panel-runtime.js'));
afterEach(() => { window.dispatchEvent(new Event('pagehide')); vi.unstubAllGlobals(); });

it('restarts archived LLM battles through the UI, resumes command, and prepares missing legacy commanders before AI acts', async () => {
  const f=nativeFixture();await f.service.start();localStorage.clear();
  const units=(['ally','enemy'] as const).map((side,i)=>{
    const unit=generateUnit({name:side,side,scale:'hero',rulesVersion:'v2',numericModel:'graded-v1',loadModel:'capacity-v2',level:4,weaponClass:'sword',hpMax:200,traits:[]},{seed:side,noVariance:true}).unit;
    unit.id='u'+i;return unit;
  });
  const field=standardField(7,13);field.tiles.fill('open');
  const battle=new SmallBattle({combatants:units,battlefield:field,rules:V29_OVERFLOW_D20,seed:'original'});
  battle.start();battle.turnOrder=['u0','u1'];battle.turnIndex=0;battle.combatants.forEach((u,i)=>u.pos=35+i*4);
  const context={mode:'small',field:'plains',lighting:'day',mapLayout:'standard',enemy:{ability:'normal',source:'manual',style:{}},messageKey:'',detail:'',
    llmCommanders:{enemy:{battleSeed:battle.seed,side:'enemy',brief:{name:'原指挥官',persona:'谨慎',mission:'守住阵地',known:[]},memory:{plan:'开局计划',notes:['开局笔记'],terrain:[]}}}} as unknown as LlmEncounterContext;
  const before: NarrativeSave={schemaVersion:2,storage:units.map(u=>unitRecordFromCombatant(u)),rosterIds:units.map(u=>u.id),protagonistId:'u0',inventory:[],autoTurn:false};
  const start=captureBattleStart(battle,captureBattleArchive(before),context);
  battle.finishBattle('ceasefire');
  const closed: NarrativeSave={...before,factRevision:1,battle:null,committedOutcomeIds:[start.battleId],
    reports:[{id:start.battleId,card:'结算',digest:'过程',summary:'状态',deliveries:{},start}]};
  stampNewBattleReports(before,closed);
  await f.service.transact(()=>closed);
  localStorage.setItem(LLM_SETTINGS_KEY,JSON.stringify({enabled:true,commandEnemy:true,designMap:false,selectVip:false,url:'https://fixture.invalid/v1',token:'',model:'fixture',models:[]}));
  Object.assign(window,{__tavernBattleNative:{service:f.service,messages:{}},__TAURITAVERN__:{},SillyTavern:{getContext:()=>f.context}});
  let preparations=0,commands=0;
  vi.stubGlobal('fetch',vi.fn(async (_url:unknown,init?:RequestInit)=>{
    const payload=JSON.parse(String(init?.body));
    if(!payload.tools){
      preparations++;
      return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({name:'重建指挥官',persona:'谨慎',mission:'守住阵地',known:[]})}}]}));
    }
    commands++;
    const data=JSON.parse(payload.messages.filter((m:any)=>m.role==='user').at(-1).content);
    return new Response(JSON.stringify({choices:[{message:{tool_calls:[
      {id:'plan',type:'function',function:{name:'commander_plan',arguments:JSON.stringify({plan:'继续LLM指挥',addNotes:['正在指挥']})}},
      {id:'intents',type:'function',function:{name:'commander_intents',arguments:JSON.stringify({intents:data.forces.map((u:any)=>({unit:u.id,mode:'hold',cell:u.pos}))})}},
    ]}}]}));
  }));
  document.body.innerHTML='<div id="app"></div><div id="toast"></div>';
  await import('./main.js');
  const idle=()=>vi.waitFor(()=>expect(document.body.getAttribute('aria-busy')).not.toBe('true'),{timeout:10000});
  const click=async(selector:string)=>{const button=document.querySelector<HTMLButtonElement>(selector);expect(button,selector+' '+document.body.textContent?.slice(-1500)).not.toBeNull();expect(button!.disabled,button!.outerHTML).toBe(false);button!.click();await idle();};
  for(const legacy of [false,true]){
    if(legacy){const old=structuredClone(closed);delete old.reports![0]!.start!.encounterContext;await f.service.transact(()=>old);await idle();}
    await click('[data-action="workspace-tab"][data-tab="reports"]');
    await click('[data-action="report-restart"]');
    await click('[data-action="report-restart-confirm"]');
    await vi.waitFor(()=>expect(f.service.snapshot().battle).toBeTruthy());await idle();
    const saved=f.service.snapshot(),command=(saved.encounterContext as LlmEncounterContext).llmCommanders!.enemy!;
    expect(command.battleSeed).toBe(saved.battle!.snap.seed);
    const disk=f.disk.get('a')!.tavernBattle as {payload:NarrativeSave};
    expect((disk.payload.encounterContext as LlmEncounterContext).llmCommanders!.enemy!.battleSeed).toBe(saved.battle!.snap.seed);
    expect(disk.payload.activeBattleStart!.encounterContext).toEqual(disk.payload.encounterContext);
    expect(command.brief.name).toBe(legacy?'重建指挥官':'原指挥官');
    expect(preparations).toBe(legacy?1:0);
    await click('[data-action="llm-notes"]');
    expect(document.querySelector('[aria-labelledby="llm-notes-title"]')!.textContent).toContain(command.brief.name);
    await click('button[data-action="llm-notes-close"]');
    const previous=commands;await click('[data-action="grid-endturn"]');
    await vi.waitFor(()=>expect(commands).toBeGreaterThan(previous));await idle();
    expect((f.service.snapshot().encounterContext as LlmEncounterContext).llmCommanders!.enemy!.memory.plan).toBe('继续LLM指挥');
  }
  f.service.dispose();
},30000);
