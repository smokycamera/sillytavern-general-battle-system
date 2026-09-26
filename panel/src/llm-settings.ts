import { connectionUrl, type JevConnection } from './jev-connection.js';

export interface LlmSettings {
  enabled: boolean;
  windowSize: number;
  url: string;
  token: string;
  model: string;
  models: string[];
}
export const LLM_SETTINGS_KEY = 'tb:llm:settings:v1';
const defaults = (): LlmSettings => ({ enabled: false, windowSize: 6, url: '', token: '', model: '', models: [] });

/** Origin-wide preferences. Never serialize these credentials into a chat or character. */
export function readLlmSettings(): LlmSettings {
  const raw = localStorage.getItem(LLM_SETTINGS_KEY);
  if (raw) {
    try {
      const v = JSON.parse(raw);
      return {
        enabled: v.enabled === true,
        windowSize: Number.isInteger(v.windowSize) && v.windowSize >= 1 && v.windowSize <= 100 ? v.windowSize : 6,
        url: typeof v.url === 'string' ? v.url : '', token: typeof v.token === 'string' ? v.token : '',
        model: typeof v.model === 'string' ? v.model : '',
        models: Array.isArray(v.models) ? [...new Set<string>(v.models.filter((m: unknown): m is string => typeof m === 'string' && !!m.trim()))] : [],
      };
    } catch { throw Error('模型配置读取失败；原记录已保留，请检查浏览器存储'); }
  }
  const settings = defaults();
  // Copy only a compatible previous connection, retaining the old keys for recovery.
  if (localStorage.getItem('tb:jev:protocol') === 'openai') {
    settings.url = localStorage.getItem('tb:jev:url') ?? '';
    settings.token = localStorage.getItem('tb:jev:token') ?? sessionStorage.getItem('tb:jev:token') ?? '';
    settings.model = localStorage.getItem('tb:jev:model') ?? '';
    if (settings.model) settings.models = [settings.model];
    saveLlmSettings(settings);
  }
  return settings;
}
export function saveLlmSettings(settings: LlmSettings): void {
  try { localStorage.setItem(LLM_SETTINGS_KEY, JSON.stringify(settings)); }
  catch { throw Error('模型配置未保存，请检查浏览器存储空间与权限'); }
}
export function llmConnection(settings: LlmSettings): JevConnection {
  if (!settings.url.trim()) throw Error('请先填写 API URL');
  const url = connectionUrl(settings.url);
  if (new URL(url).hostname.toLowerCase().replace(/\.$/, '') === 'api.typesafe.ai')
    throw Error('这里需要普通 LLM 的 OpenAI 兼容 API；JEV 指挥功能尚未完成');
  return { url, token: settings.token.trim(), model: settings.model.trim(), protocol: 'openai', transport: 'auto' };
}
export function llmConnectionKey(settings: LlmSettings): string {
  return JSON.stringify([settings.url.trim(), settings.token.trim(), settings.model.trim()]);
}
