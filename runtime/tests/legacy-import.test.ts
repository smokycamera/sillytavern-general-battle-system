import { expect, it } from 'vitest';
import { LegacyImporter, MemorySourceBackups } from '../src/legacy-import.js';
import { nativeFixture } from './native-fixture.js';

async function setup(panel?: unknown) {
  const f = nativeFixture(); const backups = new MemorySourceBackups();
  f.disk.set('a', { variables: panel === undefined ? {} : { panel }, unrelated: { keep: true } });
  f.context.chatMetadata = structuredClone(f.disk.get('a')!); await f.store.load();
  return { ...f, backups, importer: new LegacyImporter(f.host, f.store, backups) };
}
it('只读当前聊天原档，完整保留来源和未知字段；确认后原变量仍在', async () => {
  const original = { schemaVersion: 2, storage: [], rosterIds: [], committedNarrativeSources: ['old-key'], customFutureField: { keep: 7 } };
  const f = await setup(original); const preview = await f.importer.preview();
  expect(preview.kind).toBe('legacy'); expect(f.disk.get('a')!.tavernBattle).toBeUndefined();
  expect((await f.importer.adopt(preview, 'import')).status).toBe('confirmed');
  expect(f.store.snapshot()).toEqual(original); expect(f.disk.get('a')!.variables).toEqual({ panel: original });
  expect(f.disk.get('a')!.unrelated).toEqual({ keep: true });
  expect((await f.backups.get(JSON.stringify([preview.session.scope.key, preview.sourceHash])))?.source).toEqual(original);
});
it('空聊天明确初始化空档，清理代次后旧变量不会重新导入', async () => {
  const f = await setup(); const preview = await f.importer.preview(); expect(preview.kind).toBe('empty');
  await f.importer.adopt(preview, 'import'); expect(f.store.snapshot()).toEqual({});
  const generation = f.store.envelope()!.generation;
  await f.store.commit(1, () => ({}), { clear: true });
  f.disk.get('a')!.variables = { panel: { field: 'forest' } };
  expect((await f.importer.preview()).kind).toBe('cleared');
  expect(f.store.envelope()!.generation).not.toBe(generation); expect(f.store.snapshot()).toEqual({});
});
it('来源变化、备份失败和聊天切换均拒绝迁移写入', async () => {
  const f = await setup({ field: 'forest' }); const preview = await f.importer.preview();
  f.disk.get('a')!.variables = { panel: { field: 'urban' } };
  await expect(f.importer.adopt(preview, 'import')).rejects.toThrow(/已变化/);
  const current = await f.importer.preview(); f.backups.put = async () => { throw Error('quota'); };
  await expect(f.importer.adopt(current, 'import')).rejects.toThrow('quota');
  expect(f.disk.get('a')!.tavernBattle).toBeUndefined();
  f.switchTo('b'); await expect(f.importer.adopt(current, 'empty')).rejects.toThrow(/切换/);
});
it('拒绝坏容器和未知版本，人工选择空状态也先备份旧档', async () => {
  for (const value of [null, [], 'invalid', { schemaVersion: 99 }]) {
    const f = await setup(value); await expect(f.importer.preview()).rejects.toThrow(); expect(f.store.envelope()).toBeUndefined();
  }
  const f = await setup({ field: 'forest' }); const preview = await f.importer.preview();
  await f.importer.adopt(preview, 'empty'); expect(f.store.snapshot()).toEqual({});
  expect((await f.backups.get(JSON.stringify([preview.session.scope.key, preview.sourceHash])))?.source.field).toBe('forest');
});
it('迁移旧已提交楼层时一并绑定稳定来源，删楼层后不会重新建立同一单位', async () => {
  const f = await setup();
  f.context.chat!.push({ mes: '<tb><spawn name="旧已入账" side="ally" scale="hero"/></tb>', is_user: false, swipe_id: 0, gen_finished: 'done' });
  const sourceKey = JSON.stringify([f.host.namespace(), '0']);
  const source = { schemaVersion: 2, storage: [], committedNarrativeSources: [sourceKey] };
  f.disk.set('a', { variables: { panel: source } }); f.context.chatMetadata = structuredClone(f.disk.get('a')!); await f.store.load();
  const preview = await f.importer.preview(); expect((await f.importer.adopt(preview, 'import')).status).toBe('confirmed');
  const keys = f.store.snapshot().committedNarrativeSources!;
  expect(keys).toHaveLength(2); expect(keys.some(key => key.includes('tb-source:'))).toBe(true);
  await f.service.load(); await f.service.scan(0); expect(f.service.snapshot().proposals).toBeUndefined();
  expect(f.context.chat![0]!.extra?.tavernBattleSourceId).toMatch(/^tb-source:/);
  f.service.dispose();
});
