import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAdapter } from './tavern.js';

function host(opts: { failHost?: boolean; failLocal?: boolean; send?: () => Promise<unknown> } = {}) {
  const values: Record<string, unknown> = {};
  const local = new Map<string, string>();
  const draft = { value: '玩家尚未发送的草稿' };
  const insert = vi.fn();
  const th = {
    getVariables: () => values,
    setVariables: ({ type: _type, ...next }: Record<string, unknown>) => {
      if (opts.failHost) throw new Error('host failed');
      Object.assign(values, next);
    },
    sendMessageAsUser: opts.send,
    createChatMessages: insert,
  };
  vi.stubGlobal('window', { TavernHelper: th, SillyTavern: { getContext: () => ({ chatId: 'test' }) }, document: { querySelector: () => draft } });
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => local.get(key) ?? null,
    setItem: (key: string, value: string) => { if (opts.failLocal) throw new Error('quota'); local.set(key, value); },
  });
  return { adapter: createAdapter(), local, values, draft, insert, th };
}
afterEach(() => vi.unstubAllGlobals());

describe('真实保存与投递回执', () => {
  it('全部保存失败返回 failed，不宣称成功', () => {
    const { adapter } = host({ failHost: true, failLocal: true });
    expect(adapter.save('panel', { hp: 500 })).toMatchObject({ status: 'failed', host: false, local: false });
  });
  it('宿主失败但镜像成功返回 local-only，恢复不能优先读旧宿主', () => {
    const { adapter, values } = host({ failHost: true });
    values.panel = { hp: 70 };
    expect(adapter.save('panel', { hp: 500 })).toMatchObject({ status: 'local-only', local: true });
    expect(adapter.load('panel')).toMatchObject({ hp: 500 });
  });
  it('宿主与本地均确认，读取返回独立副本', () => {
    const { adapter } = host();
    expect(adapter.save('panel', { hp: 70 }).status).toBe('saved');
    const loaded = adapter.load<{ hp: number }>('panel')!;
    loaded.hp = 500;
    expect(adapter.load('panel')).toMatchObject({ hp: 70 });
  });
  it('发送抛错视为结果未知，不再追加第二条消息或覆盖草稿', async () => {
    const { adapter, draft, insert } = host({ send: async () => { throw new Error('connection lost'); } });
    expect((await adapter.sendAsUser('旧战报')).status).toBe('unknown');
    expect(insert).not.toHaveBeenCalled();
    expect(draft.value).toBe('玩家尚未发送的草稿');
  });
  it('仅插入聊天与复制分别展示，宿主 false 回执不标 sent', async () => {
    const { adapter, th } = host();
    expect((await adapter.sendAsUser('战报')).status).toBe('inserted');
    th.createChatMessages = undefined as unknown as typeof th.createChatMessages;
    vi.stubGlobal('navigator', { clipboard: { writeText: async () => undefined } });
    expect((await adapter.sendAsUser('战报')).status).toBe('copied');
    th.sendMessageAsUser = async () => false;
    expect((await adapter.sendAsUser('战报')).status).toBe('failed');
  });
});
