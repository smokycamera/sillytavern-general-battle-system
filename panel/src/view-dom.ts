import { hydrateTerrain } from './terrain-layer.js';
/** 战场在原位更新节点；格子、滚动容器和下拉框不因查看目标而离开文档。 */
function battleNodeKey(node: Node): string | undefined {
  if (!(node instanceof Element)) return undefined;
  const tag = node.tagName;
  for (const name of ['id', 'data-detail-id', 'data-role', 'data-cell', 'data-formation', 'data-workspace']) {
    const value = node.getAttribute(name);
    if (value !== null) return tag + ':' + name + ':' + value + ':' + (node.getAttribute('data-section') ?? '');
  }
  if (node.hasAttribute('data-action')) return tag + ':action:' + ['data-action', 'data-id', 'data-unit', 'data-node', 'data-mode', 'data-tab', 'data-event'].map(name => node.getAttribute(name) ?? '').join(':');
  const cls = node.getAttribute('class')?.split(/\s+/)[0];
  return cls ? tag + ':class:' + cls : undefined;
}

function patchBattleNode(old: Node, next: Node): void {
  if (!(old instanceof Element) || !(next instanceof Element)) {
    if (old.nodeValue !== next.nodeValue) old.nodeValue = next.nodeValue;
    return;
  }
  // 静态底图：同一 id 的内容不变，整棵子树跳过；id 变化时清空，交给 hydrateTerrain 重画。
  const island = next.getAttribute('data-static');
  if (island !== null && island === old.getAttribute('data-static')) return;
  const keepOpen = old instanceof HTMLDetailsElement && old.hasAttribute('data-detail-id');
  for (const attr of [...old.attributes]) if (!(keepOpen && attr.name === 'open') && !next.hasAttribute(attr.name)) old.removeAttribute(attr.name);
  for (const attr of [...next.attributes]) if (!(keepOpen && attr.name === 'open') && old.getAttribute(attr.name) !== attr.value) old.setAttribute(attr.name, attr.value);
  patchBattleChildren(old, next);
  if (old instanceof HTMLInputElement && next instanceof HTMLInputElement) {
    if (old.value !== next.value) old.value = next.value;
    old.checked = next.checked;
  } else if (old instanceof HTMLTextAreaElement && next instanceof HTMLTextAreaElement) {
    if (old.value !== next.value) old.value = next.value;
  } else if (old instanceof HTMLSelectElement && next instanceof HTMLSelectElement) {
    if (old.value !== next.value) old.value = next.value;
  }
}

/** 匹配键 = 节点键 + 可兼容的节点类型；同键按文档顺序排队，取第一个未用节点（与逐个查找结果相同，但为线性复杂度）。 */
function matchKey(node: Node): string {
  const kind = node instanceof Element ? node.namespaceURI + ':' + node.tagName : String(node.nodeType);
  return (battleNodeKey(node) ?? '') + '\u0001' + kind;
}

function patchBattleChildren(parent: Node, next: Node): void {
  const previous = [...parent.childNodes], used = new Set<Node>(), queues = new Map<string, Node[]>();
  for (const node of previous) { const key = matchKey(node), queue = queues.get(key); if (queue) queue.push(node); else queues.set(key, [node]); }
  let cursor = parent.firstChild;
  for (const child of [...next.childNodes]) {
    const current = queues.get(matchKey(child))?.shift();
    if (current) {
      used.add(current);
      if (current !== cursor) parent.insertBefore(current, cursor);
      patchBattleNode(current, child);
      cursor = current.nextSibling;
    } else {
      const inserted = child.cloneNode(true);
      parent.insertBefore(inserted, cursor);
    }
  }
  for (const node of previous) if (!used.has(node)) parent.removeChild(node);
}

/** 更新工作区：战场只修改变化部分，其余工作区保留原有表单恢复逻辑。 */
export function updateRegion(root: HTMLElement, html: string): void {
  const open = new Set([...root.querySelectorAll<HTMLDetailsElement>('details[open][data-detail-id]')].map(d => d.dataset.detailId));
  const existing = new Set([...root.querySelectorAll<HTMLDetailsElement>('details[data-detail-id]')].map(d => d.dataset.detailId));
  const focus = root.contains(document.activeElement) ? document.activeElement as HTMLInputElement : undefined;
  const role = focus?.dataset.role, id = focus?.id, section = focus?.dataset.section;
  const selection = focus && ['INPUT', 'TEXTAREA'].includes(focus.tagName) ? [focus.selectionStart, focus.selectionEnd] : undefined;
  if (root.dataset.workspace === 'battle') {
    // 文档里已有同签名的格子不再解析：只留同键空壳，打补丁时按签名整格跳过。
    const live = new Set([...root.querySelectorAll('button.grid-cell[data-static]')].map(el => el.getAttribute('data-static')));
    if (live.size) html = html.replace(/<button (class="grid-cell [^>]*?)data-static="([^"]+)">[\s\S]*?<\/button>/g,
      (whole, attrs: string, sig: string) => live.has(sig) ? `<button data-cell="${/data-cell="(\d+)"/.exec(attrs)?.[1] ?? ''}" data-static="${sig}"></button>` : whole);
  }
  const fragment = document.createElement('template'); fragment.innerHTML = html;
  if (root.dataset.workspace === 'battle') {
    const scroll = [...root.querySelectorAll<HTMLElement>('.grid-camera, .formation-map-camera, #logview')].map(el => ({el, left:el.scrollLeft, top:el.scrollTop}));
    patchBattleChildren(root, fragment.content);
    hydrateTerrain(root);
    for (const {el,left,top} of scroll) if (el.isConnected) { el.scrollLeft=left; el.scrollTop=top; }
    return;
  }
  const oldCamera = root.querySelector<HTMLElement>('.grid-camera, .formation-map-camera');
  const nextCamera = fragment.content.querySelector<HTMLElement>('.grid-camera, .formation-map-camera');
  const logScroll = root.querySelector('#logview')?.scrollTop;
  if (oldCamera && nextCamera && oldCamera.className === nextCamera.className) {
    const before = new Map([...oldCamera.querySelectorAll<HTMLElement>('[data-cell]')].map(el => [el.dataset.cell, el]));
    for (const cell of nextCamera.querySelectorAll<HTMLElement>('[data-cell]')) {
      const old = before.get(cell.dataset.cell); if (!old) continue;
      for (const attr of [...old.attributes]) if (!cell.hasAttribute(attr.name)) old.removeAttribute(attr.name);
      for (const attr of [...cell.attributes]) if (old.getAttribute(attr.name) !== attr.value) old.setAttribute(attr.name, attr.value);
      if (old.innerHTML !== cell.innerHTML) old.innerHTML = cell.innerHTML;
      cell.replaceWith(old);
    }
    const { scrollLeft, scrollTop } = oldCamera;
    oldCamera.replaceChildren(...nextCamera.childNodes); nextCamera.replaceWith(oldCamera);
    oldCamera.dataset.restoreLeft = String(scrollLeft); oldCamera.dataset.restoreTop = String(scrollTop);
  }
  root.replaceChildren(fragment.content);
  for (const d of root.querySelectorAll<HTMLDetailsElement>('details[data-detail-id]')) if (existing.has(d.dataset.detailId)) d.open = open.has(d.dataset.detailId);
  if (oldCamera?.isConnected) { oldCamera.scrollLeft = Number(oldCamera.dataset.restoreLeft); oldCamera.scrollTop = Number(oldCamera.dataset.restoreTop); }
  const log = root.querySelector('#logview'); if (log && logScroll !== undefined) log.scrollTop = logScroll;
  const nextFocus = id ? root.querySelector<HTMLElement>('#' + CSS.escape(id)) : role
    ? [...root.querySelectorAll<HTMLElement>('[data-role]')].find(el => el.dataset.role === role && (!section || el.dataset.section === section)) : undefined;
  nextFocus?.focus({ preventScroll: true });
  if (selection && nextFocus && 'setSelectionRange' in nextFocus && selection[0] !== null && selection[1] !== null) {
    try { (nextFocus as HTMLInputElement).setSelectionRange(selection[0]!, selection[1]!); } catch { /* number/select无文本选区 */ }
  }
}

export class BattleCamera {
  private identity = '';
  private actor = '';
  private following = true;
  reset(): void { this.identity = ''; this.actor = ''; this.following = true; }
  browse(): void { this.following = false; }
  focus(target?: HTMLElement): void {
    this.following = true;
    if (target) this.center(target);
  }
  update(identity: string, actor: string, target?: HTMLElement): void {
    const first = identity !== this.identity;
    if (first) this.following = true;
    if ((first || actor !== this.actor) && this.following && target) this.center(target);
    this.identity = identity; this.actor = actor;
  }
  private center(target: HTMLElement): void {
    if (!target.offsetParent) target = target.closest<HTMLElement>('.formation-node') ?? target;
    const camera = target.closest<HTMLElement>('.grid-camera, .formation-map-camera'); if (!camera) return;
    const a = target.getBoundingClientRect(), b = camera.getBoundingClientRect();
    camera.scrollLeft += a.left - b.left - (camera.clientWidth - a.width) / 2;
    const dock = document.querySelector<HTMLElement>('.grid-mobile-shortcuts');
    const dockHeight = dock?.getClientRects().length ? dock.getBoundingClientRect().height : 0;
    const top = Math.max(0, b.top), bottom = Math.min(b.bottom, window.innerHeight - dockHeight);
    const center = bottom > top ? (top + bottom) / 2 : b.top + camera.clientHeight / 2;
    camera.scrollTop += a.top + a.height / 2 - center;
    const visible = target.getBoundingClientRect(), edge = window.innerHeight - dockHeight - 8;
    if (visible.bottom > edge) window.scrollBy(0, visible.bottom - edge);
    else if (visible.top < 8) window.scrollBy(0, visible.top - 8);
  }
}
