import type { DisplayPreferences } from './preferences.js';
export class PanelHost {
  private frame?: HTMLIFrameElement;
  private root: HTMLElement;
  private content: HTMLElement;
  private status: HTMLElement;
  private entry: HTMLButtonElement;
  private ready = false;
  private manage = () => {};
  private geometry?: DisplayPreferences['geometry'];
  private drag?: { x: number; y: number; left: number; top: number };
  private onResize = () => this.applyGeometry();
  private onVisibility = () => { if (document.hidden) this.pause(); };
  constructor(private panelUrl: string, private display?: { read(): DisplayPreferences; write(value: DisplayPreferences): void }) {
    this.root = document.createElement('section'); this.root.id = 'tavern-battle-native-panel'; this.root.hidden = true;
    this.root.setAttribute('role', 'dialog'); this.root.setAttribute('aria-label', '战阵');
    const style = document.createElement('style');
    this.root.style.boxSizing = 'border-box';
    this.root.style.resize = 'both'; this.root.style.minWidth = '320px'; this.root.style.minHeight = '260px';
    style.textContent = `#tavern-battle-native-panel{position:fixed;right:16px;top:5vh;width:min(1120px,calc(100vw - 32px));height:90vh;z-index:10000;background:#151b1e;border:1px solid #8e8064;border-radius:12px;color:#e5e6e1;box-shadow:0 12px 70px #0009;display:flex;flex-direction:column;overflow:hidden}#tavern-battle-native-panel[hidden]{display:none}#tavern-battle-native-panel header{display:flex;align-items:center;gap:12px;padding:10px 14px;background:#252e33;font:14px 'Microsoft YaHei',sans-serif}#tavern-battle-native-panel header strong{flex:1}#tavern-battle-native-panel button,#tavern-battle-native-entry{min-height:40px;border:1px solid #8e8064;border-radius:8px;background:#252e33;color:#e5e6e1;padding:6px 14px;cursor:pointer}#tavern-battle-native-panel main{flex:1;min-height:0;overflow:auto}#tavern-battle-native-panel iframe{border:0;width:100%;height:100%;display:block}#tavern-battle-native-panel .tb-status{padding:14px 20px;font:14px/1.7 'Microsoft YaHei',sans-serif}#tavern-battle-native-panel .tb-status:empty{display:none}#tavern-battle-native-entry{position:fixed;right:18px;bottom:75px;z-index:9999;box-shadow:0 3px 16px #0007;background:#3b443b}#tavern-battle-native-panel .tb-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:12px}@media(max-width:600px){#tavern-battle-native-panel{inset:0;width:100%;height:100dvh;border-radius:0}#tavern-battle-native-panel header{padding:8px}#tavern-battle-native-entry{right:10px;bottom:80px}}`;
    const header = document.createElement('header'); const title = document.createElement('strong'); title.textContent = '战阵 · 原生扩展';
    header.style.cursor = 'move';
    header.addEventListener('pointerdown', event => {
      if (event.button !== 0 || (event.target as Element).closest('button') || innerWidth <= 600) return;
      const rect = this.root.getBoundingClientRect(); this.drag = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top }; header.setPointerCapture(event.pointerId);
    });
    header.addEventListener('pointermove', event => {
      if (!this.drag) return;
      const rect = this.root.getBoundingClientRect();
      this.root.style.left = Math.max(0, Math.min(innerWidth - rect.width, this.drag.left + event.clientX - this.drag.x)) + 'px';
      this.root.style.top = Math.max(0, Math.min(innerHeight - rect.height, this.drag.top + event.clientY - this.drag.y)) + 'px'; this.root.style.right = 'auto';
    });
    header.addEventListener('pointerup', () => { this.drag = undefined; });
    this.root.addEventListener('pointerup', () => {
      if (innerWidth <= 600 || this.root.hidden) return;
      const rect = this.root.getBoundingClientRect(); this.geometry = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
      this.display?.write({ geometry: this.geometry });
    });
    const management = document.createElement('button'); management.textContent = '存档管理'; management.addEventListener('click', () => this.manage());
    const close = document.createElement('button'); close.textContent = '收起'; close.addEventListener('click', () => this.close());
    header.append(title, management, close); this.status = document.createElement('div'); this.status.className = 'tb-status';
    this.content = document.createElement('main'); this.root.append(style, header, this.status, this.content);
    this.entry = document.createElement('button'); this.entry.id = 'tavern-battle-native-entry'; this.entry.textContent = '⚔ 战阵'; this.entry.title = '打开战阵'; this.entry.addEventListener('click', () => this.open());
    document.body.append(this.entry, this.root); document.addEventListener('visibilitychange', this.onVisibility);
    this.geometry = this.display?.read().geometry; this.applyGeometry(); window.addEventListener('resize', this.onResize);
  }
  open(): void { this.root.hidden = false; this.entry.hidden = true; if (this.ready) this.showPanel(); }
  setManagementHandler(handler: () => void): void { this.manage = handler; }
  close(): void { this.pause(); this.root.hidden = true; this.entry.hidden = false; }
  private pause(): void { this.frame?.contentWindow?.postMessage({ type: 'tb:panel-hidden' }, location.origin); }
  showPanel(): void {
    this.ready = true;
    this.content.hidden = false;
    if (!this.root.hidden && !this.frame) { this.frame = document.createElement('iframe'); this.frame.title = '战阵面板'; this.frame.src = this.panelUrl; this.content.append(this.frame); }
  }
  showStatus(text: string, actions: { label: string; run(): Promise<void> | void }[] = [], hidePanel = false): void {
    this.status.replaceChildren(); this.content.hidden = hidePanel;
    if (hidePanel) this.ready = false;
    if (hidePanel) this.pause();
    if (text) { const paragraph = document.createElement('p'); paragraph.textContent = text; this.status.append(paragraph); }
    if (actions.length) {
      const row = document.createElement('div'); row.className = 'tb-actions';
      for (const action of actions) {
        const button = document.createElement('button'); button.textContent = action.label;
        button.addEventListener('click', async () => { button.disabled = true; try { await action.run(); } catch (error) { this.showStatus(String(error), actions, hidePanel); } finally { button.disabled = false; } }); row.append(button);
      }
      this.status.append(row);
    }
  }
  private applyGeometry(): void {
    if (innerWidth <= 600) { for (const property of ['left', 'right', 'top', 'width', 'height']) this.root.style.removeProperty(property); this.root.style.resize = 'none'; return; }
    this.root.style.resize = 'both';
    if (!this.geometry) return;
    const width = Math.min(this.geometry.width, innerWidth - 24), height = Math.min(this.geometry.height, innerHeight - 24);
    Object.assign(this.root.style, { left: Math.max(0, Math.min(this.geometry.left, innerWidth - width)) + 'px', top: Math.max(0, Math.min(this.geometry.top, innerHeight - height)) + 'px', right: 'auto', width: width + 'px', height: height + 'px' });
  }
  dispose(): void { this.pause(); this.frame?.remove(); this.root.remove(); this.entry.remove(); document.removeEventListener('visibilitychange', this.onVisibility); window.removeEventListener('resize', this.onResize); }
}
