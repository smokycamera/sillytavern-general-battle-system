import { describe, expect, it } from 'vitest';
import { generateUnit, prepareCombatModel, prepareTraitModel, prepareItemModel, prepareTraitLevelModel,
  V17_OVERFLOW_D20, V17_OVERFLOW_TW, SmallBattle, MassBattle, standardField, tileCost, canOccupy, formationMarchCost,
  collectMods, resolveStack, standardConditionMap, traitRegistry, entrench, previewAttack, gridWeapon,
  healingEffectGroups, type Combatant,
} from '../src/index.js';
const defs=standardConditionMap(), reg=traitRegistry();
function unit(id:string,traits:string[]=[],L=5):Combatant {
  const u=generateUnit({name:id,side:id==='e'?'enemy':'ally',scale:'company',level:5,hpMax:50,rulesVersion:'v2',damageModel:'wounds-v2',traits,
    traitLevels:Object.fromEntries(traits.map(t=>[t,L])),weaponClass:'rifle',weaponLevel:5,armorTier:1,armorLevel:5},{seed:id,noVariance:true}).unit;
  u.id=id;prepareCombatModel(u,V17_OVERFLOW_D20);prepareTraitModel(u,V17_OVERFLOW_D20);prepareItemModel(u,V17_OVERFLOW_D20);prepareTraitLevelModel(u,V17_OVERFLOW_D20);return u;
}
describe('P2-C 实际组合边界',()=>{
  it('低级工兵只部分削减对方工事，真实护甲不动，同组防御重新取强',()=>{
    const defender=unit('d',['fortification']),attacker=unit('e',['siege-breaker'],1);defender.pos=0;entrench(defender,'small');
    const armor=JSON.stringify(defender.armor);
    const context={attacker:defender,defender:attacker,ranged:true};
    const mods=collectMods(defender,context,defs,[],reg);
    expect(mods.find(m=>m.sourceId==='fortification:def')?.value).toBe(3);
    expect(mods.find(m=>m.sourceId==='fortification:ward')?.value).toBeCloseTo(.76);
    const withBrace=[...mods,{source:'stance' as const,name:'其他固守',stackGroup:'posture:def',kind:'def' as const,type:'flat' as const,value:4}];
    expect(resolveStack(withBrace,'def',context).flatTotal).toBeGreaterThanOrEqual(4);
    expect(JSON.stringify(defender.armor)).toBe(armor);
    attacker.traitLevels!['siege-breaker']=5;
    expect(collectMods(defender,context,defs,[],reg).find(m=>m.sourceId==='fortification:ward')?.value).toBe(1);
  });
  it('身法和地形专精不叠乘，墙体仍禁止通过；会战减免进入行军成本',()=>{
    const a=unit('a',['agile','forest-lore'],1),field=standardField();field.tiles.fill('open');field.tiles[1]='forest';
    const both=tileCost(field,1,a);a.traits=['agile'];const agile=tileCost(field,1,a);a.traits=['forest-lore'];const lore=tileCost(field,1,a);
    expect(both).toBe(Math.min(agile,lore));a.traits=['agile'];a.traitLevels!['agile']=5;
    expect(tileCost(field,1,a)).toBe(1);field.tiles[1]='wall';expect(canOccupy(field,[a],a,1)).toBe(false);
    expect(formationMarchCost(a,['forest'])).toBe(1);a.traitLevels!['agile']=1;expect(formationMarchCost(a,['forest'])).toBeGreaterThan(1);
  });
  it.each(['small','mass'] as const)('%s散兵选择在正常激活锁定并随快照保留，加速不能重选',mode=>{
    const a=unit('a',['loose-formation'],1),e=unit('e');
    const b=mode==='small'?new SmallBattle({combatants:[a,e],rules:V17_OVERFLOW_D20,seed:'loose'}):new MassBattle({combatants:[a,e],rules:V17_OVERFLOW_TW,seed:'loose'});
    expect(b.chooseLooseFormation(a.id,'closed').ok).toBe(true);b.start();
    if(b instanceof SmallBattle)while(b.active?.id!==a.id)b.endTurn();
    expect(b.chooseLooseFormation(a.id,'loose').ok).toBe(true);a.conditions.push({id:'hasted',dur:2});
    expect(b.chooseLooseFormation(a.id,'closed').ok).toBe(false);
    const saved=JSON.parse(JSON.stringify(b.toSnapshot()));const restored=mode==='small'?SmallBattle.fromSnapshot(saved):MassBattle.fromSnapshot(saved);
    expect(restored.byId(a.id).looseFormationChoice).toBe('loose');expect(restored.chooseLooseFormation(a.id,'closed').ok).toBe(false);
  });
  it('射击专家只减明确掩护与移动惩罚，武器规格保持；同P治疗片段合并后兑现',()=>{
    const a=unit('a',['sharpshooter'],9),e=unit('e'),weapon=gridWeapon(a.weapon,true,a.armsModel),power=a.weapon!.level;
    const opts={attacker:a,defender:e,rules:V17_OVERFLOW_D20,conditionDefs:defs,traitRegistry:reg,weaponOverride:weapon,ranged:true,moved:true,distance:2,
      extraMods:[{source:'stance' as const,name:'移动',category:'movement' as const,kind:'atk' as const,type:'flat' as const,value:-2}],
      defenderMods:[{source:'stance' as const,name:'掩护',category:'cover' as const,kind:'def' as const,type:'flat' as const,value:2}]};
    const L9=previewAttack(opts);a.traitLevels!.sharpshooter=10;const L10=previewAttack(opts);
    expect(L10.attackScore!-L9.attackScore!).toBe(1);expect(a.weapon!.level).toBe(power);
    const ability={effects:[{op:'heal' as const,power:3,amount:.6},{op:'heal' as const,power:3,amount:.6},{op:'heal' as const,power:4,amount:.6}]};
    expect(healingEffectGroups(ability)).toEqual([{op:'heal',power:3,amount:1.2},{op:'heal',power:4,amount:.6}]);expect(ability.effects[0]!.amount).toBe(.6);
  });
});
