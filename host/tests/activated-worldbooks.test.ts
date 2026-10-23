import { expect, it, vi } from 'vitest';
import { createWorldbookSource } from '../src/worldbooks.js';
import type { HostContext } from '../src/sillytavern.js';

function fixture(tauri = false) {
  const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  const context: HostContext = {
    characterId: 0, characters: [{ avatar: 'a.png' }, { avatar: 'b.png' }], chatId: 'a',
    eventTypes: Object.fromEntries(['GENERATION_STARTED', 'GENERATION_ENDED', 'GENERATION_STOPPED', 'WORLD_INFO_ACTIVATED',
      'CHAT_CHANGED', 'MESSAGE_EDITED', 'MESSAGE_SWIPED', 'MESSAGE_DELETED', 'MESSAGE_SENT'].map(kind => [kind, kind])),
    eventSource: {
      on(kind, callback) { const set = handlers.get(kind) ?? new Set(); set.add(callback); handlers.set(kind, set); },
      off(kind, callback) { handlers.get(kind)?.delete(callback); },
    },
  };
  if (tauri) {
    context.event_types = context.eventTypes; delete context.eventTypes;
    context.eventSource!.removeListener = context.eventSource!.off; delete context.eventSource!.off;
  }
  const request = vi.fn(), source = createWorldbookSource(() => context, request);
  const emit = (kind: string, ...args: unknown[]) => { for (const callback of handlers.get(kind) ?? []) callback(...args); };
  return { context, source, request, emit, handlers };
}

it('copies only the actual primary API activation, sharing blue, triggered green and probability results without rescanning', async () => {
  const f = fixture();
  await expect(f.source.active!()).rejects.toThrow('生成一次正文');
  f.emit('GENERATION_STARTED', 'normal', {}, false);
  f.emit('MESSAGE_SENT', 1); // The host emits generation-start before inserting the user message.
  f.emit('MESSAGE_DELETED', 1); // Regeneration removes the old answer before scanning world info.
  const entries = [
    { world: '角色设定', uid: 1, comment: '蓝灯', content: '常驻内容', constant: true },
    { world: '角色设定', uid: 2, comment: '绿灯', content: '本轮命中的内容', constant: false, probability: 25 },
    { world: '聊天设定', uid: 2, content: '其他书的同 UID 条目' },
  ];
  f.emit('WORLD_INFO_ACTIVATED', entries);
  f.emit('GENERATION_ENDED');
  entries[1]!.content = '后续扫描修改';
  const expected = [
    { name: '角色设定', entries: [{ id: '1', title: '蓝灯', content: '常驻内容' }, { id: '2', title: '绿灯', content: '本轮命中的内容' }] },
    { name: '聊天设定', entries: [{ id: '2', title: '条目 2', content: '其他书的同 UID 条目' }] },
  ];
  const first = await f.source.active!(); expect(first).toEqual(expected);
  first[0]!.entries[0]!.content = '调用方修改';
  expect(await f.source.active!()).toEqual(expected);
  expect(f.request).not.toHaveBeenCalled();
  f.source.dispose!();
});

it('does not carry a green activation into an empty next round, and ignores dry-run generations', async () => {
  const f = fixture();
  f.emit('GENERATION_STARTED', 'normal', {}, false);
  f.emit('WORLD_INFO_ACTIVATED', [{ world: '书', uid: 1, content: '上轮命中' }]);
  f.emit('GENERATION_ENDED');
  f.emit('GENERATION_STARTED', 'normal', {}, true);
  f.emit('GENERATION_ENDED');
  expect((await f.source.active!())[0]!.entries[0]!.content).toBe('上轮命中');
  f.emit('GENERATION_STARTED', 'normal', {agentResume:true}, false);
  f.emit('GENERATION_ENDED');
  expect((await f.source.active!())[0]!.entries[0]!.content).toBe('上轮命中');
  f.emit('GENERATION_STARTED', 'normal', {}, false);
  // SillyTavern emits no WORLD_INFO_ACTIVATED when no entries survive activation/budget.
  f.emit('GENERATION_ENDED');
  expect(await f.source.active!()).toEqual([]);
  f.source.dispose!();
});

it('isolates cards, chats and branches, discards late activation after a switch, and invalidates edited narrative', async () => {
  const f = fixture();
  f.emit('GENERATION_STARTED', 'normal', {}, false);
  f.emit('WORLD_INFO_ACTIVATED', [{ world: '甲', uid: 1, content: '甲秘密' }]);
  f.context.characterId = 1; f.context.chatId = 'b';
  f.emit('CHAT_CHANGED');
  f.emit('WORLD_INFO_ACTIVATED', [{ world: '甲', uid: 1, content: '甲晚到秘密' }]);
  await expect(f.source.active!()).rejects.toThrow('生成一次正文');
  f.emit('GENERATION_STARTED', 'normal', {}, false);
  f.emit('WORLD_INFO_ACTIVATED', [{ world: '乙', uid: 1, content: '乙内容' }]);
  f.emit('GENERATION_ENDED');
  expect((await f.source.active!())[0]!.name).toBe('乙');
  f.context.branchId = 'fork'; await expect(f.source.active!()).rejects.toThrow('生成一次正文');
  f.context.branchId = undefined;
  f.emit('MESSAGE_EDITED'); await expect(f.source.active!()).rejects.toThrow('生成一次正文');
  f.source.dispose!();
});

it('handles cancellation and unsupported hosts and removes its listeners on disposal', async () => {
  const f = fixture(true), cancel = new AbortController(); cancel.abort();
  f.emit('GENERATION_STARTED', 'normal', {}, false);
  f.emit('WORLD_INFO_ACTIVATED', [{world:'TT 世界书',uid:1,content:'绿灯命中'}]);
  expect((await f.source.active!())[0]!.name).toBe('TT 世界书');
  await expect(f.source.active!(cancel.signal)).rejects.toMatchObject({ name: 'AbortError' });
  f.source.dispose!();
  expect([...f.handlers.values()].every(set => set.size === 0)).toBe(true);
  await expect(f.source.active!()).rejects.toThrow('激活接口');
  const unsupported = createWorldbookSource(() => ({}));
  await expect(unsupported.active!()).rejects.toThrow('手动选择');
  unsupported.dispose!();
});
