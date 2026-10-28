/** Experimental damage representations only. Does not change production rules or saved instances. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import { generateUnit, SmallBattle, standardField, traitRegistry, standardConditionMap, compileItem, gearItem, skillDefinitionId, skillAttack,
  previewAttack, resolveAttack, combatWeapon, V41_OVERFLOW_D20, V41_OVERFLOW_TW, SeededRng, memberHealth, grantBarrier, prepareArmsModel,
  type Combatant, type GenerateInput, type AttackOpts, type RulePack, type MemberDamagePlan } from '../engine/src/index.js';
import { diceDistribution } from '../engine/src/probability.js';
import { damageFactors } from '../engine/src/damage-policy.js';
import { UNIFIED_WOUNDS } from '../engine/src/balance.js';
import { artilleryDirect, artilleryRetention, artillerySplash } from '../engine/src/artillery-model.js';
import { applyDamagePlan, regenerationAmount, settleRegeneration } from '../engine/src/recovery.js';
import { wornItemEffects } from '../engine/src/gear-bonuses.js';

const out='artifacts/dice-model-options-20261028';mkdirSync(out,{recursive:true});
const registry=traitRegistry(),conditionDefs=standardConditionMap(),rules=V41_OVERFLOW_D20,field=standardField();field.tiles.fill('open');
const save=(file:string,data:unknown)=>writeFileSync(out+'/'+file+'.json',JSON.stringify(data,null,2)+'\n');
type Model='current'|'pure-pool'|'anchored-matched'|'anchored-source';
const models:Model[]=['current','pure-pool','anchored-matched','anchored-source'];
type Distribution=Map<number,number>;
const poolCache:Float64Array[]=[new Float64Array([1])];
/** Sliding-window exact finite d6 convolution; all entries are probabilities in double precision. */
function pool(n:number):Float64Array{
  assert.ok(n>=0&&Number.isInteger(n)&&n<=4096,'Pool size outside experimental budget');
  while(poolCache.length<=n){
    const i=poolCache.length,prior=poolCache[i-1]!,next=new Float64Array(6*i+1);let window=0;
    for(let s=0;s<next.length;s++){
      if(s-1>=0&&s-1<prior.length)window+=prior[s-1]!;
      if(s-7>=0&&s-7<prior.length)window-=prior[s-7]!;
      next[s]=Math.max(0,window/6);
    }
    const total=next.reduce((a,b)=>a+b,0);for(let s=0;s<next.length;s++)next[s]!/=total;
    poolCache.push(next);
  }
  return poolCache[n]!;
}
function original(expr:string,ap:string|undefined,times:number):Distribution{
  const a=diceDistribution(expr,times)!,b=diceDistribution(ap,times)!;assert.ok(a&&b);const result=new Map<number,number>();
  for(const [x,p]of a)for(const [y,q]of b)result.set(x+y,(result.get(x+y)??0)+p*q);return result;
}
function moments(d:Distribution){let mean=0,second=0;for(const [x,p]of d){mean+=x*p;second+=x*x*p;}return {mean,sd:Math.sqrt(Math.max(0,second-mean*mean))};}
function item(u:Combatant,L:number,stat:'damage'|'health'|'barrier',points=10){
  if(stat!=='barrier'&&points===0)return;
  const id=u.id+':'+stat,m=compileItem({kind:'item',form:'worn',power:L,...(stat==='barrier'?{barrierPower:L}:{bonuses:{[stat]:points}})},{id,seed:id});
  if(m.kind!=='item')throw Error('fixture');(u.gear??=[]).push(gearItem(id,id,m.value));
}
function unit(id:string,patch:Partial<GenerateInput>={}):Combatant{
  const u=generateUnit({name:id,side:id==='a'?'ally':'enemy',scale:'hero',level:4,weaponClass:'greatsword',weaponLevel:4,armorTier:2,armorLevel:4,
    body:'human',rulesVersion:'v2',damageModel:'wounds-v2',numericModel:'graded-v1',loadModel:'capacity-v2',traits:[],...patch},
    {seed:id,noVariance:true,registry,skillModel:'skills-v5'}).unit;u.id=id;delete u.pos;return u;
}
function average(){let i=0;return {seed:'mean',next:()=>.5,d:(s:number)=>s===20?18:s===6?3+i++%2:Math.ceil((s+1)/2)};}
function options(a:Combatant,d:Combatant,ability=a.abilities[0],pack=rules):Omit<AttackOpts,'rng'>{
  new SmallBattle({combatants:[a,d],rules:pack,seed:'dice-audit',traitRegistry:registry});
  const ranged=!!a.weapon?.tags?.includes('ranged');a.pos=ranged?45:31;d.pos=24;
  const effect=ability?.effects.find(e=>e.op==='damage');
  return {attacker:a,defender:d,rules:pack,conditionDefs,traitRegistry:registry,distance:ranged?3:1,ranged,
    ...(ability&&effect?.op==='damage'?skillAttack({mode:'small',units:[a,d],battlefield:field,fieldTags:[]},a,d,ability,effect,pack):{})};
}
function sourceFlat(o:Omit<AttackOpts,'rng'>,factors:number[],count:number):number{
  const a=o.attacker,w=o.weaponOverride??a.weapon;
  const levels=[w?.recipe?.power??w?.level??a.level,o.abilityDamage?.power??a.abilities[0]?.power??a.level,a.level];
  let flat=factors.slice(0,3).reduce((sum,f,i)=>sum+Math.max(0,f-1)*UNIFIED_WOUNDS[levels[i]!-1]!,0);
  const channel=o.abilityDamage?.channel??w?.channel??'kinetic';
  let best=0;for(const g of a.gear??[]){const v=wornItemEffects(g).values;best=Math.max(best,UNIFIED_WOUNDS[g.recipe.power-1]!*Math.max(0,(v.damage??0)+(v[(channel+'Damage')as'kineticDamage']??0)));}
  flat+=best;return flat*factors.reduce((p,f)=>p*Math.min(1,f),1)/count;
}
function basis(o:Omit<AttackOpts,'rng'>){
  const w=o.weaponOverride??o.attacker.weapon,r=resolveAttack({...o,attacker:structuredClone(o.attacker),defender:structuredClone(o.defender),autoHit:true,rng:average()}),p=previewAttack(o);
  assert.ok(r.baseRoll&&r.damagePlans?.length===1,'This experiment requires one primary channel');
  const normal=original(r.baseRoll!.expr,r.apRoll?.expr,1),critical=original(r.baseRoll!.expr,r.apRoll?.expr,2);
  const f=damageFactors(o,w,r.channel),positive=1+f.reduce((s,x)=>s+Math.max(0,x-1),0),count=o.abilityDamage?1:w?.attacks??1;
  const defense=(r.overmatchMultiplier??1)/(r.armorScale??1),coefficient=r.dmgMult/defense,mean=moments(normal).mean*coefficient;
  return {o,r,p,normal,critical,positive,count,coefficient,mean,post:r.wardMult*(r.penetrationFactor??1)*defense,
    sourceFlat:sourceFlat(o,f,count),weapon:combatWeapon(w,{...o.attacker,...(r.ammunition?{cannonAmmo:r.ammunition}:{})},o.defender,o.rules.weaponOverflow,o.rules.damageModel,o.rules.overmatch,o.rules.overmatchCurve),artillery:!!o.rules.artilleryModel&&['cannon','indirect-cannon','autocannon','rocket'].includes(w?.recipe?.mechanism??'')&&(!o.abilityDamage||!!o.abilityDamage.weaponBased),
    retention:artilleryRetention(o.defender,w?.recipe?.power??w?.level??1)};
}
type Basis=ReturnType<typeof basis>;
function budget(b:Basis,model:Model,critical=false):Distribution{
  const result=new Map<number,number>(),scale=critical?.75:1;
  const add=(raw:number,p:number)=>{if(p>1e-18){const key=Math.round(Math.max(0,raw)*1e9)/1e9;result.set(key,(result.get(key)??0)+p);}};
  if(model==='pure-pool'){
    const base=Math.floor(b.mean/3.5),q=b.mean/3.5-base;
    for(const [n,weight]of [[base,1-q],[base+1,q]]){
      if(weight!<1e-16)continue;const d=pool(n!*(critical?2:1));
      for(let x=0;x<d.length;x++)if(d[x]!>1e-18)add(x*scale,d[x]!*weight!);
    }
  }else{
    const multiplier=model==='current'?b.coefficient:b.coefficient/b.positive;
    const flat=model==='current'?0:model==='anchored-matched'?b.mean*(b.positive-1)/b.positive:b.sourceFlat;
    for(const [roll,p]of critical?b.critical:b.normal)add(roll*multiplier*scale+flat,p);
  }
  const total=[...result.values()].reduce((a,b)=>a+b,0);for(const [x,p]of result)result.set(x,p/total);return result;
}
function integerDamage(d:Distribution,post:number):Distribution{
  const r=new Map<number,number>();for(const [x,p]of d){const raw=Math.max(0,x*post),lo=Math.floor(raw+1e-10),f=Math.max(0,raw-lo);r.set(lo,(r.get(lo)??0)+p*(1-f));if(f>0)r.set(lo+1,(r.get(lo+1)??0)+p*f);}return r;
}
function singleLoss(d:Distribution,b:Basis):Float64Array{
  const hp=b.o.defender.hp,r=new Float64Array(hp+1);
  for(const [raw,p]of integerDamage(d,b.post)){
    const damage=b.artillery?Math.round(artilleryDirect(raw,hp,b.retention)):raw;
    r[Math.min(hp,Math.max(0,damage))]!+=p;
  }return r;
}
function fullAction(b:Basis,normal:Float64Array,critical:Float64Array){
  const hp=b.o.defender.hp,p=new Float64Array(hp+1),crit=b.p.critChance??0;
  for(let i=0;i<=hp;i++)p[i]=(b.p.hitChance-crit)*normal[i]!+crit*critical[i]!;p[0]!+=1-b.p.hitChance;
  let sums=new Float64Array(hp+1);sums[0]=1;
  for(let shot=0;shot<b.count;shot++){
    const next=new Float64Array(hp+1);
    for(let i=0;i<=hp;i++)if(sums[i]!>1e-18){if(i===hp){next[hp]!+=sums[i]!;continue;}for(let j=0;j<=hp;j++)if(p[j]!>1e-18)next[Math.min(hp,i+j)]!+=sums[i]!*p[j]!;}
    sums=next;
  }
  let loss=0;for(let i=1;i<=hp;i++)loss+=i*sums[i]!;return {kill:sums[hp]!,expectedLoss:loss};
}
function measure(b:Basis,model:Model){
  const n=budget(b,model),c=budget(b,model,true),nm=moments(n),cm=moments(c),normal=singleLoss(n,b),critical=singleLoss(c,b);
  return {model,hp:b.o.defender.hp,hit:b.p.hitChance,shots:b.count,normalMean:nm.mean*b.post,normalSd:nm.sd*b.post,criticalMean:cm.mean*b.post,
    normalKill:normal.at(-1)!,criticalKill:critical.at(-1)!,...fullAction(b,normal,critical),
    pureDice:b.mean/3.5,sourceFlat:b.sourceFlat,positive:b.positive,post:b.post};
}

function cdf(d:Distribution){let p=0;const x=[...d].sort((a,b)=>a[0]-b[0]).map(([value,chance])=>({value,p:p+=chance}));return x;}
function sample(d:ReturnType<typeof cdf>,u:number):number{let low=0,high=d.length-1;while(low<high){const mid=(low+high)>>>1;if(d[mid]!.p<u)low=mid+1;else high=mid;}return d[low]!.value;}
function round(x:number,u:number){const low=Math.floor(x);return low+Number(u<x-low);}
function plan(b:Basis,t:Combatant,raw:number):MemberDamagePlan{
  const template=b.r.damagePlans![0]!,cohort=t.scale!=='hero',targets=cohort?Math.min(t.hp,template.targets):template.targets>0?1:0;
  const max=cohort?t.formation!.memberHp:t.base.hpMax,reference=max*targets;
  raw*=targets;
  const direct=b.artillery?Math.round(artilleryDirect(raw,reference,b.retention)):raw,cap=template.overflow?direct:Math.min(direct,reference);
  const extra=template.targets>0?(template.splashTargets??0)/template.targets:0;
  const splashRaw=extra?Math.round(b.artillery?artillerySplash(raw,reference,extra,b.weapon?.splashFactor??0):direct*extra*(b.weapon?.splashFactor??0)):0;
  const splashTargets=Math.min(t.hp,targets*extra),splash=Math.min(max*splashTargets,splashRaw);
  return {...template,direct:cap,targets,incomingDirect:direct,...(extra?{splash,splashTargets,incomingSplash:splashRaw}:{})};
}
function interactions(){
  const rows:Record<string,unknown>[]=[],trials=3000;
  for(const name of (process.argv.includes('--sustain-arcane')?[]:['plain','barrier','energy','barrier-energy','rifle-barrier','cannon-formation'])){
    const cannon=name==='cannon-formation',rifle=name==='rifle-barrier';
    const a=unit('a',{weaponClass:cannon?'cannon':rifle?'rifle':'greatsword',weaponEnchantment:'arcane',weaponBonuses:{damage:4,penetration:3}});item(a,4,'damage');
    const d=unit('d',{...(cannon?{scale:'company' as const,hpMax:20,hp:20}:{}),armorBonuses:{defense:4,kineticProtection:3}});
    if(name.includes('energy')){const m=compileItem({kind:'shield',mechanism:'energy-shield',power:4},{id:'shield',seed:'shield'});if(m.kind!=='shield')throw Error('shield');d.shield=m.value;}
    const o=options(a,d,undefined);
    if(name.includes('barrier')||cannon)grantBarrier(d,36,99,'worn',4,'entry');
    const b=basis(o);
    for(const model of models){
      const normal=cdf(budget(b,model)),critical=cdf(budget(b,model,true)),rng=new SeededRng('interactions:'+name);let kills=0,loss=0,lossSquares=0,shield=0,energy=0;
      for(let i=0;i<trials;i++){
        const target=structuredClone(d),initial=memberHealth(target),sb=target.barrier?.remaining??0,eb=target.energyShield?.remaining??0;
        for(let shot=0;shot<b.count&&target.hp>0;shot++){
          const hit=rng.next(),u=rng.next(),v=rng.next();if(hit>=b.p.hitChance)continue;
          const raw=round(sample(hit<(b.p.critChance??0)?critical:normal,u)*b.post,v);applyDamagePlan(target,plan(b,target,raw));
        }
        kills+=Number(target.hp===0);const delta=initial-memberHealth(target);loss+=delta;lossSquares+=delta*delta;shield+=sb-(target.barrier?.remaining??0);energy+=eb-(target.energyShield?.remaining??0);
      }
      rows.push({name,model,trials,meanLoss:loss/trials,standardError:Math.sqrt(Math.max(0,lossSquares/trials-(loss/trials)**2)/trials),kill:kills/trials,meanBarrierSpent:shield/trials,meanEnergySpent:energy/trials});
    }
    // Validate the current prototype against the real engine with independent action samples.
    const rng=new SeededRng('engine:'+name);let actual=0,actualSquares=0;
    for(let i=0;i<trials;i++){const target=structuredClone(d),before=memberHealth(target);for(let shot=0;shot<b.count&&target.hp>0;shot++)resolveAttack({...o,defender:target,rng});const delta=before-memberHealth(target);actual+=delta;actualSquares+=delta*delta;}
    const current=rows.find(r=>r.name===name&&r.model==='current')!;
    assert.ok(Math.abs(actual/trials-Number(current.meanLoss))<4*Math.sqrt(Math.max(0,actualSquares/trials-(actual/trials)**2)/trials+Number(current.standardError)**2)+1e-6,JSON.stringify({name,actual:actual/trials,prototype:current.meanLoss,normal:measure(b,'current'),template:b.r.damagePlans,weaponSplash:b.weapon?.splashFactor,ammunition:b.r.ammunition}));
    rows.push({name,model:'engine-current-validation',trials,meanLoss:actual/trials});
  }
  const sustain:Record<string,unknown>[]=[];
  for(const L of [4,8]){
    const attackChannel=process.argv.includes('--sustain-arcane')?'arcane':'none';
    const a=unit('a',{level:L,weaponLevel:L,armorLevel:L,weaponEnchantment:attackChannel,weaponBonuses:{damage:4,penetration:3}});item(a,L,'damage');
    const d=unit('d',{level:L,weaponLevel:L,armorLevel:L,traits:['guardian','regen'],traitLevels:{guardian:L,regen:L},armorBonuses:{defense:4,kineticProtection:3}});
    const b=basis(options(a,d,undefined)),regen=regenerationAmount({...d,hp:1});
    for(const model of models){
      const normal=cdf(budget(b,model)),critical=cdf(budget(b,model,true)),rng=new SeededRng('sustain:'+L);let survived=0,rounds=0;
      for(let i=0;i<1000;i++){
        const t=structuredClone(d);let turn=0;
        while(t.hp>0&&turn<30){turn++;const h=rng.next(),u=rng.next(),v=rng.next();if(h<b.p.hitChance)applyDamagePlan(t,plan(b,t,round(sample(h<(b.p.critChance??0)?critical:normal,u)*b.post,v)));if(t.hp>0)settleRegeneration(t,regenerationAmount(t));}
        survived+=Number(t.hp>0);rounds+=turn;
      }
      const n=measure(b,model);sustain.push({L,channel:attackChannel,model,trials:1000,regen,unclippedExpectedIncoming:b.count*((b.p.hitChance-(b.p.critChance??0))*n.normalMean+(b.p.critChance??0)*n.criticalMean),survived30:survived/1000,meanCappedActions:rounds/1000});
    }
  }
  save(process.argv.includes('--sustain-arcane')?'sustain-arcane':'interactions',{rows,sustain,scope:'Actual applyDamagePlan for barrier -> energy -> life, volley and cannon cohort splash. Six scenarios x four models x 3000 actions, plus independent current-engine validation. Sustain is a fixed attack-input one-sided 30-round stress, not AI duels: movement, morale-driven choices, fatigue and SP not modeled.'});
  return {rows,sustain};
}
function growth(){
  const rows:Record<string,unknown>[]=[],totals={transitions:0,eligible:0,wholeDicePlateaus:0,newMeanPlateaus:0,legitimateZero:0};
  for(let L=1;L<=10;L++)for(const weapon of ['greatsword','dagger','rifle'])for(const source of ['unit','weapon','skill','worn']){
    let prior:ReturnType<typeof measure>[]|undefined;
    for(let p=-10;p<=10;p++){
      const a=unit('a',{level:L,weaponClass:weapon,weaponLevel:L,armorLevel:L,
        bonuses:source==='unit'?{damage:p}:undefined,weaponBonuses:source==='weapon'?{damage:p}:undefined,
        ...(source==='skill'?{abilityBlueprints:[{id:skillDefinitionId('物理单体')!,level:L,bonuses:{damage:p}}]}:{})});
      if(source==='worn')item(a,L,'damage',p);
      const d=unit('d',{level:L,weaponLevel:L,armorTier:0,armorLevel:L}),b=basis(options(a,d,source==='skill'?a.abilities[0]:undefined)),current=models.map(m=>measure(b,m));
      if(prior){totals.transitions++;const delta=current[0]!.normalMean-prior[0]!.normalMean;
        if(delta>1e-9){totals.eligible++;const flat=Math.round(current[0]!.pureDice)===Math.round(prior[0]!.pureDice);totals.wholeDicePlateaus+=Number(flat);
          for(let i=1;i<current.length;i++){const change=current[i]!.normalMean-prior[i]!.normalMean;assert.ok(change>=-1e-6,'New point makes damage worse');totals.newMeanPlateaus+=Number(change<=1e-9);}
          if(flat)rows.push({L,weapon,source,p,meanDelta:delta,roundedDice:Math.round(current[0]!.pureDice)});
        }else if(current[0]!.normalMean===0)totals.legitimateZero++;
      }prior=current;
    }
  }
  save('growth',{totals,wholeDicePlateaus:rows});return totals;
}
function benchmarks(){
  const rows=[];
  for(const count of [8,32,128,842]){
    const n=30000,rng=new SeededRng('naive'),begin=performance.now();let sink=0;for(let i=0;i<n;i++)for(let j=0;j<count;j++)sink+=rng.d(6);const naiveMs=performance.now()-begin;
    const p=pool(count),d=cdf(new Map([...p].map((x,i)=>[i,x]).filter(([,x])=>x!>1e-18)as[number,number][])),r=new SeededRng('cdf'),next=performance.now();for(let i=0;i<n;i++)sink+=sample(d,r.next());const cdfMs=performance.now()-next;
    rows.push({dice:count,actions:n,naiveMs,cdfMs,sink});
  }save('benchmark',{rows,scope:'Single-process packet sampling only, not full battle/UI performance. CDF precomputation excluded.'});return rows;
}

const started=performance.now();
// Internal math checks exercise exact convolution and the mean-preserving fractional extra die.
for(const n of [0,1,2,8,32,128]){const d=pool(n);let sum=0,mean=0,second=0;for(let x=0;x<d.length;x++){sum+=d[x]!;mean+=x*d[x]!;second+=x*x*d[x]!;}assert.ok(Math.abs(sum-1)<1e-9);assert.ok(Math.abs(mean-3.5*n)<1e-6);assert.ok(Math.abs(second-mean*mean-n*35/12)<1e-4);}
const risk=[];
for(const health of [108,215]){
  const a=unit('a',{weaponEnchantment:'arcane',weaponBonuses:{damage:4,penetration:3},abilityBlueprints:[{id:skillDefinitionId('物理单体近战')!,level:3,bonuses:{damage:3,penetration:2}}]});item(a,4,'damage');
  const d=unit('d',{armorBonuses:{defense:4,kineticProtection:3},...(health===215?{bonuses:{health:5}}:{})});if(health===215)item(d,4,'health');
  const b=basis(options(a,d));assert.equal(d.hp,health);for(const model of models)risk.push(measure(b,model));
}
save('risk',risk);console.log(JSON.stringify({phase:'risk',rows:risk}));
if(process.argv.includes('--risk-only'))process.exit(0);
if(process.argv.includes('--tactical')){
  const rows=[];
  for(const controlled of [false,true])for(const weapon of ['dagger','greatsword']){
    const a=unit('a',{weaponClass:weapon,weaponBonuses:{damage:4,penetration:3},bonuses:{damage:3}});item(a,4,'damage');
    const d=unit('d');if(controlled)d.conditions.push({id:'stunned',dur:2});
    const b=basis(options(a,d,undefined));for(const model of models)rows.push({weapon,controlled,critChance:b.p.critChance,...measure(b,model)});
  }
  save('tactical',{rows,scope:'Actual preview-derived hit/forced-critical probabilities; exact damage distributions. No control/SP delivery cost included.'});console.log(JSON.stringify({phase:'tactical',rows}));process.exit(0);
}
if(process.argv.includes('--sustain-arcane')){console.log(JSON.stringify({phase:'sustain-arcane',...interactions()}));process.exit(0);}
if(process.argv.includes('--growth-only')){console.log(JSON.stringify({phase:'growth',...growth()}));console.log(JSON.stringify({phase:'benchmark',rows:benchmarks()}));process.exit(0);}
if(process.argv.includes('--extras')){console.log(JSON.stringify({phase:'interactions',...interactions()}));console.log(JSON.stringify({phase:'growth',...growth()}));console.log(JSON.stringify({phase:'benchmark',rows:benchmarks()}));process.exit(0);}

const matrix:Record<string,unknown>[]=[],examples:Record<string,unknown>[]=[],aggregate=new Map<string,{n:number;kill:number;loss:number;above5:number;increased:number;maxDice:number}>();
for(let L=1;L<=10;L++){
  for(const weapon of ['greatsword','dagger','rifle','crossbow','magic','cannon'])for(const tier of [1,2,3,4]as const)for(const channel of ['none','arcane']as const)
  for(const gap of [0,1,2])for(const profile of ['plain','stacked','maximum'])for(const skill of [false,true]){
    const attack={damage:profile==='maximum'?10:4,penetration:profile==='maximum'?10:3},skillBonus={damage:profile==='maximum'?10:3,penetration:profile==='maximum'?10:2};
    const a=unit('a',{level:L,weaponClass:weapon,weaponLevel:L,armorLevel:L,weaponEnchantment:channel,weaponBonuses:profile==='plain'?undefined:attack,
      bonuses:profile==='maximum'?{damage:10}:undefined,...(skill?{abilityBlueprints:[{id:skillDefinitionId('物理单体')!,level:Math.max(1,L-1),bonuses:profile==='plain'?undefined:skillBonus}]}:{})});
    if(profile!=='plain')item(a,L,'damage');
    const d=unit('d',{level:L,weaponLevel:L,armorTier:tier,armorLevel:Math.min(10,L+gap),armorBonuses:profile==='plain'?undefined:{defense:4,kineticProtection:3}});
    const b=basis(options(a,d,skill?a.abilities[0]:undefined)),measured=models.map(model=>measure(b,model));
    if(b.p.exact)assert.ok(Math.abs(measured[0]!.expectedLoss-b.p.expectedDamage)<1e-5,JSON.stringify({L,weapon,tier,channel,gap,profile,skill,analytic:measured[0]!.expectedLoss,engine:b.p.expectedDamage}));
    for(const m of measured){
      if(m.model!=='anchored-source')assert.ok(Math.abs(m.normalMean-measured[0]!.normalMean)<1e-5,'Matched mean drift');
      const row={L,weapon,tier,channel,gap,profile,skill,...m};matrix.push(row);
      if(L===4&&tier===2&&gap===0&&channel==='arcane'&&profile==='stacked')examples.push(row);
      const key=profile+':'+m.model,v=aggregate.get(key)??{n:0,kill:0,loss:0,above5:0,increased:0,maxDice:0};v.n++;v.kill+=m.kill;v.loss+=m.expectedLoss/d.hp;v.above5+=Number(m.kill>.05+1e-10);v.increased+=Number(m.kill>measured[0]!.kill+1e-6);v.maxDice=Math.max(v.maxDice,Math.ceil(m.pureDice));aggregate.set(key,v);
    }
  }
  console.log(JSON.stringify({phase:'matrix',L,rows:matrix.length,elapsedMs:performance.now()-started}));
}
save('matrix',matrix);save('examples',examples);
save('summary',{risk,groups:[...aggregate].map(([key,v])=>({key,...v,meanKill:v.kill/v.n,meanLossRatio:v.loss/v.n})),scope:'8640 fixed source/target scenarios; four models. Unshielded human single-channel attack/skill actions; whole action clips independent shots at remaining HP. Pure and anchored-matched retain normal mean before armor/HP clipping. Anchored-source changes both reinforcement budget and critical participation.'});
console.log(JSON.stringify({phase:'complete',groups:[...aggregate].map(([key,v])=>({key,...v,meanKill:v.kill/v.n,meanLossRatio:v.loss/v.n})),elapsedMs:performance.now()-started}));
