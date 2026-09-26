import { decodeEntities, scanProtocolTags } from '../../panel/src/protocol-syntax.js';

export const BATTLE_DETAILS_CLASS = 'tb-native-events';
export interface BattleDisplayBlock { start: number; end: number; text: string; count: number }
export interface FormattingContext { isUser?: boolean; isSystem?: boolean; isReasoning?: boolean; messageId?: number }
const escaped = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** 只展示完整事件块。思考、注释、已有折叠和代码示例保持原显示方式。 */
export function battleDisplayBlocks(text: string): BattleDisplayBlock[] {
  const protectedRanges = [...text.matchAll(/<!--[\s\S]*?(?:-->|$(?![\s\S]))|<(think|thinking|analysis|reasoning|details|pre|code)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$(?![\s\S]))|^\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^\s*\2\s*$|$(?![\s\S]))|(`+)[^\n]*?\3/gim)]
    .map(match => [match.index!, match.index! + match[0].length] as const);
  let visible = '', cursor = 0;
  for (const [start, end] of protectedRanges) { visible += text.slice(cursor, start) + ' '.repeat(end - start); cursor = end; }
  visible += text.slice(cursor);
  const blocks: BattleDisplayBlock[] = [];
  const pattern = /<tb\s*>[\s\S]*?<\/tb\s*>|&lt;tb\s*&gt;[\s\S]*?&lt;\/tb\s*&gt;/gi;
  for (const match of visible.matchAll(pattern)) {
    const start = match.index!, end = start + match[0].length;
    const original = text.slice(start, end), body = original.startsWith('&') ? decodeEntities(original) : original;
    blocks.push({ start, end, text: body, count: scanProtocolTags(body, new Set()).tags.filter(tag => tag.complete).length });
  }
  return blocks;
}

export const battleDisplaySummary = (block: BattleDisplayBlock) => `📋 战阵事件 · ${block.count}项`;
export function battleBlockHtml(block: BattleDisplayBlock): string {
  return `<details class="${BATTLE_DETAILS_CLASS}"><summary>${battleDisplaySummary(block)}</summary><pre><code>${escaped(block.text)}</code></pre></details>`;
}
/** 返回显示副本，绝不写回 message.mes，也不执行或确认事件。 */
export function formatBattleMessage(text: string, context: FormattingContext): string {
  if (context.isUser || context.isSystem || context.isReasoning) return text;
  const blocks = battleDisplayBlocks(text);
  for (const block of blocks.reverse()) text = text.slice(0, block.start) + '\n\n' + battleBlockHtml(block) + '\n\n' + text.slice(block.end);
  return text;
}

/** 跨过宿主的 Markdown、encode_tags 与 code 实体还原，再在净化前插入安全 HTML。 */
export function createBattleMessageHooks() {
  const frames = new Map<string, Map<string, string>>();
  return {
    beforeMarkdown(text: string, context: FormattingContext): string {
      if (context.isUser || context.isSystem || context.isReasoning) return text;
      const blocks = battleDisplayBlocks(text); if (!blocks.length) return text;
      const key = crypto.randomUUID().replaceAll('-', '');
      // 正常格式化同步完成；只为宿主异常中断留下少量临时帧，不积累聊天原文。
      if (frames.size >= 16) frames.delete(frames.keys().next().value!);
      const frame = new Map<string, string>(); frames.set(key, frame);
      for (const [index, block] of [...blocks.entries()].reverse()) {
        const token = 'TAVERNBATTLEEVENT' + key + 'N' + index + 'END';
        frame.set(token, battleBlockHtml(block));
        text = text.slice(0, block.start) + '\n\n' + token + '\n\n' + text.slice(block.end);
      }
      return text;
    },
    afterMarkdown(text: string): string {
      for (const [key, frame] of frames) {
        for (const [token, html] of frame) if (text.includes(token)) {
          text = text.replaceAll('<p>' + token + '</p>', html).replaceAll(token, html); frame.delete(token);
        }
        if (!frame.size) frames.delete(key);
      }
      return text;
    },
    clear() { frames.clear(); },
  };
}
