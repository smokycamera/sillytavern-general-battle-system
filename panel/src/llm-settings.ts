import { connectionUrl, type JevConnection } from './jev-connection.js';
import { normalizeWorldbookSelection, selectedWorldbookMessages, type WorldbookSelection } from './llm-worldbooks.js';

export interface LlmSettings {
  enabled: boolean;
  selectBattleScale: boolean;
  commandEnemy?: boolean;
  commandInterval?: 'round' | 'situation';
  commandThinking?: 'auto' | 'round' | 'off';
  commandThinkingOffParams?: string;
  /** Older records inherit defaults only for missing keys; explicit choices survive upgrades. */
  designMap?: boolean;
  selectVip?: boolean;
  worldbooks?: WorldbookSelection[];
  windowSize: number;
  url: string;
  token: string;
  model: string;
  models: string[];
}
export const LLM_SETTINGS_KEY = 'tb:llm:settings:v1';
export const COMMAND_THINKING_OFF_PARAMS = '{"thinking":{"type":"disabled"}}';
const defaults = (): LlmSettings => ({ enabled: false, selectBattleScale: false, commandEnemy: false, commandInterval: 'round', commandThinking: 'auto',
  commandThinkingOffParams: COMMAND_THINKING_OFF_PARAMS,
  designMap: true, selectVip: true, worldbooks: [], windowSize: 6, url: '', token: '', model: '', models: [] });

export function parseCommandParameters(text: string): Record<string, unknown> {
  if (text.length > 20000) throw Error('附加参数不能超过20000字');
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw Error('附加参数须为有效 JSON 对象；填写 {} 可不附加参数'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('附加参数须为 JSON 对象');
  const reserved = ['model', 'messages', 'stream', 'tools', 'tool_choice', 'parallel_tool_calls', 'response_format', '__proto__', 'constructor', 'prototype'];
  if (Object.keys(value).some(key => reserved.includes(key))) throw Error('附加参数不能覆盖模型、消息、工具或输出格式');
  return value as Record<string, unknown>;
}
export function commandParameterWarnings(parameters: Record<string, unknown>): string[] {
  const known = new Set(['thinking', 'reasoning', 'reasoning_effort', 'reasoning_budget', 'thinking_budget', 'enable_thinking',
    'budget_tokens', 'max_tokens', 'max_completion_tokens', 'temperature', 'top_p', 'top_k', 'min_p', 'presence_penalty', 'frequency_penalty', 'seed', 'stop', 'verbosity', 'extra_body']);
  const unknown = Object.keys(parameters).filter(key => !known.has(key));
  return unknown.length ? ['未识别参数：' + unknown.join('、') + '；已保存并原样发送，由供应商处理'] : [];
}
/** No vendor detection: only the selected, editable request-body parameters are sent. */
export function commandRequestOptions(settings: LlmSettings, thoughtThisRound = false): Record<string, unknown> {
  if (settings.commandThinking === 'off' || settings.commandThinking === 'round' && thoughtThisRound) return parseCommandParameters(settings.commandThinkingOffParams ?? COMMAND_THINKING_OFF_PARAMS);
  return {};
}

/** Origin-wide preferences. Never serialize these credentials into a chat or character. */
export function readLlmSettings(): LlmSettings {
  let storage: Storage;
  let raw: string | null;
  try { storage = localStorage; raw = storage.getItem(LLM_SETTINGS_KEY); }
  catch { throw Error('模型配置暂不可读取，请检查浏览器存储权限后重试；原配置未修改'); }
  if (raw) {
    try {
      const v = JSON.parse(raw);
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw Error('Invalid settings');
      return {
        enabled: v.enabled === true,
        selectBattleScale: false,
        commandEnemy: v.commandEnemy === true,
        commandInterval: v.commandInterval === 'situation' ? 'situation' : 'round',
        commandThinking: v.commandThinking === 'off' || v.commandThinking === 'round' ? v.commandThinking : 'auto',
        commandThinkingOffParams: typeof v.commandThinkingOffParams === 'string' ? v.commandThinkingOffParams : COMMAND_THINKING_OFF_PARAMS,
        designMap: v.designMap === undefined ? true : v.designMap === true,
        selectVip: v.selectVip === undefined ? true : v.selectVip === true,
        worldbooks: normalizeWorldbookSelection(v.worldbooks),
        windowSize: Number.isInteger(v.windowSize) && v.windowSize >= 1 && v.windowSize <= 100 ? v.windowSize : 6,
        url: typeof v.url === 'string' ? v.url : '', token: typeof v.token === 'string' ? v.token : '',
        model: typeof v.model === 'string' ? v.model : '',
        models: Array.isArray(v.models) ? [...new Set<string>(v.models.filter((m: unknown): m is string => typeof m === 'string' && !!m.trim()))] : [],
      };
    } catch { throw Error('模型配置读取失败；原记录已保留，请检查浏览器存储'); }
  }
  const settings = defaults();
  // Copy only a compatible previous connection, retaining the old keys for recovery.
  if (storage.getItem('tb:jev:protocol') === 'openai') {
    settings.url = storage.getItem('tb:jev:url') ?? '';
    settings.token = storage.getItem('tb:jev:token') ?? sessionStorage.getItem('tb:jev:token') ?? '';
    settings.model = storage.getItem('tb:jev:model') ?? '';
    if (settings.model) settings.models = [settings.model];
    saveLlmSettings(settings);
  }
  return settings;
}
/** Rendering may show an error; actions still use the strict reader above. */
export function llmSettingsView(): { settings: LlmSettings; error?: string } {
  try { return { settings: readLlmSettings() }; }
  catch (error) { return { settings: defaults(), error: error instanceof Error ? error.message : '模型配置读取失败；原记录已保留' }; }
}
export function saveLlmSettings(settings: LlmSettings): void {
  try { localStorage.setItem(LLM_SETTINGS_KEY, JSON.stringify(settings)); }
  catch { throw Error('模型配置未保存，请检查浏览器存储空间与权限'); }
}
export function llmSettingsBackup(): string { return localStorage.getItem(LLM_SETTINGS_KEY) ?? '{}'; }
export function resetLlmSettings(preserveConnection: boolean): void {
  const settings = defaults();
  if (preserveConnection) {
    let raw: Partial<LlmSettings>;
    try { raw = JSON.parse(llmSettingsBackup()); }
    catch { throw Error('原配置无法解析，不能保证保留连接；请先备份原配置，再选择清空配置'); }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('原配置无法解析，请先备份');
    for (const key of ['url', 'token', 'model'] as const) if (typeof raw[key] === 'string') settings[key] = raw[key];
    settings.models = Array.isArray(raw.models) ? raw.models.filter((m): m is string => typeof m === 'string') : [];
  }
  saveLlmSettings(settings);
}
export function llmConnection(settings: LlmSettings): JevConnection {
  if (!settings.url.trim()) throw Error('请先填写 API URL');
  const url = connectionUrl(settings.url);
  if (new URL(url).hostname.toLowerCase().replace(/\.$/, '') === 'api.typesafe.ai')
    throw Error('这里需要普通 LLM 的 OpenAI 兼容 API；JEV 指挥功能尚未完成');
  const selection = normalizeWorldbookSelection(settings.worldbooks);
  return { url, token: settings.token.trim(), model: settings.model.trim(), protocol: 'openai', transport: 'auto',
    ...(selection.length ? { contextMessages: (signal: AbortSignal) => selectedWorldbookMessages(selection, signal) } : {}) };
}
export function llmConnectionKey(settings: LlmSettings): string {
  return JSON.stringify([settings.url.trim(), settings.token.trim(), settings.model.trim(), normalizeWorldbookSelection(settings.worldbooks)]);
}
