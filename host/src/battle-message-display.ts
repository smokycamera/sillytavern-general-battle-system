import type { NativeHost, HostWindow, MessageFormatter } from './sillytavern.js';
import { BATTLE_DETAILS_CLASS, battleDisplayBlocks, battleDisplaySummary, createBattleMessageHooks, type BattleDisplayBlock, type FormattingContext } from './battle-message-format.js';

interface FormatterSlot { formatter: MessageFormatter; hooks?: ReturnType<typeof createBattleMessageHooks> }
type DisplayWindow = HostWindow & { __tavernBattleFormatter?: FormatterSlot };
const stylesId = 'tavern-battle-message-styles';

function detailsElement(document: Document, block: BattleDisplayBlock): HTMLDetailsElement {
  const details = document.createElement('details'); details.className = BATTLE_DETAILS_CLASS;
  const summary = document.createElement('summary'); summary.textContent = battleDisplaySummary(block);
  const pre = document.createElement('pre'), code = document.createElement('code'); code.textContent = block.text;
  pre.append(code); details.append(summary, pre); return details;
}

/** 用宿主现有文本定位已转义的块；只替换该段内容，不重绘正文、附件或 iframe。 */
function replaceVisibleBlock(root: HTMLElement, block: BattleDisplayBlock, details: HTMLDetailsElement): boolean {
  const document = root.ownerDocument;
  const walker = document.createTreeWalker(root, 5 /* SHOW_ELEMENT | SHOW_TEXT */);
  const nodes: { node: Node; text: string }[] = []; let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node.parentElement?.closest('details, textarea, script, style, iframe')) continue;
    if (node.nodeType === 3) nodes.push({ node, text: (node as Text).data });
    else if ((node as Element).tagName === 'BR') nodes.push({ node, text: '\n' });
  }
  const content = nodes.map(n => n.text).join(''), start = content.indexOf(block.text);
  if (start < 0) return false;
  const end = start + block.text.length; let offset = 0;
  const range = document.createRange(); let started = false;
  for (const part of nodes) {
    const next = offset + part.text.length;
    if (!started && start < next) { if (part.node.nodeType === 3) range.setStart(part.node, start - offset); else range.setStartBefore(part.node); started = true; }
    if (started && end <= next) {
      if (part.node.nodeType === 3) range.setEnd(part.node, end - offset); else range.setEndAfter(part.node);
      range.deleteContents(); range.insertNode(details); return true;
    }
    offset = next;
  }
  return false;
}

/** 标签被净化后仍可能留下几十个换行；用原文两侧正文定位，只替换纯空白区域。 */
function replaceBlankBlock(root: HTMLElement, raw: string, block: BattleDisplayBlock, details: HTMLDetailsElement): boolean {
  if (block.text.replace(/<[^>]*>/g, '').trim()) return false;
  const compact = (text: string) => text.replace(/\s/g, '');
  const before = compact(raw.slice(0, block.start).trimEnd().split('\n').at(-1) ?? '').slice(-80);
  const after = compact(raw.slice(block.end).trimStart().split('\n')[0] ?? '').slice(0, 80);
  const points: { node: Text; offset: number }[] = [];
  const walker = root.ownerDocument.createTreeWalker(root, 4 /* SHOW_TEXT */);
  let content = '', node: Node | null;
  while ((node = walker.nextNode())) {
    if (node.parentElement?.closest('details, pre, code, textarea, script, style, iframe')) continue;
    const text = node as Text;
    for (let offset = 0; offset < text.length; offset++) if (!/\s/.test(text.data[offset]!)) {
      content += text.data[offset]; points.push({ node: text, offset });
    }
  }
  const start = before ? content.lastIndexOf(before) : 0;
  if (start < 0) return false;
  const endOfBefore = start + before.length;
  const end = after ? content.indexOf(after, endOfBefore) : content.length;
  // 两侧之间还有可见文字时不能当作空白清理。
  if (end < 0 || end !== endOfBefore) return false;
  const range = root.ownerDocument.createRange();
  const left = before ? points[endOfBefore - 1] : undefined, right = after ? points[end] : undefined;
  if (left) range.setStart(left.node, left.offset + 1); else range.setStart(root, 0);
  if (right) range.setEnd(right.node, right.offset); else range.setEnd(root, root.childNodes.length);
  const isBlank = (part: Node): boolean => {
    if (part.nodeType === 3) return !part.textContent?.trim();
    if (part.nodeType !== 1 && part.nodeType !== 11) return false;
    if (part.nodeType === 1 && (!['P', 'BR'].includes((part as Element).tagName) || (part as Element).attributes.length)) return false;
    return [...part.childNodes].every(isBlank);
  };
  // 不越过状态栏、图片、iframe、带样式容器或其他扩展节点。
  if (range.collapsed || !isBlank(range.cloneContents())) return false;
  range.deleteContents(); range.insertNode(details); return true;
}

/** 新酒馆用格式化钩子；无该接口的宿主与已渲染历史楼层使用局部 DOM 显示补全。 */
export function installBattleMessageDisplay(host: NativeHost, window: DisplayWindow, document: Document): () => void {
  let active = true;
  const formatter = host.context().messageFormatter;
  const pipeline = createBattleMessageHooks();
  const hooks = { ...pipeline, beforeMarkdown(text: string, context: FormattingContext) {
    const original = typeof context.messageId === 'number' && context.messageId >= 0 ? host.context().chat?.[context.messageId] : undefined;
    // 宿主可能先把隐藏系统消息规范成 isSystem=false，角色判断仍以原始消息为准。
    return original?.is_user || original?.is_system ? text : pipeline.beforeMarkdown(text, context);
  } };
  let slot: FormatterSlot | undefined;
  if (typeof formatter?.addHook === 'function' && formatter.stage?.AFTER_REGEX && formatter.stage.AFTER_MARKDOWN) try {
    slot = window.__tavernBattleFormatter;
    if (slot?.formatter !== formatter) {
      if (slot) { slot.hooks?.clear(); slot.hooks = undefined; }
      slot = { formatter }; window.__tavernBattleFormatter = slot;
      const bridge = slot;
      // 当前 MessageFormatter 没有 removeHook；同一实例只注册一次，卸载时禁用桥接。
      formatter.addHook((text: string, context: FormattingContext) => bridge.hooks?.beforeMarkdown(text, context) ?? text,
        { stage: formatter.stage.AFTER_REGEX, order: formatter.order?.LATE ?? 90 });
      formatter.addHook((text: string) => bridge.hooks?.afterMarkdown(text) ?? text,
        { stage: formatter.stage.AFTER_MARKDOWN, order: formatter.order?.LATE ?? 90 });
    }
    slot.hooks = hooks;
  } catch {
    // 旧版或其他分支的格式化接口不兼容时，继续使用下面的局部显示补全。
    if (slot) slot.hooks = undefined;
    delete window.__tavernBattleFormatter; slot = undefined;
  }
  let style = document.getElementById(stylesId);
  if (!style) {
    style = document.createElement('style'); style.id = stylesId;
    style.textContent = `.${BATTLE_DETAILS_CLASS}{margin:.6em 0;border:1px solid #8886;border-radius:8px;padding:.45em .7em;max-width:100%;box-sizing:border-box}.${BATTLE_DETAILS_CLASS}>summary{cursor:pointer;font-weight:600;user-select:none}.${BATTLE_DETAILS_CLASS}>pre{max-height:24rem;overflow:auto;margin:.6em 0 0;white-space:pre-wrap;overflow-wrap:anywhere}.${BATTLE_DETAILS_CLASS}>pre>code{white-space:pre-wrap;overflow-wrap:anywhere}`;
    (document.head ?? document.body).append(style);
  }
  const cache = new WeakMap<HTMLElement, { raw: string; cards: HTMLDetailsElement[]; rendered: HTMLDetailsElement[] }>();
  const queued = new Set<HTMLElement>(); let timer: ReturnType<typeof setTimeout> | undefined;
  const enhance = (messageElement: HTMLElement) => {
    if (!active || !messageElement.isConnected || messageElement.querySelector('.mes_edit_textarea')) return;
    const id = messageElement.getAttribute('mesid');
    if (!id || !/^\d+$/.test(id)) return;
    const message = host.context().chat?.[Number(id)];
    const root = messageElement.querySelector<HTMLElement>('.mes_text');
    if (!root) return;
    const old = cache.get(root), raw = !message?.is_user && !message?.is_system && typeof message?.mes === 'string' ? message.mes : '';
    if (old?.raw === raw && old.rendered.every(card => root.contains(card))) return;
    const open = old?.cards.map(card => card.open) ?? [];
    old?.cards.forEach(card => card.remove());
    const blocks = battleDisplayBlocks(raw), cards: HTMLDetailsElement[] = [], rendered: HTMLDetailsElement[] = [];
    // 钩子或用户已有折叠已经完整显示的内容不再追加。
    const folded = [...root.querySelectorAll('details')];
    for (const [index, block] of blocks.entries()) {
      const existing = folded.find(el => (el.textContent ?? '').includes(block.text));
      if (existing) { rendered.push(existing); folded.splice(folded.indexOf(existing), 1); continue; }
      const card = detailsElement(document, block); card.open = open[index] ?? false;
      const rawTag = [...root.querySelectorAll('tb')].find(el => !el.closest('details, pre, code'));
      if (rawTag) rawTag.replaceWith(card);
      else if (!replaceVisibleBlock(root, block, card) && !replaceBlankBlock(root, raw, block, card)) root.append(card);
      cards.push(card); rendered.push(card);
    }
    cache.set(root, { raw, cards, rendered });
  };
  const queue = (element: HTMLElement) => {
    queued.add(element);
    if (timer !== undefined) return;
    timer = setTimeout(() => { timer = undefined; const pending = [...queued]; queued.clear(); pending.forEach(enhance); }, 0);
  };
  const scan = () => document.querySelectorAll<HTMLElement>('#chat .mes[mesid]').forEach(queue);
  const observer = new MutationObserver(records => {
    if (!active) return;
    for (const record of records) {
      const target = record.target.nodeType === 1 ? record.target as Element : record.target.parentElement;
      if (target?.closest('.' + BATTLE_DETAILS_CLASS)) continue;
      const message = target?.closest<HTMLElement>('#chat .mes[mesid]'); if (message) queue(message);
      for (const added of record.addedNodes) if (added.nodeType === 1) {
        const element = added as HTMLElement;
        if (element.matches('#chat .mes[mesid]')) queue(element);
        element.querySelectorAll<HTMLElement>('#chat .mes[mesid]').forEach(queue);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  const stops = ['CHAT_CHANGED', 'CHARACTER_MESSAGE_RENDERED', 'MESSAGE_UPDATED', 'MESSAGE_SWIPED', 'GENERATION_ENDED'].map(event => host.subscribe(event, scan).stop);
  scan();
  return () => {
    if (!active) return; active = false;
    hooks.clear(); if (slot?.hooks === hooks) slot.hooks = undefined;
    observer.disconnect(); stops.forEach(stop => stop()); if (timer !== undefined) clearTimeout(timer); queued.clear(); style?.remove();
  };
}
