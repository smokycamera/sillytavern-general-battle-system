import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  generateUnit, SmallBattle, MassBattle, V11_OVERFLOW_D20, V11_OVERFLOW_TW,
  generatedLayeredField, normalizeBattlefieldPlan, groundBlocked, gridDistance, neighbors, findGridPath,
  canOccupy, prepareGridDeployment, formationNode, recommendedFormationSlots,
  MAX_SMALL_UNITS, MAX_BATTLE_UNITS, BATTLEFIELD_PLAN_PROMPT,
  type Combatant, type BattlefieldPlan,
} from '../../engine/src/index.js';
import { recommendBattleMode, prepareMassRoster, battleCapacityIssue, prepareBattleObjective } from './battle-setup.js';
import { LlmContextController } from './llm-context.js';
import { LLM_SETTINGS_KEY, readLlmSettings } from './llm-settings.js';
import { parseProtocol } from './protocol.js';
import { normalizeContextSettings, encounterRequest } from './jev-context.js';
import { pushPreview } from '../../engine/src/skill-effects.js';
import { newBattleCommanderProfiles } from '../../engine/src/commander-profile.js';

function army(ally: number, enemy: number, scale: 'hero'|'company' = 'hero', body: Combatant['body'] = 'human'): Combatant[] {
  return (['ally','enemy'] as const).flatMap(side => Array.from({length: side === 'ally' ? ally : enemy}, (_,i) => {
    const u = generateUnit({ name:side+i, side, scale, body, hpMax:20, level:3, weaponClass:i%2 ? 'rifle' : 'blunt', weaponLevel:3, rulesVersion:'v2', traits:[] }, {seed:side+i,noVariance:true}).unit;
    u.id = side + i.toString().padStart(3,'0'); return u;
  }));
}
const setup = { mode:'small' as const, field:'siege', lighting:'day' as const, mapLayout:'standard' as const, objectiveMode:'auto' as const, siegeAttacker:'ally' as const };
afterEach(() => vi.unstubAllGlobals());

describe('32-card tactics and 64-card scene preparation', () => {
  it.each([2,16,17,31,32,33,63,64])('%s cards choose mode by actual deployed cards, not headcount or presence of heroes', count => {
    for (const scale of ['hero','company'] as const) {
      const units=army(Math.floor(count/2),Math.ceil(count/2),scale), before=structuredClone(units);
      expect(recommendBattleMode(units).mode).toBe(count<=32?'small':'mass');
      expect(battleCapacityIssue(units)).toBeUndefined(); expect(units).toEqual(before);
    }
  });
  it('rejects card 65, does not count dead/retired archived units as active, and does not allow 33-card grids', () => {
    const units=army(32,33,'company'); expect(battleCapacityIssue(units)).toMatch(/65.*64/);
    expect(()=>generatedLayeredField('too-many',7,13,[],{roster:units})).toThrow(/32/);
    units.slice(32).forEach(u=>{u.hp=0;u.status='dead';});
    expect(recommendBattleMode(units).mode).toBe('small'); expect(battleCapacityIssue(units)).toBeUndefined();
    expect([MAX_SMALL_UNITS,MAX_BATTLE_UNITS]).toEqual([32,64]);
  });
  it('parses all 64 distinct spawns or deploys in one transaction; 65 new cards still fail', () => {
    const spawn = (i:number)=>`<spawn name="单位${i}" side="${i<32?'ally':'enemy'}" scale="hero" level="3" weapon="剑L3"/>`;
    expect(parseProtocol('<tb>'+Array.from({length:64},(_,i)=>spawn(i)).join('')+'</tb>').errors).toEqual([]);
    expect(parseProtocol('<tb>'+Array.from({length:65},(_,i)=>spawn(i)).join('')+'</tb>').errors.join('')).toMatch(/64/);
    const deployed=parseProtocol('<tb><field env="siege"/>'+Array.from({length:64},(_,i)=>`<unit_update id="u${i}" hp="50"/><deploy id="u${i}"/>`).join('')+'</tb>');
    expect(deployed.errors).toEqual([]); expect(deployed.events).toHaveLength(129);
  });
  it.each([[16,17],[32,32],[1,63],[63,1]])('new mass %s:%s supports standalone heroes and freezes capacity across save/restore', (a,b) => {
    for (const scale of ['company','hero'] as const) {
      const units=army(a,b,scale), before=structuredClone(units), slots=recommendedFormationSlots(units);
      const battle=new MassBattle({combatants:prepareMassRoster(units),formationSlots:slots,rules:V11_OVERFLOW_TW,seed:'large-mass'});
      battle.start(); expect(battle.combatants).toHaveLength(a+b); expect(units).toEqual(before);
      for (const u of battle.combatants) {
        expect(formationNode(u).side).toBe(u.side);
        const occupants=battle.combatants.filter(v=>formationNode(v).id===formationNode(u).id && !battle.isAttached(v.id));
        expect(occupants.length).toBeLessThanOrEqual(slots);
      }
      const copy=MassBattle.fromSnapshot(structuredClone(battle.toSnapshot()));
      expect(copy.formationSlots).toBe(slots); expect(copy.toSnapshot()).toEqual(battle.toSnapshot());
      expect(copy.combatants.every(u=>u.scale===scale)).toBe(true);
    }
  });
  it('independent heroes really take orders and replay a full mass round deterministically', () => {
    const units=army(17,16), battle=new MassBattle({combatants:prepareMassRoster(units),formationSlots:recommendedFormationSlots(units),rules:V11_OVERFLOW_TW,seed:'hero-round'});
    battle.commanderProfiles=newBattleCommanderProfiles({ally:{ability:'expert',style:'aggressive'},enemy:{ability:'expert',style:'depth'}});
    battle.start(); const copy=MassBattle.fromSnapshot(structuredClone(battle.toSnapshot()));
    for (const b of [battle,copy]) { expect(b.autoOrders('ally')).toBeGreaterThan(0); b.autoOrders('enemy'); b.resolveRound(); }
    expect(battle.round).toBe(2); expect(copy.toSnapshot()).toEqual(battle.toSnapshot());
    expect(battle.attached.size).toBe(0);
  });
  it('forced movement reads the frozen four-slot capacity instead of the legacy hard-coded three', () => {
    const units=army(4,1,'company'),target=units[0]!,actor=units[4]!;
    target.tags=['zone:中军','rank:front'];actor.tags=['zone:中军','rank:front'];
    for(const u of units.slice(1,4))u.tags=['zone:中军','rank:rear'];
    const context={units,mode:'mass' as const,fieldTags:[],attached:new Map<string,string>()};
    const effect={op:'push' as const,direction:'away' as const,force:3,steps:1 as const};
    expect(pushPreview(context,actor,target,effect).reason).toBeDefined();
    expect(pushPreview({...context,formationSlots:4},actor,target,effect)).toMatchObject({nodeId:'ally:中军:rear'});
  });
  it('legacy mass saves keep the old capacity and corrupt capacity cannot bypass collision rules', () => {
    const units=army(2,2,'company'), battle=new MassBattle({combatants:prepareMassRoster(units),rules:V11_OVERFLOW_TW,seed:'old'});
    battle.start(); expect(battle.toSnapshot()).not.toHaveProperty('formationSlots');
    const snapshot=structuredClone(battle.toSnapshot());
    expect(MassBattle.fromSnapshot(snapshot).formationSlots).toBeUndefined();
    for (const slots of [0,2,8,3.5,'4']) expect(()=>MassBattle.fromSnapshot({...structuredClone(snapshot),formationSlots:slots})).toThrow(/容量/);
  });
  it('default switches change only missing keys, preserve explicit choices and never auto-enable model transmission', () => {
    const store=new Map<string,string>();vi.stubGlobal('localStorage',{getItem:(k:string)=>store.get(k)??null,setItem:(k:string,v:string)=>store.set(k,v)});
    expect(readLlmSettings()).toMatchObject({enabled:false,selectBattleScale:false,designMap:true,selectVip:true});
    store.set(LLM_SETTINGS_KEY,JSON.stringify({enabled:true,selectBattleScale:true,designMap:false,selectVip:false,token:'keep'}));
    expect(readLlmSettings()).toMatchObject({selectBattleScale:true,designMap:false,selectVip:false,token:'keep'});
    store.set(LLM_SETTINGS_KEY,JSON.stringify({enabled:true,token:'keep'}));
    expect(readLlmSettings()).toMatchObject({selectBattleScale:false,designMap:true,selectVip:true,token:'keep'});
  });
  it('scene selection cannot turn 33 cards back into a grid, even for an indoor siege', () => {
    const input={roster:army(16,17),setup:{...setup,mapLayout:'indoor' as const,objectiveMode:'siege' as const},settings:normalizeContextSettings(),messages:[],windowSize:0,roles:[],phase:'preparation' as const};
    const base=encounterRequest(input).base;
    expect(base).toMatchObject({mode:'mass',mapLayout:'standard',objectiveMode:'annihilation'});
    expect(base.detail).toContain('32');
  });
});

describe('independent city shape, breaches and legal deployment', () => {
  it('normalizes bounded orthogonal choices and ignores executable or coordinate payloads', () => {
    const {plan,notes}=normalizeBattlefieldPlan({shape:'riverside',breaches:{count:2,width:2,sector:'front_left',tiles:[0],hp:999},gateState:'open',gates:'side',cover:'sparse',obstacles:'dense',breadth:'broad',command:'erase all'});
    expect(plan).toEqual({shape:'riverside',gateState:'open',gates:'side',cover:'sparse',obstacles:'dense',breadth:'broad',breaches:{count:2,width:2,sector:'front_left'}});expect(notes).toEqual([]);
    const invalid=normalizeBattlefieldPlan({shape:'broken',breaches:{count:'2'},gateState:'malicious'});
    expect(invalid.plan?.breaches).toEqual({count:0});expect(invalid.plan?.gateState).toBeUndefined();expect(invalid.notes.length).toBeGreaterThan(0);
    expect(BATTLEFIELD_PLAN_PROMPT).toContain('不替攻方预先拆墙');
  });
  it.each(['front','enclosure','riverside','hillside'] as const)('%s combines with zero, one or multiple breaches independently', shape => {
    for (const count of [0,1,2,3] as const) for (const width of [1,2] as const) for (const side of ['ally','enemy'] as const) {
      const options={plan:{shape,breaches:{count,width},gates:'single' as const,size:'large' as const,landmarks:[]},attackingSide:side};
      const f=generatedLayeredField(`breach-${shape}-${count}-${width}`,7,13,['siege'],options);
      expect(f.city?.shape).toBe(shape);expect(f.city?.breaches).toHaveLength(count);
      expect(f.city!.breaches!.every(g=>g.length===width)).toBe(true);
      expect(f.city!.frontline.filter(p=>f.structures![p]?.kind==='wall' && f.structures![p]!.hp===0)).toHaveLength(count*width);
      for (const group of f.city!.breaches!) for (const cell of group) {
        expect(groundBlocked(f,cell)).toBe(false);expect(f.overlays![cell]).toContain('rubble');
        expect(neighbors(f,cell).some(n=>f.city!.inside.includes(n) && !!findGridPath(f,n,f.city!.core[0]!,k=>f.city!.inside.includes(k)&&!groundBlocked(f,k)))).toBe(true);
      }
      for (let i=0;i<count;i++) for(let j=i+1;j<count;j++) expect(f.city!.breaches![i]!.every(a=>f.city!.breaches![j]!.every(b=>gridDistance(f,a,b)>1))).toBe(true);
      expect(generatedLayeredField(`breach-${shape}-${count}-${width}`,7,13,['siege'],options)).toEqual(f);
    }
  },60000);
  it.each(['front_left','front_right','left','right','rear'] as const)('enclosed cities honor the requested %s sector with either attacking side', sector => {
    for(const attackingSide of ['ally','enemy'] as const) {
      const f=generatedLayeredField('anchor',7,13,['siege'],{plan:{shape:'enclosure',size:'large',gates:'single',breaches:{count:1,width:1,sector}},attackingSide});
      const c=f.city!,p=c.breaches![0]![0]!,depth=(n:number)=>attackingSide==='ally'?Math.floor(n/f.width):f.height-1-Math.floor(n/f.width);
      if(sector==='left') expect(p%f.width).toBe(Math.min(...c.frontline.map(n=>n%f.width)));
      else if(sector==='right') expect(p%f.width).toBe(Math.max(...c.frontline.map(n=>n%f.width)));
      else if(sector==='rear') expect(depth(p)).toBe(Math.min(...c.frontline.map(depth)));
      else expect(depth(p)).toBe(Math.max(...c.frontline.map(depth)));
    }
  });
  it('regresses wide-breach greedy underfill and riverside holes ending in deep water', () => {
    for(const [shape,sector,gates] of [['front','right','side'],['front','rear','side'],['riverside','right','double'],['riverside','rear','double'],['hillside','rear','side']] as const){
      const seed=`choice:${shape}:3:2:${sector}:${gates}`;
      const f=generatedLayeredField(seed,7,13,['siege'],{plan:{shape,breaches:{count:3,width:2,sector},gates,size:'compact',landmarks:[]}});
      expect(f.city?.breaches).toHaveLength(3);
    }
    for(const variant of [0,2]){
      const f=generatedLayeredField(`capacity:siege:${variant}:1:2`,7,13,['siege'],{roster:army(1,31,'hero',variant===0?'giant':'human'),attackingSide:'enemy',plan:{size:'compact',shape:'riverside',breaches:{count:2,width:1},water:'none',gateState:'closed',cover:'sparse',obstacles:'dense'}});
      for(const group of f.city!.breaches!)for(const p of group)expect(findGridPath(f,p,f.city!.core[0]!,n=>!groundBlocked(f,n))).toBeDefined();
    }
  });
  it('legacy density is the real default for both cover and obstacles in a city', () => {
    const merged=generatedLayeredField('density-alias',7,13,['urban'],{plan:{density:'dense',landmarks:[]}});
    const separate=generatedLayeredField('density-alias',7,13,['urban'],{plan:{density:'dense',cover:'dense',obstacles:'dense',landmarks:[]}});
    expect(merged).toEqual(separate);
  });
  it('explicit cover/relief dimensions affect real city parcels independently of obstacles', () => {
    let sparseCover=0,denseCover=0,sparseRubble=0,denseRubble=0;
    for(let i=0;i<12;i++)for(const density of ['sparse','dense'] as const){
      const field=generatedLayeredField('independent-detail'+i,7,13,['urban'],{plan:{size:'large',obstacles:'sparse',cover:density,relief:density,landmarks:[]}});
      const c=field.structures!.filter(s=>s?.kind==='cover').length,r=Object.values(field.overlays!).filter(o=>o?.includes('rubble')).length;
      if(density==='sparse'){sparseCover+=c;sparseRubble+=r;}else{denseCover+=c;denseRubble+=r;}
    }
    expect(denseCover).toBeGreaterThan(sparseCover);expect(denseRubble).toBeGreaterThan(sparseRubble);
  });
  it('legacy broken is accepted, explicit zero wins, omitted new damage stays intact, urban stays a district', () => {
    expect(generatedLayeredField('old',7,13,['siege'],{plan:{shape:'broken'}}).city?.breaches).toHaveLength(1);
    expect(generatedLayeredField('override',7,13,['siege'],{plan:{shape:'broken',breaches:{count:0}}}).city?.breaches).toHaveLength(0);
    for(let i=0;i<20;i++) expect(generatedLayeredField('intact'+i,7,13,['siege'],{plan:{size:'compact'}}).city?.breaches).toHaveLength(0);
    const urban=generatedLayeredField('urban',7,13,['urban'],{plan:{shape:'enclosure',breaches:{count:3},gateState:'destroyed'}});
    expect(urban.city?.shape).toBe('district');expect(urban.city?.gates).toEqual([]);expect(urban.objective.kind).toBe('annihilation');
  });
  it.each(['closed','open','destroyed'] as const)('gate state %s is independent from wall breach count', gateState => {
    const f=generatedLayeredField('gate-state',7,13,['siege'],{plan:{shape:'enclosure',gates:'double',gateState,breaches:{count:0}}});
    expect(f.city?.gates).toHaveLength(2);expect(f.city?.breaches).toHaveLength(0);
    for(const p of f.city!.gates) {expect(f.structures![p]!.gateState).toBe(gateState);expect(groundBlocked(f,p)).toBe(gateState==='closed');}
    const noGate=generatedLayeredField('sealed',7,13,['siege'],{plan:{shape:'enclosure',gates:'none',breaches:{count:1}}});expect(noGate.city?.gates).toHaveLength(0);
  });
  it.each(['plains','forest','mountain','urban','siege'])('32 giant cards fit %s with 31:1 and 1:31 deployments without deleting terrain or units', env => {
    for(const attackingSide of ['ally','enemy'] as const) for(const n of [1,16,31]) {
      const units=army(n,32-n,'hero','giant'),before=structuredClone(units);
      const plan:BattlefieldPlan={shape:'riverside',size:'compact',water:'river',density:'dense',breaches:{count:2,width:2}};
      const f=generatedLayeredField('load-'+env+'-'+n,7,13,[env],{roster:units,attackingSide,plan});
      const prepared=prepareGridDeployment(f,units,'load-'+env+'-'+n);
      expect(units).toEqual(before);expect(prepared).toHaveLength(32);
      for(const u of prepared) {expect(canOccupy(f,prepared,u,u.pos!)).toBe(true);expect(groundBlocked(f,u.pos!,u)).toBe(false);if(f.city?.defender&&u.side!==f.city.defender)expect(f.city.inside).not.toContain(u.pos);}
      const battle=new SmallBattle({combatants:structuredClone(units),battlefield:f,seed:'load-'+env+'-'+n,rules:V11_OVERFLOW_D20});
      // Constructor upgrades resource rules before deployment; compare the exact prepared inputs.
      const runtimePrepared=prepareGridDeployment(f,battle.combatants,'load-'+env+'-'+n,battle.conditions);battle.start();
      expect(battle.combatants.map(u=>[u.id,u.pos,u.elevation,u.airborne === true])).toEqual(runtimePrepared.map(u=>[u.id,u.pos,u.elevation,u.airborne === true]));
      expect(SmallBattle.fromSnapshot(structuredClone(battle.toSnapshot())).toSnapshot()).toEqual(battle.toSnapshot());
    }
  },60000);
  it('indoor overflow grows locally and explicit positions are never silently relocated', () => {
    const units=army(31,1,'hero','giant');const f=generatedLayeredField('indoor-full',5,7,['urban'],{roster:units});
    expect(f.width).toBeGreaterThan(5);expect(f.generation?.notes?.join('')).toContain('地图调整');
    const explicit=army(1,1);explicit[0]!.pos=0;
    expect(()=>generatedLayeredField('bad-position',7,13,[],{roster:explicit})).toThrow(/部署/);
  });
  it('over-capacity LLM preparation omits impossible scale/grid/VIP questions without changing saved preferences', async () => {
    const settings={enabled:true,selectBattleScale:true,designMap:true,selectVip:true,url:'https://api.example/v1',token:'',model:'test',models:[],windowSize:6};
    const request=vi.fn<typeof fetch>(async(_url,init)=>{
      const body=JSON.parse(JSON.parse(String(init?.body)).messages[1].content);
      expect(body.fields.some((f:any)=>f.id==='battle_mode'||f.id.startsWith('vip_'))).toBe(false);expect(body.state.mapRules).toBeUndefined();
      return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({selections:Object.fromEntries(body.fields.map((f:any)=>[f.id,{value:Object.keys(f.options)[0],confidence:1}]))})}}]}));
    });
    const result=await new LlmContextController(request).select({roster:army(32,32),setup,messages:[{id:'m',role:'assistant',completed:true,text:'双方军队展开正面会战。'}]},settings,()=>true);
    expect(result.mode).toBe('mass');expect(result.battlefieldPlan).toBeUndefined();expect(request).toHaveBeenCalledTimes(1);expect(settings.selectBattleScale).toBe(true);
  });
  it('VIP 31 remains addressable, map damage and commander choices share one model request', async () => {
    const roster=army(31,1,'company'),request=vi.fn<typeof fetch>(async(_url,init)=>{
      const payload=JSON.parse(String(init?.body)),body=JSON.parse(payload.messages[1].content);
      expect(body.fields.find((f:any)=>f.id==='vip_ally').options).toHaveProperty('unit_30');
      expect(body.fields.some((f:any)=>f.id==='battle_mode')).toBe(false);
      expect(body.state.mapRules).toContain('breaches');
      const values:Record<string,string>={field:'siege',lighting:'day',map_layout:'standard',objective:'escort',siege_attacker:'ally',ally_ability:'expert',ally_style:'siege',enemy_ability:'expert',enemy_style:'depth',vip_ally:'unit_30',vip_enemy:'default'};
      // Choose supported style IDs instead of assuming a label.
      for(const f of body.fields) if(values[f.id]&&!Object.hasOwn(f.options,values[f.id]!)) values[f.id]=Object.keys(f.options)[0]!;
      return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({selections:Object.fromEntries(body.fields.map((f:any)=>[f.id,{value:values[f.id],confidence:1}])),battlefield:{shape:'riverside',breaches:{count:2,width:2},gates:'single'}})}}]}));
    });
    const result=await new LlmContextController(request).select({roster,setup,messages:[{id:'m',role:'assistant',completed:true,text:'临河城防已有两处宽缺口，护送末尾那支运输队撤离。'}]},{enabled:true,selectBattleScale:false,designMap:true,selectVip:true,url:'https://api.example/v1',token:'',model:'test',models:[],windowSize:6},()=>true);
    expect(request).toHaveBeenCalledTimes(1);expect(result.battlefieldPlan).toMatchObject({shape:'riverside',breaches:{count:2,width:2}});expect(result.vipId).toBe(roster[30]!.id);
    const field=generatedLayeredField('VIP',7,13,['siege'],{roster,plan:result.battlefieldPlan});
    expect(prepareBattleObjective(field,roster,'escort',undefined,'ally',result.vipId).objective).toMatchObject({kind:'escape',unitId:roster[30]!.id});
  });
});
