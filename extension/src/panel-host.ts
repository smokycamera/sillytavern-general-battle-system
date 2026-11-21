import manifest from '../manifest.json';
import type { UiLanguage } from '../../panel/src/ui-language.js';
import type { DisplayPreferences } from './preferences.js';
export class PanelHost {
  private frame?: HTMLIFrameElement;
  private root: HTMLElement;
  private content: HTMLElement;
  private title: HTMLElement;
  private management: HTMLButtonElement;
  private closeButton: HTMLButtonElement;
  private status: HTMLElement;
  private entry: HTMLButtonElement;
  private ready = false;
  private manage = () => {};
  private geometry?: DisplayPreferences['geometry'];
  private drag?: { x: number; y: number; left: number; top: number };
  private entryPosition?: DisplayPreferences['entryPosition'];
  private entryDrag?: { id: number; x: number; y: number; left: number; top: number; moved: boolean };
  private suppressEntryClick = false;
  private viewport = window.visualViewport;
  private onViewportChange = () => this.applyEntryPosition();
  private onResize = () => { this.applyGeometry(); this.applyEntryPosition(); };
  private onVisibility = () => { if (document.hidden) this.pause(); };
  constructor(private panelUrl: string, private display?: { read(): DisplayPreferences; write(value: DisplayPreferences): void }) {
    this.root = document.createElement('section'); this.root.id = 'tavern-battle-native-panel'; this.root.hidden = true;
    this.root.setAttribute('role', 'dialog'); this.root.setAttribute('aria-label', manifest.display_name);
    const style = document.createElement('style');
    this.root.style.boxSizing = 'border-box';
    this.root.style.resize = 'both';
    style.textContent = `
      #tavern-battle-native-panel {
        --tb-safe-top: env(safe-area-inset-top, 0px);
        --tb-safe-right: env(safe-area-inset-right, 0px);
        --tb-safe-bottom: env(safe-area-inset-bottom, 0px);
        --tb-safe-left: env(safe-area-inset-left, 0px);
        --tb-safe-width: calc(100vw - var(--tb-safe-left) - var(--tb-safe-right));
        --tb-safe-height: calc(100dvh - var(--tb-safe-top) - var(--tb-safe-bottom));
        min-width: min(320px, var(--tb-safe-width));
        min-height: min(260px, var(--tb-safe-height));
        max-width: var(--tb-safe-width);
        max-height: var(--tb-safe-height);
      }
      #tavern-battle-native-panel[data-theme=light]{background:#fffdf8;color:#292f2c;border-color:#8a938c}#tavern-battle-native-panel[data-theme=light] header{background:#f3f0e8;color:#292f2c}#tavern-battle-native-panel[data-theme=light] button{background:#fffdf8;color:#292f2c;border-color:#8a938c}#tavern-battle-native-panel{position:fixed;right:max(16px,var(--tb-safe-right));top:max(5vh,var(--tb-safe-top));width:min(1120px,calc(100vw - max(16px,var(--tb-safe-left)) - max(16px,var(--tb-safe-right))));height:min(90vh,calc(100dvh - max(5vh,var(--tb-safe-top)) - var(--tb-safe-bottom)));z-index:10000;background:#151b1e;border:1px solid #8e8064;border-radius:12px;color:#e5e6e1;box-shadow:0 12px 70px #0009;display:flex;flex-direction:column;overflow:hidden}#tavern-battle-native-panel[hidden]{display:none}#tavern-battle-native-panel header{display:flex;align-items:center;gap:12px;padding:10px 14px;background:#252e33;font:14px 'Microsoft YaHei',sans-serif}#tavern-battle-native-panel header strong{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#tavern-battle-native-panel header button{flex:none}#tavern-battle-native-panel button,#tavern-battle-native-entry{min-height:40px;border:1px solid #8e8064;border-radius:8px;background:#252e33;color:#e5e6e1;padding:6px 14px;cursor:pointer}#tavern-battle-native-panel main{flex:1;min-height:0;overflow:auto}#tavern-battle-native-panel iframe{border:0;width:100%;height:100%;display:block}#tavern-battle-native-panel .tb-status{padding:14px 20px;font:14px/1.7 'Microsoft YaHei',sans-serif}#tavern-battle-native-panel .tb-status:empty{display:none}#tavern-battle-native-panel .tb-status p{white-space:pre-line}#tavern-battle-native-entry{box-sizing:border-box;width:52px;height:52px;min-width:52px;padding:0;border-radius:50%;display:grid;place-items:center;touch-action:none;user-select:none;-webkit-user-select:none;position:fixed;right:18px;bottom:75px;z-index:9999;box-shadow:0 3px 16px #0007;background:#3b443b}#tavern-battle-native-entry[hidden]{display:none}#tavern-battle-native-entry svg{width:30px;height:30px;pointer-events:none}#tavern-battle-native-panel .tb-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:12px}@media(max-width:600px){#tavern-battle-native-panel{inset:0;width:100%;height:100dvh;max-width:none;max-height:none;border-radius:0;padding:var(--tb-safe-top) var(--tb-safe-right) var(--tb-safe-bottom) var(--tb-safe-left)}#tavern-battle-native-panel header{padding:8px}#tavern-battle-native-entry{right:10px;bottom:80px}}`;
    const header = document.createElement('header'); this.title = document.createElement('strong');
    header.style.cursor = 'move';
    header.addEventListener('pointerdown', event => {
      if (event.button !== 0 || (event.target as Element).closest('button') || innerWidth <= 600) return;
      const rect = this.root.getBoundingClientRect(); this.drag = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top }; header.setPointerCapture(event.pointerId);
    });
    header.addEventListener('pointermove', event => {
      if (!this.drag) return;
      const rect = this.root.getBoundingClientRect();
      this.positionPanel(this.drag.left + event.clientX - this.drag.x, this.drag.top + event.clientY - this.drag.y, rect.width, rect.height);
    });
    header.addEventListener('pointerup', () => { this.drag = undefined; });
    this.root.addEventListener('pointerup', () => {
      if (innerWidth <= 600 || this.root.hidden) return;
      const rect = this.root.getBoundingClientRect(); this.geometry = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
      this.display?.write({ geometry: this.geometry });
    });
    this.management = document.createElement('button'); this.management.addEventListener('click', () => this.manage());
    this.closeButton = document.createElement('button'); this.closeButton.addEventListener('click', () => this.close());
    header.append(this.title, this.management, this.closeButton); this.status = document.createElement('div'); this.status.className = 'tb-status';
    this.content = document.createElement('main'); this.root.append(style, header, this.status, this.content);
    this.entry = document.createElement('button'); this.entry.id = 'tavern-battle-native-entry';
    this.entry.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.5 3H21v6.5L7 20l-3-3L14.5 3Z"/><path d="m3 14 7 7M5 19l-2 2M3 3h6.5L21 17l-4 4L3 9.5V3Z"/><path d="m14 21 7-7m-2 5 2 2M3 3l7 7m4 4 4 4M21 3l-7 7"/></svg>';
    this.entry.addEventListener('click', event => { if (this.suppressEntryClick && event.detail !== 0) { this.suppressEntryClick = false; return; } this.open(); });
    this.entry.addEventListener('pointerdown', event => {
      if (event.button !== 0 || this.entryDrag) return;
      const rect = this.entry.getBoundingClientRect(); this.suppressEntryClick = false;
      this.entryDrag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, moved: false };
      this.entry.setPointerCapture(event.pointerId);
    });
    this.entry.addEventListener('pointermove', event => {
      const drag = this.entryDrag; if (!drag || drag.id !== event.pointerId) return;
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 6) drag.moved = true;
      if (!drag.moved) return;
      this.entryPosition = { left: drag.left + event.clientX - drag.x, top: drag.top + event.clientY - drag.y }; this.applyEntryPosition();
    });
    const finishDrag = (event: PointerEvent) => {
      const drag = this.entryDrag; if (!drag || drag.id !== event.pointerId) return;
      this.entryDrag = undefined; this.suppressEntryClick = drag.moved;
      if (drag.moved && this.entryPosition) this.display?.write({ entryPosition: this.entryPosition });
      if (this.entry.hasPointerCapture(event.pointerId)) this.entry.releasePointerCapture(event.pointerId);
    };
    this.entry.addEventListener('pointerup', finishDrag); this.entry.addEventListener('pointercancel', finishDrag); this.entry.addEventListener('lostpointercapture', finishDrag);
    document.body.append(this.entry, this.root); document.addEventListener('visibilitychange', this.onVisibility);
    const savedDisplay = this.display?.read(); this.root.dataset.theme = savedDisplay?.theme ?? 'dark'; this.setLanguage(savedDisplay?.language ?? 'zh-CN'); this.geometry = savedDisplay?.geometry; this.entryPosition = savedDisplay?.entryPosition; this.applyGeometry(); this.applyEntryPosition(); window.addEventListener('resize', this.onResize);
    this.viewport?.addEventListener('resize', this.onViewportChange); this.viewport?.addEventListener('scroll', this.onViewportChange);
  }
  open(): void { this.root.hidden = false; this.entry.hidden = true; if (this.ready) this.showPanel(); }
  setManagementHandler(handler: () => void): void { this.manage = handler; }
  close(): void { this.pause(); this.root.hidden = true; this.entry.hidden = false; this.applyEntryPosition(); }
  pause(): void { this.frame?.contentWindow?.postMessage({ type: 'tb:panel-hidden' }, location.origin); }
  showPanel(): void {
    this.ready = true;
    this.content.hidden = false;
    if (!this.root.hidden && !this.frame) { this.frame = document.createElement('iframe'); this.frame.title = this.title.textContent!; this.frame.src = this.panelUrl; this.content.append(this.frame); }
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
        button.addEventListener('click', async () => { button.disabled = true; try { await action.run(); } catch (error) { this.showStatus(error instanceof Error ? error.message : String(error), actions, hidePanel); } finally { button.disabled = false; } }); row.append(button);
      }
      this.status.append(row);
    }
  }
  private applyEntryPosition(): void {
    const viewport = this.viewport;
    const width = viewport?.width || innerWidth, height = viewport?.height || innerHeight;
    const originLeft = viewport?.offsetLeft ?? 0, originTop = viewport?.offsetTop ?? 0;
    const mobile = innerWidth <= 600;
    // Mobile ST transforms <html> while fixing <body>, so a bottom-anchored
    // entry can be positioned against a zero-height root. Always use explicit
    // viewport coordinates, including the first run with no saved position.
    const position = this.entryPosition ?? { left: originLeft + width - (mobile ? 62 : 70), top: originTop + height - (mobile ? 132 : 127) };
    const left = Math.max(originLeft + 8, Math.min(originLeft + width - 60, position.left));
    const top = Math.max(originTop + 8, Math.min(originTop + height - 60, position.top));
    // A keyboard/rotation clamp must not overwrite the user's preferred position.
    if (this.entryDrag) this.entryPosition = { left, top };
    Object.assign(this.entry.style, { left: left + 'px', top: top + 'px', right: 'auto', bottom: 'auto' });
  }
  setLanguage(language: UiLanguage): void {
    const english = language === 'en';
    const title = english ? `Tavern Battle v${manifest.version}` : manifest.display_name;
    const open = english ? `Open ${title}` : '打开' + title;
    this.root.lang = language;
    this.root.setAttribute('aria-label', title);
    this.title.textContent = title;
    this.management.textContent = english ? 'Saves' : '存档管理';
    this.closeButton.textContent = english ? 'Close' : '收起';
    this.entry.lang = language;
    this.entry.setAttribute('aria-label', open);
    this.entry.title = open + (english ? ' · Drag to move' : ' · 可拖动');
    if (this.frame) this.frame.title = title;
  }
  private safeArea() {
    const style = getComputedStyle(this.root);
    const inset = (edge: string) => parseFloat(style.getPropertyValue(`--tb-safe-${edge}`)) || 0;
    return { left: inset('left'), right: inset('right'), top: inset('top'), bottom: inset('bottom') };
  }
  private positionPanel(left: number, top: number, width: number, height: number, safe = this.safeArea()): void {
    Object.assign(this.root.style, {
      left: Math.max(safe.left, Math.min(left, innerWidth - safe.right - width)) + 'px',
      top: Math.max(safe.top, Math.min(top, innerHeight - safe.bottom - height)) + 'px',
      right: 'auto',
    });
  }
  private applyGeometry(): void {
    if (innerWidth <= 600) { for (const property of ['left', 'right', 'top', 'width', 'height']) this.root.style.removeProperty(property); this.root.style.resize = 'none'; return; }
    this.root.style.resize = 'both';
    if (!this.geometry) return;
    const safe = this.safeArea();
    const width = Math.min(this.geometry.width, innerWidth - Math.max(24, safe.left + safe.right));
    const height = Math.min(this.geometry.height, innerHeight - Math.max(24, safe.top + safe.bottom));
    Object.assign(this.root.style, { width: width + 'px', height: height + 'px' });
    this.positionPanel(this.geometry.left, this.geometry.top, width, height, safe);
  }
  dispose(): void { this.pause(); this.frame?.remove(); this.root.remove(); this.entry.remove(); document.removeEventListener('visibilitychange', this.onVisibility); window.removeEventListener('resize', this.onResize); this.viewport?.removeEventListener('resize', this.onViewportChange); this.viewport?.removeEventListener('scroll', this.onViewportChange); }
}
