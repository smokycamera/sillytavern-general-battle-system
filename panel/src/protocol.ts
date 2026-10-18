import { WEAPON_CLASSES } from '../../engine/src/data/weapons.js';
import { parseEnhancementSuffix, enhancementLabel, type Enhancements, type BonusKind } from '../../engine/src/enhancements.js';
import { narrativeTraitLevel, traitLevelToken, traitRegistry, inferArchetype, type BodyKind } from '../../engine/src/index.js';
/** V2正文：全文提取、格式容错、逐项诊断；真实身份和数值由事务层最终核对。 */
import { parseAbilitySpec, parseSuggestionTags, type Suggestion } from './tags.js';
import { resolveWeaponClass } from '../../engine/src/data/weapons.js';
import { MAX_PROTOCOL_CHARS, MAX_PROTOCOL_EVENTS, MAX_SCENE_UNITS, MAX_SPAWN_COUNT, GROUPING_HINT } from './narrative-limits.js';
import { scanProtocolTags, normalizedAttributes, serializeEvent, ProtocolSyntaxError, type ProtocolTag, type ProtocolAttribute } from './protocol-syntax.js';
import { parseUnitSet, itemKey, UNIT_SET_ATTRIBUTES } from './unit-set.js';
import { normalizeNarrativeSkill, normalizeNarrativeSpec } from './spec-tolerance.js';
import { parseItemSpecification, parseSpawnItem, splitSpawnItems, spawnItemText, spawnItemName, splitItemSpecification, itemSpecificationText, assertItemCompiles } from './item-spec.js';
import { normalizeHandle } from './narrative-ids.js';

export interface ProtocolDiagnostic { message: string; start: number; end: number; field?: string; event: string }
export interface ProtocolBatch { events: Suggestion[]; canonical: string; errors: string[]; warnings: string[]; diagnostics: ProtocolDiagnostic[] }
const ATTRIBUTES: Record<string, readonly string[]> = {
  unit_set: UNIT_SET_ATTRIBUTES,
  deploy: ['id'],
  learn: ['id', 'skills'],
  unit_update: ['id', 'hp', 'hpMax', 'morale', 'state', 'clear', 'reason'],
  spawn: ['id', 'name', 'side', 'scale', 'archetype', 'level', 'count', 'hp', 'hpMax', 'body', 'mount', 'speed', 'stabilized', 'protection', 'reserves', 'quality', 'shield', 'weapon', 'weapon2', 'armor', 'skills', 'traits', 'items'],
  field: ['env', 'light', 'note'],
  take: ['id', 'qty', 'note'],
  give: ['id', 'item', 'note', 'qty', 'type', 'spec', 'body', 'quality', 'enchant', 'stabilized', 'protection'],
  reforge: ['id', 'name', 'spec', 'body', 'quality', 'enchant', 'stabilized', 'protection'],
  bless: ['id', 'name', 'traits', 'rounds', 'battles', 'permanent'],
  unbless: ['id', 'source'],
  affect: ['id', 'name', 'effects', 'rounds', 'battles', 'permanent'],
  unaffect: ['id', 'source'],
};

const known = new Set(Object.keys(ATTRIBUTES));
const actionableNotice = (message: string) => /未采用|未支持|未使用|保留原|忽略/.test(message);
function eventDiagnostic(tag: ProtocolTag, message: string): ProtocolDiagnostic {
  const positions: ProtocolAttribute[] = [];
  try { normalizedAttributes(tag, ATTRIBUTES[tag.name] ?? [], [], positions, true); }
  catch (error) {
    if (error instanceof ProtocolSyntaxError) return { message: error.message, start: error.start, end: error.end, field: error.field, event: tag.name };
  }
  // 跨字段/事件的错误不能靠单字段恢复发现，按实际错误所指的字段定位。
  const explicit = positions.find(token => new RegExp('(?:^|[^a-zA-Z])' + token.key + '(?:$|[^a-zA-Z])').test(message));
  const inferred = /当前值不能超过上限|生命.*上限|人数.*上限/.test(message) ? 'hp'
    : /自编的编号/.test(message) ? 'id' : undefined;
  const token = explicit ?? positions.find(token => token.key === inferred)
    ?? (/更新冲突/.test(message) ? positions.find(token => ['hp', 'hpMax', 'morale', 'state'].includes(token.key)) : undefined);
  return { message, start: token?.start ?? tag.start ?? 0, end: token?.end ?? tag.end ?? 0, field: token?.key, event: tag.name };
}
/** 同一回复里 unit_set 的 items 交给单位的道具名，以及 spawn、unit_set 写进 weapon、weapon2 的武器名。 */
function itemPlacements(tags: ProtocolTag[]): { handed: Set<string>; armed: Set<string> } {
  const handed = new Set<string>(), armed = new Set<string>();
  for (const tag of tags) {
    if (!['unit_set', 'spawn'].includes(tag.name) || !tag.complete) continue;
    try {
      const attrs = normalizedAttributes(tag, ATTRIBUTES[tag.name]!, []);
      if (tag.name === 'unit_set' && attrs.items) for (const entry of splitSpawnItems(attrs.items)) handed.add(itemKey(spawnItemName(entry)));
      for (const key of ['weapon', 'weapon2']) { const name = attrs[key] ? splitItemSpecification(attrs[key]!).name : undefined; if (name) armed.add(itemKey(name)); }
    } catch { /* 主循环会报告这个事件。 */ }
  }
  return { handed, armed };
}
const WEAPON_ONLY = ['quality', 'body', 'enchant', 'stabilized', 'protection'];
/**
 * give 的 spec 是不是道具：type 写明道具；或者没写种类、没有武器专属属性、同一回复没把它当武器换上，
 * 而且 unit_set 的 items 正把它交给单位，或者写的是用掉就没的爆炸物（爆破装置）。
 */
function giveAsItem(attrs: Record<string, string>, handed: ReadonlySet<string>, armed: ReadonlySet<string>): boolean {
  if (['item', 'consumable', 'accessory'].includes(attrs.type ?? '')) return true;
  const name = itemKey(attrs.item ?? '');
  if (attrs.type !== undefined || WEAPON_ONLY.some((key) => attrs[key] !== undefined) || armed.has(name)) return false;
  if (handed.has(name)) return true;
  try {
    const level = splitItemSpecification(attrs.spec ?? '').spec.match(/^(.*?)\s*[lL]\s*\d/);
    return !!level && resolveWeaponClass(level[1]!.trim()) === 'demolition';
  } catch { return false; }
}
/** 记录与编辑器只保留事件标签；不复制正文、代码围栏或思考内容。 */
export function protocolExcerpt(text: string): string {
  const { tags } = scanProtocolTags(text, known);
  if (!tags.length) return '';
  const parts: string[] = []; let block = 0;
  for (const tag of tags) {
    if (tag.block !== block) {
      if (block) parts.push('</tb>');
      if (tag.block) parts.push('<tb>');
      block = tag.block;
    }
    parts.push(tag.raw);
  }
  if (block) parts.push('</tb>');
  const excerpt = parts.join('\n').slice(0, MAX_PROTOCOL_CHARS + 220);
  return tags.every((tag) => !tag.block) ? '<tb>\n' + excerpt + '\n</tb>' : excerpt;
}

export function parseProtocol(text: string, options: { diagnostics?: boolean } = {}): ProtocolBatch {
  const scanned = scanProtocolTags(text, known), warnings = scanned.warnings, errors: string[] = [], skipped: string[] = [];
  const events: Suggestion[] = [], seen = new Map<string, number>(), spawnIds = new Set<string>();
  const issues = new Map<ProtocolTag, string>(), eventTags = new Map<Suggestion, ProtocolTag>(), batchDiagnostics: ProtocolDiagnostic[] = [];
  const scanLimit = MAX_PROTOCOL_EVENTS * 8;
  if (scanned.tags.length > scanLimit) errors.push('待确认内容标签过多，请先减少重复内容；尚未入账');
  if (scanned.tags.reduce((n, tag) => n + tag.raw.length, 0) > MAX_PROTOCOL_CHARS) errors.push('事件内容超过' + MAX_PROTOCOL_CHARS + '字符，先精简事件草稿；正文长度不受此限制');
  const { handed, armed } = itemPlacements(scanned.tags.slice(0, scanLimit));
  for (const tag of scanned.tags.slice(0, scanLimit)) {
    const warningsStart = warnings.length, skippedStart = skipped.length;
    try {
      if (!known.has(tag.name)) throw new Error('暂不支持事件 ' + tag.name + '，请补成已支持的效果；引擎战果无需正文重复发放');
      if (!tag.complete) throw new Error(tag.name + ' 事件被截断，属性值尚不完整');
      const attrs = normalizedAttributes(tag, ATTRIBUTES[tag.name]!, warnings);
      if (tag.name === 'spawn' && attrs.id?.trim()) spawnIds.add(normalizeHandle(attrs.id.trim()));
      // 天生护甲是特质不是护甲种类：armor写成“龙鳞:天生护甲L8”或“天生重甲L6”时，按所写或按身体补出的种类建档，并加上天生护甲。
      if (['spawn', 'unit_set'].includes(tag.name) && attrs.armor) {
        // 改已有单位时不知道它的身体，没写种类也没写body就保留原护甲，不猜轻重。
        const natural = naturalArmorSpec(attrs.armor, tag.name === 'spawn' ? attrs.body ?? 'human' : attrs.body), who = attrs.name || tag.name;
        if (natural && !natural.tier) { delete attrs.armor; warnings.push(`${who}：「${natural.written}」不是护甲种类，保留原护甲；天生护甲请写在traits，armor照常写轻甲/中甲/重甲`); }
        else if (natural) {
          attrs.armor = natural.armor;
          const addTrait = tag.name === 'spawn' || attrs.traits !== undefined;
          if (addTrait) attrs.traits = [attrs.traits, '天生护甲'].filter(Boolean).join(',');
          warnings.push(`${who}：「${natural.written}」不是护甲种类，已按${natural.tier}处理${addTrait ? '并加上天生护甲特质' : '；需要天生护甲请在traits写上'}`);
        }
      }
      const hadOptionalList = !!(attrs.skills || attrs.traits);
      if (['spawn', 'bless', 'unit_set'].includes(tag.name) && attrs.traits) {
        const names = attrs.traits.split(/[,，、;；|]/).map((name) => name.trim()).filter(Boolean);
        const parsed = names.map((name) => narrativeTraitLevel(name)), who = attrs.name || tag.name;
        const unknown = parsed.flatMap((p) => p.kind === 'unknown' ? [p.name] : []);
        if (unknown.length) warnings.push(`${who}：${tag.name === 'unit_set' ? '保留原特质，未采用含未知项的特质列表' : '已忽略未支持特质'} ${unknown.join('、')}`);
        // 停用项与身体/装备项不建档；训练和移动快慢改由 level/speed 表达，正文没写时代为换算。
        for (const p of parsed) if (p.kind === 'ignored') {
          const speed = p.speed !== undefined && tag.name !== 'bless' && attrs.speed === undefined, level = p.level !== undefined && tag.name === 'spawn' && attrs.level === undefined;
          if (speed) attrs.speed = String(p.speed);
          if (level) attrs.level = String(p.level);
          warnings.push(`${who}：「${p.name}」${p.reason}，不再作为特质${speed ? `，已按speed=${p.speed}` : level ? `，已按level=${p.level}` : ''}`);
        }
        // 已完成分级的特质可带 L1–10，同一专精写了多次取最高；其余特质写了等级只保留特质。
        const levels = new Map<string, number>();
        for (const p of parsed) if (p.kind === 'trait') {
          const name = traitRegistry().get(p.id)?.name ?? p.id;
          if (p.droppedLevel !== undefined) warnings.push(p.level !== undefined
            ? `${who}：旧强名称固定按${name}L${p.level}；指定其他等级请用规范名称`
            : `${who}：只有已完成分级的特质可分L1–10，「${name}L${p.droppedLevel}」按${name}建档`);
          if (p.writtenLevel !== undefined) warnings.push(`${who}：专精等级为L1–10，「${name}L${p.writtenLevel}」按L${p.level}`);
          levels.set(p.id, Math.max(levels.get(p.id) ?? 0, p.level ?? 5));
        }
        const supported = [...new Set(parsed.flatMap((p) => p.kind === 'trait' ? [p.id] : []))].map((id) => traitLevelToken(id, levels.get(id)));
        if (tag.name === 'unit_set' && unknown.length) delete attrs.traits;
        else if (supported.length) attrs.traits = supported.join(',');
        else if (tag.name !== 'bless') delete attrs.traits;
        else continue; // 空祝福不创建无效果来源，也不阻断其他事件。
      }
      if (['spawn', 'learn', 'unit_set'].includes(tag.name) && attrs.skills) {
        const names = attrs.skills.split(/[,，、;；]/).map((name) => name.trim()).filter(Boolean);
        const supported: string[] = [], unknown: string[] = [];
        for (const name of names) {
          try {
            const normalized = normalizeNarrativeSkill(name, warnings);
            if (parseAbilitySpec(normalized).length !== 1) throw Error('未支持的技能机制');
            supported.push(normalized);
          } catch (error) {
            unknown.push(name);
            warnings.push(`${attrs.name || tag.name}：未采用技能「${name}」（${error instanceof Error ? error.message : String(error)}）`);
          }
        }
        if (tag.name === 'unit_set' && unknown.length) {
          delete attrs.skills; warnings.push(`${attrs.name || tag.name}：保留原技能列表，避免不完整替换`);
        } else if (supported.length) attrs.skills = supported.join(',');
        else if (tag.name === 'spawn') delete attrs.skills;
        else if (unknown.length) continue;
      }
      const hadItems = attrs.items !== undefined;
      if (['spawn', 'unit_set'].includes(tag.name) && hadItems) {
        // 写不出效果的一项单独略过并说明，不让整条 spawn、unit_set 作废。
        const kept: string[] = [];
        for (const entry of splitSpawnItems(attrs.items!)) {
          try {
            const notes: string[] = [], parsed = parseSpawnItem(entry, notes);
            const item = parsed;
            if (item.spec) assertItemCompiles(item.spec, item.name);
            kept.push(spawnItemText(item)); warnings.push(...notes);
          } catch (error) { skipped.push(`${attrs.name || attrs.id || tag.name}：未采用道具「${entry}」（${error instanceof Error ? error.message : String(error)}）`); }
        }
        if (kept.length) attrs.items = kept.join(','); else delete attrs.items;
      }
      if (tag.name === 'give' && attrs.spec !== undefined) {
        // 写不出效果的道具单独略过；要当道具用的武器词条换成对应道具。
        const notes: string[] = [], consumable = giveAsItem(attrs, handed, armed);
        try {
          const parsed = parseItemSpecification(attrs.spec, consumable ? { type: attrs.type } : attrs, notes, { item: consumable });
          const spec = parsed;
          assertItemCompiles(spec, attrs.item);
          // 换了写法（当道具用的武器词条）就改成规范写法交给后面的校验；说明与 items 里同一项的相同，合并显示。
          if (spec.kind === 'item' && (consumable || spec !== parsed)) { attrs.spec = itemSpecificationText(spec); warnings.push(...notes); }
        } catch (error) {
          skipped.push(`未采用道具「${attrs.item ?? ''}」（${error instanceof Error ? error.message : String(error)}）`);
          continue;
        }
      }
      // 原型只剩建档基础属性一个用途：unit_set 写了不认识的值时保留原值，不让整条修改失败。
      const unitSetArchetype = tag.name === 'unit_set' && attrs.archetype !== undefined && !['infantry', 'ranged', 'mobile'].includes(attrs.archetype);
      if (unitSetArchetype) { warnings.push(`${attrs.name || attrs.id || 'unit_set'}：archetype只认infantry/ranged/mobile，保留原值，未采用「${attrs.archetype}」`); delete attrs.archetype; }
      if (tag.name === 'unit_set' && (hadOptionalList || unitSetArchetype || hadItems) && !Object.keys(attrs).some(key => !['id', 'reason'].includes(key))) continue;
      const event = validatedEvent(tag.name, attrs, warnings);
      const earlier = seen.get(event.raw);
      if (earlier !== undefined && (earlier !== tag.block || ['deploy', 'unit-update'].includes(event.kind))) {
        warnings.push('已合并重复展示的 ' + tag.name + ' 事件'); continue;
      }
      seen.set(event.raw, tag.block);
      if (event.kind === 'unit-update') {
        const existing = events.find((e): e is Extract<Suggestion, { kind: 'unit-update' }> => e.kind === 'unit-update' && e.id === event.id);
        if (existing) {
          if (['hp', 'hpMax', 'morale', 'state'].some((key) => {
            const field = key as 'hp' | 'hpMax' | 'morale' | 'state';
            return existing[field] !== undefined && event[field] !== undefined && existing[field] !== event[field];
          })) throw new Error('档案 ' + event.id + ' 的人数/生命、士气或状态更新冲突，请明确采用哪个绝对值');
          if (event.hp !== undefined) existing.hp = event.hp;
          if (event.hpMax !== undefined) existing.hpMax = event.hpMax;
          if (event.morale !== undefined) existing.morale = event.morale;
          if (event.state !== undefined) existing.state = event.state;
          if (event.clear?.length) existing.clear = [...new Set([...(existing.clear ?? []), ...event.clear])];
          if (event.reason) existing.reason = [existing.reason, event.reason].filter(Boolean).join('；');
          const merged: Record<string, string> = { id: existing.id! };
          for (const key of ['hp', 'hpMax', 'morale', 'state', 'reason'] as const) if (existing[key] !== undefined) merged[key] = String(existing[key]);
          if (existing.clear?.length) merged.clear = existing.clear.join(',');
          existing.raw = serializeEvent('unit_update', merged);
          warnings.push('已合并同一档案的互补更新'); continue;
        }
      }
      events.push(event);
      eventTags.set(event, tag);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(message); issues.set(tag, message);
    } finally {
      const message = skipped.slice(skippedStart)[0] ?? warnings.slice(warningsStart).find(actionableNotice);
      if (message && !issues.has(tag)) issues.set(tag, message);
    }
  }
  // spawn 写的 id 不作编号。同一回复再用它：出场是多余的（新单位自动上场），其余修改落不到新单位上。
  for (let i = events.length - 1; i >= 0 && spawnIds.size; i--) {
    const event = events[i]!;
    if (!['deploy', 'unit-update', 'unit-set', 'learn', 'bless', 'affect', 'unbless', 'unaffect', 'give'].includes(event.kind) || !('id' in event) || !event.id || !spawnIds.has(normalizeHandle(event.id))) continue;
    if (event.kind === 'deploy') { events.splice(i, 1); warnings.push(`已略过 deploy ${event.id}：这是本回复 spawn 自编的编号，新单位会自动上场`); }
    else {
      const message = `${event.id} 是本回复 spawn 自编的编号，新单位的编号由插件分配；要设置新单位请写进 spawn，或在下一次回复按单位资料里的编号修改`;
      errors.push(message); issues.set(eventTags.get(event)!, message);
    }
  }
  const spawned = events.reduce((n, event) => n + (event.kind === 'spawn' ? event.count : 0), 0);
  if (events.length > MAX_PROTOCOL_EVENTS) errors.push('合并重复内容后共有' + events.length + '项事件，最多' + MAX_PROTOCOL_EVENTS + '项；请调整草稿，尚未入账');
  if (spawned > MAX_SCENE_UNITS) errors.push('本批新建单位超过' + MAX_SCENE_UNITS + '，请调整草稿；' + GROUPING_HINT);
  // 批量限制指向触发限制的事件；不把首条错误复制到全部合法事件。
  if (scanned.tags.length > scanLimit) batchDiagnostics.push(eventDiagnostic(scanned.tags[scanLimit]!, errors[0]!));
  if (scanned.tags.reduce((n, tag) => n + tag.raw.length, 0) > MAX_PROTOCOL_CHARS && scanned.tags.length) {
    let size = 0; const tag = scanned.tags.find(tag => (size += tag.raw.length) > MAX_PROTOCOL_CHARS)!;
    batchDiagnostics.push(eventDiagnostic(tag, '事件内容超过' + MAX_PROTOCOL_CHARS + '字符，请精简草稿'));
  }
  if (events.length > MAX_PROTOCOL_EVENTS) batchDiagnostics.push(eventDiagnostic(eventTags.get(events[MAX_PROTOCOL_EVENTS]!)!, '事件超过' + MAX_PROTOCOL_EVENTS + '项，请精简草稿'));
  if (spawned > MAX_SCENE_UNITS) {
    let count = 0; const event = events.find(event => event.kind === 'spawn' && (count += event.count) > MAX_SCENE_UNITS)!;
    batchDiagnostics.push(eventDiagnostic(eventTags.get(event)!, '本批新建单位超过' + MAX_SCENE_UNITS + '；' + GROUPING_HINT));
  }
  // 略过的道具排在提示最前；整条回复只剩写不出的道具时作为待补全，不让它悄悄消失。
  if (skipped.length && !events.length && !errors.length) errors.push(skipped[0]!);
  warnings.unshift(...skipped);
  // 格式变换提示较多时，优先展示跳过内容/保留旧值的实质诊断。
  const uniqueWarnings = [...new Set(warnings)];
  const orderedWarnings = [...uniqueWarnings.filter(w => !w.startsWith('已规范化 ')), ...uniqueWarnings.filter(w => w.startsWith('已规范化 '))];
  const batch: ProtocolBatch = { events, canonical: events.map((e) => e.raw).join('\n'), errors: [...new Set(errors)], warnings: orderedWarnings.slice(0, 12), diagnostics: [] };
  if (options.diagnostics !== false && (issues.size || batchDiagnostics.length)) {
    const recovered = recoverProtocol(text).diagnostics;
    for (const [tag, message] of issues) {
      const matches = recovered.filter(d => d.start >= (tag.start ?? 0) && d.end <= (tag.end ?? text.length));
      batchDiagnostics.push(...(matches.length ? matches : [eventDiagnostic(tag, message)]));
    }
    batch.diagnostics = batchDiagnostics.sort((a, b) => a.start - b.start || a.end - b.end);
  }
  return batch;
}

const repairProbes: Record<string, Record<string, string>> = {
  spawn: { name: '规格校验', side: 'ally', scale: 'hero' }, unit_set: { id: '校验' },
  unit_update: { id: '校验', hp: '1' }, deploy: { id: '校验' }, take: { id: '校验' },
  give: { item: '规格校验' }, reforge: { id: '校验', spec: '剑L1' }, field: { env: 'plains' },
  learn: { id: '校验', skills: '治疗L1' }, bless: { id: '校验', traits: '快速', battles: '1' },
  affect: { id: '校验', effects: '诅咒', battles: '1' }, unbless: { id: '校验', source: '校验' }, unaffect: { id: '校验', source: '校验' },
};

function attributeParts(token: ProtocolAttribute, key: string): [number, number][] {
  const ranges: [number, number][] = [];
  const push = (start: number, end: number) => {
    const part = token.value.slice(start, end), leading = part.length - part.trimStart().length;
    if (part.trim()) ranges.push([token.valueOffsets[start + leading]!, token.valueOffsets[start + leading + part.trim().length]!]);
  };
  if (key === 'items') {
    const items: [number, number][] = [];
    splitSpawnItems(token.value, items);
    for (const [start, end] of items) push(start, end);
  } else if (token.value.startsWith('[')) {
    for (const match of token.value.matchAll(/"(?:\\.|[^"\\])*"/g)) push(match.index! + 1, match.index! + match[0].length - 1);
  } else {
    const separator = key === 'skills' ? /[,，、;；\n]+/g : /[,，、;；|+＋\n]+/g;
    let cursor = 0;
    for (const match of token.value.matchAll(separator)) { push(cursor, match.index!); cursor = match.index! + match[0].length; }
    push(cursor, token.value.length);
  }
  return ranges;
}

/** Explicit draft recovery only: remove bad fields/suffixes, retain the unit and all usable data. */
export function recoverProtocol(text: string): { text: string; diagnostics: ProtocolDiagnostic[] } {
  const tags = scanProtocolTags(text, known).tags, lines: string[] = [], diagnostics: ProtocolDiagnostic[] = [];
  for (const tag of tags) {
    const add = (message: string, token?: ProtocolAttribute, needle?: string, range?: [number, number]) => {
      const relative = needle ? token?.value.indexOf(needle) ?? -1 : -1;
      const start = range?.[0] ?? (relative >= 0 ? token!.valueOffsets[relative]! : token?.start ?? tag.start ?? 0);
      const end = range?.[1] ?? (relative >= 0 ? token!.valueOffsets[relative + needle!.length]! : token?.end ?? tag.end ?? text.length);
      diagnostics.push({ message, start, end, field: token?.key, event: tag.name });
    };
    if (!known.has(tag.name)) { add('未支持事件 ' + tag.name); continue; }
    const full = parseProtocol(tag.raw, { diagnostics: false });
    if (!full.errors.length && !full.warnings.some(w => /未采用|未支持|未使用|保留原|忽略/.test(w))) { lines.push(tag.raw); continue; }
    const positions: ProtocolAttribute[] = [];
    let attrs: Record<string, string> = {};
    try { normalizedAttributes(tag, ATTRIBUTES[tag.name]!, [], positions, true); }
    catch (error) {
      if (error instanceof ProtocolSyntaxError) diagnostics.push({ message: error.message, start: error.start, end: error.end, field: error.field, event: tag.name });
      else add(error instanceof Error ? error.message : String(error));
    }
    for (const token of positions) {
      try { Object.assign(attrs, normalizedAttributes({ ...tag, attrs: token.raw }, ATTRIBUTES[tag.name]!, [])); } catch { /* Diagnose each field below. */ }
    }
    const probe = { ...repairProbes[tag.name] }, retained: Record<string, string> = {};
    if (tag.name === 'spawn' && attrs.scale === 'company') {
      probe.scale = 'company'; probe.hpMax = /^\d+$/.test(attrs.hpMax ?? '') && Number(attrs.hpMax) > 0 ? attrs.hpMax! : '1000000000';
    }
    if (tag.name === 'give' && attrs.spec !== undefined) {
      try { parseItemSpecification(attrs.spec, { type: attrs.type }); probe.spec = attrs.spec; }
      catch { probe.spec = attrs.type === 'armor' ? '重甲L1' : '剑L1'; }
    }
    for (const token of positions) {
      const key = token.key;
      if (!ATTRIBUTES[tag.name]!.includes(key)) { add('未使用属性 ' + key, token); continue; }
      let value: string;
      try { value = normalizedAttributes({ ...tag, attrs: token.raw }, ATTRIBUTES[tag.name]!, [])[key]!; }
      catch (error) { add(error instanceof Error ? error.message : String(error), token); continue; }
      if (value === undefined) continue;
      if (key === 'data') {
        try {
          const data: unknown = JSON.parse(value);
          if (data && typeof data === 'object' && !Array.isArray(data)) {
            const valid: Record<string, unknown> = {};
            for (const [field, entry] of Object.entries(data)) {
              try { parseUnitSet({ id: probe.id!, data: JSON.stringify({ [field]: entry }) }); valid[field] = entry; }
              catch (error) { add('data.' + field + '：' + (error instanceof Error ? error.message : String(error)), token, field); }
            }
            value = JSON.stringify(valid);
          }
        } catch { /* Invalid JSON is diagnosed by the strict field parser. */ }
      }
      if (['skills', 'traits', 'effects'].includes(key) && value) {
        const parts: string[] = [];
        const ranges = attributeParts(token, key);
        for (const [index, part] of value.split(/[,，、;；]/).filter(Boolean).entries()) {
          const range = ranges[index];
          try {
            let normalized = part;
            if (key === 'skills') {
              const notes: string[] = [];
              try { normalized = normalizeNarrativeSkill(part, notes); }
              catch { normalized = repairSpecification(part, 'skill', true, message => add(message, token, part, range)); }
              if (parseAbilitySpec(normalized).length !== 1) throw Error('未支持技能 ' + part);
              for (const note of notes) if (/忽略|未支持/.test(note)) add(note, token, part, range);
            } else if (key === 'traits' && narrativeTraitLevel(part).kind !== 'trait') throw Error('未支持特质 ' + part);
            const result = parseProtocol(serializeEvent(tag.name, { ...probe, [key]: normalized }), { diagnostics: false });
            if (result.errors.length || !result.events.length) throw Error(result.errors[0] ?? '未支持' + key + ' ' + part);
            parts.push(normalized);
          } catch (error) { add(error instanceof Error ? error.message : String(error), token, part, range); }
        }
        value = parts.join(',');
        if (!value) continue;
      }
      if (key === 'items' && value) {
        const parts: string[] = [];
        const ranges = attributeParts(token, key);
        for (const [index, part] of splitSpawnItems(value).entries()) {
          try { parts.push(spawnItemText(parseSpawnItem(part))); }
          catch (error) { add(error instanceof Error ? error.message : String(error), token, part, ranges[index]); }
        }
        value = parts.join(',');
        if (!value) continue;
      }
      const fieldProbe = { ...probe };
      if (tag.name === 'unit_set' && ['id', 'reason'].includes(key)) fieldProbe.name = '规格校验';
      if (['rounds', 'battles', 'permanent'].includes(key)) { delete fieldProbe.rounds; delete fieldProbe.battles; delete fieldProbe.permanent; }
      const test = (input: string) => parseProtocol(serializeEvent(tag.name, { ...fieldProbe, [key]: input }), { diagnostics: false });
      let result = test(value);
      if (result.errors.length && ['weapon', 'weapon2', 'armor', 'shield', 'shieldSpec', 'spec', 'level'].includes(key)) {
        try {
          const kind: BonusKind = key === 'level' ? 'unit' : key === 'armor' ? 'armor' : ['shield', 'shieldSpec'].includes(key) ? 'shield' : 'weapon';
          const repaired = repairSpecification(key === 'level' ? 'L' + value : value, kind, false, message => add(message, token));
          value = key === 'level' ? repaired.replace(/^L/i, '') : repaired;
          result = test(value);
        } catch { /* Unknown base mechanisms/levels remain a field error. */ }
      }
      if (result.errors.length) { add(result.errors.join('；'), token); continue; }
      if (Object.hasOwn(retained, key) && retained[key] !== value) { add(key + '重复且数值冲突', token); continue; }
      // Read just this field from the accepted event; never copy probe defaults into the draft.
      const canonicalTag = scanProtocolTags(result.canonical, known).tags[0];
      const accepted = canonicalTag ? normalizedAttributes(canonicalTag, ATTRIBUTES[tag.name]!, []) : {};
      if (accepted[key] !== undefined) retained[key] = accepted[key]!;
      if (key === 'weapon' && accepted.weapon2 && attrs.weapon2 === undefined) retained.weapon2 = accepted.weapon2;
    }
    // Even an incomplete unit remains in the draft so its name and valid fields can be filled in.
    const recovered = serializeEvent(tag.name, retained);
    if (!diagnostics.some(d => d.start >= (tag.start ?? 0) && d.end <= (tag.end ?? text.length))) diagnostics.push(eventDiagnostic(tag, full.errors[0] ?? full.warnings.find(actionableNotice) ?? '事件需要补全'));
    // A unit_set left with only its id changes nothing and would itself be an error.
    if (tag.name === 'unit_set' && !Object.keys(retained).some(key => !['id', 'reason'].includes(key))) continue;
    lines.push(recovered);
  }
  const unique = [...new Map(diagnostics.map(d => [d.start + ':' + d.end + ':' + d.message, d])).values()].sort((a, b) => a.start - b.start || a.end - b.end);
  return { text: lines.length ? '<tb>\n' + lines.join('\n') + '\n</tb>' : '', diagnostics: unique };
}

function repairSpecification(text: string, kind: BonusKind, skill: boolean, removed: (message: string) => void): string {
  const normalized = normalizeNarrativeSpec(text), match = normalized.match(/^(.*?[lL][+-]?\d+(?:\.\d+)?)(.*)$/);
  if (!match || !match[2]) throw Error('基础规格无法解析');
  const base = match[1]!, suffix = match[2]!;
  const check = (value: string) => {
    if (skill) { const result = normalizeNarrativeSkill(value, []); if (parseAbilitySpec(result).length !== 1) throw Error('未知技能机制'); return result; }
    if (kind === 'unit') { const result = parseEnhancementSuffix(value, kind); if (!/^L(?:10|[1-9])$/i.test(result.text)) throw Error('未知单位等级'); return value; }
    parseItemSpecification(value); return value;
  };
  let retained = check(base);
  const parts = [...suffix.matchAll(/[+-][^+-]*/g)];
  if (parts.map(part => part[0]).join('') !== suffix) removed('已移除不完整修正 ' + suffix);
  for (const part of parts) {
    try { retained = check(retained + part[0]); }
    catch (error) { removed('已移除修正 ' + part[0] + '：' + (error instanceof Error ? error.message : String(error))); }
  }
  return retained;
}

const ARCHETYPE_NAMES = { infantry: '步兵', ranged: '远程', mobile: '机动' } as const;
const NATURAL_ARMOR_TIERS = ['无甲', '轻甲', '中甲', '重甲', '超重甲'];
/** “龙鳞:天生护甲L8+6防护”→“龙鳞:重甲L8+6防护”。写了种类（天生重甲）照用；只写天生护甲时按身体补：巨型重甲、大型中甲、人形和载具轻甲，身体不明时不补。 */
function naturalArmorSpec(armor: string, body?: string): { armor: string; written: string; tier?: string } | undefined {
  const at = armor.search(/[:：·｜|/／]/), name = at >= 0 ? armor.slice(0, at + 1) : '', spec = armor.slice(at + 1).trim();
  const match = spec.match(/^天生(无甲|轻甲|中甲|重甲|超重甲|护甲|装甲|甲)(?=\s*[lL]\s*\d|$)/);
  if (!match) return undefined;
  const tier = NATURAL_ARMOR_TIERS.includes(match[1]!) ? match[1]! : body === 'giant' ? '重甲' : body === 'large' ? '中甲' : body ? '轻甲' : undefined;
  return { armor: name + (tier ?? '') + spec.slice(match[0].length), written: match[0], tier };
}

function validatedEvent(kind: string, attrs: Record<string, string>, warnings: string[]): Suggestion {
  if (kind === 'unit_set') {
    // items 交给单位的道具不是档案字段；只交道具时不改档案。
    const items = attrs.items ? splitSpawnItems(attrs.items).map((entry) => parseSpawnItem(entry)) : [];
    const fields = Object.keys(attrs).some((key) => !['id', 'reason', 'items'].includes(key));
    return { kind:'unit-set', id:attrs.id!, data:fields || !items.length ? parseUnitSet(attrs) : {}, ...(items.length ? { items } : {}), reason:attrs.reason, raw:serializeEvent(kind,attrs) };
  }
  const integer = (key: string, min: number, max: number) => attrs[key] === undefined || (/^\d+$/.test(attrs[key]!) && Number.isSafeInteger(Number(attrs[key])) && Number(attrs[key]) >= min && Number(attrs[key]) <= max);
  if (!integer('count', 1, MAX_SPAWN_COUNT)) throw new Error(`count是单位卡数量，须为1–${MAX_SPAWN_COUNT}；人数写hpMax。${GROUPING_HINT}`);
  const lifeInputMax = kind === 'unit_update' || kind === 'spawn' && attrs.scale === 'hero' ? Number.MAX_SAFE_INTEGER : 1e9;
  if (!integer('hp', 0, lifeInputMax) || !integer('hpMax', 1, lifeInputMax) || (attrs.level !== undefined && !/^[lL]?(?:10|[1-9])(?:[+-].*)?$/.test(attrs.level)) || !integer('qty', 1, Number.MAX_SAFE_INTEGER)) throw new Error(`${kind} 数值必须是范围内的完整整数`);
  if (kind === 'unit_update') {
    if (!attrs.id?.trim() || !['hp', 'hpMax', 'morale', 'state', 'clear'].some(key => attrs[key]?.trim())) throw new Error('unit_update 需要 id 与明确的生命/人数、士气、状态或清除效果');
    if (!integer('morale', 0, 1e9)) throw new Error('unit_update 士气必须是非负整数');
    if (attrs.state !== undefined && !['ready', 'dying', 'dead', 'routing', 'fled'].includes(attrs.state)) throw new Error('unit_update 状态须为ready/dying/dead/routing/fled');
  }
  if (kind === 'reforge' && (!attrs.id?.trim() || !attrs.spec?.trim())) throw new Error('reforge 需要真实装备id与明确spec');
  if ((kind === 'reforge' || kind === 'give') && attrs.spec !== undefined) {
    // 先保留具体错误原因，避免旧标签解析器将所有规格错误折叠成“无法解析”。
    const spec = parseItemSpecification(attrs.spec, attrs, warnings);
    if (kind === 'reforge' && spec.kind === 'item' && spec.form === 'single') throw new Error('一次性道具不能改造；可以take后重新give');
  }
  if (kind === 'give') {
    if (attrs.id !== undefined && !attrs.id.trim()) throw new Error('give 的 id 需要填写接收单位的真实编号，入公共库存请省略 id');
    if (attrs.type !== undefined && !['weapon', 'armor', 'item', 'consumable', 'accessory', 'material', 'quest', 'misc'].includes(attrs.type)) throw new Error('未知物品种类');
    if (attrs.spec === undefined && ['body', 'quality', 'enchant', 'stabilized', 'protection'].some((key) => attrs[key] !== undefined)) throw new Error('有效果的物品需要明确spec，不能只靠名称或附魔提示猜测');
  }
  if (kind === 'spawn') {
    delete attrs.id; // 新单位编号一律由插件分配，正文写的 id 不参与建档或引用。
    if(attrs.level)parseEnhancementSuffix('L'+attrs.level.replace(/^[lL]/,''),'unit');
    if (attrs.scale === 'mook') attrs.scale = 'company'; // 旧正文别名，不产生第三套V2规则。
    if (!attrs.name?.trim() || !['ally', 'enemy'].includes(attrs.side ?? '') || !['hero', 'company', 'mook'].includes(attrs.scale ?? '')) throw new Error('新单位需要 name、side、scale');
    if (attrs.scale !== 'hero' && attrs.hpMax === undefined) throw new Error('群体首次建档必须明确 hpMax 编制上限；count 表示单位个数');
    if (attrs.hp !== undefined && attrs.hpMax === undefined) throw new Error('新单位提供 hp 时也需要 hpMax');
    if (attrs.hp !== undefined && Number(attrs.hp) > Number(attrs.hpMax)) throw new Error('新单位当前值不能超过上限');
    if (attrs.weapon?.match(/[,，、;；]/)) {
      const weapons = attrs.weapon.split(/[,，、;；]/).map((v) => v.trim());
      if (weapons.length !== 2 || weapons.some((v) => !v) || attrs.weapon2) throw new Error('weapon最多列两件武器；或分别使用weapon主武器与weapon2副武器');
      attrs.weapon = weapons[0]!; attrs.weapon2 = weapons[1]!;
    }
    // 旧规格解析器会钳制等级或按自由文本回退；新正文先拒绝显式非法P，避免生成另一件装备。
    for (const key of ['weapon', 'weapon2', 'armor']) {
      const spec = attrs[key]?.split(/[:：·｜|/／]/).at(-1)?.trim();
      const plain = spec ? parseEnhancementSuffix(spec, key === 'armor' ? 'armor' : 'weapon').text : undefined;
      const level = plain?.match(/[lL]\s*([+-]?\d[^\s]*)\s*$/)?.[1];
      if (level !== undefined && (!/^\d{1,2}$/.test(level) || Number(level) < 1 || Number(level) > 10)) throw new Error(`${key} 装备等级必须是L1–L10整数，整批未应用`);
    }
    for (const key of ['weapon', 'weapon2']) {
      if (!attrs[key]) continue;
      const spec = parseEnhancementSuffix(attrs[key]!.split(/[:：·｜|/／]/).at(-1)!, 'weapon').text.replace(/[lL]\s*\d+$/, '').trim();
      const mechanism = resolveWeaponClass(spec);
      if (!mechanism || !WEAPON_CLASSES[mechanism]) throw new Error(`${attrs.name}的${key}“${attrs[key]}”缺少支持的效果；请写“自定义名:剑L7”或“激光枪:能量武器L3”，副武器用weapon2`);
    }
    for (const key of ['weapon', 'weapon2', 'shield']) if (attrs[key] && /[lL]\s*\d/.test(attrs[key]!)) parseItemSpecification(attrs[key]!, {}, warnings);
    if (attrs.armor && /[lL]\s*\d/.test(attrs.armor.split(/[:：·｜|/／]/).at(-1)!)) parseItemSpecification(attrs.armor, { type: 'armor' });
    if (attrs.shield !== undefined && !['true', 'false'].includes(attrs.shield)) {
      try {
        if (parseItemSpecification(attrs.shield).kind !== 'shield') throw new Error('需要盾牌规格，如“塔盾:大盾L5+2防御”');
      } catch (error) { throw new Error('shield：' + (error instanceof Error ? error.message : String(error))); }
    }
    // 正文写的原型不再采用：按真实坐骑、快速载具与主武器推断，任何写法都不会让 spawn 作废。
    const weaponClass = attrs.weapon ? resolveWeaponClass(parseEnhancementSuffix(attrs.weapon.split(/[:：·｜|/／]/).at(-1)!, 'weapon').text.replace(/[lL]\s*\d+$/, '').trim()) : undefined;
    const inferred = inferArchetype({ mount: attrs.mount === 'true', body: attrs.body as BodyKind | undefined, speedTier: /^\d+$/.test(attrs.speed ?? '') ? Number(attrs.speed) : undefined, weaponClass });
    if (attrs.archetype !== undefined && attrs.archetype !== inferred) warnings.push(`${attrs.name || 'spawn'}：原型由插件按配装定为${ARCHETYPE_NAMES[inferred]}，正文写的「${attrs.archetype}」不再使用`);
    attrs.archetype = inferred;
  }
  const normalized = serializeEvent(kind, attrs);
  const parsed = parseSuggestionTags(normalized);
  if (parsed.invalid.length || parsed.suggestions.length !== 1) throw new Error(`${kind} 字段或规格无法解析`);
  const event = parsed.suggestions[0]!;
  if (event.kind === 'spawn') {
    if (attrs.body !== undefined && !['human', 'large', 'vehicle', 'giant'].includes(attrs.body)) throw new Error('未知身体/平台');
    if (!integer('quality', 1, 5)) throw new Error('品质必须为1–5');
    if (attrs.mount !== undefined && !['true', 'false'].includes(attrs.mount)) throw new Error('mount 必须是 true/false');
    event.mount = attrs.mount === 'true';
    if (!integer('speed', 1, 5)) throw new Error('速度档位需要1–5整数');
    event.speedTier = attrs.speed === undefined ? undefined : Number(attrs.speed);
    if (attrs.stabilized !== undefined && !['true', 'false'].includes(attrs.stabilized)) throw new Error('stabilized 必须是 true/false');
    if (attrs.protection !== undefined && !['balanced', 'kinetic', 'thermal', 'arcane'].includes(attrs.protection)) throw new Error('未知防护类型');
    if (!integer('reserves', 0, 2)) throw new Error('预备份额需要0–2整数');
    event.reserves = attrs.reserves === undefined ? undefined : Number(attrs.reserves);
    event.weaponStabilized = attrs.stabilized === 'true';
    event.armorProfile = attrs.protection as typeof event.armorProfile;
    event.body = attrs.body as typeof event.body;
    event.quality = attrs.quality === undefined ? undefined : Number(attrs.quality);
    event.shield = event.shield ?? false;
    if (attrs.hpMax !== undefined) event.hpMax = Number(attrs.hpMax);
    if (attrs.hp !== undefined) event.hp = Number(attrs.hp);
    if (attrs.skills && (event.skills?.length ?? 0) !== attrs.skills.split(/[,，、;；]/).length) throw new Error('存在未支持的技能，未执行整批');
  }
  return event;
}
