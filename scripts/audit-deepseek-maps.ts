/** Explicit, opt-in live audit. Credentials are read at runtime and never written to the report. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { LlmContextController, type LlmEncounterContext } from '../panel/src/llm-context.js';
import { generatedLayeredField, generateUnit, SmallBattle, V11_OVERFLOW_D20, type BattlefieldSpec, type BattlefieldScene } from '../engine/src/index.js';
import { prepareBattleObjective } from '../panel/src/battle-setup.js';
import type { InteriorUse, InteriorPattern } from '../engine/src/small/interior-plan.js';
import { geometrySignature } from '../engine/src/small/map-metrics.js';

const MODEL = 'deepseek-v4-flash';
interface Scenario {
  id: string; scene: BattlefieldScene; text: string; use?: InteriorUse; patterns?: InteriorPattern[]; rooms?: string[];
  water?: boolean; gates?: number; walls?: 'front'|'ring'|'double';
}
const scenarios: Scenario[] = [
  {id:'residence-suite',scene:'interior',use:'residence',patterns:['suite'],rooms:['书房','厨房'],text:'双方都已进入住宅内部。前厅、起居室与后厅依次穿堂相连，房门彼此错位；北侧是书房，东南是厨房。屋内家具零散，有屏风与木桌。我方四人从南侧前厅推进，敌方四人在北侧后厅据守，本场击败对方即可。'},
  {id:'inn-hall',scene:'interior',use:'inn',patterns:['hall'],rooms:['厨房','客房'],text:'战斗已经发生在酒馆内部。中央是一间宽阔客堂，零散桌椅在客堂两侧，西北厨房与东北客房都直接开门通向客堂，没有贯穿整栋楼的狭长中走廊。我方四人在南边入口，敌方四人在北边吧台旁，双方现在交战。'},
  {id:'temple-ring',scene:'interior',use:'temple',patterns:['ring'],rooms:['经堂','正殿'],text:'双方都在寺院建筑内部的有顶回廊与殿室交战。东西两翼各有房间，回廊在南北两端连通，可以绕一圈。北面为正殿，东侧是经堂，殿中有少量柱与供桌。我方四人从南部进来，敌方四人在北部，这一战不涉及院外或城墙。'},
  {id:'office-cross',scene:'interior',use:'office',patterns:['cross'],rooms:['档案室','会议室'],text:'在办公楼同一层内部，纵向走廊和横向联络道交叉成十字，走廊四周是大小不一的办公房间。西北档案室，东南会议室，几间房门错开。四名我方人员已在南边走廊，北边四名敌人正迎上来。这里只是楼内交战，目标击败敌人。'},
  {id:'warehouse-aisles',scene:'interior',use:'warehouse',patterns:['aisles'],rooms:['前仓','后仓'],text:'仓库内部正在交战，所有人都在库内。南面前仓、北面后仓，中部是一排排高货架组成的纵向通道，货架中段有横向通道，架端留出转身空间。四名我方在南端，四名敌人在北端，散落货箱可以作低掩体，任务是击败对方。'},
  {id:'workshop-wings',scene:'interior',use:'workshop',patterns:['wings'],rooms:['工具间','原料间'],text:'战场是工坊建筑内部同一层。左翼和右翼分别由数间大小不等的操作房串联，左右两翼在前后端各有联络门，可以分开走再汇合。西北是工具间，东南是原料间，设备靠墙放置。我方四人位于南端，敌方四人位于北端，双方交战。'},
  {id:'prison-cells',scene:'interior',use:'prison',patterns:['cells'],rooms:['值守间','牢室'],text:'监狱内部一层发生交战，一条偏置的狭长走廊连接两侧牢室，各牢室有门，牢室长度并不一致，北侧有值守间。四名我方已在南边走廊里，四名敌人在北边，所有人都在建筑内部，只需击败对方。'},
  {id:'ruins-broken',scene:'interior',use:'ruins',patterns:['broken'],rooms:['前厅','后厅'],text:'废弃建筑内部的房间大小和形状不一，几处隔墙坍塌形成宽窄不等的缺口，仍有残墙与瓦砾遮挡。南面前厅与北面后厅之间经数个错位房间连通，没有整齐的中央长廊。我方四人在南边前厅，敌方四人在北边后厅，双方开始交战。'},
  {id:'residence-infer',scene:'interior',use:'residence',rooms:['书房','卧房'],text:'这场冲突发生在一栋住宅内部，同一楼层有西北书房和东北卧房，还有放着长桌的客厅与厨房，房间面积并不相等。四名我方已从南边前厅进入，北边四名敌人守着后厅。双方就地交战。'},
  {id:'inn-infer',scene:'interior',use:'inn',rooms:['厨房'],text:'双方已经在客栈的同一楼层内部交手。楼中有几间客房、位于西侧的厨房和一间较大的公共客堂，杂物零散。我方四人在南侧，敌方四人在北侧。屋外没有参战者，任务是击败敌人。'},
  {id:'temple-infer',scene:'interior',use:'temple',rooms:['正殿'],text:'我方四人与敌方四人已在神庙建筑内部交战。北侧正殿较宽，有几根石柱，旁边有供祭司使用的侧室，南侧是前殿；我方在南，敌方在北。没有城墙，也不是围攻建筑外墙，战斗只涉及当前这一层。'},
  {id:'office-infer',scene:'interior',use:'office',rooms:['会议室'],text:'同一层办公设施的内部，会议室位于东北，另外有几间办公室和值班室，各房间有门相连，柜桌靠墙。四名我方人员已在南端室内，四名敌人在北端室内，双方现在交火，任务击败敌人。'},
  {id:'field-bridge',scene:'field',water:true,text:'双方都在野外河谷，东侧有一条南北流向的深水河，上有一座完好的石桥。西侧为开阔地，东北有树林。我方四人在南边，敌方四人在北边，双方在城外野地交战，没有城市或院墙。'},
  {id:'field-ridge',scene:'field',text:'山间野外遭遇战，西侧是长条岩脊，东侧有一片林地，中部留有曲折小路。四名我方在南边，四名敌人在北边，双方都不在建筑、城墙或壕沟中。任务击败敌人。'},
  {id:'siege-front',scene:'city_siege',gates:1,walls:'front',text:'一场正规城市攻防。城区在北面并延伸出视野，只有南面这一段城墙横贯战场，没有环形围城墙，也没有内外双墙，墙上只有一座关闭的南门。我方四人在城外南侧攻城，敌方四人在城内或城头守城，我方要夺取城内府衙。'},
  {id:'siege-double',scene:'city_siege',gates:2,walls:'double',water:true,text:'北侧城市有内外两重南向城墙，中间夹道，外墙一座关闭城门，内墙有对应城门；正面外墙外有护城河，一座完好桥通向外门。我方四人在城外南面准备攻城，敌方四人在城内或城头防守。任务夺取内城核心。'},
  {id:'streets-market',scene:'city_streets',text:'双方都已经在城内市场街巷交战，我方四人在街区南侧，敌方四人在北侧，中央有集市空地，两侧有店铺和小巷，东北有钟楼。本战区没有城墙、城门和护城河，不是攻城，也没有人在城外。'},
  {id:'streets-river',scene:'city_streets',water:true,text:'城市内部的滨河街区，一条河沿东边从北向南流过，有一座完好小桥，河西为仓库和窄巷。四名我方人员在街区南部，四名敌人在北部，双方都在城内街区，当前战区没有城防外墙，不是攻城。'},
  {id:'compound-warehouse',scene:'building_siege',text:'这里没有城市，只是一座独立围墙仓院。我方四人在院外南边，敌方四人在院内守仓，一道简易院墙围着仓房，有一座关闭的院门。双方开始围攻仓院，我方要夺取院内仓房，战区包含院外接近地带和院内。'},
  {id:'compound-manor',scene:'building_siege',text:'独立庄园院落的攻防，没有城市城墙。院墙围着一栋主屋，有一座敞开的院门和一座已经毁坏的侧门。四名我方人员在院外，四名敌人在院内守着主屋，主屋是我方要夺取的目标；双方不是都在屋里。'},
  {id:'trenches-front',scene:'trenches',text:'开阔战区布有相对的堑壕阵地，南面我方四人占据一条折线战壕，北面敌方四人占据另一条战壕，中间为有弹坑的无人地带。各自的前沿壕与后方交通壕相连，当前双方从壕中交战，没有城市与建筑围墙。'},
  {id:'trenches-depth',scene:'trenches',text:'双方各据多段相通的战壕，在前沿壕后还有第二线壕，交通壕连接前后阵位。我方四人在南部壕沟，敌方四人在北部壕沟，中央无人地有弹坑和瓦砾，任务击败敌人。这里不是城市街巷或建筑内部。'},
];
const roomDirections: Record<string, Record<string,string>> = {
  'residence-suite': {'书房':'N','厨房':'SE'}, 'inn-hall':{'厨房':'NW','客房':'NE'}, 'temple-ring':{'经堂':'E','正殿':'N'},
  'office-cross':{'档案室':'NW','会议室':'SE'}, 'warehouse-aisles':{'前仓':'S','后仓':'N'}, 'workshop-wings':{'工具间':'NW','原料间':'SE'},
  'prison-cells':{'值守间':'N'},'ruins-broken':{'前厅':'S','后厅':'N'},'residence-infer':{'书房':'NW','卧房':'NE'},
  'inn-infer':{'厨房':'W'},'temple-infer':{'正殿':'N'},'office-infer':{'会议室':'NE'},
};
const args = process.argv.slice(2), arg = (name: string, fallback: string) => args.find(a=>a.startsWith(name+'='))?.slice(name.length+1) ?? fallback;
const group = arg('--group','indoor'), repeats = Number(arg('--repeats','2')), limit = Number(arg('--limit','1000')), only=arg('--ids','').split(',').filter(Boolean);
const keyPath = arg('--key-file',''), output = arg('--output',`artifacts/indoor-layout-research/live-${group}.json`);
const replayPath=arg('--replay',''),replay=replayPath?JSON.parse(readFileSync(replayPath,'utf8')):undefined;
if ((!keyPath&&!replay) || !['indoor','other'].includes(group) || !Number.isInteger(repeats) || repeats<1 || repeats>4) throw Error('Use --key-file=PATH or --replay=REPORT --group=indoor|other --repeats=1..4');
const token = replay?'offline-replay':readFileSync(keyPath,'utf8').trim().match(/sk-[A-Za-z0-9_-]+/)?.[0];
if (!token) throw Error('No recognized API credential in supplied file');
const settings = { enabled:true,selectBattleScale:false,designMap:true,selectVip:true,windowSize:2,url:'https://api.deepseek.com',token,model:MODEL,models:[MODEL] };
const tasks = scenarios.filter(s=>(group==='indoor'?s.scene==='interior':s.scene!=='interior')&&(!only.length||only.includes(s.id))).flatMap(s=>Array.from({length:repeats},(_,repeat)=>({s,repeat}))).slice(0,limit);
const report: any = {date:'2026-10-20',requestedModel:MODEL,group,method:'Real LlmContextController decision + layout, unchanged product request payloads; real generation, deployment, battle start and snapshot restore. Synthetic Chinese narratives. Fact checks are defined per scenario and inspect actual generated fields. No model self-grading.',cases:[],requests:0,usage:{prompt_tokens:0,completion_tokens:0},elapsedMs:0};
if(replay){report.replayedFrom=replayPath;report.method='Replay of previously recorded real Flash answers through the current product parser, generation, deployment and snapshot restore; no new API requests.';}
const started = performance.now();
const nativeFetch = globalThis.fetch.bind(globalThis);
function persist() {report.elapsedMs=Math.round(performance.now()-started);writeFileSync(output,JSON.stringify(report,null,2)+'\n');}
const progress = (c:any) => console.log(JSON.stringify({case:c.id,repeat:c.repeat,success:c.success,attempts:c.calls.length,returnedModels:[...new Set(c.calls.map((c:any)=>c.model))],facts:c.facts,error:c.error}));
const rosterFor = () => (['ally','enemy'] as const).flatMap(side=>Array.from({length:4},(_,i)=>{
  const u=generateUnit({name:(side==='ally'?'我方':'敌方')+(i+1),side,scale:'hero',rulesVersion:'v2',level:3,weaponClass:i%2?'bow':'sword',weaponLevel:3,traits:[]},{seed:side+i,noVariance:true}).unit;
  u.id=side+i;return u;
}));
async function run(s:Scenario, repeat:number) {
  const c:any={id:s.id,repeat,narrative:s.text,expected:{scene:s.scene,use:s.use,patterns:s.patterns,rooms:s.rooms},calls:[],success:false,facts:[]};
  const roster=rosterFor(), seed=`live-${s.id}-${repeat}`;
  const request:typeof fetch=async (url,init)=>{
    const target=new URL(String(url)); const body=JSON.parse(String(init?.body));
    if(target.origin!=='https://api.deepseek.com'||!['/chat/completions','/v1/chat/completions'].includes(target.pathname)||body.model!==MODEL) throw Error('Audit endpoint/model guard rejected the request');
    const call:any={step:body.messages.at(-1).content.includes('【第2步')?'layout':'decision',startedMs:Math.round(performance.now()-started)};
    c.calls.push(call);
    if(!replay)report.requests++;
    const original=replay?.cases.find((v:any)=>v.id===s.id&&v.repeat===repeat)?.calls.find((v:any)=>v.step===call.step);
    const tick=performance.now(), response=replay?new Response(JSON.stringify({model:original?.model,choices:[{message:{content:original?.content}}]})):await nativeFetch(url,init);
    const json:any=await response.clone().json();
    call.http=response.status;call.ms=Math.round(performance.now()-tick);call.model=json.model;
    call.content=json.choices?.[0]?.message?.content;call.usage=json.usage;
    for(const k of ['prompt_tokens','completion_tokens']) report.usage[k]+=json.usage?.[k]??0;
    return response;
  };
  let field:BattlefieldSpec|undefined, result:LlmEncounterContext|undefined;
  try {
    result=await new LlmContextController(request).select({roster,setup:{mode:'small',field:'plains',lighting:'day',mapLayout:'standard',objectiveMode:'auto',siegeAttacker:'ally'},messages:[{id:'scene',role:'assistant',text:s.text,completed:true}],scope:seed},settings,()=>true,r=>{
      field=generatedLayeredField(seed,7,13,[r.field],{roster,plan:r.battlefieldPlan,attackingSide:r.siegeAttacker,unitBindings:r.unitBindings});
      field=prepareBattleObjective(field,roster,r.objectiveMode,undefined,r.siegeAttacker,r.vipId);
      const battle=new SmallBattle({battlefield:field,combatants:structuredClone(roster),rules:V11_OVERFLOW_D20,seed});battle.start();
      const snap=battle.toSnapshot();
      if(JSON.stringify(SmallBattle.fromSnapshot(structuredClone(snap)).toSnapshot())!==JSON.stringify(snap)) throw Error('Snapshot restore differed');
      field=battle.battlefield;
    });
    if(!field) throw Error('No generated battlefield');
    const f=field, facts:{name:string;pass:boolean;actual?:unknown}[]=[];
    const fact=(name:string,pass:boolean,actual?:unknown)=>facts.push({name,pass,...(actual!==undefined?{actual}:{})});
    fact('战场类型',f.generation?.scene===s.scene,f.generation?.scene);
    if(s.use) fact('建筑用途',f.generation?.interior?.use===s.use,f.generation?.interior?.use);
    if(s.patterns) fact('明确空间组织',s.patterns.includes(f.generation?.interior?.pattern!),f.generation?.interior?.pattern);
    for(const label of s.rooms??[]) {
      const region=f.scene?.regions.find(r=>r.kind==='room'&&r.label.includes(label));
      fact('实际房间:'+label,!!region&&region.cells.length>1,region?.cells.length??0);
      const direction=roomDirections[s.id]?.[label];
      if(direction) {
        const x=region?region.cells.reduce((n,p)=>n+p%f.width,0)/region.cells.length/(f.width-1):.5;
        const y=region?region.cells.reduce((n,p)=>n+Math.floor(p/f.width),0)/region.cells.length/(f.height-1):.5;
        fact('房间方位:'+label,!!region&&(!direction.includes('N')||y<.5)&&(!direction.includes('S')||y>.5)&&(!direction.includes('W')||x<.5)&&(!direction.includes('E')||x>.5),{direction,x:Number(x.toFixed(3)),y:Number(y.toFixed(3))});
      }
    }
    if(s.id==='temple-infer') {
      const main=f.scene?.regions.find(r=>r.kind==='room'&&r.label.includes('正殿'));
      fact('正殿为较大的主要房间',!!main&&main.cells.length>=Math.max(...(f.generation?.interior?.rooms.map(r=>r.cells.length)??[0])),main?.cells.length);
    }
    if(s.water) fact('水系实际存在',f.tiles.some(t=>t==='deep_water'||t==='shallow_water'));
    if(s.water) fact('明确的一座桥',new Set(f.structures?.filter(v=>v?.kind==='bridge').map(v=>v?.entityId)).size===1,new Set(f.structures?.filter(v=>v?.kind==='bridge').map(v=>v?.entityId)).size);
    if(s.gates!==undefined) fact('城门数量',f.city?.gates.length===s.gates,f.city?.gates.length);
    if(s.walls) fact('城墙形制',s.walls==='double'?result.battlefieldPlan?.wallLayers===2:s.walls==='ring'?f.city?.shape==='enclosure':result.battlefieldPlan?.shape==='front',result.battlefieldPlan?.wallLayers??result.battlefieldPlan?.shape);
    if(s.scene==='field') fact('双方在城外野地',!f.city);
    if(s.scene==='city_streets') fact('街区没有城防外墙',!f.structures?.some(v=>v?.kind==='wall'));
    if((s.scene==='city_siege'||s.scene==='building_siege')&&f.city) {
      const inside=new Set([...f.city.inside,...f.city.frontline]);
      const ally=roster.filter(u=>u.side==='ally').map(u=>f.initialDeployment?.[u.id]?.pos),enemy=roster.filter(u=>u.side==='enemy').map(u=>f.initialDeployment?.[u.id]?.pos);
      fact('攻方在城院外',ally.every(p=>p!==undefined&&!inside.has(p)),ally);
      fact('守方在城院内或墙上',enemy.every(p=>p!==undefined&&inside.has(p)),enemy);
    }
    c.facts=facts;c.success=true;c.firstPass=c.calls.length===2;c.plan=result.battlefieldPlan;c.layoutNotes=result.layoutNotes;
    c.actual={width:f.width,height:f.height,generation:f.generation,landmarks:f.landmarks,regions:f.scene?.regions,initialDeployment:f.initialDeployment,city:f.city,objective:f.objective};
    c.field=f;c.geometry=geometrySignature(f);
  } catch(error) {c.error=error instanceof Error?error.message:'Unknown audit failure';}
  report.cases.push(c);persist();progress(c);
}
mkdirSync('artifacts/indoor-layout-research',{recursive:true});
let cursor=0;
await Promise.all(Array.from({length:2},async()=>{while(cursor<tasks.length){const task=tasks[cursor++]!;await run(task.s,task.repeat);}}));
report.summary={total:report.cases.length,generated:report.cases.filter((c:any)=>c.success).length,firstPass:report.cases.filter((c:any)=>c.success&&c.firstPass).length,allCheckedFacts:report.cases.filter((c:any)=>c.success&&c.facts.every((f:any)=>f.pass)).length,distinctPatterns:[...new Set(report.cases.map((c:any)=>c.actual?.generation?.interior?.pattern).filter(Boolean))]};
persist();console.log(JSON.stringify({summary:report.summary,requests:report.requests,usage:report.usage,elapsedMs:report.elapsedMs}));
