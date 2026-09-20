import {describe,it,expect} from 'vitest';
import {
  generateUnit,traitRegistry,prepareCombatModel,memberHealth,validateMemberHealth,
  applyDamagePlan,applyCombatDamage,applyResolutionDamage,resolveAttack,previewAttack,
  SmallBattle,MassBattle,standardField,standardConditionMap,prepareCondition,conditionDamage,
  V4_D20,V4_TW,V4_OVERFLOW_D20,V4_OVERFLOW_TW,combatWeapon,type Combatant,
} from '../src/index.js';
import {compileWeapon,compileArmor} from '../src/gen/equipment.js';

const registry=traitRegistry(),conditionDefs=standardConditionMap();
const rng={seed:'overflow',next:()=>0,d:(s:number)=>s===20?10:s};
function unit(id:string,side:'ally'|'enemy',members?:number):Combatant {
  const u=generateUnit({rulesVersion:'v2',name:id,side,scale:members===undefined?'hero':'company',body:'human',level:1,
    weaponClass:'sword',armorTier:0,traits:['steadfast'],...(members===undefined?{}:{hpMax:members,hp:members})},
    {registry,seed:id,noVariance:true}).unit;
  u.id=id;u.base.atk=100;u.morale=100;u.base.moraleMax=100;
  prepareCombatModel(u,V4_OVERFLOW_D20,100);
  return u;
}
function shooter(id='A') {
  const a=unit(id,'ally');
  a.weapon={id:id+'-weapon',name:'固定威力武器',baseDice:'1d2+348',channel:'kinetic',penetration:30,
    powerModel:'anchors-v1',range:6,minRange:1,tags:['ranged'],attacks:1};
  return a;
}
const opts=(a:Combatant,d:Combatant)=>({attacker:a,defender:d,rules:V4_OVERFLOW_TW,ranged:true,distance:1,conditionDefs,traitRegistry:registry,rng});

describe('同编队武器溢出',()=>{
  it('350伤害击倒3名百血成员并留一名半血伤员；残血、大编队和零目标都守恒',()=>{
    const d=unit('D','enemy',10);
    expect(applyDamagePlan(d,{direct:350,targets:1,overflow:true})).toEqual({direct:350,splash:0,overflow:250});
    expect(d.hp).toBe(7);expect(d.formation!.health).toEqual([{hp:50,count:1},{hp:100,count:6}]);
    expect(applyDamagePlan(d,{direct:80,targets:1,overflow:true}).overflow).toBe(30);
    expect(d.formation!.health).toEqual([{hp:70,count:1},{hp:100,count:5}]);validateMemberHealth(d);
    const huge=unit('大队','enemy',1000000000);
    expect(applyDamagePlan(huge,{direct:1e12,targets:0,overflow:true}).direct).toBe(0);
    expect(applyDamagePlan(huge,{direct:1e12,targets:1,overflow:true}).direct).toBe(1e11);
    expect(huge.hp).toBe(0);expect(huge.formation!.health).toEqual([]);
  });

  it('预览、实际、武技和旧规则分别使用正确上限；未穿透与独立法术不获得武器溢出',()=>{
    const a=shooter(),d=unit('D','enemy',10),o=opts(a,d);
    const saved=JSON.stringify(d),old=previewAttack({...o,rules:V4_TW}),p=previewAttack(o);
    expect(old.expectedDamage).toBeCloseTo(100*old.hitChance);expect(p.expectedDamage).toBeCloseTo(349.5*p.hitChance);
    expect(p.expectedCasualties).toBeCloseTo(3*p.hitChance);expect(p.maxDamage).toBe(350);expect(JSON.stringify(d)).toBe(saved);
    const hit=resolveAttack(o);expect(hit.finalDamage).toBe(350);expect(hit.overflowDamage).toBe(250);expect(hit.text).toContain('其中溢出250');
    const skill={baseDice:'1d2+348',channel:'kinetic' as const,penetration:30,weaponBased:true};
    expect(resolveAttack({...o,defender:unit('武技目标','enemy',10),abilityDamage:skill}).finalDamage).toBe(350);
    expect(resolveAttack({...o,defender:unit('法术目标','enemy',10),abilityDamage:{...skill,weaponBased:false}}).finalDamage).toBe(100);
    const blocked=unit('防护目标','enemy',10);blocked.armor!.protectionOverride=true;blocked.armor!.protection={kinetic:40,thermal:40,arcane:40};
    expect(resolveAttack({...o,defender:blocked}).finalDamage).toBe(0);expect(blocked.hp).toBe(10);
    const hero=unit('个体','enemy');hero.hp=100;hero.base.hpMax=100;
    expect(resolveAttack({...o,defender:hero}).finalDamage).toBe(100);
  });

  it.each(['small','mass'] as const)('%s实际攻击、同阶段提交和快照恢复保留溢出；旁队不受伤',mode=>{
    const a=shooter(),c=shooter('C'),d=unit('D','enemy',6),other=unit('旁队','enemy',10);
    if(mode==='mass'){a.body='vehicle';c.body='vehicle';}
    const units=mode==='small'?[a,d,other]:[a,c,d,other];
    const b=mode==='small'?new SmallBattle({combatants:units,rules:V4_OVERFLOW_D20,battlefield:standardField(),seed:'overflow',rng,traitRegistry:registry})
      :new MassBattle({combatants:units,rules:V4_OVERFLOW_TW,seed:'overflow',rng,traitRegistry:registry});
    b.start();
    if(b instanceof SmallBattle){a.pos=14;d.pos=7;b.attack(a.id,d.id,{bypassTurn:true});}
    else {for(const s of [a,c])expect(b.issue({unitId:s.id,type:'volley',targetId:d.id}).ok).toBe(true);b.issue({unitId:d.id,type:'hold'});b.issue({unitId:other.id,type:'hold'});b.resolveRound();}
    const hits=b.log.flatMap(e=>e.resolution?[e.resolution]:[]);
    expect(hits.reduce((n,r)=>n+r.finalDamage,0)).toBe(mode==='small'?350:600);
    expect(hits.every(r=>(r.overflowDamage??0)>0)).toBe(true);expect(d.hp).toBe(mode==='small'?3:0);expect(other.hp).toBe(10);
    const restored=b instanceof SmallBattle?SmallBattle.fromSnapshot(structuredClone(b.toSnapshot())):MassBattle.fromSnapshot(structuredClone(b.toSnapshot()));
    expect(restored.rules.weaponOverflow).toBe(true);expect(restored.byId(d.id).formation).toEqual(d.formation);
    const oldSnap=b.toSnapshot();oldSnap.rulesId=mode==='small'?V4_D20.id:V4_TW.id;
    const old=b instanceof SmallBattle?SmallBattle.fromSnapshot(oldSnap as ReturnType<SmallBattle['toSnapshot']>):MassBattle.fromSnapshot(oldSnap as ReturnType<MassBattle['toSnapshot']>);
    expect(old.rules.weaponOverflow).toBeUndefined();
  });

  it('混合命中聚合包延后提交不把余伤记到未命中的包；自动选弹计入穿甲弹余伤',()=>{
    const a=unit('齐射','ally',8),d=unit('D','enemy',10);a.weapon=shooter().weapon;
    let n=0;
    const r=resolveAttack({...opts(a,structuredClone(d)),participants:8,rng:{...rng,next:()=>++n%2?0.999:0}});
    applyResolutionDamage(d,r);
    expect(r.packetRolls!.some(p=>!p.hit)).toBe(true);expect(r.packetRolls!.some(p=>p.hit)).toBe(true);
    expect(r.packetRolls!.filter(p=>!p.hit).every(p=>p.damage===0)).toBe(true);
    expect(r.packetRolls!.reduce((total,p)=>total+p.damage,0)).toBe(r.finalDamage);expect(r.finalDamage).toBe(1000-memberHealth(d));
    const cannon=compileWeapon({mechanism:'cannon',power:6},{id:'cannon',seed:'cannon',quality:3,noVariance:true});
    const target=unit('薄生命重甲','enemy',100);target.formation!.memberHp=1;target.formation!.health=[{hp:1,count:100}];
    target.armor=compileArmor({tier:3,power:7},{id:'armor',seed:'armor',quality:3,noVariance:true});
    expect(combatWeapon(cannon,shooter(),target)?.ammunition).toBe('he');
    expect(combatWeapon(cannon,shooter(),target,true)?.ammunition).toBe('ap');
  });

  it('范围施毒影响多人，毒伤不会借武器余伤规则扩大覆盖',()=>{
    const a=unit('施毒者','ally'),d=unit('D','enemy',10);
    const effect={op:'condition' as const,conditionId:'poisoned',dur:3};
    const single=prepareCondition(a,d,{...effect,shape:'single'},rng).condition!;
    const area=prepareCondition(a,d,{...effect,shape:'burst'},rng).condition!;
    expect(single.affectedMembers).toBe(1);expect(area.affectedMembers).toBe(4);
    expect(conditionDamage(d,4,single)).toBe(4);expect(conditionDamage(d,4,area)).toBe(16);
    expect(applyCombatDamage(d,conditionDamage(d,400,area),area.affectedMembers)).toBe(400);
    expect(d.hp).toBe(6);expect(d.formation!.health).toEqual([{hp:100,count:6}]);
  });
});
