import { directJevRequest, fetchJevModels, JevConnectionError } from './jev-connection.js';
import { JevTransportError } from './jev-transport.js';
import { encounterRequest, applyEncounterSelection, normalizeContextSettings, ABILITY_LABELS, STYLE_PRESETS, encounterSummary, type EncounterSetup, type JevEncounterContext } from './jev-context.js';
import { llmConnection, type LlmSettings } from './llm-settings.js';
import type { Combatant } from '../../engine/src/index.js';
import type { CommanderProfiles, CommanderProfile } from '../../engine/src/commander-profile.js';
import type { NarrativeMessage, ContextSelectionAnswer } from '../../vendor/jev-core/src/index.js';

export interface LlmEncounterContext extends JevEncounterContext { commanders?: CommanderProfiles }
export function llmContextSummary(context: LlmEncounterContext): string {
  const commanders = Object.entries(context.commanders ?? {}).map(([side, p]) => `${side === 'ally' ? '我方' : '敌方'}指挥：${ABILITY_LABELS[p!.ability]} · ${STYLE_PRESETS[p!.style].label}`);
  return [...commanders, encounterSummary(context).split('；').slice(1).join('；')].filter(Boolean).join('；');
}
export class LlmContextController {
  private aborter?: AbortController;
  busy = false;
  constructor(private request: typeof fetch = (url, init) => fetch(url, init)) {}
  cancel(): void { this.aborter?.abort(); }
  async models(settings: LlmSettings): Promise<string[]> {
    try { return await fetchJevModels(llmConnection(settings), this.request); }
    catch (error) { throw Error(llmFailure(error)); }
  }
  async select(input: { roster: Combatant[]; setup: EncounterSetup; messages: NarrativeMessage[] }, settings: LlmSettings, valid: () => boolean): Promise<LlmEncounterContext> {
    if (this.busy) throw Error('正在读取上下文，请稍候');
    const connection = llmConnection(settings);
    if (!connection.model) throw Error('请先拉取并选择模型，或填写模型 ID');
    // One layer = one completed user/assistant message, in the host's chronological order.
    const messages = input.messages.map(m => ({ ...m, text: m.text.replace(/<(think|analysis|reasoning)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, '').trim() }));
    const contextInput = { ...input, messages, settings: normalizeContextSettings(), windowSize: settings.windowSize, roles: ['user', 'assistant'], phase: 'preparation' as const };
    const { base, request } = encounterRequest(contextInput);
    if (!request) return { ...base, detail: '所选范围没有可读取的已完成正文，沿用准备设置' };
    request.fields = request.fields.filter(f => f.id !== 'enemy_ability' && !f.id.startsWith('style_'));
    for (const side of ['ally', 'enemy']) {
      const who = side === 'ally' ? '我方实际指挥官（主控不一定是指挥官）' : '敌方实际指挥官';
      request.fields.push({ id: side + '_ability', question: `根据正文判断${who}的指挥经验与协同能力，不能用战斗等级、人数或胜负代替。`, options: { unknown: '没有明确依据，沿用原有自动决策', ...ABILITY_LABELS } });
      request.fields.push({ id: side + '_style', question: `根据明确设定或反复体现的倾向，选择${who}的指挥风格。`, options: { unknown: '没有明确依据，沿用原有自动决策', ...Object.fromEntries(Object.entries(STYLE_PRESETS).map(([k, v]) => [k, v.label])) } });
    }
    const aborter = new AbortController(); this.aborter = aborter; this.busy = true;
    const timer = setTimeout(() => aborter.abort(), 45000);
    const check = () => { if (aborter.signal.aborted || !valid()) throw Error('上下文读取已取消或准备信息已变化，尚未开始战斗'); };
    try {
      check();
      const answer = await directJevRequest(connection, 'select-context', request, aborter.signal, this.request) as ContextSelectionAnswer;
      check();
      // Validate before inspecting/filtering; incomplete or invented choices fail closed.
      const result: LlmEncounterContext = applyEncounterSelection(contextInput, base, request, answer);
      const conservative = structuredClone(answer);
      for (const selection of Object.values(conservative.selections)) if (selection.confidence < .6) selection.value = 'unknown';
      Object.assign(result, applyEncounterSelection(contextInput, base, request, conservative));
      result.commanders = {};
      for (const side of ['ally', 'enemy'] as const) {
        const ability = conservative.selections[side + '_ability']!.value;
        const style = conservative.selections[side + '_style']!.value;
        if (ability !== 'unknown' || style !== 'unknown') result.commanders[side] = { ability: ability === 'unknown' ? 'skilled' : ability, style: style === 'unknown' ? 'balanced' : style } as CommanderProfile;
      }
      if (result.commanders.enemy) result.enemy = { ability: result.commanders.enemy.ability, style: { ...STYLE_PRESETS[result.commanders.enemy.style].style }, source: 'context' };
      return result;
    } catch (error) {
      check();
      const detail = llmFailure(error);
      throw Error(`上下文读取失败：${detail}。尚未开战，可重试或在设置中改为手动配置。`);
    } finally { clearTimeout(timer); this.busy = false; if (this.aborter === aborter) this.aborter = undefined; }
  }
}
function llmFailure(error: unknown): string {
  if (!(error instanceof JevConnectionError || error instanceof JevTransportError)) return error instanceof Error && /请先填写 API|普通 LLM/.test(error.message) ? error.message : '模型请求或返回格式无效';
  if (/转发|CORS|跨域/.test(error.message)) return '模型服务连接失败，请检查 API URL、网络及服务是否允许当前酒馆访问';
  return error.message;
}
