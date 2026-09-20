import { afterEach, expect, it, vi } from 'vitest';
import { nativeFixture } from './native-fixture.js';
import { generateUnit, SmallBattle, V4_OVERFLOW_D20 } from '../../engine/src/index.js';
import { unitRecordFromCombatant } from '../../panel/src/unit-state.js';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach(stop => stop()));
async function setup() { const f = nativeFixture(); cleanups.push(() => f.service.dispose()); await f.service.start(); return f; }
it('持久化等待期间只发布旧事实，失败后重试沿用库存候选且只扣一次', async () => {
  const f = await setup();
  await f.service.inventoryAction({ id: 'create', expectedRevision: 0, kind: 'create', itemId: 'potion', name: '药剂', qty: 3, spec: { kind: 'consumable', mechanism: 'heal', power: 3 } });
  const before = f.service.snapshot(); const preview = f.service.previewInventory({ kind: 'discard', itemId: 'potion', qty: 1 }, 'discard');
  f.setSave(async () => {});
  const listener = vi.fn(); f.service.listen(listener);
  expect((await f.service.commitInventoryPreview(preview)).status).toBe('pending');
  expect(f.service.status().phase).toBe('pending'); expect(f.service.snapshot()).toEqual(before);
  expect(listener.mock.calls.at(-1)![0].save).toEqual(before);
  expect(() => f.service.previewInventory({ kind: 'discard', itemId: 'potion', qty: 1 })).toThrow(/尚未就绪/);
  f.setSave(async () => { f.disk.set('a', structuredClone(f.context.chatMetadata!)); });
  expect((await f.service.retry()).status).toBe('confirmed');
  expect(f.service.snapshot().inventory?.find(i => i.id === 'potion')?.qty).toBe(2);
  expect((await f.service.commitInventoryPreview(preview)).status).toBe('confirmed');
  expect(f.service.snapshot().inventory?.find(i => i.id === 'potion')?.qty).toBe(2);
});
it('同版本并发命令只接受一笔，旧聊天的预览不能跨上下文提交', async () => {
  const f = await setup(); const version = f.service.version();
  const receipts = await Promise.all([f.service.transact(before => ({ ...before, field: 'forest' }), { version }), f.service.transact(before => ({ ...before, field: 'mountain' }), { version })]);
  expect(receipts.map(r => r.status)).toEqual(['confirmed', 'conflict']);
  f.switchTo('b'); await f.service.load();
  expect((await f.service.transact(() => ({ field: 'urban' }), { version })).status).toBe('conflict');
  expect(f.service.snapshot()).toEqual({}); expect(f.disk.has('b')).toBe(false);
});
it('未保存的战斗候选不改变权威 RNG、动作和日志，重试不重掷', async () => {
  const f = await setup();
  const units = ['ally', 'enemy'].map((side, index) => { const unit = generateUnit({ rulesVersion: 'v2', name: side, side: side as 'ally' | 'enemy', scale: 'hero', level: 3, traits: [] }, { seed: side }).unit; unit.id = 'u' + index; return unit; });
  const battle = new SmallBattle({ combatants: units, seed: 'native-battle', rules: V4_OVERFLOW_D20 }); battle.start();
  await f.service.transact(() => ({ schemaVersion: 2, storage: units.map(unit => unitRecordFromCombatant(unit)), rosterIds: units.map(unit => unit.id), battle: { kind: 'small', snap: battle.toSnapshot() } }));
  const before = f.service.snapshot(); f.setSave(async () => {}); let computations = 0;
  const receipt = await f.service.transact(save => { computations++; const candidate = SmallBattle.fromSnapshot(save.battle!.snap); candidate.autoAction(candidate.active!.id); return { ...save, battle: { kind: 'small', snap: candidate.toSnapshot() } }; });
  expect(receipt.status).toBe('pending'); expect(f.service.snapshot()).toEqual(before);
  const candidate = f.store.pendingOperation()!.candidate.payload!;
  f.setSave(async () => { f.disk.set('a', structuredClone(f.context.chatMetadata!)); }); await f.service.retry();
  expect(f.service.snapshot()).toEqual(candidate); expect(computations).toBe(1);
});
it('原生正文产生候选，人工确认入账后编辑和重扫均不重复生成', async () => {
  const f = await setup();
  await f.emit('GENERATION_STARTED', 'normal', {}, false); await f.emit('GENERATION_AFTER_COMMANDS', 'normal', {}, false);
  f.context.chat!.push({ mes: '<tb><spawn name="测试卫兵" side="ally" scale="hero"/></tb>', is_user: false, swipe_id: 0, gen_finished: 'finished' });
  await f.emit('MESSAGE_RECEIVED', 0); await f.emit('GENERATION_ENDED', 0); await f.service.scan(0);
  const proposal = f.service.snapshot().proposals?.[0]!; expect(proposal.status).toBe('pending'); expect(proposal.expected?.manualOnly).not.toBe(true);
  expect((await f.service.approve(proposal.id)).status).toBe('confirmed'); expect(f.service.snapshot().storage).toHaveLength(1);
  f.context.chat![0]!.mes = '<tb><spawn name="另一个卫兵" side="ally" scale="hero"/></tb>';
  await f.emit('MESSAGE_EDITED', 0); await f.service.scan(0);
  expect(f.service.snapshot().storage).toHaveLength(1);
  f.service.dispose(); expect([...f.handlers.values()].every(set => set.size === 0)).toBe(true);
});
it('启动后仅扫描完整历史消息会标记为人工预览，不自动入账', async () => {
  const f = await setup(); await f.service.setStorySync(true);
  f.context.chat!.push({ mes: '<tb><field env="forest"/></tb>', is_user: false, swipe_id: 0, gen_finished: 'finished' });
  await f.service.scan(); expect(f.service.snapshot().proposals?.[0]?.expected?.manualOnly).toBe(true);
  expect(f.service.snapshot().field).toBeUndefined();
});
it('批准候选在恢复日志落盘期间遇到来源编辑，不发布已经过时的事实', async () => {
  const f = await setup();
  f.context.chat!.push({ mes: '<tb><spawn name="旧正文" side="ally" scale="hero"/></tb>', is_user: false, swipe_id: 0, gen_finished: 'finished' });
  await f.service.scan(); const proposal = f.service.snapshot().proposals![0]!;
  const put = f.journal.put.bind(f.journal);
  vi.spyOn(f.journal, 'put').mockImplementation(async (...args) => {
    await put(...args); f.context.chat![0]!.mes = '<tb><spawn name="编辑后的正文" side="ally" scale="hero"/></tb>';
  });
  expect(await f.service.approve(proposal.id)).toMatchObject({ status: 'conflict', code: 'source-changed' });
  expect(f.service.snapshot().storage).toBeUndefined();
  expect(f.store.hasPending()).toBe(false); expect(f.service.canWrite()).toBe(true);
});
it('删去前方楼层后消息身份保持不变；删除待审消息则拒绝批准', async () => {
  const f = await setup();
  f.context.chat!.push({ mes: '占位', is_user: true }, { mes: '<tb><spawn name="移动楼层" side="ally" scale="hero"/></tb>', is_user: false, swipe_id: 0, gen_finished: 'done' });
  await f.service.scan(1); const proposal = f.service.snapshot().proposals![0]!;
  expect(proposal.source.messageId).toMatch(/^tb-source:/);
  f.context.chat!.splice(0, 1); await f.emit('MESSAGE_DELETED'); await f.service.reconcileDeletedMessages();
  expect((await f.service.approve(proposal.id)).status).toBe('confirmed');
  await f.service.scan(0); expect(f.service.snapshot().storage).toHaveLength(1);
  f.context.chat!.push({ mes: '<tb><spawn name="已删除" side="ally" scale="hero"/></tb>', is_user: false, swipe_id: 0, gen_finished: 'done' });
  await f.service.scan(1); const removed = f.service.snapshot().proposals!.at(-1)!;
  f.context.chat!.pop(); await f.service.reconcileDeletedMessages();
  expect((await f.service.approve(removed.id)).status).toBe('failed'); expect(f.service.snapshot().storage).toHaveLength(1);
});
it('复制聊天继承稳定来源凭据，不因新 namespace 重复入账', async () => {
  const f = await setup();
  f.context.chat!.push({ mes: '<tb><spawn name="分支继承" side="ally" scale="hero"/></tb>', is_user: false, swipe_id: 0, gen_finished: 'done' });
  await f.service.scan(); await f.service.approve(f.service.snapshot().proposals![0]!.id);
  f.disk.set('branch', structuredClone(f.disk.get('a')!)); f.chats.set('branch', structuredClone(f.context.chat!));
  f.switchTo('branch'); await f.service.load(); await f.service.scan();
  expect(f.service.snapshot().storage).toHaveLength(1); expect(f.service.snapshot().proposals).toHaveLength(1);
});
it('消息身份和入账同次保存；只保存元数据不能得到成功回执', async () => {
  const f = await setup(); f.context.chat!.push({ mes: '<tb><spawn name="待核实来源" side="ally" scale="hero"/></tb>', is_user: false, swipe_id: 0, gen_finished: 'done' });
  f.setSave(async () => { f.disk.set('a', structuredClone(f.context.chatMetadata!)); });
  await f.service.scan(); expect(f.service.status().phase).toBe('pending'); expect(f.service.snapshot().proposals).toBeUndefined();
  await f.service.load(); expect(f.service.status().phase).toBe('pending'); expect(f.service.snapshot().proposals).toBeUndefined();
  f.setSave(f.saveNormally); expect((await f.service.retry()).status).toBe('confirmed');
  expect(f.service.snapshot().proposals).toHaveLength(1);
});
