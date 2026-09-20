import { expect, it } from 'vitest';
import { generateUnit, traitRegistry } from '../../engine/src/index.js';
import { equipmentReason } from '../../engine/src/items.js';
import { captureGeneration, namespaceOf, prepareNarrativeTransaction, proposalFromMessage, type MessageEnvelope, type NarrativeSave } from './narrative-state.js';
import { materializeUnitRecord } from './unit-state.js';

it('用户的刘芮杞九单位事件完整建档，配装限制只在建档放宽', () => {
  const text = `<tb>
<spawn archetype="infantry" armor="轻甲L4" body="human" level="4" name="流民大军统帅刘芮杞" protection="kinetic" quality="2" scale="hero" side="ally" weapon="斩马刀:剑L6" weapon2="自卫短铳:火枪L3"/>
<spawn archetype="infantry" armor="轻甲L2" hpMax="400" level="2" name="民兵矛阵一营" quality="1" scale="company" side="ally" weapon="削尖长矛:长兵器L3"/>
<spawn archetype="infantry" armor="轻甲L2" hpMax="400" level="2" name="民兵矛阵二营" quality="1" scale="company" side="ally" weapon="削尖长矛:长兵器L3"/>
<spawn archetype="infantry" armor="轻甲L2" hpMax="400" level="2" name="民兵矛阵三营" quality="1" scale="company" side="ally" weapon="削尖长矛:长兵器L3"/>
<spawn archetype="infantry" armor="无甲L1" hpMax="180" level="3" name="猎户弩哨" quality="1" scale="company" side="ally" traits="射击专家,散兵" weapon="猎弩:弓弩L5"/>
<spawn archetype="infantry" armor="无甲L1" hpMax="90" level="2" name="配重投石机队" quality="2" scale="company" side="ally" traits="攻城工兵" weapon="改型配重投石机:火炮L3"/>
<spawn archetype="infantry" armor="无甲L1" hpMax="120" level="2" name="地道爆破队" quality="1" scale="company" side="ally" traits="攻城工兵" weapon="矿用火药桶:火枪L2"/>
<spawn archetype="infantry" armor="轻甲L3" hpMax="150" level="2" name="铁匠营械斗队" quality="1" scale="company" side="ally" traits="近战特化" weapon="修理重斧:斧L4"/>
<spawn archetype="infantry" armor="无甲L1" hpMax="800" level="1" name="南河滩疑兵营" quality="1" scale="company" side="ally" traits="潜伏" weapon="杂木棍棒:钝器L2"/>
<field env="siege" light="day"/>
</tb>`;
  const save: NarrativeSave = { schemaVersion: 2, storage: [], rosterIds: [], factRevision: 0 };
  const source: MessageEnvelope = { characterId: 'test', chatId: 'test', branchId: 'test', messageId: '1', swipeId: '0', role: 'assistant', complete: true, generationId: 'g', text };
  const ns = namespaceOf(source), binding = captureGeneration(save, ns, 'g'); binding.complete = true;
  const proposal = proposalFromMessage(source, binding)!; expect(proposal.status).toBe('pending');
  const next = prepareNarrativeTransaction(save, proposal, ns, true);
  expect(next.storage).toHaveLength(9); expect(next.field).toBe('siege');
  expect(next.storage!.filter((r) => r.scale === 'company').reduce((n, r) => n + r.hp, 0)).toBe(2540);
  const leader = materializeUnitRecord(next.storage![0]!, traitRegistry());
  expect(leader.sidearm).toMatchObject({ name: '自卫短铳', level: 3, recipe: { mechanism: 'firearm' } });
  const heavy = generateUnit({ name: '自由建档', scale: 'hero', side: 'ally', rulesVersion: 'v2', body: 'human', level: 3, traits: [], weaponClass: 'cannon', sidearmClass: 'cannon', armorTier: 4, shield: true, weaponStabilized: true }, { seed: 'registration-only' }).unit;
  expect(heavy.sidearm?.recipe?.mechanism).toBe('cannon'); expect(heavy.shield).toBeDefined();
  expect(equipmentReason(heavy)).toBeDefined(); // 通用换装/使用检查没有被删除。
});
