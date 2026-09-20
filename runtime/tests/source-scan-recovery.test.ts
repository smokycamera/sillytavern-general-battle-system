import { generateUnit } from '../../engine/src/index.js';
import { unitRecordFromCombatant } from '../../panel/src/unit-state.js';
import { afterEach, expect, it, vi } from 'vitest';
import { nativeFixture } from './native-fixture.js';
import { prepareMessageTag, SourceMessageChangedError } from '../../host/src/message-identity.js';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach(stop => stop()));
const content = (name: string) => `<tb>\n<spawn name="${name}" side="ally" scale="hero"/>\n</tb>`;
async function setup() {
  const f = nativeFixture(); cleanups.push(() => f.service.dispose()); await f.service.start();
  f.context.chat!.push({ is_user: false, mes: content('旧回复'), swipe_id: 0, send_date: 'date', gen_finished: 'first-time' });
  return f;
}
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
it('候选已部分落盘时不因来源变化自动丢弃或重新入账', async () => {
  const f = await setup(); f.setSave(async () => { f.disk.set('a', structuredClone(f.context.chatMetadata!)); });
  await f.service.scan(); const record = f.store.pendingOperation()!;
  f.context.chat![0]!.mes = content('新正文'); f.setSave(f.saveNormally);
  expect((await f.service.retry()).status).toBe('pending');
  expect(f.store.pendingOperation()!.candidate).toEqual(record.candidate);
  expect(f.service.snapshot().proposals).toBeUndefined(); expect(f.service.canWrite()).toBe(false);
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
