import type { JevConnection } from './jev-connection.js';

export type JevTransport = 'auto' | 'host' | 'relay' | 'direct';
export class JevTransportError extends Error {}

interface HostWindow {
  parent?: HostWindow;
  location: { href: string };
  fetch: typeof fetch;
  SillyTavern?: { getContext(): { getRequestHeaders?(): Record<string, string> } };
  __TAURITAVERN__?: unknown;
  __TAURI_RUNNING__?: boolean;
}

/** Use the owning host window, including its Tauri fetch interceptor, not iframe fetch. */
function findHost(): HostWindow | undefined {
  if (typeof window === 'undefined') return;
  let candidate = window as unknown as HostWindow;
  let fallback: HostWindow | undefined;
  for (let depth = 0; depth < 8; depth++) {
    try {
      // A same-origin panel iframe may expose SillyTavern itself while the Tauri ABI
      // exists only on an ancestor. Prefer the Tauri owner instead of stopping early.
      if (candidate.__TAURITAVERN__ || candidate.__TAURI_RUNNING__) return candidate;
      if (!fallback && candidate.SillyTavern?.getContext) fallback = candidate;
      if (!candidate.parent || candidate.parent === candidate) return fallback;
      candidate = candidate.parent;
    } catch { return fallback; } // A cross-origin parent is not an authorized host channel.
  }
  return fallback;
}

function hostHeaders(host: HostWindow): Record<string, string> {
  const headers = new Headers(host.SillyTavern?.getContext().getRequestHeaders?.());
  const csrf = headers.get('x-csrf-token');
  return { 'Content-Type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) };
}

async function checkHostSession(response: Response): Promise<void> {
  if (response.status === 403 && /csrf/i.test(await response.clone().text()))
    throw new JevTransportError('酒馆会话校验已失效，请刷新酒馆页面后重试');
}

export async function jevRequest(connection: JevConnection, url: string, init: RequestInit, request: typeof fetch): Promise<Response> {
  const host = findHost();
  const tauri = !!(host?.__TAURITAVERN__ || host?.__TAURI_RUNNING__);
  const mode = connection.transport ?? 'auto';
  const bridge = !connection.protocol || connection.protocol === 'bridge';
  const transport = mode === 'auto'
    ? tauri
      ? connection.protocol === 'openai' ? 'host' : 'direct'
      : connection.relayUrl?.trim() ? 'relay' : host && !bridge ? 'host' : 'direct'
    : mode;
  init.signal?.throwIfAborted();

  if (transport === 'relay') {
    if (!connection.relayUrl?.trim()) throw new JevTransportError('请填写你自己运行的转发地址，例如 http://127.0.0.1:4318');
    const relay = new URL(connection.relayUrl);
    if (!['http:', 'https:'].includes(relay.protocol) || relay.username || relay.password || relay.search || relay.hash ||
      (relay.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(relay.hostname)))
      throw new JevTransportError('转发地址须为 HTTPS 或本机 HTTP 地址，不能包含密钥、查询参数或片段');
    return request(relay.href.replace(/\/+$/, '') + '/proxy/' + encodeURIComponent(url), {
      ...init, credentials: 'omit', redirect: 'error',
    });
  }
  if (transport === 'direct') return request(url, { ...init, credentials: 'omit', redirect: 'error' });
  if (!host) throw new JevTransportError('未找到同源酒馆，请从酒馆扩展入口打开面板，或选择自建转发');

  const headers = hostHeaders(host);
  if (connection.protocol === 'openai') {
    // Both hosts expose these native routes, but accept different custom API credentials.
    // Ordinary LLM requests must not depend on ST's optional /proxy/ middleware.
    const target = new URL(url);
    const models = target.pathname.endsWith('/models');
    if (!models && !target.pathname.endsWith('/chat/completions')) throw new JevTransportError('酒馆转发不支持此模型端点');
    target.pathname = target.pathname.replace(/\/(?:models|chat\/completions)$/, '');
    const payload = models ? {} : JSON.parse(String(init.body));
    const baseUrl = target.href.replace(/\/+$/, '');
    const body = {
      ...payload, chat_completion_source: 'custom', custom_api_format: 'openai_compat',
      ...(tauri
        // TT uses only proxy_password when reverse_proxy is present.
        ? { custom_url: '', reverse_proxy: baseUrl, proxy_password: connection.token.trim() }
        // ST's custom route ignores proxy_password. Explicitly override its saved CUSTOM
        // Authorization even with no plugin key, so a host credential cannot reach this URL.
        : { custom_url: baseUrl, custom_include_headers: JSON.stringify({ Authorization: connection.token.trim() ? 'Bearer ' + connection.token.trim() : '' }) }),
      ...(models ? {} : { type: 'quiet', stream: false, custom_include_body: JSON.stringify(payload) }),
    };
    const response = await host.fetch('/api/backends/chat-completions/' + (models ? 'status' : 'generate'), {
      method: 'POST', headers, body: JSON.stringify(body), signal: init.signal,
      credentials: 'same-origin', redirect: 'error',
    });
    await checkHostSession(response);
    if (response.status === 404 && /Cannot POST \/api\/backends\/chat-completions\/(?:status|generate)\b/i.test(await response.clone().text()))
      throw new JevTransportError('当前酒馆缺少模型后端接口，请更新 SillyTavern / TauriTavern 后刷新页面重试');
    return response;
  }
  if (tauri) {
    if (mode === 'auto') return request(url, { ...init, credentials: 'omit', redirect: 'error' });
    throw new JevTransportError('TauriTavern 当前没有可供扩展调用的 TypeSafe 通用原生 HTTP 通道。手机端不要运行 npm relay；OpenAI 兼容接口会自动走 TT 原生后端，TypeSafe 请使用支持 CORS 的服务或外部 HTTPS 转发');
  }

  // The host strips its cookie/CSRF headers before forwarding to the provider.
  new Headers(init.headers).forEach((value, key) => { headers[key] = value; });
  const response = await host.fetch('/proxy/' + encodeURIComponent(url), {
    ...init, headers, credentials: 'same-origin', redirect: 'error',
  });
  if (response.status === 404) {
    const text = await response.clone().text();
    if (/CORS proxy is disabled|Cannot (GET|POST) \/proxy\//i.test(text))
      throw new JevTransportError('酒馆转发未开启：在 SillyTavern 的 config.yaml 设置 enableCorsProxy: true 后重启；也可选择“自建转发”');
  }
  await checkHostSession(response);
  return response;
}

export function jevNetworkError(connection: JevConnection): string {
  const host = findHost();
  const tauri = !!(host?.__TAURITAVERN__ || host?.__TAURI_RUNNING__);
  const mode = connection.transport ?? 'auto';
  if (mode === 'relay' || (!tauri && mode === 'auto' && connection.relayUrl?.trim()))
    return '无法连接自建转发，请确认转发程序已启动、地址正确，并已允许当前酒馆来源';
  if (host && (host.__TAURITAVERN__ || host.__TAURI_RUNNING__) && connection.protocol === 'typesafe')
    return 'TypeSafe 浏览器连接失败，可能是 CORS 或网络问题。TauriTavern 当前没有可供扩展调用的 TypeSafe 通用原生 HTTP 通道；手机端不要运行 npm relay。OpenAI 兼容接口会自动走 TT 原生后端；TypeSafe 需服务端允许 CORS 或使用外部 HTTPS 转发';
  if (host && mode !== 'direct' && connection.protocol === 'openai')
    return '无法连接酒馆模型后端，请检查酒馆是否在线及其网络、代理配置';
  return connection.transport === 'direct' || !host
    ? '无法直连模型服务，请检查网络与 CORS；服务不支持跨域时请选择酒馆转发或自建转发'
    : '酒馆转发连接失败，请检查酒馆网络与代理配置';
}
