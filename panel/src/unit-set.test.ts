import { describe, expect, it } from 'vitest';
import { generateUnit, traitRegistry, xpProgress, SmallBattle, V5_D20, activeConditionIds, activeTraitIds, traitLevel, traitSourceActive, grantTraitSource } from '../../engine/src/index.js';
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
  return transactText(save,`<tb>\n${serializeEvent('unit_set',{id:'u1',data:JSON.stringify(data)})}\n${extra}\n</tb>`,mid);
}
function transactText(save:NarrativeSave,text:string,mid='set') {
  const source:MessageEnvelope={characterId:'c',chatId:'chat',branchId:'b',messageId:mid,swipeId:'0',generationId:mid,role:'assistant',complete:true,text};
  const ns=namespaceOf(source),binding=captureGeneration(save,ns,mid);binding.complete=true;
  const proposal=proposalFromMessage(source,binding)!;
  return {next:()=>prepareNarrativeTransaction(save,proposal,ns),proposal,ns};
}
function restored(save:NarrativeSave) { return materializeUnitRecord(prepareInventoryState(JSON.parse(JSON.stringify(save))).storage![0]!,reg); }

it('明确写入武器护甲盾的负载均留下手工标记，包括恰好等于默认值', () => {
  const next = transact(setup(), { weapon: { values: { load: 1 } }, armor: { values: { load: 1 } }, shield: { spec: '盾L3', values: { load: 1.5 } } }).next();
  const unit = restored(next);
  expect(unit.weapon).toMatchObject({ load: 1, loadOverride: true });
  expect(unit.armor).toMatchObject({ load: 1, loadOverride: true });
  expect(unit.shield).toMatchObject({ load: 1.5, loadOverride: true });
});

describe('正文战外全字段事务（定向验证）',()=>{
  it('shield与旧shieldSpec都修改同一盾槽，speed便捷属性保留固有速度',()=>{
    const attrs={id:'u1',speed:'4',shield:'骑兵盾:中盾L3'};
    const parsed=parseProtocol(serializeEvent('unit_set',attrs));
    expect(parsed.errors).toEqual([]);
    expect(parsed.events[0]).toMatchObject({kind:'unit-set',data:{speedTier:4,shield:'骑兵盾:中盾L3'}});
    const next=transactText(setup(),serializeEvent('unit_set',attrs)).next();
    const old=transactText(setup(),serializeEvent('unit_set',{id:'u1',speed:'4',shieldSpec:attrs.shield})).next();
    expect(parseProtocol(serializeEvent('unit_set',{id:'u1',speed:'4',shieldSpec:attrs.shield})).events[0]).toMatchObject({data:(parsed.events[0] as Extract<typeof parsed.events[number],{kind:'unit-set'}>).data});
    for(const save of [next,old])expect(restored(save)).toMatchObject({speedTier:4,shield:{name:'骑兵盾',load:1.5,recipe:{mechanism:'shield',power:3}}});
  });
  it('unit_set可按中文状态名或id清除指定状态，all解除剧情来源但保留本体与生命',()=>{
    const save=transact(setup(),{conditions:[{id:'poisoned',dur:3},{id:'bleeding',dur:2},{id:'slowed',dur:2}],traits:['再生L5']},'<bless id="u1" name="祝福来源" traits="守护L5" battles="2"/>').next();
    const before=structuredClone(save),previous=restored(save);
    const next=transactText(save,'<unit_set id="u1" clear="中毒,bleeding"/>','clear-some').next(),unit=restored(next);
    expect(unit.conditions.map(condition=>condition.id)).toEqual(['slowed']);
    expect(unit.hp).toBe(previous.hp);expect(unit.traits).toEqual(previous.traits);expect(unit.traitSources).toEqual(previous.traitSources);
    for(const clear of ['all','全部']) {
      const cleared=restored(transactText(save,serializeEvent('unit_set',{id:'u1',clear}),'clear-all').next());
      expect(cleared.conditions).toEqual([]);expect(cleared.traits).toEqual(previous.traits);
      expect(cleared.traitSources!.every(source=>source.revoked)).toBe(true);
    }
    expect(restored(transactText(setup(),'<unit_update id="u1" hp="70"/>').next()).hp).toBe(70);
    expect(parseProtocol('<unit_set id="u1" clear="不存在的状态"/>').errors.length).toBeGreaterThan(0);
    expect(save).toEqual(before);
  });
  it('clear按名称同时解除普通状态、剧情状态和授予能力，保留同源其他效果、期限与旧授予重放',()=>{
    const save=transact(setup(),{conditions:[{id:'poisoned',dur:3},{id:'bleeding',dur:2}],traits:['再生L5']},'<affect id="u1" name="阴影侵蚀" effects="诅咒,士气低下" battles="2"/><bless id="u1" name="风灵赐福" traits="飞行L3,侦察L4" rounds="3"/>').next();
    const before=structuredClone(save),previous=restored(save);
    const next=transactText(save,'<unit_set id="u1" clear="中毒,诅咒,飞行"/>','clear-effects').next(),unit=restored(next);
    expect(activeConditionIds(unit)).toEqual(expect.arrayContaining(['bleeding','demoralized']));
    expect(activeConditionIds(unit)).not.toContain('poisoned');
    expect(activeConditionIds(unit)).not.toContain('cursed');
    expect(activeTraitIds(unit)).not.toContain('flying');expect(activeTraitIds(unit)).toContain('regen');expect(traitLevel(unit,'recon')).toBe(4);
    const active=unit.traitSources!.filter(source=>traitSourceActive(unit,source));
    expect(active.find(source=>source.kind==='effect')).toMatchObject({conditionIds:['demoralized'],remaining:2,duration:{kind:'battles',count:2}});
    expect(active.find(source=>source.kind==='blessing')).toMatchObject({traitIds:['recon'],traitLevels:{recon:4},remaining:3,duration:{kind:'rounds',count:3}});
    for(const source of previous.traitSources!) {
      expect(unit.traitSources!.find(current=>current.id===source.id)).toMatchObject({...source,revoked:true});
      grantTraitSource(unit,source);
    }
    expect(unit.traitSources!.filter(source=>traitSourceActive(unit,source))).toEqual(active);
    expect(activeConditionIds(unit)).not.toContain('cursed');expect(activeTraitIds(unit)).not.toContain('flying');
    const oldSource=previous.traitSources!.find(source=>source.kind==='effect')!;
    const legacy=restored(transactText(next,`<unaffect id="u1" source="${oldSource.id}"/>`,'legacy-remaining-source').next());
    expect(activeConditionIds(legacy)).not.toContain('demoralized');expect(activeTraitIds(legacy)).toContain('recon');
    expect(save).toEqual(before);
  });
  it('clear all解除正负剧情来源，永久本体与装备能力保留，旧解除事件仍兼容',()=>{
    const save=transact(setup(),{conditions:[{id:'hasted',dur:2},{id:'poisoned',dur:3}],traits:['飞行L5']},'<affect id="u1" effects="诅咒,鼓舞" permanent="true"/><bless id="u1" traits="飞行L3,侦察L4" battles="2"/><unit_set id="u1" items="夜视镜:夜战专精L5"/>').next();
    const unit=restored(transactText(save,'<unit_set id="u1" clear="all"/>','clear-all-sources').next());
    expect(activeConditionIds(unit)).toEqual([]);expect(unit.traitSources!.filter(source=>traitSourceActive(unit,source))).toEqual([]);
    expect(activeTraitIds(unit)).toEqual(expect.arrayContaining(['flying','night-fighter']));expect(traitLevel(unit,'flying')).toBe(5);
    const ids=restored(save).traitSources!.map(source=>source.id);
    const legacy=restored(transactText(save,`<unaffect id="u1" source="${ids[0]}"/><unbless id="u1" source="${ids[1]}"/>`,'legacy-clear-sources').next());
    expect(legacy.traitSources!.every(source=>source.revoked)).toBe(true);
  });
  it('enchant便捷属性修改当前实物并读档生效，none恢复武器默认通道且不改其他冻结属性',()=>{
    const save=prepareInventoryState(setup()), old=structuredClone(save.storage![0]!.snapshot!.weapon!);
    const next=transactText(save,'<unit_set id="u1" enchant="arcane"/>','enchant').next();
    const enchanted=restored(next).weapon!;
    expect(enchanted).toMatchObject({id:old.id,channel:'arcane',baseDice:old.baseDice,recipe:{seed:old.recipe!.seed,enchantment:'arcane'}});
    expect(next.inventory!.find(item=>item.id===old.id)!.mechanics).toMatchObject({kind:'weapon',value:{channel:'arcane'}});
    const cleared=restored(transactText(next,'<unit_set id="u1" enchant="none"/>','clear').next()).weapon!;
    expect(cleared.channel).toBe('kinetic');expect(cleared.recipe!.enchantment).toBeUndefined();expect(cleared.baseDice).toBe(old.baseDice);
    const energy=transactText(save,'<unit_set id="u1" weapon="光束枪:能量武器L3" enchant="none"/>','energy').next();
    expect(restored(energy).weapon!.channel).toBe('thermal');
    expect(save.storage![0]!.snapshot!.weapon).toEqual(old);
  });
  it('换装同时设置附魔、稳定器和防护侧重，主副武器与新单位建档均保留实际属性',()=>{
    const save=setup();
    const next=transactText(save,'<unit_set id="u1" body="vehicle" weapon="主枪:步枪L4" weapon2="副枪:步枪L3" armor="装甲:中甲L4" enchant="thermal" stabilized="true" protection="arcane"/>','configure').next();
    const unit=restored(next);
    for(const weapon of [unit.weapon!,unit.sidearm!])expect(weapon).toMatchObject({channel:'thermal',recipe:{enchantment:'thermal',stabilized:true}});
    expect(unit.armor!.recipe!.protectionProfile).toBe('arcane');expect(unit.armor!.protection?.arcane ?? 0).toBeGreaterThan(unit.armor!.protection?.kinetic ?? 0);
    const cleared=restored(transactText(next,'<unit_set id="u1" stabilized="false" protection="balanced"/>','clear-config').next());
    expect(cleared.weapon!.recipe!.stabilized).toBeUndefined();expect(cleared.weapon!.channel).toBe('thermal');expect(cleared.armor!.recipe!.protectionProfile).toBe('balanced');
    for(const tag of ['spawn name="新兵" side="ally" scale="hero"','unit_set id="u9" name="新兵" side="ally" scale="hero"']) {
      const added=transactText(save,`<${tag} weapon="步枪L3" enchant="arcane"/>`,tag.split(' ')[0]).next();
      const fresh=prepareInventoryState(JSON.parse(JSON.stringify(added))).storage!.find(record=>record.name==='新兵')!;
      expect(fresh.snapshot!.weapon).toMatchObject({channel:'arcane',recipe:{enchantment:'arcane'}});
    }
  });
  it('同批give换装后才应用enchant，原件身份和冻结属性保留；非法属性整批回滚',()=>{
    const save=prepareInventoryState(setup());
    save.inventory!.push({id:'spare',name:'备用剑',qty:1,lootType:'weapon',mechanics:structuredClone(save.inventory!.find(item=>item.mechanics?.kind==='weapon')!.mechanics)});
    const spare=save.inventory!.find(item=>item.id==='spare')!;
    if(spare.mechanics?.kind==='weapon'){spare.mechanics.value.id='spare';spare.mechanics.value.name='备用剑';}
    const before=structuredClone(save), next=transactText(save,'<give id="spare" to="u1"/><unit_set id="u1" weapon="备用剑" enchant="thermal"/>','give-enchant').next();
    expect(restored(next).weapon).toMatchObject({id:'spare',channel:'thermal',recipe:{seed:spare.mechanics!.value.recipe!.seed,enchantment:'thermal'}});
    expect(next.inventory!.filter(item=>item.name==='备用剑')).toHaveLength(1);
    for(const attrs of ['enchant="unknown"','protection="unknown"','stabilized="ture"'])expect(parseProtocol(`<unit_set id="u1" ${attrs}/>`).errors.length).toBeGreaterThan(0);
    expect(()=>transactText(save,'<unit_set id="u1" stabilized="true"/>','bad-stabilizer').next()).toThrow(/载具/);
    expect(save).toEqual(before);
  });
  it('已死亡编队可通过天生武器、负护甲强化和毒雾技能转化，持久化后保留零占手',()=>{
    const save=transact(setup('company'),{status:'dead'},'','death').next();
    const before=structuredClone(save);
    const text='<tb><unit_set id="u1" name="憎恶军团" side="ally" scale="company" level="2" hp="40" hpMax="40" state="ready" body="human" speed="2" weapon="腐骨利爪:天生武器L3+3伤害" armor="缝合尸甲:中甲L3+4强度-2防御" skills="腐毒撕扯:物理单体+近战+中毒L3,尸瘴喷涌:毒雾+中毒+减速L3+3持续" traits="不溃,毒击,恐惧" note="由覆灭的沼毒巫团转化而成，失去原有意志，保留腐毒残质" reason="将已确认死亡的沼毒巫团转化为憎恶军团"/></tb>';
    expect(parseProtocol(text).errors).toEqual([]);
    const next=transactText(save,text,'transform').next(),unit=restored(next);
    expect(unit).toMatchObject({name:'憎恶军团',side:'ally',scale:'company',level:2,hp:40,status:'ready',speedTier:2,base:{hpMax:40},weapon:{name:'腐骨利爪',hands:0,load:0,recipe:{mechanism:'natural',bonuses:{damage:3}}}});
    expect(unit.armor!.recipe!.bonuses).toMatchObject({power:4,defense:-2});
    expect(unit.abilities.map(a=>a.name)).toEqual(['腐毒撕扯','尸瘴喷涌']);
    expect(unit.abilities[1]!.bonuses).toMatchObject({duration:3});
    expect(unit.abilities[1]!.effects[0]).toMatchObject({op:'zone',kind:'poison',effects:expect.arrayContaining([{op:'condition',conditionId:'poisoned',dur:3,magnitude:expect.any(Number),saveDC:7,onDamage:true,shape:'burst'},expect.objectContaining({conditionId:'slowed'})])});
    expect(next.inventory!.find(i=>i.id===unit.weapon!.id)!.mechanics).toMatchObject({kind:'weapon',value:{hands:0}});
    expect(save).toEqual(before);
  });
  it.each([0,1,2])('主副武器接受引擎支持的占手值 %s',hands=>{
    const unit=restored(transact(setup(),{weapon:{values:{hands}},sidearm:{spec:'爪:天生武器L3',values:{hands}}}).next());
    expect(unit.weapon!.hands).toBe(hands);expect(unit.sidearm!.hands).toBe(hands);
  });
  it.each([-1,3,1.5,'0'])('无效占手值 %s 仍拒绝且不改存档',hands=>{
    const save=setup(),before=structuredClone(save);
    for(const slot of ['weapon','sidearm'])expect(()=>transact(save,{[slot]:{spec:'爪:天生武器L3',values:{hands}}}).next()).toThrow(/hands/);
    expect(save).toEqual(before);
  });
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
  it('装备库存与当前规则数值一致，旧耐久覆盖仅保留记录，定制技能入场后不被公式重建',()=>{
    const save=setup(),oldWeapon=save.storage![0]!.snapshot!.weapon!.id;
    const next=transact(save,{body:'vehicle',weapon:{spec:{kind:'weapon',mechanism:'rifle',power:6,bonuses:{damage:5}},values:{baseDice:'2d6',damageScale:2,penetration:25,range:2}},armor:{spec:'重甲L9',values:{protection:{kinetic:3,thermal:2,arcane:1},powerScale:2}},skills:[{spec:{id:'bp-arcane-bolt',name:'雷击',level:4},values:{cooldown:5,damageScale:3,penetration:17,effects:[{op:'damage',baseDice:'2d6'}]}}]}).next();
    const unit=restored(next);
    expect(unit.weapon!.id).toBe(oldWeapon);expect(unit.weapon!.recipe!.bonuses).toEqual({damage:5});
    expect(next.inventory!.find(i=>i.id===oldWeapon)!.mechanics).toMatchObject({kind:'weapon',value:{baseDice:'2d6',damageScale:2,range:2}});
    expect(anchoredWeapon(unit.weapon)).toMatchObject({baseDice:'2d6',damageScale:2,penetration:25,range:2});
    expect(anchoredProtection(unit,'kinetic')).toBe(3);expect(unit.armor!.powerScale).toBe(2);expect(armorPowerScale(unit)).toBe(1);
    const skill=structuredClone(unit.abilities[0]);
    new SmallBattle({combatants:[unit],rules:V5_D20,seed:'open-unit-battle',traitRegistry:reg});
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
    // 同批互补修改合法；显式冲突仍不能落库。
    expect(restored(transact(save,{xp:25},'<unit_update id="u1" hp="50"/>').next())).toMatchObject({ xp:25, hp:50 });
    expect(()=>transact(save,{hp:40},'<unit_update id="u1" hp="50"/>').next()).toThrow(/冲突/);
    expect(save).toEqual(before);
  });
});
