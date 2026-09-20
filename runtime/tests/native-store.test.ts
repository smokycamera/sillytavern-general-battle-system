import { describe, expect, it } from 'vitest';
import type { ChatScope, HostSession, MetadataPort, NativeEnvelope } from '../../host/src/contracts.js';
import { NativeStore } from '../src/native-store.js';
import { MemoryJournal } from '../src/recovery-journal.js';

function fixture() {
  const scopes = new Map<string, Record<string, unknown>>(); const disk = new Map<string, Record<string, unknown>>();
  let id = 'a', epoch = 1, legacy = false;
  const session = (): HostSession => ({ scope: { key: id, account: 'test', avatar: 'a.png', characterName: 'A', chatId: id }, epoch });
  const metadata = () => { if (!scopes.has(id)) scopes.set(id, { otherExtension: { keep: true } }); return scopes.get(id)!; };
  let save = async () => { disk.set(id, structuredClone(metadata())); };
  let read = async (scope: ChatScope) => structuredClone(disk.get(scope.key) ?? {});
  const host: MetadataPort = { session, metadata, hasLegacyRuntime: () => legacy, saveMetadata: () => save(), readPersisted: scope => read(scope) };
  const journal = new MemoryJournal(); const store = new NativeStore(host, journal);
  return { store, host, journal, disk, metadata, setSave: (fn: typeof save) => { save = fn; }, setRead: (fn: typeof read) => { read = fn; }, switch: (next: string) => { id = next; epoch++; }, legacy: () => { legacy = true; } };
}

describe('原生保存：独立读回与恢复记录', () => {
  it('放弃候选前再次核实，已经落盘的操作转为确认而不是丢失进度', async () => {
    const f = fixture(); await f.store.load(); f.setSave(async () => {});
    await f.store.commit(0, () => ({ factRevision: 1 }));
    expect((await f.store.discardPending()).discarded).toBe(true); expect(f.store.snapshot()).toEqual({}); expect(f.metadata().tavernBattle).toBeUndefined();
    await f.store.commit(0, () => ({ factRevision: 2 }));
    f.disk.set('a', structuredClone(f.metadata()));
    const result = await f.store.discardPending(); expect(result.discarded).toBe(false); expect(result.receipt?.status).toBe('confirmed'); expect(f.store.snapshot().factRevision).toBe(2);
  });
  it('完成读回才发布新状态，并保留其他扩展元数据', async () => {
    const f = fixture(); await f.store.load();
    const result = await f.store.commit(0, () => ({ factRevision: 1 }), { operationId: 'one' });
    expect(result.status).toBe('confirmed'); expect(f.store.snapshot().factRevision).toBe(1);
    expect(f.disk.get('a')?.otherExtension).toEqual({ keep: true }); expect(await f.journal.get('a')).toBeUndefined();
  });
  it('saveMetadata 吞掉错误并正常返回，也不能冒充保存成功', async () => {
    const f = fixture(); await f.store.load(); f.setSave(async () => {});
    expect((await f.store.commit(0, () => ({ factRevision: 1 }))).status).toBe('pending');
    expect(f.store.snapshot()).toEqual({}); expect(await f.journal.get('a')).toBeDefined();
    expect((await f.store.commit(0, () => ({ factRevision: 2 }))).status).toBe('pending');
  });
  it('实际落盘但回执抛错时读回确认，同一个 operationId 不重复计算', async () => {
    const f = fixture(); await f.store.load();
    f.setSave(async () => { f.disk.set('a', structuredClone(f.metadata())); throw Error('connection lost'); });
    let calls = 0; const action = () => { calls++; return { factRevision: 1 }; };
    expect((await f.store.commit(0, action, { operationId: 'same' })).status).toBe('confirmed');
    expect((await f.store.commit(0, action, { operationId: 'same' })).status).toBe('confirmed'); expect(calls).toBe(1);
  });
  it('结果不明时重试同一个候选，不重新计算随机动作', async () => {
    const f = fixture(); await f.store.load(); f.setSave(async () => {});
    let calls = 0;
    await f.store.commit(0, () => { calls++; return { factRevision: 1 }; }, { operationId: 'retry' });
    f.setSave(async () => { f.disk.set('a', structuredClone(f.metadata())); });
    expect((await f.store.retry()).status).toBe('confirmed'); expect(calls).toBe(1);
    expect(f.store.envelope()?.lastOperationId).toBe('retry');
  });
  it('保存期间切聊天，旧操作不会发布到新聊天或写它的元数据', async () => {
    const f = fixture(); await f.store.load();
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    let started!: () => void; const began = new Promise<void>(resolve => { started = resolve; });
    f.setSave(async () => { const copy = structuredClone(f.metadata()); started(); await gate; f.disk.set('a', copy); });
    const operation = f.store.commit(0, () => ({ factRevision: 7 })); await began;
    f.switch('b'); const loading = f.store.load(); release();
    expect((await operation).status).toBe('confirmed'); await loading;
    expect(f.store.snapshot()).toEqual({}); expect(f.metadata().tavernBattle).toBeUndefined();
  });
  it('清理生成新代次，旧 pending 不会重新成为权威数据', async () => {
    const f = fixture(); await f.store.load(); await f.store.commit(0, () => ({ factRevision: 1 }));
    const old = f.store.envelope()!; f.setSave(async () => {});
    await f.store.commit(1, () => ({ factRevision: 2 })); const pending = await f.journal.get('a');
    const clearStore = new NativeStore(f.host, new MemoryJournal());
    f.metadata().tavernBattle = old; await clearStore.load(); f.setSave(async () => { f.disk.set('a', structuredClone(f.metadata())); });
    expect((await clearStore.commit(1, () => ({}), { clear: true })).status).toBe('confirmed');
    expect(clearStore.envelope()?.generation).not.toBe(old.generation);
    expect(pending).toBeDefined(); await f.store.load();
    expect(f.store.snapshot()).toEqual({}); expect(f.store.pendingOperation()).toBeUndefined();
  });
  it('宿主出现更新版本时旧候选返回冲突，不覆盖清理或新档', async () => {
    const f = fixture(); await f.store.load(); await f.store.commit(0, () => ({ factRevision: 1 }));
    const newer = structuredClone(f.store.envelope()!); newer.revision++;
    f.disk.set('a', { tavernBattle: newer });
    expect((await f.store.commit(1, () => ({ factRevision: 2 }))).status).toBe('conflict');
    expect((f.disk.get('a')?.tavernBattle as NativeEnvelope).revision).toBe(2);
  });
  it('恢复记录保存失败时不执行宿主写入；坏数值同样拒绝', async () => {
    const f = fixture(); await f.store.load(); let writes = 0; f.setSave(async () => { writes++; });
    f.journal.put = async () => { throw Error('quota'); };
    expect((await f.store.commit(0, () => ({ factRevision: 1 }))).status).toBe('failed');
    expect((await f.store.commit(0, () => ({ factRevision: NaN }))).status).toBe('failed'); expect(writes).toBe(0);
  });
  it('旧脚本运行时拒绝写入，未知存档版本拒绝加载', async () => {
    const f = fixture(); await f.store.load(); f.legacy();
    expect((await f.store.commit(0, () => ({}))).status).toBe('conflict');
    f.disk.set('a', { tavernBattle: { format: 'tavern-battle-native', containerVersion: 99 } });
    await expect(f.store.load()).rejects.toThrow(/版本/);
  });
});
