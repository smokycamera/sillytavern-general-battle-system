import { describe, it, expect } from 'vitest';
import { compileItem, damageMemberGroups, baseMechanism, generateUnit, prepareCombatModel, prepareArmsModel, V18_OVERFLOW_D20, V18_OVERFLOW_TW, V17_OVERFLOW_D20, standardConditionMap, previewAttack, resolveAttack, anchoredWeapon, diceAvg, weaponCrew, beginArmsActivation, noteArmsFire, armsWeaponReason, SmallBattle, MassBattle, standardField, type Combatant, type AttackOpts, compileSkill, abilityUsabilityReason, shieldGuardUsable, equipmentCapacity, equipmentBurden, overloadPenalty, equipmentReason, chargeCapable, type RulePack, denialModifiers, type GridPath, shieldUsable, shieldCoverage, shieldDurabilityMax, applyShieldWear, shieldUnavailableReason, movementPoints, canSpot, concealedUnit,
  rechargeEnergyShield, energyHeavyHit, energyShieldCapacity, applyCombatDamage, applyDamagePlan, grantBarrier, healingGradeMultiplier, HEALING_MODEL, skillDefinitionId, placeZone, settleZones, skillEffectLines, SeededRng,
  prepareTraitModel, prepareTraitLevelModel, prepareCondition, applySkillCondition, combatSide, combatHostile, breakCharmOnDamage, controlBonus, gridAbility, fallbackAbilityRange, traitRegistry, combatWeapon, loneHeavyOperator } from '../src/index.js';
import { unitRecordFromCombatant } from '../../panel/src/unit-state.js';
import { rollInstanceVariance, instanceMultiplier, instanceRating, instanceQuality, validateInstanceVariance, type InstanceVariance } from '../src/instance-variance.js';

const context = { id: 'w', seed: 'w', noVariance: true, damageModel: 'wounds-v2' as const };
describe('arms-v2 S1', () => {
  it('preserves the seventeen original class compilations', () => {
    const expected = [['throwing','3d6+3',3,3,1,1],['heavy-rifle','6d6+1',5,5,2,2],['natural','3d6',3,0,0,0],['light-ranged','3d6',3,2,1,1],['demolition','6d6+1',5,2,2,2],['sword','3d6+3',3,0,1,1],['axe','4d6+2',3,0,1,1],['spear','4d6',3,1,1,1],['bow','3d6+3',3,4,2,2],['firearm','5d6+3',4,4,2,2],['rifle','2d6+1',4,4,2,2],['autocannon','1d6+3',5,5,2,6],['cannon','6d6+1',5,5,2,6],['indirect-cannon','6d6+1',5,5,2,6],['energy','2d6+2',4,4,2,2],['magic','3d6+2',3,4,2,2],['blunt','4d6+1',3,0,1,1]] as const;
    for (const [mechanism, ...values] of expected) {
      const m = compileItem({kind:'weapon',mechanism,power:5},context); if (m.kind !== 'weapon') throw Error();
      expect([m.value.baseDice,m.value.penetration,m.value.range,m.value.hands,m.value.load]).toEqual(values);
    }
  });
  it('inherits the specified mechanisms and keeps original and sprayer identities', () => {
    for (const [mechanism, expected] of [['greatsword','sword'],['dagger','sword'],['great-weapon','axe'],['heavy-polearm','spear'],['crossbow','bow'],['shotgun','rifle'],['rocket','cannon'],['sprayer','sprayer'],['buckler','shield'],['shield','shield'],['tower-shield','shield'],['energy-shield','shield'],['rifle','rifle']]) expect(baseMechanism({recipe:{mechanism:mechanism!}})).toBe(expected);
  });
  it('freezes each normal attribute independently of attribute order and other attributes', () => {
    const first = rollInstanceVariance('id:123',['damage','penetration']);
    expect([first, first.rolls.damage, first.rolls.damage]).toEqual([rollInstanceVariance('id:123',['damage','penetration']),rollInstanceVariance('id:123',['penetration','damage']).rolls.damage,rollInstanceVariance('id:123',['health','damage']).rolls.damage]);
  });
  it('has the specified normal distribution for ten thousand seeds', () => {
    const values = Array.from({length:10000},(_,i)=>rollInstanceVariance('normal:'+i,['damage']).rolls.damage! / 100), mean = values.reduce((a,b)=>a+b,0)/values.length, sd = Math.sqrt(values.reduce((a,b)=>a+(b-mean)**2,0)/values.length);
    expect(Math.abs(mean)<.03 && sd>=.97 && sd<=1.03 && values.every(z=>z>=-3 && z<=3)).toBe(true);
  });
  it('converts normal offsets and respects multiplier and rating endpoints', () => {
    const v: InstanceVariance = {version:'normal-v1',rolls:{damage:100,health:-100,power:300,penetration:100,protection:-100}};
    expect([instanceMultiplier(undefined,'damage',v),instanceMultiplier(undefined,'health',v),instanceMultiplier(undefined,'power',v),instanceRating(undefined,'penetration',v),instanceRating(undefined,'protection',v),instanceMultiplier({damage:-10},'damage',v),instanceMultiplier({damage:10,power:10},'damage',v),instanceRating({penetration:10},'penetration',v)]).toEqual([1.015,.985,1.045,.06,-.06,.5,2,2]);
  });
  it('uses the quality thresholds', () => {
    for (const [roll, label] of [[150,'精品'],[75,'优良'],[74,'普通'],[-74,'普通'],[-75,'劣质'],[-149,'劣质'],[-150,'残次']] as const) expect(instanceQuality({version:'normal-v1',rolls:{damage:roll,penetration:roll}})).toBe(label);
  });
  it('reads and converts legacy rolls without changing them', () => {
    const v: InstanceVariance = JSON.parse('{"version":"enhancement-bands-v1","rolls":{"damage":2,"penetration":-2}}'); validateInstanceVariance(v);
    expect([instanceMultiplier(undefined,'damage',v),instanceRating(undefined,'penetration',v)]).toEqual([1.02,-.08]);
  });
});

const defs = standardConditionMap();
function fighter(id: string, weaponClass = 'sword', extra: Partial<import('../src/types.js').GenerateInput> = {}): Combatant {
  const u = generateUnit({ name:id,side:id.startsWith('a')?'ally':'enemy',scale:'hero',level:5,traits:[],rulesVersion:'v2',damageModel:'wounds-v2',weaponClass,weaponLevel:5,armorTier:0,...extra },{seed:id,noVariance:true}).unit;
  u.id=id; prepareCombatModel(u,V18_OVERFLOW_D20); prepareArmsModel(u,V18_OVERFLOW_D20); return u;
}
function attackInput(a: Combatant, d: Combatant, distance=1, mass=false): Omit<AttackOpts,'rng'> { if (!mass) a.pos=0; else delete a.pos; return {attacker:a,defender:d,distance,ranged:!!a.weapon?.tags?.includes('ranged'),rules:mass?V18_OVERFLOW_TW:V18_OVERFLOW_D20,conditionDefs:defs}; }
describe('arms-v2 S2',()=>{
  it('projects the new L5 classes to their specified mean damage and penetration',()=>{
    for(const [id,mean,pen,attacks]of [['greatsword',41.5,10,1],['dagger',19,9,2],['great-weapon',43.9,11,1],['heavy-polearm',37.9,11,1],['crossbow',40.3,11,1],['shotgun',52.2,10,1],['rocket',104.3,12,1],['sprayer',32,10,1]] as const){const w=anchoredWeapon(fighter('a',id).weapon,'he','wounds-v2')!;expect([Math.abs(diceAvg(w.baseDice)*(w.damageScale??1)-mean)<=mean*.02,w.penetration,w.attacks]).toEqual([true,pen,attacks]);}
  });
  it('gives crossbow the capped training accuracy, leaving bow unchanged',()=>{
    for(const level of [1,3,5,9]){const a=fighter('a','crossbow',{level}),d=fighter('d'),p=previewAttack(attackInput(a,d));expect(p.attackModifiers).toContain('弩：易学 +'+(level===1?2:3));}
    expect(previewAttack(attackInput(fighter('a','bow'),fighter('d'))).attackModifiers).not.toContain('易学');
  });
  it('uses shotgun near accuracy, distance falloff and company-only splash',()=>{
    const a=fighter('a','shotgun'),d=fighter('d');
    const rows=[1,2,3,4].map(distance=>previewAttack(attackInput(a,d,distance)));
    expect([rows[0]!.attackScore,rows[1]!.attackScore,rows[2]!.attackScore,rows[3]!.attackScore]).toEqual([rows[2]!.attackScore!+2,rows[2]!.attackScore!+2,rows[2]!.attackScore,rows[2]!.attackScore]);
    expect([rows[2]!.normalHitDamage!/rows[0]!.normalHitDamage!,rows[3]!.normalHitDamage!/rows[0]!.normalHitDamage!]).toEqual([expect.closeTo(.7,1),expect.closeTo(.4,1)]);const nearMass=previewAttack(attackInput(a,d,1,true)),farMass=previewAttack(attackInput(a,d,2,true));expect(farMass.normalHitDamage!/nearMass.normalHitDamage!).toBeCloseTo(.6,1);
    const raw=()=>({seed:'fixed',d:(s:number)=>s===20?10:s,next:()=>.1});
    const hero=resolveAttack({...attackInput(a,d,1),rng:raw()});const company=fighter('d','sword',{scale:'company',hpMax:20});const hit=resolveAttack({...attackInput(a,company,1),rng:raw()});expect([hero.splashDamage??0,(hit.splashDamage??0)>0]).toEqual([0,true]);
  });
  it('applies musket inaccuracy at five cells and three formations and heavy-rifle aiming only before moving',()=>{
    const d=fighter('d'),a=fighter('a','firearm');expect(previewAttack(attackInput(a,d,4)).attackScore!-previewAttack(attackInput(a,d,5)).attackScore!).toBe(2);expect(previewAttack(attackInput(a,d,3,true)).attackModifiers).toContain('火枪失准');
    const sniper=fighter('a','heavy-rifle'),before=previewAttack(attackInput(sniper,d,5));sniper.movedDuringActivation=true;expect(before.attackScore!-previewAttack(attackInput(sniper,d,5)).attackScore!).toBe(2);
  });
  it('folds rocket crew, heavy projection, both ammunitions and grenade splash',()=>{
    const rocket=fighter('a','rocket').weapon!,cannon=fighter('a','cannon').weapon!,r=anchoredWeapon(rocket,'he','wounds-v2')!,c=anchoredWeapon(cannon,'he','wounds-v2')!,ap=anchoredWeapon(rocket,'ap','wounds-v2')!;
    expect([weaponCrew(rocket,'arms-v2'),Math.abs(diceAvg(r.baseDice)*(r.damageScale??1)/(diceAvg(c.baseDice)*(c.damageScale??1))-2/3)<1e-12,r.splashTargets,ap.penetration]).toEqual([2,true,Math.max(1,c.splashTargets!-2),15]);
  });
  it('counts energy firing by activation, skips the fourth, resets on a pause and preserves saved counts',()=>{
    const u=fighter('a','energy');for(let i=0;i<3;i++){beginArmsActivation(u);noteArmsFire(u,u.weapon);noteArmsFire(u,u.weapon);}const restored=JSON.parse(JSON.stringify(u));beginArmsActivation(restored);expect(armsWeaponReason(restored,restored.weapon)).toContain('过热');beginArmsActivation(restored);expect(armsWeaponReason(restored,restored.weapon)).toBeUndefined();
    const paused=fighter('a','energy');noteArmsFire(paused,paused.weapon);beginArmsActivation(paused);beginArmsActivation(paused);expect(paused.weaponHeat![paused.weapon!.id]!.streak).toBe(0);
  });
  it('counts mass energy fire by round and preserves the cooling round on reload',()=>{
    const a=fighter('a','energy',{scale:'company',hpMax:200}),d=fighter('d','rifle',{scale:'company',hpMax:200,armorTier:4,armorLevel:10}),b=new MassBattle({combatants:[a,d],rules:V18_OVERFLOW_TW,seed:'mass-heat'});b.start();a.formationPosition='ally:中军:rear';d.formationPosition='enemy:中军:rear';
    for(let round=0;round<3;round++){b.issue({unitId:a.id,type:'volley',targetId:d.id});b.issue({unitId:d.id,type:'hold'});b.resolveRound();}const restored=MassBattle.fromSnapshot(structuredClone(b.toSnapshot()));expect(restored.orderPreview({unitId:a.id,type:'volley',targetId:d.id}).reason).toContain('过热');
  });
});

function shielded(kind: import('../src/data/weapons.js').ShieldClass = 'shield', weapon='sword', scale: Combatant['scale']='hero'): Combatant { return fighter('d',weapon,{scale,hpMax:scale==='hero'?200:20,armorTier:2,armorLevel:5,shield:true,shieldClass:kind,shieldLevel:5}); }
const fixedHit = () => ({seed:'hit',d:(s:number)=>s,next:()=>.1});
describe('arms-v2 S3 shields',()=>{
  it('hangs full shields with two-handed primaries, preserves V17 coverage and supports buckler and energy shield',()=>{
    const bow=shielded('shield','bow');expect([shieldUsable(bow),shieldCoverage(bow),shieldUnavailableReason(bow)]).toEqual([false,0,'盾牌挂背：双手武器只能配小盾或能量盾']);prepareArmsModel(bow,V17_OVERFLOW_D20);expect(shieldCoverage(bow)).toBe(.35);
    for(const [weapon,kind,usable]of [['greatsword','tower-shield',false],['greatsword','buckler',true],['bow','buckler',true],['greatsword','energy-shield',true]]as const)expect(shieldUsable(shielded(kind,weapon))).toBe(usable);
    const one=shielded();one.sidearm=fighter('a','rifle').weapon;expect(shieldUsable(one)).toBe(true);
  });
  it('has the specified shield capacity, coverage limits and formation scaling',()=>{
    for(const [kind,capacity,coverage,cap]of [['buckler',64,.15,.3],['shield',128,.35,.5],['tower-shield',192,.5,.6]]as const){const u=shielded(kind);expect([shieldDurabilityMax(u),shieldCoverage(u)]).toEqual([capacity,coverage]);u.shield!.recipe!.bonuses={power:10};expect(shieldCoverage(u)).toBe(Math.min(cap,coverage*1.5));}
    const group=shielded('shield','sword','company');group.shieldDurability!.remaining=shieldDurabilityMax(group)/2;expect(shieldCoverage(group)).toBe(.175);group.hp=10;expect(shieldDurabilityMax(group)).toBe(1280);const hurt=shielded('shield','sword','company');damageMemberGroups(hurt,hurt.formation!.memberHp*10,10);expect(hurt.shieldDurability!.remaining).toBe(shieldDurabilityMax(hurt));
  });
  it('wears raw shield-covered damage, doubles axe wear and ignores great weapons, area damage and hanging shields',()=>{
    for(const [weapon,mult]of [['sword',1],['axe',2]]as const){const d=shielded(),a=fighter('a',weapon),result=resolveAttack({...attackInput(a,d),rng:fixedHit()});expect(result.shieldWear).toBeCloseTo(.35*result.baseRoll!.total*result.dmgMult*mult);}
    const a=fighter('a','great-weapon'),d=shielded('tower-shield'),before=d.shieldDurability!.remaining;const hit=resolveAttack({...attackInput(a,d),rng:fixedHit()});expect([hit.shieldFactor,d.shieldDurability!.remaining]).toEqual([1,before]);
    const hanging=shielded('shield','bow');expect(resolveAttack({...attackInput(fighter('a'),hanging),rng:fixedHit()}).shieldWear).toBeUndefined();
  });
  it('breaks a hero shield and immediately disables coverage and shield actions',()=>{const d=shielded();applyShieldWear(d,128);expect([shieldCoverage(d),shieldUnavailableReason(d)]).toEqual([0,'盾已碎']);});
  it('uses tower ranged defense and movement, and combines buckler defense with sword parry',()=>{
    const a=fighter('a','rifle'),tower=shielded('tower-shield'),regular=shielded(),p=previewAttack(attackInput(a,tower,4)),q=previewAttack(attackInput(a,regular,4));expect([p.defenseScore!-q.defenseScore!,movementPoints(regular)-movementPoints(tower)]).toEqual([1,1]);
    const blade=fighter('a'),bare=fighter('d'),small=shielded('buckler'),x=previewAttack(attackInput(blade,small)),y=previewAttack(attackInput(blade,bare));expect(x.defenseModifiers).toContain('小盾格挡');expect(x.defenseScore!-y.defenseScore!).toBe(1);expect(previewAttack(attackInput(a,small,4)).defenseModifiers).not.toContain('小盾格挡');
  });
  it('saves and restores remaining shield durability',()=>{const d=shielded(),a=fighter('a'),b=new SmallBattle({combatants:[a,d],rules:V18_OVERFLOW_D20,seed:'durability'});d.shieldDurability!.remaining=45;const restored=SmallBattle.fromSnapshot(structuredClone(b.toSnapshot()));expect(restored.combatants.find(u=>u.id==='d')!.shieldDurability!.remaining).toBe(45);});
});

function denialBattle(weapon='spear', suppress=false): {b:SmallBattle;a:Combatant;holder:Combatant} {
  const a=fighter('a','sword',{hpMax:200,speedTier:5}),holder=fighter('e',weapon,{hpMax:200});a.base.spd=100;
  const field=standardField();field.tiles.fill('open');
  const b=new SmallBattle({combatants:[a,holder],rules:V18_OVERFLOW_D20,battlefield:field,seed:'denial',rng:fixedHit()});b.start();a.pos=38;holder.pos=35;holder.suppression=suppress?1:0;return {b,a,holder};
}
describe('arms-v2 S4 denial and sprint',()=>{
  it('reacts on entering two cells, remembers the mover and shares the opportunity budget',()=>{
    const {b,a,holder}=denialBattle();b.moveTo(a.id,37);expect(b.log.filter(e=>e.text.includes('拒止反应')).length).toBe(1);expect(b.reactionSpent.has(holder.id)).toBe(true);
    b.moveTo(a.id,38);b.reactionSpent.delete(holder.id);b.moveTo(a.id,37);expect(b.log.filter(e=>e.text.includes('拒止反应')).length).toBe(1);
    const restored=SmallBattle.fromSnapshot(structuredClone(b.toSnapshot()));expect(restored.combatants.find(u=>u.id===holder.id)!.denialTriggered).toEqual({round:1,targets:['a']});
  });
  it('does not react to movement starting inside the reach or while suppressed or blind to the mover',()=>{
    const inside=denialBattle();inside.a.pos=37;inside.b.moveTo('a',36);expect(inside.b.log.some(e=>e.text.includes('拒止反应'))).toBe(false);
    const suppressed=denialBattle('spear',true);suppressed.b.moveTo('a',37);expect(suppressed.b.log.some(e=>e.text.includes('拒止反应'))).toBe(false);
    const blind=denialBattle();blind.holder.conditions.push({id:'blinded',dur:2});blind.b.moveTo('a',37);expect(blind.b.log.some(e=>e.text.includes('拒止反应'))).toBe(false);
  });
  it('cancels charge bonuses after actual denial damage and applies greatsword and hook modifiers',()=>{
    const {b,a}=denialBattle();a.mount=true;a.weapon=fighter('a','spear').weapon;
    b.attack('a','e',{charge:true});expect(a.chargeInterrupted).toBe(true);expect(b.log.some(e=>e.text.includes('冲锋被拒止'))).toBe(true);
    const g=fighter('a','greatsword');expect(denialModifiers(g,true).find(m=>m.name==='巨剑破阵')!.value).toBe(-4);
    const heavy=fighter('a','heavy-polearm'),target=fighter('d');const plain=previewAttack(attackInput(heavy,target,2));target.mount=true;expect(previewAttack(attackInput(heavy,target,2)).attackScore!-plain.attackScore!).toBe(2);
  });
  it('requires mounted spear, two cells, a straight charge and no denial interruption for the sprint',()=>{
    const a=fighter('a','spear',{mount:true}),d=fighter('d');const base=attackInput(a,d,1);
    for(const [distance,straight,interrupted,weapon,mounted,bonus]of [[2,true,false,'spear',true,2],[1,true,false,'spear',true,0],[2,false,false,'spear',true,0],[2,true,true,'spear',true,0],[2,true,false,'heavy-polearm',true,0],[2,true,false,'spear',false,0]]as const){a.weapon=fighter('a',weapon).weapon;a.mount=mounted;a.chargeInterrupted=interrupted?true:undefined;const normal=previewAttack({...base,attacker:a});expect(previewAttack({...base,attacker:a,charge:true,chargeStraight:straight,chargeDistance:distance}).penetration!-normal.penetration!).toBe(bonus);}
  });
});

describe('arms-v2 S5 setup and load',()=>{
  it('uses every body and training capacity from the specification',()=>{for(const body of ['human','large','giant','vehicle']as const)for(const level of [1,5,10])expect(equipmentCapacity({body,level})).toBe(body==='vehicle'?24:({human:10,large:14,giant:20}[body])+Math.floor(.8*level));});
  it('uses load bands, overload severity and matching accuracy/evasion penalties',()=>{
    const a=fighter('a'),d=fighter('d');for(const [load,band,k]of [[11,0,0],[12,1,0],[15,2,1],[17,2,3],[21,2,5],[30,2,5]]){a.weapon!.load=load;expect([equipmentBurden(a),overloadPenalty(a)]).toEqual([band,k]);const normal=fighter('a'),ap=previewAttack(attackInput(a,d)),np=previewAttack(attackInput(normal,d));expect(np.attackScore!-ap.attackScore!).toBe(k);const against=previewAttack(attackInput(d,a)),ordinary=previewAttack(attackInput(d,normal));expect(ordinary.defenseScore!-against.defenseScore!).toBe(k);}
  });
  it('keeps overloaded equipment and prohibits charge, including large and giant burden while V17 retains its human-only threshold',()=>{
    const u=fighter('a','spear',{mount:true,sidearmClass:'cannon',sidearmLevel:5,armorTier:4,armorLevel:5,shield:true,shieldClass:'tower-shield',shieldLevel:5});expect([equipmentReason(u),equipmentBurden(u),chargeCapable(u,u.traits)]).toEqual([undefined,2,false]);
    for(const [body,load]of [['large',15],['giant',21]]as const){const x=fighter('a','sword',{body});x.weapon!.load=load;expect(equipmentBurden(x)).toBe(1);prepareArmsModel(x,V17_OVERFLOW_D20);expect(equipmentBurden(x)).toBe(0);}
    const old=fighter('a');old.weapon!.load=12;prepareArmsModel(old,V17_OVERFLOW_D20);expect(equipmentBurden(old)).toBe(1);
  });
  it('requires unmoved human artillery while permitting vehicles and rockets, including mass orders',()=>{
    for(const mechanism of ['autocannon','cannon','indirect-cannon']){const a=fighter('a',mechanism);expect(armsWeaponReason(a,a.weapon)).toBeUndefined();a.movedDuringActivation=true;expect(armsWeaponReason(a,a.weapon)).toContain('需架设');}
    for(const [mechanism,body]of [['rocket','human'],['cannon','vehicle'],['cannon','large']]as const){const a=fighter('a',mechanism,{body});a.movedDuringActivation=true;expect(armsWeaponReason(a,a.weapon)).toBeUndefined();}
    const a=fighter('a','cannon',{scale:'company',hpMax:20}),d=fighter('d','rifle',{scale:'company',hpMax:20}),b=new MassBattle({combatants:[a,d],rules:V18_OVERFLOW_TW,seed:'setup'});b.start();a.movedDuringActivation=true;expect(b.orderPreview({unitId:'a',type:'volley',targetId:'d'}).reason).toContain('需架设');
  });
});
describe('arms-v2 S6 criticals',()=>{
  it('critically hits on nineteen with dagger but not sword and previews two critical faces',()=>{
    const rng=()=>({seed:'nineteen',d:(s:number)=>s===20?19:1,next:()=>.1}),d=fighter('d'),a=fighter('a','dagger');
    expect(resolveAttack({...attackInput(a,structuredClone(d)),rng:rng()}).crit).toBe(true);expect(resolveAttack({...attackInput(fighter('a','sword'),structuredClone(d)),rng:rng()}).crit).toBe(false);expect(previewAttack(attackInput(a,d)).critChance).toBeCloseTo(.1);
  });
  it('critically resolves every dagger hit against a controlled target and previews the hit probability as critical probability',()=>{
    const a=fighter('a','dagger'),d=fighter('d','sword',{hpMax:200});d.conditions.push({id:'blinded',dur:2});const p=previewAttack(attackInput(a,d));expect(p.critChance).toBeCloseTo(p.hitChance);const rng=()=>({seed:'ten',d:(s:number)=>s===20?10:1,next:()=>.1});const hits=[resolveAttack({...attackInput(a,d),rng:rng()}),resolveAttack({...attackInput(a,d),rng:rng()})];expect(hits.every(h=>h.hit&&h.crit)).toBe(true);d.conditions=[];expect(previewAttack(attackInput(a,d)).critChance).toBeCloseTo(.1);
  });
});

describe('arms-v2 remaining reaction and weapon checks',()=>{
  it('keeps hidden crossbow fire silent with a victim clue while bow fire reveals the archer',()=>{
    for(const weapon of ['crossbow','bow']){const a=fighter('a',weapon,{traits:['stalk'],traitLevels:{stalk:10}}),d=fighter('d','sword',{hpMax:1000});a.base.spd=100;const field=standardField();field.tiles.fill('open');const b=new SmallBattle({combatants:[a,d],battlefield:field,rules:V18_OVERFLOW_D20,seed:'silent'});b.start();a.pos=21;d.pos=25;b.attack('a','d');expect(b.visibleCombatants('enemy').some(u=>u.id==='a')).toBe(weapon==='bow');if(weapon==='crossbow')expect(b.enemyIntel('enemy').clues.length).toBe(1);}
  });
  it('binds overwatch aiming to the activation in which it was set',()=>{
    const scores:number[]=[];for(const moved of [false,true]){const a=fighter('a','heavy-rifle'),d=fighter('d','sword',{hpMax:1000});a.base.spd=100;const field=standardField();field.tiles.fill('open');const b=new SmallBattle({combatants:[a,d],battlefield:field,rules:V18_OVERFLOW_D20,seed:'aim-watch'});b.start();a.pos=21;d.pos=25;a.movedDuringActivation=moved;b.setOverwatch('a');b.endTurn();b.moveTo('d',24);scores.push(b.log.find(e=>e.text.includes('警戒反应'))!.resolution!.netAtk);}expect(scores[0]!-scores[1]!).toBe(2);
  });
  it('permits buckler shield skills but forbids its guard screen and disables shield skills on hanging or broken shields',()=>{
    for(const [kind,weapon,broken,reason,guard]of [['buckler','greatsword',false,undefined,false],['tower-shield','greatsword',false,'盾牌挂背',false],['shield','sword',true,'盾已碎',false]]as const){const u=shielded(kind,weapon),ability=compileSkill({id:'bp-shield-bash',level:5},5,u.id);u.abilities=[ability];u.preparedAbilityIds=[ability.id];if(broken)u.shieldDurability!.remaining=0;const actual=abilityUsabilityReason(u,ability);expect(reason?actual?.includes(reason):actual).toBe(reason?true:undefined);expect(shieldGuardUsable(u)).toBe(guard);}
  });
  it('does not wear a shield for area attacks',()=>{const d=shielded(),before=d.shieldDurability!.remaining;resolveAttack({...attackInput(fighter('a'),d),abilityDamage:{baseDice:'1d6',shape:'burst',channel:'kinetic',penetration:10,power:5},rng:fixedHit()});expect(d.shieldDurability!.remaining).toBe(before);});
  it('does not deny blink displacement',()=>{const {b,a}=denialBattle();(b as unknown as {executeSkillMove(actor:Combatant,mode:string,cell:number,path:undefined,phase:string):string}).executeSkillMove(a,'blink',37,undefined,'before');expect(b.log.some(e=>e.text.includes('拒止反应'))).toBe(false);});
  it('limits a mass spear formation to one denial per round and saves its record',()=>{
    const a=fighter('a0','sword',{scale:'company',hpMax:100}),other=fighter('a1','sword',{scale:'company',hpMax:100}),holder=fighter('e','spear',{scale:'company',hpMax:100});const b=new MassBattle({combatants:[a,other,holder],rules:V18_OVERFLOW_TW,seed:'mass-denial'});b.start();a.formationPosition=other.formationPosition='ally:中军:reserve';holder.formationPosition='enemy:中军:front';b.issue({unitId:a.id,type:'rank-forward'});b.issue({unitId:other.id,type:'rank-forward'});b.issue({unitId:holder.id,type:'hold'});b.resolveRound(1);
    const restored=MassBattle.fromSnapshot(structuredClone(b.toSnapshot()));expect([b.log.filter(e=>e.text.includes('拒止反应')).length,restored.combatants.find(u=>u.id===holder.id)!.denialTriggered]).toEqual([1,holder.denialTriggered]);
  });
  it('continues the same seeded battle after saving a denial record and shield damage',()=>{
    const a=fighter('a','sword',{hpMax:200}),d=shielded('shield','spear');a.base.spd=100;const field=standardField();field.tiles.fill('open');const b=new SmallBattle({combatants:[a,d],rules:V18_OVERFLOW_D20,battlefield:field,seed:'arms-replay'});b.start();a.pos=38;d.pos=35;b.moveTo(a.id,37);d.shieldDurability!.remaining=45;
    const restored=SmallBattle.fromSnapshot(structuredClone(b.toSnapshot()));for(const battle of [b,restored])for(let i=0;i<6&&!battle.isOver();i++){const active=battle.active!;if(active.status==='ready')battle.autoAction(active.id);else battle.endTurn();}
    const state=(battle:SmallBattle)=>({units:battle.combatants.map(u=>[u.id,u.hp,u.status,u.shieldDurability,u.denialTriggered]),log:battle.log.map(e=>[e.round,e.kind,e.text,e.resolution?.finalDamage])});expect(state(restored)).toEqual(state(b));
  });
});

describe('arms-v2 S7 energy shields and barrier grades',()=>{
  const hit=(roll=19)=>({seed:'energy',d:(s:number)=>s===20?roll:s,next:()=>.1});
  it('recharges a hero share, overloads it on a heavy hit and skips one recharge',()=>{
    const d=shielded('energy-shield');expect(d.energyShield).toEqual({remaining:10,overloaded:0});
    resolveAttack({...attackInput(fighter('a'),d),rng:hit()});expect(d.energyShield).toEqual({remaining:7.5,overloaded:1});
    rechargeEnergyShield(d);expect(d.energyShield!.remaining).toBe(0);rechargeEnergyShield(d);expect(d.energyShield!.remaining).toBe(10);
  });
  it('decides heavy hits by the weapon mean, not the roll',()=>{
    for(const [weapon,heavy] of [['rifle',false],['dagger',false],['sword',true],['cannon',true]] as const){const w=anchoredWeapon(fighter('a',weapon).weapon,'he','wounds-v2')!;expect(energyHeavyHit(shielded('energy-shield'),(diceAvg(w.baseDice)+(w.apDice?diceAvg(w.apDice):0))*(w.damageScale??1))).toBe(heavy);}
    for(const rng of [hit(),{seed:'low',d:(s:number)=>s===20?19:1,next:()=>.1}]){const d=shielded('energy-shield');resolveAttack({...attackInput(fighter('a'),d),rng});expect(d.energyShield!.overloaded).toBe(1);}
  });
  it('does not absorb damage over time and absorbs before skill barriers',()=>{
    const dot=shielded('energy-shield');applyCombatDamage(dot,5);expect(dot.energyShield!.remaining).toBe(10);
    const d=shielded('energy-shield');grantBarrier(d,50,3);const r=resolveAttack({...attackInput(fighter('a','rifle'),d),rng:hit()});
    expect([r.energyAbsorbed,d.energyShield!.remaining,(r.barrierAbsorbed??0)>0]).toEqual([10,0,true]);
  });
  it('pools formation shares, lets a heavy hit use only the shares it lands on and skips their recharge',()=>{
    const g=shielded('energy-shield','sword','company');expect([energyShieldCapacity(g),g.energyShield!.remaining]).toEqual([200,200]);
    damageMemberGroups(g,g.formation!.memberHp*5,5);expect([g.hp,g.energyShield!.remaining]).toEqual([15,150]);
    expect(applyDamagePlan(g,{direct:30,targets:1}).energyAbsorbed).toBe(30);
    expect(applyDamagePlan(g,{direct:g.formation!.memberHp,incomingDirect:156,targets:1,splash:4*g.formation!.memberHp,incomingSplash:250,splashTargets:4,heavy:true}).energyAbsorbed).toBe(12.5);
    expect(g.energyShield).toEqual({remaining:107.5,overloaded:5});rechargeEnergyShield(g);expect(g.energyShield).toEqual({remaining:10*(g.hp-5),overloaded:0});
  });
  it('previews the same average damage that resolution deals and survives a reload',()=>{
    const a=fighter('a'),d=shielded('energy-shield'),expected=previewAttack(attackInput(a,d)).expectedDamage;
    let total=0;for(let i=0;i<2000;i++){const copy=structuredClone(d);total+=resolveAttack({...attackInput(a,copy),rng:new SeededRng('energy-preview:'+i)}).finalDamage;}
    expect(Math.abs(total/2000-expected)/expected).toBeLessThan(.05);
    d.energyShield={remaining:3,overloaded:1};const b=new SmallBattle({combatants:[a,d],rules:V18_OVERFLOW_D20,seed:'energy'});
    expect(SmallBattle.fromSnapshot(structuredClone(b.toSnapshot())).combatants.find(u=>u.id==='d')!.energyShield).toEqual({remaining:3,overloaded:1});
  });
  it('scales granted barriers across grades like healing, for skills, items and zones, only under the barrier model',()=>{
    for(const [power,level] of [[4,3],[8,3]] as const){const u=fighter('a','sword',{level});grantBarrier(u,20,3,'s',power);expect(u.barrier!.remaining).toBe(Math.max(1,Math.round(20*healingGradeMultiplier(power,level,HEALING_MODEL))));}
    const old=fighter('a','sword',{level:3});prepareArmsModel(old,V17_OVERFLOW_D20);grantBarrier(old,20,3,'s',8);expect(old.barrier!.remaining).toBe(20);
    const caster=fighter('a','sword',{level:3}),zoneSkill=compileSkill({id:skillDefinitionId('buff屏障+治疗区域')!},8,caster.id,'skills-v2'),zone=zoneSkill.effects.find(e=>e.op==='zone')!;
    if(zone.op!=='zone')throw Error();const payload=zone.effects!.find(e=>e.op==='barrier')!;if(payload.op!=='barrier')throw Error();
    const field=standardField();field.tiles.fill('open');caster.pos=24;const context={mode:'small' as const,units:[caster],battlefield:field,fieldTags:[],rules:V18_OVERFLOW_D20};
    caster.battleZones=[placeZone(context,caster,caster,zone,1,zoneSkill.id)];settleZones(context,1,true,new SeededRng('zone'));
    expect(caster.barrier!.remaining).toBe(Math.max(1,Math.round(payload.amount*healingGradeMultiplier(8,3,HEALING_MODEL))));
    const lines=skillEffectLines(context,caster,caster,compileSkill({id:skillDefinitionId('buff屏障')!},8,caster.id,'skills-v2'));expect(lines.join('')).toContain('跨等级×');
  });
});

describe('arms-v2 S8 sprayer',()=>{
  function sprayField(extra: Combatant[] = []) {
    const s=fighter('a','sprayer',{hpMax:400}),field=standardField(9,15);field.tiles.fill('open');
    const cells=[31,30,32,29,33,21,23].slice(0,7-extra.length),foes=cells.map((_,i)=>fighter('e'+i,'sword',{hpMax:400}));
    const b=new SmallBattle({combatants:[s,...foes,...extra],rules:V18_OVERFLOW_D20,battlefield:field,seed:'spray'});b.start();
    s.pos=4;cells.forEach((pos,i)=>{foes[i]!.pos=pos;});extra.forEach(u=>{u.pos=23;});b.turnOrder=[s.id,...foes.map(u=>u.id),...extra.map(u=>u.id)];b.turnIndex=0;
    return {b,s,foes,field};
  }
  it('sprays a cone of at most six targets on the target side, never allies, and shows the same targets in the preview',()=>{
    const full=sprayField();full.b.attack(full.s.id,'e0');expect(full.b.log.filter(e=>e.kind==='attack').length).toBe(6);
    const friend=fighter('a1','sword',{hpMax:400});const {b,s}=sprayField([friend]);
    const option=b.getActionOptions(s.id).find(o=>o.kind==='weapon')!.targets!.find(t=>t.targetId==='e0')!;
    b.attack(s.id,'e0');const hit=b.log.filter(e=>e.kind==='attack').map(e=>e.resolution!.defenderId);
    expect([hit.length,hit.includes(friend.id),hit[0],option.preview!.areaTargetIds]).toEqual([6,false,'e0',hit]);
  });
  it('ignores shields, cover and works reductions',()=>{
    const s=fighter('a','sprayer'),tower=shielded('tower-shield'),bare=fighter('d','sword',{hpMax:200,armorTier:2,armorLevel:5});
    expect(previewAttack(attackInput(s,tower,2)).expectedDamage).toBeCloseTo(previewAttack(attackInput(s,bare,2)).expectedDamage,6);
    const works=fighter('d','sword',{hpMax:200,traits:['fortification']});prepareTraitModel(works,V18_OVERFLOW_D20);prepareTraitLevelModel(works,V18_OVERFLOW_D20);works.pos=5;works.entrenchedAt=5;
    const withTraits=(a:Combatant)=>({...attackInput(a,structuredClone(works),2),traitRegistry:traitRegistry(),rng:fixedHit()});
    expect([resolveAttack(withTraits(s)).wardMult,resolveAttack(withTraits(fighter('a','rifle'))).wardMult<1]).toEqual([1,true]);
  });
  it('burns and frightens damaged targets, spends fuel per attack and refuels after battle',()=>{
    const {b,s}=sprayField();b.attack(s.id,'e0');const first=b.log.find(e=>e.kind==='attack')!;
    expect([b.byId('e0').conditions.some(c=>c.id==='burning'&&c.dur===2),/火焰/.test(first.text)]).toEqual([true,true]);
    for(let i=0;i<2;i++){b.turnIndex=0;b.actedThisTurn.clear();b.attack(s.id,'e0');}
    b.actedThisTurn.clear();expect(b.getActionOptions(s.id).find(o=>o.kind==='weapon')!.targets!.find(t=>t.targetId==='e0')!.reason).toContain('燃料耗尽');
    expect(unitRecordFromCombatant(s).snapshot!.sprayerFuel).toBeUndefined();
  });
  it('ruptures a hero fuel tank on a critical hit, burning its allies and itself, at most once per round',()=>{
    const s=fighter('a','sprayer',{hpMax:400}),friend=fighter('a1','sword',{hpMax:400}),foe=fighter('e','sword',{hpMax:400}),field=standardField();field.tiles.fill('open');
    const b=new SmallBattle({combatants:[s,friend,foe],rules:V18_OVERFLOW_D20,battlefield:field,seed:'tank',rng:fixedHit()});b.start();s.pos=24;friend.pos=25;foe.pos=23;b.turnOrder=['e','a','a1'];b.turnIndex=0;
    const before=[s.hp,friend.hp];b.attack('e','a');
    expect([s.hp<before[0]!,friend.hp<before[1]!,s.sprayerFuel?.[s.weapon!.id],b.log.some(e=>e.text.includes('燃料罐被击穿爆炸'))]).toEqual([true,true,0,true]);
  });
  it('covers a whole formation in mass battles',()=>{
    const s=fighter('a','sprayer'),g=fighter('d','rifle',{scale:'company',hpMax:20});const r=resolveAttack({...attackInput(s,g,1,true),rng:fixedHit()});
    expect(r.damagePlans![0]!.splashTargets).toBe(20);
  });
});

describe('arms-v2 user additions',()=>{
  const charm=(level=5)=>compileSkill({id:skillDefinitionId('debuff+魅惑')!},level,'e','skills-v2').effects.find(e=>e.op==='condition')!;
  it('charms a V18 formation as one unit, breaks on the caster side damage and keeps V17 formations immune',()=>{
    const caster=fighter('e','sword'),g=fighter('a','sword',{scale:'company',hpMax:20}),friend=fighter('a1');prepareTraitLevelModel(g,V18_OVERFLOW_D20);
    const effect=charm();if(effect.op!=='condition')throw Error();const forcedFail={d:()=>1} as unknown as import('../src/rng.js').Rng;
    const outcome=prepareCondition(caster,g,effect,forcedFail,[caster,g,friend]);applySkillCondition(g,outcome.condition);delete g.conditions[0]!.controlPending;
    expect([combatSide(g,[caster,g,friend]),combatHostile(g,friend,[caster,g,friend])]).toEqual(['enemy',true]);
    breakCharmOnDamage([caster,g,friend],g,caster,5);expect(combatSide(g,[caster,g,friend])).toBe('ally');
    const old=fighter('a','sword',{scale:'company',hpMax:20});prepareArmsModel(old,V17_OVERFLOW_D20);expect(prepareCondition(caster,old,effect,forcedFail).text).toContain('独立个体');
  });
  it('adds one charm resistance per doubling of formation members',()=>{
    for(const [members,bonus] of [[1,0],[3,1],[20,4],[50,5]] as const){const g=fighter('a','sword',{scale:'company',hpMax:members});expect(controlBonus(g,'charmed')-controlBonus(g,'stunned')).toBe(bonus);}
  });
  it('keeps attached heroes uncharmable and stops a charmed host from using its attached hero',()=>{
    const g=fighter('a','sword',{scale:'company',hpMax:20}),hero=fighter('a1'),caster=fighter('e','sword',{scale:'company',hpMax:20}),ability=compileSkill({id:skillDefinitionId('debuff+魅惑')!},5,caster.id,'skills-v2'),aid=compileSkill({id:skillDefinitionId('buff治疗')!},5,hero.id,'skills-v2');
    caster.abilities=[ability];caster.preparedAbilityIds=[ability.id];caster.resources.SP=30;hero.abilities=[aid];hero.preparedAbilityIds=[aid.id];hero.resources.SP=30;
    const b=new MassBattle({combatants:[g,hero,caster],rules:V18_OVERFLOW_TW,seed:'charm-host'});b.start();
    expect(b.orderPreview({unitId:caster.id,type:'ability',abilityId:ability.id,targetId:hero.id}).reason).toContain('随队人物受编队掩护');
    g.conditions=[{id:'charmed',dur:1,sourceId:caster.id,controlSide:'enemy'}];
    expect(b.orderPreview({unitId:g.id,type:'ability',abilityActorId:hero.id,abilityId:aid.id,targetId:caster.id}).reason).toBe('随队人物未受魅惑，不替施术者行动');
  });
  it('gives V18 small-battle buff and debuff skills five cells plus range steps, leaving magic bolts, mass ranges, quick items and V17 alone',()=>{
    const u=fighter('a');
    for(const [text,level,bonuses,expected] of [['buff治疗',1,undefined,5],['debuff致盲',5,undefined,5],['buff攻击',10,undefined,5],['buff治疗',5,{range:5},6],['魔法单体',5,undefined,7]] as const){
      const s=compileSkill({id:skillDefinitionId(text)!,...(bonuses?{bonuses}:{})},level,u.id,'skills-v2');
      expect([gridAbility(s,'arms-v2').range!.max,gridAbility(s).range!.max===s.range!.max||text==='魔法单体',fallbackAbilityRange(u,s).max]).toEqual([expected,true,s.range!.max]);
    }
    const dose=compileItem({kind:'item',form:'single',power:3,active:skillDefinitionId('buff治疗')!},{id:'dose',seed:'dose'});if(dose.kind!=='item')throw Error();expect(gridAbility(dose.value.ability!,'arms-v2').range!.max).toBe(1);
  });
});

describe('arms-v2 补齐必测（击退拉拽、火箭筒、道具屏障）',()=>{
  function pushBattle(direction:'away'|'towards'){
    const pusher=fighter('a1','sword',{hpMax:200}),victim=fighter('e1','sword',{hpMax:200}),holder=fighter('e2','spear',{hpMax:200});
    const field=standardField();field.tiles.fill('open');
    const b=new SmallBattle({combatants:[pusher,victim,holder],rules:V18_OVERFLOW_D20,battlefield:field,seed:'push',rng:fixedHit()});b.start();
    holder.pos=35;victim.pos=38;pusher.pos=direction==='away'?39:36;
    pusher.abilities=[{id:'test-push',name:'推离',power:5,target:'enemy',shape:'single',description:'测试用推离',effects:[{op:'push',force:6,direction,physical:true}]} as unknown as Combatant['abilities'][number]];
    pusher.preparedAbilityIds=[...(pusher.preparedAbilityIds??[]),'test-push'];
    return {b,pusher,victim,holder};
  }
  it('never reacts to knockback or pull: only the mover walking in counts',()=>{
    for(const direction of ['away','towards'] as const){
      const {b,pusher,victim,holder}=pushBattle(direction);
      expect(b.dist(victim,holder)).toBe(3);
      const result=b.useAbility(pusher.id,'test-push',victim.id,{bypassTurn:true});
      expect(result.ok).toBe(true);
      expect([victim.pos,b.dist(victim,holder)]).toEqual([37,2]);
      expect(b.log.some(e=>e.text.includes('拒止反应'))).toBe(false);
      expect(b.reactionSpent.has(holder.id)).toBe(false);
      expect(holder.denialTriggered).toBeUndefined();
    }
  });
  it('gives the rocket hero no lone-operator penalty and the same auto ammunition as a cannon',()=>{
    const rocketHero=fighter('a','rocket'),autocannonHero=fighter('a','autocannon');
    expect([loneHeavyOperator(rocketHero,rocketHero.weapon),loneHeavyOperator(autocannonHero,autocannonHero.weapon)]).toEqual([false,true]);
    const shot=resolveAttack({...attackInput(fighter('a','rocket'),fighter('d')),rng:fixedHit()});
    expect(shot.atkDetail).not.toContain('单人操作机炮');
    const targets=[fighter('d','sword'),fighter('d','rifle',{scale:'company',hpMax:20}),fighter('d','sword',{armorTier:4,armorLevel:10})];
    for(const target of targets){
      const rocket=fighter('a','rocket'),cannon=fighter('a','cannon');
      expect(combatWeapon(rocket.weapon,rocket,target)!.ammunition).toBe(combatWeapon(cannon.weapon,cannon,target)!.ammunition);
    }
  });
  it('scales an item-sourced barrier by its own defense power and caster level',()=>{
    const dose=compileItem({kind:'item',form:'single',power:5,active:skillDefinitionId('buff屏障')!},{id:'barrier-dose',seed:'barrier-dose'});
    if(dose.kind!=='item')throw Error('道具未编译为屏障来源');
    const ability=dose.value.ability!,caster=fighter('a','sword',{level:3}),effect=ability.effects.find(e=>e.op==='barrier');
    if(!effect||effect.op!=='barrier')throw Error('道具没有屏障效果');
    expect(effect.defensePower).toBe(ability.power);
    expect(skillEffectLines({mode:'small',units:[caster],fieldTags:[],rules:V18_OVERFLOW_D20},caster,caster,ability).join('')).toContain('跨等级×');
    grantBarrier(caster,effect.amount,effect.dur,'item',effect.defensePower);
    expect(caster.barrier!.remaining).toBe(Math.max(1,Math.round(effect.amount*healingGradeMultiplier(effect.defensePower!,3,HEALING_MODEL))));
  });
});
