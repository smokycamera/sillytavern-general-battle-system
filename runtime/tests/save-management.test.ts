import { expect, it } from 'vitest';
import { nativeFixture } from './native-fixture.js';
import { MemorySourceBackups } from '../src/legacy-import.js';
import { SaveManagement } from '../src/save-management.js';
import { decodeSave } from '../../panel/src/storage-codec.js';

async function setup() {
  const f = nativeFixture(); await f.store.load();
  await f.store.commit(0, () => ({ schemaVersion: 2, storage: [], rosterIds: [], field: 'forest', customValue: '保留' }));
  const backups = new MemorySourceBackups(); const manager = new SaveManagement(f.host, f.store, backups);
  return { ...f, backups, manager };
}
it('清理先备份并创建新代次，刷新后不会从旧变量恢复', async () => {
  const f = await setup(); const old = f.store.envelope()!;
  f.context.chatMetadata!.variables = { panel: { field: 'urban' } };
  const preview = f.manager.previewClear(); expect(preview.kind).toBe('clear');
  expect((await f.manager.apply(preview)).status).toBe('confirmed');
  expect(f.store.envelope()!.state).toBe('cleared'); expect(f.store.envelope()!.generation).not.toBe(old.generation);
  await f.store.load(); expect(f.store.snapshot()).toEqual({});
  const key = JSON.stringify(['native-before-change', f.store.session()!.scope.key, old.generation, old.revision]);
  expect((await f.backups.get(key))?.source.customValue).toBe('保留');
});
it('导出再导入保留未知字段并新建代次；坏版本/校验和/脚本文件不被当成档案', async () => {
  const f = await setup(); const old = f.store.envelope()!; const data = f.manager.exportCurrent();
  await f.manager.apply(f.manager.previewClear());
  const preview = await f.manager.previewFile(JSON.stringify(data)); await f.manager.apply(preview);
  expect(f.store.snapshot()).toEqual(old.payload); expect(f.store.envelope()!.generation).not.toBe(old.generation);
  for (const value of [{ format: 'tavern-battle-native', containerVersion: 99 }, { ...old, payload: { field: 'tampered' } }, { content: 'script body', data: {} }]) await expect(f.manager.previewFile(JSON.stringify(value))).rejects.toThrow();
});
it('备份写失败或预览期间切聊天时不执行清理', async () => {
  const f = await setup(); const preview = f.manager.previewClear();
  f.backups.put = async () => { throw Error('quota'); };
  await expect(f.manager.apply(preview)).rejects.toThrow('quota'); expect(f.store.snapshot().field).toBe('forest');
  f.switchTo('b'); await expect(f.manager.apply(preview)).rejects.toThrow(/变化/);
});
it('兼容回退携带最新原生进度并同步旧镜像；原生停止写入，迁回采用旧阶段新进度', async () => {
  const f = await setup();
  const preview = await f.manager.previewRollback();
  expect((await f.manager.apply(preview)).status).toBe('confirmed'); expect(f.store.envelope()?.handoff?.target).toBe('helper');
  const panel = (f.disk.get('a')!.variables as { panel: Record<string, unknown> }).panel;
  expect(panel.customValue).toBe('保留'); expect(panel.field).toBe('forest');
  expect(JSON.parse(decodeSave(f.local.get('tavern-battle:chat:chat:a:panel')!))).toEqual(panel);
  expect((await f.store.commit(f.store.envelope()!.revision, () => ({ field: 'blocked' }))).status).toBe('conflict');
  panel.field = 'urban'; f.context.chatMetadata = structuredClone(f.disk.get('a')!); await f.store.load();
  const resume = await f.manager.previewResume(); await f.manager.apply(resume);
  expect(f.store.snapshot().field).toBe('urban'); expect(f.store.envelope()?.handoff).toBeUndefined();
});
it('无法确认镜像归属时拒绝自动回退；回退保存失败保留同一候选可恢复', async () => {
  const f = await setup(); f.local.set('tavern-battle:chat:chat:a:panel', JSON.stringify({ storage: ['other-chat'] }));
  await expect(f.manager.previewRollback()).rejects.toThrow(/无法确认归属/);
  f.local.delete('tavern-battle:chat:chat:a:panel'); const preview = await f.manager.previewRollback();
  f.setSave(async () => {}); expect((await f.manager.apply(preview)).status).toBe('pending');
  const id = f.store.pendingOperation()!.candidate.lastOperationId; f.setSave(f.saveNormally);
  expect((await f.store.retry()).status).toBe('confirmed'); expect(f.store.envelope()!.lastOperationId).toBe(id);
});
it('空档回退生成旧版真正空档，两边都不会采用历史单位', async () => {
  const f = await setup(); await f.manager.apply(f.manager.previewClear()); await f.manager.apply(await f.manager.previewRollback());
  const panel = (f.disk.get('a')!.variables as { panel: Record<string, unknown> }).panel;
  expect(panel.storage).toEqual([]); expect(panel.inventory).toEqual([]); expect(f.store.envelope()!.state).toBe('cleared');
});
