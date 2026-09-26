import { describe, expect, it } from 'vitest';
import { generateUnit, traitRegistry, xpProgress, SmallBattle, V4_D20 } from '../../engine/src/index.js';
import { anchoredWeapon, anchoredProtection, armorPowerScale } from '../../engine/src/power-anchors.js';
import { materializeUnitRecord, unitRecordFromCombatant } from './unit-state.js';
import { captureGeneration, namespaceOf, prepareNarrativeTransaction, proposalFromMessage, type NarrativeSave, type MessageEnvelope } from './narrative-state.js';
import { prepareInventoryState } from './inventory-state.js';
import { serializeEvent } from './protocol-syntax.js';
import { parseProtocol } from './protocol.js';

const reg=traitRegistry();
function setup(scale:'hero'|'company'='hero'):NarrativeSave {
  const unit=generateUnit({name:'试验队',side:'enemy',scale,rulesVersion:'v2',level:3,hp:scale==='hero'?60:50,hpMax:scale==='hero'?100:100,traits:[],weaponClass:'sword',weaponLevel:3,armorTier:1,armorLevel:3},{seed:'open-unit',registry:reg}).unit;
  unit.id='u1';
  return {storage:[unitRecordFromCombatant(unit)],rosterIds:['u1'],factRevision:1,storySync:true};
}
function transact(save:NarrativeSave,data:Record<string,unknown>,extra='',mid='set') {
  const source:MessageEnvelope={characterId:'c',chatId:'chat',branchId:'b',messageId:mid,swipeId:'0',generationId:mid,role:'assistant',complete:true,text:`<tb>\n${serializeEvent('unit_set',{id:'u1',data:JSON.stringify(data)})}\n${extra}\n</tb>`};
  const ns=namespaceOf(source),binding=captureGeneration(save,ns,mid);binding.complete=true;
  const proposal=proposalFromMessage(source,binding)!;
  return {next:()=>prepareNarrativeTransaction(save,proposal,ns),proposal,ns};
}
function restored(save:NarrativeSave) { return materializeUnitRecord(prepareInventoryState(JSON.parse(JSON.stringify(save))).storage![0]!,reg); }

describe('正文战外全字段事务（定向验证）',()=>{
  it('unit_set接受小数通道值和负强化，单通道赋值保留其他通道，非法负防护原子回滚',()=>{
    const save=setup(),before=structuredClone(save);
    const unit=restored(transact(save,{bonuses:{damage:-3},weapon:{spec:'步枪L3-2伤害',values:{penetration:2.5}},armor:{spec:'轻甲L3+1热能防护',values:{protection:{kinetic:1.5,thermal:2.2,arcane:0}}},skills:[{spec:{id:'bp-arcane-bolt',level:3},values:{penetration:1.5}}]}).next());
    expect(anchoredWeapon(unit.weapon)!.penetration).toBe(2.5);expect(anchoredProtection(unit,'kinetic')).toBe(1.5);expect(unit.abilities[0]!.penetration).toBe(1.5);expect(unit.bonuses?.damage).toBe(-3);
    const partial=restored(transact(save,{armor:{values:{protection:{kinetic:1.5}}}}).next());
    expect(partial.armor!.protection).toEqual({...save.storage![0]!.snapshot!.armor!.protection,kinetic:1.5});
    expect(()=>transact(save,{armor:{values:{protection:{kinetic:-1,thermal:0,arcane:0}}}}).next()).toThrow();
    expect(save).toEqual(before);
  });
  it('常用属性解析、明确死亡/复活、敌军XP绝对值与本级进度持久化',()=>{
    const parsed=parseProtocol('<tb><unit_set id="u1" xp="12.5" level="4" state="ready" hp="20"/></tb>');
    expect(parsed.errors).toEqual([]);expect(parsed.events[0]).toMatchObject({kind:'unit-set',data:{xp:12.5,level:4,status:'ready',hp:20}});
    const save=setup(),dead=transact(save,{status:'dead',retired:true}).next();
    expect(dead.storage![0]).toMatchObject({id:'u1',hp:0,status:'dead',retired:true});expect(dead.rosterIds).toEqual([]);
    const alive=transact(dead,{name:'复苏者',side:'enemy',status:'ready',hp:80,hpMax:120,level:4,xp:1234.5,xpProgress:80.25,base:{atk:9,def:15,spd:4},bonuses:{accuracy:10,damage:10},resources:{SP:2},fatigue:1},'<deploy id="u1"/>','revive').next();
    const unit=restored(alive);
    expect(unit).toMatchObject({id:'u1',status:'ready',hp:80,level:4,xp:1234.5,resources:{SP:2},fatigue:1,base:{hpMax:120,atk:9,def:15,spd:4}});
    expect(unit.bonuses).toEqual({accuracy:10,damage:10});
    expect(xpProgress(unit)?.current).toBe(80.25);expect(alive.storage![0]!.retired).toBeUndefined();expect(alive.rosterIds).toEqual(['u1']);
    expect(restored(transact(alive,{xp:0,bonuses:{}},'','reset').next()).xp).toBe(0);
    const dying=transact(alive,{status:'dying'},'','down').next();
    expect(restored(transact(dying,{xp:20},'','down-xp').next()).status).toBe('dying');
    expect(save.storage![0]!.hp).toBe(60);
  });
  it('装备库存与实际V4数值一致，定制技能入场后不被公式重建',()=>{
    const save=setup(),oldWeapon=save.storage![0]!.snapshot!.weapon!.id;
    const next=transact(save,{body:'vehicle',weapon:{spec:{kind:'weapon',mechanism:'rifle',power:6,bonuses:{damage:5}},values:{baseDice:'2d6',damageScale:2,penetration:25,range:2}},armor:{spec:'重甲L9',values:{protection:{kinetic:3,thermal:2,arcane:1},powerScale:2}},skills:[{spec:{id:'bp-arcane-bolt',name:'雷击',level:4},values:{cooldown:5,damageScale:3,penetration:17,effects:[{op:'damage',baseDice:'2d6'}]}}]}).next();
    const unit=restored(next);
    expect(unit.weapon!.id).toBe(oldWeapon);expect(unit.weapon!.recipe!.bonuses).toEqual({damage:5});
    expect(next.inventory!.find(i=>i.id===oldWeapon)!.mechanics).toMatchObject({kind:'weapon',value:{baseDice:'2d6',damageScale:2,range:2}});
    expect(anchoredWeapon(unit.weapon)).toMatchObject({baseDice:'2d6',damageScale:2,penetration:25,range:2});
    expect(anchoredProtection(unit,'kinetic')).toBe(3);expect(armorPowerScale(unit)).toBe(2);
    const skill=structuredClone(unit.abilities[0]);
    new SmallBattle({combatants:[unit],rules:V4_D20,seed:'open-unit-battle',traitRegistry:reg});
    expect(unit.abilities[0]).toEqual(skill);expect(unit.preparedAbilityIds).toEqual([skill!.id]);expect(unit.weapon!.range).toBe(2);
  });
  it('编队人数、成员伤势、资源和清除字段可以精确保存',()=>{
    const next=transact(setup('company'),{formation:{members:3,capacity:5,memberHp:100,health:[{hp:30,count:1},{hp:100,count:2}]},recoverableWounded:1,skills:[],conditions:[],weapon:null,armor:null,resources:{reserve:2}}).next();
    const unit=restored(next);
    expect(unit).toMatchObject({hp:3,base:{hpMax:5},formation:{members:3,capacity:5,memberHp:100,health:[{hp:30,count:1},{hp:100,count:2}]},recoverableWounded:1,resources:{reserve:2},abilities:[]});
    expect(unit.weapon).toBeUndefined();expect(unit.armor).toBeUndefined();expect(next.inventory!.every(i=>!i.equippedTo)).toBe(true);
  });
  it('保留生命、等级、单项强化上限，战内/过期/重放和混合坏批次均不能落库',()=>{
    const save=setup(),before=structuredClone(save);
    for(const patch of [{hpMax:1001},{level:11},{bonuses:{damage:11,accuracy:5}},{resources:{SP:999}},{id:'other'}])expect(()=>transact(save,patch).next()).toThrow();
    const tx=transact(save,{xp:25});
    expect(()=>prepareNarrativeTransaction({...save,battle:{kind:'small',snap:{seed:'active'}}},tx.proposal,tx.ns)).toThrow(/战内/);
    const next=tx.next();expect(()=>prepareNarrativeTransaction(next,tx.proposal,tx.ns)).toThrow(/过期|已经/);
    expect(()=>transact(save,{xp:25},'<deploy id="missing"/>').next()).toThrow();
    expect(()=>transact(save,{xp:25},'<unit_update id="u1" hp="50"/>').next()).toThrow(/多次更新/);
    expect(save).toEqual(before);
  });
});
