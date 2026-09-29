import { afterEach, expect, it } from 'vitest';
import { nativeFixture } from './native-fixture.js';
import { generateUnit } from '../../engine/src/index.js';
import { unitRecordFromCombatant } from '../../panel/src/unit-state.js';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach(stop => stop()));
async function setup() {
  const f = nativeFixture(); cleanups.push(() => f.service.dispose()); await f.service.start();
  const units = ['ally', 'enemy'].map((side, index) => {
    const unit = generateUnit({ rulesVersion: 'v2', name: `旧军${index}`, side: side as 'ally' | 'enemy', scale: 'hero', level: 3, traits: [] }, { seed: `old-${index}` }).unit;
    unit.id = `old-${index}`; return unit;
  });
  await f.service.transact(() => ({ schemaVersion: 2, factRevision: 1, storage: units.map(u => unitRecordFromCombatant(u)), rosterIds: units.map(u => u.id) }));
  return f;
}
async function scan(f: Awaited<ReturnType<typeof setup>>, text: string) {
  const index = f.context.chat!.length;
  f.context.chat!.push({ mes: `<tb>${text}</tb>`, is_user: false, swipe_id: 0, gen_finished: 'finished' });
  await f.service.scan(index, { manual: true });
  const proposal = f.service.snapshot().proposals!.at(-1)!; expect(proposal.status).toBe('pending'); return proposal;
}
it('原生确认新批替换双方旧名单，刷新保持；恢复原批不带上其他批单位', async () => {
  const f = await setup();
  const first = await scan(f, '<spawn name="新友军" side="ally" scale="hero"/><spawn name="新敌军" side="enemy" scale="hero"/>');
  expect((await f.service.approve(first.id)).status).toBe('confirmed');
  const firstSave = f.service.snapshot(); expect(firstSave.rosterIds).toHaveLength(2); expect(firstSave.storage).toHaveLength(4);
  expect(firstSave.rosterIds).not.toContain('old-0'); expect(firstSave.rosterIds).not.toContain('old-1');
  await f.service.load(); expect(f.service.snapshot().rosterIds).toEqual(firstSave.rosterIds);
  const second = await scan(f, '<deploy id="old-0"/><deploy id="old-1"/>');
  expect((await f.service.approve(second.id)).status).toBe('confirmed'); expect(f.service.snapshot().rosterIds).toEqual(['old-0', 'old-1']);
  const before = f.service.snapshot(); expect((await f.service.restoreDeployment(first.id)).status).toBe('confirmed');
  expect(f.service.snapshot().rosterIds).toEqual(firstSave.rosterIds); expect(f.service.snapshot().storage).toEqual(before.storage);
  await f.service.load(); expect(f.service.snapshot().rosterIds).toEqual(firstSave.rosterIds);
  await f.service.scan(1, { manual: true }); expect(f.service.snapshot().rosterIds).toEqual(firstSave.rosterIds);
  expect(f.service.snapshot().storage).toHaveLength(4);
});
it('新名单保存未确认时仍展示旧名单；重试只提交同一候选一次', async () => {
  const f = await setup();
  const p = await scan(f, '<spawn name="新友军" side="ally" scale="hero"/><spawn name="新敌军" side="enemy" scale="hero"/>');
  const before = f.service.snapshot(); f.setSave(async () => {});
  expect((await f.service.approve(p.id)).status).toBe('pending'); expect(f.service.snapshot()).toEqual(before);
  const candidate = f.store.pendingOperation()!.candidate.payload!;
  expect(candidate.rosterIds).toHaveLength(2); expect(candidate.rosterIds).not.toContain('old-0');
  f.setSave(async () => { f.disk.set('a', structuredClone(f.context.chatMetadata!)); });
  expect((await f.service.retry()).status).toBe('confirmed'); expect(f.service.snapshot()).toEqual(candidate);
  await f.service.load(); expect(f.service.snapshot().rosterIds).toEqual(candidate.rosterIds); expect(f.service.snapshot().storage).toHaveLength(4);
});
