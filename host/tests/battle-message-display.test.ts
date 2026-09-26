// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NativeHost, type HostContext, type HostWindow, type MessageFormatter } from '../src/sillytavern.js';
import { installBattleMessageDisplay } from '../src/battle-message-display.js';
import { battleDisplayBlocks, formatBattleMessage, createBattleMessageHooks, BATTLE_DETAILS_CLASS, type FormattingContext } from '../src/battle-message-format.js';
import { parseProtocol } from '../../panel/src/protocol.js';

const block = '<tb>\n<spawn name="步枪兵" side="enemy" scale="hero" weapon="步枪L5"/>\n<field env="forest"/>\n</tb>';
const reply = '他推开门。\n\n' + block + '\n\n风声渐远。';
const stops: (() => void)[] = [];
afterEach(() => { stops.splice(0).forEach(stop => stop()); document.body.replaceChildren(); document.head.replaceChildren(); });
const flush = () => new Promise(resolve => setTimeout(resolve, 25));
function fixture(native = false) {
  const handlers = new Map<string, Set<(...args: unknown[]) => void>>(), hooks: ((text: string, context: FormattingContext) => string)[] = [];
  const formatter: MessageFormatter = { stage: { AFTER_REGEX: 'afterRegex', AFTER_MARKDOWN: 'afterMarkdown' }, order: { LATE: 90 }, addHook: vi.fn((fn) => { hooks.push(fn); }) };
  const context: HostContext = {
    chat: [{ mes: reply, is_user: false }], ...(native ? { messageFormatter: formatter } : {}),
    eventTypes: Object.fromEntries(['CHAT_CHANGED', 'CHARACTER_MESSAGE_RENDERED', 'MESSAGE_UPDATED', 'MESSAGE_SWIPED', 'GENERATION_ENDED'].map(key => [key, key])),
    eventSource: { on(event, fn) { if (!handlers.has(event)) handlers.set(event, new Set()); handlers.get(event)!.add(fn); }, off(event, fn) { handlers.get(event)?.delete(fn); } },
    saveChat: vi.fn(), saveMetadata: vi.fn(),
  };
  const hostWindow: HostWindow = { SillyTavern: { getContext: () => context } }, host = new NativeHost(hostWindow, 'test');
  document.body.innerHTML = '<div id="chat"><div class="mes" mesid="0"><div class="mes_text"><p>他推开门。</p><iframe title="状态栏"></iframe><p>风声渐远。</p></div></div></div>';
  const root = () => document.querySelector<HTMLElement>('.mes_text')!;
  const install = () => { const stop = installBattleMessageDisplay(host, hostWindow, document); stops.push(stop); return stop; };
  const emit = (event: string) => handlers.get(event)?.forEach(fn => fn(0));
  const format = (text: string, meta: FormattingContext = {}) => hooks.reduce((value, fn) => fn(value, meta), text);
  return { context, formatter, host, hostWindow, root, install, emit, format, hooks, handlers };
}

describe('原生战阵事件显示', () => {
  it('转义并折叠完整块，正文与源数据不变，内容可读可复制', () => {
    const output = formatBattleMessage(reply, {}); const div = document.createElement('div'); div.innerHTML = output;
    const card = div.querySelector('details')!;
    expect(card.open).toBe(false); expect(card.querySelector('summary')!.textContent).toBe('📋 战阵事件 · 2项');
    expect(card.querySelector('code')!.textContent).toBe(block); expect(div.querySelector('spawn')).toBeNull();
    expect(output.startsWith('他推开门。')).toBe(true); expect(output.endsWith('风声渐远。')).toBe(true);
    expect(parseProtocol(reply).events).toHaveLength(2);
    expect(parseProtocol(card.querySelector('code')!.textContent!).canonical).toBe(parseProtocol(block).canonical);
    expect(formatBattleMessage(output, {})).toBe(output);
  });
  it('跳过用户、系统、思考与非事件回复', () => {
    for (const meta of [{ isUser: true }, { isSystem: true }, { isReasoning: true }]) expect(formatBattleMessage(reply, meta)).toBe(reply);
    for (const text of ['普通正文', '<tb>\n<spawn name="生成中', '<tb>尚未闭合', '这里提到了 `<tb>`']) expect(formatBattleMessage(text, {})).toBe(text);
  });
  it('思考、注释、代码与已有折叠不重复加工，隐藏块不计入正式事件', () => {
    for (const text of [`<think>${block}</think>`, `<!--${block}-->`, '```xml\n' + block + '\n```', '`<tb><deploy id="a"/></tb>`', '<details><summary>旧折叠</summary><pre><code>' + block + '</code></pre></details>', '<pre>' + block + '</pre>']) {
      expect(formatBattleMessage(text, {}), text).toBe(text);
      expect(battleDisplayBlocks(text + '\n' + block)).toHaveLength(1);
    }
    expect(battleDisplayBlocks('<analysis>未结束\n' + block)).toEqual([]);
    expect(battleDisplayBlocks('事件用 `<tb>` 包裹。\n' + block).map(item => item.text)).toEqual([block]);
  });
  it('HTML 属性、代码结束标签和脚本都只能作为文本，不执行消息内容', () => {
    const payload = '<tb>\n<spawn name="&quot; &amp;"/>\n</code></pre><img src=x onerror="alert(1)"><script>alert(2)</script>\n</tb>';
    const div = document.createElement('div'); div.innerHTML = formatBattleMessage(payload, {});
    expect(div.querySelector('code')!.textContent).toBe(payload);
    expect(div.querySelector('img, script, spawn')).toBeNull();
    expect(div.querySelectorAll('details')).toHaveLength(1);
  });
  it('多个完整块与已转义的外层可显示，单纯提到 tb 不触发', () => {
    const encoded = block.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    expect(battleDisplayBlocks(encoded)[0]!.text).toBe(block);
    expect(battleDisplayBlocks(block + '\n' + block)).toHaveLength(2);
    expect(battleDisplayBlocks('<table><tbody></tbody></table>')).toEqual([]);
  });
  it('有钩子的宿主注册 AFTER_REGEX，只注册一次，卸载后停用，重新启用可恢复', async () => {
    const f = fixture(true), stop = f.install(); await flush();
    expect(f.formatter.addHook).toHaveBeenCalledWith(expect.any(Function), { stage: 'afterRegex', order: 90 });
    expect(f.format(reply)).toContain('<details'); expect(f.format(reply, { isUser: true })).toBe(reply);
    f.context.chat![0]!.is_system = true;
    expect(f.format(reply, { isSystem: false, messageId: 0 })).toBe(reply);
    delete f.context.chat![0]!.is_system;
    stop(); expect(f.format(reply)).toBe(reply);
    f.install(); expect(f.hooks).toHaveLength(2); expect(f.format(reply)).toContain('<details');
    expect(f.context.chat![0]!.mes).toBe(reply); expect(f.context.saveChat).not.toHaveBeenCalled(); expect(f.context.saveMetadata).not.toHaveBeenCalled();
  });
  it('Markdown 与宿主 encode_tags/code 实体解码不会破坏事件或折叠 HTML', () => {
    const source = '<tb>\n<spawn name="甲&quot;乙&amp;丙&lt;丁"/>\n</tb>';
    const hooks = createBattleMessageHooks();
    const temporary = hooks.beforeMarkdown(source, {});
    expect(temporary).not.toContain('<tb>'); expect(temporary).not.toContain('<details');
    const markdown = '<p>' + temporary.trim().replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('&amp;', '&') + '</p>';
    const restored = hooks.afterMarkdown(markdown), div = document.createElement('div'); div.innerHTML = restored;
    expect(div.querySelector('code')!.textContent).toBe(source);
    expect(div.querySelectorAll('details')).toHaveLength(1); expect(restored).not.toContain('TAVERNBATTLEEVENT');
    const other = hooks.beforeMarkdown(source, {}); hooks.clear(); expect(hooks.afterMarkdown(other)).toBe(other);
  });
  it('无钩子的 TauriTavern 显示被 HTML 吞掉的内容，保持正文和 iframe 实例', async () => {
    const f = fixture(), before = f.context.chat![0]!.mes, frame = f.root().querySelector('iframe'), paragraph = f.root().querySelector('p');
    f.install(); await flush();
    const card = f.root().querySelector<HTMLDetailsElement>('details')!; expect(card.querySelector('code')!.textContent).toBe(block);
    expect(f.root().querySelector('iframe')).toBe(frame); expect(f.root().querySelector('p')).toBe(paragraph);
    card.open = true; f.emit('CHARACTER_MESSAGE_RENDERED'); await flush();
    expect(f.root().querySelectorAll('details')).toHaveLength(1); expect(card.isConnected).toBe(true); expect(card.open).toBe(true);
    expect(f.context.chat![0]!.mes).toBe(before); expect(f.context.saveChat).not.toHaveBeenCalled(); expect(f.context.saveMetadata).not.toHaveBeenCalled();
  });
  it('历史楼层与后来加载的楼层都处理，用户和系统消息保持原样', async () => {
    const f = fixture(); f.context.chat!.push({ mes: block, is_user: true }, { mes: block, is_system: true }, { mes: block });
    f.install(); await flush();
    const chat = document.querySelector('#chat')!;
    for (const id of [1, 2, 3]) chat.insertAdjacentHTML('beforeend', `<div class="mes" mesid="${id}"><div class="mes_text"></div></div>`);
    await flush();
    expect(document.querySelectorAll('details')).toHaveLength(2);
    expect(document.querySelector('[mesid="1"] details')).toBeNull(); expect(document.querySelector('[mesid="2"] details')).toBeNull();
  });
  it('清除被吞掉的 15 项事件留下的换行，尾部与正文中间都原位折叠', async () => {
    const events = '<tb>\n' + Array.from({ length: 15 }, (_, i) => `<deploy id="u${i}"/>`).join('\n') + '\n</tb>';
    for (const middle of [false, true]) for (const wrapped of [false, true]) {
      const f = fixture();
      f.context.chat![0]!.mes = '风又紧了。\n\n' + events + (middle ? '\n\n后文。' : '');
      const blanks = '<br>\n'.repeat(16);
      f.root().innerHTML = wrapped ? '<p>风又紧了。</p>\n<p>' + blanks + '</p>' : '<p>风又紧了。' + blanks + '</p>';
      if (middle) f.root().insertAdjacentHTML('beforeend', '<p>后文。</p>');
      const paragraph = f.root().querySelector('p');
      const stop = f.install(); await flush();
      expect(f.root().querySelector('summary')!.textContent).toBe('📋 战阵事件 · 15项');
      expect(f.root().querySelector('code')!.textContent).toBe(events);
      expect(f.root().querySelectorAll('br')).toHaveLength(0);
      expect(f.root().querySelector('p')).toBe(paragraph);
      expect(f.root().textContent!.replace(f.root().querySelector('details')!.textContent!, '')).toBe('风又紧了。' + (middle ? '后文。' : ''));
      if (middle) expect(f.root().lastElementChild!.textContent).toBe('后文。');
      expect(f.context.saveChat).not.toHaveBeenCalled(); stop();
    }
  });
  it('只清理已定位事件的空白，不删除正文中的空行、附件或其他扩展容器', async () => {
    const f = fixture(); f.context.chat![0]!.mes = '前文。\n\n' + block;
    f.root().innerHTML = '<p>保留的空行<br><br></p><p>前文。</p><div style="height:100px"></div><iframe title="状态栏"></iframe><br><br>';
    const frame = f.root().querySelector('iframe'), spacer = f.root().querySelector('div');
    f.install(); await flush();
    expect(f.root().querySelectorAll('br')).toHaveLength(4);
    expect(f.root().querySelector('iframe')).toBe(frame); expect(f.root().querySelector('div')).toBe(spacer);
    expect(f.root().querySelector('code')!.textContent).toBe(block);
  });
  it('流式结束才折叠完整块，编辑、swipe、换聊天和宿主重绘后同步', async () => {
    const f = fixture(); f.context.chat![0]!.mes = '<tb><deploy id="'; f.install(); await flush(); expect(f.root().querySelector('details')).toBeNull();
    f.context.chat![0]!.mes = '<tb><deploy id="a"/></tb>'; f.emit('GENERATION_ENDED'); await flush();
    expect(f.root().querySelector('code')!.textContent).toContain('id="a"');
    f.context.chat![0]!.mes = '<tb><deploy id="b"/></tb>'; f.root().innerHTML = '<p>新的 swipe</p>'; f.emit('MESSAGE_SWIPED'); await flush();
    expect(f.root().querySelectorAll('details')).toHaveLength(1); expect(f.root().querySelector('code')!.textContent).toContain('id="b"');
    f.context.chat![0]!.mes = '删去事件'; f.root().innerHTML = '<p>删去事件</p>'; f.emit('MESSAGE_UPDATED'); await flush(); expect(f.root().querySelector('details')).toBeNull();
    f.context.chat = [{ mes: block }]; f.root().innerHTML = '<p>另一聊天</p>'; f.emit('CHAT_CHANGED'); await flush(); expect(f.root().querySelector('code')!.textContent).toBe(block);
  });
  it('不重复包裹钩子或旧正则已生成的有效折叠，重绘丢失时仍能补全', async () => {
    const f = fixture(true); f.root().innerHTML = formatBattleMessage(reply, {}); f.install(); await flush();
    expect(f.root().querySelectorAll('details')).toHaveLength(1);
    f.root().innerHTML = '<p>宿主重绘时没有保留显示扩展</p>'; await flush(); expect(f.root().querySelectorAll('details')).toHaveLength(1);
  });
  it('原始 tb 或已转义文本在原位置替换，不复制两份事件', async () => {
    for (const encoded of ['raw', 'escaped', 'br']) {
      const f = fixture();
      const content = encoded === 'raw' ? block : block.replaceAll('<', '&lt;').replaceAll('>', '&gt;');
      f.root().innerHTML = '<p>前文</p>' + (encoded === 'br' ? content.replaceAll('\n', '<br>') : content) + '<p>后文</p>';
      const stop = f.install(); await flush();
      expect(f.root().querySelectorAll('details')).toHaveLength(1); expect(f.root().querySelector('tb')).toBeNull();
      expect(f.root().textContent!.match(/<tb>/g)).toHaveLength(1);
      expect(f.root().lastElementChild!.textContent).toBe('后文'); stop();
    }
  });
  it('消息编辑框不被干扰，卸载后监听器与观察器停止', async () => {
    const f = fixture(); document.querySelector('.mes')!.insertAdjacentHTML('beforeend', '<textarea class="mes_edit_textarea"></textarea>');
    const stop = f.install(); await flush(); expect(f.root().querySelector('details')).toBeNull();
    document.querySelector('textarea')!.remove(); f.emit('MESSAGE_UPDATED'); await flush(); expect(f.root().querySelector('details')).not.toBeNull();
    stop(); stop(); expect([...f.handlers.values()].every(set => !set.size)).toBe(true);
    f.root().innerHTML = '<p>卸载</p>'; f.emit('MESSAGE_UPDATED'); await flush(); expect(f.root().querySelector('details')).toBeNull();
  });
  it('不兼容钩子降级为显示补全，不阻止战斗插件启动', async () => {
    const f = fixture(true); f.formatter.addHook = () => { throw Error('旧接口'); };
    expect(() => f.install()).not.toThrow(); await flush(); expect(f.root().querySelector('.' + BATTLE_DETAILS_CLASS)).not.toBeNull();
  });
});
