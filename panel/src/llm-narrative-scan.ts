import book from '../../assets/worldbook/!通用战斗系统约束.json';
import type { NarrativeMessage } from '../../vendor/jev-core/src/index.js';
import { narrativeProjection } from './narrative-controller.js';
import type { NarrativeSave } from './narrative-state.js';
import { protocolExcerpt } from './protocol.js';
import { stripThinking } from './protocol-syntax.js';
import { llmConnection, type LlmSettings } from './llm-settings.js';
import { openAiTextRequest } from './jev-connection.js';

export function narrativeScanMessages(input: { save: NarrativeSave; messages: NarrativeMessage[]; requirements?: string; rules?: string[] }, settings: LlmSettings) {
  const narrative = input.messages.filter(m => m.completed && ['user', 'assistant'].includes(m.role)).slice(-settings.windowSize)
    .map(m => ({ role: m.role, text: stripThinking(m.text).trim() })).filter(m => m.text);
  if (!narrative.length) throw Error('当前扫描范围没有已完成的正文，请调整扫描范围');
  const rules = (input.rules?.length ? input.rules : [book.entries['0'].content, book.entries['1'].content, book.entries['5'].content, book.entries['8'].content]).map(rule => {
    if (rule.includes('<battle_contract>')) { const at = rule.indexOf('## 输出契约'); if (at >= 0) rule = rule.slice(at).replace('</battle_contract>', ''); }
    return rule.split('\n').filter(line => !/未应用.*变化/.test(line)).join('\n')
      .replace(/且有依据的/g, '的').replace(/有依据的|有依据|确凿证据|有据可查/g, '').replace(/战外已确认环境改变时用field/g, 'field');
  });
  const settingsForFacts = { ...input.save, promptSettings: { sections: { reminder: { enabled: false } } } };
  return [
    { role: 'system', content: '根据正文内容重新生成参战双方单位及相关战外事件，使用以下内置世界书的格式规范和等级锚定。已有档案沿用当前资料中的编号，新单位使用spawn。只输出一个<tb>事件块。\n\n' + rules.join('\n\n') },
    { role: 'user', content: JSON.stringify({ 正文: narrative, 当前资料: narrativeProjection(settingsForFacts, '单位 技能 装备'), ...(input.requirements?.trim() ? { 玩家要求: input.requirements.trim() } : {}) }) },
  ];
}
export class LlmNarrativeScanController {
  private aborter?: AbortController;
  cancel(): void { this.aborter?.abort(); }
  constructor(private request: typeof fetch = (url, init) => fetch(url, init)) {}
  async scan(input: Parameters<typeof narrativeScanMessages>[0], settings: LlmSettings, valid: () => boolean): Promise<string> {
    this.cancel();
    const connection = llmConnection(settings), messages = narrativeScanMessages(input, settings);
    const aborter = new AbortController(); this.aborter = aborter;
    const timer = setTimeout(() => aborter.abort(), 120000);
    try {
      const response = await openAiTextRequest(connection, messages, aborter.signal, this.request);
      if (aborter.signal.aborted || !valid()) throw Error('扫描已取消或当前正文、聊天、档案发生变化，请重新扫描');
      const events = protocolExcerpt(response);
      if (!events) throw Error('模型没有生成事件标签，请重试或补充扫描要求');
      return events;
    } finally { clearTimeout(timer); if (this.aborter === aborter) this.aborter = undefined; }
  }
}
