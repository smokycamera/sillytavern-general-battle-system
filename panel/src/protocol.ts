import { parseEnhancementSuffix, enhancementLabel, type Enhancements } from '../../engine/src/enhancements.js';
import { resolveTraitId } from '../../engine/src/index.js';
import { SINGLE_LIFE_LIMIT } from '../../engine/src/health-limits.js';
/** V2正文：全文提取、格式容错、逐项诊断；真实身份和数值由事务层最终核对。 */
import { parseAbilitySpec, parseSuggestionTags, type Suggestion } from './tags.js';
import { resolveWeaponClass } from '../../engine/src/data/weapons.js';
import { MAX_PROTOCOL_CHARS, MAX_PROTOCOL_EVENTS, MAX_SCENE_UNITS, MAX_SPAWN_COUNT, GROUPING_HINT } from './narrative-limits.js';
import { scanProtocolTags, normalizedAttributes, serializeEvent } from './protocol-syntax.js';
import { parseUnitSet, UNIT_SET_ATTRIBUTES } from './unit-set.js';

export interface ProtocolBatch { events: Suggestion[]; canonical: string; errors: string[]; warnings: string[] }
const ATTRIBUTES: Record<string, readonly string[]> = {
  unit_set: UNIT_SET_ATTRIBUTES,
  deploy: ['id'],
  learn: ['id', 'skills'],
  unit_update: ['id', 'hp', 'hpMax', 'reason'],
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

export function parseProtocol(text: string): ProtocolBatch {
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
      if ((tag.name === 'spawn' || tag.name === 'bless') && attrs.traits) {
        const names = attrs.traits.split(/[,，、;；|]/).map((name) => name.trim()).filter(Boolean);
        const unknown = names.filter((name) => !resolveTraitId(name));
        if (unknown.length) warnings.push(`${attrs.name || tag.name}：已忽略未支持特质 ${unknown.join('、')}`);
        const supported = [...new Set(names.map((name) => resolveTraitId(name)).filter((id): id is string => !!id))];
        if (supported.length) attrs.traits = supported.join(',');
        else if (tag.name === 'spawn') delete attrs.traits;
        else if (unknown.length) continue; // 空祝福不创建无效果来源，也不阻断其他事件。
      }
      if ((tag.name === 'spawn' || tag.name === 'learn') && attrs.skills) {
        const names = attrs.skills.split(/[,，、;；]/).map((name) => name.trim()).filter(Boolean);
        const supported = names.filter((name) => parseAbilitySpec(name).length === 1);
        const unknown = names.filter((name) => !supported.includes(name));
        if (unknown.length) warnings.push(`${attrs.name || tag.name}：已忽略未支持技能 ${unknown.join('、')}`);
        if (supported.length) attrs.skills = supported.join(',');
        else if (tag.name === 'spawn') delete attrs.skills;
        else if (unknown.length) continue;
      }
      const event = validatedEvent(tag.name, attrs, warnings);
      const earlier = seen.get(event.raw);
      if (earlier !== undefined && (earlier !== tag.block || ['deploy', 'unit-update'].includes(event.kind))) {
        warnings.push('已合并重复展示的 ' + tag.name + ' 事件'); continue;
      }
      seen.set(event.raw, tag.block);
      if (event.kind === 'unit-update') {
        const existing = events.find((e): e is Extract<Suggestion, { kind: 'unit-update' }> => e.kind === 'unit-update' && e.id === event.id);
        if (existing) {
          if (['hp', 'hpMax'].some((key) => {
            const field = key as 'hp' | 'hpMax';
            return existing[field] !== undefined && event[field] !== undefined && existing[field] !== event[field];
          })) throw new Error('档案 ' + event.id + ' 的人数/生命更新冲突，请明确采用哪个绝对值');
          if (event.hp !== undefined) existing.hp = event.hp;
          if (event.hpMax !== undefined) existing.hpMax = event.hpMax;
          const merged: Record<string, string> = { id: existing.id! };
          for (const key of ['hp', 'hpMax', 'reason'] as const) if (existing[key] !== undefined) merged[key] = String(existing[key]);
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
  return { events, canonical: events.map((e) => e.raw).join('\n'), errors: [...new Set(errors)], warnings: [...new Set(warnings)].slice(0, 12) };
}

function validatedEvent(kind: string, attrs: Record<string, string>, warnings: string[]): Suggestion {
  if (kind === 'unit_set') return { kind:'unit-set', id:attrs.id!, data:parseUnitSet(attrs), reason:attrs.reason, raw:serializeEvent(kind,attrs) };
  const integer = (key: string, min: number, max: number) => attrs[key] === undefined || (/^\d+$/.test(attrs[key]!) && Number.isSafeInteger(Number(attrs[key])) && Number(attrs[key]) >= min && Number(attrs[key]) <= max);
  if (!integer('count', 1, MAX_SPAWN_COUNT)) throw new Error(`count是单位卡数量，须为1–${MAX_SPAWN_COUNT}；人数写hpMax。${GROUPING_HINT}`);
  const lifeInputMax = kind === 'unit_update' || kind === 'spawn' && attrs.scale === 'hero' ? Number.MAX_SAFE_INTEGER : 1e9;
  if (!integer('hp', 0, lifeInputMax) || !integer('hpMax', 1, lifeInputMax) || (attrs.level !== undefined && !/^[lL]?(?:10|[1-9])(?:[+-].*)?$/.test(attrs.level)) || !integer('qty', 1, 9999)) throw new Error(`${kind} 数值必须是范围内的完整整数`);
  if (kind === 'unit_update' && (!attrs.id?.trim() || (attrs.hp === undefined && attrs.hpMax === undefined))) throw new Error('unit_update 需要 id 与 hp/hpMax');
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
    if (attrs.scale === 'hero') for (const key of ['hpMax', 'hp']) if (attrs[key] !== undefined && Number(attrs[key]) > SINGLE_LIFE_LIMIT) {
      warnings.push(`${attrs.name}的${key}已从${attrs[key]}限制为单体硬上限${SINGLE_LIFE_LIMIT}`);
      attrs[key] = String(SINGLE_LIFE_LIMIT);
    }
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
