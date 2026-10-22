import { afterEach, expect, it, vi } from 'vitest';
import { generateUnit, SmallBattle, standardField, V24_OVERFLOW_D20, MassBattle, V24_OVERFLOW_TW, createStructure, sendPlayerLetter } from '../../engine/src/index.js';
import { LlmCommandController, commandObservation, commanderTool, emptyCommandMemory, type CommanderState } from './llm-command.js';
import { COMMAND_PROMPTS } from './llm-command-prompts.js';
import { LlmIntentPlanner, intentForces } from './llm-intents.js';
import { savedCommanderState } from './llm-save-context.js';
import type { LlmSettings } from './llm-settings.js';
afterEach(() => vi.useRealTimers());
const settings: LlmSettings = { enabled: true, commandEnemy: true, selectBattleScale: false, designMap: false, windowSize: 6, model: 'fixture', url: 'https://example.invalid/v1', token: 'fixture', models: [] };
function fixture() {
  const field = standardField(7,13); field.tiles.fill('open'); field.layerVersion=1; field.structures=field.tiles.map(()=>null);
  const combatants = ['ally','enemy','enemy','enemy','enemy','enemy'].map((side,i) => {
    const u = generateUnit({ name: '队'+i, side: side as 'ally'|'enemy', scale: i === 1 ? 'hero' : 'company', hpMax: 40, rulesVersion: 'v2', level: 4, weaponClass: 'rifle', weaponLevel: 4, armorTier: 1, traits: [] }, { seed: 'planner'+i, noVariance: true }).unit;
    u.id='u'+i; return u;
  });
  const b=new SmallBattle({combatants,battlefield:field,rules:V24_OVERFLOW_D20,seed:'planner'}); b.start(); combatants.forEach((u,i)=>u.pos=[78,14,15,16,21,22][i]);
  b.turnOrder=['u2','u3','u1','u4','u5','u0'];b.turnIndex=0;
  const state:CommanderState={battleSeed:b.seed,side:'enemy',brief:{name:'守备官',persona:'谨慎',known:[],mission:'保持阵地'},memory:emptyCommandMemory()};
  return {b,state};
}
const reply=(args:unknown)=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(args)}}]}));
const reviewedReply=(args:unknown)=>new Response(JSON.stringify({choices:[{message:{tool_calls:[
  {id:'review',type:'function',function:{name:'commander_plan',arguments:JSON.stringify({addNotes:['已判断来信：部分采纳，但保留警戒以防失信。']})}},
  {id:'intent',type:'function',function:{name:'commander_intents',arguments:JSON.stringify(args)}}]}}]}));
const data=(init?:RequestInit)=>JSON.parse(JSON.parse(String(init?.body)).messages[1].content);
const holds=(init?:RequestInit)=>({intents:data(init).forces.map((u:any)=>({unitId:u.id,mode:'hold',cell:u.pos}))});
function setup(request:typeof fetch) { const {b,state}=fixture(), c=new LlmCommandController(COMMAND_PROMPTS,()=>{},request), p=new LlmIntentPlanner(c,COMMAND_PROMPTS);return {b,state,c,p}; }
it('delivers letters at the recipients next activation, replaces a current-round plan once and preserves the read cursor after load',async()=>{
  const bodies:any[]=[];const request:typeof fetch=async(_url,init)=>{bodies.push(data(init));return data(init).letters?.length?reviewedReply(holds(init)):reply(holds(init));};
  const {b,state,c,p}=setup(request);p.prefetch(b,state,settings,()=>true);await p.beforeHero();
  b.turnIndex=5;sendPlayerLetter(b,['enemy'],'请重新考虑守桥计划。');c.receiveLetter(b,settings);
  p.prefetch(b,state,settings,()=>true);await p.beforeHero();expect(bodies).toHaveLength(1);
  b.turnIndex=0;await p.forUnit(b,state,settings,()=>true);
  expect(bodies).toHaveLength(2);expect(bodies[1].letters).toEqual([{id:1,round:1,from:'opponent-1',text:'请重新考虑守桥计划。'}]);
  expect(state.memory.letterId).toBe(1);b.turnIndex=1;await p.forUnit(b,state,settings,()=>true);expect(bodies).toHaveLength(2);
  const loaded=SmallBattle.fromSnapshot(structuredClone(b.toSnapshot())), saved=savedCommanderState(state)!;
  const restored=new LlmIntentPlanner(new LlmCommandController(COMMAND_PROMPTS,()=>{},request),COMMAND_PROMPTS);
  await restored.forUnit(loaded,saved,settings,()=>true);expect(bodies).toHaveLength(2);
});
it('merges a letter on the last faction activation of round 6 with round 7, including after load, and resumes normal calls in round 8', async()=>{
  const bodies:any[]=[];
  const request:typeof fetch=async(_url,init)=>{bodies.push(data(init));return data(init).letters?.length?reviewedReply(holds(init)):reply(holds(init));};
  const {b,state,p}=setup(request);b.round=6;b.turnIndex=4;
  sendPlayerLetter(b,['enemy'],'缴枪不杀！！！');await p.forUnit(b,state,settings,()=>true);
  expect(bodies).toHaveLength(1);expect(state.memory.intents?.carryRound).toBe(7);
  const saved=savedCommanderState(state)!;
  b.endTurn();p.prefetch(b,state,settings,()=>true);await p.beforeHero();expect(bodies).toHaveLength(1);
  b.endTurn();expect(b.round).toBe(7);
  const restored=new LlmIntentPlanner(new LlmCommandController(COMMAND_PROMPTS,()=>{},request),COMMAND_PROMPTS);
  expect(await restored.forUnit(b,saved,settings,()=>true)).toMatchObject({mode:'hold'});
  b.turnIndex=1;await restored.forUnit(b,saved,settings,()=>true);
  expect(bodies).toHaveLength(1);expect(saved.memory.intents).toMatchObject({round:7});expect(saved.memory.intents).not.toHaveProperty('carryRound');
  expect(saved.memory.letterId).toBe(1);expect(saved.memory.notes).toHaveLength(1);
  b.round=8;await restored.forUnit(b,saved,settings,()=>true);expect(bodies.map(body=>body.round)).toEqual([6,8]);
});
it('defers unused prefetch after a faction has finished, and delivers a round-end letter in its single next-round request', async()=>{
  const bodies:any[]=[];
  const {b,state,p}=setup(async(_url,init)=>{bodies.push(data(init));return reviewedReply(holds(init));});
  b.round=6;b.turnIndex=5;p.prefetch(b,state,settings,()=>true);await p.beforeHero();expect(bodies).toHaveLength(0);
  sendPlayerLetter(b,['enemy'],'下一轮请重新考虑。');p.prefetch(b,state,settings,()=>true);await p.beforeHero();expect(bodies).toHaveLength(0);
  b.endTurn();await p.forUnit(b,state,settings,()=>true);
  expect(bodies).toHaveLength(1);expect(bodies[0]).toMatchObject({round:7,letters:[{text:'下一轮请重新考虑。'}]});
  expect(state.memory.intents).not.toHaveProperty('carryRound');
});
it.each(['letter','diplomacy','roster','opponent'] as const)('does not reuse a boundary plan after new %s information', async(change)=>{
  const bodies:any[]=[];
  const {b,state,p}=setup(async(_url,init)=>{bodies.push(data(init));return data(init).letters?.length?reviewedReply(holds(init)):reply(holds(init));});
  b.round=6;b.turnIndex=4;sendPlayerLetter(b,['enemy'],'请考虑停战。');await p.forUnit(b,state,settings,()=>true);
  b.round=7;b.turnIndex=0;
  if(change==='letter')sendPlayerLetter(b,['enemy'],'补充：撤军条件有变化。');
  if(change==='diplomacy')b.diplomacy.revision++;
  if(change==='roster')b.byId('u5').status='dead';
  if(change==='opponent'){const opponent=structuredClone(b.byId('u0'));opponent.id='new-opponent';b.combatants.push(opponent);}
  await p.forUnit(b,state,settings,()=>true);expect(bodies.map(body=>body.round)).toEqual([6,7]);
  if(change==='letter')expect(bodies[1].letters[0].text).toBe('补充：撤军条件有变化。');
});
it('does not extend a mid-round letter replan into the next battle round',async()=>{
  const bodies:any[]=[];
  const {b,state,p}=setup(async(_url,init)=>{bodies.push(data(init));return data(init).letters?.length?reviewedReply(holds(init)):reply(holds(init));});
  b.round=6;sendPlayerLetter(b,['enemy'],'请考虑撤离。');await p.forUnit(b,state,settings,()=>true);
  expect(state.memory.intents).not.toHaveProperty('carryRound');b.round=7;await p.forUnit(b,state,settings,()=>true);
  expect(bodies.map(body=>body.round)).toEqual([6,7]);
});
it('T4 plans heroes and troops together, including a roster of at most three units', async()=>{
  const request=vi.fn(async(_url,init)=>{const d=data(init);return reply(d.forces?holds(init):{choice:d.choices.find((c:any)=>c.action.type==='end_turn').id});}) as unknown as typeof fetch;
  const {b,state,c,p}=setup(request);p.prefetch(b,state,settings,()=>true);await p.beforeHero();
  await p.forUnit(b,state,settings,()=>true);b.turnIndex=1;await p.forUnit(b,state,settings,()=>true);b.turnIndex=2;await p.forUnit(b,state,settings,()=>true);
  expect([Object.keys(state.memory.intents!.units).length,(request as any).mock.calls.length,intentForces(b,'enemy').heroes]).toEqual([5,1,[]]);
  b.combatants.splice(3); b.turnOrder=['u1','u2','u0']; b.turnIndex=0;
  delete state.memory.intents; p.prefetch(b,state,settings,()=>true); await p.beforeHero();
  expect(Object.keys(state.memory.intents!.units)).toEqual(['u1','u2']);
});
it('T5 starts prefetch immediately and joins it without another request', async()=>{
  let release!:(r:Response)=>void;let init:RequestInit|undefined;
  const request=vi.fn((_url,body)=>{init=body;return new Promise<Response>(r=>{release=r;});}) as unknown as typeof fetch;
  const {b,state,p}=setup(request);
  state.memory.intents={round:b.round-1,replanned:false,basis:{visible:[],friends:[]},units:{u2:{mode:'withdraw',cell:0}}};
  let settled=false;p.prefetch(b,state,settings,()=>true);const pending=p.forUnit(b,state,settings,()=>true).then(intent=>{settled=true;return intent;});
  await vi.waitFor(()=>expect(release).toBeDefined());expect(settled).toBe(false);release(reply(holds(init)));const intent=await pending;
  expect([(request as any).mock.calls.length,intent?.mode,intent?.cell,state.memory.intents.round]).toEqual([1,'hold',15,b.round]);
});
it('T6 replans once for a new opponent and never twice in a round', async()=>{
  const request=vi.fn(async(_url,init)=>reply(holds(init))) as unknown as typeof fetch; const {b,state,p}=setup(request);
  const visible=b.visibleCombatants.bind(b);let spotted=false;
  vi.spyOn(b,'visibleCombatants').mockImplementation(side=>visible(side).filter(u=>u.side==='enemy'||spotted));
  const situational={...settings,commandInterval:'situation' as const};
  p.prefetch(b,state,situational,()=>true);await p.beforeHero();spotted=true;await p.forUnit(b,state,situational,()=>true);
  b.byId('u5').status='dead';await p.forUnit(b,state,situational,()=>true);
  expect([(request as any).mock.calls.length,state.memory.intents!.replanned]).toEqual([2,true]);
});
it('keeps one deployment for the whole battle round by default and refreshes on the next round', async()=>{
  const request=vi.fn(async(_url,init)=>reply(holds(init))) as unknown as typeof fetch;
  const {b,state,p}=setup(request);
  const visible=b.visibleCombatants.bind(b);let spotted=false;
  vi.spyOn(b,'visibleCombatants').mockImplementation(side=>visible(side).filter(u=>u.side==='enemy'||spotted));
  p.prefetch(b,state,settings,()=>true);await p.beforeHero();spotted=true;
  for(const turn of [0,1,2]) { b.turnIndex=turn;await p.forUnit(b,state,settings,()=>true); }
  b.byId('u5').status='dead';await p.forUnit(b,state,settings,()=>true);
  expect(request).toHaveBeenCalledTimes(1);
  b.round++;await p.forUnit(b,state,settings,()=>true);expect(request).toHaveBeenCalledTimes(2);
});
it('sends editable parameters consistently across tool continuations, saved state and battle rounds', async()=>{
  const bodies:any[]=[];
  const request=(async(_url,init)=>{
    bodies.push(JSON.parse(String(init?.body)));
    if(bodies.length===1) return new Response(JSON.stringify({choices:[{message:{content:null,tool_calls:[{id:'plan',type:'function',function:{name:'commander_plan',arguments:'{"plan":"固守"}'}}]}}]}));
    return reply(holds(init));
  }) as typeof fetch;
  const {b,state,p}=setup(request), custom={...settings,commandThinking:'off' as const,commandThinkingOffParams:'{"enable_thinking":false,"vendor":{"effort":"low"}}'};
  p.prefetch(b,state,custom,()=>true);await p.beforeHero();
  expect(bodies.map(body=>body.enable_thinking)).toEqual([false,false]);
  expect(bodies.every(body=>body.vendor.effort==='low'&&!('thinking' in body))).toBe(true);
  const saved=savedCommanderState(state)!;delete saved.memory.intents;
  const c=new LlmCommandController(COMMAND_PROMPTS,()=>{},request), restored=new LlmIntentPlanner(c,COMMAND_PROMPTS);
  restored.prefetch(b,saved,custom,()=>true);await restored.beforeHero();
  expect(bodies.at(-1)).toMatchObject({enable_thinking:false,vendor:{effort:'low'}});
  b.round++;restored.prefetch(b,saved,{...custom,commandThinking:'auto'},()=>true);await restored.beforeHero();
  expect(bodies.at(-1)).not.toHaveProperty('enable_thinking');expect(bodies.at(-1)).not.toHaveProperty('vendor');
});
it('pauses immediately when the player routs and resumes only the battle round after recovery, also after load', async()=>{
  const request=vi.fn(async(_url,init)=>reply(holds(init))) as unknown as typeof fetch;
  const {b,state,c,p}=setup(request);
  p.prefetch(b,state,settings,()=>true);await p.beforeHero();
  b.byId('u0').status='routing';expect(c.available(b,settings,state)).toBe(false);
  expect(state.memory.intents).toBeUndefined();
  b.round++;expect(await p.forUnit(b,state,settings,()=>true)).toBeUndefined();expect(request).toHaveBeenCalledTimes(1);
  b.byId('u0').status='ready';expect(c.available(b,settings,state)).toBe(false);
  const saved=savedCommanderState(state)!;
  const loaded=new LlmCommandController(COMMAND_PROMPTS,()=>{},request);
  expect(loaded.available(b,settings,saved)).toBe(false);
  b.round++;expect(loaded.available(b,settings,saved)).toBe(true);
  const resumed=new LlmIntentPlanner(loaded,COMMAND_PROMPTS);resumed.prefetch(b,saved,settings,()=>true);await resumed.beforeHero();
  expect(request).toHaveBeenCalledTimes(2);expect(saved.playerFallback).toBeUndefined();
});
it('T7 retains valid entries, reports errors and ends after a second submission', async()=>{
  const bodies:any[]=[];const request=vi.fn(async(_url,init)=>{bodies.push(JSON.parse(String(init?.body)));return reply({intents:[{unitId:'u2',mode:'hold',cell:15},{unitId:'foreign',mode:'attack',targetId:'hidden'}]});}) as unknown as typeof fetch;
  const {b,state,p}=setup(request);p.prefetch(b,state,settings,()=>true);await p.beforeHero();b.turnIndex=1;
  expect([bodies.length,JSON.parse(bodies[1].messages.at(-1).content).missing,await p.forUnit(b,state,settings,()=>true)]).toEqual([2,['u1','u3','u4','u5'],undefined]);
  expect(bodies[1].messages.at(-2).content).toContain('foreign');
  expect(JSON.parse(bodies[1].messages.at(-1).content).errors.length).toBeGreaterThan(0);
});
it('uses short fields and IDs, corrects malformed replies, and accepts exploration, gates and specified abilities', async()=>{
  const {b,state}=fixture();
  const renamed = new Map(b.combatants.map(u => [u.id, 'long-real-unit-identity-'+u.id]));
  b.combatants.forEach(u => { u.id=renamed.get(u.id)!; }); b.turnOrder=b.turnOrder.map(id=>renamed.get(id)!);
  const actor=b.byId(renamed.get('u2')!); actor.abilities.push({id:'long-real-ability-identity',name:'守护',target:'ally',range:{min:0,max:2,metric:'grid'},effects:[{op:'condition',conditionId:'blessed',dur:3}]}); actor.preparedAbilityIds=['long-real-ability-identity'];
  sendPlayerLetter(b,['enemy'],actor.id);
  b.battlefield!.structures![23]=createStructure('gate',3,{owner:'enemy',gateState:'closed'});
  vi.spyOn(b,'visibleCells').mockImplementation(()=>b.battlefield!.tiles.map((_,i)=>i===23||b.combatants.some(u=>u.side==='enemy'&&u.pos===i)));
  const bodies:any[]=[];let shortUnit='',shortSkill='';
  const request=(async(_url,init)=>{
    const body=JSON.parse(String(init?.body)); bodies.push(body); const d=JSON.parse(body.messages[1].content);
    expect(d.letters[0]).toMatchObject({from:'opponent-1',text:actor.id});
    if(bodies.length===1) return new Response(JSON.stringify({choices:[{message:{content:'wrong-json-reply'}}]}));
    if(bodies.length===2) {
      shortUnit=d.forces[1].id; expect(shortUnit).toMatch(/^u\d+$/);
      return new Response(JSON.stringify({choices:[{message:{content:null,tool_calls:[{id:'unit-query',type:'function',function:{name:'commander_unit',arguments:JSON.stringify({unitId:shortUnit})}}]}}]}));
    }
    const queried=JSON.parse(body.messages.at(-1).content); shortSkill=queried.abilities.find((a:any)=>a.name==='守护').id;
    expect(shortSkill).toMatch(/^a\d+$/); expect(JSON.stringify(queried)).not.toContain('long-real-');
    return reviewedReply({intents:[{unit:d.forces[0].id,mode:'hold',cell:d.forces[0].pos},{unit:shortUnit,mode:'use',skill:shortSkill,target:d.forces[0].id},
      {unit:d.forces[2].id,mode:'open',cell:23},{unit:d.forces[3].id,mode:'close',cell:23},{unit:d.forces[4].id,mode:'advance',cell:90}]});
  }) as typeof fetch;
  const c=new LlmCommandController(COMMAND_PROMPTS,()=>{},request), p=new LlmIntentPlanner(c,COMMAND_PROMPTS);
  p.prefetch(b,state,settings,()=>true); await p.beforeHero();
  expect(bodies).toHaveLength(3); expect(bodies[1].messages.slice(0,2)).toEqual(bodies[0].messages);
  const correction=JSON.parse(bodies[1].messages.at(-1).content); expect(correction.previousAnswer.content).toBe('wrong-json-reply'); expect(correction.retryErrors[0]).toMatch(/JSON/);
  expect(state.memory.intents!.units[actor.id]).toEqual({mode:'use_ability',abilityId:'long-real-ability-identity',targetId:renamed.get('u1')});
  expect(Object.values(state.memory.intents!.units).map(i=>i.mode)).toEqual(['hold','use_ability','open_gate','close_gate','advance']);
  expect(state.memory.intents!.units[renamed.get('u5')!]!.cell).toBe(90);
  expect(savedCommanderState(state)!.memory.intents).toEqual(state.memory.intents);
});
it('T8 falls back after three failures and discards cancelled late replies',async()=>{
  vi.useFakeTimers();const request=vi.fn(async()=>new Response('{}',{status:503})) as unknown as typeof fetch;
  const {b,state,c,p}=setup(request);p.prefetch(b,state,settings,()=>true);await vi.runAllTimersAsync();await p.beforeHero();
  let release!:(r:Response)=>void;let init:RequestInit|undefined;
  const late=setup(((_url,body)=>{init=body;return new Promise<Response>(r=>{release=r;});}) as typeof fetch);
  late.p.prefetch(late.b,late.state,settings,()=>true);await vi.advanceTimersByTimeAsync(0);
  sendPlayerLetter(late.b,['enemy'],'这是新来信。');late.c.receiveLetter(late.b,settings);release(reply(holds(init)));await late.p.beforeHero();
  expect([(request as any).mock.calls.length,c.available(b,settings,state),late.state.memory.intents]).toEqual([3,false,undefined]);
  expect(late.state.memory.letterId).toBeUndefined();
  late.p.prefetch(late.b,late.state,settings,()=>true);await vi.advanceTimersByTimeAsync(0);
  expect(data(init).letters[0].text).toBe('这是新来信。');release(reviewedReply(holds(init)));await late.p.beforeHero();
  expect(late.state.memory.letterId).toBe(1);expect(late.state.memory.intents).toBeDefined();
});
it('T9 persists only allowed intent fields through save/load',async()=>{
  const {b,state,p}=setup(async(_url,init)=>reply(holds(init)));p.prefetch(b,state,settings,()=>true);await p.beforeHero();
  (state.memory.intents as any).raw='provider-secret';(state.memory.intents!.units.u2 as any).reasoning='provider-secret';
  const saved=savedCommanderState(state)!;const restored=savedCommanderState(JSON.parse(JSON.stringify(saved)))!;
  expect([restored.memory.intents,JSON.stringify(restored).includes('provider-secret')]).toEqual([saved.memory.intents,false]);
});
it('T10 disperses shared cells in id and distance order',async()=>{
  const {b,state,p}=setup(async()=>reply({intents:[{unitId:'u1',mode:'hold',cell:28},...['u4','u3','u2','u5'].map(unitId=>({unitId,mode:'hold',cell:15}))]}));p.prefetch(b,state,settings,()=>true);await p.beforeHero();
  expect(['u2','u3','u4','u5'].map(id=>state.memory.intents!.units[id]!.cell)).toEqual([15,8,14,16]);
});
it('regression: preparation retries keep the original messages and include the rejected answer and problem',async()=>{
  vi.useFakeTimers();const bodies:any[]=[];const {b,state}=fixture();
  const c=new LlmCommandController(COMMAND_PROMPTS,()=>{},async(_url,init)=>{bodies.push(JSON.parse(String(init?.body)));return reply(bodies.length===1?{name:'缺少人设'}:state.brief);});
  const pending=c.prepare(b,{story:'原消息'}, {objective:'守住'},settings,()=>true);await vi.runAllTimersAsync();await pending;
  expect([bodies[1].messages.slice(0,2),JSON.parse(bodies[1].messages[2].content)]).toEqual([bodies[0].messages,{previousAnswer:{name:'缺少人设',model:'fixture'},retryErrors:['指挥官简报格式无效']}]);
});
it('regression: observations and tools omit command styles and abilities in small and mass battles',()=>{
  const {b,state}=fixture();const m=new MassBattle({combatants:structuredClone(b.combatants.slice(0,3)),rules:V24_OVERFLOW_TW,seed:'mass'});m.start();
  for(const battle of [b,m]) { battle.log.push({round:1,kind:'rule',text:'指挥：我方 大师·渗透'});battle.commanderProfiles.ally={ability:'master',style:'infiltration'}; }
  expect([b,m].map(battle=>JSON.stringify({observation:commandObservation(battle),unit:commanderTool('commander_unit',{unitId:'u0'},battle,undefined,state),map:commanderTool('commander_map',{},battle,undefined,state)})).join('')).not.toMatch(/大师|渗透|infiltration|commanderProfiles/);
});
