import { generateUnit } from '../../engine/src/index.js';
import { unitRecordFromCombatant } from '../../panel/src/unit-state.js';
import { afterEach, expect, it, vi } from 'vitest';
import { nativeFixture } from './native-fixture.js';
import { prepareMessageTag, SourceMessageChangedError } from '../../host/src/message-identity.js';
import type { NativeEnvelope } from '../../host/src/contracts.js';
import { BattleService } from '../src/battle-service.js';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach(stop => stop()));
const content = (name: string) => `<tb>\n<spawn name="${name}" side="ally" scale="hero"/>\n</tb>`;
async function setup() {
  const f = nativeFixture(); cleanups.push(() => f.service.dispose()); await f.service.start();
  f.context.chat!.push({ is_user: false, mes: content('旧回复'), swipe_id: 0, send_date: 'date', gen_finished: 'first-time' });
  return f;
}
it('source text changed during save cannot confirm the old proposal even when its stable ID persists; the half save is undone at once',async()=>{
  const f=await setup();await f.service.scan();const proposal=f.service.snapshot().proposals![0]!;
  f.setSave(async()=>{f.context.chat![0]!.mes=content('保存中的新正文');await f.saveNormally();});
  const receipt=await f.service.approve(proposal.id);
  expect(receipt).toMatchObject({status:'conflict',code:'source-changed'});expect(f.store.hasPending()).toBe(false);
  expect(f.service.snapshot().storage?.some(u=>u.name==='旧回复')).not.toBe(true);
  expect(f.service.snapshot().proposals).toEqual([expect.objectContaining({id:proposal.id,status:'pending'})]);
  expect((f.disk.get('a')!.tavernBattle as NativeEnvelope).payload!.storage?.some(u=>u.name==='旧回复')).not.toBe(true);
  expect(await f.journal.get(f.host.session()!.scope.key)).toBeUndefined();
});
it('生成结束时间被宿主更新不会误判正文已编辑；旧rc.4指纹也可恢复', async () => {
  const f = await setup(); const message = f.context.chat![0]!;
  const tag = prepareMessageTag(f.context.chat!, 0);
  tag.fingerprint = JSON.stringify([false, false, message.mes, 0, 'date', 'old-time']);
  message.gen_finished = 'new-time';
  await expect(f.host.applyMessageTags(f.host.session()!, [tag])).resolves.toBeUndefined();
  const put = f.journal.put.bind(f.journal);
  vi.spyOn(f.journal, 'put').mockImplementation(async (...args) => { await put(...args); message.gen_finished = 'even-later'; });
  await f.service.scan();
  expect(f.service.snapshot().proposals).toHaveLength(1); expect(f.service.canWrite()).toBe(true);
  expect(f.store.hasPending()).toBe(false);
});
it.each(['text', 'swipe', 'role', 'unfinished'] as const)('%s真正改变仍拒绝过时消息身份，且批量绑定不部分写入', async change => {
  const f = await setup(); const first = f.context.chat![0]!;
  f.context.chat!.push({ ...first, extra: undefined });
  const tags = [0, 1].map(index => prepareMessageTag(f.context.chat!, index));
  const last = f.context.chat![1]!;
  if (change === 'text') last.mes = content('新回复');
  if (change === 'swipe') last.swipe_id = 1;
  if (change === 'role') last.is_user = true;
  if (change === 'unfinished') delete last.gen_finished;
  await expect(f.host.applyMessageTags(f.host.session()!, tags)).rejects.toBeInstanceOf(SourceMessageChangedError);
  expect(first.extra?.tavernBattleSourceId).toBeUndefined();
});
it('自动扫描遇到保存前正文收尾，核实未落盘后直接重扫最新版本且不自动执行', async () => {
  const f = await setup(); await f.service.setStorySync(true);
  await f.emit('GENERATION_STARTED', 'normal', {}, false); await f.emit('GENERATION_AFTER_COMMANDS', 'normal', {}, false);
  const put = f.journal.put.bind(f.journal); let changed = false;
  vi.spyOn(f.journal, 'put').mockImplementation(async (...args) => {
    await put(...args); if (!changed) { changed = true; f.context.chat![0]!.mes = content('最终回复'); }
  });
  await f.emit('MESSAGE_RECEIVED', 0); await f.emit('GENERATION_ENDED', 0); await f.service.scan();
  expect(f.service.canWrite()).toBe(true); expect(f.store.hasPending()).toBe(false);
  expect(f.service.snapshot().proposals).toHaveLength(1);
  expect(f.service.snapshot().proposals![0]).toMatchObject({ source: { text: content('最终回复') }, expected: { manualOnly: true } });
  expect(f.service.snapshot().storage).toBeUndefined();
  expect(await f.journal.get(f.host.session()!.scope.key)).toBeUndefined();
});
it('回复持续变化时仅重扫一次，保持可操作，不无限重试或遗留待核实锁', async () => {
  const f = await setup(); const put = f.journal.put.bind(f.journal); let changes = 0;
  vi.spyOn(f.journal, 'put').mockImplementation(async (...args) => { await put(...args); f.context.chat![0]!.mes = content('变化' + ++changes); });
  await f.service.scan();
  expect(changes).toBe(2); expect(f.store.hasPending()).toBe(false); expect(f.service.canWrite()).toBe(true);
  expect(f.service.snapshot().proposals).toBeUndefined();
});
it('扫描期间来源被删除可安全解除未落盘候选，不制造空来源或卡住档案', async () => {
  const f = await setup(); const put = f.journal.put.bind(f.journal);
  vi.spyOn(f.journal, 'put').mockImplementation(async (...args) => { await put(...args); f.context.chat!.pop(); });
  await f.service.scan();
  expect(f.service.canWrite()).toBe(true); expect(f.store.hasPending()).toBe(false); expect(f.service.snapshot()).toEqual({});
});
it('旧待核实候选因正文变化失效，重载后点击重试即可解锁并扫描最新回复', async () => {
  const f = await setup(); f.setSave(async () => {}); await f.service.scan();
  expect(f.store.hasPending()).toBe(true);
  const oldOperation = f.store.pendingOperation()!.candidate.lastOperationId;
  f.context.chat![0]!.mes = content('后来完成的回复'); await f.service.load();
  f.setSave(f.saveNormally);
  const recovered = await f.service.retry();
  expect(recovered.status).toBe('confirmed'); expect(recovered.operationId).not.toBe(oldOperation);
  expect(f.service.canWrite()).toBe(true); expect(f.store.hasPending()).toBe(false);
  expect(f.service.snapshot().proposals).toHaveLength(1);
  expect(f.service.snapshot().proposals![0]!.source.text).toBe(content('后来完成的回复'));
  expect(f.service.snapshot().storage).toBeUndefined();
});
// Reported deadlock: the archive reached disk but the message tag did not, then the
// reply changed. Retry, discard and reload all used to stop on "已部分落盘".
it('部分落盘后来源变化，重试先撤销半存档再重扫最新回复，旧值和新值都不自动入账', async () => {
  const f = await setup(); await f.service.setStorySync(true);
  await f.emit('GENERATION_STARTED', 'normal', {}, false); await f.emit('GENERATION_AFTER_COMMANDS', 'normal', {}, false);
  f.setSave(async () => { f.disk.set('a', structuredClone(f.context.chatMetadata!)); });
  await f.emit('MESSAGE_RECEIVED', 0); await f.emit('GENERATION_ENDED', 0); await f.service.scan();
  const record = f.store.pendingOperation()!;
  expect(record.candidate.payload!.storage?.map(u => u.name)).toEqual(['旧回复']);
  expect((f.disk.get('a')!.tavernBattle as NativeEnvelope).lastOperationId).toBe(record.candidate.lastOperationId);
  f.context.chat![0]!.mes = content('新正文'); f.setSave(f.saveNormally);
  await f.service.load(); expect(f.service.status().phase).toBe('pending');
  expect((await f.service.retry()).status).toBe('confirmed');
  expect(f.store.hasPending()).toBe(false); expect(f.service.canWrite()).toBe(true);
  expect(f.service.snapshot().storage).toBeUndefined();
  expect(f.service.snapshot().proposals).toEqual([expect.objectContaining({ status: 'pending', source: expect.objectContaining({ text: content('新正文') }), expected: expect.objectContaining({ manualOnly: true }) })]);
  expect((f.disk.get('a')!.tavernBattle as NativeEnvelope).revision).toBe(record.candidate.revision + 2);
  expect(await f.journal.get(f.host.session()!.scope.key)).toBeUndefined();
});
it('部分落盘后来源被删除，重试会写回上一版存档并解锁，刷新后不再卡住', async () => {
  const f = await setup(); await f.service.transact(() => ({ factRevision: 1, field: 'forest' }));
  const before = f.store.envelope()!;
  f.setSave(async () => { f.disk.set('a', structuredClone(f.context.chatMetadata!)); });
  await f.service.scan(); const record = f.store.pendingOperation()!;
  expect((await f.service.retry()).error).toBe('存档已写入，但对应聊天消息的标记还没保存成功');
  f.context.chat!.pop(); f.setSave(f.saveNormally);
  expect((await f.service.retry()).error).toBe('这次改动对应的聊天消息已被修改、重新生成或删除，改动没有生效；请重新扫描这条消息');
  expect(f.store.hasPending()).toBe(false); expect(f.service.snapshot()).toEqual(before.payload);
  const disk = f.disk.get('a')!.tavernBattle as NativeEnvelope;
  expect(disk).toMatchObject({ documentId: before.documentId, generation: before.generation, revision: record.candidate.revision + 1, payloadHash: before.payloadHash, payload: before.payload });
  expect(disk.lastOperationId).not.toBe(record.candidate.lastOperationId);
  await f.service.load(); expect(f.service.status().phase).toBe('ready'); expect(f.service.canWrite()).toBe(true);
});
it('首次建档写到一半且来源已变：重试撤销半份存档后重新读档，回到建档选择而不是直接扫描建新档', async () => {
  const f = await setup(); const tag = prepareMessageTag(f.context.chat!, 0);
  let offered = 0; const service = new BattleService(f.host, f.store, async () => { offered++; return false; });
  cleanups.push(() => service.dispose());
  f.setSave(async () => { f.disk.set('a', structuredClone(f.context.chatMetadata!)); });
  expect((await f.store.commit(0, () => ({ factRevision: 1 }), { operationId: 'import:first', messageTags: [tag] })).status).toBe('pending');
  await service.load(); expect(service.status().phase).toBe('pending'); expect(offered).toBe(0);
  f.context.chat![0]!.mes = content('新正文'); f.setSave(f.saveNormally);
  expect(await service.retry()).toMatchObject({ status: 'conflict', code: 'source-changed' });
  expect(offered).toBe(1); expect(service.status().phase).toBe('import');
  expect(f.store.envelope()).toBeUndefined(); expect(f.disk.get('a')!.tavernBattle).toBeUndefined();
  expect(service.snapshot()).toEqual({});
});
it('宿主一直存不上消息标记时，点撤销这次改动即可解锁，刷新后不复活旧记录', async () => {
  const f = await setup(); await f.service.transact(() => ({ factRevision: 1 }));
  const before = f.store.envelope()!, key = f.host.session()!.scope.key;
  f.setSave(async () => { f.disk.set('a', structuredClone(f.context.chatMetadata!)); });
  await f.service.scan(); expect(f.store.hasPending()).toBe(true);
  vi.spyOn(f.journal, 'remove').mockRejectedValueOnce(Error('journal offline'));
  expect(await f.service.discardPending()).toEqual({ discarded: true });
  expect(f.service.status().phase).toBe('ready'); expect(f.service.snapshot()).toEqual(before.payload);
  expect(await f.journal.get(key)).toBeDefined();
  await f.service.load(); expect(f.store.hasPending()).toBe(false); expect(f.service.canWrite()).toBe(true);
  expect(f.context.chat![0]!.extra?.tavernBattleSourceId).toMatch(/^tb-source:/);
  f.setSave(f.saveNormally); await f.service.scan(); expect(f.service.snapshot().proposals).toHaveLength(1);
});
it('撤销写回没保存成功时保留原记录和原存档，稍后再次撤销即可完成', async () => {
  const f = await setup(); await f.service.transact(() => ({ factRevision: 1 }));
  const before = f.store.envelope()!, key = f.host.session()!.scope.key;
  f.setSave(async () => { f.disk.set('a', structuredClone(f.context.chatMetadata!)); });
  await f.service.scan(); const record = f.store.pendingOperation()!;
  f.setSave(async () => { throw Error('offline'); });
  await expect(f.service.discardPending()).rejects.toThrow('撤销这次改动时酒馆没有保存成功');
  expect(f.store.pendingOperation()).toEqual(record); expect(await f.journal.get(key)).toEqual(record);
  expect(f.service.snapshot()).toEqual(before.payload);
  f.setSave(f.saveNormally);
  expect(await f.service.discardPending()).toEqual({ discarded: true });
  expect(f.store.hasPending()).toBe(false); expect(f.service.snapshot()).toEqual(before.payload);
  expect(await f.journal.get(key)).toBeUndefined();
});
it('撤销时酒馆已有其他新进度：不覆盖，提示重新读取', async () => {
  const f = await setup(); await f.service.transact(() => ({ factRevision: 1 }));
  f.setSave(async () => { f.disk.set('a', structuredClone(f.context.chatMetadata!)); });
  await f.service.scan(); const record = f.store.pendingOperation()!;
  f.setSave(async () => { const newer = structuredClone(record.candidate); newer.revision += 5; f.disk.set('a', { tavernBattle: newer }); });
  await expect(f.service.discardPending()).rejects.toThrow('已被其他操作更新');
  expect((f.disk.get('a')!.tavernBattle as NativeEnvelope).revision).toBe(record.candidate.revision + 5);
  expect(f.store.pendingOperation()).toEqual(record);
});
it('自动入账保存途中回复被改写：立刻撤销半存档，只重扫成人工候选，不弹待处理', async () => {
  const f = await setup(); await f.service.setStorySync(true);
  await f.emit('GENERATION_STARTED', 'normal', {}, false); await f.emit('GENERATION_AFTER_COMMANDS', 'normal', {}, false);
  let changed = false;
  f.setSave(async () => { if (!changed) { changed = true; f.context.chat![0]!.mes = content('最终回复'); } await f.saveNormally(); });
  await f.emit('MESSAGE_RECEIVED', 0); await f.emit('GENERATION_ENDED', 0); await f.service.scan();
  expect(changed).toBe(true); expect(f.store.hasPending()).toBe(false); expect(f.service.canWrite()).toBe(true);
  expect(f.service.snapshot().storage).toBeUndefined();
  expect(f.service.snapshot().proposals).toEqual([expect.objectContaining({ status: 'pending', source: expect.objectContaining({ text: content('最终回复') }), expected: expect.objectContaining({ manualOnly: true }) })]);
  expect(f.chats.get('a')![0]!.mes).toBe(content('最终回复'));
});
it.each(['read', 'journal', 'switch', 'competing'] as const)('无法证明可安全清理时保留恢复证据：%s', async failure => {
  const f = await setup(); await f.service.transact(() => ({ factRevision: 1 }));
  const put = f.journal.put.bind(f.journal), read = f.host.readPersisted.bind(f.host);
  vi.spyOn(f.journal, 'put').mockImplementation(async (...args) => {
    await put(...args); f.context.chat![0]!.mes = content('变更');
    if (failure === 'read') vi.spyOn(f.host, 'readPersisted').mockRejectedValue(Error('offline'));
    if (failure === 'journal') vi.spyOn(f.journal, 'remove').mockRejectedValue(Error('journal offline'));
    if (failure === 'switch') f.switchTo('b');
    if (failure === 'competing') { const newer = f.store.envelope()!; newer.revision += 10; f.disk.set('a', { tavernBattle: newer }); }
  });
  await f.service.scan();
  expect(await f.journal.get(JSON.stringify(['fixture-user', 'fixture.png', 'a']))).toBeDefined();
  expect(f.service.snapshot().proposals).toBeUndefined();
  expect((await read({ ...f.store.session()!.scope, chatId: 'a' })).tavernBattle).toBeDefined();
});

it('自动入账的单位变更候选失效后，旧值和新值均不偷偷执行，重扫需人工确认', async () => {
  const f = await setup();
  const unit = generateUnit({ rulesVersion: 'v2', name: '卫兵', side: 'ally', scale: 'hero', level: 3, hpMax: 100, traits: [] }, { seed: 'source-facts' }).unit;
  unit.id = 'guard';
  await f.service.transact(() => ({ schemaVersion: 2, factRevision: 1, storage: [unitRecordFromCombatant(unit)], rosterIds: ['guard'], storySync: true }));
  f.context.chat![0]!.mes = '<tb><unit_set id="guard" hp="10"/></tb>';
  await f.emit('GENERATION_STARTED', 'normal', {}, false); await f.emit('GENERATION_AFTER_COMMANDS', 'normal', {}, false);
  const put = f.journal.put.bind(f.journal); let changed = false;
  vi.spyOn(f.journal, 'put').mockImplementation(async (...args) => {
    await put(...args);
    if (!changed) {
      expect(args[1].candidate.payload!.storage![0]!.hp).toBe(10);
      changed = true; f.context.chat![0]!.mes = '<tb><unit_set id="guard" hp="5"/></tb>';
    }
  });
  await f.emit('MESSAGE_RECEIVED', 0); await f.emit('GENERATION_ENDED', 0); await f.service.scan();
  expect(changed).toBe(true); expect(f.service.snapshot().storage![0]!.hp).toBe(100);
  expect(f.service.snapshot().proposals![0]).toMatchObject({ status: 'pending', expected: { manualOnly: true } });
  expect((await f.service.approve(f.service.snapshot().proposals![0]!.id)).status).toBe('confirmed');
  expect(f.service.snapshot().storage![0]!.hp).toBe(5);
});
