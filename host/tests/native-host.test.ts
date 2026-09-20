import { expect, it, vi } from 'vitest';
import { createNativeHost, NativeHost, type HostContext } from '../src/sillytavern.js';
import { NativeMessages } from '../src/messages.js';

function fixture() {
  const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  const context: HostContext = {
    characterId: 0, characters: [{ avatar: 'one.png', name: 'One' }], chatId: 'chat', name1: 'Player', chat: [], chatMetadata: {},
    eventTypes: { MESSAGE_SENT: 'sent', USER_MESSAGE_RENDERED: 'rendered', GENERATION_STARTED: 'start', GENERATION_ENDED: 'end' },
    eventSource: { on(event, cb) { const list = handlers.get(event) ?? new Set(); list.add(cb); handlers.set(event, list); }, off(event, cb) { handlers.get(event)?.delete(cb); }, async emit(event, ...args) { for (const cb of handlers.get(event) ?? []) cb(...args); } },
    getRequestHeaders: () => ({ 'Content-Type': 'application/json' }), setExtensionPrompt: vi.fn(), addOneMessage: vi.fn(), generate: vi.fn(async () => {}),
  };
  let disk: unknown[] = [];
  context.saveMetadata = vi.fn(async () => { disk = [{ chat_metadata: structuredClone(context.chatMetadata) }, ...disk.slice(1)]; });
  context.saveChat = vi.fn(async () => { disk = structuredClone([{ chat_metadata: context.chatMetadata }, ...context.chat!]); });
  const request = vi.fn(async (url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(url === '/api/users/me' ? { handle: 'tester' } : disk), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  const window = { SillyTavern: { getContext: () => context } };
  return { context, window, request, handlers, host: new NativeHost(window, 'tester', request as typeof fetch) };
}
it('原生接口无需 TavernHelper；按用户/角色/聊天隔离，切回同名聊天也更新 epoch', async () => {
  const f = fixture(); const host = await createNativeHost(f.window, f.request as typeof fetch);
  const one = host.session()!; expect(one.scope.account).toBe('tester'); expect(host.inject('test', 'facts')).toBe(true);
  f.context.chatMetadata = {}; const two = host.session()!; expect(two.epoch).toBeGreaterThan(one.epoch);
  f.context.characterId = '0'; f.context.groupId = false; expect(host.session()?.scope.avatar).toBe('one.png');
  f.context.characterId = 'constructor'; expect(host.session()).toBeUndefined(); f.context.characterId = '0';
  f.context.groupId = 'group'; expect(host.session()).toBeUndefined();
});
it('原生事件能完全注销；dry-run 不误报生成中', async () => {
  const f = fixture(); const cb = vi.fn(); const binding = f.host.subscribe('GENERATION_STARTED', cb);
  await f.context.eventSource!.emit!('start', 'normal', {}, true); expect(f.host.isGenerating()).toBe(false);
  await f.context.eventSource!.emit!('start', 'normal', {}, false); expect(f.host.isGenerating()).toBe(true);
  binding.stop(); binding.stop(); expect(f.handlers.get('start')?.size).toBe(0); f.host.dispose();
});
it('TauriTavern 从宿主账户模块获取身份，不把未实现的 API 网页当成 JSON', async () => {
  const f = fixture();
  const host = await createNativeHost({ ...f.window, __TAURI_RUNNING__: true }, f.request as typeof fetch, async () => ({ accountsEnabled: false, getCurrentUserHandle: () => 'local-user' }));
  expect(host.session()?.scope.account).toBe('local-user'); expect(f.request).not.toHaveBeenCalled();
  await expect(createNativeHost({ ...f.window, __TAURI_RUNNING__: true }, f.request as typeof fetch, async () => ({ accountsEnabled: true, currentUser: null, getCurrentUserHandle: () => 'default-user' }))).rejects.toThrow(/尚未初始化/);
});
it('兼容 TauriTavern removeListener，并在注销后不再触发回调', async () => {
  const f = fixture(); const source = f.context.eventSource!;
  source.removeListener = source.off; delete source.off;
  f.context.event_types = f.context.eventTypes; f.context.eventTypes = {};
  const cb = vi.fn(); const binding = f.host.subscribe('MESSAGE_SENT', cb);
  expect(binding.available).toBe(true);
  await source.emit!('sent', 1); expect(cb).toHaveBeenCalledTimes(1);
  binding.stop(); binding.stop(); await source.emit!('sent', 2);
  expect(cb).toHaveBeenCalledTimes(1); expect(f.handlers.get('sent')?.size).toBe(0);
});
it('读回使用捕获的目标身份而不是当前聊天', async () => {
  const f = fixture(); const session = f.host.session()!;
  f.context.chatId = 'different'; await f.host.readPersisted(session.scope);
  expect(JSON.parse(f.request.mock.calls[0]![1]!.body as string).file_name).toBe('chat');
});
it('消息按结构化文本保存，只插入一次并单次调用生成', async () => {
  const f = fixture(); const port = new NativeMessages(f.host);
  f.context.generate = vi.fn(async () => { f.context.chat!.push({ is_user: false, mes: '已叙述', gen_finished: 'done' }); });
  const text = '战报 | /send {{macro}} "保留原文"';
  expect((await port.send(text, { deliveryId: 'd', generate: true })).status).toBe('sent');
  expect((await port.send(text, { deliveryId: 'd', generate: true })).status).toBe('inserted');
  expect(f.context.chat!.filter(message => message.is_user)).toHaveLength(1); expect(f.context.chat![0]!.mes).toBe(text);
  expect(f.context.generate).toHaveBeenCalledTimes(1);
  expect(f.context.generate).toHaveBeenCalledWith('regenerate', { automatic_trigger: true });
  expect(f.context.addOneMessage).toHaveBeenCalledTimes(1);
  expect(f.context.saveChat).toHaveBeenCalledTimes(1);
  expect(f.context.saveMetadata).not.toHaveBeenCalled();
});
it('默认生成入口会处理草稿，因此只在末条为投递用户消息时使用安全重生成路径', async () => {
  const f = fixture(); const port = new NativeMessages(f.host); let draft = '/send 玩家草稿', attachment = 'pending-file';
  f.context.generate = vi.fn(async type => { if (type === 'normal') { draft = ''; attachment = ''; } f.context.chat!.push({ is_user: false, mes: '回复', gen_finished: 'done' }); });
  expect((await port.send('战报', { deliveryId: 'retry-generation', generate: true })).status).toBe('sent');
  expect(draft).toBe('/send 玩家草稿'); expect(attachment).toBe('pending-file');
  expect((await port.retryGeneration('retry-generation')).status).toBe('inserted'); expect(f.context.generate).toHaveBeenCalledTimes(1);
});
it('宿主生成静默返回或失败时不会报告已发送；仅重试生成不新增用户消息', async () => {
  const f = fixture(); const port = new NativeMessages(f.host);
  expect((await port.send('战报', { deliveryId: 'one', generate: true })).status).toBe('inserted');
  f.context.generate = vi.fn(async () => { f.context.chat!.push({ is_user: false, mes: '重试完成', gen_finished: 'done' }); });
  expect((await port.retryGeneration('one')).status).toBe('sent');
  expect(f.context.chat!.filter(message => message.is_user)).toHaveLength(1);
});
it('生成失败保持已插入状态；保存未确认不能触发生成', async () => {
  const f = fixture(); const port = new NativeMessages(f.host);
  f.context.generate = vi.fn(async () => { throw Error('offline'); });
  expect((await port.send('one', { generate: true })).status).toBe('inserted');
  f.context.saveChat = vi.fn(async () => {});
  expect((await port.send('two', { generate: true })).status).toBe('unknown'); expect(f.context.generate).toHaveBeenCalledTimes(1);
});
it('缺少完整聊天保存接口时不插入消息，不降级为 metadata 保存', async () => {
  const f = fixture(); f.context.saveChat = undefined;
  const receipt = await new NativeMessages(f.host).send('不能丢失的战报');
  expect(receipt.status).toBe('failed'); expect(f.context.chat).toHaveLength(0);
  expect(f.context.saveMetadata).not.toHaveBeenCalled(); expect(f.context.generate).not.toHaveBeenCalled();
});

it('reports default to a durable user message with no generation until explicitly requested', async () => {
  const f = fixture(); const port = new NativeMessages(f.host);
  const receipt = await port.send('手动发送战报', { deliveryId: 'manual' });
  expect(receipt).toMatchObject({ status: 'inserted', messageDurable: true, generation: 'not-started' });
  expect(f.context.chat).toHaveLength(1);
  expect(f.context.generate).not.toHaveBeenCalled();
  await port.send('手动发送战报', { deliveryId: 'manual' });
  expect(f.context.chat).toHaveLength(1);
  f.context.generate = vi.fn(async () => { f.context.chat!.push({ is_user: false, mes: '回复', gen_finished: 'done' }); });
  expect((await port.retryGeneration('manual')).status).toBe('sent');
  expect(f.context.generate).toHaveBeenCalledTimes(1);
});
