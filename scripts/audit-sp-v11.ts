/** Paired full-engine SP audit. Never mutates the policy/rules at runtime.
 * Each variant runs in an isolated source tree; all share soft40 and seeded rosters.
 */
import { mkdirSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { generateUnit, SmallBattle, MassBattle, generatedField, V11_OVERFLOW_D20, V11_OVERFLOW_TW,
  traitRegistry, memberHealth, memberHealthMax, validateMemberHealth, abilityCost, spCapacity,
  type Combatant, type GenerateInput } from '../engine/src/index.js';
const arg=(key:string,fallback:string)=>process.argv.find(a=>a.startsWith('--'+key+'='))?.slice(key.length+3)??fallback;
const label=arg('label','balanced'),out=arg('out','/tmp/sp-audit'),phase=arg('phase','discovery');
const offset=Number(arg('offset',phase==='holdout'?'161803':'314159')),limit=Number(arg('limit','999999'));
const shard=Number(arg('shard','0')),shards=Number(arg('shards','1')),seeds=Number(arg('seeds','1'));
if(!Number.isSafeInteger(seeds)||seeds<1||seeds>100)throw Error('Invalid seeds');
mkdirSync(out,{recursive:true});
const registry=traitRegistry(),tagsList=[['plains'],['forest'],['urban','night']];
type Spec=Partial<GenerateInput>;
type Case={id:string;level:number;kind:string;a:Spec[];b:Spec[]};
const cases:Case[]=[];
for(let l=1;l<=10;l++){
 const fighter=(extra:Spec={}):Spec=>({level:l,weaponClass:'sword',weaponLevel:l,armorLevel:l,armorTier:2,traits:[],...extra});
 const mage=(skills:string[],power=l,extra:Spec={}):Spec=>fighter({weaponClass:'magic',weaponLevel:Math.max(1,l-2),armorTier:1,
  abilityBlueprints:skills.map(id=>({id:'generic:'+id,level:power})),...extra});
 const add=(kind:string,a:Spec[],b:Spec[])=>cases.push({id:kind+'-L'+l,level:l,kind,a,b});
 add('single',[mage(['magic-single'])],[fighter()]);
 add('area',[mage(['magic-area']),fighter({shield:true})],[fighter(),fighter({weaponClass:'rifle'}),fighter({weaponClass:'spear'})]);
 add('control',[mage(['magic-single','debuff:stun']),fighter()],[fighter({shield:true}),fighter({weaponClass:'rifle'})]);
 add('support',[mage(['buff:heal','buff:barrier','magic-single']),fighter()],[fighter({weaponClass:'rifle'}),fighter()]);
 add('summon',[mage(['buff:summon-single','magic-single'])],[fighter(),fighter({weaponClass:'bow'})]);
 add('overcast',[mage(['magic-single'],Math.min(10,l+2))],[fighter()]);
 add('martial',[fighter({abilityBlueprints:[{id:'generic:physical-single',level:l},{id:'generic:physical-area',level:l}]})],[fighter({shield:true})]);
 // Explicit custom-health endurance stress, not ordinary-HP balance. Same-tier wards and no routing.
 const sturdy={traits:['steadfast'],hpMax:1600,armorTier:2 as const};
 add('endurance',[mage(['magic-single','buff:barrier'],l,sturdy)],[fighter(sturdy)]);
}
const base=`${out}/${label}-${phase}-${shard}`;writeFileSync(base+'.jsonl','');writeFileSync(base+'-logs.jsonl.gz','');
writeFileSync(base+'-manifest.json',JSON.stringify({label,phase,offset,cases,tagsList,seeds,mirrors:2,shard,shards,sourceMain:'a4adbcc5185756dace52145dd6402ab42e3bafbb',
 hash:Object.fromEntries(['engine/src/resources.ts','engine/src/power-anchors.ts','scripts/audit-sp-v11.ts'].map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')]))},null,2));
let scheduled=0,count=0,errors=0;const started=Date.now();
for(const c of cases)for(const tags of tagsList)for(const mode of ['small','mass']as const)for(let seed=0;seed<seeds;seed++)for(const swap of [false,true]){
 const index=scheduled++;if(index%shards!==shard||count>=limit)continue;
 const id=[c.id,tags.join('+'),mode,seed+offset,swap].join(':'),sideA=swap?'enemy':'ally';
 try{
 const make=(team:'A'|'B',s:Spec,i:number):Combatant=>{
  // Endurance mass uses 100 ordinary members, not 1600 people; hero uses explicit 1600 HP.
  const u=generateUnit({name:team+i,rulesVersion:'v2',damageModel:'wounds-v2',scale:mode==='small'?'hero':'company',
   level:c.level,archetype:s.weaponClass==='magic'||s.weaponClass==='rifle'||s.weaponClass==='bow'?'ranged':'infantry',speedTier:3,traits:[],...s,
   side:team==='A'?sideA:sideA==='ally'?'enemy':'ally',...(mode==='mass'?{hpMax:c.kind==='endurance'?100:20}:{}),
  },{registry,seed:`roster:${c.id}:${seed+offset}:${team}${i}`,noVariance:true}).unit;
  u.id=team+i;return u;
 };
 const aa=c.a.map((s,i)=>make('A',s,i)),bb=c.b.map((s,i)=>make('B',s,i)),roster=swap?[...bb,...aa]:[...aa,...bb];
 const field=mode==='small'?generatedField(`map:${c.id}:${tags.join('+')}:${seed+offset}`,7,13,tags,{roster,attackingSide:'ally'}):undefined;
 if(field&&swap){field.tiles.reverse();field.objective.cell=field.tiles.length-1-field.objective.cell;if(field.objective.kind==='control')field.objective.attackingSide=sideA;}
 const b=mode==='small'?new SmallBattle({combatants:roster,rules:V11_OVERFLOW_D20,battlefield:field,field:{tags},seed:`battle:${c.id}:${tags.join('+')}:${seed+offset}`,traitRegistry:registry})
 :new MassBattle({combatants:roster,rules:V11_OVERFLOW_TW,field:{tags},seed:`battle:${c.id}:${tags.join('+')}:${seed+offset}`,traitRegistry:registry,roundLimit:40});
 b.start();const initial=structuredClone(b.toSnapshot()),maxHP=Object.fromEntries(roster.map(u=>[u.id,memberHealthMax(u)]));
 const casting=aa.filter(u=>u.abilities.length),caps=casting.map(u=>spCapacity(u));
 const uncastableAtFull=casting.flatMap(u=>u.abilities.filter(a=>u.preparedAbilityIds?.includes(a.id)&&(abilityCost(u,a)?.amount??0)>spCapacity(u))).length;
 let steps=0,rounds=0,spBlockedActivations=0,actorActivations=0,firstSpBlockRound:number|undefined;
 while(!b.isOver()&&steps++<6000){rounds=b.round;
  const active=b instanceof SmallBattle?[b.active].filter((u):u is Combatant=>!!u):b.combatants;
  for(const u of active){if(!u.id.startsWith('A')||u.status!=='ready'||!u.abilities.length)continue;actorActivations++;
   const spells=u.abilities.filter(a=>u.preparedAbilityIds?.includes(a.id)&&a.delivery==='magic'&&!a.itemSourceId&&!a.equipmentSourceId);
   if(spells.length&&spells.every(a=>(abilityCost(u,a)?.amount??0)>(u.resources.SP??0))){spBlockedActivations++;firstSpBlockRound??=b.round;}
  }
  if(b instanceof SmallBattle){if(b.active?.status==='ready')b.autoAction(b.active.id);else b.endTurn();}
  else{b.autoOrders('ally');b.autoOrders('enemy');b.resolveRound();}
 }
 for(const u of b.combatants){validateMemberHealth(u);if(!Number.isFinite(memberHealth(u))||!Number.isFinite(u.resources.SP??0)||(u.resources.SP??0)<0||u.fatigue<0||u.fatigue>8)throw Error('invalid state '+u.id);}
 if(!b.isOver())throw Error('unfinished');
 const abilities=b.log.filter(e=>e.kind==='ability'&&e.participants?.[0]?.startsWith('A'));
 const attacks=b.log.flatMap(e=>e.resolution?[e.resolution]:[]);
 const final=b.combatants.map(u=>({id:u.id,health:memberHealth(u),status:u.status,sp:u.resources.SP,fatigue:u.fatigue,abilityState:u.abilityState}));
 const win=b.winner(),result=win==='draw'?'draw':win===sideA?'A':'B';
 const row={id,index,label,phase,level:c.level,kind:c.kind,mode,tags,seed:seed+offset,swap,result,rounds,steps,caps,uncastableAtFull,actorActivations,spBlockedActivations,firstSpBlockRound,
  abilityEvents:abilities.length,abilityEventsAfter3:abilities.filter(e=>e.round>3).length,
  oneShotBattle:attacks.some(r=>r.finalDamage>=maxHP[r.defenderId]!&&maxHP[r.defenderId]!>0&&roster.find(u=>u.id===r.defenderId)?.scale==='hero'),
  AHealth:final.filter(u=>u.id.startsWith('A')).reduce((n,u)=>n+u.health,0),ASp:final.filter(u=>u.id.startsWith('A')).reduce((n,u)=>n+(u.sp??0),0),
  logHash:createHash('sha256').update(JSON.stringify({log:b.log,final})).digest('hex'),finished:true};
 appendFileSync(base+'.jsonl',JSON.stringify(row)+'\n');appendFileSync(base+'-logs.jsonl.gz',gzipSync(JSON.stringify({id,initial,log:b.log,final})+'\n'));
 }catch(e){errors++;appendFileSync(base+'.jsonl',JSON.stringify({id,index,label,phase,error:String(e),stack:e instanceof Error?e.stack:undefined})+'\n');}
 count++;if(count%80===0)console.log(JSON.stringify({label,count,errors,seconds:(Date.now()-started)/1000}));
}
console.log(JSON.stringify({label,count,errors,seconds:(Date.now()-started)/1000}));if(errors)process.exitCode=1;
