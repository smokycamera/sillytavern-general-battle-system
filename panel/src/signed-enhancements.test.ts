// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { equipmentDraft, equipmentFields, captureEquipment, equipmentSpecification } from './equipment-form.js';
import { parseItemSpecification, itemSpecificationLabel } from './item-spec.js';
import { parseProtocol } from './protocol.js';
import { captureGeneration, namespaceOf, prepareNarrativeTransaction, proposalFromMessage, type MessageEnvelope } from './narrative-state.js';
import { unitRecordFromCombatant, materializeUnitRecord } from './unit-state.js';
import { prepareCombatModel } from '../../engine/src/combat-model.js';
import { upgradeCombatSkills } from '../../engine/src/skill-upgrade.js';
import { V4_D20, traitRegistry } from '../../engine/src/index.js';

it('表单可编辑、清除及保存单通道正负值，无效输入不静默清除',()=>{
  const draft=equipmentDraft('armor');draft.bonuses={protection:-3,thermalProtection:5};
  document.body.innerHTML=equipmentFields('armor',draft);
  const input=document.querySelector<HTMLInputElement>('[data-role="armor-bonuses"]')!;
  expect(input.value).toBe('-3防护+5热能防护');input.value='+2动能防护-5奥术防护';
  expect(equipmentSpecification(captureEquipment('armor',draft)).bonuses).toEqual({kineticProtection:2,arcaneProtection:-5});
  input.value='3防护';expect(()=>captureEquipment('armor',draft)).toThrow();
  input.value='';expect(captureEquipment('armor',draft).bonuses).toEqual({});
});
it('物品种类识别与显示保留负值，配件不接受数值强化',()=>{
  for(const text of ['步枪L5-3伤害+5热能穿透','重甲L3-2防护+1动能防护','治疗L3-10治疗','盾牌L3-2防御']){
    const spec=parseItemSpecification(text);expect(parseItemSpecification(itemSpecificationLabel(spec))).toEqual(spec);
  }
  expect(()=>parseItemSpecification('守护护符L3-1')).toThrow();
});
it('正文建档、技能升级及保存读取完整保留负强化与小数人工防护',()=>{
  const parsed=parseProtocol('<tb><spawn name="signed" side="ally" scale="hero" level="L5-3生命+2热能伤害" weapon="步枪L5+1热能穿透-3伤害" armor="重甲L5-2防护+5热能防护" skills="火花:魔法单体热能L4-3伤害+1穿透"/></tb>');
  expect(parsed.errors).toEqual([]);
  const source:MessageEnvelope={characterId:'signed',chatId:'c',branchId:'b',messageId:'1',swipeId:'0',generationId:'g',role:'assistant',complete:true,text:parsed.canonical};
  const ns=namespaceOf(source),binding=captureGeneration({},ns,'g');binding.complete=true;
  const transaction=prepareNarrativeTransaction({},proposalFromMessage(source,binding)!,ns,true),registry=traitRegistry();
  const unit=materializeUnitRecord(transaction.storage![0]!,registry);prepareCombatModel(unit,V4_D20);upgradeCombatSkills(unit);
  unit.armor!.protectionOverride=true;unit.armor!.protection={kinetic:1.5,thermal:2.2,arcane:0};unit.abilities[0]!.penetration=2.5;
  const restored=materializeUnitRecord(unitRecordFromCombatant(unit),registry);
  expect(restored.bonuses).toEqual({health:-3,thermalDamage:2});
  expect(restored.weapon!.recipe!.bonuses).toEqual({thermalPenetration:1,damage:-3});
  expect(restored.armor!.protection).toEqual({kinetic:1.5,thermal:2.2,arcane:0});
  expect(restored.abilities[0]!.bonuses).toEqual({damage:-3,penetration:1});
  expect(restored.abilities[0]!.penetration).toBe(2.5);
});
