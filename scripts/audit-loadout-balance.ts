/** Read-only balance audit of current V39. Never changes production rules, saves or prompts. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as E from '../engine/src/index.js';
import { compileWeapon, compileArmor } from '../engine/src/gen/equipment.js';
import { skillAttack } from '../engine/src/skill-attack.js';
import { ENHANCEMENT_STATS, bonusMultiplier, bonusRating, bonusSteps, type BonusKind, type BonusStat, type Enhancements } from '../engine/src/enhancements.js';
import { equipmentMultiplier, equipmentRating, equipmentStep, unitMultiplier, unitStep } from '../engine/src/numeric-model.js';
import { compileWornEffects, wornEffects, WORN_ANCHORED_MODEL } from '../engine/src/gear-bonuses.js';
import { movementPoints } from '../engine/src/tactics.js';
import { equipmentLoad, equipmentCapacity, loadRatio } from '../engine/src/equipment-load.js';
import { equipmentReason, compileItem, gearItem, itemAbilityTemplate } from '../engine/src/items.js';
import { GRADED_TRAITS } from '../engine/src/data/traits.js';
import { traitLadderSummary } from '../engine/src/trait-levels.js';
import { TRAIT_PARAMETERS, traitParameter } from '../engine/src/trait-parameters.js';
import { STACKING_PARAMETERS, STACKING_MODEL } from '../engine/src/progression.js';
import { combatWeapon, anchoredProtection, gradeOvermatch, penetrationThrough, POWER_ANCHORS } from '../engine/src/power-anchors.js';
import { diceAvg } from '../engine/src/data/weapons.js';
import { diceDistribution } from '../engine/src/probability.js';
import type { AttackOpts } from '../engine/src/damage.js';
import type { Combatant, GenerateInput, RulePack, Ability } from '../engine/src/types.js';

const registry = E.traitRegistry(), conditionDefs = E.standardConditionMap();
const rules = E.V39_OVERFLOW_D20, out = 'artifacts/loadout-balance-20261028';
mkdirSync(out, {recursive:true});
const round = (v: number) => Number(v.toFixed(8));
const save = (name: string, value: unknown) => writeFileSync(`${out}/${name}.json`, JSON.stringify(value, null, 2)+'\n');
const csv = (name:string, rows:Record<string,unknown>[]) => {
  const keys = [...new Set(rows.flatMap(r=>Object.keys(r)))];
  const q = (v:unknown) => '"'+String(v ?? '').replaceAll('"','""')+'"';
  writeFileSync(`${out}/${name}.csv`, keys.map(q).join(',')+'\n'+rows.map(r=>keys.map(k=>q(typeof r[k]==='object'?JSON.stringify(r[k]):r[k])).join(',')).join('\n')+'\n');
};
const baseInput = {rulesVersion:'v2',damageModel:'wounds-v2',numericModel:'graded-v1',loadModel:'capacity-v2',body:'human',scale:'hero',archetype:'infantry',level:4,weaponClass:'sword',weaponLevel:4,armorTier:2,armorLevel:4,traits:[]} as const;
function unit(overrides:Partial<GenerateInput>={}, side:'ally'|'enemy'='ally'):Combatant {
  const u=E.generateUnit({...baseInput,...overrides,traits:overrides.traits??[],name:side,side},{seed:`audit:${side}`,noVariance:true,registry,skillModel:rules.skillModel}).unit;
  new E.SmallBattle({combatants:[u],rules,seed:'prepare',traitRegistry:registry});
  return u;
}
const field = E.standardField(); field.tiles.fill('open');
function opts(a:Combatant,d:Combatant,ability?:Ability,pack=rules):Omit<AttackOpts,'rng'> {
  a.pos=a.weapon?.tags?.includes('ranged')?38:31; d.pos=24;
  const damage = ability?.effects.find(e=>e.op==='damage');
  return {attacker:a,defender:d,rules:pack,conditionDefs,traitRegistry:registry,distance:a.weapon?.tags?.includes('ranged')?2:1,
    ...(ability&&damage&&damage.op==='damage'?skillAttack({mode:'small',units:[a,d],battlefield:field,fieldTags:[]},a,d,ability,damage,pack):{ranged:!!a.weapon?.tags?.includes('ranged')})};
}
function inContext(a:Combatant,d:Combatant,tags:string[],charge=false) {
  const o={...opts(a,d),fieldTags:tags,attackerTerrain:tags.includes('forest')?'forest':'open',defenderTerrain:tags.includes('forest')?'forest':'open',charge,chargeDistance:3,chargeStraight:true};
  const p=E.previewAttack(o);return {hit:p.hitChance,expected:p.expectedDamage,through:p.penetrationFactor,attack:p.attackScore,defense:p.defenseScore};
}
function meanRng(crit=false) { let die=0; return {seed:'mean',next:()=>.5,d:(s:number)=>s===20?crit?20:18:s===6?3+die++%2:Math.ceil((s+1)/2)}; }
function measure(a:Combatant,d:Combatant,ability?:Ability,pack=rules) {
  const o=opts(a,d,ability,pack), p=E.previewAttack(o);
  const normal=E.resolveAttack({...o,attacker:structuredClone(a),defender:structuredClone(d),autoHit:true,rng:meanRng()});
  return {hp:d.hp,hit:round(p.hitChance),crit:p.critChance,expected:round(p.expectedDamage),normal:round((normal.baseAfterDR+normal.apTotal)*normal.dmgMult*normal.wardMult),loss:normal.finalDamage,
    normalHit:p.normalHitDamage,criticalHit:p.criticalHitDamage,exact:p.exact,expectedCasualties:p.expectedCasualties,
    channel:p.channel,penetration:p.penetration,resistance:p.resistance,through:p.penetrationFactor,overmatch:p.overmatchMultiplier,
    attack:p.attackScore,defense:p.defenseScore,participants:p.participants,shots:a.weapon?.attacks??1,load:equipmentLoad(a),capacity:equipmentCapacity(a),illegal:equipmentReason(a)??null};
}
if(process.argv.includes('--probe')) {
  const a=unit({weaponClass:'greatsword',abilityBlueprints:[{id:E.skillDefinitionId('物理单体近战')!,level:4}]}),d=unit({},'enemy');
  const item=compileItem({kind:'item',form:'worn',power:4,bonuses:{damage:10}},{id:'probe',name:'probe',seed:'probe'});
  console.log(JSON.stringify({weaponClasses:Object.keys(E.WEAPON_CLASSES),measure:measure(a,d,a.abilities[0]),ability:a.abilities[0],traitCount:GRADED_TRAITS.length,skillCategories:E.SKILL_CATEGORIES,sampleResolution:E.resolveAttack({...opts(a,d),rng:meanRng(),autoHit:true})},null,2));
  process.exit(0);
}
const phase=process.argv.find(a=>a.startsWith('--phase='))?.slice(8)??'all';
const enabled=(p:string)=>phase==='all'||phase===p;
const metadata={head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),version:'3.0.24',rules:rules.id,
  method:'Current generated recipes; actual SmallBattle constructor prepares rules, skills, resources, arms, item and trait models. Fixed noVariance; preview includes actual hit/critical and hp clipping. Normal column is representative mean-dice before hp clipping; single-packet exact flag reported by engine. Matrix is attack-level coverage, not duel win rates. Shields and multishot may use engine 96 samples. Legal configurations and overload reported separately.',
  limits:'Finite catalog/marginal/pairwise/risk coverage, not the exponential Cartesian product of arbitrary names, numbers, traits, effects, maps or inventories. No claim of human perceptual validation.'};
save('metadata',metadata);
function abilityFor(name:string,L:number,bonuses?:Enhancements):Ability {
  const id=E.skillDefinitionId(name);if(!id)throw Error('Unknown skill '+name);
  return unit({abilityBlueprints:[{id,level:L,bonuses}]}).abilities[0]!;
}
function functionalAbility(a:Ability) {
  return {effects:a.effects,range:a.range,damageScale:a.damageScale,weaponDamageMult:a.weaponDamageMult,penetration:a.penetration,
    channel:a.channel,cost:a.cost,cooldown:a.cooldown,uses:a.usesPerBattle,area:a.area};
}
function effectVector(kind:BonusKind,stat:BonusStat,L:number,p:number) {
  const b={[stat]:p};
  if(kind==='gear')return compileWornEffects(b,L).values;
  if(kind==='skill'||kind==='charged') {
    const name=stat==='healing'?'增益治疗':stat==='duration'?'增益攻击':stat==='resource'?'增益回能':stat==='morale'?'增益士气':stat.startsWith('kinetic')?'物理单体投射':stat.startsWith('thermal')?'魔法单体热能':'魔法单体奥术';
    const a=kind==='skill'?abilityFor(name,L,b):itemAbilityTemplate(E.skillDefinitionId(name)!,L,b,'charged');
    return {...functionalAbility(a),runtimeAccuracy:bonusSteps(b,'accuracy'),runtimeChannelDamage:bonusMultiplier(b,'damage',a.channel),runtimeChannelPenetration:bonusRating(b,'penetration',a.channel)};
  }
  if(kind==='unit') {
    const u=unit({level:L,bonuses:b});
    return {hp:u.base.hpMax,damage:['kinetic','thermal','arcane'].map(c=>unitMultiplier(u,'damage',c as E.DamageChannel)),
      health:unitMultiplier(u,'health'),steps:['accuracy','defense','speed','morale'].map(k=>unitStep(u,k as BonusStat)),movement:movementPoints(u)};
  }
  const recipe={version:'mechanism-v2.3',mechanism:kind==='weapon'?'sword':kind==='armor'?'armor:2':'shield',power:L,quality:3,size:'human',seed:'audit',numericModel:'graded-v1',bonuses:b} as const;
  return {multipliers:['kinetic','thermal','arcane'].map(c=>equipmentMultiplier(recipe,kind==='weapon'?'damage':'power',c as E.DamageChannel)),
    ratings:['kinetic','thermal','arcane'].map(c=>equipmentRating(recipe,kind==='weapon'?'penetration':'protection',c as E.DamageChannel)),
    steps:['accuracy','defense','speed','range','morale'].map(k=>equipmentStep(recipe,k as BonusStat)),weight:1.1**(b.weight??0)};
}
if(enabled('numeric')) {
  const rows:Record<string,unknown>[]=[],summary:Record<string,unknown>[]=[],levelRows:Record<string,unknown>[]=[];
  for(const [kind,stats] of Object.entries(ENHANCEMENT_STATS) as [BonusKind,BonusStat[]][])for(const stat of stats) {
    let deadPoints=0,total=0,deadLevels=0;const examples:unknown[]=[];
    for(let L=1;L<=10;L++) {
      let prev:unknown;
      for(let p=-10;p<=10;p++) {
        const value=effectVector(kind,stat,L,p),dead=p>-10&&JSON.stringify(value)===JSON.stringify(prev);
        rows.push({kind,stat,level:L,points:p,value,deadFromPrevious:dead});
        if(p>-10){total++;if(dead){deadPoints++;if(examples.length<8)examples.push({L,from:p-1,to:p});}}
        prev=value;
      }
    }
    for(let p=1;p<=10;p++)for(let L=2;L<=10;L++) {
      const before=effectVector(kind,stat,L-1,p),after=effectVector(kind,stat,L,p),dead=JSON.stringify(before)===JSON.stringify(after);
      levelRows.push({kind,stat,points:p,fromLevel:L-1,toLevel:L,dead,before,after});deadLevels+=Number(dead);
    }
    summary.push({kind,stat,deadPoints,total,deadLevels,totalLevels:90,examples});
  }
  // Exhaust all signed power+damage+selected-channel point allocations and all penetration/protection pairs.
  const combined:Record<string,unknown>[]=[],signedPairs:Record<string,unknown>[]=[];
  for(let L=1;L<=10;L++) {
    let count=0,saturated=0,zero=0,deadNext=0;
    for(let power=-10;power<=10;power++)for(let damage=-10;damage<=10;damage++)for(let channel=-10;channel<=10;channel++) {
      const recipe={numericModel:'graded-v1',power:L,bonuses:{power,damage,kineticDamage:channel}} as E.ItemRecipe;
      const v=equipmentMultiplier(recipe,'damage','kinetic');count++;saturated+=Number(v===2);zero+=Number(v===0);
      if(damage<10)deadNext+=Number(v===equipmentMultiplier({...recipe,bonuses:{...recipe.bonuses,damage:damage+1}},'damage','kinetic'));
    }
    combined.push({level:L,count,saturatedAt2:saturated,zero,deadDamageNext:deadNext,eligibleDamageNext:21*20*21});
    for(const mechanism of ['sword','cannon'])for(const direction of ['penetration','protection'] as const)for(let generic=-10;generic<=10;generic++)for(let specific=-10;specific<=10;specific++) {
      const stat=('kinetic'+direction[0]!.toUpperCase()+direction.slice(1)) as BonusStat;
      const recipe={numericModel:mechanism==='cannon'?undefined:'graded-v1',power:L,bonuses:{[direction]:generic,[stat]:specific}} as E.ItemRecipe;
      signedPairs.push({level:L,mechanism,direction,generic,specific,value:equipmentRating(recipe,direction,'kinetic')});
    }
  }
  csv('numeric-marginals',rows);csv('numeric-levels',levelRows);csv('signed-rating-pairs',signedPairs);save('numeric-summary',{summary,combined,counts:{marginals:rows.length,levels:levelRows.length,signedRatingPairs:signedPairs.length,combined:combined.reduce((n,r)=>n+Number(r.count),0)}});
  console.log(JSON.stringify({phase:'numeric',rows:rows.length,levels:levelRows.length,summary:summary.filter(s=>Number(s.deadPoints)>0||Number(s.deadLevels)>0),combined}));
}
if(enabled('catalog')) {
  const rows:Record<string,unknown>[]=[],cross:Record<string,unknown>[]=[],shields=['none','buckler','shield','tower-shield','energy-shield'] as const;
  for(let L=1;L<=10;L++) {
    const defenders=new Map<string,Combatant>();
    for(const tier of [0,1,2,3,4] as const)for(const profile of ['balanced','kinetic','thermal','arcane'] as const)for(const shield of shields)
      defenders.set(`${tier}:${profile}:${shield}`,unit({level:L,weaponLevel:L,armorLevel:L,armorTier:tier,armorProfile:profile,shield:shield!=='none',...(shield!=='none'?{shieldClass:shield,shieldLevel:L}:{})},'enemy'));
    for(const weapon of Object.keys(E.WEAPON_CLASSES)) {
      const a=unit({level:L,weaponClass:weapon,weaponLevel:L,armorLevel:L});
      for(const [key,d] of defenders)for(const pack of [rules,E.V39_OVERFLOW_TW]) {
        const [tier,profile,shield]=key.split(':');rows.push({level:L,weapon,tier:Number(tier),profile,shield,mode:pack.hitMode,...measure(a,d,undefined,pack),targetIllegal:equipmentReason(d)??null});
      }
    }
    console.log(JSON.stringify({phase:'catalog',level:L,rows:rows.length}));
  }
  csv('catalog',rows);
  for(const weapon of Object.keys(E.WEAPON_CLASSES))for(let attackL=1;attackL<=10;attackL++)for(let defenseL=1;defenseL<=10;defenseL++)for(const tier of [0,1,2,3,4] as const)for(const enchant of ['none','thermal','arcane'] as const) {
    const a=unit({weaponClass:weapon,weaponLevel:attackL,armorTier:0,...(enchant==='none'?{}:{weaponEnchantment:enchant})});
    const d=unit({armorLevel:defenseL,armorTier:tier},'enemy');
    cross.push({weapon,attackL,defenseL,tier,enchant,...measure(a,d)});
  }
  csv('cross-level',cross);save('catalog-summary',{sameLevel:rows.length,crossLevel:cross.length,zeroDamage:rows.filter(r=>r.expected===0).length,illegal:rows.filter(r=>r.illegal||r.targetIllegal).length,
    byWeapon:Object.keys(E.WEAPON_CLASSES).map(weapon=>{const rs=rows.filter(r=>r.weapon===weapon&&r.profile==='balanced'&&r.shield==='none'&&r.mode==='d20');return {weapon,zero:rs.filter(r=>r.expected===0).length,max:Math.max(...rs.map(r=>Number(r.expected)/Number(r.hp))),mean:rs.reduce((n,r)=>n+Number(r.expected)/Number(r.hp),0)/rs.length};})});
  console.log(JSON.stringify({phase:'catalog',sameLevel:rows.length,crossLevel:cross.length}));
}
if(enabled('skills')) {
  const singles:Record<string,unknown>[]=[],pairs:Record<string,unknown>[]=[],dead:Record<string,unknown>[]=[],failures:Record<string,unknown>[]=[];
  for(const category of E.SKILL_CATEGORIES) {
    const mods=E.allowedSkillModifiers(category.id);
    for(const mod of mods)for(const area of [false,true]) {
      let previous:unknown;
      for(let L=1;L<=10;L++) {
        const id=E.skillMechanismId({category:category.id,area,modifiers:[mod.id]});
        try { const a=abilityFor(id,L),signature=functionalAbility(a),plateau=L>1&&JSON.stringify(signature)===JSON.stringify(previous);
          singles.push({category:category.id,modifier:mod.id,areaVariant:area,level:L,...signature,plateau});if(plateau)dead.push({category:category.id,modifier:mod.id,area,from:L-1,to:L});previous=signature;
        }catch(e){failures.push({id,L,error:String(e)});}
      }
    }
    for(let i=0;i<mods.length;i++)for(let j=i+1;j<mods.length;j++)for(const L of [1,4,7,10]) {
      const id=E.skillMechanismId({category:category.id,area:false,modifiers:[mods[i]!.id,mods[j]!.id]});
      try { const a=abilityFor(id,L);pairs.push({category:category.id,first:mods[i]!.id,second:mods[j]!.id,level:L,...functionalAbility(a)}); }
      catch(e){failures.push({id,L,error:String(e)});}
    }
  }
  const traits=GRADED_TRAITS.flatMap(id=>Array.from({length:10},(_,i)=>({id,level:i+1,summary:traitLadderSummary(id,i+1,STACKING_MODEL,rules.flightModel)})));
  const parameters=[...new Set([...Object.keys(TRAIT_PARAMETERS),...Object.keys(STACKING_PARAMETERS)])].map(key=>({key,values:Array.from({length:10},(_,i)=>traitParameter(key as keyof typeof TRAIT_PARAMETERS,i+1,STACKING_MODEL))}));
  csv('skill-singles',singles);csv('skill-pairs',pairs);save('skill-summary',{singleCount:singles.length,pairCount:pairs.length,dead,failures,traits,parameters});
  console.log(JSON.stringify({phase:'skills',singles:singles.length,pairs:pairs.length,dead,failures:failures.slice(0,8),failureCount:failures.length}));
}
function putGear(u:Combatant,L:number,bonuses:Enhancements,id='gear') {
  if(!Object.values(bonuses).some(p=>p))return;
  const item=compileItem({kind:'item',form:'worn',power:L,bonuses},{id,name:id,seed:id});if(item.kind!=='item')throw Error('item');
  u.gear=[...(u.gear??[]),gearItem(id,id,item.value)];
}
if(enabled('combat')) {
  const marginal:Record<string,unknown>[]=[],profiles:Record<string,unknown>[]=[],anchors:Record<string,unknown>[]=[],bodyRows:Record<string,unknown>[]=[];
  for(let L=1;L<=10;L++) {
    // All weapons: every signed damage/accuracy/penetration/own-channel point against all armor weights.
    for(const weapon of Object.keys(E.WEAPON_CLASSES))for(const tier of [0,1,2,3,4] as const)for(const stat of ['damage','accuracy','penetration'] as const) {
      const d=unit({level:L,weaponLevel:L,armorLevel:L,armorTier:tier},'enemy');let previous:ReturnType<typeof measure>|undefined;
      for(let p=-10;p<=10;p++) {
        const a=unit({level:L,weaponClass:weapon,weaponLevel:L,armorLevel:L,weaponBonuses:{[stat]:p}}),m=measure(a,d);
        marginal.push({kind:'weapon',weapon,tier,level:L,stat,points:p,...m,delta:previous?round(m.expected-previous.expected):null});previous=m;
      }
    }
    const bonusProfiles = {
      plain:{},moderate:{weaponBonuses:{damage:4,penetration:3},skillBonuses:{damage:3,penetration:2}},
      maximum:{weaponBonuses:{power:10,damage:10,penetration:10},skillBonuses:{power:10,damage:10,penetration:10},unitBonuses:{damage:10}},
      equal12:{weaponBonuses:{damage:4,penetration:3},skillBonuses:{damage:3,penetration:2},armorBonuses:{defense:4,kineticProtection:3},defenderBonuses:{health:5}},
      offchannel:{weaponBonuses:{thermalDamage:4,arcaneDamage:3},skillBonuses:{damage:3,penetration:2}},
    } as const;
    for(const weapon of Object.keys(E.WEAPON_CLASSES))for(const [profile,b] of Object.entries(bonusProfiles))for(const tier of [0,1,2,3,4] as const)for(const enchant of ['none','thermal','arcane'] as const) {
      const params=b as {weaponBonuses?:Enhancements;skillBonuses?:Enhancements;unitBonuses?:Enhancements;armorBonuses?:Enhancements;defenderBonuses?:Enhancements};
      const a=unit({level:L,weaponClass:weapon,weaponLevel:L,armorLevel:L,weaponBonuses:params.weaponBonuses,bonuses:params.unitBonuses,
        ...(enchant==='none'?{}:{weaponEnchantment:enchant}),abilityBlueprints:[{id:E.skillDefinitionId(E.WEAPON_CLASSES[weapon]!.profile.range>1?'物理单体射击':'物理单体近战')!,level:L,bonuses:params.skillBonuses}]});
      const d=unit({level:L,weaponLevel:L,armorLevel:L,armorTier:tier,armorBonuses:params.armorBonuses,bonuses:params.defenderBonuses},'enemy');
      for(const skill of [false,true])profiles.push({profile,weapon,level:L,tier,enchant,skill,...measure(a,d,skill?a.abilities[0]:undefined)});
    }
    // Training and technology independent: fixed opponent and fixed equipment, then equipment steps at fixed T.
    for(const weapon of ['sword','greatsword','rifle','magic'])for(const axis of ['training','weapon','armor'] as const) {
      const a=unit({weaponClass:weapon,armorTier:0,...(axis==='training'?{level:L}:axis==='weapon'?{weaponLevel:L}:{})});
      const d=unit({armorLevel:axis==='armor'?L:4},'enemy');anchors.push({axis,level:L,weapon,...measure(a,d),actorHp:a.base.hpMax});
    }
    for(const body of ['human','large','giant','vehicle'] as const)for(const scale of ['hero','company'] as const)for(const weapon of ['sword','spear','rifle','autocannon','cannon','rocket','sprayer','energy'])for(const targetBody of ['human','vehicle'] as const) {
      const a=unit({level:L,weaponLevel:L,armorLevel:L,body,scale,...(scale==='company'?{hpMax:50,hp:50}:{}),weaponClass:weapon});
      const d=unit({level:L,weaponLevel:L,armorLevel:L,body:targetBody,scale,...(scale==='company'?{hpMax:50,hp:50}:{})},'enemy');
      bodyRows.push({level:L,body,scale,weapon,targetBody,...measure(a,d)});
    }
    console.log(JSON.stringify({phase:'combat',level:L,marginals:marginal.length,profiles:profiles.length}));
  }
  csv('combat-marginals',marginal);csv('combat-profiles',profiles);csv('anchors',anchors);csv('body-formations',bodyRows);
  const groups=new Map<string,Record<string,unknown>[]>();for(const r of marginal){const k=`${r.stat}:L${r.level}`;groups.set(k,[...(groups.get(k)??[]),r]);}
  save('combat-summary',{counts:{marginals:marginal.length,profiles:profiles.length,anchors:anchors.length,bodies:bodyRows.length},marginals:[...groups].map(([key,rs])=>({key,totalSteps:rs.filter(r=>r.delta!==null).length,zeroSteps:rs.filter(r=>r.delta===0).length,negativeSteps:rs.filter(r=>Number(r.delta)<-1e-6).length})),
    anchorRows:anchors,bodyRows});
}
if(enabled('interactions')) {
  const single:Record<string,unknown>[]=[],pairs:Record<string,unknown>[]=[],gear:Record<string,unknown>[]=[],mitigation:Record<string,unknown>[]=[];
  const contexts=[{name:'open',tags:[]},{name:'night',tags:['night']},{name:'forest',tags:['forest']},{name:'plains',tags:['plains']},{name:'urban',tags:['urban']},{name:'charge',tags:['plains'],charge:true}];
  for(const trait of GRADED_TRAITS)for(let L=1;L<=10;L++)for(const context of contexts)for(const role of ['offense','defense']) {
    const t=unit({traits:[trait],traitLevels:{[trait]:L},shield:true,shieldClass:'shield'}),plain=unit({},'enemy');
    single.push({trait,level:L,context:context.name,role,prerequisite:E.traitPrerequisiteReason(t,trait)??null,
      ...inContext(role==='offense'?t:plain,role==='offense'?plain:t,context.tags,context.charge)});
  }
  for(const L of [1,4,7,10]) {
    for(let i=0;i<GRADED_TRAITS.length;i++)for(let j=i+1;j<GRADED_TRAITS.length;j++)for(const context of contexts.slice(0,2))for(const role of ['offense','defense']) {
      const ids=[GRADED_TRAITS[i]!,GRADED_TRAITS[j]!],t=unit({traits:ids,traitLevels:Object.fromEntries(ids.map(id=>[id,L])),shield:true,shieldClass:'shield'}),plain=unit({},'enemy');
      pairs.push({first:ids[0],second:ids[1],level:L,role,context:context.name,prerequisites:ids.map(id=>E.traitPrerequisiteReason(t,id)??null),
        ...inContext(role==='offense'?t:plain,role==='offense'?plain:t,context.tags,context.charge)});
    }
    console.log(JSON.stringify({phase:'interactions',traitLevel:L,pairs:pairs.length}));
  }
  for(let L=1;L<=10;L++)for(const stat of ENHANCEMENT_STATS.gear)for(let p=-10;p<=10;p++) {
    const u=unit();putGear(u,L,{[stat]:p},'new');const alone=wornEffects(u);putGear(u,L,{[stat]:10},'existing');const shadowed=wornEffects(u);
    gear.push({level:L,stat,points:p,alone,withPlus10:shadowed});
  }
  for(let L=1;L<=10;L++)for(const weapon of ['sword','rifle','magic'])for(const tier of [1,2,3,4] as const)for(const stat of ['defense','power','protection','kineticProtection','thermalProtection','arcaneProtection'] as const)for(let p=-10;p<=10;p++) {
    const a=unit({level:L,weaponLevel:L,weaponClass:weapon}),d=unit({level:L,weaponLevel:L,armorLevel:L,armorTier:tier,armorBonuses:{[stat]:p}},'enemy');
    mitigation.push({level:L,weapon,tier,stat,points:p,...measure(a,d)});
  }
  csv('trait-singles',single);csv('trait-pairs',pairs);csv('worn-overlap',gear);csv('defense-marginals',mitigation);
  save('interactions-summary',{singles:single.length,pairs:pairs.length,gear:gear.length,defenseMarginals:mitigation.length,
    topPairs:[...pairs].filter(p=>p.role==='offense').sort((a,b)=>Number(b.expected)-Number(a.expected)).slice(0,15)});
  console.log(JSON.stringify({phase:'interactions',singles:single.length,pairs:pairs.length,gear:gear.length,defense:mitigation.length}));
}
if(enabled('duels')) {
  const definitions:{name:string;a:Partial<GenerateInput>;b:Partial<GenerateInput>;gearA?:Enhancements;gearB?:Enhancements}[]=[
    {name:'greatsword-vs-sword-shield',a:{weaponClass:'greatsword'},b:{shield:true,shieldClass:'shield'}},
    {name:'same10-damage-vs-penetration',a:{weaponBonuses:{damage:10}},b:{weaponBonuses:{penetration:10}}},
    {name:'same10-damage-vs-health',a:{weaponBonuses:{damage:10}},b:{bonuses:{health:10}}},
    {name:'moderate12-vs-defense12',a:{weaponClass:'greatsword',weaponBonuses:{damage:4,penetration:3},abilityBlueprints:[{id:E.skillDefinitionId('物理单体近战')!,bonuses:{damage:3,penetration:2}}]},b:{armorBonuses:{defense:4,kineticProtection:3},bonuses:{health:5}}},
    {name:'conversion-vs-extra-channel',a:{weaponClass:'greatsword',weaponEnchantment:'arcane',weaponBonuses:{damage:7}},b:{weaponClass:'greatsword',weaponBonuses:{arcaneDamage:7}}},
    {name:'rifle-vs-heavy-rifle',a:{weaponClass:'rifle'},b:{weaponClass:'heavy-rifle'}},
    {name:'sprayer-vs-rifle',a:{weaponClass:'sprayer'},b:{weaponClass:'rifle'}},
    {name:'regen-vs-melee',a:{traits:['regen']},b:{traits:['melee-master']}},
    {name:'guardian-regen-vs-berserk-melee',a:{traits:['guardian','regen']},b:{traits:['berserk','melee-master']}},
    {name:'offense-gear-vs-health-gear',a:{},b:{},gearA:{damage:10},gearB:{health:10}},
    {name:'skill-heal-vs-skill-barrier',a:{abilityBlueprints:[{id:E.skillDefinitionId('增益治疗')!}]},b:{abilityBlueprints:[{id:E.skillDefinitionId('增益屏障')!}]}},
    {name:'skill-control-vs-plain',a:{abilityBlueprints:[{id:E.skillDefinitionId('减益眩晕')!}]},b:{}},
  ];
  const seeds=Number(process.argv.find(x=>x.startsWith('--seeds='))?.slice(8)??8),rows:Record<string,unknown>[]=[],summary:Record<string,unknown>[]=[];
  for(const L of [4,8])for(const definition of definitions) {
    for(let seed=0;seed<seeds;seed++)for(const swap of [false,true]) {
      const make=(p:Partial<GenerateInput>,side:'ally'|'enemy')=>unit({level:L,weaponLevel:L,armorLevel:L,...p,
        traitLevels:Object.fromEntries((p.traits??[]).map(id=>[id,L])),
        ...(p.abilityBlueprints?{abilityBlueprints:p.abilityBlueprints.map(b=>typeof b==='string'?{id:b,level:L}:{...b,level:L})}:{}),
        ...(p.shield?{shieldLevel:L}:{})},side);
      const a=make(definition.a,swap?'enemy':'ally'),b=make(definition.b,swap?'ally':'enemy');
      if(definition.gearA)putGear(a,L,definition.gearA,'a-gear');if(definition.gearB)putGear(b,L,definition.gearB,'b-gear');
      const battle=new E.SmallBattle({combatants:swap?[b,a]:[a,b],rules,battlefield:field,seed:`duel:${L}:${seed}`,traitRegistry:registry});
      battle.start();a.pos=a.weapon?.tags?.includes('ranged')?38:31;b.pos=24;
      let steps=0,error:string|undefined;
      while(!battle.isOver()&&battle.round<=30&&steps<120) {
        const active=battle.active;if(!active)break;steps++;
        try{battle.autoAction(active.id);}catch(e){error=String(e);break;}
      }
      const winner=battle.winner();
      rows.push({name:definition.name,level:L,seed,swap,winA:winner===a.side,winB:winner===b.side,winner:winner??null,timeout:!battle.isOver(),rounds:battle.round,steps,aHp:a.hp,bHp:b.hp,aFatigue:a.fatigue,bFatigue:b.fatigue,aSp:a.resources.SP,bSp:b.resources.SP,error:error??null});
      if(error)throw Error(JSON.stringify(rows.at(-1)));
    }
    const rs=rows.filter(r=>r.level===L&&r.name===definition.name),wins=rs.filter(r=>r.winA).length,n=rs.length,p=wins/n,z=1.96,den=1+z*z/n,center=(p+z*z/(2*n))/den,half=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/den;
    const s={name:definition.name,level:L,n,aWins:wins,bWins:rs.filter(r=>r.winB).length,timeouts:rs.filter(r=>r.timeout).length,meanRounds:round(rs.reduce((n,r)=>n+Number(r.rounds),0)/n),win95Low:round(center-half),win95High:round(center+half)};summary.push(s);console.log(JSON.stringify({phase:'duels',...s}));
    csv('duels',rows);save('duel-summary',{seedCount:seeds,summary});
  }
}
if(enabled('mass')) {
  const cases:{name:string;a:Partial<GenerateInput>;b:Partial<GenerateInput>}[]=[
    {name:'rifle-vs-heavy-rifle',a:{weaponClass:'rifle'},b:{weaponClass:'heavy-rifle'}},
    {name:'cannon-vs-autocannon',a:{weaponClass:'cannon'},b:{weaponClass:'autocannon'}},
    {name:'sprayer-vs-rifle',a:{weaponClass:'sprayer'},b:{weaponClass:'rifle'}},
    {name:'energy-shield-vs-plain',a:{weaponClass:'rifle',shield:true,shieldClass:'energy-shield'},b:{weaponClass:'rifle'}},
    {name:'guardian-regen-vs-berserk-melee',a:{traits:['guardian','regen']},b:{traits:['berserk','melee-master']}},
  ];
  const rows:Record<string,unknown>[]=[],summary:Record<string,unknown>[]=[];
  for(const L of [4,8])for(const c of cases) {
    for(let seed=0;seed<8;seed++)for(const swap of [false,true]) {
      const make=(p:Partial<GenerateInput>,side:'ally'|'enemy')=>{const u=unit({level:L,weaponLevel:L,armorLevel:L,scale:'company',hp:50,hpMax:50,...p,
        traitLevels:Object.fromEntries((p.traits??[]).map(id=>[id,L])),...(p.shield?{shieldLevel:L}:{})},side);u.tags.push('zone:中军','rank:front');return u;};
      const a=make(c.a,swap?'enemy':'ally'),b=make(c.b,swap?'ally':'enemy');delete a.pos;delete b.pos;
      const battle=new E.MassBattle({combatants:swap?[b,a]:[a,b],rules:E.V39_OVERFLOW_TW,seed:`mass:${L}:${seed}`,traitRegistry:registry});battle.start();
      while(!battle.isOver()&&battle.round<=30){battle.autoOrders('ally');battle.autoOrders('enemy');battle.resolveRound();}
      const w=battle.winner();rows.push({name:c.name,level:L,seed,swap,winA:w===a.side,winB:w===b.side,timeout:!battle.isOver(),rounds:battle.round,aMembers:a.hp,bMembers:b.hp,aFatigue:a.fatigue,bFatigue:b.fatigue});
    }
    const rs=rows.filter(r=>r.level===L&&r.name===c.name);const s={name:c.name,level:L,n:rs.length,aWins:rs.filter(r=>r.winA).length,bWins:rs.filter(r=>r.winB).length,timeouts:rs.filter(r=>r.timeout).length,meanRounds:rs.reduce((n,r)=>n+Number(r.rounds),0)/rs.length};summary.push(s);
    console.log(JSON.stringify({phase:'mass',...s}));csv('mass',rows);save('mass-summary',{summary});
  }
}
if(enabled('witnesses')) {
  const skillPoints=Array.from({length:11},(_,p)=>{
    const a=unit({abilityBlueprints:[{id:E.skillDefinitionId('魔法单体奥术')!,level:4,bonuses:{accuracy:p}}]}),d=unit({},'enemy'),ability=a.abilities[0]!;
    const o=opts(a,d,ability),current=E.previewAttack(o),candidate=E.previewAttack({...o,abilityDamage:{...o.abilityDamage!,accuracy:p/3}});
    return {p,currentHit:current.hitChance,candidateHit:candidate.hitChance,currentExpected:current.expectedDamage,candidateExpected:candidate.expectedDamage,
      range:abilityFor('魔法单体奥术',4,{range:p}).range?.max,duration:abilityFor('增益攻击',4,{duration:p}).effects.find(e=>e.op==='condition'),resource:abilityFor('增益回能',4,{resource:p}).effects};
  });
  const overlap=[],gearLevel=[];
  for(let L=1;L<=10;L++)for(const p of [1,5,10]){const u=unit();putGear(u,L,{damage:p,speed:p,health:p});gearLevel.push({L,p,effects:wornEffects(u),movement:movementPoints(u)});}
  for(let p=0;p<=10;p++){const u=unit();putGear(u,4,{damage:10},'strong');putGear(u,4,{damage:p},'weak');overlap.push({p,effect:wornEffects(u).kineticDamage});}
  // Independent, sequential full-action samples; actual multi-shot execution stops when the target falls.
  const validation=[];
  for(const weapon of ['rifle','energy'])for(const p of [7,8]) {
    const a=unit({level:1,weaponLevel:1,armorLevel:1,weaponClass:weapon,weaponBonuses:{damage:p}}),d=unit({level:1,weaponLevel:1,armorLevel:1,armorTier:0},'enemy'),o=opts(a,d),rng=new E.SeededRng(`verify:${weapon}`),n=30000;
    let sum=0,square=0,kills=0;
    for(let i=0;i<n;i++) {const target=structuredClone(d);for(let shot=0;shot<(a.weapon?.attacks??1)&&target.hp>0;shot++)E.resolveAttack({...o,defender:target,rng});const loss=d.hp-target.hp;sum+=loss;square+=loss*loss;kills+=Number(target.hp===0);}
    const mean=sum/n,sd=Math.sqrt(Math.max(0,square/n-mean*mean));validation.push({weapon,p,n,mean,standardError:sd/Math.sqrt(n),kills:kills/n,preview:E.previewAttack(o).expectedDamage});
  }
  // Grade jumps and full conversion: exact conditional distributions of single-packet attacks.
  const distributions=[];
  for(const enchant of ['none','thermal','arcane'] as const)for(const gear of [false,true]) {
    const a=unit({weaponClass:'greatsword',weaponBonuses:{damage:4,penetration:3},...(enchant==='none'?{}:{weaponEnchantment:enchant}),
      abilityBlueprints:[{id:E.skillDefinitionId('物理单体近战')!,level:3,bonuses:{damage:3,penetration:2}}]});
    if(gear)putGear(a,4,{damage:10});
    const d=unit({armorBonuses:{defense:4,kineticProtection:3}},'enemy'),o=opts(a,d,a.abilities[0]),p=E.previewAttack(o),r=E.resolveAttack({...o,defender:structuredClone(d),autoHit:true,rng:meanRng()}),coefficient=r.dmgMult*r.wardMult*(r.penetrationFactor??1);
    let normalKill=0,critKill=0;
    for(const [times,key] of [[1,'normal'],[2,'crit']] as const){let kill=0;for(const [roll,prob] of diceDistribution(r.baseRoll!.expr,times)!){const damage=roll*coefficient,lo=Math.floor(damage),f=damage-lo;kill+=prob*((lo>=d.hp?1:0)*(1-f)+(lo+1>=d.hp?1:0)*f);}if(key==='normal')normalKill=kill;else critKill=kill;}
    distributions.push({enchant,gear,hp:d.hp,normalMean:diceAvg(r.baseRoll!.expr)*coefficient,hit:p.hitChance,normalKill,critKill,killPerCast:(p.hitChance-(p.critChance??0))*normalKill+(p.critChance??0)*critKill});
  }
  save('witnesses',{skillPoints,overlap,gearLevel,validation,distributions});console.log(JSON.stringify({phase:'witnesses',skillPoints,validation,distributions}));
}
if(enabled('variance')) {
  const rows=[];
  for(let L=1;L<=10;L++) {
    let pairedInversions=0,independentInversions=0,pairedMin=Infinity,independentMin=Infinity,independentMax=-Infinity;
    for(let i=0;i<2000;i++) {
      const c={id:'variance',seed:`var:${i}`,damageModel:'wounds-v2',numericModel:'graded-v1',loadModel:'capacity-v2',quality:3} as const;
      const base=compileWeapon({mechanism:'sword',power:L,bonuses:{damage:0}},c),paired=compileWeapon({mechanism:'sword',power:L,bonuses:{damage:1}},c),different=compileWeapon({mechanism:'sword',power:L,bonuses:{damage:1}},{...c,seed:`new:${i}`});
      const v=equipmentMultiplier(base.recipe,'damage','kinetic'),p=equipmentMultiplier(paired.recipe,'damage','kinetic')/v-1,d=equipmentMultiplier(different.recipe,'damage','kinetic')/v-1;
      pairedInversions+=Number(p<=0);independentInversions+=Number(d<=0);pairedMin=Math.min(pairedMin,p);independentMin=Math.min(independentMin,d);independentMax=Math.max(independentMax,d);
    }
    rows.push({L,n:2000,pairedInversions,independentInversions,pairedMin,independentMin,independentMax});
  }
  save('variance-summary',{rows});console.log(JSON.stringify({phase:'variance',rows}));
}
