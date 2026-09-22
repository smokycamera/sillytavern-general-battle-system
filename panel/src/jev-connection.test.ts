import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiEndpoint, directJevRequest, fetchJevModels, jevJsonRequest, JEV_API_URL, readJevConnection, saveJevConnection, type JevConnection } from './jev-connection.js';
import { JevCommandController } from './jev-command.js';

const connection: JevConnection = { protocol: 'typesafe', url: JEV_API_URL, token: 'test-key', model: 'jev-preview' };
const response = (body: unknown) => new Response(JSON.stringify(body));
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('protocol matching and backend HTTP diagnostics', () => {
  it.each(['typesafe', 'openai'] as const)('continues to support third-party %s services regardless of model name', async protocol => {
    const c = { ...connection, url: 'https://gateway.example/custom/v2/models/', protocol, model: 'jev-latest' };
    const request = vi.fn<typeof fetch>(async () => response({ models: ['jev-latest'] }));
    expect(await fetchJevModels(c, request)).toEqual(['jev-latest']);
    expect(request.mock.calls[0]?.[0]).toBe('https://gateway.example/custom/v2/models');
  });
  it('rejects the official TypeSafe URL in OpenAI mode before a misleading successful model listing', async () => {
    const request = vi.fn<typeof fetch>(async () => response({ models: ['jev-latest'] }));
    await expect(fetchJevModels({ ...connection, protocol: 'openai' }, request)).rejects.toThrow('TypeSafe / JEV API');
    expect(request).not.toHaveBeenCalled();
  });
  it('does not save a mismatched official connection or its key', () => {
    const local = vi.fn(), session = vi.fn();
    vi.stubGlobal('localStorage', { setItem: local });
    vi.stubGlobal('sessionStorage', { setItem: session });
    expect(() => saveJevConnection({ ...connection, protocol: 'openai' })).toThrow('/systemone');
    expect(local).not.toHaveBeenCalled();
    expect(session).not.toHaveBeenCalled();
  });
  it.each([200, 500, 502])('preserves the upstream 404 wrapped in host HTTP %s without echoing remote content', async status => {
    const c: JevConnection = { ...connection, url: 'https://gateway.example/v1', protocol: 'openai' };
    const request: typeof fetch = async () => new Response(JSON.stringify({ error: {
      message: 'Failed to generate chat completion: Internal error: Custom OpenAI endpoint failed with status 404: {"detail":"Not Found","secret":"test-key"}',
    } }), { status });
    const error = await jevJsonRequest(c, request, apiEndpoint(c, 'chat/completions'), {}).catch(e => e as Error);
    expect(error.message).toContain('HTTP 404');
    expect(error.message).toContain('/chat/completions');
    expect(error.message).not.toMatch(/test-key|Not Found|secret/);
  });
  it('keeps a plain non-JSON HTTP failure actionable', async () => {
    await expect(fetchJevModels(connection, async () => new Response('private-response-body', { status: 404 })))
      .rejects.toThrow('HTTP 404');
  });
});
describe('remote JEV connections', () => {
  it.each(['https://api.typesafe.ai', JEV_API_URL + '/', JEV_API_URL + '/models', JEV_API_URL + '/systemone'])('normalizes %s without duplicating API suffixes', url => {
    expect(apiEndpoint({ ...connection, url }, 'models')).toBe(JEV_API_URL + '/models');
    expect(apiEndpoint({ ...connection, url }, 'systemone')).toBe(JEV_API_URL + '/systemone');
  });
  it('preserves custom prefixes and accepts a full chat endpoint', () => {
    expect(apiEndpoint({ ...connection, url: 'https://gateway.example/custom/v2/chat/completions' }, 'models')).toBe('https://gateway.example/custom/v2/models');
  });
  it.each([{ models: [{ name: 'jev-latest' }, { name: 'jev-preview' }] }, { data: [{ id: 'jev-latest' }, { id: 'jev-preview' }, { id: 'jev-latest' }] }, ['jev-latest', 'jev-preview']])('loads and deduplicates supported model lists', async body => {
    const request = vi.fn<typeof fetch>(async () => response(body));
    expect(await fetchJevModels(connection, request)).toEqual(['jev-latest', 'jev-preview']);
    expect(request.mock.calls[0]?.[0]).toBe(JEV_API_URL + '/models');
    expect(request.mock.calls[0]?.[1]).toMatchObject({ headers: { Authorization: 'Bearer test-key' }, credentials: 'omit', redirect: 'error' });
  });
  it('reports auth, malformed lists and CORS failures without exposing response secrets', async () => {
    await expect(fetchJevModels(connection, async () => new Response('test-key', { status: 401 }))).rejects.toThrow('HTTP 401');
    await expect(fetchJevModels(connection, async () => response({ data: [] }))).rejects.toThrow('未返回可用模型');
    await expect(fetchJevModels(connection, async () => response({ nope: [] }))).rejects.toThrow('格式无效');
    await expect(fetchJevModels(connection, async () => { throw new TypeError('Failed to fetch'); })).rejects.toThrow('CORS');
  });
  it('defaults to official API while preserving existing bridge connections', () => {
    const local = new Map<string, string>(), session = new Map<string, string>();
    for (const [name, data] of [['localStorage', local], ['sessionStorage', session]] as const)
      vi.stubGlobal(name, { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) });
    expect(readJevConnection()).toMatchObject({ url: JEV_API_URL, protocol: 'typesafe', model: 'jev-latest' });
    local.set('tb:jev:url', 'http://127.0.0.1:4317');
    expect(readJevConnection().protocol).toBe('bridge');
    saveJevConnection(connection);
    expect(readJevConnection()).toEqual(connection);
    expect([...local.values()]).not.toContain('test-key');
    session.clear();
    expect(readJevConnection().token).toBe('');
  });
  it('sends the selected TypeSafe model, typed scoring questions and API key', async () => {
    const request = vi.fn<typeof fetch>(async () => response({ model: 'jev-version', answers: {
      benefit_0: { type: 'score', score: 3, confidence: 0.9 }, risk_0: { type: 'noul', noul: 0.5 },
    } }));
    const result = await directJevRequest(connection, 'evaluate', { candidates: [{ id: 'attack' }] }, new AbortController().signal, request);
    expect(result).toEqual({ model: 'jev-version', scores: { attack: 0.9 }, confidence: 0.9 });
    const [url, init] = request.mock.calls[0]!;
    expect(url).toBe(JEV_API_URL + '/systemone');
    expect(JSON.parse(String(init?.body))).toMatchObject({ model: 'jev-preview', questions: { benefit_0: { type: 'score' }, risk_0: { type: 'noul' } } });
  });
  it('maps context choices and rejects invented options', async () => {
    const body = { fields: [{ id: 'scene', question: 'Terrain?', options: { forest: 'Forest', unknown: 'Unknown' } }] };
    const request: typeof fetch = async () => response({ model: 'jev-version', answers: { scene: { type: 'choice', choice: 'forest', confidence: 0.8 } } });
    expect(await directJevRequest(connection, 'select-context', body, new AbortController().signal, request)).toMatchObject({ selections: { scene: { value: 'forest', confidence: 0.8 } } });
    await expect(directJevRequest(connection, 'select-context', body, new AbortController().signal, async () => response({ model: 'jev-version', answers: { scene: { type: 'choice', choice: 'invented', confidence: 1 } } }))).rejects.toThrow('无效选择');
  });
  it('rejects incomplete and out-of-range TypeSafe results', async () => {
    await expect(directJevRequest(connection, 'evaluate', { candidates: [{ id: 'attack' }] }, new AbortController().signal, async () => response({ model: 'jev', answers: { benefit_0: { type: 'score', score: 10, confidence: 1 }, risk_0: { type: 'noul', noul: 0 } } }))).rejects.toThrow('无效评分');
  });
  it('uses custom OpenAI-compatible endpoint and selected model for decisions', async () => {
    const request = vi.fn<typeof fetch>(async () => response({ model: 'remote-model', choices: [{ message: { content: '{"scores":{"attack":0.8},"confidence":0.7}' } }] }));
    expect(await directJevRequest({ ...connection, protocol: 'openai', model: 'custom-model', url: 'https://gateway.example/v1' }, 'evaluate', { candidates: [{ id: 'attack' }] }, new AbortController().signal, request)).toMatchObject({ scores: { attack: 0.8 }, model: 'remote-model' });
    expect(request.mock.calls[0]?.[0]).toBe('https://gateway.example/v1/chat/completions');
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body)).model).toBe('custom-model');
  });
  it('connection test only lists models and does not bill an inference request', async () => {
    const request = vi.fn<typeof fetch>(async () => response({ models: [{ name: 'jev-latest' }] }));
    expect(await new JevCommandController(request).test(connection)).toContain('尚未调用决策');
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]?.[0]).toBe(JEV_API_URL + '/models');
  });
  it('real inference test exposes immediate POST rejection even when model discovery succeeds', async () => {
    vi.useFakeTimers();
    const urls: string[] = [];
    const request: typeof fetch = async url => {
      urls.push(String(url));
      return String(url).endsWith('/models') ? response({ models: ['jev-latest'] })
        : new Response('test-key private-response-body', { status: 401 });
    };
    const controller = new JevCommandController(request);
    expect(await controller.test(connection)).toContain('连接正常');
    const pending = controller.testInference(connection);
    await vi.advanceTimersByTimeAsync(9999);
    expect(controller.busy).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    const result = await pending;
    expect(result).toContain('HTTP 401');
    expect(result).toContain('重试 10 次');
    expect(result).not.toMatch(/test-key|private-response-body/);
    expect(urls.filter(url => url.endsWith('/systemone'))).toHaveLength(11);
  });
  it.each(['typesafe', 'openai', 'bridge'] as const)('validates a tiny real %s inference without chat or battle data', async protocol => {
    const request = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(String(init?.body)).not.toContain('test-chat');
      if (protocol === 'typesafe') {
        expect(body.questions.lighting.type).toBe('choice');
        return response({ model: 'jev-latest', answers: { lighting: { type: 'choice', choice: 'day', confidence: 0.9 } } });
      }
      const answer = { model: 'test-model', selections: { lighting: { value: 'day', confidence: 0.9 } } };
      return response(protocol === 'bridge' ? answer : { choices: [{ message: { content: JSON.stringify(answer) } }] });
    });
    expect(await new JevCommandController(request).testInference({ ...connection, protocol, url: protocol === 'typesafe' ? JEV_API_URL : 'https://gateway.example/v1' })).toContain('推理测试通过');
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('does not echo malformed model JSON into diagnostic text', async () => {
    await expect(directJevRequest({ ...connection, protocol: 'openai', url: 'https://gateway.example/v1' }, 'evaluate', { candidates: [{ id: 'attack' }] },
      new AbortController().signal, async () => response({ choices: [{ message: { content: 'test-key private narrative' } }] })))
      .rejects.toThrow('模型未返回有效决策 JSON');
  });
});
