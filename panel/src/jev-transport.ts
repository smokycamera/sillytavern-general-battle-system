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
  for (let depth = 0; depth < 8; depth++) {
    try {
      if (candidate.SillyTavern?.getContext) return candidate;
      if (!candidate.parent || candidate.parent === candidate) return;
      candidate = candidate.parent;
    } catch { return; } // A cross-origin parent is not an authorized host channel.
  }
}

function hostHeaders(host: HostWindow): Record<string, string> {
  const headers = new Headers(host.SillyTavern?.getContext().getRequestHeaders?.());
  const csrf = headers.get('x-csrf-token');
  return { 'Content-Type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) };
}

export async function jevRequest(connection: JevConnection, url: string, init: RequestInit, request: typeof fetch): Promise<Response> {
  const host = findHost();
  const tauri = !!(host?.__TAURITAVERN__ || host?.__TAURI_RUNNING__);
  const mode = connection.transport ?? 'auto';
  const bridge = !connection.protocol || connection.protocol === 'bridge';
  const transport = mode === 'auto'
    ? connection.relayUrl?.trim() ? 'relay' : host && !bridge ? 'host' : 'direct'
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
  if (!host) throw new JevTransportError('未找到同源酒馆宿主，请从酒馆扩展入口打开面板，或选择自建转发');

  const headers = hostHeaders(host);
  if (tauri) {
    // TauriTavern has no generic /proxy/. Its custom OpenAI backend is supported.
    if (connection.protocol !== 'openai') {
      if (mode === 'auto') return request(url, { ...init, credentials: 'omit', redirect: 'error' });
      throw new JevTransportError('TauriTavern 暂无 TypeSafe 通用代理。请选择“自建转发”，运行插件附带的 npm run jev:relay；OpenAI 兼容协议可直接使用宿主转发');
    }
    const target = new URL(url);
    const models = target.pathname.endsWith('/models');
    if (!models && !target.pathname.endsWith('/chat/completions')) throw new JevTransportError('宿主转发不支持此模型端点');
    target.pathname = target.pathname.replace(/\/(?:models|chat\/completions)$/, '');
    const payload = models ? {} : JSON.parse(String(init.body));
    const body = {
      ...payload, chat_completion_source: 'custom', custom_api_format: 'openai_compat',
      // This branch uses only proxy_password, never the host's saved CUSTOM secret.
      custom_url: '', reverse_proxy: target.href.replace(/\/+$/, ''), proxy_password: connection.token.trim(),
      ...(models ? {} : { type: 'quiet', stream: false, custom_include_body: JSON.stringify(payload) }),
    };
    return host.fetch('/api/backends/chat-completions/' + (models ? 'status' : 'generate'), {
      method: 'POST', headers, body: JSON.stringify(body), signal: init.signal,
      credentials: 'same-origin', redirect: 'error',
    });
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
  if (response.status === 403 && /csrf/i.test(await response.clone().text()))
    throw new JevTransportError('酒馆会话校验已失效，请刷新酒馆页面后重试');
  return response;
}

export function jevNetworkError(connection: JevConnection): string {
  const host = findHost();
  if (connection.transport === 'relay' || (connection.transport !== 'direct' && connection.transport !== 'host' && connection.relayUrl?.trim()))
    return '无法连接自建转发，请确认转发程序已启动、地址正确，并已允许当前酒馆来源';
  if (host && (host.__TAURITAVERN__ || host.__TAURI_RUNNING__) && connection.protocol === 'typesafe')
    return 'TypeSafe 浏览器连接失败，可能是 CORS 或网络问题。TauriTavern 请使用“自建转发”：运行 npm run jev:relay，转发地址填 http://127.0.0.1:4318（须在运行酒馆的设备上启动）';
  return connection.transport === 'direct' || !host
    ? '无法直连模型服务，请检查网络与 CORS；服务不支持跨域时请选择宿主转发或自建转发'
    : '酒馆转发连接失败，请检查宿主网络与代理配置；本次没有自动重试模型请求';
}
