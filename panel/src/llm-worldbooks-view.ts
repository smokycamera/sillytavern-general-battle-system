import type { WorldbookEntry, WorldbookSource } from '../../host/src/worldbooks.js';
import { escapeHtml as esc } from './battle-presentation.js';
import type { LlmSettings } from './llm-settings.js';
import type { WorldbookSelection } from './llm-worldbooks.js';

export class LlmWorldbookPicker {
  private names: string[] = [];
  private books = new Map<string, WorldbookEntry[]>();
  private current = '';
  private busy = false;
  private error = '';
  constructor(private source: WorldbookSource | undefined, private changed: () => void) {}
  async refresh(): Promise<void> {
    if (this.busy) return;
    this.busy = true; this.error = ''; this.changed();
    try {
      if (!this.source) throw Error('当前酒馆无法读取世界书');
      this.names = await this.source.list(); this.books.clear();
      if (!this.names.includes(this.current)) this.current = this.names[0] ?? '';
      if (this.current) this.books.set(this.current, await this.source.read(this.current));
    } catch (error) { this.error = error instanceof Error ? error.message : '世界书读取失败'; }
    finally { this.busy = false; this.changed(); }
  }
  async choose(name: string): Promise<void> {
    if (this.busy) return;
    this.current = name; this.busy = true; this.error = ''; this.changed();
    try {
      if (!this.source) throw Error('当前酒馆无法读取世界书');
      this.books.set(name, await this.source.read(name));
    } catch (error) { this.error = error instanceof Error ? error.message : '世界书读取失败'; }
    finally { this.busy = false; this.changed(); }
  }
  update(selection: WorldbookSelection[], id: string | undefined, checked: boolean): WorldbookSelection[] {
    const rest = selection.filter(book => book.name !== this.current);
    if (id === undefined) return checked ? [...rest, { name: this.current, entries: 'all' }] : rest;
    const book = selection.find(book => book.name === this.current);
    const ids = new Set(book?.entries === 'all' ? (this.books.get(this.current) ?? []).map(entry => entry.id) : book?.entries ?? []);
    if (checked) ids.add(id); else ids.delete(id);
    return ids.size ? [...rest, { name: this.current, entries: [...ids] }] : rest;
  }
  render(settings: LlmSettings): string {
    const selection = settings.worldbooks ?? [];
    const names = [...new Set([...this.names, ...selection.map(book => book.name)])];
    if (!this.current) this.current = names[0] ?? '';
    const book = selection.find(book => book.name === this.current), entries = this.books.get(this.current);
    const disabled = !settings.enabled || this.busy;
    return `<details class="llm-worldbooks" data-detail-id="llm-worldbooks"><summary>发送给副 API 的世界书（已选${selection.length}本）</summary>
      <p class="sub">可整本发送或勾选条目，用于开战、地图、人设、指挥和正文扫描。勾选内容每次发送，不受关键词触发限制。</p>
      <button data-action="llm-worldbooks-refresh" ${disabled ? 'disabled' : ''}>${this.busy ? '读取中…' : '读取／刷新世界书'}</button>
      ${names.length ? `<label class="llm-setting-field">世界书 <select data-role="llm-worldbook" ${disabled ? 'disabled' : ''}><option value="">选择世界书</option>${names.map(name => {
        const saved = selection.find(book => book.name === name);
        return `<option value="${esc(name)}" ${name === this.current ? 'selected' : ''}>${esc(name)}${saved ? saved.entries === 'all' ? '（整本）' : `（已选${saved.entries.length}条）` : ''}</option>`;
      }).join('')}</select></label>` : ''}
      ${this.current ? `<label><input type="checkbox" data-role="llm-worldbook-all" ${book?.entries === 'all' ? 'checked' : ''} ${disabled ? 'disabled' : ''}>整本发送</label>
      ${entries ? `<div class="llm-worldbook-entries">${entries.map(entry => `<label title="${esc(entry.content.slice(0, 160))}"><input type="checkbox" data-role="llm-worldbook-entry" data-id="${esc(entry.id)}" ${book?.entries === 'all' || book?.entries.includes(entry.id) ? 'checked' : ''} ${disabled ? 'disabled' : ''}><span>${esc(entry.title)} <small>（${entry.content.length}字）</small></span></label>`).join('') || '<p class="sub">此书暂无条目。</p>'}</div>` : '<p class="sub">请选择或刷新世界书以读取条目。</p>'}` : '<p class="sub">尚未读取世界书。</p>'}
      ${this.error ? `<p role="alert">${esc(this.error)}</p>` : ''}</details>`;
  }
}
