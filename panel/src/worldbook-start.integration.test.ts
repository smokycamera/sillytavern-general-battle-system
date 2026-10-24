// @vitest-environment happy-dom
import {afterEach,expect,it,vi} from 'vitest';
import {nativeFixture} from '../../runtime/tests/native-fixture.js';
import {createWorldbookSource} from '../../host/src/worldbooks.js';
import {generateUnit,SmallBattle} from '../../engine/src/index.js';
import {unitRecordFromCombatant} from './unit-state.js';
import {saveLlmSettings} from './llm-settings.js';
vi.mock('./panel-runtime.js',async()=>import('../../extension/src/panel-runtime.js'));
afterEach(()=>{window.dispatchEvent(new Event('pagehide'));vi.unstubAllGlobals();});

it('starts through the real button with no worldbooks, reports missing activation precisely, and then sends only captured entries',async()=>{
 const f=nativeFixture();f.context.eventTypes!.WORLD_INFO_ACTIVATED='WORLD_INFO_ACTIVATED';
 f.context.characters![0]!.data={extensions:{world:'角色书'}};f.context.powerUserSettings={};
 const worldbooks=createWorldbookSource(()=>f.context,vi.fn(),async()=>({world_info:{},selected_world_info:[]}));
 await f.service.start();localStorage.clear();
 const units=(['ally','enemy'] as const).map((side,i)=>{const u=generateUnit({name:side,side,scale:'hero',rulesVersion:'v2',damageModel:'wounds-v2',level:3,weaponClass:'sword',traits:[]},{seed:side}).unit;u.id='u'+i;return u;});
 await f.service.transact(()=>({schemaVersion:2,storage:units.map(u=>unitRecordFromCombatant(u)),rosterIds:units.map(u=>u.id),autoTurn:false,protagonistId:'u0'}));
 f.context.chat!.push({is_user:false,mes:'我方在南侧与北侧敌军交战。',gen_finished:'done'});
 saveLlmSettings({enabled:true,selectBattleScale:false,designMap:true,selectVip:false,windowSize:2,url:'https://gateway.example/v1',token:'fixture-key',model:'fixture',models:[],worldbookMode:'character',worldbooks:[{name:'不发送的手动书',entries:'all'}]});
 Object.assign(window,{__tavernBattleNative:{service:f.service,messages:{},worldbooks},__TAURITAVERN__:{},SillyTavern:{getContext:()=>f.context}});
 const bodies:any[]=[],request=vi.fn(async(_url:unknown,init?:RequestInit)=>{
  const body=JSON.parse(String(init?.body));bodies.push(body);const task=body.messages.at(-1).content as string;
  const values:Record<string,string>={field:'plains',lighting:'day',objective:'annihilation',siege_attacker:'ally',ally_ability:'regular',enemy_ability:'regular',ally_style:'balanced',enemy_style:'balanced',scene:'field',size:'compact'};
  const content=task.startsWith('【第1步')?{selections:Object.fromEntries(JSON.parse(task.slice(task.lastIndexOf('\n')+1)).fields.map((f:{id:string;options:Record<string,string>})=>[f.id,{value:values[f.id]??Object.keys(f.options)[0],confidence:.8}]))}:{ally:{at:['A4']},enemy:{at:['D1']}};
  return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(content)}}]}));
 });
 vi.stubGlobal('fetch',request);document.body.innerHTML='<div id="app"></div><div id="toast"></div>';await import('./main.js');
 const start=()=>document.querySelector<HTMLButtonElement>('[data-action="small-start"]')!.click();
 const idle=()=>vi.waitFor(()=>expect(document.body.getAttribute('aria-busy')).not.toBe('true'),{timeout:5000});
 start();await idle();expect(f.service.snapshot().battle).toBeFalsy();expect(request).not.toHaveBeenCalled();
 expect(document.querySelector('#toast')?.textContent).toContain('尚未取得当前聊天的世界书激活结果');
 expect(document.querySelector('#toast')?.textContent).not.toContain('模型请求或返回格式无效');
 f.context.characters![0]!.data!.extensions!.world='';start();await idle();
 expect(f.service.snapshot().battle).toBeDefined();expect(bodies).toHaveLength(2);
 for(const body of bodies)expect(body.messages).toHaveLength(3);
 const snapshot=f.service.snapshot();await f.service.transact(()=>({...snapshot,battle:null,encounterContext:undefined}));
 f.context.characters![0]!.data!.extensions!.world='角色书';
 await f.emit('GENERATION_STARTED','normal',{},false);
 await f.emit('WORLD_INFO_ACTIVATED',[{world:'角色书',uid:1,comment:'本轮命中',content:'本轮激活内容'},{world:'角色书',uid:2,content:'禁用条目',disable:true}]);
 await f.emit('GENERATION_ENDED');start();await idle();
 expect(f.service.snapshot().battle).toBeDefined();expect(bodies).toHaveLength(4);
 for(const body of bodies.slice(2)){
  expect(JSON.parse(body.messages[2].content)).toEqual({worldbooks:[{name:'角色书',entries:[{id:'1',title:'本轮命中',content:'本轮激活内容'}]}]});
  expect(JSON.stringify(body)).not.toMatch(/不发送的手动书|禁用条目/);
 }
 const battle=SmallBattle.fromSnapshot(f.service.snapshot().battle!.snap);expect(SmallBattle.fromSnapshot(battle.toSnapshot()).toSnapshot()).toEqual(battle.toSnapshot());
 worldbooks.dispose!();f.service.dispose();
},15000);
