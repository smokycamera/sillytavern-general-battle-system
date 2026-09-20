import {writeFileSync,mkdirSync} from 'node:fs';
import { generateUnit, SmallBattle, MassBattle, generatedField, previewAttack, V2_D20, V2_TW, V3_D20, V3_TW, traitRegistry, standardConditionMap, type GenerateInput, type Combatant } from '../engine/src/index.js';
import {prepareCombatModel} from '../engine/src/combat-model.js';
import {upgradeCombatSkills} from '../engine/src/skill-upgrade.js';
import { skillDefinitionId } from '../engine/src/skill-catalog.js';
import { skillAttack } from '../engine/src/skill-attack.js';
import { prepareMassRoster } from '../panel/src/battle-setup.js';
const reg=traitRegistry(), conditions=standardConditionMap();
const after=process.argv.includes('--after'), smallRules=after?V3_D20:V2_D20,massRules=after?V3_TW:V2_TW;
const output=process.argv.find(a=>a.startsWith('--output='))?.slice(9)??`engine/sim/out/combat-upgrade-${after?'after':'before'}.json`;
const make=(id:string,side:'ally'|'enemy',extra:Partial<GenerateInput>={})=>{
  const u=generateUnit({rulesVersion:'v2',name:id,side,scale:'hero',level:5,quality:3,weaponClass:'rifle',weaponLevel:5,armorTier:1,armorLevel:5,traits:[],...extra},{seed:id,registry:reg,noVariance:true}).unit;u.id=id;if(after){prepareCombatModel(u,smallRules);upgradeCombatSkills(u);}return u;
};
const exact:object[]=[];
for(const size of [1,50,500,2000]) for(const mode of ['small','mass'] as const){
 const a=make('A','ally',{scale:size===1?'hero':'company',...(size===1?{}:{hpMax:size})}),d=make('D','enemy',{scale:size===1?'hero':'company',...(size===1?{}:{hpMax:size})});a.pos=42;d.pos=21;
 const rules=mode==='small'?smallRules:massRules, context={units:[a,d],mode,fieldTags:['plains']};
 const weapon=previewAttack({attacker:a,defender:d,rules,ranged:true,distance:3,traitRegistry:reg,conditionDefs:conditions});
 const skills=[];
 for(const text of ['物理单体射击','物理范围射击','魔法单体','魔法范围','魔法范围热能+减速']){
  const id=skillDefinitionId(text)!;const caster=make('A','ally',{scale:a.scale,hpMax:a.base.hpMax,abilityBlueprints:[{id,level:5}]});caster.pos=a.pos;const ability=caster.abilities[0]!,effect=ability.effects.find(e=>e.op==='damage')!;
  if(effect.op!=='damage')continue;
  const p=previewAttack({attacker:caster,defender:d,rules,traitRegistry:reg,conditionDefs:conditions,distance:3,...skillAttack({...context,units:[caster,d]},caster,d,ability,effect)});
  skills.push({skill:text,expected:+p.expectedDamage.toFixed(3),ratio:+(p.expectedDamage/weapon.expectedDamage).toFixed(3),sp:ability.cost?.amount,cooldown:ability.cooldown});
 }
 exact.push({mode,size,weapon:+weapon.expectedDamage.toFixed(3),skills});
}
const cases=[
 {id:'mass-50',mode:'mass',a:{scale:'company',hpMax:50},b:{scale:'company',hpMax:50}},
 {id:'mass-500',mode:'mass',a:{scale:'company',hpMax:500},b:{scale:'company',hpMax:500}},
 {id:'mass-2000',mode:'mass',a:{scale:'company',hpMax:2000},b:{scale:'company',hpMax:2000}},
 {id:'hero-normal',mode:'small',a:{},b:{}},
 {id:'hero-hp500',mode:'small',a:{hpMax:500},b:{hpMax:500}},
 {id:'mage-rifle',mode:'small',a:{weaponClass:'magic',abilityBlueprints:['bp-arcane-bolt','bp-mending']},b:{}},
] as {id:string;mode:string;a:Partial<GenerateInput>;b:Partial<GenerateInput>}[];
const matches:object[]=[],anomalies:string[]=[];
for(const c of cases)for(const swap of [false,true]){
 const a=make('A',swap?'enemy':'ally',c.a),d=make('D',swap?'ally':'enemy',c.b);const units=c.mode==='mass'?prepareMassRoster([a,d]):[a,d];
 const b=c.mode==='mass'?new MassBattle({combatants:units,rules:massRules,seed:'tempo-audit',traitRegistry:reg}):new SmallBattle({combatants:units,rules:smallRules,seed:'tempo-audit',traitRegistry:reg,battlefield:generatedField('tempo-layout',7,13,['plains'])});b.start();
 let steps=0;while(!b.isOver()&&b.round<=20&&steps++<160){if(b instanceof SmallBattle)b.autoAction(b.active!.id);else{b.autoOrders('ally');b.autoOrders('enemy');b.resolveRound();}}
 for(const u of b.combatants)if(!Number.isFinite(u.hp)||u.hp<0||u.hp>u.base.hpMax)anomalies.push(c.id+': invalid hp');
 const result={id:c.id,swap,over:b.isOver(),rounds:b instanceof MassBattle?b.roundReport()?.round??b.round:b.round,winner:b.isOver()?b.winner():null,shots:b.log.filter(e=>e.resolution).length,skills:b.log.filter(e=>e.kind==='ability').length,end:b.combatants.map(u=>({id:u.id,hp:u.hp,max:u.base.hpMax,status:u.status,fatigue:u.fatigue}))};matches.push(result);console.log(JSON.stringify(result));
}
mkdirSync('engine/sim/out',{recursive:true});writeFileSync(output,JSON.stringify({method:'T5/P5/Q3, frozen seed pair, 20-round bounded observation; not a win rate study',exact,matches,anomalies},null,2));console.log(JSON.stringify({output,exactRows:exact.length,matches:matches.length,anomalies}));
