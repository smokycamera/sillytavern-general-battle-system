/** Actual attack and complete battle comparison. Uses public fixture names and no external saves. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { generateUnit, compileItem, gearItem, skillDefinitionId, skillAttack, SmallBattle, MassBattle, standardField,
  traitRegistry, standardConditionMap, V40_OVERFLOW_D20, V40_OVERFLOW_TW, V41_OVERFLOW_D20, V41_OVERFLOW_TW,
  resolveAttack, previewAttack, SeededRng, type GenerateInput, type Combatant, type RulePack } from '../engine/src/index.js';
const out='artifacts/v41-balance-20261028';mkdirSync(out,{recursive:true});
const registry=traitRegistry(),conditionDefs=standardConditionMap();
const field=standardField();field.tiles.fill('open');
function unit(id:string,side:'ally'|'enemy',L=4,patch:Partial<GenerateInput>={}):Combatant{
  const u=generateUnit({name:id,side,scale:'hero',level:L,weaponClass:'greatsword',weaponLevel:L,armorTier:2,armorLevel:L,
    body:'human',rulesVersion:'v2',damageModel:'wounds-v2',numericModel:'graded-v1',loadModel:'capacity-v2',traits:[],...patch},
    {seed:id,noVariance:true,registry,skillModel:'skills-v5'}).unit;
  u.id=id;delete u.pos;return u;
}
function gear(u:Combatant,stat:'damage'|'health'|'barrier',L:number){
  const id=u.id+':'+stat,m=compileItem({kind:'item',form:'worn',power:L,...(stat==='barrier'?{barrierPower:L}:{bonuses:{[stat]:10}})},{id,seed:id});
  if(m.kind!=='item')throw Error('fixture');(u.gear??=[]).push(gearItem(id,id,m.value));
}
const risk=[];
for(const equal of [false,true])for(const policy of ['V40','A+B','A+B+barrier']){
  const rules=policy==='V40'?V40_OVERFLOW_D20:V41_OVERFLOW_D20;
  const a=unit('attacker','ally',4,{weaponEnchantment:'arcane',weaponBonuses:{damage:4,penetration:3},
    abilityBlueprints:[{id:skillDefinitionId('物理单体近战')!,level:3,bonuses:{damage:3,penetration:2}}]});gear(a,'damage',4);
  const d=unit('defender','enemy',4,{armorBonuses:{defense:4,kineticProtection:3},...(equal?{bonuses:{health:5}}:{})});
  if(equal)gear(d,'health',4);if(policy.includes('barrier'))gear(d,'barrier',4);
  const battle=new SmallBattle({combatants:[a,d],rules,battlefield:structuredClone(field),seed:'risk',traitRegistry:registry});battle.start();a.pos=31;d.pos=24;
  const ability=a.abilities[0]!,effect=ability.effects.find(e=>e.op==='damage');if(effect?.op!=='damage')throw Error('damage');
  const opts={attacker:a,defender:d,rules,conditionDefs,traitRegistry:registry,distance:1,...skillAttack({mode:'small',units:[a,d],battlefield:field,fieldTags:[]},a,d,ability,effect,rules)};
  const rng=new SeededRng('v41-independent-risk'),n=10000;let kills=0,sum=0;
  for(let i=0;i<n;i++){const target=structuredClone(d);const r=resolveAttack({...opts,defender:target,rng});kills+=Number(target.hp===0);sum+=r.finalDamage;}
  const row={equal,policy,n,hp:d.hp,barrier:d.barrier?.remaining??0,killPerAction:kills/n,meanLoss:sum/n,preview:previewAttack(opts).expectedDamage};risk.push(row);console.log(JSON.stringify({phase:'risk',...row}));
}
const cases=[
  {name:'damage-versus-life',a:{weaponClass:'greatsword',weaponBonuses:{damage:4,penetration:3}},b:{weaponClass:'sword',armorBonuses:{defense:4,kineticProtection:3},bonuses:{health:5}}},
  {name:'recovery-versus-offense',a:{weaponClass:'sword',traits:['guardian','regen']},b:{weaponClass:'greatsword',traits:['berserk','melee-master']}},
  {name:'rifle-versus-heavy-rifle',a:{weaponClass:'rifle',weaponBonuses:{damage:4,accuracy:3}},b:{weaponClass:'heavy-rifle',armorBonuses:{defense:4,kineticProtection:3}}},
];
const duels:Record<string,unknown>[]=[],massRows:Record<string,unknown>[]=[];
for(const L of [4,8])for(const c of cases)for(const modern of [false,true])for(let seed=0;seed<2;seed++)for(const swap of [false,true]){
  const make=(patch:Partial<GenerateInput>,id:string,side:'ally'|'enemy')=>unit(id,side,L,{...patch,traitLevels:Object.fromEntries((patch.traits??[]).map(t=>[t,L]))});
  const a=make(c.a,'a',swap?'enemy':'ally'),d=make(c.b,'d',swap?'ally':'enemy');
  if(c.name==='damage-versus-life'){gear(a,'damage',L);gear(d,'health',L);}
  if(modern){gear(a,'barrier',L);gear(d,'barrier',L);}
  const rules=modern?V41_OVERFLOW_D20:V40_OVERFLOW_D20;
  const b=new SmallBattle({combatants:swap?[d,a]:[a,d],rules,battlefield:structuredClone(field),seed:`duel:${L}:${seed}`,traitRegistry:registry});b.start();
  a.pos=a.weapon?.tags?.includes('ranged')?38:31;d.pos=24;let steps=0;
  while(!b.isOver()&&b.round<=30&&steps<120){const active=b.active;if(!active)break;b.autoAction(active.id);steps++;}
  duels.push({name:c.name,L,modern,seed,swap,round:b.round,steps,winner:b.winner()??null,aHp:a.hp,dHp:d.hp,timeout:!b.isOver(),aBarrier:a.barrier?.remaining??0,dBarrier:d.barrier?.remaining??0});
}
for(const L of [4,8])for(const c of [cases[1]!,cases[2]!])for(const modern of [false,true])for(let seed=0;seed<2;seed++){
  const make=(patch:Partial<GenerateInput>,id:string,side:'ally'|'enemy')=>unit(id,side,L,{...patch,scale:'company',hpMax:20,hp:20,traitLevels:Object.fromEntries((patch.traits??[]).map(t=>[t,L]))});
  const a=make(c.a,'a','ally'),d=make(c.b,'d','enemy');if(modern){gear(a,'barrier',L);gear(d,'barrier',L);}
  const b=new MassBattle({combatants:[a,d],rules:modern?V41_OVERFLOW_TW:V40_OVERFLOW_TW,seed:`mass:${L}:${seed}`,traitRegistry:registry});b.start();
  while(!b.isOver()&&b.round<=30){b.autoOrders('ally');b.autoOrders('enemy');b.resolveRound();}
  massRows.push({name:c.name,L,modern,seed,round:b.round,winner:b.winner()??null,aMembers:a.hp,dMembers:d.hp,timeout:!b.isOver()});
}
const summary=(rows:Record<string,unknown>[])=>[false,true].map(modern=>{const x=rows.filter(r=>r.modern===modern);return {modern,n:x.length,meanRounds:x.reduce((s,r)=>s+Number(r.round),0)/x.length,timeouts:x.filter(r=>r.timeout).length};});
const result={risk,small:{summary:summary(duels),rows:duels},mass:{summary:summary(massRows),rows:massRows},scope:'60,000 independent single-action samples; 48 small and 16 mass battles. New arm includes entry barriers on both combatants. Two seeds and mirrored sides in small battles; no population win-rate claim.'};
writeFileSync(out+'/results.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({phase:'complete',small:result.small.summary,mass:result.mass.summary}));
