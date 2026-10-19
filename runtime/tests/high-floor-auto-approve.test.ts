import { afterEach, expect, it, vi } from 'vitest';
import type { NativeEnvelope } from '../../host/src/contracts.js';
import { nativeFixture } from './native-fixture.js';

// Long chats save slowly, so the host's own work lands inside our save: it swaps in new objects
// for the same chat (TauriTavern updateChatMetadata, other extensions) or rewrites the reply text.
const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach(stop => stop()));
type Fixture = ReturnType<typeof nativeFixture>;
async function setup() { const f = nativeFixture(); cleanups.push(() => f.service.dispose()); await f.service.start(); await f.service.setStorySync(true); return f; }
const reply = (name: string, prose = '') => `${prose}<tb><spawn name="${name}" side="ally" scale="hero"/></tb>`;
const start = async (f: Fixture) => { await f.emit('GENERATION_STARTED', 'normal', {}, false); await f.emit('GENERATION_AFTER_COMMANDS', 'normal', {}, false); f.context.chat!.push({ mes: '继续', is_user: true }); };
/** SillyTavern/TauriTavern streaming order: GENERATION_ENDED before MESSAGE_RECEIVED. */
const receive = async (f: Fixture, text: string) => {
  f.context.chat!.push({ mes: text, is_user: false, swipe_id: 0, send_date: 'now-' + f.context.chat!.length, gen_finished: 'done' });
  await f.emit('GENERATION_ENDED', f.context.chat!.length); await f.emit('MESSAGE_RECEIVED', f.context.chat!.length - 1, 'normal');
};
const generate = async (f: Fixture, text: string) => { await start(f); await receive(f, text); };
const swap = (f: Fixture) => { f.context.chatMetadata = { ...f.context.chatMetadata, otherExtension: 1 }; };
const last = (f: Fixture) => f.service.snapshot().proposals?.at(-1);
const diskHead = (f: Fixture) => f.disk.get('a')!.tavernBattle as NativeEnvelope;

it.each(['save', 'journal'] as const)('慢保存期间宿主换入同一聊天的附加数据对象（%s），这条和下一条回复都自动入账', async when => {
  const f = await setup();
  let swaps = 0;
  if (when === 'save') f.setSave(async () => { if (!swaps++) swap(f); await f.saveNormally(); });
  else { const put = f.journal.put.bind(f.journal); vi.spyOn(f.journal, 'put').mockImplementation(async (...args) => { await put(...args); if (!swaps++) swap(f); }); }
  await generate(f, reply('第一位'));
  await vi.waitFor(() => expect(f.service.snapshot().proposals?.[0]?.status).toBe('committed'));
  expect(swaps).toBe(1); expect(f.store.hasPending()).toBe(false); expect(f.service.canWrite()).toBe(true);
  expect(await f.journal.get(f.host.session()!.scope.key)).toBeUndefined();
  await generate(f, reply('第二位'));
  await vi.waitFor(() => expect(f.service.snapshot().proposals?.[1]?.status).toBe('committed'));
  expect(f.service.snapshot().storage?.map(u => u.name)).toEqual(['第一位', '第二位']);
  expect(f.context.chatMetadata!.otherExtension).toBe(1);
});

it('保存途中宿主换入旧副本、没带上这次写入：整段补写一次后确认，宿主之后的保存也不会写回旧档', async () => {
  const f = await setup();
  const stale = structuredClone(f.context.chatMetadata!);
  let swapped = false;
  f.setSave(async () => { if (!swapped) { swapped = true; f.context.chatMetadata = { ...structuredClone(stale), otherExtension: 1 }; } await f.saveNormally(); });
  await generate(f, reply('卫兵'));
  await vi.waitFor(() => expect(last(f)?.status).toBe('committed'));
  expect(swapped).toBe(true); expect(f.service.canWrite()).toBe(true);
  const head = f.store.envelope()!;
  expect((f.context.chatMetadata!.tavernBattle as NativeEnvelope).lastOperationId).toBe(head.lastOperationId);
  f.setSave(f.saveNormally); await f.context.saveChat!();
  expect(diskHead(f).lastOperationId).toBe(head.lastOperationId);
});

it('保存途中只有标签外的正文被改写，事件不变，仍自动入账', async () => {
  const f = await setup();
  let changed = false;
  f.setSave(async () => { if (!changed) { changed = true; f.context.chat!.at(-1)!.mes = reply('卫兵', '（状态栏已刷新）'); } await f.saveNormally(); });
  await generate(f, reply('卫兵'));
  await vi.waitFor(() => expect(last(f)?.status).toBe('committed'));
  expect(changed).toBe(true); expect(f.service.snapshot().storage?.map(u => u.name)).toEqual(['卫兵']);
  expect(f.service.snapshot().proposals).toHaveLength(1);
});

it('保存途中回复里的事件被改动：不自动执行旧值或新值，人工确认并写明原因', async () => {
  const f = await setup();
  let changed = false;
  f.setSave(async () => { if (!changed) { changed = true; f.context.chat!.at(-1)!.mes = reply('改名卫兵'); } await f.saveNormally(); });
  await generate(f, reply('卫兵'));
  await vi.waitFor(() => expect(last(f)?.source.text).toContain('改名卫兵'));
  expect(f.service.snapshot().storage).toBeUndefined();
  expect(last(f)).toMatchObject({ status: 'pending', expected: { manualOnly: true } });
  expect(last(f)!.reason).toContain('保存途中回复里的事件被改动');
});

it('生成途中宿主换入不含存档的对象：回复时重读到同一份存档，照常自动入账，并把存档补回新对象', async () => {
  const f = await setup(); const head = f.store.envelope()!;
  await start(f);
  f.context.chatMetadata = { otherExtension: 1 };
  expect(f.service.canWrite()).toBe(false);
  await receive(f, reply('卫兵'));
  await vi.waitFor(() => expect(last(f)?.status).toBe('committed'));
  expect(f.service.snapshot().storage?.map(u => u.name)).toEqual(['卫兵']);
  expect(f.context.chatMetadata!.otherExtension).toBe(1);
  expect((f.context.chatMetadata!.tavernBattle as NativeEnvelope).documentId).toBe(head.documentId);
  expect(f.service.canWrite()).toBe(true);
});

it('生成途中存档被整份替换：重读后不沿用旧绑定，只给人工确认并写明原因', async () => {
  const f = await setup();
  await start(f);
  const replaced = { ...structuredClone(diskHead(f)), generation: 'replaced-elsewhere' };
  f.disk.set('a', { ...f.disk.get('a'), tavernBattle: replaced });
  f.context.chatMetadata = { tavernBattle: structuredClone(replaced) };
  await receive(f, reply('卫兵'));
  await vi.waitFor(() => expect(last(f)?.status).toBe('pending'));
  expect(f.store.envelope()!.generation).toBe('replaced-elsewhere');
  expect(last(f)).toMatchObject({ expected: { manualOnly: true } });
  expect(last(f)!.reason).toContain('生成期间档案被替换');
  expect(f.service.snapshot().storage).toBeUndefined();
});

it('生成开始时上一次保存还没确认：这条回复只给人工确认，原因写明是哪一步', async () => {
  const f = await setup();
  f.setSave(async () => {});
  expect((await f.service.transact(before => ({ ...before, field: 'forest' }))).status).toBe('pending');
  await start(f);
  f.setSave(f.saveNormally); expect((await f.service.retry()).status).toBe('confirmed');
  await receive(f, reply('卫兵'));
  await vi.waitFor(() => expect(last(f)?.status).toBe('pending'));
  expect(last(f)!.reason).toContain('这条没有自动入账：生成开始时上一次保存还没确认');
});

it('慢保存进行中显示“正在保存”，面板收到通知；保存完才恢复可写，不提示“上一次保存还没确认成功”', async () => {
  const f = await setup();
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  f.setSave(async () => { await gate; await f.saveNormally(); });
  const seen: boolean[] = []; f.service.listen(() => { seen.push(f.service.saving()); });
  await generate(f, reply('卫兵'));
  await vi.waitFor(() => expect(f.store.hasPending()).toBe(true));
  expect(f.service.saving()).toBe(true); expect(seen).toContain(true);
  expect(f.service.writeBlockReason()).toBe('正在保存上一项改动，请稍候');
  release();
  await vi.waitFor(() => expect(last(f)?.status).toBe('committed'));
  expect(f.service.saving()).toBe(false); expect(f.service.writeBlockReason()).toBeUndefined();
  f.setSave(async () => {});
  expect((await f.service.transact(before => ({ ...before, field: 'forest' }))).status).toBe('pending');
  expect(f.service.writeBlockReason()).toBe('上一次保存还没确认成功，请先处理上方提示');
});

it('宿主把这次保存跳过了（SillyTavern 等前一次保存超过 1 秒就放弃）：读回仍是旧档时整段补写一次，照常自动入账', async () => {
  const f = await setup();
  let saves = 0;
  f.setSave(async () => { if (saves++) await f.saveNormally(); });
  await generate(f, reply('卫兵'));
  await vi.waitFor(() => expect(last(f)?.status).toBe('committed'));
  expect(saves).toBe(2); expect(f.store.hasPending()).toBe(false); expect(f.service.canWrite()).toBe(true);
  expect(f.chats.get('a')!.at(-1)!.extra?.tavernBattleSourceId).toMatch(/^tb-source:/);
});
