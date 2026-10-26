import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { captureGeneration, namespaceOf, prepareNarrativeTransaction, proposalFromMessage, type NarrativeSave, type MessageEnvelope } from '../panel/src/narrative-state.js';
import { narrativeProjection } from '../panel/src/narrative-controller.js';
import { serializeEvent } from '../panel/src/protocol-syntax.js';

/** 通过真实正文事务建立示例，导出实际投影；不手写模拟发送内容。 */
let save: NarrativeSave = { storage: [], factRevision: 1, storySync: true };
function apply(text: string, id: string) {
  const source: MessageEnvelope = { characterId: 'example', chatId: 'example', branchId: 'example', messageId: id, swipeId: '0', generationId: id, role: 'assistant', complete: true, text: `<tb>\n${text}\n</tb>` };
  const namespace = namespaceOf(source), binding = captureGeneration(save, namespace, id); binding.complete = true;
  const proposal = proposalFromMessage(source, binding)!; proposal.id = id;
  save = prepareNarrativeTransaction(save, proposal, namespace);
}
const spawn = '<spawn name="再生赤翼骑兵连" side="ally" scale="company" level="5" hp="80" hpMax="100" body="human" mount="true" speed="4" weapon="骑枪:长兵器L3" weapon2="军刀:剑L3" armor="板甲:重甲L3" shield="骑兵盾:中盾L3" skills="冲锋:物理单体L4+近战+突进L4,鼓舞:buffL3+攻击L3,治疗术:buffL3+治疗L3" traits="再生L5,统率L4,冲锋强化L3" items="治疗药水:buffL3+治疗L3×2,夜视镜:夜战专精L4" effects="风神赐福:buffL3+攻击L3+飞行L5" battles="2"/>';
apply(spawn, 'story-ai-example-spawn');
apply('<effect id="u1" effects="寒霜侵蚀:debuffL2+减速L2" rounds="3"/>', 'story-ai-example-frost');
const conditionEvent = serializeEvent('unit_set', { id: 'u1', data: JSON.stringify({ conditions: [...save.storage![0]!.conditions ?? [], { id: 'bleeding', dur: 3 }] }) });
apply(conditionEvent, 'story-ai-example-condition');
const directory = resolve('docs/examples/unified-effects-20261026'); mkdirSync(directory, { recursive: true });
const request = '描写再生赤翼骑兵连的装备、能力和当前状态。';
const story = narrativeProjection(save, request);
const storyEdit = narrativeProjection(save, '修改再生赤翼骑兵连的档案属性。');
const scan = narrativeProjection(save, '修改再生赤翼骑兵连的档案属性。', undefined, 'scan');
writeFileSync(resolve(directory, 'story-context.txt'), story + '\n');
writeFileSync(resolve(directory, 'story-edit-request-context.txt'), storyEdit + '\n');
writeFileSync(resolve(directory, 'secondary-scan-context.txt'), scan + '\n');
writeFileSync(resolve(directory, 'unit-record.json'), JSON.stringify(save.storage![0], null, 2) + '\n');
writeFileSync(resolve(directory, 'input-events.xml'), `<tb>\n${spawn}\n</tb>\n\n<tb>\n<effect id="u1" effects="寒霜侵蚀:debuffL2+减速L2" rounds="3"/>\n</tb>\n\n<tb>\n${conditionEvent}\n</tb>\n`);
console.log(JSON.stringify({ directory, storyChars: story.length, editRequestChars: storyEdit.length, secondaryScanChars: scan.length }));
