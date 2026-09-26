import { expect, it } from 'vitest';
import { generateUnit, SmallBattle, MassBattle, standardField, V4_OVERFLOW_D20, V4_OVERFLOW_TW, V2_D20, V2_TW, compileGenericSkill, compileItem, attachCarriedItems, activeTraitIds, abilityUsabilityReason, grantBarrier, areaTargets, settleZones, smokeBlocks, resolveWeaponClass, gridWeaponRange, anchoredWeapon, parseSkillMechanism, type Combatant, type Ability } from '../src/index.js';
import { applyCombatDamage, applyDamagePlan } from '../src/recovery.js';
import { resolveAttack, previewAttack } from '../src/damage.js';
import { standardConditionMap } from '../src/conditions.js';
import { syncAccessoryAbilities } from '../src/items.js';
import { placeZone, visibleBattleZones } from '../src/area-effects.js';
import { unitRecordFromCombatant, combatantFromUnknown } from '../../panel/src/unit-state.js';
import { prepareInventoryState, prepareInventoryTransaction, createInventoryItem, type InventorySave, type InventoryAction } from '../../panel/src/inventory-state.js';
import { parseItemSpecification } from '../../panel/src/item-spec.js';
import { reviewMigration } from '../../panel/src/migration-review.js';

function unit(id: string, side: 'ally'|'enemy' = 'ally', company = false) {
  const u=generateUnit({name:id,side,scale:company?'company':'hero',rulesVersion:'v2',level:5,hpMax:100,weaponClass:'sword',weaponLevel:2,armorTier:0,traits:[]},{seed:id,noVariance:true}).unit;
  u.id=id;u.tags.push('zone:中军','rank:front');return u;
}
function grid(units: Combatant[]) {
  const field=standardField(7,13);field.tiles.fill('open');
  const b=new SmallBattle({combatants:units,battlefield:field,rules:V4_OVERFLOW_D20,seed:'priority'});b.start();
  b.turnOrder=units.map(u=>u.id);b.turnIndex=0;units.forEach((u,i)=>u.pos=40+i);return b;
}
function learn(u: Combatant, id: string): Ability { const a=compileGenericSkill(id,3,u.id);u.abilities.push(a);(u.preparedAbilityIds??=[]).push(a.id);return a; }

it('equips two different accessories, grants an active skill without a preparation slot and revokes it on removal',()=>{
  let save:InventorySave=prepareInventoryState({schemaVersion:2,factRevision:1,storage:[unitRecordFromCombatant(unit('a'))],inventory:[createInventoryItem('night','夜视镜',{kind:'accessory',mechanism:'night',power:3},'night'),createInventoryItem('charm','屏障护符',{kind:'accessory',mechanism:'barrier',power:3},'charm')]});
  const apply=(action:InventoryAction)=>{save=prepareInventoryTransaction(save,{...action,id:crypto.randomUUID(),expectedRevision:save.factRevision!});};
  apply({kind:'equip',itemId:'night',unitId:'a',slot:'accessory1'});apply({kind:'equip',itemId:'charm',unitId:'a',slot:'accessory2'});
  let actor=save.storage![0]!.snapshot!;
  expect(activeTraitIds(actor)).toContain('night-fighter');
  const ability=actor.abilities.find(a=>a.equipmentSourceId==='charm')!;
  expect(actor.preparedAbilityIds).not.toContain(ability.id);expect(abilityUsabilityReason(actor,ability)).toBeUndefined();
  const restored=prepareInventoryState(JSON.parse(JSON.stringify(save)));expect(restored.storage![0]!.snapshot!.abilities.filter(a=>a.equipmentSourceId)).toHaveLength(1);
  expect(reviewMigration(JSON.parse(JSON.stringify(save)))).toBeUndefined();
  apply({kind:'unequip',unitId:'a',slot:'accessory2'});actor=save.storage![0]!.snapshot!;
  expect(actor.abilities.some(a=>a.equipmentSourceId==='charm')).toBe(false);expect(abilityUsabilityReason(actor,ability)).toContain('卸下');
  apply({kind:'unequip',unitId:'a',slot:'accessory1'});expect(activeTraitIds(save.storage![0]!.snapshot!)).not.toContain('night-fighter');
});

it('restores the selected ally resource and consumes one physical item, with no repeated spend after restore',()=>{
  const mechanics=compileItem({kind:'consumable',mechanism:'restore',power:3},{id:'dose',name:'回能药剂',seed:'dose'});
  if(mechanics.kind!=='consumable')throw Error('fixture');
  const a=attachCarriedItems(unit('a'),[{id:'dose',name:'回能药剂',quantity:2,revision:1,mechanics}]),f=unit('f'),e=unit('e','enemy');
  const b=grid([a,f,e]);f.resources.SP=0;const before=a.resources.SP;
  expect(b.useAbility(a.id,'item:dose',f.id).ok).toBe(true);expect(f.resources.SP).toBe(4);expect(a.resources.SP).toBe(before);expect(a.resources['item:dose']).toBe(1);
  const restored=SmallBattle.fromSnapshot(JSON.parse(JSON.stringify(b.toSnapshot())));
  expect(restored.useAbility(a.id,'item:dose',f.id).ok).toBe(false);expect(restored.byId(a.id).resources['item:dose']).toBe(1);
});

it('cleanses a carried medicine target and refuses vehicle repair on people without consuming it',()=>{
  for(const mechanism of ['cleanse','repair'] as const){
    const mechanics=compileItem({kind:'consumable',mechanism,power:3},{id:'dose',seed:'dose'});if(mechanics.kind!=='consumable')throw Error('fixture');
    const a=attachCarriedItems(unit('a'),[{id:'dose',name:'药剂',quantity:1,revision:1,mechanics}]),b=grid([a,unit('e','enemy')]);a.conditions.push({id:'poisoned',dur:3});a.hp=50;
    const result=b.useAbility(a.id,'item:dose',a.id);
    expect(result.ok).toBe(mechanism==='cleanse');expect(a.resources['item:dose']).toBe(mechanism==='cleanse'?0:1);
    if(mechanism==='cleanse')expect(a.conditions).toEqual([]);
  }
});

it('absorbs damage from a finite shared barrier without changing health capacity or restoring spent protection',()=>{
  const a=unit('a');grantBarrier(a,12,3,'a');grantBarrier(a,8,2,'other');expect(a.barrier!.remaining).toBe(12);
  const max=a.base.hpMax;expect(applyCombatDamage(a,7)).toBe(0);expect(a.barrier!.remaining).toBe(5);
  expect(applyCombatDamage(a,9)).toBe(4);expect(a.hp).toBe(96);expect(a.barrier).toBeUndefined();expect(a.base.hpMax).toBe(max);
  expect(unitRecordFromCombatant({...a,barrier:{remaining:10,duration:2}}).snapshot!.barrier).toBeUndefined();
});

it('casts ground zones through both battle modes and preserves their remaining state',()=>{
  for(const mode of ['small','mass']) {
    const a=unit('a','ally',mode==='mass'),e=unit('e','enemy',mode==='mass');
    const ability=learn(a,'generic:buff:zone-smoke');
    const b=mode==='small'?grid([a,e]):new MassBattle({combatants:[a,e],rules:V4_OVERFLOW_TW,seed:'area-mass'});
    if(b instanceof MassBattle)b.start();
    const target=b instanceof SmallBattle?'cell:31':'zone:enemy:中军:front';
    const before=a.resources.SP!;expect(b.useAbility(a.id,ability.id,target)).toMatchObject({ok:true});
    if(b instanceof MassBattle){b.issue({unitId:e.id,type:'hold'});b.resolveRound();}
    expect(a.resources.SP).toBe(before-3);expect(a.battleZones).toHaveLength(1);
    const snapshot=JSON.parse(JSON.stringify(b.toSnapshot()));
    const restored=b instanceof SmallBattle?SmallBattle.fromSnapshot(snapshot):MassBattle.fromSnapshot(snapshot);
    expect(restored.byId(a.id).battleZones).toEqual(a.battleZones);expect(restored.byId(a.id).resources.SP).toBe(a.resources.SP);
  }
});

it('persistent damage hits only once per unit and round, remains spent after restore, and smoke blocks sight',()=>{
  const a=unit('a'),e=unit('e','enemy');const spell=learn(a,'generic:magic-area:zone-fire');const b=grid([a,e]);a.pos=40;e.pos=31;
  expect(b.useAbility(a.id,spell.id,'cell:31').ok).toBe(true);const hp=e.hp;expect(hp).toBeLessThan(100);
  settleZones(b.observationContext(),b.round);expect(e.hp).toBe(hp);
  const restored=SmallBattle.fromSnapshot(JSON.parse(JSON.stringify(b.toSnapshot())));settleZones(restored.observationContext(),restored.round);expect(restored.byId(e.id).hp).toBe(hp);
  const smoke=compileGenericSkill('generic:buff:zone-smoke',3,'a').effects[0]!;expect(smoke.op).toBe('zone');
  a.battleZones![0]!.kind='smoke';a.pos=45;e.pos=17;expect(smokeBlocks(b.observationContext(),a,e)).toBe(true);
});

it('line, cone, ring and chain select different targets with bounded, deterministic coverage',()=>{
  const a=unit('a'),p=unit('p','enemy'),inline=unit('inline','enemy'),wide=unit('wide','enemy');const b=grid([a,p,inline,wide]);
  a.pos=52;p.pos=31;inline.pos=38;wide.pos=32;
  const select=(shape:NonNullable<Ability['area']>['shape'])=>areaTargets(b.observationContext(),a,p,{...compileGenericSkill('generic:magic-area',3,'a'),area:{shape,radius:2,maxTargets:3}},()=>true).map(u=>u.id);
  expect(select('line')).toEqual(['p','inline']);expect(select('cone')).toContain('wide');expect(select('ring')).not.toContain('p');expect(select('chain')).toHaveLength(3);
});
it('keeps the existing weapon classes plus the three user-approved additions and accepts broad names without extra required fields',()=>{
  for(const [name,id] of [['狙击枪','rifle'],['机枪','rifle'],['冲锋枪','rifle'],['霰弹枪','rifle'],['匕首','sword'],['投掷武器','throwing'],['枪械','rifle'],['法器','magic']])expect(resolveWeaponClass(name!)).toBe(id);
  expect(parseItemSpecification('回能药剂L3').kind).toBe('consumable');expect(parseItemSpecification('夜视镜L3').kind).toBe('accessory');
});

it('the three approved weapon types differ without creating a large extra catalogue',()=>{
  const weapon=(mechanism:string)=>{const item=compileItem({kind:'weapon',mechanism,power:3},{id:mechanism,seed:mechanism});if(item.kind!=='weapon')throw Error('fixture');return item.value;};
  expect(weapon('throwing')).toMatchObject({hands:1,load:1});expect(gridWeaponRange(weapon('throwing'))).toBe(4);
  expect(weapon('heavy-rifle')).toMatchObject({attacks:1,reload:1});expect(anchoredWeapon(weapon('heavy-rifle'))!.penetration).toBeGreaterThan(anchoredWeapon(weapon('rifle'))!.penetration!);
  expect(weapon('natural')).toMatchObject({hands:0,load:0});
  const a=unit('a'),e=unit('e','enemy');a.weapon=weapon('natural');const b=grid([a,e]);a.conditions.push({id:'disarmed',dur:2});
  expect(b.getActionOptions(a.id).find(o=>o.id==='weapon')!.enabled).toBe(true);
  expect(()=>b.attack(a.id,e.id)).not.toThrow();
});

it('stun, root, silence and disarm are real control effects, accept simple Chinese names and can be resisted',()=>{
  for(const [name,id] of [['眩晕','stun'],['定身','root'],['沉默','silence'],['缴械','disarm']]) {
    expect(parseSkillMechanism(name!)?.modifiers).toEqual([id]);
    for(const succeeds of [true,false]) {
      const a=unit('a'),e=unit('e','enemy'),spell=learn(a,'generic:debuff:'+id);
      const field=standardField();field.tiles.fill('open');
      const b=new SmallBattle({combatants:[a,e],battlefield:field,rules:V2_D20,rng:{seed:'control',next:()=>.5,d:n=>n===20?(succeeds?1:20):n}});b.start();b.turnOrder=['a','e'];b.turnIndex=0;a.pos=38;e.pos=31;
      expect(b.useAbility(a.id,spell.id,e.id).ok).toBe(true);
      expect(e.conditions.some(c=>c.id===({stun:'stunned',root:'restrained',silence:'silenced',disarm:'disarmed'} as Record<string,string>)[id!])).toBe(succeeds);
      if(succeeds&&id==='root')expect(b.movementLeft(e.id)).toBe(0);
      if(succeeds&&id==='stun'){b.endTurn();expect(b.active?.id).not.toBe(e.id);expect(b.log.some(entry=>entry.text.includes('跳过回合'))).toBe(true);}
      if(succeeds&&id==='disarm'){b.endTurn();expect(b.getActionOptions(e.id).find(o=>o.id==='weapon')!.enabled).toBe(false);}
      if(succeeds&&id==='silence') { const magic=learn(e,'generic:magic-single');expect(abilityUsabilityReason(e,magic)).toContain('沉默'); }
    }
  }
});

it('a heavy hit spends the barrier before the health cap, including a shield granted after an attack was planned',()=>{
  const a=unit('a'),e=unit('e','enemy');a.level=1;a.weapon={id:'test',name:'测试重击',customized:true,baseDice:'1d2+199',channel:'kinetic',penetration:100};
  const rules={...V4_OVERFLOW_TW,tw:{...V4_OVERFLOW_TW.tw,min:1,max:1}};
  const result=resolveAttack({attacker:a,defender:structuredClone(e),rules,conditionDefs:standardConditionMap(),rng:{seed:'fixed',next:()=>0,d:()=>1}});
  expect(result.finalDamage).toBe(100);expect(result.damagePlans![0]!.incomingDirect).toBe(200);
  grantBarrier(e,30,2);const loss=applyDamagePlan(e,JSON.parse(JSON.stringify(result.damagePlans![0])));
  expect(loss.direct).toBe(100);expect(e.hp).toBe(0);expect(e.barrier).toBeUndefined();
});

it('multi-shot previews spend one shared barrier, stay deterministic and leave the combatants untouched',()=>{
  const a=unit('a'),e=unit('e','enemy');a.level=1;a.weapon={id:'test',name:'测试连射',customized:true,baseDice:'1d2+9',channel:'kinetic',penetration:100,attacks:3};grantBarrier(e,15,3);
  const before=JSON.stringify([a,e]),opts={attacker:a,defender:e,rules:{...V4_OVERFLOW_TW,tw:{...V4_OVERFLOW_TW.tw,min:1,max:1}},conditionDefs:standardConditionMap()};
  expect(previewAttack(opts)).toMatchObject({damageChance:1,exact:false});expect(previewAttack(opts).expectedDamage).toBeGreaterThanOrEqual(15);expect(previewAttack(opts).expectedDamage).toBeLessThanOrEqual(18);
  expect(previewAttack(opts)).toEqual(previewAttack(opts));expect(JSON.stringify([a,e])).toBe(before);
});

it('mass combat refuses orders from stunned units and corrupted new effect state cannot pass save validation',()=>{
  const a=unit('a','ally',true),e=unit('e','enemy',true);const b=new MassBattle({combatants:[a,e],rules:V4_OVERFLOW_TW,seed:'control-mass'});b.start();a.conditions.push({id:'stunned',dur:2});
  expect(b.orderPreview({unitId:a.id,type:'charge',targetId:e.id}).reason).toContain('无法行动');
  for(const patch of [{barrier:{remaining:'10',duration:2}},{battleZones:{}},{accessories:{extra:{}}},{abilities:[{id:'bad',name:'坏配件能力',equipmentSourceId:'missing',effects:[]}]}])expect(()=>combatantFromUnknown({...unit('valid'),...patch})).toThrow();
});

it('equipped barrier abilities execute and keep spent uses after restoring either battle mode',()=>{
  for(const mode of ['small','mass']) {
    const a=unit('a','ally',mode==='mass'),e=unit('e','enemy',mode==='mass');
    const item=compileItem({kind:'accessory',mechanism:'barrier',power:3},{id:'charm',seed:'charm'});if(item.kind!=='accessory')throw Error('fixture');
    a.accessories={accessory1:item.value};syncAccessoryAbilities(a);const ability=a.abilities.find(s=>s.equipmentSourceId==='charm')!;
    const b=mode==='small'?grid([a,e]):new MassBattle({combatants:[a,e],rules:V4_OVERFLOW_TW,seed:'shield-mass'});if(b instanceof MassBattle)b.start();
    const before=a.resources.SP!;expect(b.useAbility(a.id,ability.id,a.id).ok).toBe(true);
    if(b instanceof MassBattle){b.issue({unitId:e.id,type:'hold'});b.resolveRound();}
    expect(a.barrier?.remaining).toBe(18);expect(a.resources.SP).toBe(before-2);expect(a.abilityState.find(s=>s.abilityId===ability.id)?.used).toBe(1);
    const save=JSON.parse(JSON.stringify(b.toSnapshot())),restored=b instanceof SmallBattle?SmallBattle.fromSnapshot(save):MassBattle.fromSnapshot(save);
    expect(restored.byId(a.id).barrier).toEqual(a.barrier);expect(restored.byId(a.id).abilityState).toEqual(a.abilityState);
  }
});

it('mass fire damages units in its area and does not strike them again on a mid-round restore',()=>{
  const a=unit('a','ally',true),e=unit('e','enemy',true),spell=learn(a,'generic:magic-area:zone-fire');
  const b=new MassBattle({combatants:[a,e],rules:V4_OVERFLOW_TW,seed:'fire-mass'});b.start();
  expect(b.useAbility(a.id,spell.id,'zone:enemy:中军:front').ok).toBe(true);b.issue({unitId:e.id,type:'hold'});b.resolveRound();
  expect(b.log.some(entry=>entry.text.includes('燃烧区域'))).toBe(true);
  const saved=JSON.parse(JSON.stringify(b.toSnapshot()));const restored=MassBattle.fromSnapshot(saved);const before=JSON.stringify(restored.byId(e.id).formation);
  settleZones(restored.observationContext(),b.round-1);expect(JSON.stringify(restored.byId(e.id).formation)).toBe(before);
});

it('enemy trap positions stay hidden and night vision limits the display of distant persistent areas',()=>{
  const a=unit('a','ally',true),e=unit('e','enemy',true);a.formationPosition='ally:中军:reserve';e.formationPosition='enemy:中军:reserve';
  const b=new MassBattle({combatants:[a,e],rules:V4_OVERFLOW_TW,seed:'zone-visibility',field:{tags:['night']}});b.start();
  placeZone(b.observationContext(),e,e,{op:'zone',kind:'fire',power:3,dur:3,radius:1},1,'fire');
  expect(visibleBattleZones(b.observationContext(),'ally')).toHaveLength(0);
  const day={...b.observationContext(),fieldTags:[]};expect(visibleBattleZones(day,'ally')).toHaveLength(1);
  e.battleZones![0]!.kind='trap';expect(visibleBattleZones(day,'ally')).toHaveLength(0);
});
