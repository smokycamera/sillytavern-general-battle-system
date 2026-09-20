import { describe, expect, it, vi } from 'vitest';
import { NativeMessages } from '../../host/src/messages.js';
import { prepareMessageTag } from '../../host/src/message-identity.js';
import type { HostContext } from '../../host/src/sillytavern.js';
import { nativeFixture } from './native-fixture.js';

/** Tauri metadata writes deliberately do not persist chat[] or message.extra. */
function metadataOnlyFixture() {
  const f = nativeFixture();
  const metadataSave = vi.fn(async () => {
    f.disk.set(f.context.chatId!, structuredClone(f.context.chatMetadata!));
  });
  const fullSave = vi.fn(f.saveNormally);
  const context = f.context as HostContext & { saveChat?: () => Promise<unknown> };
  context.saveMetadata = metadataSave;
  context.saveChat = fullSave;
  context.addOneMessage = vi.fn();
  return { ...f, context, metadataSave, fullSave };
}

async function taggedFixture() {
  const f = metadataOnlyFixture();
  f.context.chat!.push({ is_user: false, mes: '<tb><spawn name="测试卫兵"/></tb>', swipe_id: 0, gen_finished: 'complete' });
  await f.saveNormally();
  await f.store.load();
  const tag = prepareMessageTag(f.context.chat!, 0);
  return { ...f, tag };
}

describe('metadata-only host contract', () => {
  it('keeps pure archive writes on the metadata-only fast path', async () => {
    const f = metadataOnlyFixture();
    await f.store.load();
    expect((await f.store.commit(0, () => ({ factRevision: 1 }))).status).toBe('confirmed');
    expect(f.metadataSave).toHaveBeenCalledTimes(1);
    expect(f.fullSave).not.toHaveBeenCalled();
  });

  it('persists source message tags and the envelope together using a full chat save', async () => {
    const f = await taggedFixture();
    const receipt = await f.store.commit(0, () => ({ factRevision: 1 }), { messageTags: [f.tag] });
    expect(receipt.status).toBe('confirmed');
    expect(f.fullSave).toHaveBeenCalledTimes(1);
    expect(f.metadataSave).not.toHaveBeenCalled();
    expect(f.chats.get('a')![0]!.extra?.tavernBattleSourceId).toBe(f.tag.id);
    expect(f.store.hasPending()).toBe(false);
    expect(await f.journal.get(f.host.session()!.scope.key)).toBeUndefined();
  });

  it('recovers an old partially persisted candidate after reload without recomputing the operation', async () => {
    const f = await taggedFixture();
    // Emulate the old implementation: even the requested full save writes only metadata.
    f.context.saveChat = f.metadataSave;
    const update = vi.fn(() => ({ factRevision: 7 }));
    const first = await f.store.commit(0, update, { operationId: 'old-pending', messageTags: [f.tag] });
    expect(first.status).toBe('pending');
    expect(f.chats.get('a')![0]!.extra?.tavernBattleSourceId).toBeUndefined();
    await f.store.load();
    expect(f.store.hasPending()).toBe(true);
    f.context.saveChat = f.fullSave;
    expect((await f.store.retry()).status).toBe('confirmed');
    expect(f.store.envelope()!.lastOperationId).toBe('old-pending');
    expect(f.store.snapshot().factRevision).toBe(7);
    expect(update).toHaveBeenCalledTimes(1);
    expect(f.chats.get('a')![0]!.extra?.tavernBattleSourceId).toBe(f.tag.id);
    expect(f.store.hasPending()).toBe(false);
  });

  it('does not mistake a swallowed full-save failure for durable success', async () => {
    const f = await taggedFixture();
    f.context.saveChat = async () => {};
    expect((await f.store.commit(0, () => ({ factRevision: 2 }), { messageTags: [f.tag] })).status).toBe('pending');
    expect(f.store.snapshot()).toEqual({});
    f.context.saveChat = f.fullSave;
    expect((await f.store.retry()).status).toBe('confirmed');
    expect(f.store.snapshot().factRevision).toBe(2);
  });

  it('preserves recovery evidence when full chat saving is unavailable', async () => {
    const f = await taggedFixture();
    f.context.saveChat = undefined;
    const receipt = await f.store.commit(0, () => ({ factRevision: 3 }), { messageTags: [f.tag] });
    expect(receipt.status).toBe('pending');
    expect(f.store.hasPending()).toBe(true);
    expect(f.metadataSave).not.toHaveBeenCalled();
    expect(f.chats.get('a')![0]!.extra?.tavernBattleSourceId).toBeUndefined();
  });

  it('fully saves inserted reports and does not duplicate delivery on retry', async () => {
    const f = metadataOnlyFixture();
    const messages = new NativeMessages(f.host);
    const first = await messages.send('战报 /send {{literal}}', { deliveryId: 'report-once', generate: false });
    expect(first.status).toBe('inserted');
    expect(f.fullSave).toHaveBeenCalledTimes(1);
    expect(f.metadataSave).not.toHaveBeenCalled();
    expect(f.chats.get('a')!.filter(message => message.extra?.tavernBattleDeliveryId === 'report-once')).toHaveLength(1);
    expect((await messages.send('战报 /send {{literal}}', { deliveryId: 'report-once', generate: false })).status).toBe('inserted');
    expect(f.context.chat).toHaveLength(1);
    expect(f.fullSave).toHaveBeenCalledTimes(1);
  });
});

it('falls back to verified full save when metadata saver silently leaves disk unchanged', async () => {
  const f = metadataOnlyFixture(); await f.store.load();
  f.context.saveMetadata = vi.fn(async () => {});
  const receipt = await f.store.commit(0, () => ({ factRevision: 9 }));
  expect(receipt.status).toBe('confirmed');
  expect(f.fullSave).toHaveBeenCalledTimes(1);
  expect(f.disk.get('a')!.tavernBattle).toMatchObject({ payload: { factRevision: 9 } });
});
it('manual retry of an old metadata failure uses a full save without recomputing the candidate', async () => {
  const f = metadataOnlyFixture(); await f.store.load();
  f.context.saveMetadata = vi.fn(async () => { throw Error('metadata unavailable'); });
  const update = vi.fn(() => ({ factRevision: 4 }));
  expect((await f.store.commit(0, update)).status).toBe('pending');
  expect(f.fullSave).not.toHaveBeenCalled();
  await f.store.load();
  expect((await f.store.retry()).status).toBe('confirmed');
  expect(update).toHaveBeenCalledTimes(1);
  expect(f.fullSave).toHaveBeenCalledTimes(1);
});
it('identical panel flushes verify the head but do not rewrite or increment the revision', async () => {
  const f = metadataOnlyFixture(); await f.store.load();
  await f.store.commit(0, () => ({ factRevision: 1 }));
  expect((await f.store.commit(1, before => before)).status).toBe('confirmed');
  expect(f.store.head()!.revision).toBe(1);
  expect(f.metadataSave).toHaveBeenCalledTimes(1);
});

it('does not fall back over a competing persisted head', async () => {
  const f = metadataOnlyFixture(); await f.store.load();
  await f.store.commit(0, () => ({ factRevision: 1 }));
  f.context.saveMetadata = async () => {
    const newer = f.store.envelope()!; newer.revision += 10;
    f.disk.set('a', { tavernBattle: newer });
  };
  expect((await f.store.commit(1, () => ({ factRevision: 2 }))).status).toBe('pending');
  expect(f.fullSave).not.toHaveBeenCalled();
  expect((await f.store.retry()).status).toBe('conflict');
  expect(f.fullSave).not.toHaveBeenCalled();
});
