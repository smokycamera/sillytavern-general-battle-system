import type { CustomWorldbookEntry, WorldbookEditorState } from './panel-runtime.js';

export interface WorldbookDraft {
  title: string;
  constant: boolean;
  keys: string;
  depth: string;
  role: string;
  order: string;
}
const esc = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const draftFrom = (entry: CustomWorldbookEntry): WorldbookDraft => ({
  title: entry.title, constant: entry.constant, keys: entry.keys.join('\n'),
  depth: String(entry.depth), role: String(entry.role), order: String(entry.order),
});

export function captureWorldbookDraft(root: HTMLElement): WorldbookDraft {
  const value = (field: string) => root.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[data-field="${field}"]`)!.value;
  return { title: value('title'), constant: value('constant') === 'true', keys: value('keys'), depth: value('depth'), role: value('role'), order: value('order') };
}

export function worldbookDraftPatch(draft: WorldbookDraft, content: string): Partial<CustomWorldbookEntry> {
  return {
    title: draft.title, constant: draft.constant, content,
    keys: draft.keys.split(/\r?\n/).map(key => key.trim()).filter(Boolean),
    depth: draft.depth.trim() ? Number(draft.depth) : NaN,
    role: Number(draft.role), order: draft.order.trim() ? Number(draft.order) : NaN,
  };
}

export function renderWorldbookSettings(view: WorldbookEditorState, texts: Map<string, string>, drafts: Map<string, WorldbookDraft>, deleting?: string): string {
  return `<section class="worldbook-settings"><div class="worldbook-heading"><h2>内置世界书</h2><button data-action="worldbook-create">＋新建条目</button></div>
    <label><input type="checkbox" data-role="worldbook-enabled" ${view.enabled ? 'checked' : ''}> 启用内置世界书</label>
    <p>设置全局保存。启用后请停用外挂的同一套世界书。</p>
    ${view.items.map(item => {
      const custom = item.custom, draft = custom ? drafts.get(item.id) ?? draftFrom(custom) : undefined;
      const field = (name: string) => `id="wb-${esc(item.id)}-${name}" data-role="worldbook-field" data-field="${name}" data-entry="${esc(item.id)}"`;
      return `<div class="prompt-setting" data-worldbook-entry="${esc(item.id)}">
        <label>${custom ? `<input type="checkbox" id="wb-${esc(item.id)}-enabled" data-role="worldbook-entry-enabled" data-entry="${esc(item.id)}" ${custom.enabled ? 'checked' : ''}> ` : ''}<strong>${esc(item.title)}</strong></label>
        <span class="sub">${custom ? (custom.constant ? '🔵' : '🟢') + ' · ' : ''}深度 ${item.depth} · ${['system', 'user', 'assistant'][item.role] ?? 'system'} · 顺序 ${item.order}</span>
        <details data-detail-id="worldbook-editor-${esc(item.id)}"><summary>编辑条目</summary>
        ${draft ? `<label class="worldbook-name">名称<input ${field('title')} value="${esc(draft.title)}"></label>
          <div class="worldbook-fields">
            <label>触发<select ${field('constant')}><option value="true" ${draft.constant ? 'selected' : ''}>🔵 常驻</option><option value="false" ${!draft.constant ? 'selected' : ''} ${view.injectionMode === 'depth' ? 'disabled' : ''}>🟢 关键词</option></select></label>
            <label>深度<input ${field('depth')} type="number" min="0" max="1000" step="1" value="${esc(draft.depth)}"></label>
            <label>提示词类型<select ${field('role')}>${['system', 'user', 'assistant'].map((role, i) => `<option value="${i}" ${draft.role === String(i) ? 'selected' : ''}>${role}</option>`).join('')}</select></label>
            <label>顺序<input ${field('order')} type="number" min="0" max="99999" step="1" value="${esc(draft.order)}"></label>
          </div>
          <label class="worldbook-keys" ${draft.constant ? 'hidden' : ''}>关键词（每行一个）<textarea ${field('keys')} rows="3">${esc(draft.keys)}</textarea></label>` : ''}
        <textarea id="wb-${esc(item.id)}-content" aria-label="${esc(item.title)}正文" data-role="worldbook-template" data-entry="${esc(item.id)}" style="width:100%;min-height:12em">${esc(texts.get(item.id) ?? item.content)}</textarea>
        <div class="row"><button data-action="worldbook-save" data-entry="${esc(item.id)}">保存</button>
          ${custom ? deleting === item.id
            ? `<button data-action="worldbook-delete-confirm" data-entry="${esc(item.id)}">确认删除</button><button data-action="worldbook-delete-cancel">取消</button>`
            : `<button data-action="worldbook-delete" data-entry="${esc(item.id)}">删除</button>`
            : `<button data-action="worldbook-reset" data-entry="${esc(item.id)}">恢复内置默认文本</button>`}
        </div></details></div>`;
    }).join('')}
  </section>`;
}
