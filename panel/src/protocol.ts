import { parseEnhancementSuffix, enhancementLabel, type Enhancements, type BonusKind } from '../../engine/src/enhancements.js';
import { resolveTraitId } from '../../engine/src/index.js';
/** V2正文：全文提取、格式容错、逐项诊断；真实身份和数值由事务层最终核对。 */
import { parseAbilitySpec, parseSuggestionTags, type Suggestion } from './tags.js';
import { resolveWeaponClass } from '../../engine/src/data/weapons.js';
import { MAX_PROTOCOL_CHARS, MAX_PROTOCOL_EVENTS, MAX_SCENE_UNITS, MAX_SPAWN_COUNT, GROUPING_HINT } from './narrative-limits.js';
import { scanProtocolTags, normalizedAttributes, serializeEvent, type ProtocolTag, type ProtocolAttribute } from './protocol-syntax.js';
import { parseUnitSet, UNIT_SET_ATTRIBUTES } from './unit-set.js';
import { normalizeNarrativeSkill, normalizeNarrativeSpec } from './spec-tolerance.js';
import { parseItemSpecification } from './item-spec.js';

export interface ProtocolDiagnostic { message: string; start: number; end: number; field?: string; event: string }
export interface ProtocolBatch { events: Suggestion[]; canonical: string; errors: string[]; warnings: string[]; diagnostics: ProtocolDiagnostic[] }
const ATTRIBUTES: Record<string, readonly string[]> = {
  unit_set: UNIT_SET_ATTRIBUTES,
  deploy: ['id'],
  learn: ['id', 'skills'],
  unit_update: ['id', 'hp', 'hpMax', 'morale', 'state', 'clear', 'reason'],
  spawn: ['name', 'side', 'scale', 'archetype', 'level', 'count', 'hp', 'hpMax', 'body', 'mount', 'speed', 'stabilized', 'protection', 'reserves', 'quality', 'shield', 'weapon', 'weapon2', 'armor', 'skills', 'traits'],
  field: ['env', 'light', 'note'],
  take: ['id', 'qty', 'note'],
  give: ['item', 'note', 'qty', 'type', 'spec', 'body', 'quality', 'enchant', 'stabilized', 'protection'],
  reforge: ['id', 'name', 'spec', 'body', 'quality', 'enchant', 'stabilized', 'protection'],
  bless: ['id', 'name', 'traits', 'rounds', 'battles', 'permanent'],
  unbless: ['id', 'source'],
  affect: ['id', 'name', 'effects', 'rounds', 'battles', 'permanent'],
  unaffect: ['id', 'source'],
};

const known = new Set(Object.keys(ATTRIBUTES));
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
  const scanned = scanProtocolTags(text, known), warnings = scanned.warnings, errors: string[] = [];
  const events: Suggestion[] = [], seen = new Map<string, number>();
  const scanLimit = MAX_PROTOCOL_EVENTS * 8;
  if (scanned.tags.length > scanLimit) errors.push('待确认内容标签过多，请先减少重复内容；尚未入账');
  if (scanned.tags.reduce((n, tag) => n + tag.raw.length, 0) > MAX_PROTOCOL_CHARS) errors.push('事件内容超过' + MAX_PROTOCOL_CHARS + '字符，先精简事件草稿；正文长度不受此限制');
  for (const tag of scanned.tags.slice(0, scanLimit)) {
    try {
      if (!known.has(tag.name)) throw new Error('暂不支持事件 ' + tag.name + '，请补成已支持的效果；引擎战果无需正文重复发放');
      if (!tag.complete) throw new Error(tag.name + ' 事件被截断，属性值尚不完整');
      const attrs = normalizedAttributes(tag, ATTRIBUTES[tag.name]!, warnings);
      const hadOptionalList = !!(attrs.skills || attrs.traits);
      if (['spawn', 'bless', 'unit_set'].includes(tag.name) && attrs.traits) {
        const names = attrs.traits.split(/[,，、;；|]/).map((name) => name.trim()).filter(Boolean);
        const unknown = names.filter((name) => !resolveTraitId(name));
        if (unknown.length) warnings.push(`${attrs.name || tag.name}：${tag.name === 'unit_set' ? '保留原特质，未采用含未知项的特质列表' : '已忽略未支持特质'} ${unknown.join('、')}`);
        const supported = [...new Set(names.map((name) => resolveTraitId(name)).filter((id): id is string => !!id))];
        if (tag.name === 'unit_set' && unknown.length) delete attrs.traits;
        else if (supported.length) attrs.traits = supported.join(',');
        else if (tag.name === 'spawn') delete attrs.traits;
        else if (unknown.length) continue; // 空祝福不创建无效果来源，也不阻断其他事件。
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
      if (tag.name === 'unit_set' && hadOptionalList && !Object.keys(attrs).some(key => !['id', 'reason'].includes(key))) continue;
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
    } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
  }
  const spawned = events.reduce((n, event) => n + (event.kind === 'spawn' ? event.count : 0), 0);
  if (events.length > MAX_PROTOCOL_EVENTS) errors.push('合并重复内容后共有' + events.length + '项事件，最多' + MAX_PROTOCOL_EVENTS + '项；请调整草稿，尚未入账');
  if (spawned > MAX_SCENE_UNITS) errors.push('本批新建单位超过' + MAX_SCENE_UNITS + '，请调整草稿；' + GROUPING_HINT);
  // 格式变换提示较多时，优先展示跳过内容/保留旧值的实质诊断。
  const uniqueWarnings = [...new Set(warnings)];
  const orderedWarnings = [...uniqueWarnings.filter(w => !w.startsWith('已规范化 ')), ...uniqueWarnings.filter(w => w.startsWith('已规范化 '))];
  const batch: ProtocolBatch = { events, canonical: events.map((e) => e.raw).join('\n'), errors: [...new Set(errors)], warnings: orderedWarnings.slice(0, 12), diagnostics: [] };
  if (options.diagnostics !== false && (errors.length || warnings.some(w => /未采用|未支持|未使用|保留原|忽略/.test(w)))) {
    batch.diagnostics = recoverProtocol(text).diagnostics;
    if (!batch.diagnostics.length && errors.length) batch.diagnostics = scanned.tags.map(tag => ({ message: errors[0]!, start: tag.start ?? 0, end: tag.end ?? text.length, event: tag.name }));
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

/** Explicit draft recovery only: remove bad fields/suffixes, retain the unit and all usable data. */
export function recoverProtocol(text: string): { text: string; diagnostics: ProtocolDiagnostic[] } {
  const tags = scanProtocolTags(text, known).tags, lines: string[] = [], diagnostics: ProtocolDiagnostic[] = [];
  for (const tag of tags) {
    const add = (message: string, token?: ProtocolAttribute, needle?: string) => {
      const relative = needle ? token?.raw.indexOf(needle) ?? -1 : -1;
      const start = relative >= 0 ? token!.start + relative : token?.start ?? tag.start ?? 0;
      diagnostics.push({ message, start, end: relative >= 0 ? start + needle!.length : token?.end ?? tag.end ?? text.length, field: token?.key, event: tag.name });
    };
    if (!known.has(tag.name)) { add('未支持事件 ' + tag.name); continue; }
    const full = parseProtocol(tag.raw, { diagnostics: false });
    if (!full.errors.length && !full.warnings.some(w => /未采用|未支持|未使用|保留原|忽略/.test(w))) { lines.push(tag.raw); continue; }
    const positions: ProtocolAttribute[] = [];
    let attrs: Record<string, string> = {};
    try { normalizedAttributes(tag, ATTRIBUTES[tag.name]!, [], positions, true); }
    catch (error) { add(error instanceof Error ? error.message : String(error)); }
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
        for (const part of value.split(/[,，、;；]/).filter(Boolean)) {
          try {
            let normalized = part;
            if (key === 'skills') {
              const notes: string[] = [];
              try { normalized = normalizeNarrativeSkill(part, notes); }
              catch { normalized = repairSpecification(part, 'skill', true, message => add(message, token, part)); }
              if (parseAbilitySpec(normalized).length !== 1) throw Error('未支持技能 ' + part);
              for (const note of notes) if (/忽略|未支持/.test(note)) add(note, token, part);
            } else if (key === 'traits' && !resolveTraitId(part)) throw Error('未支持特质 ' + part);
            const result = parseProtocol(serializeEvent(tag.name, { ...probe, [key]: normalized }), { diagnostics: false });
            if (result.errors.length || !result.events.length) throw Error(result.errors[0] ?? '未支持' + key + ' ' + part);
            parts.push(normalized);
          } catch (error) { add(error instanceof Error ? error.message : String(error), token, part); }
        }
        value = parts.join(',');
        if (!value) continue;
      }
      const fieldProbe = { ...probe };
      if (tag.name === 'unit_set' && ['id', 'reason'].includes(key)) fieldProbe.name = '规格校验';
      if (['rounds', 'battles', 'permanent'].includes(key)) { delete fieldProbe.rounds; delete fieldProbe.battles; delete fieldProbe.permanent; }
      const test = (input: string) => parseProtocol(serializeEvent(tag.name, { ...fieldProbe, [key]: input }), { diagnostics: false });
      let result = test(value);
      if (result.errors.length && ['weapon', 'weapon2', 'armor', 'shieldSpec', 'spec', 'level'].includes(key)) {
        try {
          const kind: BonusKind = key === 'level' ? 'unit' : key === 'armor' ? 'armor' : key === 'shieldSpec' ? 'shield' : 'weapon';
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
    if (!diagnostics.some(d => d.start >= (tag.start ?? 0) && d.end <= (tag.end ?? text.length))) add(full.errors[0] ?? full.warnings[0] ?? '事件需要补全');
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

function validatedEvent(kind: string, attrs: Record<string, string>, warnings: string[]): Suggestion {
  if (kind === 'unit_set') return { kind:'unit-set', id:attrs.id!, data:parseUnitSet(attrs), reason:attrs.reason, raw:serializeEvent(kind,attrs) };
  const integer = (key: string, min: number, max: number) => attrs[key] === undefined || (/^\d+$/.test(attrs[key]!) && Number.isSafeInteger(Number(attrs[key])) && Number(attrs[key]) >= min && Number(attrs[key]) <= max);
  if (!integer('count', 1, MAX_SPAWN_COUNT)) throw new Error(`count是单位卡数量，须为1–${MAX_SPAWN_COUNT}；人数写hpMax。${GROUPING_HINT}`);
  const lifeInputMax = kind === 'unit_update' || kind === 'spawn' && attrs.scale === 'hero' ? Number.MAX_SAFE_INTEGER : 1e9;
  if (!integer('hp', 0, lifeInputMax) || !integer('hpMax', 1, lifeInputMax) || (attrs.level !== undefined && !/^[lL]?(?:10|[1-9])(?:[+-].*)?$/.test(attrs.level)) || !integer('qty', 1, 9999)) throw new Error(`${kind} 数值必须是范围内的完整整数`);
  if (kind === 'unit_update') {
    if (!attrs.id?.trim() || !['hp', 'hpMax', 'morale', 'state', 'clear'].some(key => attrs[key]?.trim())) throw new Error('unit_update 需要 id 与明确的生命/人数、士气、状态或清除效果');
    if (!integer('morale', 0, 1e9)) throw new Error('unit_update 士气必须是非负整数');
    if (attrs.state !== undefined && !['ready', 'dying', 'dead', 'routing', 'fled'].includes(attrs.state)) throw new Error('unit_update 状态须为ready/dying/dead/routing/fled');
  }
  if (kind === 'reforge' && (!attrs.id?.trim() || !attrs.spec?.trim())) throw new Error('reforge 需要真实装备id与明确spec');
  if ((kind === 'reforge' || kind === 'give') && attrs.spec !== undefined) {
    // 先保留具体错误原因，避免旧标签解析器将所有规格错误折叠成“无法解析”。
    const spec = parseItemSpecification(attrs.spec, attrs);
    if (kind === 'reforge' && spec.kind === 'consumable') throw new Error('消耗品不能重铸');
  }
  if (kind === 'give') {
    if (attrs.type !== undefined && !['weapon', 'armor', 'consumable', 'accessory', 'material', 'quest', 'misc'].includes(attrs.type)) throw new Error('未知物品种类');
    if (attrs.spec === undefined && ['body', 'quality', 'enchant', 'stabilized', 'protection'].some((key) => attrs[key] !== undefined)) throw new Error('有效果的物品需要明确spec，不能只靠名称或附魔提示猜测');
  }
  if (kind === 'spawn') {
    if(attrs.level)parseEnhancementSuffix('L'+attrs.level.replace(/^[lL]/,''),'unit');
    if (attrs.scale === 'mook') attrs.scale = 'company'; // 旧正文别名，不产生第三套V2规则。
    if (!attrs.name?.trim() || !['ally', 'enemy'].includes(attrs.side ?? '') || !['hero', 'company', 'mook'].includes(attrs.scale ?? '')) throw new Error('新单位需要 name、side、scale');
    if (attrs.scale !== 'hero' && attrs.hpMax === undefined) throw new Error('群体首次建档必须明确 hpMax 编制上限；count 表示单位个数');
    if (attrs.hp !== undefined && attrs.hpMax === undefined) throw new Error('新单位提供 hp 时也需要 hpMax');
    if (attrs.hp !== undefined && Number(attrs.hp) > Number(attrs.hpMax)) throw new Error('新单位当前值不能超过上限');
    if (attrs.archetype === undefined) attrs.archetype = 'infantry';
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
      if (!mechanism) throw new Error(`${attrs.name}的${key}“${attrs[key]}”缺少支持的效果；请写“自定义名:剑L7”或“激光枪:能量武器L3”，副武器用weapon2`);
    }
    if (attrs.armor && /[lL]\s*\d/.test(attrs.armor.split(/[:：·｜|/／]/).at(-1)!)) parseItemSpecification(attrs.armor, { type: 'armor' });
  }
  const normalized = serializeEvent(kind, attrs);
  const parsed = parseSuggestionTags(normalized);
  if (parsed.invalid.length || parsed.suggestions.length !== 1) throw new Error(`${kind} 字段或规格无法解析`);
  const event = parsed.suggestions[0]!;
  if (event.kind === 'spawn') {
    if (attrs.body !== undefined && !['human', 'large', 'vehicle', 'giant'].includes(attrs.body)) throw new Error('未知身体/平台');
    if (!integer('quality', 1, 5)) throw new Error('品质必须为1–5');
    if (attrs.shield !== undefined && !['true', 'false'].includes(attrs.shield)) throw new Error('shield 必须是 true/false');
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
    event.shield = attrs.shield === 'true';
    if (attrs.hpMax !== undefined) event.hpMax = Number(attrs.hpMax);
    if (attrs.hp !== undefined) event.hp = Number(attrs.hp);
    if (attrs.skills && (event.skills?.length ?? 0) !== attrs.skills.split(/[,，、;；]/).length) throw new Error('存在未支持的技能，未执行整批');
  }
  return event;
}
