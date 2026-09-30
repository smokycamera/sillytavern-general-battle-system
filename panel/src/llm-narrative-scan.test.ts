import { afterEach, expect, it, vi } from 'vitest';
import { generateUnit } from '../../engine/src/index.js';
import { unitRecordFromCombatant } from './unit-state.js';
import { LlmNarrativeScanController, narrativeScanMessages } from './llm-narrative-scan.js';
import type { LlmSettings } from './llm-settings.js';

const settings: LlmSettings = { enabled: false, selectBattleScale: false, windowSize: 2, url: 'https://gateway.example/v1', token: 'private-key', model: 'scan-model', models: [] };
function input() {
  const unit = generateUnit({ name: '已有角色', side: 'ally', scale: 'hero', level: 3, traits: [] }, { seed: 'scan-existing' }).unit;
  return { save: { storage: [unitRecordFromCombatant(unit)], rosterIds: [] }, requirements: '补充敌方护卫，按正文选择等级', messages: [
    { id: 'old', role: 'assistant', text: '旧正文', completed: true }, { id: 'sys', role: 'system', text: '系统私有信息', completed: true },
    { id: 'user', role: 'user', text: '角色进入城堡。', completed: true }, { id: 'new', role: 'assistant', text: '<think>隐藏推理</think>门口有两名老练护卫。', completed: true },
    { id: 'stream', role: 'assistant', text: '尚未完成', completed: false },
  ] };
}
afterEach(() => vi.unstubAllGlobals());
it('扫描使用当前正文、玩家要求和内置等级锚定，返回事件文本且不写聊天', async () => {
  const source = input(), before = structuredClone(source);
  const request = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ choices: [{ message: { content: '<think><spawn name="错误"/></think><tb><spawn name="护卫" side="enemy" scale="hero" level="3"/></tb>' } }] })));
  const text = await new LlmNarrativeScanController(request).scan(source, settings, () => true);
  const payload = JSON.parse(String(request.mock.calls[0]![1]!.body)), data = JSON.parse(payload.messages[1].content);
  expect(data.正文.map((m: {text:string}) => m.text)).toEqual(['角色进入城堡。', '门口有两名老练护卫。']);
  expect(data.玩家要求).toBe(source.requirements); expect(data.当前资料).toContain('"id":"u1"');
  expect(payload.messages[0].content).toContain('<power_reference>'); expect(payload.messages[0].content).toContain('<unit_equipment_specs>');
  expect(payload.messages[0].content).toContain('skills、traits'); expect(payload.messages[0].content).toContain('<example situation="全部便捷属性格式示例');
  expect(payload.messages[0].content).not.toMatch(/确凿证据|有依据|有据可查/);
  expect(payload.response_format).toBeUndefined(); expect(JSON.stringify(payload)).not.toContain('private-key');
  expect(text).toContain('name="护卫"'); expect(text).not.toContain('错误'); expect(source).toEqual(before);
});
it('取消或档案改变后丢弃晚到的模型结果', async () => {
  let release!: (response: Response) => void;
  const controller = new LlmNarrativeScanController(async () => new Promise(resolve => { release = resolve; }));
  const pending = controller.scan(input(), settings, () => false);
  controller.cancel(); release(new Response(JSON.stringify({ choices: [{ message: { content: '<tb><spawn name="过期" side="enemy" scale="hero"/></tb>' } }] })));
  await expect(pending).rejects.toThrow(/取消|变化/);
});
