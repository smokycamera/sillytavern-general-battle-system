/** Candidate policies stay in this report: production penetration, damage and HP formulas are untouched. */
import {mkdirSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {generateUnit,SmallBattle,standardField,traitRegistry,standardConditionMap,skillDefinitionId,skillAttack,previewAttack,resolveAttack,V39_OVERFLOW_D20,V40_OVERFLOW_D20,
  compileItem,gearItem,SKILL_CATEGORIES,allowedSkillModifiers,skillMechanismId,abilityCost,type GenerateInput,type Combatant,type Ability,type AttackOpts} from '../engine/src/index.js';
import {diceDistribution} from '../engine/src/probability.js';
import {equipmentMultiplier,unitMultiplier,ratingPerPoint} from '../engine/src/numeric-model.js';
import {bonusMultiplier} from '../engine/src/enhancements.js';
import {wornDamageMultiplier,wornEffects} from '../engine/src/gear-bonuses.js';
const out='artifacts/balance-options-20261028';mkdirSync(out,{recursive:true});
const registry=traitRegistry(),conditionDefs=standardConditionMap(),field=standardField();field.tiles.fill('open');
const save=(name:string,x:unknown)=>writeFileSync(`${out}/${name}.json`,JSON.stringify(x,null,2)+'\n');
const csv=(name:string,rows:Record<string,unknown>[])=>{const keys=Object.keys(rows[0]!),q=(x:unknown)=>'"'+String(x??'').replaceAll('"','""')+'"';writeFileSync(`${out}/${name}.csv`,keys.map(q).join(',')+'\n'+rows.map(r=>keys.map(k=>q(r[k])).join(',')).join('\n')+'\n');};
const base={rulesVersion:'v2',damageModel:'wounds-v2',numericModel:'graded-v1',loadModel:'capacity-v2',body:'human',scale:'hero',archetype:'infantry',level:4,weaponClass:'greatsword',weaponLevel:4,armorTier:2,armorLevel:4} as const;
function make(extra:Partial<GenerateInput>,side:'ally'|'enemy') {return generateUnit({...base,...extra,name:side,side,traits:extra.traits??[]},{seed:side,noVariance:true,registry,skillModel:V39_OVERFLOW_D20.skillModel}).unit;}
function gear(u:Combatant,L:number,stat:'damage'|'health') {const m=compileItem({kind:'item',form:'worn',power:L,bonuses:{[stat]:10}},{id:`${u.id}:${stat}`,seed:stat});if(m.kind!=='item')throw Error('gear');u.gear=[gearItem(`${u.id}:${stat}`,stat,m.value)];}
function fixed(){let n=0;return {seed:'mean',next:()=>.5,d:(s:number)=>s===20?18:s===6?3+n++%2:Math.ceil((s+1)/2)};}
function attack(a:Combatant,d:Combatant,ability?:Ability):Omit<AttackOpts,'rng'>{a.pos=31;d.pos=24;const e=ability?.effects.find(e=>e.op==='damage');return {attacker:a,defender:d,rules:V39_OVERFLOW_D20,distance:1,conditionDefs,traitRegistry:registry,...(ability&&e?.op==='damage'?skillAttack({mode:'small',units:[a,d],battlefield:field,fieldTags:[]},a,d,ability,e,V39_OVERFLOW_D20):{})};}
function dist(expr:string,times:number,coefficient:number,hp:number) {let mean=0,kill=0,loss=0;for(const [dice,p] of diceDistribution(expr,times)!){const raw=Math.max(0,dice*coefficient),lo=Math.floor(raw),f=raw-lo;mean+=p*raw;loss+=p*(Math.min(hp,lo)*(1-f)+Math.min(hp,lo+1)*f);kill+=p*((lo>=hp?1:0)*(1-f)+(lo+1>=hp?1:0)*f);}return {mean,kill,loss};}
const policies=['current','additive','crit150','defenseResilience','additive+crit150','additive+defense','combined','life125','additive+crit150+life125','combined+life125'] as const;
function measurements(a:Combatant,d:Combatant,ability?:Ability) {
  const opts=attack(a,d,ability),p=previewAttack(opts),r=resolveAttack({...opts,attacker:structuredClone(a),defender:structuredClone(d),autoHit:true,rng:fixed()}),channel=r.channel??'kinetic';
  const factors=[equipmentMultiplier(a.weapon?.recipe,'damage',channel),ability?bonusMultiplier(ability.bonuses,'damage',channel):1,unitMultiplier(a,'damage',channel),wornDamageMultiplier(a,channel)];
  const positive=1+factors.reduce((s,m)=>s+Math.max(0,m-1),0),negative=factors.reduce((s,m)=>s*Math.min(1,m),1),ratio=positive*negative/factors.reduce((s,m)=>s*m,1);
  const defensePoints=(d.bonuses?.defense??0)+(d.weapon?.recipe?.bonuses?.defense??0)+(d.armor?.recipe?.bonuses?.defense??0)+(d.shield?.recipe?.bonuses?.defense??0)+(wornEffects(d).defense??0)/ratingPerPoint(d.level);
  const coefficient=r.dmgMult*r.wardMult*(r.penetrationFactor??1);
  return policies.map(policy=>{
    const additive=['additive','additive+crit150','additive+defense','combined','additive+crit150+life125','combined+life125'].includes(policy),resilience=['defenseResilience','additive+defense','combined','combined+life125'].includes(policy),crit=['crit150','additive+crit150','combined','additive+crit150+life125','combined+life125'].includes(policy);
    const scale=(additive?ratio:1)*(resilience?1/(1+.025*Math.max(0,defensePoints)):1),hp=policy.includes('life125')?Math.round(d.hp*1.25):d.hp;
    const normal=dist(r.baseRoll!.expr,1,coefficient*scale,hp),critical=dist(r.baseRoll!.expr,2,coefficient*scale*(crit?.75:1),hp),critChance=p.critChance??0;
    return {policy,hp,normalMean:normal.mean,normalKill:normal.kill,criticalMean:critical.mean,criticalKill:critical.kill,killPerAction:(p.hitChance-critChance)*normal.kill+critChance*critical.kill,expectedLoss:(p.hitChance-critChance)*normal.loss+critChance*critical.loss,hit:p.hitChance,through:r.penetrationFactor,penetration:r.penetration,resistance:r.resistance,mergeRatio:ratio};
  });
}
const profiles={
  plain:{},off12def7:{offense:true,defense:true},off22def7:{offense:true,defense:true,damageGear:true},equal12:{offense:true,defense:true,health:5},equal22:{offense:true,defense:true,damageGear:true,health:5,healthGear:true},
  equal40:{maximum:true,defenseMaximum:true,health:10,healthGear:true},
} as const;
const rows:Record<string,unknown>[]=[],examples:Record<string,unknown>[]=[];
for(let L=1;L<=10;L++)for(const weapon of ['sword','greatsword','axe','blunt','spear','heavy-polearm'])for(const tier of [1,2,3,4] as const)for(const enchant of ['none','arcane'] as const)for(const [profile,flags] of Object.entries(profiles)) {
  const f=flags as {offense?:boolean;defense?:boolean;damageGear?:boolean;health?:number;healthGear?:boolean;maximum?:boolean;defenseMaximum?:boolean};
  const a=make({level:L,weaponClass:weapon,weaponLevel:L,armorLevel:L,...(enchant==='arcane'?{weaponEnchantment:'arcane'}:{}),
    weaponBonuses:f.maximum?{damage:10,penetration:10}:f.offense?{damage:4,penetration:3}:undefined,
    abilityBlueprints:[{id:skillDefinitionId('物理单体近战')!,level:Math.max(1,L-1),bonuses:f.maximum?{damage:10,penetration:10}:f.offense?{damage:3,penetration:2}:undefined}]},'ally');
  const d=make({level:L,weaponClass:'sword',weaponLevel:L,armorLevel:L,armorTier:tier,armorBonuses:f.defenseMaximum?{defense:10,protection:10}:f.defense?{defense:4,kineticProtection:3}:undefined,bonuses:f.health?{health:f.health}:undefined},'enemy');
  if(f.damageGear)gear(a,L,'damage');if(f.healthGear)gear(d,L,'health');new SmallBattle({combatants:[a,d],rules:V39_OVERFLOW_D20,seed:'audit',traitRegistry:registry});
  const measured=measurements(a,d,a.abilities[0]);for(const m of measured)rows.push({level:L,weapon,tier,enchant,profile,...m});
  if(L===4&&weapon==='greatsword'&&tier===2)for(const m of measured)examples.push({profile,enchant,...m});
}
const cross=[];
for(const armorLevel of [4,5,6])for(let p=0;p<=10;p++){
  const a=make({weaponBonuses:{penetration:p}},'ally'),d=make({weaponClass:'sword',armorLevel},'enemy');new SmallBattle({combatants:[a,d],rules:V39_OVERFLOW_D20,seed:'cross',traitRegistry:registry});
  cross.push({armorLevel,points:p,...measurements(a,d)[0]});
}
const progression=[],flat=[];
for(const category of SKILL_CATEGORIES)for(const modifier of allowedSkillModifiers(category.id))for(const area of [false,true]){
  let previous='';for(let L=1;L<=10;L++){
    const id=skillMechanismId({category:category.id,modifiers:[modifier.id],area}),u=generateUnit({...base,name:'skill',side:'ally',traits:[],abilityBlueprints:[{id,level:L}]},{seed:'skill',noVariance:true,registry,skillModel:V40_OVERFLOW_D20.skillModel}).unit;
    new SmallBattle({combatants:[u],rules:V40_OVERFLOW_D20,seed:'skill',traitRegistry:registry});const a=u.abilities[0]!,signature=JSON.stringify({effects:a.effects,range:a.range,area:a.area,cost:abilityCost(u,a),cooldown:a.cooldown,scale:a.damageScale,weaponDamageMult:a.weaponDamageMult});
    if(signature===previous)flat.push({category:category.id,modifier:modifier.id,area,from:L-1,to:L});previous=signature;progression.push({category:category.id,modifier:modifier.id,area,L});
  }
}
const summary=policies.flatMap(policy=>Object.keys(profiles).map(profile=>{const rs=rows.filter(r=>r.policy===policy&&r.profile===profile);return {policy,profile,n:rs.length,meanKill:rs.reduce((n,r)=>n+Number(r.killPerAction),0)/rs.length,over5pct:rs.filter(r=>Number(r.killPerAction)>.05+1e-10).length,normalOver5pct:rs.filter(r=>Number(r.normalKill)>.05+1e-10).length,meanLoss:rs.reduce((n,r)=>n+Number(r.expectedLoss)/Number(r.hp),0)/rs.length};}));
csv('matrix',rows);save('results',{head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),basis:'V39 single-packet exact finite distributions; no traits, fatigue, shielding, or additional channels. Candidate policies do not change penetration or overmatch. Profiles equal12/22/40 equal positive point counts, not an economic price system. Crit150 scales doubled critical dice damage by .75. Resilience =1/(1+.025*positive defense modifier points).',rows:rows.length,examples,cross,summary,progressionChecks:progression.length,remainingFlat:flat});
console.log(JSON.stringify({rows:rows.length,progressionChecks:progression.length,remainingFlat:flat,examples:examples.filter(r=>r.profile==='off22def7'&&r.enchant==='arcane'),summary:summary.filter(r=>['off22def7','equal22','equal40'].includes(r.profile))},null,2));
