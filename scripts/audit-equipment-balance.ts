import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { generateUnit, traitRegistry, standardConditionMap, prepareCombatModel, previewAttack,
  V4_D20, V4_TW, V4_OVERFLOW_D20, V4_OVERFLOW_TW, weaponReloadTurns } from '../engine/src/index.js';
import { WEAPON_CLASSES } from '../engine/src/data/weapons.js';
import { compileArmor } from '../engine/src/gen/equipment.js';
import { compileSkill } from '../engine/src/skill-catalog.js';
import { upgradeCombatSkills } from '../engine/src/skill-upgrade.js';
import { conditionChance } from '../engine/src/skill-effects.js';
import { anchoredProtection, armorPowerScale } from '../engine/src/power-anchors.js';
import { skillAttack } from '../engine/src/skill-attack.js';
import { skillResourceChange } from '../engine/src/skill-runtime.js';
import { compileItem, CONSUMABLE_NAMES, ACCESSORY_NAMES, type ConsumableKind, type AccessoryKind } from '../engine/src/items.js';
import type { Combatant, RulePack, Scale } from '../engine/src/types.js';

const registry = traitRegistry(), conditionDefs = standardConditionMap();
const make = (side: 'ally'|'enemy', scale: Scale, power: number, weapon = 'sword') => generateUnit({
  name: side, side, scale, rulesVersion: 'v2', level: 5, weaponClass: weapon, weaponLevel: power,
  armorTier: 0, armorLevel: power, hpMax: scale === 'hero' ? 42 : 100, traits: [],
}, {registry, seed: 'balance:' + side, noVariance: true}).unit;
function attack(a: Combatant, d: Combatant, rules: RulePack, distance: number) {
  return previewAttack({attacker:a,defender:d,rules,distance,ranged:a.weapon?.tags?.includes('ranged'),conditionDefs,traitRegistry:registry});
}
const weapons: object[] = [], armor: object[] = [], skills: object[] = [];
for (const rules of [V4_D20,V4_TW,V4_OVERFLOW_D20,V4_OVERFLOW_TW]) for (const scale of ['hero','company'] as const)
for (let power=1;power<=10;power++) for (const tier of [0,1,2,3,4] as const) for (const mechanism of Object.keys(WEAPON_CLASSES)) {
  // 人形个体不能合法携带火炮/机炮；该限制本身是重武器代价。
  if (scale==='hero' && ['cannon','indirect-cannon','autocannon'].includes(mechanism)) continue;
  const a=make('ally',scale,power,mechanism), d=make('enemy',scale,power);
  d.armor=compileArmor({tier,power},{id:'armor',seed:'armor',noVariance:true}); delete d.weapon;
  prepareCombatModel(a,rules);prepareCombatModel(d,rules);
  const distance=mechanism==='spear'||a.weapon?.tags?.includes('ranged')?2:1, p=attack(a,d,rules,distance);
  if(!Number.isFinite(p.expectedDamage)||p.expectedDamage<0)throw Error('Non-finite damage');
  weapons.push({mode:rules.id,scale,power,tier,mechanism,distance,hit:p.hitChance,damage:p.expectedDamage,
    sustained:p.expectedDamage/(1+weaponReloadTurns(a.weapon)),penetration:p.penetration,factor:p.penetrationFactor,exact:p.exact});
}
for(let power=1;power<=10;power++)for(const tier of [0,1,2,3,4] as const)for(const profile of ['balanced','kinetic','thermal','arcane'] as const){
  const d=make('enemy','hero',power);d.armor=compileArmor({tier,power,profile},{id:'armor',seed:'armor',noVariance:true});
  armor.push({power,tier,profile,load:d.armor.load,scale:armorPowerScale(d),...Object.fromEntries(['kinetic','thermal','arcane'].map(c=>[c,anchoredProtection(d,c as 'kinetic')]))});
}
const definitions=['generic:debuff:stun','generic:debuff:root','generic:debuff:silence','generic:debuff:disarm',
  'generic:debuff:slow','generic:debuff:stun+root','generic:magic-single','generic:magic-single:stun',
  'generic:physical-single','generic:physical-single:shield','generic:buff:heal','generic:buff:heal+barrier',
  'generic:buff:heal+restore','generic:buff:barrier','generic:buff:restore'];
for(const rules of [V4_D20,V4_TW])for(let power=1;power<=10;power++)for(const id of definitions){
  const a=make('ally','hero',power),d=make('enemy','hero',power);
  a.shield={id:'shield',load:2,recipe:{version:'mechanism-v2.3',mechanism:'shield',power,quality:3,size:'human',seed:'shield'}};
  d.armor=compileArmor({tier:3,power},{id:'armor',seed:'armor',noVariance:true});
  a.abilities=[compileSkill(id,power,a.id)];prepareCombatModel(a,rules);prepareCombatModel(d,rules);upgradeCombatSkills(a);
  const ability=a.abilities[0]!,effect=ability.effects.find(e=>e.op==='damage');
  const damage=effect?.op==='damage'?previewAttack({attacker:a,defender:d,rules,distance:1,conditionDefs,traitRegistry:registry,
    ...skillAttack({mode:'small',units:[a,d],fieldTags:[]},a,d,ability,effect,rules)}).expectedDamage:undefined;
  const resource=ability.effects.find(e=>e.op==='resource');
  skills.push({mode:rules.id,power,id,cost:ability.cost?.amount,cooldown:ability.cooldown,damage,effects:ability.effects,
    control:ability.effects.filter(e=>e.op==='condition').map(e=>({id:e.conditionId,chance:conditionChance(d,e)})),
    selfResourceNet:resource?.op==='resource'?skillResourceChange({...a,resources:{...a.resources,SP:a.resources.SP!-ability.cost!.amount}},resource)-ability.cost!.amount:undefined});
}
const output=process.argv.find(a=>a.startsWith('--output='))?.slice(9)??'engine/sim/out/equipment-balance.json';
const items=[];
for(let power=1;power<=10;power++) {
  for(const mechanism of Object.keys(CONSUMABLE_NAMES) as ConsumableKind[])items.push({kind:'consumable',mechanism,power,mechanics:compileItem({kind:'consumable',mechanism,power},{id:mechanism,seed:'balance'})});
  for(const mechanism of Object.keys(ACCESSORY_NAMES) as AccessoryKind[])items.push({kind:'accessory',mechanism,power,mechanics:compileItem({kind:'accessory',mechanism,power},{id:mechanism,seed:'balance'})});
}
mkdirSync(output.slice(0,output.lastIndexOf('/')),{recursive:true});
writeFileSync(output,JSON.stringify({commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
  method:'T5, deterministic generated equipment, P1–10; 4 V4 rule packs incl. overflow, hero/company(100), 5 armor tiers. Fixed firing positions, no movement/cover/skills. Per-action analytical previews; multi-hit/cohort results are approximations, NOT match win rates. sustained=damage/(reload+1), no sidearm during reload. Armor 4 profiles. Skill T5 human target, heavy armor, actual V4 upgrade.',
  counts:{weapons:weapons.length,armor:armor.length,skills:skills.length,items:items.length},weapons,armor,skills,items},null,2)+'\n');
console.log(JSON.stringify({output,counts:{weapons:weapons.length,armor:armor.length,skills:skills.length,items:items.length}}));
