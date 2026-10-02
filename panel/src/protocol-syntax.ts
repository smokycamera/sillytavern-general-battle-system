import { normalizeNarrativeSpec } from './spec-tolerance.js';
/** 正文格式层：只提取标签并修正常见书写差异，不生成缺失身份或战斗数值。 */
export interface ProtocolTag { name: string; attrs: string; raw: string; complete: boolean; block: number; start?: number; end?: number; attrsStart?: number }
export interface ProtocolAttribute { key: string; raw: string; start: number; end: number; value: string }
const compactKey = (value: string) => value.toLowerCase().replace(/[-_]/g, '');
export function protocolName(value: string): string {
  const key = compactKey(value);
  return key === 'unitupdate' ? 'unit_update' : key === 'unitset' ? 'unit_set' : key;
}
export function decodeEntities(value: string): string {
  return value.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[0-9a-f]+);/gi, (entity) => {
    const named: Record<string, string> = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' };
    if (named[entity.toLowerCase()]) return named[entity.toLowerCase()]!;
    const number = entity.slice(2, -1), code = number[0]?.toLowerCase() === 'x' ? parseInt(number.slice(1), 16) : Number(number);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : entity;
  });
}
export function serializeEvent(name: string, attrs: Record<string, string>): string {
  const encode = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return '<' + name + ' ' + Object.keys(attrs).sort().map((key) => key + '="' + encode(attrs[key]!) + '"').join(' ') + '/>';
}

export function scanProtocolTags(text: string, known: ReadonlySet<string>): { tags: ProtocolTag[]; warnings: string[] } {
  let offsets = Array.from({ length: text.length }, (_, i) => i);
  const unwrap = (pattern: RegExp) => {
    const parts: string[] = [], nextOffsets: number[] = []; let cursor = 0;
    for (const match of text.matchAll(pattern)) {
      const at = match.index!, body = match[1]!, bodyAt = match[0].indexOf(body);
      parts.push(text.slice(cursor, at), '<' + body + '>');
      for (let i = cursor; i < at; i++) nextOffsets.push(offsets[i]!);
      nextOffsets.push(offsets[at]!);
      for (let i = 0; i < body.length; i++) nextOffsets.push(offsets[at + bodyAt + i]!);
      nextOffsets.push(offsets[at + match[0].length - 1]!); cursor = at + match[0].length;
    }
    if (!cursor) return;
    parts.push(text.slice(cursor));
    for (let i = cursor; i < text.length; i++) nextOffsets.push(offsets[i]!);
    text = parts.join(''); offsets = nextOffsets;
  };
  // 显示转义的标签也参与扫描；属性值中的实体留给属性解析，避免制造额外事件。
  text = text.replace(/＜/g, '<').replace(/＞/g, '>');
  unwrap(/\\?&lt;(\/?[a-z][\s\S]*?)\\?&gt;/gi);
  unwrap(/\\<(\/?[a-z][^<>]*?)\\?>/gi);
  // 思考区不属于最终正文；保留换行使不完整标签的边界仍可检查。
  text = text.replace(/<(think|thinking|analysis|reasoning)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, (value) => value.replace(/[^\n]/g, ' '));
  const tags: ProtocolTag[] = [], warnings: string[] = [];
  const start = /<\s*(\/?)\s*([a-z][a-z0-9_-]*)\b/gi;
  let block = 0, sequence = 0, found: RegExpExecArray | null;
  const containers = new Set(['div', 'span', 'p', 'br', 'pre', 'code', 'details', 'summary', 'blockquote', 'section', 'ul', 'ol', 'li']);
  while ((found = start.exec(text))) {
    const name = protocolName(found[2]!), closing = !!found[1];
    let at = start.lastIndex, quote = '', complete = false;
    for (; at < text.length; at++) {
      const char = text[at]!;
      if (char === '<') break; // 一个截断事件不能吞掉后续独立事件。
      if (quote) { if (char === quote) quote = ''; }
      else if (char === '"' || char === "'") quote = char;
      else if ('“‘「『'.includes(char)) quote = ({ '“': '”', '‘': '’', '「': '」', '『': '』' } as Record<string, string>)[char]!;
      else if (char === '>') { complete = true; break; }
    }
    const end = complete ? at + 1 : at;
    const raw = text.slice(found.index, end).trim();
    const attrText = text.slice(start.lastIndex, complete ? at : end);
    const attrsStart = start.lastIndex + attrText.length - attrText.trimStart().length;
    const attrs = attrText.trim().replace(/\/\s*$/, '');
    start.lastIndex = Math.max(start.lastIndex, end);
    if (name === 'tb') {
      if (closing) block = 0;
      else { block = ++sequence; if (!complete) warnings.push('已识别tb起始标记，外层格式可补全'); }
      continue;
    }
    if (closing) continue;
    if (!known.has(name) && (!block || containers.has(name))) continue;
    tags.push({ name, attrs, raw, complete, block, start: offsets[found.index], end: (offsets[end - 1] ?? offsets[found.index]!) + 1, attrsStart: offsets[attrsStart] ?? offsets[found.index] });
  }
  return { tags, warnings };
}

function halfWidth(value: string): string {
  return value.replace(/[０-９Ａ-Ｚａ-ｚ]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/，/g, ',').replace(/．/g, '.').replace(/／/g, '/').replace(/＋/g, '+').replace(/[−－﹣]/g, '-');
}
function numeric(value: string, key: string): string {
  let source = halfWidth(value).trim().replace(/\s*(?:人|名|点|个|支|队|件|份|次|回合|轮|场|级)\s*$/, '').trim();
  if (key === 'level') source = source.replace(/^(?:level|lv\.?|l)\s*/i, '');
  if (/^\d{1,3}(?:[,\s]\d{3})+(?:\.0+)?$/.test(source)) source = source.replace(/[,\s]/g, '');
  if (/^\d+(?:\.0+)?$/.test(source)) source = String(Number(source));
  return source;
}
const numericKeys = new Set(['hp', 'hpMax', 'level', 'count', 'qty', 'quality', 'rounds', 'battles', 'reserves', 'speed', 'morale', 'xp', 'xpProgress', 'xpValue', 'memberHp', 'atk', 'def', 'spd', 'moraleMax']);
const booleanKeys = new Set(['shield', 'mount', 'stabilized', 'permanent', 'retired']);
const enumAliases: Record<string, Record<string, string>> = {
  side: { 我方: 'ally', 友方: 'ally', 友军: 'ally', allied: 'ally', friendly: 'ally', 敌方: 'enemy', 敌军: 'enemy', hostile: 'enemy' },
  scale: { 个体: 'hero', 英雄: 'hero', 人物: 'hero', 编队: 'company', 连队: 'company', 军团: 'company', 小队: 'company', mook: 'company' },
  archetype: { 步兵: 'infantry', 近战: 'infantry', 射手: 'ranged', 远程: 'ranged', 机动: 'mobile', 骑兵: 'mobile' },
  body: { 人类: 'human', 人形: 'human', 大型: 'large', 载具: 'vehicle', 巨型: 'giant', 巨兽: 'giant' },
  light: { 白天: 'day', 日间: 'day', 夜晚: 'night', 夜间: 'night' },
  type: { 武器: 'weapon', 护甲: 'armor', 消耗品: 'consumable', 材料: 'material', 任务: 'quest', 杂物: 'misc' },
  protection: { 均衡: 'balanced', 动能: 'kinetic', 热能: 'thermal', 奥术: 'arcane' },
  enchant: { 无: 'none', 热能: 'thermal', 奥术: 'arcane' },
};
export function normalizedAttributes(tag: ProtocolTag, allowed: readonly string[], warnings: string[], positions?: ProtocolAttribute[], collectOnly = false): Record<string, string> {
  const aliases: Record<string, string> = { ref: 'id', unitid: 'id', itemid: 'id', equipmentid: 'id', sourceid: 'source', maxhp: 'hpMax', max: 'hpMax', currenthp: 'hp',
    abilities: 'skills', skill: 'skills', sidearm: 'weapon2', secondaryweapon: 'weapon2', primaryweapon: 'weapon', trait: 'traits', armour: 'armor', lv: 'level',
    quantity: tag.name === 'spawn' ? 'count' : 'qty', environment: 'env', lighting: 'light',
    ...(tag.name === 'give' ? { name: 'item' } : tag.name === 'field' ? { name: 'env' } : {}) };
  const result: Record<string, string> = Object.create(null);
  let rest = tag.attrs;
  while (rest.trim()) {
    rest = rest.replace(/^[\s,，;；]+/, '');
    const attrStart = tag.attrs.length - rest.length;
    const attr = rest.match(/^([a-z][a-z0-9_-]*)\s*[=＝:：]\s*/i);
    if (!attr) throw new Error(tag.name + ' 属性缺少明确的名称或值：' + rest.slice(0, 45));
    const originalKey = attr[1]!, lookup = compactKey(originalKey);
    const key = allowed.find((key) => compactKey(key) === lookup) ?? aliases[lookup];
    rest = rest.slice(attr[0].length);
    const quote = rest[0], pair: Record<string, string> = { '"': '"', "'": "'", '“': '”', '‘': '’', '「': '」', '『': '』' };
    const escapedQuote = rest.match(/^&(?:quot|apos|#34|#39|#x22|#x27);/i)?.[0];
    let value: string;
    if (escapedQuote) {
      const end = rest.toLowerCase().indexOf(escapedQuote.toLowerCase(), escapedQuote.length);
      if (end < 0) throw new Error(tag.name + ' 的 ' + originalKey + ' 安全显示引号未闭合');
      value = rest.slice(escapedQuote.length, end); rest = rest.slice(end + escapedQuote.length);
    } else if (quote && pair[quote]) {
      const end = rest.indexOf(pair[quote]!, 1);
      if (end < 0) throw new Error(tag.name + ' 的 ' + originalKey + ' 引号未闭合，值尚不明确');
      value = rest.slice(1, end); rest = rest.slice(end + 1);
    } else {
      const next = rest.search(/[\s,，;；]+(?=[a-z][a-z0-9_-]*\s*[=＝:：])/i);
      value = (next < 0 ? rest : rest.slice(0, next)).trim(); rest = next < 0 ? '' : rest.slice(next);
      if (!value) throw new Error(tag.name + ' 的 ' + originalKey + ' 缺少值');
    }
    const originalValue = value;
    positions?.push({ key: key ?? originalKey, raw: tag.attrs.slice(attrStart, tag.attrs.length - rest.length),
      start: (tag.attrsStart ?? 0) + attrStart, end: (tag.attrsStart ?? 0) + tag.attrs.length - rest.length, value: decodeEntities(value).trim() });
    if (collectOnly) continue;
    value = decodeEntities(value).trim();
    if (!key || !allowed.includes(key)) { if(tag.name==='unit_set')throw Error('unit_set未知属性 '+originalKey+'，复杂字段请写data'); warnings.push(tag.name + ' 未使用额外属性 ' + originalKey); continue; }
    if (numericKeys.has(key)) value = numeric(value, key);
    if (tag.name === 'spawn' && key === 'level') value = normalizeNarrativeSpec('L' + value).replace(/^L/i, '');
    if (booleanKeys.has(key)) value = ({ '1': 'true', '0': 'false', yes: 'true', no: 'false', 是: 'true', 否: 'false', 有: 'true', 无: 'false' } as Record<string, string>)[value.toLowerCase()] ?? value.toLowerCase();
    if (enumAliases[key]) value = enumAliases[key]![value.toLowerCase()] ?? value.toLowerCase();
    if (key === 'env') value = value.toLowerCase();
    if (['weapon', 'weapon2', 'armor', 'shieldSpec', 'spec'].includes(key)) value = value.split(/[,，、;；]/).map(normalizeNarrativeSpec).join(',');
    if (['skills', 'traits', 'effects', 'clear'].includes(key)) {
      if (value.startsWith('[')) {
        const list: unknown = JSON.parse(value);
        if (!Array.isArray(list) || list.some(item => typeof item !== 'string')) throw Error(key + '列表须为文字数组');
        value = list.join(',');
      }
      value = value.split(key === 'skills' ? /[,，、;；\n]+/ : /[,，、;；|+＋\n]+/).map((part) => part.trim()).filter(Boolean).join(',');
    }
    if (Object.hasOwn(result, key) && result[key] !== value) throw new Error(tag.name + ' 的 ' + key + ' 重复且数值冲突');
    if (originalKey !== key || value !== originalValue || !quote || !pair[quote]) warnings.push('已规范化 ' + tag.name + '.' + key);
    result[key] = value;
  }
  if (collectOnly) return result;
  if (tag.name === 'spawn' && result.scale === 'hero') heroWound(result, warnings);
  if (result.hp?.includes('/')) {
    const parts = result.hp.split('/').map((part) => numeric(part, 'hp'));
    if (parts.length !== 2 || parts.some((part) => !/^\d+$/.test(part))) throw new Error('hp 的当前值/上限写法不明确');
    if (result.hpMax !== undefined && result.hpMax !== parts[1]) throw new Error('hp中的上限与hpMax冲突');
    result.hp = parts[0]!; result.hpMax = parts[1]!; warnings.push('已将生命/人数分数拆为hp和hpMax');
  }
  return result;
}

/** Hero life is derived from training/body/bonuses; narrated hp/hpMax only set the wound ratio and never block creation. */
function heroWound(result: Record<string, string>, warnings: string[]): void {
  const name = result.name ?? '英雄', fraction = result.hp?.includes('/') ? result.hp.split('/').map((part) => numeric(part, 'hp')) : undefined;
  const [hp, max] = fraction ?? [result.hp, result.hpMax];
  const conflict = !!fraction && result.hpMax !== undefined && fraction[1] !== result.hpMax;
  delete result.hp; delete result.hpMax;
  if (hp === undefined) return; // 只给上限等于满生命，上限本身仍由训练推导。
  if (max === undefined) { warnings.push(name + '只写了hp，缺少hpMax无法换算伤势，按满生命建档'); return; }
  const valid = !conflict && (!fraction || fraction.length === 2) && Number(max) >= 1
    && [hp, max].every((value) => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)));
  if (!valid) { warnings.push(name + '的hp/hpMax不是一组有效整数，按满生命建档'); return; }
  if (Number(hp) > Number(max)) warnings.push(name + '的hp高于hpMax，按满生命建档');
  if (Number(hp) === 0) warnings.push(name + '的hp为0：新建单位至少保留1点生命');
  result.hp = String(Math.min(Number(hp), Number(max))); result.hpMax = String(Number(max));
}
