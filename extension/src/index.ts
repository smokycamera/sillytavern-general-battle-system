import { createNativeHost, type HostWindow } from '../../host/src/sillytavern.js';
import { NativeMessages } from '../../host/src/messages.js';
import { NativeStore } from '../../runtime/src/native-store.js';
import { IndexedDbJournal } from '../../runtime/src/recovery-journal.js';
import { LegacyImporter, IndexedDbSourceBackups, type ImportPreview } from '../../runtime/src/legacy-import.js';
import { BattleService } from '../../runtime/src/battle-service.js';
import { PanelHost } from './panel-host.js';
import type { NativeRuntime } from './panel-runtime.js';
import { SaveManagement, type SaveChangePreview } from '../../runtime/src/save-management.js';
import { preferences } from './preferences.js';

const windowHost = window as unknown as HostWindow & { __tavernBattleNative?: NativeRuntime };
windowHost.__tavernBattleNative?.dispose();
const panelPath = 'panel/index.html';
const panel = new PanelHost(new URL(panelPath, import.meta.url).href, preferences(windowHost));
let disposed = false; let unlock = () => {}; let stop = () => {}; let service: BattleService | undefined;
const exportData = (name: string, value: unknown) => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
const dispose = () => { if (disposed) return; disposed = true; stop(); service?.dispose(); panel.dispose(); unlock(); if (windowHost.__tavernBattleNative?.dispose === dispose) delete windowHost.__tavernBattleNative; window.removeEventListener('pagehide', dispose); };
window.addEventListener('pagehide', dispose);

async function acquireWriter(): Promise<boolean> {
  if (!navigator.locks) return true; // One instance only is supported on hosts without Web Locks.
  return new Promise((resolve, reject) => {
    void navigator.locks.request('tavern-battle-native:writer', { mode: 'exclusive', ifAvailable: true }, async lock => {
      if (!lock) { resolve(false); return; }
      await new Promise<void>(release => { unlock = release; resolve(true); });
    }).catch(reject);
  });
}
async function start() {
  if (!(await acquireWriter())) { panel.showStatus('另一个酒馆窗口已在运行原生战阵。请在该窗口继续，或关闭后刷新这里。', [], true); return; }
  const host = await createNativeHost(windowHost);
  if (disposed) { host.dispose(); unlock(); return; }
  const store = new NativeStore(host, new IndexedDbJournal());
  const backups = new IndexedDbSourceBackups();
  const importer = new LegacyImporter(host, store, backups);
  const management = new SaveManagement(host, store, backups);
  let preview: ImportPreview | undefined;
  service = new BattleService(host, store, async () => {
    preview = await importer.preview();
    if (preview.kind === 'empty') return (await importer.adopt(preview, 'import')).status === 'confirmed';
    return false;
  });
  const current = service;
  windowHost.__tavernBattleNative = { service: current, messages: new NativeMessages(host, () => current.canWrite()), open: () => panel.open(), close: () => panel.close(), dispose };
  const reload = async () => { preview = undefined; await current.load(); };
  const exportCurrent = () => exportData('tavern-battle-native-backup.json', preview?.source && !store.envelope()
    ? { format: 'tavern-battle-export', version: 1, exportedAt: new Date().toISOString(), scope: host.session()?.scope, legacy: preview.source }
    : management.exportCurrent());
  const showChange = (change: SaveChangePreview) => {
    const label = ({ clear: '清空当前聊天战阵数据', file: '导入文件并替换当前档案', rollback: '把最新进度交回旧脚本', resume: '采用旧脚本阶段进度并迁回原生' })[change.kind];
    const counts = (value: SaveChangePreview['before']) => `${value.units} 个单位、${value.inventory} 项库存、${value.reports} 份战报${value.battle ? '，含战斗' : ''}`;
    panel.showStatus(`${label}\n当前：${counts(change.before)}\n操作后：${counts(change.after)}${change.sourceChat ? '\n文件来源聊天：' + change.sourceChat : ''}\n${change.changes.join('\n')}\n操作前会保存并核实当前档案备份。`, [
      { label: '导出当前档案', run: exportCurrent },
      { label: '确认' + label, run: async () => { const receipt = await management.apply(change); if (receipt.status === 'failed' || receipt.status === 'conflict') throw Error(receipt.error ?? '操作未保存'); await current.load(); } },
      { label: '取消', run: showManagement },
    ], true);
  };
  const chooseFile = () => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.json,application/json';
    input.addEventListener('change', async () => {
      const file = input.files?.[0]; if (!file) return;
      try { showChange(await management.previewFile(await file.text())); }
      catch (error) { panel.showStatus(String(error), [{ label: '返回存档管理', run: showManagement }], true); }
    }, { once: true }); input.click();
  };
  function showManagement() {
    panel.showStatus('存档操作只针对当前聊天。导入、清空和回退均先预览、备份，再核实保存结果。', [
      { label: '导出完整原生存档', run: exportCurrent },
      { label: '导入存档文件', run: chooseFile },
      { label: '导出旧版兼容存档', run: () => exportData('tavern-battle-legacy-panel.json', management.exportLegacy()) },
      { label: store.envelope()?.handoff ? '预览迁回原生' : '预览回退旧脚本', run: async () => showChange(await (store.envelope()?.handoff ? management.previewResume() : management.previewRollback())) },
      { label: '预览清空当前战阵', run: () => showChange(management.previewClear()) },
      { label: '返回面板', run: reload },
    ], true);
  }
  panel.setManagementHandler(showManagement);
  const adopt = async (choice: 'import' | 'empty') => {
    if (!preview) throw Error('迁移预览已失效，请重新读取');
    const receipt = await importer.adopt(preview, choice);
    if (receipt.status === 'failed' || receipt.status === 'conflict') throw Error(receipt.error ?? '迁移未保存');
    await reload();
  };
  stop = current.listen(state => {
    if (host.hasLegacyRuntime()) { panel.showStatus('检测到旧战阵脚本仍在运行。停用该脚本后刷新页面，再使用原生扩展。', [{ label: '导出当前档案', run: exportCurrent }], true); return; }
    if (state.phase === 'loading') panel.showStatus('正在读取当前聊天档案…', [], true);
    else if (state.phase === 'import') {
      const info = preview?.counts;
      const details = preview?.review?.changes.join('；');
      panel.showStatus(`当前聊天发现旧战阵存档：${info?.units ?? 0} 个单位、${info?.inventory ?? 0} 项库存、${info?.reports ?? 0} 份战报${info?.battle ? '，含进行中的战斗' : ''}。采用前会保存原档备份。${details ? '\n需要核对的调整：' + details : ''}`, [
        { label: '导出原档备份', run: exportCurrent }, { label: '采用当前聊天旧档', run: () => adopt('import') }, { label: '从空档开始', run: () => adopt('empty') },
      ], true);
    } else if (state.phase === 'pending') panel.showStatus('上一笔保存尚待核实，已保留待确认内容并暂停后续操作。' + (state.receipt?.error ? '\n原因：' + state.receipt.error : ''), [{ label: '核实并重试保存', run: async () => { const receipt = await current.retry(); if (receipt.status === 'confirmed') await current.load(); } },
      ...(!store.pendingOperation()?.legacyHandoff ? [{ label: '放弃未落盘待确认内容', run: async () => { await current.discardPending(); } }] : []),
      { label: '导出已确认档案', run: exportCurrent }]);
    else if (state.phase === 'handoff') panel.showStatus('最新进度已确认保存旧脚本的当前聊天存档和镜像，原生保存已停止。可以停用原生扩展后启用旧战阵脚本；再次使用原生版时先停用旧脚本，再预览迁回。', [{ label: '导出完整原生存档', run: exportCurrent }, { label: '预览迁回原生', run: async () => showChange(await management.previewResume()) }], true);
    else if (state.phase === 'error') panel.showStatus(state.error ?? '档案暂不可用', [{ label: '重新读取', run: reload }, { label: '导出原始数据', run: exportCurrent }], true);
    else if (state.phase === 'ready' || state.phase === 'review') { panel.showStatus(''); panel.showPanel(); }
  });
  await current.start();
}
void start().catch(error => { panel.showStatus(String(error), [], true); unlock(); });
