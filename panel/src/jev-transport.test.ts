import { afterEach, describe, expect, it, vi } from 'vitest';
import { directJevRequest, fetchJevModels, jevJsonRequest, readJevConnection, saveJevConnection, type JevConnection } from './jev-connection.js';
import { JevCommandController } from './jev-command.js';

const connection: JevConnection = { url: 'https://api.typesafe.ai/v1/systemone', protocol: 'typesafe', token: 'upstream-key', model: 'jev-latest' };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const models = () => json({ models: [{ name: 'jev-latest' }] });
const scores = () => json({ model: 'jev-latest', answers: { benefit_0: { type: 'score', score: 3, confidence: 1 }, risk_0: { type: 'noul', noul: 0 } } });
function host(request: typeof fetch, tauri = false) {
  const parent = {
    location: { href: 'http://localhost:8000/' }, fetch: request, __TAURI_RUNNING__: tauri,
    SillyTavern: { getContext: () => ({ getRequestHeaders: () => ({ 'X-CSRF-Token': 'csrf-test', Authorization: 'host-secret', 'X-Private': 'private' }) }) },
  };
  vi.stubGlobal('window', { parent });
  return parent;
}
afterEach(() => vi.unstubAllGlobals());
describe('JEV host and relay transport', () => {
  it('uses parent host proxy for discovery and decisions when browser direct fetch is blocked', async () => {
    const direct = vi.fn<typeof fetch>(async () => { throw new TypeError('CORS'); });
    let parent: ReturnType<typeof host>;
    const proxy = vi.fn<typeof fetch>(async function(this: unknown, url, init) {
      expect(this).toBe(parent);
      expect(init?.credentials).toBe('same-origin');
      expect(init?.redirect).toBe('error');
      const headers = new Headers(init?.headers);
      expect(headers.get('authorization')).toBe('Bearer upstream-key');
      expect(headers.get('x-csrf-token')).toBe('csrf-test');
      expect(headers.has('x-private')).toBe(false);
      if (String(url).endsWith('models')) return models();
      expect(JSON.parse(String(init?.body))).toMatchObject({ model: 'jev-latest' });
      return scores();
    });
    parent = host(proxy);
    const controller = new JevCommandController(direct);
    expect(await controller.test(connection)).toContain('1 个模型');
    expect(await directJevRequest(connection, 'evaluate', { candidates: [{ id: 'attack' }] }, new AbortController().signal, direct)).toMatchObject({ scores: { attack: 1 } });
    expect(proxy.mock.calls.map(([url]) => decodeURIComponent(String(url)))).toEqual(['/proxy/https://api.typesafe.ai/v1/models', '/proxy/https://api.typesafe.ai/v1/systemone']);
    expect(direct).not.toHaveBeenCalled();
  });
  it('reports disabled proxy and CSRF failures without retrying or exposing server response', async () => {
    const direct = vi.fn<typeof fetch>();
    host(async () => new Response('CORS proxy is disabled. upstream-key', { status: 404 }));
    await expect(fetchJevModels(connection, direct)).rejects.toThrow('enableCorsProxy: true');
    host(async () => new Response('Invalid CSRF token upstream-key', { status: 403 }));
    await expect(fetchJevModels(connection, direct)).rejects.toThrow('刷新酒馆');
    host(async () => json({ error: 'upstream-key' }, 401));
    await expect(fetchJevModels(connection, direct)).rejects.toThrow('HTTP 401');
    expect(direct).not.toHaveBeenCalled();
  });
  it('keeps upstream 404 distinct from a disabled host proxy', async () => {
    host(async () => json({ error: 'Endpoint not found' }, 404));
    await expect(fetchJevModels(connection)).rejects.toThrow('HTTP 404');
  });
  it('retains explicit direct mode without cookies or CSRF', async () => {
    const proxy = vi.fn<typeof fetch>(); host(proxy);
    const direct = vi.fn<typeof fetch>(async () => models());
    await fetchJevModels({ ...connection, transport: 'direct' }, direct);
    expect(proxy).not.toHaveBeenCalled();
    expect(direct.mock.calls[0]).toMatchObject(['https://api.typesafe.ai/v1/models', { credentials: 'omit', redirect: 'error' }]);
    expect(new Headers(direct.mock.calls[0]?.[1]?.headers).has('x-csrf-token')).toBe(false);
  });
  it('uses the configured private relay for both GET and POST, including non-Tauri auto migration', async () => {
    const proxy = vi.fn<typeof fetch>(); host(proxy, false);
    const relay = vi.fn<typeof fetch>(async url => String(url).endsWith('models') ? models() : scores());
    const c = { ...connection, relayUrl: 'http://127.0.0.1:4318/' };
    await fetchJevModels(c, relay);
    await directJevRequest(c, 'evaluate', { candidates: [{ id: 'attack' }] }, new AbortController().signal, relay);
    expect(relay.mock.calls.map(([url]) => decodeURIComponent(String(url)))).toEqual([
      'http://127.0.0.1:4318/proxy/https://api.typesafe.ai/v1/models',
      'http://127.0.0.1:4318/proxy/https://api.typesafe.ai/v1/systemone',
    ]);
    expect(relay.mock.calls.every(([, init]) => init?.credentials === 'omit')).toBe(true);
    expect(proxy).not.toHaveBeenCalled();
  });
  it('does not let a stale relay URL hijack Tauri auto mode', async () => {
    const proxy = vi.fn<typeof fetch>(async url => String(url).endsWith('/status') ? json({ data: [{ id: 'custom-model' }] }) : json({}));
    host(proxy, true);

    const typeSafeDirect = vi.fn<typeof fetch>(async url => {
      expect(String(url)).toBe('https://api.typesafe.ai/v1/models');
      return models();
    });
    await fetchJevModels({ ...connection, transport: 'auto', relayUrl: 'http://127.0.0.1:4318' }, typeSafeDirect);
    expect(typeSafeDirect).toHaveBeenCalledTimes(1);
    expect(proxy).not.toHaveBeenCalled();

    const openAiDirect = vi.fn<typeof fetch>();
    const openAi: JevConnection = {
      ...connection, protocol: 'openai', url: 'https://gateway.example/v1',
      model: 'custom-model', transport: 'auto', relayUrl: 'http://127.0.0.1:4318',
    };
    expect(await fetchJevModels(openAi, openAiDirect)).toEqual(['custom-model']);
    expect(proxy.mock.calls[0]?.[0]).toBe('/api/backends/chat-completions/status');
    expect(openAiDirect).not.toHaveBeenCalled();
  });
  it('uses Tauri custom backend for OpenAI models, context selection and decisions', async () => {
    const proxy = vi.fn<typeof fetch>(async url => String(url).endsWith('/status') ? json({ data: [{ id: 'custom-model' }] })
      : json({ model: 'custom-model', choices: [{ message: { content: '{"scores":{"attack":1},"confidence":1}' } }] }));
    host(proxy, true);
    const direct = vi.fn<typeof fetch>();
    const c: JevConnection = { ...connection, protocol: 'openai', model: 'custom-model', url: 'https://gateway.example/custom/v2/chat/completions' };
    expect(await fetchJevModels(c, direct)).toEqual(['custom-model']);
    for (const path of ['evaluate', 'select-context', 'context'])
      await directJevRequest(c, path, { candidates: [{ id: 'attack' }] }, new AbortController().signal, direct);
    expect(proxy.mock.calls[0]?.[0]).toBe('/api/backends/chat-completions/status');
    for (const [, init] of proxy.mock.calls) {
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({ chat_completion_source: 'custom', custom_api_format: 'openai_compat', custom_url: '', reverse_proxy: 'https://gateway.example/custom/v2', proxy_password: 'upstream-key' });
      expect(body.custom_include_headers).toBeUndefined();
      expect(new Headers(init?.headers).has('authorization')).toBe(false);
    }
    const body = JSON.parse(String(proxy.mock.calls[1]?.[1]?.body));
    expect(body).toMatchObject({ type: 'quiet', model: 'custom-model', stream: false });
    expect(JSON.parse(body.custom_include_body)).toMatchObject({ response_format: { type: 'json_object' }, messages: expect.any(Array) });
    expect(direct).not.toHaveBeenCalled();
  });
  it('prefers an ancestor Tauri host when the panel iframe also exposes SillyTavern', async () => {
    const proxy = vi.fn<typeof fetch>(async url => String(url).endsWith('/status') ? json({ data: [{ id: 'custom-model' }] }) : json({}));
    const parent = {
      location: { href: 'tauri://localhost/' }, fetch: proxy, __TAURITAVERN__: {},
      SillyTavern: { getContext: () => ({ getRequestHeaders: () => ({ 'X-CSRF-Token': 'csrf-parent' }) }) },
    };
    const iframeFetch = vi.fn<typeof fetch>();
    vi.stubGlobal('window', {
      location: { href: 'tauri://localhost/panel/' }, fetch: iframeFetch, parent,
      SillyTavern: { getContext: () => ({ getRequestHeaders: () => ({ 'X-CSRF-Token': 'csrf-iframe' }) }) },
    });
    const direct = vi.fn<typeof fetch>();
    const c: JevConnection = { ...connection, protocol: 'openai', model: 'custom-model', url: 'https://gateway.example/v1' };
    expect(await fetchJevModels(c, direct)).toEqual(['custom-model']);
    expect(proxy.mock.calls[0]?.[0]).toBe('/api/backends/chat-completions/status');
    expect(iframeFetch).not.toHaveBeenCalled();
    expect(direct).not.toHaveBeenCalled();
  });
  it('overrides a Tauri host saved key even when the plugin has no key', async () => {
    const proxy = vi.fn<typeof fetch>(async () => models()); host(proxy, true);
    await fetchJevModels({ ...connection, protocol: 'openai', url: 'https://gateway.example/v1', token: '' });
    expect(JSON.parse(String(proxy.mock.calls[0]?.[1]?.body))).toMatchObject({ custom_url: '', reverse_proxy: 'https://gateway.example/v1', proxy_password: '' });
  });
  it('gives actionable Tauri TypeSafe CORS help and never invents a host endpoint', async () => {
    const proxy = vi.fn<typeof fetch>(); host(proxy, true);
    await expect(fetchJevModels(connection, async () => { throw new TypeError('Failed to fetch'); })).rejects.toThrow('手机端不要运行 npm relay');
    await expect(fetchJevModels({ ...connection, transport: 'host' })).rejects.toThrow('TypeSafe 通用原生 HTTP 通道');
    expect(proxy).not.toHaveBeenCalled();
  });
  it('preserves legacy bridge defaults and routes explicitly selected relays for metadata and decisions', async () => {
    const proxy = vi.fn<typeof fetch>(); host(proxy);
    const direct = vi.fn<typeof fetch>(async () => json({ bridge: { protocol: 1 }, provider: 'jev' }));
    const bridge: JevConnection = { url: 'http://127.0.0.1:4317', token: 'bridge-token' };
    const controller = new JevCommandController(direct);
    await controller.test(bridge);
    expect(direct.mock.calls[0]?.[0]).toBe('http://127.0.0.1:4317/api/meta');
    await controller.test({ ...bridge, transport: 'relay', relayUrl: 'http://127.0.0.1:4318' });
    expect(decodeURIComponent(String(direct.mock.calls[1]?.[0]))).toBe('http://127.0.0.1:4318/proxy/http://127.0.0.1:4317/api/meta');
    expect(proxy).not.toHaveBeenCalled();
  });
  it('cancels before sending and passes the original abort signal through the host', async () => {
    const proxy = vi.fn<typeof fetch>(async (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })));
    host(proxy); const aborter = new AbortController();
    const pending = directJevRequest(connection, 'evaluate', { candidates: [] }, aborter.signal, vi.fn());
    const check = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    aborter.abort(); await check;
    expect(proxy.mock.calls[0]?.[1]?.signal).toBe(aborter.signal);
    await expect(directJevRequest(connection, 'evaluate', { candidates: [] }, aborter.signal, vi.fn())).rejects.toMatchObject({ name: 'AbortError' });
    expect(proxy).toHaveBeenCalledTimes(1);
  });
  it('handles HTTP-200 host errors and timeout separately without echoing secrets', async () => {
    await expect(fetchJevModels(connection, async () => json({ error: 'upstream-key' }))).rejects.toThrow('酒馆返回错误');
    const aborter = new AbortController(); aborter.abort(new DOMException('Timeout', 'TimeoutError'));
    await expect(jevJsonRequest(connection, vi.fn(), 'https://api.typesafe.ai/v1/models', { signal: aborter.signal })).rejects.toThrow('超时');
  });
  it('persists transport settings and API key locally while preserving rc.9 choices', () => {
    const local = new Map<string, string>([['tb:jev:url', connection.url], ['tb:jev:protocol', 'typesafe']]), session = new Map<string, string>();
    for (const [name, data] of [['localStorage', local], ['sessionStorage', session]] as const)
      vi.stubGlobal(name, { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) });
    expect(readJevConnection()).toMatchObject({ protocol: 'typesafe', url: connection.url });
    const c: JevConnection = { ...connection, transport: 'relay', relayUrl: 'http://127.0.0.1:4318' };
    saveJevConnection(c); expect(readJevConnection()).toEqual(c);
    expect(local.get('tb:jev:token')).toBe(connection.token);
    session.clear(); expect(readJevConnection().token).toBe(connection.token);
  });
  it.each(['http://public.example', 'https://key@relay.example', 'https://relay.example?key=test', 'file:///tmp/relay'])('rejects invalid relay %s before network access', async relayUrl => {
    const request = vi.fn<typeof fetch>();
    await expect(fetchJevModels({ ...connection, transport: 'relay', relayUrl }, request)).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
});
