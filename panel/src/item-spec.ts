import { baseMechanism, SHIELD_CLASSES, classMismatchHint, type ShieldClass } from '../../engine/src/data/weapons.js';
import { parseEnhancementSuffix, enhancementLabel, resolveBonusStat, BONUS_NAMES, type Enhancements } from '../../engine/src/enhancements.js';
import { WEAPON_CLASSES, resolveWeaponClass, parseSkillMechanism, skillMechanismId, skillMechanismFromId, narrativeTrait, isGradedTrait, ITEM_FORM_NAMES, itemSpecText, compileItem,
  canonicalTraitId, TRAIT_LEVEL_ALIASES, type BodyKind, type ItemForm, type ItemSpecification } from '../../engine/src/index.js';
import { normalizeNarrativeSkill, normalizeNarrativeSpec } from './spec-tolerance.js';

const ARMOR_TIERS = ['无甲', '轻甲', '中甲', '重甲', '超重甲'];
export function itemSpecificationLabel(spec: ItemSpecification): string {
  if (spec.kind === 'item') return ITEM_FORM_NAMES[spec.form] + '·' + itemSpecText({ version: 'items-v1', form: spec.form, power: spec.power, seed: '', active: spec.active, traits: spec.traits, bonuses: spec.bonuses });
  const name = spec.kind === 'weapon' ? WEAPON_CLASSES[spec.mechanism]?.name ?? spec.mechanism : spec.kind === 'armor' ? ARMOR_TIERS[spec.tier] : SHIELD_CLASSES[spec.mechanism ?? 'shield'].name;
  return `${name}L${spec.power}${enhancementLabel(spec.bonuses)}${spec.kind === 'weapon' && spec.enchantment && spec.enchantment !== 'none' ? ' · ' + (spec.enchantment === 'arcane' ? '奥术转化' : '热能转化') : ''}`;
}

/** 名称只是显示前缀；只读取分隔符后明确写出的机制，不按名称猜装备。 */
export function splitItemSpecification(text: string): { name?: string; spec: string } {
  const value = text.trim(), colon = value.search(/[:：]/);
  const separator = colon >= 0 ? colon : value.search(/[·｜|/／]/);
  if (separator < 0) return { spec: value };
  const name = value.slice(0, separator).trim(), spec = value.slice(separator + 1).trim();
  if (!name || !spec || /[:：·｜|/／]/.test(spec)) throw new Error('装备规格使用“名称:效果L强度”或“效果L强度”，每项只写一个明确规格');
  return { name, spec };
}

/** 形态词：写在效果前（充能魔法范围热能L5）或作名称段（充能:魔法范围热能L5）都可以。 */
const FORM_WORDS: Readonly<Record<string, ItemForm>> = { 充能: 'charged', 一次性: 'single', 消耗品: 'single', 佩戴: 'worn', 饰品: 'worn' };
/** 旧版药剂与护符的名称：正文继续这样写时换成同样效果的新写法。 */
const LEGACY_NAMES: Readonly<Record<string, string>> = {
  治疗药剂: '增益治疗', heal: '增益治疗', 回能药剂: '增益回能', restore: '增益回能', 净化药剂: '增益净化', cleanse: '增益净化', 强攻药剂: '增益伤害', empower: '增益伤害',
  屏障药剂: '增益屏障', barrier: '增益屏障', 投掷炸弹: '物理范围投射', grenade: '物理范围投射', 维修包: '增益治疗', repair: '增益治疗',
  治疗护符: '充能增益治疗', 屏障护符: '充能增益屏障', 净化护符: '充能增益净化', 守护护符: '守护', 夜视镜: '夜战专精', 林行靴: '林地专精', 耐力护符: '耐力训练',
};
/** 把道具名写进 spec 时给出的修复建议；不会自动采用。 */
const NAME_HINTS: readonly [RegExp, string][] = [
  [/手雷|手榴弹|炸弹|榴弹|炸药/, '物理范围投射'], [/燃烧瓶|火油|燃烧弹/, '物理范围投射+燃烧'], [/烟雾|烟幕/, '烟幕'], [/闪光|震撼/, 'debuff范围眩晕'],
  [/地雷|蒺藜|绊索|陷阱/, '陷阱'], [/毒气|催泪/, '毒雾'], [/卷轴|符箓|法符/, '魔法范围热能'], [/箭|弹药|子弹|弹匣/, '物理单体射击'],
  [/药|绷带|急救|医疗包|疗伤|丹|针剂|修复/, 'buff治疗'], [/解毒|净化/, 'buff净化'], [/兴奋|肾上腺/, 'buff加速'], [/护盾|力场|屏障/, 'buff屏障'],
  [/夜视|热成像/, '夜战专精'], [/靴/, '林地专精'], [/斗篷/, '潜伏'], [/戒指|护符|项链/, '佩戴'], [/望远镜/, '侦察'], [/攀城钩|钩索|云梯/, '登城'], [/战旗|军旗/, '统率'],
];
function nameHint(base: string): string {
  const hint = NAME_HINTS.find(([pattern]) => pattern.test(base))?.[1];
  return hint ? `；可改为“${hint}L等级”` : '';
}
function equipmentSpecification(base: string, power: number, suffix: string, attrs: SpecAttributes): ItemSpecification | undefined {
  const weaponId = resolveWeaponClass(base), weapon = weaponId ? WEAPON_CLASSES[weaponId] : undefined;
  const tier = ARMOR_TIERS.indexOf(base), shield = weaponId !== undefined && Object.hasOwn(SHIELD_CLASSES, weaponId);
  if (!weapon && tier < 0 && !shield) return undefined;
  const kind = weapon ? 'weapon' : tier >= 0 ? 'armor' : 'shield';
  const bonuses = parseEnhancementSuffix('L' + power + suffix, kind).bonuses;
  const quality = attrs.quality === undefined ? undefined : Number(attrs.quality);
  if (quality !== undefined && (!/^\d+$/.test(attrs.quality!) || !Number.isInteger(quality) || quality < 1 || quality > 5)) throw new Error('品质必须为1–5');
  if (attrs.body !== undefined && !['human', 'large', 'vehicle', 'giant'].includes(attrs.body)) throw new Error('未知物品体量');
  const common = { bonuses, power, ...(quality === undefined ? {} : { quality }), ...(attrs.body === undefined ? {} : { body: attrs.body as BodyKind }) };
  if (attrs.stabilized !== undefined && !['true', 'false'].includes(attrs.stabilized)) throw new Error('stabilized 必须是 true/false');
  if (attrs.protection !== undefined && !['balanced', 'kinetic', 'thermal', 'arcane'].includes(attrs.protection)) throw new Error('未知防护类型');
  if (weapon) {
    if (attrs.protection !== undefined) throw new Error('防护类型只适用于护甲');
    if (attrs.enchant !== undefined && !['none', 'thermal', 'arcane'].includes(attrs.enchant)) throw new Error('未知附魔效果');
    return { kind: 'weapon', mechanism: weapon.id, ...common, ...(attrs.stabilized === undefined ? {} : { stabilized: attrs.stabilized === 'true' }), ...(attrs.enchant === undefined ? {} : { enchantment: attrs.enchant as 'none' | 'thermal' | 'arcane' }) };
  }
  if (attrs.stabilized !== undefined) throw new Error('稳定装置只适用于车载武器');
  if (attrs.enchant !== undefined) throw new Error('此附魔字段只适用于武器');
  if (tier >= 0) return { kind: 'armor', tier: tier as 0 | 1 | 2 | 3 | 4, ...common, ...(attrs.protection === undefined ? {} : { profile: attrs.protection as 'balanced' | 'kinetic' | 'thermal' | 'arcane' }) };
  if (attrs.protection !== undefined) throw new Error('防护类型只适用于护甲');
  return { kind: 'shield', mechanism: weaponId as ShieldClass, ...common };
}
/** 特质（一项或用、分隔的多项）或“佩戴”：佩戴道具；专精的等级就是道具等级。 */
function passiveSpecification(base: string, power: number, suffix: string): Extract<ItemSpecification, { kind: 'item' }> | undefined {
  const names = base.split(/[、,，+＋/／]/).map((name) => name.trim()).filter(Boolean);
  if (!names.length) return undefined;
  const plain = names.length === 1 && FORM_WORDS[names[0]!] === 'worn';
  const ids: string[] = [];
  if (!plain) for (const name of names) {
    const parsed = narrativeTrait(name);
    if (parsed.kind !== 'trait') return undefined;
    ids.push(parsed.id);
  }
  const bonuses = parseEnhancementSuffix('L' + power + suffix, 'gear').bonuses;
  const grants = new Map<string, { id: string; level?: number }>();
  for (const raw of ids) {
    const id = canonicalTraitId(raw), level = TRAIT_LEVEL_ALIASES[raw]?.level ?? power;
    if (!grants.has(id) || level > (grants.get(id)!.level ?? 5)) grants.set(id, { id, ...(isGradedTrait(id) ? { level } : {}) });
  }
  return { kind: 'item', form: 'worn', power, traits: [...grants.values()], ...(bonuses ? { bonuses } : {}) };
}

/** Each explicitly graded trait keeps its grade; the highest grade anchors numeric bonuses. */
function mixedPassiveSpecification(text: string): Extract<ItemSpecification, { kind: 'item' }> | undefined {
  const at = text.search(/[+-]\d/), body = at < 0 ? text : text.slice(0, at), suffix = at < 0 ? '' : text.slice(at);
  const tokens = body.split(/[、,，+＋]/).map(token => token.trim()).filter(Boolean);
  if (tokens.length < 2) return undefined;
  const grants = new Map<string, { id: string; level?: number }>();
  let power = 0;
  for (const token of tokens) {
    const match = token.match(/^(.+?)\s*[lL]\s*(\d{1,2})$/);
    if (!match) return undefined;
    const level = Number(match[2]);
    if (level < 1 || level > 10) throw new Error('佩戴特质等级必须为L1–L10');
    const part = passiveSpecification(match[1]!.trim(), level, '');
    if (!part?.traits?.length) return undefined;
    power = Math.max(power, level);
    for (const grant of part.traits) {
      power = Math.max(power, grant.level ?? level);
      if (!grants.has(grant.id) || (grant.level ?? 5) > (grants.get(grant.id)!.level ?? 5)) grants.set(grant.id, grant);
    }
  }
  const bonuses = parseEnhancementSuffix('L' + power + suffix, 'gear').bonuses;
  return { kind: 'item', form: 'worn', power, traits: [...grants.values()], ...(bonuses ? { bonuses } : {}) };
}
/** 佩戴道具把修正方向写在等级前（佩戴热能防护L5+4）时，方向挪到点数后面（佩戴L5+4热能防护）。 */
function wornBonusFirst(base: string, power: number, suffix: string): { spec: Extract<ItemSpecification, { kind: 'item' }>; text: string } | undefined {
  const stat = resolveBonusStat(base), points = suffix.match(/^([+-])\s*(\d{1,2})$/);
  if (!stat || !points) return undefined;
  const moved = points[1]! + points[2]! + BONUS_NAMES[stat], spec = passiveSpecification('佩戴', power, moved);
  return spec && { spec, text: '佩戴L' + power + moved };
}
/**
 * 道具位置上写了武器词条（items 清单、带形态词的 spec、要交给单位的 add），换成用这件武器打一次的道具：
 * 爆炸物与火炮是物理范围投射，其余远程武器是物理单体投射（道具自带动能，持有者不需要远程武器），
 * 法杖与魔杖是魔法单体、默认充能。近战、天生与召唤武器没有对应道具。
 */
const WEAPON_ITEM_EFFECTS: Readonly<Record<string, { mechanism: string; form?: 'charged' }>> = {
  demolition: { mechanism: '物理范围投射' }, cannon: { mechanism: '物理范围投射' }, 'indirect-cannon': { mechanism: '物理范围投射' },
  throwing: { mechanism: '物理单体投射' }, 'light-ranged': { mechanism: '物理单体投射' }, bow: { mechanism: '物理单体投射' }, firearm: { mechanism: '物理单体投射' },
  rifle: { mechanism: '物理单体投射' }, 'heavy-rifle': { mechanism: '物理单体投射' }, autocannon: { mechanism: '物理单体投射' }, energy: { mechanism: '物理单体投射' },
  magic: { mechanism: '魔法单体', form: 'charged' },
};
function weaponItem(weapon: string, power: number, suffix: string, form: 'single' | 'charged' | undefined, notes: string[] | undefined, written: string): Extract<ItemSpecification, { kind: 'item' }> {
  const target = weapon === 'sprayer' ? { mechanism: '物理范围投射+扇形+燃烧' } : WEAPON_ITEM_EFFECTS[baseMechanism({recipe:{mechanism:weapon}})!];
  if (!target) throw new Error(`「${WEAPON_CLASSES[weapon]?.name ?? weapon}」没有对应的道具写法；武器写在weapon、weapon2`);
  // 修正与效果词（+2穿透、+中毒）照技能写法理解；道具没有的修正略去并说明。
  const tolerance: string[] = [];
  const resolvedForm = form ?? target.form ?? 'single', bonusKind = resolvedForm === 'charged' ? 'charged' : 'skill';
  if (resolvedForm !== 'charged' && /[+-]\d{0,2}次数/.test(suffix)) throw new Error('次数修正仅用于充能道具');
  const normalized = normalizeNarrativeSkill(target.mechanism + 'L' + power + suffix, tolerance, bonusKind);
  const match = normalized.match(/^(.*?)[lL](\d{1,2})((?:[+-].*)?)$/), mechanism = match ? parseSkillMechanism(match[1]!) : undefined;
  if (!mechanism) throw new Error(`「${written}」换成道具后无法识别`);
  const bonuses = parseEnhancementSuffix('L' + match![2] + match![3], bonusKind).bonuses;
  const spec: Extract<ItemSpecification, { kind: 'item' }> = { kind: 'item', form: resolvedForm, power, active: skillMechanismId(mechanism),
    ...(bonuses && Object.keys(bonuses).length ? { bonuses } : {}) };
  notes?.push(`「${written}」是武器写法，按道具「${itemSpecificationText(spec)}」`, ...tolerance);
  return spec;
}
/** 改造道具时写的武器规格：同样换成对应道具。 */
export function weaponItemSpecification(weapon: Extract<ItemSpecification, { kind: 'weapon' }>, form: 'single' | 'charged' | undefined, notes?: string[]): Extract<ItemSpecification, { kind: 'item' }> {
  const suffix = enhancementLabel(weapon.bonuses);
  return weaponItem(weapon.mechanism, weapon.power, suffix, form, notes, (WEAPON_CLASSES[weapon.mechanism]?.name ?? weapon.mechanism) + 'L' + weapon.power + suffix);
}
/** 道具能不能建档（效果类型、参数与组合）：正文解析时先编译一次，建不了的一项按略过处理，不拖到入账时整批失败。 */
export function assertItemCompiles(spec: ItemSpecification, name = '道具'): void {
  compileItem(spec, { id: 'item-check', name, seed: 'item-check', damageModel: 'wounds-v2' });
}
/** 技能机制：先按严格写法解析，正文写法再经容错（单词简写、旧技能名）解析一次；容错的说明写进 notes。 */
function activeSpecification(base: string, power: number, suffix: string, form: 'single' | 'charged', notes: string[] = []): Extract<ItemSpecification, { kind: 'item' }> | undefined {
  if (form !== 'charged' && /[+-]\d{0,2}次数/.test(suffix)) throw new Error('次数修正仅用于充能道具');
  const strict = parseSkillMechanism(base);
  let id = strict ? skillMechanismId(strict) : undefined, bonuses: Enhancements | undefined, strictError: unknown;
  // 等级后写了效果词（buff治疗L3+振奋）时严格写法读不出修正，同样走正文容错；容错也读不出就报原来的错。
  if (id) try { bonuses = parseEnhancementSuffix('L' + power + suffix, form === 'charged' ? 'charged' : 'skill').bonuses; } catch (error) { strictError = error; id = undefined; }
  if (!id) {
    try {
      const tolerance: string[] = [];
      const bonusKind = form === 'charged' ? 'charged' : 'skill';
      const normalized = normalizeNarrativeSkill(base + 'L' + power + suffix, tolerance, bonusKind);
      const match = normalized.match(/^(.*?)[lL](\d{1,2})((?:[+-].*)?)$/);
      const mechanism = match ? parseSkillMechanism(match[1]!) : undefined;
      if (!mechanism) { if (strictError) throw strictError; return undefined; }
      id = skillMechanismId(mechanism); bonuses = parseEnhancementSuffix('L' + match![2] + match![3], bonusKind).bonuses;
      notes.push(...tolerance);
    } catch { if (strictError) throw strictError; return undefined; }
  }
  if (!skillMechanismFromId(id)) return undefined;
  return { kind: 'item', form, power, active: id, ...(bonuses && Object.keys(bonuses).length ? { bonuses } : {}) };
}
type SpecAttributes = { type?: string; quality?: string; body?: string; enchant?: string; stabilized?: string; protection?: string };

/**
 * 正文与面板共用：装备写“机制L规格+修正”；道具写技能机制（可加“充能”）、特质或“佩戴L等级+修正”。属性、骰子、身份与版本由插件计算。
 * item：这里只能是道具（items 清单、要交给单位的 add），武器词条换成对应道具，护甲与盾不收。
 */
export function parseItemSpecification(text: string, attrs: SpecAttributes = {}, notes?: string[], options: { item?: boolean } = {}): ItemSpecification {
  const split = splitItemSpecification(text);
  let form: ItemForm | undefined = split.name ? FORM_WORDS[split.name] : undefined;
  let spec = split.spec.trim();
  // 形态词可写在效果前。“佩戴L4+4防御”的佩戴就是效果本身，“佩戴破甲L5”的佩戴才是形态词。
  const prefix = spec.match(/^(充能|一次性|消耗品|佩戴|饰品)\s*[+·:：]?\s*/);
  if (prefix && spec.length > prefix[0].length && !(FORM_WORDS[prefix[1]!] === 'worn' && /^[lL]\s*\d/.test(spec.slice(prefix[0].length)))) { form = FORM_WORDS[prefix[1]!]; spec = spec.slice(prefix[0].length); }
  const level = spec.match(/^(.*?)\s*[lL]\s*(\d{1,2})((?:[+-].*)?)$/);
  if (!level) throw new Error('道具与装备都写“效果L等级”，如buff治疗L3、物理范围投射L4、夜战专精L5、步枪L5');
  let base = level[1]!.trim(), suffix = level[3] ?? '';
  const power = Number(level[2]);
  if (!Number.isInteger(power) || power < 1 || power > 10) throw new Error('物品强度必须为1–10');
  // 带点数的修正写在等级前（物理单体射击+6穿透L5）：挪到等级后。没有点数的“+减速”是效果词，不动。
  const misplaced = base.match(/^(.*?)((?:[+-]\d{1,2}[^\d+\-]+)+)$/);
  if (misplaced && misplaced[1]!.trim() && [...misplaced[2]!.matchAll(/[+-]\d{1,2}([^\d+\-]+)/g)].every((m) => resolveBonusStat(m[1]!.trim()))) {
    base = misplaced[1]!.trim(); suffix = misplaced[2]! + suffix;
    notes?.push(`「${text.trim()}」按「${base}L${power}${suffix}」理解`);
  }
  const legacy = LEGACY_NAMES[base];
  if (legacy) {
    const charged = legacy.startsWith('充能');
    if (charged) form = 'charged';
    base = charged ? legacy.slice(2) : legacy;
  }
  if (!form) {
    // 道具位置上的武器词条先换成对应道具，后面的修正与效果词照技能写法理解。
    const weapon = options.item ? resolveWeaponClass(base) : undefined;
    if (weapon && WEAPON_CLASSES[weapon]) return weaponItem(weapon, power, suffix, undefined, notes, text.trim());
    const equipment = equipmentSpecification(base, power, suffix, attrs);
    if (equipment && options.item) throw new Error('这里只写道具；护甲与盾写在armor、shieldSpec');
    if (equipment) {
      const type = equipment.kind === 'shield' ? 'armor' : equipment.kind;
      if (attrs.type !== undefined && attrs.type !== type) throw new Error('物品种类与物品属性冲突');
      const hint = equipment.kind !== 'item' && equipment.kind !== 'armor' && split.name ? classMismatchHint(split.name, equipment.kind === 'weapon' ? equipment.mechanism : equipment.mechanism ?? 'shield') : '';
      if (hint) notes?.push(hint);
      return equipment;
    }
  }
  for (const key of ['quality', 'body', 'enchant', 'stabilized', 'protection'] as const) if (attrs[key] !== undefined) throw new Error(`${key} 只适用于武器、护甲或盾牌`);
  if (attrs.type !== undefined && !['item', 'consumable', 'accessory'].includes(attrs.type)) throw new Error('物品种类与物品属性冲突');
  const passive = mixedPassiveSpecification(spec) ?? passiveSpecification(base, power, suffix);
  if (passive) {
    if (form && form !== 'worn') throw new Error('特质写在佩戴道具里；一次性或充能道具写技能机制，如buff夜战专精L5');
    return passive;
  }
  if (form === 'worn') {
    const moved = wornBonusFirst(base, power, suffix);
    if (!moved) throw new Error('佩戴道具写特质或“佩戴L等级+修正”，如夜战专精L5、佩戴L4+4防御');
    notes?.push(`「${text.trim()}」按「${moved.text}」理解`);
    return moved.spec;
  }
  const active = activeSpecification(base, power, suffix, form === 'charged' ? 'charged' : 'single', notes);
  if (active) return active;
  // 写了形态词的武器（充能魔杖L5、一次性炸药L3）也是道具。
  const weapon = resolveWeaponClass(base);
  if (weapon && form) return weaponItem(weapon, power, suffix, form === 'charged' ? 'charged' : 'single', notes, text.trim());
  throw new Error(`未知道具效果「${base}」：spec 写效果而不是名称，如buff治疗L3、物理范围投射L4、夜战专精L5${nameHint(base)}`);
}

// ---------- spawn 随身道具 ----------
/** spawn 的 items 一项：没有 spec 的是金币、信件一类叙事物品。 */
export interface SpawnItem { name: string; qty: number; spec?: Extract<ItemSpecification, { kind: 'item' }> }
const ITEM_COUNT = /\s*[×xXｘＸ*＊✕]\s*([0-9０-９]{1,5})\s*(?:件|枚|个|瓶|支|份|颗|发|套|把|根|张|卷|片|包|盒|罐)?\s*$/;
const hasLevel = (text: string) => /[lLｌＬ]\s*[0-9０-９]/.test(text);
const traitList = (text: string) => text.split('、').every((name) => narrativeTrait(name).kind === 'trait');
/**
 * 按逗号分项。“名称:”之后还没写到等级时，逗号或顿号只是佩戴特质之间的分隔（精灵斗篷:潜伏，林地专精L6），
 * 并回前一项；否则另起一项，所以“手雷:…L4×6、治疗药水:…L3”也能分开。
 */
export function splitSpawnItems(value: string, ranges?: [number, number][]): string[] {
  const entries: string[] = [];
  for (const match of value.matchAll(/[^,，、;；\n]+/g)) {
    const raw = match[0];
    const part = raw.trim();
    if (!part) continue;
    const start = match.index! + raw.length - raw.trimStart().length, end = start + part.length;
    const last = entries.at(-1), at = last?.search(/[:：]/) ?? -1;
    const open = last !== undefined && !ITEM_COUNT.test(last) && !hasLevel(at >= 0 ? last.slice(at + 1) : last) && (at >= 0 || traitList(last));
    if (open && !/[:：]/.test(part)) {
      entries[entries.length - 1] = last + '、' + part;
      if (ranges) ranges[ranges.length - 1]![1] = end;
    } else { entries.push(part); ranges?.push([start, end]); }
  }
  return entries;
}
/** items 一项写的名称，不解析效果；与 parseSpawnItem 取的名称相同。 */
export function spawnItemName(entry: string): string {
  let text = entry.trim();
  const count = text.match(ITEM_COUNT);
  if (count) text = text.slice(0, count.index).trim();
  const at = text.search(/[:：]/);
  return at > 0 ? text.slice(0, at).trim() : text.replace(/^[:：]/, '').replace(/\s*[lL]\s*\d.*$/, '').trim();
}
/** “名称:道具spec×件数”；件数省略为1，也接受 x、X、*。武器词条换成对应道具，护甲照旧写在 armor。没写名称时取等级前的文字。 */
export function parseSpawnItem(entry: string, notes?: string[]): SpawnItem {
  let text = entry.trim(), qty = 1;
  const count = text.match(ITEM_COUNT);
  if (count) { qty = Number(count[1]!.replace(/[０-９]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xfee0))); text = text.slice(0, count.index).trim(); }
  if (!Number.isSafeInteger(qty) || qty < 1) throw new Error('件数须为正整数');
  const at = text.search(/[:：]/);
  const name = at > 0 ? text.slice(0, at).trim() : '', specText = (at >= 0 ? text.slice(at + 1) : text).trim();
  if (!specText && !name) throw new Error('缺少道具名称');
  if (!hasLevel(specText)) return { name: name || specText, qty };
  const spec = parseItemSpecification(specText.split('、').map(part => normalizeNarrativeSpec(part)).join('、'), {}, notes, { item: true });
  if (spec.kind !== 'item') throw new Error('武器、护甲与盾写在weapon、weapon2、armor、shield，items只写道具');
  const baseName = specText.replace(/\s*[lL]\s*\d.*$/, '').trim();
  return { name: name || (baseName === '佩戴' ? itemSpecificationText(spec) : baseName) || itemSpecificationText(spec), qty, spec };
}
/** 道具 spec 的规范写法，再解析得到同一个道具。 */
export function itemSpecificationText(spec: Extract<ItemSpecification, { kind: 'item' }>): string {
  return itemSpecText({ version: 'items-v1', form: spec.form, power: spec.power, seed: '', active: spec.active, traits: spec.traits, bonuses: spec.bonuses });
}
/** 规范写法，与 parseSpawnItem 互逆；各项之间用英文逗号连接。 */
export function spawnItemText(item: SpawnItem): string {
  return item.name.replace(/[,，、;；:：×]/g, ' ').trim() + (item.spec ? ':' + itemSpecificationText(item.spec) : '') + (item.qty > 1 ? '×' + item.qty : '');
}
