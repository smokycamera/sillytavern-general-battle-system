import { describe, expect, it } from 'vitest';
import { generateUnit, prepareCombatModel, upgradeCombatSkills, traitRegistry, standardConditionMap, skillDefinitionId,
  skillAttack, resolveAttack, previewAttack, SmallBattle, MassBattle, standardField, SeededRng,
  V7_OVERFLOW_D20, V7_OVERFLOW_TW, V8_OVERFLOW_D20, V8_OVERFLOW_TW, type Combatant, type GenerateInput, type RulePack } from '../src/index.js';
import { trainingDamage } from '../src/enhancements.js';
import { compileWeapon } from '../src/gen/equipment.js';

const registry=traitRegistry(),conditionDefs=standardConditionMap();
function unit(id:string,extra:Partial<GenerateInput>={}):Combatant {
  const u=generateUnit({name:id,side:id==='a'?'ally':'enemy',scale:'hero',level:7,archetype:'infantry',rulesVersion:'v2',damageModel:'wounds-v2',
    weaponClass:'sword',weaponLevel:7,armorTier:1,armorLevel:5,traits:[],...extra},{seed:id,registry,noVariance:true}).unit;
  u.id=id;u.pos=id==='a'?0:1;prepareCombatModel(u,V8_OVERFLOW_D20);upgradeCombatSkills(u);return u;
}
function options(a:Combatant,d:Combatant,rules:RulePack,skillIndex?:number) {
  const ability=skillIndex===undefined?undefined:a.abilities[skillIndex]!,effect=ability?.effects.find(e=>e.op==='damage');
  const skill=ability&&effect?.op==='damage'?skillAttack({mode:'small',units:[a,d],fieldTags:[]},a,d,ability,effect,rules):{};
  return {attacker:a,defender:d,rules,conditionDefs,traitRegistry:registry,distance:1,ranged:false,...skill};
}
const reportedRng=()=>{const dice=[18,3,3,3,4,3,1,5,2];return {seed:'reported',next:()=>.5,d:()=>dice.shift()??1};};
describe('V8 bounded training and single weapon bursts',()=>{
  it('reproduces the reported 7.431 multiplier under V7 and leaves Sasuke alive under V8',()=>{
    const blueprints=[{id:skillDefinitionId('物理单体近战')!,level:7,bonuses:{accuracy:8}}];
    const a=unit('a',{weaponBonuses:{accuracy:5,damage:4},traits:['fast','melee-master','versatile'],
      abilityBlueprints:blueprints});
    for(let i=0;i<100;i++) {
      const weapon=compileWeapon({mechanism:'sword',power:7,bonuses:{accuracy:5,damage:4}},{id:'sword',seed:'audit:'+i,damageModel:'wounds-v2',variance:false});
      if(weapon.baseDice==='5d6+1'){a.weapon=weapon;break;}
    }
    const d=unit('d',{level:8,weaponLevel:8,armorBonuses:{defense:3},traits:['fast','elite','melee-master']});
    const old=resolveAttack({...options(a,structuredClone(d),V7_OVERFLOW_D20,0),rng:reportedRng()});
    const next=resolveAttack({...options(a,structuredClone(d),V8_OVERFLOW_D20,0),rng:reportedRng()});
    expect(old.dmgMult).toBeCloseTo(7.431193846,8);expect(old.damagePlans![0]!.incomingDirect).toBe(178);expect(old.finalDamage).toBe(144);
    expect(next.finalDamage).toBe(96);expect(next.hpAfter).toBe(48);expect(next.overmatchMultiplier).toBe(1);
    expect([next.netAtk,next.targetDef,next.penetration,next.resistance]).toEqual([old.netAtk,old.targetDef,old.penetration,old.resistance]);
  });
  it('low/mid/high levels retain hit and protection; only declared damage factors change in preview and execution',()=>{
    for(const level of [1,3,5,7,10])for(const body of ['human','large','vehicle','giant'] as const)for(const tier of [0,2,3] as const) {
      const a=unit('a',{level,body,weaponLevel:level,abilityBlueprints:[{id:skillDefinitionId('物理单体近战')!,level},{id:skillDefinitionId('魔法单体奥术')!,level},{id:skillDefinitionId('物理范围扇形')!,level}]}),d=unit('d',{level,body,armorLevel:level,armorTier:tier});
      d.hp=d.base.hpMax=100000; // Remove HP clipping from factor comparisons.
      for(const skill of [undefined,0,1,2]) {
        const old=options(a,structuredClone(d),V7_OVERFLOW_D20,skill),next=options(a,structuredClone(d),V8_OVERFLOW_D20,skill);
        const ratio=trainingDamage(level,V8_OVERFLOW_D20)/trainingDamage(level,V7_OVERFLOW_D20)*(skill===0?1.5/2.2:1);
        const p=previewAttack(old),q=previewAttack(next);
        expect(q.expectedDamage).toBeCloseTo(p.expectedDamage*ratio,7);expect(q.hitChance).toBe(p.hitChance);expect(q.penetrationFactor).toBe(p.penetrationFactor);
        const r=resolveAttack({...old,rng:reportedRng()}),s=resolveAttack({...next,rng:reportedRng()});
        expect(s.dmgMult).toBeCloseTo(r.dmgMult*ratio,9);expect(Math.abs(s.finalDamage-r.finalDamage*ratio)).toBeLessThanOrEqual(1);
      }
    }
  });
  it('signed skill bonuses and controls apply once, and repeated previews preserve skills and ledgers',()=>{
    for(const points of [-10,0,10])for(const definition of ['物理单体近战','物理单体近战中毒','盾击']) {
      const id=skillDefinitionId(definition)??'bp-shield-bash';
      const blueprints=[{id,level:7,bonuses:{power:points,damage:points,kineticDamage:points}}];
      const a=unit('a',{shield:true,weaponBonuses:{damage:points},abilityBlueprints:blueprints}),d=unit('d');
      expect(a.abilities[0]!.bonuses).toEqual(blueprints[0]!.bonuses);
      a.resources.SP=1;a.abilityState=[{abilityId:a.abilities[0]!.cooldownGroup!,cdLeft:2,used:3}];
      const before=structuredClone(a),old=options(a,d,V7_OVERFLOW_D20,0).abilityDamage!,next=options(a,d,V8_OVERFLOW_D20,0).abilityDamage!;
      expect(next.damageScale).toBeCloseTo(old.damageScale!*1.5/2.2,9);
      options(a,d,V8_OVERFLOW_D20,0);upgradeCombatSkills(a);expect(a).toEqual(before);
      a.abilities[0]!.customized=true;
      expect(options(a,d,V8_OVERFLOW_D20,0).abilityDamage).toEqual(options(a,d,V7_OVERFLOW_D20,0).abilityDamage);
    }
  });
  it('both battle modes restore the saved rule and continue deterministically across old/new snapshots',()=>{
    for(const mass of [false,true])for(const rules of mass?[V7_OVERFLOW_TW,V8_OVERFLOW_TW]:[V7_OVERFLOW_D20,V8_OVERFLOW_D20]) {
      const scale=mass?'company':'hero',a=unit('a',{scale,hpMax:mass?20:undefined,abilityBlueprints:[{id:skillDefinitionId('物理单体近战')!,level:7}]}),d=unit('d',{scale,hpMax:mass?20:undefined});
      delete a.pos;delete d.pos;
      const b=mass?new MassBattle({combatants:[a,d],rules,seed:'burst-restore',traitRegistry:registry}):new SmallBattle({combatants:[a,d],rules,seed:'burst-restore',traitRegistry:registry,battlefield:standardField()});
      b.start();const snap=b.toSnapshot(),restored=mass?MassBattle.fromSnapshot(structuredClone(snap),{traitRegistry:registry}):SmallBattle.fromSnapshot(structuredClone(snap),{traitRegistry:registry});
      expect(restored.rules.id).toBe(rules.id);expect(restored.toSnapshot()).toEqual(snap);
      for(const battle of [b,restored]) {
        if(battle instanceof SmallBattle)battle.autoAction(battle.active!.id);
        else {battle.autoOrders('ally');battle.autoOrders('enemy');battle.resolveRound();}
      }
      expect(restored.toSnapshot()).toEqual(b.toSnapshot());
    }
  });
  it('company overflow retains participants, channel and overmatch with the new output budget',()=>{
    const a=unit('a',{level:10,weaponLevel:10,scale:'company',hpMax:20}),d=unit('d',{level:1,armorLevel:1,scale:'company',hpMax:1000});
    for(const rules of [V7_OVERFLOW_D20,V8_OVERFLOW_D20]) {
      const opts=options(a,structuredClone(d),rules),r=resolveAttack({...opts,rng:new SeededRng('overflow-v8')});
      expect(r.participants).toBeGreaterThan(0);expect(r.overmatchMultiplier).toBeGreaterThan(1);expect(r.overflowDamage).toBeGreaterThan(0);
      expect(r.membersBefore!-r.membersAfter!).toBeGreaterThan(1);
    }
  });
});
