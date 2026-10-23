import { describe, expect, it } from 'vitest';
import { generateUnit, prepareCombatModel, prepareArmsModel, previewAttack, standardConditionMap, traitRegistry,
  V29_OVERFLOW_D20, V30_OVERFLOW_D20, V30_OVERFLOW_TW, SmallBattle, MassBattle, standardField, targetWidthLimit,
  type Combatant, type GenerateInput, type RulePack, type Ability } from '../src/index.js';
import { engagementWidth, sharedParticipants } from '../src/exposure.js';
import { skillAttack } from '../src/skill-attack.js';
const registry=traitRegistry(),conditionDefs=standardConditionMap();
function unit(patch:Partial<GenerateInput>={},rules:RulePack=V30_OVERFLOW_D20):Combatant {
  const u=generateUnit({name:'a',side:'ally',scale:'company',hpMax:100,hp:100,rulesVersion:'v2',damageModel:'wounds-v2',numericModel:'graded-v1',loadModel:'capacity-v2',
    level:5,weaponClass:'sword',armorTier:0,traits:[],...patch},{seed:patch.name??'a',registry,noVariance:true}).unit;
  u.id=patch.name??'a';prepareCombatModel(u,rules);prepareArmsModel(u,rules);return u;
}
const preview=(a:Combatant,d:Combatant,ranged:boolean,rules=V30_OVERFLOW_D20,participants?:number)=>previewAttack({attacker:a,defender:d,rules,conditionDefs,traitRegistry:registry,ranged,distance:ranged?3:1,...(participants===undefined?{}:{participants})});

describe('V30 target-limited weapon participants',()=>{
  it.each([[false,6],[true,12]] as const)('ranged=%s caps human hero and one-person formation equally in standalone and shared previews', (ranged,cap)=>{
    for(const scale of ['hero','company'] as const){
      const a=unit({weaponClass:ranged?'rifle':'sword'}),d=unit({name:'d',side:'enemy',scale,hpMax:scale==='hero'?100:1,hp:scale==='hero'?100:1});
      const shared=sharedParticipants(a,[a],engagementWidth(a,d,ranged),d,ranged);
      expect(shared).toBe(cap);expect(preview(a,d,ranged, V30_OVERFLOW_D20,shared).participants).toBe(cap);
      expect(preview(a,d,ranged).participants).toBe(cap);
      expect(preview(a,d,ranged,V30_OVERFLOW_D20,100).participants).toBe(cap);
    }
  });
  it('scales by target bodies, ignores hero HP, grows with target headcount and retains full formation fights',()=>{
    for(const [body,melee,ranged] of [['human',6,12],['large',10,18],['giant',16,28],['vehicle',16,32]] as const){
      const hero=unit({name:'d',side:'enemy',scale:'hero',body,hpMax:1000,hp:1000});
      expect(targetWidthLimit(hero,false)).toBe(melee);expect(targetWidthLimit(hero,true)).toBe(ranged);
    }
    const a=unit(),d=unit({name:'d',side:'enemy'});
    expect(sharedParticipants(a,[a],16,d,false)).toBe(32);
    expect(sharedParticipants(a,[a],20,d,true)).toBe(40);
    d.hp=d.formation!.members=4;expect(targetWidthLimit(d,false)).toBe(12);expect(targetWidthLimit(d,true)).toBe(48);
    d.hp=d.formation!.members=1;d.mount=true;expect(targetWidthLimit(d,false)).toBe(10);
  });
  it('same-position formations share one target budget; small attackers never gain phantom members',()=>{
    const a=unit(),b=unit({name:'b',hpMax:50,hp:50}),d=unit({name:'d',side:'enemy',hpMax:1,hp:1});
    const participants=[a,b].map(u=>sharedParticipants(u,[a,b],16,d,false));
    expect(participants).toEqual([4,2]);expect(participants.reduce((x,y)=>x+y)).toBe(6);
    b.hp=b.formation!.members=1;expect(sharedParticipants(b,[b],16,d,false)).toBe(1);
  });
  it('weapon skills obey the same cap while pure spells and paid independent items keep their participant rules',()=>{
    const a=unit(),d=unit({name:'d',side:'enemy',hpMax:1,hp:1});a.pos=31;d.pos=24;
    const skill:Ability={id:'skill',name:'剑技',target:'enemy',delivery:'melee',damageBasis:'weapon',power:5,effects:[{op:'damage',baseDice:'1d6'}]};
    const context={units:[a,d],mode:'small' as const,fieldTags:[],battlefield:standardField()};
    const attack=skillAttack(context,a,d,skill,{baseDice:'1d6'},V30_OVERFLOW_D20);
    expect(attack.participants).toBe(6);
    const spell={...skill,id:'spell',damageBasis:undefined,delivery:'magic' as const,itemDoses:undefined};
    const old=skillAttack(context,a,d,spell,{baseDice:'1d6'},V29_OVERFLOW_D20);
    const modern=skillAttack(context,a,d,spell,{baseDice:'1d6'},V30_OVERFLOW_D20);
    expect(modern.participants).toBe(old.participants);
    expect(previewAttack({attacker:a,defender:d,rules:V30_OVERFLOW_D20,conditionDefs,...modern}).participants).toBe(40);
    const item={...spell,itemDoses:20};expect(skillAttack(context,a,d,item,{baseDice:'1d6'},V30_OVERFLOW_D20).participants).toBe(20);
  });
  it.each(['small','mass'] as const)('%s actual weapon resolution uses the target cap',mode=>{
    const a=unit({weaponClass:'rifle'}),d=unit({name:'d',side:'enemy',hpMax:1,hp:1});
    if(mode==='small'){
      const field=standardField();field.tiles.fill('open');
      const b=new SmallBattle({combatants:[a,d],rules:V30_OVERFLOW_D20,battlefield:field,seed:'target-small'});b.start();
      b.turnOrder=['a','d'];b.turnIndex=0;a.pos=31;d.pos=10;
      expect(b.attack('a','d').participants).toBe(12);
    }else{
      const b=new MassBattle({combatants:[a,d],rules:V30_OVERFLOW_TW,seed:'target-mass'});b.start();
      const p=b.orderPreview({unitId:'a',type:'volley',targetId:'d'});expect(p.reason).toBeUndefined();expect(p.preview?.participants).toBe(12);
    }
  });
  it('V29 keeps former hero and one-person formation results',()=>{
    const a=unit({},V29_OVERFLOW_D20);
    for(const [scale,count] of [['hero',16],['company',32]] as const){
      const d=unit({name:'d',side:'enemy',scale,hpMax:scale==='hero'?100:1,hp:scale==='hero'?100:1},V29_OVERFLOW_D20);
      expect(preview(a,d,false,V29_OVERFLOW_D20,sharedParticipants(a,[a],16,d,false)).participants).toBe(count);
    }
  });
});
