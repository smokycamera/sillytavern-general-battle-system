import { afterEach, expect, it, vi } from 'vitest';
import { nativeFixture } from './native-fixture.js';
import { createInventoryItem } from '../../panel/src/inventory-state.js';
import { payloadHash } from '../src/save-envelope.js';

const stops: (() => void)[] = [];
afterEach(() => stops.splice(0).forEach(stop => stop()));
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const reply = '<tb><spawn name="卫兵" side="ally" scale="hero"/></tb>';
type Fixture = ReturnType<typeof nativeFixture>;

async function setup(tauri = false, mvuBefore = false, mvu?: (f: Fixture) => Promise<void>) {
  const state = { isChatSaving: false }, f = nativeFixture(state);
  stops.push(() => f.service.dispose());
  if (tauri) f.hostWindow.__TAURITAVERN__ = { api: { chat: { open: () => ({
    metadata: { get: async () => structuredClone(f.disk.get(f.context.chatId!) ?? {}) },
    history: { tail: async ({ limit }: { limit: number }) => ({ messages: structuredClone((f.chats.get(f.context.chatId!) ?? []).slice(-limit)) }) },
  }) } } };
  const listen = () => f.host.subscribe('MESSAGE_RECEIVED', () => mvu?.(f));
  if (mvuBefore) listen();
  await f.service.start(); await f.service.setStorySync(true);
  if (!mvuBefore) listen();
  const explicit = vi.spyOn(f.context, 'saveChat');
  const naturalSave = async () => {
    const metadata = structuredClone(f.context.chatMetadata!), chat = structuredClone(f.context.chat!);
    const id = f.context.chatId!;
    state.isChatSaving = true;
    await delay(45);
    f.disk.set(id, metadata); f.chats.set(id, chat); state.isChatSaving = false;
  };
  const begin = async () => {
    await f.emit('GENERATION_STARTED', 'normal', {}, false);
    f.context.chat!.push({ mes: reply, is_user: false, swipe_id: 0, send_date: 'today', gen_finished: 'done' });
  };
  return { ...f, state, explicit, naturalSave, begin };
}

it.each([false, true])('共用宿主的流式回复保存，保留 MVU 变量与来源标记，不另写一次（Tauri=%s）', async tauri => {
  const f = await setup(tauri, false, async f => {
    await delay(30);
    f.context.chat!.at(-1)!.mes += '\n<UpdateVariable>MVU 更新</UpdateVariable>\n<StatusPlaceHolderImpl/>';
    f.context.chat!.at(-1)!.variables = [{ stat_data: { 好感: 30 }, schema: {} }];
    f.context.chatMetadata!.variables = { stat_data: { 好感: 30 } };
  });
  await f.begin(); await f.emit('GENERATION_ENDED', 1);
  await f.emit('MESSAGE_RECEIVED', 0); // Must return BEFORE the save it is sharing.
  expect(f.store.hasPending()).toBe(true);
  expect(f.disk.get('a')!.tavernBattle).not.toMatchObject({ revision: f.store.pendingOperation()!.candidate.revision });
  await f.naturalSave();
  await vi.waitFor(() => expect(f.service.snapshot().storage?.[0]?.name).toBe('卫兵'));
  expect(f.explicit).not.toHaveBeenCalled(); expect(f.store.hasPending()).toBe(false);
  expect(f.chats.get('a')![0]!.variables).toEqual([{ stat_data: { 好感: 30 }, schema: {} }]);
  expect(f.disk.get('a')!.variables).toEqual({ stat_data: { 好感: 30 } });
  expect(f.chats.get('a')![0]!.extra?.tavernBattleSourceId).toMatch(/^tb-source:/);
  expect(await f.journal.get(f.host.session()!.scope.key)).toBeUndefined();
});

it('MVU 先处理、非流式先收到消息后结束生成：继续原来的独立保存', async () => {
  const f = await setup(false, true, async f => { f.context.chat!.at(-1)!.mes += '\n<StatusPlaceHolderImpl/>'; });
  await f.begin(); await f.emit('MESSAGE_RECEIVED', 0); await f.naturalSave(); await f.emit('GENERATION_ENDED', 1);
  await vi.waitFor(() => expect(f.service.snapshot().storage?.[0]?.name).toBe('卫兵'));
  expect(f.explicit).toHaveBeenCalledTimes(1);
});

it('宿主未自动保存或跳过保存时补写一次，仍以磁盘结果确认', async () => {
  const f = await setup();
  await f.begin(); await f.emit('GENERATION_ENDED', 1); await f.emit('MESSAGE_RECEIVED', 0);
  await vi.waitFor(() => expect(f.service.snapshot().storage?.[0]?.name).toBe('卫兵'));
  expect(f.explicit).toHaveBeenCalledTimes(1); expect(f.store.hasPending()).toBe(false);
});

it('MVU 异步处理超过共用窗口：补写后宿主再存，双方状态都保留', async () => {
  const f = await setup(true, false, async f => {
    await delay(750);
    f.context.chat!.at(-1)!.mes += '\n<StatusPlaceHolderImpl/>';
    f.context.chat!.at(-1)!.variables = [{ stat_data: { 好感: 31 } }];
  });
  await f.begin(); await f.emit('GENERATION_ENDED', 1); await f.emit('MESSAGE_RECEIVED', 0); await f.naturalSave();
  await vi.waitFor(() => expect(f.service.snapshot().storage?.[0]?.name).toBe('卫兵'));
  expect(f.explicit).toHaveBeenCalledTimes(1);
  expect(f.chats.get('a')![0]!.variables).toEqual([{ stat_data: { 好感: 31 } }]);
  expect(f.disk.get('a')!.tavernBattle).toMatchObject({ lastOperationId: f.store.head()!.lastOperationId });
});

it('其他插件改了 tb 事件：撤销已经搭车的旧候选，新事件留待人工确认', async () => {
  const f = await setup(false, false, async f => { f.context.chat!.at(-1)!.mes = reply.replace('卫兵', '被修改'); });
  await f.begin(); await f.emit('GENERATION_ENDED', 1); await f.emit('MESSAGE_RECEIVED', 0); await f.naturalSave();
  await vi.waitFor(() => expect(f.service.snapshot().proposals?.at(-1)?.source.text).toContain('被修改'));
  expect(f.service.snapshot().storage).toBeUndefined();
  expect(f.service.snapshot().proposals?.at(-1)?.expected?.manualOnly).toBe(true);
  expect(f.store.hasPending()).toBe(false);
});

it('搭车期间切到别的聊天，原操作不写入新聊天', async () => {
  const f = await setup();
  await f.begin(); await f.emit('GENERATION_ENDED', 1); await f.emit('MESSAGE_RECEIVED', 0);
  f.switchTo('b'); await f.emit('CHAT_CHANGED');
  await vi.waitFor(() => expect(f.service.status().phase).toBe('ready'));
  expect(f.disk.get('b')?.tavernBattle).toBeUndefined(); expect(f.explicit).not.toHaveBeenCalled();
});

it('载入旧档时清理已保存的改造历史，只清理战阵自己的存档', async () => {
  const f = await setup(true);
  const item = createInventoryItem('sword', '剑', { kind: 'weapon', mechanism: 'sword', power: 3 }, 'old');
  item.history = Array.from({ length: 300 }, (_, revision) => ({ revision, name: '旧剑', mechanics: structuredClone(item.mechanics!), sourceId: String(revision) }));
  const old = f.store.envelope()!;
  old.payload!.inventory = [item]; old.payloadHash = await payloadHash(old.payload);
  f.disk.set('a', { tavernBattle: old, variables: { stat_data: { 历史: ['MVU 数据'] } } });
  f.context.chatMetadata = structuredClone(f.disk.get('a')!);
  await f.service.load();
  expect(f.service.status().phase).toBe('ready'); expect(f.store.needsHistoryCompaction()).toBe(false);
  const saved = f.disk.get('a')!.tavernBattle as typeof old;
  expect(saved.payload!.inventory![0]!.history).toBeUndefined();
  expect(saved.payload!.inventory![0]!.mechanics).toEqual(item.mechanics);
  expect(f.disk.get('a')!.variables).toEqual({ stat_data: { 历史: ['MVU 数据'] } });
  const revision = saved.revision; await f.service.load(); expect(f.store.head()!.revision).toBe(revision);
});
