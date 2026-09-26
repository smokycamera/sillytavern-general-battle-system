/** Seeded integration audit: actual V4 autoAction/autoOrders, never formula-only wins. */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { generateUnit, SmallBattle, MassBattle, standardField, V4_OVERFLOW_D20, V4_OVERFLOW_TW, traitRegistry } from '../engine/src/index.js';
import type { Combatant, GenerateInput, BattleLogEntry } from '../engine/src/types.js';
import { compileItem, equipmentReason, syncAccessoryAbilities, attachCarriedItems, validateAccessories, type AccessoryKind, type ConsumableKind } from '../engine/src/items.js';
import { memberHealth, validateMemberHealth } from '../engine/src/member-health.js';

const registry = traitRegistry();
type Mode = 'small' | 'mass';
type Role = { weapon: string; armor?: 0|1|2|3|4; profile?: 'balanced'|'kinetic'|'thermal'|'arcane'; skills?: string[]; traits?: string[]; body?: 'human'|'large'|'vehicle'|'giant'; shield?: boolean; sidearm?: string; accessory?: AccessoryKind; item?: ConsumableKind; level?: number; power?: number; mount?: boolean; stabilized?: boolean };
type World = { id: string; name: string; power: number; a: Role[]; b: Role[] };
type Cell = { id: string; family: 'same-world'|'cross-equal'|'cross-native'|'mechanics'; mode: Mode; name: string; worldA: string; worldB: string; level: number; powerA: number; powerB: number; a: Role[]; b: Role[]; fixedScene?: number; start?: 'close'|'far' };
const r = (weapon: string, armor: Role['armor'], skills: string[] = [], extra: Partial<Role> = {}): Role => ({weapon, armor, skills, ...extra});
// These are authored engine archetypes, not canon statistics for any franchise.
const worlds: World[] = [
  {id:'medieval',name:'中世纪武侠',power:2,
    a:[r('sword',3,['physical-single:melee','buff:defense'],{shield:true}),r('bow',1,['physical-single:ranged+bleed'],{accessory:'woodland'}),r('spear',2,['debuff:martial+root'],{traits:['pike-wall']})],
    b:[r('axe',3,['physical-single:melee+bleed'],{traits:['berserk']}),r('throwing',1,['physical-single:ranged'],{accessory:'endurance'}),r('blunt',2,['buff:martial+heal'],{item:'heal'})]},
  {id:'gunpowder',name:'火药蒸汽',power:3,
    a:[r('firearm',2,['physical-single:ranged','buff:attack'],{sidearm:'sword'}),r('demolition',2,['physical-area:ranged+push'],{item:'grenade'}),r('spear',3,['buff:confidence'],{traits:['commander']})],
    b:[r('heavy-rifle',1,['physical-single:ranged+vulnerable'],{accessory:'night'}),r('sword',3,['physical-single:shield'],{shield:true}),r('light-ranged',1,['buff:zone-smoke'],{item:'cleanse'})]},
  {id:'fantasy',name:'高魔奇幻',power:4,
    a:[r('magic',1,['magic-area:thermal+burn','buff:heal+barrier'],{accessory:'healing'}),r('natural',2,['physical-area:melee+push'],{body:'giant'}),r('sword',2,['buff:ward','debuff:dispel'],{shield:true})],
    b:[r('magic',1,['magic-single:arcane+stun','debuff:silence'],{traits:['flying']}),r('natural',2,['physical-single:melee+poison'],{body:'large'}),r('magic',1,['buff:summon','buff:cleanse'],{accessory:'cleansing'})]},
  {id:'modern',name:'现代军事',power:5,
    a:[r('rifle',3,['physical-single:ranged','buff:zone-smoke'],{sidearm:'light-ranged'}),r('cannon',3,['physical-area:ranged'],{body:'vehicle',stabilized:true,item:'repair'}),r('heavy-rifle',1,['physical-single:ranged+wound'],{accessory:'night'})],
    b:[r('rifle',2,['physical-single:ranged+accuracy-down'],{item:'grenade'}),r('indirect-cannon',2,['physical-area:ranged+fear'],{body:'vehicle'}),r('autocannon',3,['physical-area:ranged'],{body:'vehicle',stabilized:true})]},
  {id:'cyber',name:'赛博异能',power:6,
    a:[r('energy',2,['magic-single:thermal','debuff:silence'],{accessory:'barrier'}),r('sword',2,['physical-single:melee+drain','buff:haste'],{traits:['fast']}),r('rifle',2,['buff:barrier','buff:restore'],{item:'restore'})],
    b:[r('heavy-rifle',2,['physical-single:ranged'],{traits:['sharpshooter']}),r('magic',2,['debuff:stun','debuff:disarm','debuff:root'],{accessory:'guardian'}),r('energy',2,['magic-area:arcane+curse'],{item:'empower'})]},
  {id:'space',name:'星际战争',power:8,
    a:[r('energy',4,['magic-area:thermal+burn'],{accessory:'endurance'}),r('autocannon',4,['physical-area:ranged'],{body:'vehicle',stabilized:true}),r('magic',1,['buff:barrier','buff:zone-healing'],{item:'barrier'})],
    b:[r('heavy-rifle',4,['physical-single:ranged+wound'],{accessory:'guardian'}),r('cannon',4,['physical-area:ranged+push'],{body:'vehicle'}),r('magic',2,['magic-area:zone-fire','magic-area:zone-poison','debuff:fear'],{accessory:'healing'})]},
];
const scenes = [
  {id:'open',name:'开阔平原',tags:['plains'],width:7,height:9},
  {id:'forest',name:'密林',tags:['forest'],width:7,height:9},
  {id:'mountain',name:'山地',tags:['mountain'],width:7,height:11},
  {id:'urban',name:'城镇近距',tags:['urban'],width:5,height:7},
  {id:'night',name:'夜间密林',tags:['night','forest'],width:7,height:9},
  {id:'siege',name:'攻城占点',tags:['siege'],width:7,height:13},
];
const cells: Cell[] = [];
const add = (v: Omit<Cell,'id'|'mode'>) => { for (const mode of ['small','mass'] as const) cells.push({...v,mode,id:`c${String(cells.length).padStart(3,'0')}`}); };
for(const w of worlds) for(const level of [1,3,5,8,10]) add({family:'same-world',name:`${w.name}／T${level}`,worldA:w.id,worldB:w.id,level,powerA:w.power,powerB:w.power,a:w.a,b:w.b});
for(let i=0;i<worlds.length;i++) for(let j=i+1;j<worlds.length;j++) for(const p of [3,7,0]) {
  const a=worlds[i]!,b=worlds[j]!;
  add({family:p?'cross-equal':'cross-native',name:`${a.name} vs ${b.name}／${p?'等P'+p:'原生P'}`,worldA:a.id,worldB:b.id,level:5,powerA:p||a.power,powerB:p||b.power,a:a.a,b:b.a});
}
const duel = (name:string,a:Role,b:Role,power=3,level=5,extra:Partial<Cell>={}) => add({family:'mechanics',name,worldA:'control-A',worldB:'control-B',level,powerA:power,powerB:power,a:[a],b:[b],fixedScene:0,start:'close',...extra});
duel('剑/钝器·无甲',r('sword',0),r('blunt',0),1,1);
duel('剑/钝器·重甲',r('sword',3),r('blunt',3),3,3);
duel('剑/斧·无甲',r('sword',0),r('axe',0),2,2);
duel('剑/斧·重甲',r('sword',3),r('axe',3),4,4);
duel('剑/长柄·中甲',r('sword',2),r('spear',2),5,5);
duel('轻型投射/投掷',r('light-ranged',2),r('throwing',2),6,6);
duel('步枪/单发重步枪',r('rifle',3),r('heavy-rifle',3),7,7);
duel('步枪/能量·动能甲',r('rifle',3,[],{profile:'kinetic'}),r('energy',3,[],{profile:'kinetic'}),8,8);
duel('步枪/能量·热能甲',r('rifle',3,[],{profile:'thermal'}),r('energy',3,[],{profile:'thermal'}),9,9);
duel('魔法/能量·奥术甲',r('magic',3,[],{profile:'arcane'}),r('energy',3,[],{profile:'arcane'}),10,10);
duel('弓/火枪·远距',r('bow',1),r('firearm',1),3,5,{start:'far'});
duel('炮/间接火炮·城镇',r('cannon',3,[],{body:'vehicle'}),r('indirect-cannon',3,[],{body:'vehicle'}),5,5,{fixedScene:3,start:'far'});
duel('盾牌/无盾',r('sword',3,[],{shield:true}),r('sword',3),3);
duel('夜视配件/无配件',r('rifle',2,[],{accessory:'night'}),r('rifle',2),3,5,{fixedScene:4,start:'far'});
duel('守护配件/无配件',r('sword',2,[],{accessory:'guardian'}),r('sword',2),3);
duel('纯眩晕/定身',r('magic',2,['debuff:stun']),r('magic',2,['debuff:root']),3);
duel('缴械/沉默',r('magic',2,['debuff:disarm']),r('magic',2,['debuff:silence']),3);
duel('纯眩晕/复合控制',r('magic',2,['debuff:stun']),r('magic',2,['debuff:stun+disarm+silence']),3);
duel('纯治疗/治疗屏障',r('sword',2,['buff:heal']),r('sword',2,['buff:heal+barrier']),3);
duel('伤害技能/普攻',r('sword',2,['physical-single:melee']),r('sword',2),3);
duel('盾击/近战技能',r('sword',2,['physical-single:shield'],{shield:true}),r('sword',2,['physical-single:melee'],{shield:true}),3);
duel('治疗药剂/无药剂',r('sword',2,[],{item:'heal'}),r('sword',2),3);
duel('高训练低装备/低训练高装备',r('sword',2,[],{level:8,power:2}),r('sword',2,[],{level:2,power:5}),3);
duel('骑乘弓手/步行弓手',r('bow',1,[],{mount:true,traits:['mounted-archer']}),r('bow',1),3,5,{start:'far'});
duel('飞行法师/地面法师',r('magic',1,[],{traits:['flying']}),r('magic',1),3,5,{start:'far'});
if(cells.length!==200) throw Error('Matrix must have 200 cells');
const arg=(name:string,fallback:string)=>process.argv.find(a=>a.startsWith('--'+name+'='))?.slice(name.length+3)??fallback;
const seeds=Number(arg('seeds','5')),worker=Number(arg('worker','0')),workers=Number(arg('workers','1'));
const output=arg('output','engine/sim/out/worldview-20260926'),selection=arg('cells','all'),manifestOnly=arg('manifest-only','false')==='true';
if(!Number.isInteger(seeds)||seeds<1||!Number.isInteger(workers)||workers<1||worker<0||worker>=workers)throw Error('Invalid run parameters');
const sha=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const baseline=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const sourceDigest=createHash('sha256');
for(const file of execFileSync('git',['ls-files','engine/src'],{encoding:'utf8'}).trim().split('\n')){sourceDigest.update(file);sourceDigest.update(readFileSync(file));}
const fingerprint=sourceDigest.digest('hex');
const scriptHash=createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex');
mkdirSync(output,{recursive:true});
const manifest={version:1,baseline,sourceSha256:fingerprint,scriptSha256:scriptHash,seeds,worlds,scenes,cells,method:{AI:'built-in V4 local AI',smallLimit:60,massLimit:40,pairedSideSwap:true,variance:false,companyMembers:[30,50,100],worldsAreAuthoredTemplates:true}};
if(worker===0)writeFileSync(`${output}/manifest.json`,JSON.stringify(manifest,null,2)+'\n');
function makeUnits(cell:Cell,seed:number,swap:boolean){
  return (['A','B'] as const).flatMap(team=>{
    const side=(team==='A')!==swap?'ally':'enemy';
    return cell[team==='A'?'a':'b'].map((role,slot)=>{
      const power=role.power??cell[team==='A'?'powerA':'powerB'],level=role.level??cell.level;
      const gearSeed=`wv:${cell.id}:${team}:${slot}`;
      let unit=generateUnit({name:`${team}${slot}-${role.weapon}`,side,scale:cell.mode==='small'?'hero':'company',rulesVersion:'v2',level,
        traits:role.traits??[],weaponClass:role.weapon,weaponLevel:power,armorTier:role.armor??2,armorLevel:power,armorProfile:role.profile??'balanced',
        body:role.body??'human',mount:role.mount,weaponStabilized:role.stabilized,
        sidearmClass:role.sidearm,sidearmLevel:role.sidearm?power:undefined,
        ...(cell.mode==='mass'?{hpMax:[30,50,100][seed%3]}:{}),
        abilityBlueprints:(role.skills??[]).map(id=>({id:'generic:'+id,level:power})),
      } as GenerateInput,{registry,seed:gearSeed,noVariance:true}).unit;
      if(role.shield){const item=compileItem({kind:'shield',power},{id:gearSeed+':shield',seed:gearSeed});if(item.kind==='shield')unit.shield=item.value;}
      if(role.accessory){const item=compileItem({kind:'accessory',mechanism:role.accessory,power},{id:gearSeed+':acc',seed:gearSeed});if(item.kind==='accessory')unit.accessories={accessory1:item.value};syncAccessoryAbilities(unit);}
      if(role.item){const item=compileItem({kind:'consumable',mechanism:role.item,power},{id:gearSeed+':item',seed:gearSeed});if(item.kind==='consumable')unit=attachCarriedItems(unit,[{id:gearSeed+':item',name:role.item,quantity:2,revision:1,mechanics:item}]);}
      const reason=equipmentReason(unit);if(reason)throw Error(`${cell.id}/${team}${slot}: ${reason}`);
      validateAccessories(unit);
      if(unit.abilities.filter(a=>!a.equipmentSourceId&&!a.itemSourceId).length!==(role.skills??[]).length)throw Error(`Skill compilation mismatch ${cell.id}/${team}${slot}`);
      if(cell.mode==='mass')unit.tags.push('zone:'+['左翼','中军','右翼'][slot%3],'rank:front');
      return unit;
    });
  });
}
function fixture(cell:Cell,seed:number,swap:boolean){
  const units=makeUnits(cell,seed,swap),aSide=swap?'enemy':'ally';
  // Rotate scenery per seed; controls explicitly fix their environment.
  const scene=scenes[cell.fixedScene??((Math.floor(Number(cell.id.slice(1))/2)+seed)%6)]!;
  const field=standardField(scene.width,scene.height,[...scene.tags]);
  if(scene.id==='open')field.tiles.fill('open');
  if(field.objective.kind==='control'){field.objective.attackingSide=aSide;field.objective.cell=(aSide==='ally'?1:field.height-2)*field.width+Math.floor(field.width/2);}
  return {units,aSide,scene,field};
}
// Validate every role and every actual map before counting any battle.
for(const cell of cells) for(let seed=0;seed<seeds;seed++)makeUnits(cell,seed,false);
if(manifestOnly){console.log(JSON.stringify({validatedCells:cells.length,expectedBattles:cells.length*seeds*2,baseline,fingerprint}));process.exit(0);}
const path=`${output}/worker-${worker}.jsonl`;
const prior=existsSync(path)?readFileSync(path,'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)):[];
if(prior.some(x=>x.sourceSha256!==fingerprint||x.scriptSha256!==scriptHash))throw Error('Refusing to mix results from changed engine/harness');
const done=new Set(prior.map(x=>x.id));
const selected=selection==='all'?undefined:new Set(selection.split(','));
let completed=0;
for(let index=0;index<cells.length;index++){
  const cell=cells[index]!;if(index%workers!==worker||selected&&!selected.has(cell.id))continue;
  for(let seed=0;seed<seeds;seed++)for(const swap of [false,true]){
    const id=`${cell.id}-s${seed}-${swap?'reverse':'forward'}`;if(done.has(id))continue;
    const {units,aSide,scene,field}=fixture(cell,seed,swap),battleSeed=`worldview-audit:${cell.id}:${seed}`;
    // Swap both physical side and input ordering, so stable tie-breaks also swap.
    units.sort((a,b)=>Number(a.side==='enemy')-Number(b.side==='enemy'));
    const initialFixtureHash=sha({units,field});
    const b=cell.mode==='small'?new SmallBattle({combatants:units,battlefield:field,rules:V4_OVERFLOW_D20,seed:battleSeed,traitRegistry:registry})
      :new MassBattle({combatants:units,rules:V4_OVERFLOW_TW,seed:battleSeed,traitRegistry:registry,field:{tags:[...scene.tags]},roundLimit:40});
    b.start();
    if(b instanceof SmallBattle&&cell.start==='close'){
      const middle=Math.floor(field.height/2);for(const u of b.combatants)u.pos=(middle+(u.side==='ally'?1:-1))*field.width+Math.floor(field.width/2);
    }
    const state=(u:Combatant)=>({id:u.id,name:u.name,side:u.side,hp:u.hp,health:memberHealth(u),status:u.status,morale:u.morale,SP:u.resources.SP,body:u.body,weapon:u.weapon?.recipe?.mechanism,power:u.weapon?.recipe?.power,level:u.level});
    const initial=b.combatants.map(state);
    const initialSnapshot=JSON.stringify(b.toSnapshot());
    let steps=0;const before=Date.now();
    while(!b.isOver()&&steps<6000){
      if(b instanceof SmallBattle){if(!b.active)throw Error(`${id}: no active unit`);b.autoAction(b.active.id);}
      else{b.autoOrders('ally');b.autoOrders('enemy');b.resolveRound();}
      steps++;
    }
    if(!b.isOver()||!b.winner())throw Error(`${id}: unfinished after ${steps} steps`);
    for(const u of b.combatants){validateMemberHealth(u);if(!Number.isFinite(memberHealth(u))||memberHealth(u)<0)throw Error(`${id}: invalid health`);}
    const log=b.log;
    const reachedLimit=b instanceof MassBattle?b.round>40:b.round>=field.objective.limit;
    const ending=b instanceof MassBattle?b.endingReason():b.objectiveWinner?(reachedLimit?'objective-limit':'objective-complete'):'forces-broken';
    const usage=b.combatants.flatMap(u=>u.abilities.map(a=>({unitId:u.id,side:u.side,definition:a.definitionId??a.name,id:a.id,source:a.itemSourceId?'item':a.equipmentSourceId?'accessory':'skill',used:u.abilityState.find(s=>s.abilityId===(a.cooldownGroup??a.id))?.used??0})));
    const eventCounts:Record<string,number>={};for(const e of log)eventCounts[e.kind]=(eventCounts[e.kind]??0)+1;
    const attacks=log.flatMap(e=>e.resolutions??(e.resolution?[e.resolution]:[]));
    const combatMetrics={attacks:attacks.length,hits:attacks.filter(a=>a.hit).length,zeroDamageHits:attacks.filter(a=>a.hit&&a.finalDamage===0).length,
      noPenetration:attacks.filter(a=>a.penetrationFactor===0).length,directHealthLost:attacks.reduce((n,a)=>n+a.finalDamage,0)};
    const result={id,cellId:cell.id,family:cell.family,mode:cell.mode,seed,swap,battleSeed,sourceSha256:fingerprint,scriptSha256:scriptHash,initialFixtureHash,
      scene:scene.id,aSide,winner:b.winner(),result:b.winner()==='draw'?'draw':b.winner()===aSide?'A':'B',ending,reachedLimit,
      round:b.round,roundsObserved:Math.min(b.round,cell.mode==='small'?60:40),steps,elapsedMs:Date.now()-before,initial,final:b.combatants.map(state),usage,eventCounts,combatMetrics,
      logSha256:sha(log.map(({ts,...e}:BattleLogEntry)=>e)),lastEvents:log.slice(-4).map(({ts,...e}:BattleLogEntry)=>e.text)};
    // Concatenated gzip members remain stream-readable with gzip/zcat/Python gzip.
    appendFileSync(`${output}/logs-${worker}.jsonl.gz`,gzipSync(JSON.stringify({id,initialSnapshot:JSON.parse(initialSnapshot),log})+'\n'));
    appendFileSync(path,JSON.stringify(result)+'\n');completed++;
    if(completed%10===0)console.log(JSON.stringify({worker,completed,last:id,seconds:Math.round(result.elapsedMs/1000)}));
  }
}
console.log(JSON.stringify({worker,completed,status:'complete'}));
