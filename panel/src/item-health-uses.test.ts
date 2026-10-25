import { describe, expect, it } from 'vitest';
import { parseItemSpecification } from './item-spec.js';
import { createInventoryItem, prepareInventoryState, type InventorySave } from './inventory-state.js';
import { unitRecordFromCombatant, materializeUnitRecord } from './unit-state.js';
import { compileItem, generateUnit, prepareCombatModel, prepareTraitLevelModel, V36_OVERFLOW_D20, V35_OVERFLOW_D20,
  syncWornHealth, setMemberMaximum, memberHealth, applyXp, xpProgress, SmallBattle, standardField, gearItem, syncGearAbilities, traitRegistry, type Combatant } from '../../engine/src/index.js';
import { itemEffectRows, itemAbilitySummary } from './item-description.js';

function unit(company = false) {
  const u = generateUnit({ name: 'a', side: 'ally', scale: company ? 'company' : 'hero', hpMax: company ? 40 : 500,
    level: 5, rulesVersion: 'v2', damageModel: 'wounds-v2', traits: [], weaponClass: 'sword', armorTier: 0 }, { seed: 'life', noVariance: true }).unit;
  u.id = 'a'; prepareCombatModel(u,V36_OVERFLOW_D20); prepareTraitLevelModel(u,V36_OVERFLOW_D20);
  if (company) setMemberMaximum(u,100); return u;
}
describe('生命佩戴与充能次数', () => {
  it.each([false,true])('inventory equip/remove adjusts life and maxima without changing personnel (company=%s)', company => {
    const u = unit(company), beforeLife = memberHealth(u), initial = company ? u.formation!.memberHp : u.base.hpMax;
    const item = createInventoryItem('ring','生命戒指',parseItemSpecification('佩戴L5+10生命'),'ring');
    item.assignedTo = 'a'; item.equippedTo = { unitId:'a',slot:'gear' };
    const record = unitRecordFromCombatant(u); record.equipmentManaged = true;
    let state: InventorySave = { storage:[record],inventory:[item] };
    state = prepareInventoryState(state); let current = state.storage![0]!.snapshot!;
    expect(company ? current.formation!.memberHp : current.base.hpMax).toBe(Math.round(initial*1.67)); expect(memberHealth(current)).toBe(beforeLife + Math.round(initial*.67) * (company ? 40 : 1));
    for(let i=0;i<3;i++) {
      delete state.inventory![0]!.equippedTo; state = prepareInventoryState(state);
      expect(company ? state.storage![0]!.snapshot!.formation!.memberHp : state.storage![0]!.snapshot!.base.hpMax).toBe(initial);
      state.inventory![0]!.equippedTo = {unitId:'a',slot:'gear'}; state = prepareInventoryState(state);
    }
    current = state.storage![0]!.snapshot!; expect(memberHealth(current)).toBe(beforeLife + Math.round(initial*.67) * (company ? 40 : 1)); if(company)expect(current.hp).toBe(40);
    const copied = JSON.parse(JSON.stringify(current)) as Combatant; syncWornHealth(copied); expect(copied).toEqual(current);
    prepareTraitLevelModel(copied,V35_OVERFLOW_D20); expect(company ? copied.formation!.memberHp : copied.base.hpMax).toBe(initial);
    const m=item.mechanics!; if(m.kind!=='item')throw Error('fixture'); expect(itemEffectRows(m.value)[0]!.actual).toBe('+67%');
  });
  it('removing life gear preserves at least one life and never revives a dead unit', () => {
    const u = unit(), item=createInventoryItem('life','生命戒指',parseItemSpecification('佩戴L5+10生命'),'life');
    if(item.mechanics?.kind!=='item')throw Error('fixture');
    u.gear=[{id:'life',name:'生命戒指',load:0,recipe:item.mechanics.value.recipe,passive:item.mechanics.value.passive}];syncWornHealth(u);
    u.hp=10;delete u.gear;syncWornHealth(u);expect(u.hp).toBe(1);expect(u.base.hpMax).toBe(500);
    u.hp=0;u.status='dead';u.gear=[{id:'life',name:'生命戒指',load:0,recipe:item.mechanics.value.recipe,passive:item.mechanics.value.passive}];syncWornHealth(u);expect(u.hp).toBe(0);
  });
  it.each([[0,1],[2,3],[10,11],[-10,1]] as const)('charged area item %+i 次数 freezes %i uses', (points,uses) => {
    const m=compileItem(parseItemSpecification('充能魔法范围热能L5'+(points>=0?'+':'')+points+'次数'),{id:'wand',seed:'wand'});
    if(m.kind!=='item')throw Error('fixture'); expect(m.value.ability!.usesPerBattle).toBe(uses);
    expect(JSON.parse(JSON.stringify(m)).value.ability.usesPerBattle).toBe(uses);
  });
  it('only charged items accept uses; duration keeps modifying the granted effect', () => {
    expect(()=>parseItemSpecification('buff治疗L3+2次数')).toThrow();
    const m=compileItem(parseItemSpecification('充能buff夜战专精L5+2次数+5持续'),{id:'night',seed:'night'});
    if(m.kind!=='item')throw Error('fixture'); expect(m.value.ability!.usesPerBattle).toBe(4);
    expect(itemAbilitySummary(m.value.ability!)).toContain('每战4次');
    expect(m.value.ability!.effects.find(e=>e.op==='trait')).toMatchObject({op:'trait',dur:4});
  });
  it('shorthand charged items preserve uses and the battle refuses a fourth use after +1次数', () => {
    const a=unit(),d=unit();d.id='d';d.side='enemy';
    const m=compileItem(parseItemSpecification('充能治疗L3+1次数'),{id:'wand',seed:'wand'});if(m.kind!=='item')throw Error('fixture');
    expect(parseItemSpecification('充能法杖L5+2次数')).toMatchObject({form:'charged',bonuses:{uses:2}});
    a.gear=[gearItem('wand','治疗魔杖',m.value)];syncGearAbilities(a);
    expect(materializeUnitRecord(unitRecordFromCombatant(a),traitRegistry()).gear![0]!.ability!.usesPerBattle).toBe(3);
    const field=standardField();field.tiles.fill('open');const battle=new SmallBattle({combatants:[a,d],rules:V36_OVERFLOW_D20,battlefield:field,seed:'uses'});battle.start();
    a.pos=31;d.pos=24;battle.turnOrder=['a','d'];battle.turnIndex=0;
    for(let i=0;i<3;i++) {a.hp=10;const result=battle.useAbility(a.id,'equipment:wand',a.id);expect(result.ok,JSON.stringify(result)).toBe(true);for(let turn=0;turn<4;turn++)battle.endTurn();}
    a.hp=10;expect(battle.useAbility(a.id,'equipment:wand',a.id).ok).toBe(false);
    const snapshot=battle.toSnapshot();const restored=SmallBattle.fromSnapshot(structuredClone(snapshot));expect(restored.toSnapshot()).toEqual(snapshot);
  });
  it('level growth retains the health-item ratio, then removing it restores the grown base', () => {
    const a=unit();const m=compileItem(parseItemSpecification('佩戴L5+10生命'),{id:'ring',seed:'ring'});if(m.kind!=='item')throw Error('fixture');
    a.gear=[gearItem('ring','生命戒指',m.value)];syncWornHealth(a);
    const progress=xpProgress(a)!;applyXp(a,progress.next-progress.current);const equipped=a.base.hpMax;
    delete a.gear;syncWornHealth(a);expect(equipped).toBe(Math.round(a.base.hpMax*1.67));expect(a.hp).toBe(a.base.hpMax);
  });
});
