import { parseEnhancementSuffix, enhancementLabel, type Enhancements } from '../../engine/src/enhancements.js';
import { parseSkillMechanism, skillMechanismId } from '../../engine/src/data/skill-mechanisms.js';
import { decodeEntities } from './protocol-syntax.js';
import { CATEGORY_LABELS } from '../../engine/src/data/ability-blueprints.js';
/**
 * AI 建议标签解析器（纯函数，无 DOM 依赖，可单测）。
 * 世界书「战阵·建议标签规范」的代码对应物：
 *   <give item="物品名" note="简述"/>
 *   <status target="角色名" id="中毒" dur="3"/>
 *   <xp amount="50" reason="原因"/>
 *   <deploy id="持久单位id"/>
 *   <unit_update id="持久单位id" hp="500" hpMax="560" state="ready" clear="中毒" reason="补员"/>
 *   <field env="野战|巷战|攻城|夜战"/>
 *   <spawn name="敌人名" archetype="infantry|ranged|mobile" level="3" count="2"
 *          weapon="裂颅者:斧L6" weapon2="短剑:剑L3" armor="龙鳞宝铠:重甲L6" skills="焚天:烈焰风暴L6"
 *          traits="破甲,恐惧" leader="true"/>
 * spawn 可选属性让生成结果与正文描述对应：
 *   weapon=任意名字＋武器种类＋等级（"名字:种类L等级"，如 裂颅者:斧L6）——名字只用于面板显示，
 *          伤害与射程由种类+等级计算；也兼容旧写法 "剑L5"（种类L等级）与纯名字 "双手巨斧"（按关键词猜种类）
 *   weapon2=副武器，同格式（如 短剑:剑L3）——仅当角色设定确实携带第二件武器时声明，不声明则无副武器；
 *          被迫近战时自动换用（免"武器不善近战"罚）；种类猜不出按时代默认近战位
 *   armor=同格式 "名字:种类L等级"（如 龙鳞宝铠:重甲L6）——种类限 无甲/轻甲/中甲/重甲/超重甲，
 *          等级 L1~L10 定防护品质（L5=标准）；也兼容纯档位名/具体护甲名（板甲/防弹衣……）
 *   skills=逗号分隔的技能条目，每条 "名字:类别L等级"（如 焚天:烈焰风暴L6）或裸蓝图名/类别名；等级可省略
 *   traits=特质名或id 逗号分隔；leader=敌方首领标记
 * 解析容错：属性缺失/数值越界 → 降级为 invalid 记录，永不抛错；
 * 非法标签仅展示原文供玩家核查，不影响其余解析。
 */

import { WEAPON_CLASSES, resolveWeaponClass, ABILITY_BLUEPRINTS, DEFAULT_BLUEPRINTS, categoryLabel, type Category, resolveTraitId, standardConditionMap, validateTraitSource, type TraitDuration, type BodyKind, type ItemSpecification } from '../../engine/src/index.js';
import { parseItemSpecification } from './item-spec.js';

export type LootType = 'weapon' | 'armor' | 'consumable' | 'material' | 'quest' | 'misc';

export type Suggestion =
  | { kind: 'unit-set'; id: string; data: Record<string, unknown>; reason?: string; raw: string }
  | { kind: 'learn'; id: string; skills: SkillSpec[]; raw: string }
  | { kind: 'take'; id: string; qty: number; note?: string; raw: string }
  | { kind: 'give'; item: string; note?: string; qty: number; lootType: LootType; spec?: ItemSpecification; raw: string }
  | { kind: 'reforge'; id: string; name?: string; spec: ItemSpecification; raw: string }
  | { kind: 'bless'; id: string; name: string; traitIds: string[]; duration: TraitDuration; raw: string }
  | { kind: 'affect'; id: string; name: string; conditionIds: string[]; duration: TraitDuration; raw: string }
  | { kind: 'unbless' | 'unaffect'; id: string; sourceId: string; raw: string }
  | { kind: 'status'; target: string; conditionId: string; dur: number; raw: string }
  | { kind: 'xp'; amount: number; reason?: string; raw: string }
  /** 战场环境声明：AI 叙述开战时输出，面板据此设置下一场战斗的环境 */
  | { kind: 'field'; env: FieldEnv; light?: 'day' | 'night'; note?: string; raw: string }
  /** 从储存器调取一个已有单位进入上场编制。id 是储存器稳定身份。 */
  | { kind: 'deploy'; id: string; name?: string; raw: string }
  /** 正文补员、扩编或恢复状态后，按稳定身份更新储存器/编制/当前战场。 */
  | {
      kind: 'unit-update';
      id?: string;
      name?: string;
      hp?: number;
      hpMax?: number;
      morale?: number;
      state?: 'ready' | 'dying' | 'dead' | 'routing' | 'fled';
      clear?: string[];
      reason?: string;
      raw: string;
    }
  | {
      kind: 'spawn';
      bonuses?: Enhancements; weaponBonuses?: Enhancements; weapon2Bonuses?: Enhancements; armorBonuses?: Enhancements;
      body?: BodyKind;
      mount?: boolean;
      speedTier?: number;
      weaponStabilized?: boolean;
      reserves?: number;
      armorProfile?: import('../../engine/src/types.js').ItemRecipe['protectionProfile'];
      quality?: number;
      shield?: boolean;
      hp?: number;
      hpMax?: number;
      name: string;
      archetype: 'infantry' | 'ranged' | 'mobile';
      level: number;
      count: number;
      /** 编制刻度：hero=个体，company=编队；mook仅供旧消息读取。 */
      scale?: 'hero' | 'mook' | 'company';
      /** 阵营：enemy=敌方（默认）/ ally=我方（可生成玩家自己/友军） */
      side?: 'ally' | 'enemy';
      /** 正文装备描述（可选）：weapon 原文（如 "裂颅者:斧L6"） */
      weapon?: string;
      /** 武器显示名：weapon="名字:种类L等级" 的名字段（旧格式无名字段时不落此键） */
      weaponName?: string;
      /** 从 weapon 解析出的武器分类（剑/长兵器/弓弩/火枪/步枪/直射火炮/曲射火炮/能量武器/法杖/钝器） */
      weaponClass?: string;
      /** 从 weapon 解析出的武器等级 L1~L10（与单位等级解耦） */
      weaponLevel?: number;
      /** 副武器（可选）：weapon2="短剑:剑L3"——仅当角色设定确实远近双持时声明 */
      weapon2?: string;
      /** weapon2 解析出的显示名 */
      weapon2Name?: string;
      /** weapon2 解析出的武器分类 */
      weapon2Class?: string;
      /** weapon2 解析出的武器等级 L1~L10 */
      weapon2Level?: number;
      /** 正文装备描述（可选）：armor 原文（档位名/护甲库名/名字:种类L等级） */
      armor?: string;
      /** armor="名字:种类L等级" 的名字段（显式写出种类段才算） */
      armorName?: string;
      /** 从 armor 解析出的护甲档位 0无甲~4超重 */
      armorTier?: 0 | 1 | 2 | 3 | 4;
      /** 从 armor 解析出的护甲等级 L1~L10（防护品质，与档位双轴正交） */
      armorLevel?: number;
      /** 从 skills 解析出的技能条目（蓝图+威力等级+自定义名） */
      skills?: SkillSpec[];
      /** 正文特质（可选）：特质名或 id */
      traits?: string[];
      /** 敌方首领（可选）：附加统率+精锐特质 */
      leader?: boolean;
      raw: string;
    };

export interface ParseResult {
  suggestions: Suggestion[];
  /** 无法解析的标签原文（面板灰显） */
  invalid: string[];
}

const TAG_RE = /<(learn|give|take|reforge|bless|unbless|affect|unaffect|status|xp|field|spawn|deploy|unit_update)\b([^>]*?)\/>/gi;
const ATTR_RE = /([a-zA-Z][a-zA-Z0-9_-]*)\s*=\s*"([^"]*)"/g;

function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(s))) out[m[1]!] = decodeEntities(m[2] ?? '');
  return out;
}

function clampInt(v: string | undefined, min: number, max: number, dflt: number): number {
  const n = parseInt((v ?? '').trim(), 10);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(min, Math.min(max, n));
}

function optionalInt(v: string | undefined, min: number, max: number): number | undefined {
  if (v === undefined || v.trim() === '') return undefined;
  const n = parseInt(v.trim(), 10);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : undefined;
}

const ARCHETYPES = ['infantry', 'ranged', 'mobile'] as const;
const SCALES = ['hero', 'mook', 'company'] as const;

/** weapon 属性的解析结果：显示名（任意名字）＋ 可选的种类/等级数值段 */
export interface WeaponSpec {
  bonuses?: Enhancements;
  /** 显示名：显式名字段（"名字:种类L等级" 的名字）时是 AI 起的名字；否则为整串原文（兼容旧格式） */
  label: string;
  /** 种类段命中的分类键（剑→sword……）；未识别出有效种类时 undefined */
  classKey?: string;
  /** 武器等级 L1~L10；未给出时 undefined（生成时回退单位等级） */
  level?: number;
  /** AI 显式写出了名字段（种类段有效才算） */
  named?: boolean;
}

/** 名字与「种类L等级」段之间允许的分隔符：中英文冒号、间隔号、竖线、斜杠 */
const SPEC_SEP_RE = /[:：·｜|/／]/;

/** 种类段 → 分类键：先精确匹配分类显示名（剑/斧/长兵器……），不中再用关键词表兜底 */
function classKeyBySpecName(name: string): string | undefined {
  const n = name.trim();
  if (!n) return undefined;
  const exact = resolveWeaponClass(n); if (exact) return exact;
  return weaponClassKey(n);
}

/**
 * 解析 weapon 属性（格式：任意名字＋武器种类＋等级）：
 *   "裂颅者:斧L6" → 显示名 裂颅者 ＋ 数值段 斧L6（axe / L6）
 *   "守护之弓：弓弩L4"（全角冒号）、"老伙计|步枪L7"（竖线）同样支持
 * 兼容旧写法（无分隔符）："剑L5" → 分类+等级、显示名用原文；"双手巨斧" → 按关键词猜分类、无等级。
 * 种类段没写出有效分类时整串按纯名字处理（生成走关键词推断/曲线基准）。
 */
export function parseWeaponSpec(v: string): WeaponSpec {
  const parsed = parseEnhancementSuffix(v,'weapon');
  if(parsed.bonuses)return {...parseWeaponSpec(parsed.text),bonuses:parsed.bonuses};
  const s = (v ?? '').trim();
  if (!s) return { label: s };
  const idx = s.search(SPEC_SEP_RE);
  if (idx > 0) {
    const label = s.slice(0, idx).trim();
    const spec = s.slice(idx + 1).trim();
    const m = spec.match(/^(.+?)\s*[lL]\s*(\d{1,2})$/);
    const className = (m ? m[1]! : spec).trim();
    const classKey = classKeyBySpecName(className);
    if (classKey) {
      const lv = m ? clampInt(m[2]!, 1, 10, Number.NaN) : Number.NaN;
      return { label: label || s, classKey, ...(Number.isFinite(lv) ? { level: lv } : {}), named: true };
    }
    return { label: s };
  }
  // 旧格式：无名字段，整串既是显示名也是种类段
  const m = s.match(/^(.*?)\s*[lL]\s*(\d{1,2})$/);
  if (m) {
    const name = m[1]!.trim();
    const level = clampInt(m[2], 1, 10, Number.NaN);
    if (Number.isFinite(level)) {
      const classKey = name ? weaponClassKey(name) : undefined;
      return { label: s, ...(classKey ? { classKey } : {}), level };
    }
  }
  const key = weaponClassKey(s);
  return { label: s, ...(key ? { classKey: key } : {}) };
}

/** 把武器名映射到引擎 weaponClass 键（剑→sword、长兵器→spear……）；未命中返回 undefined */
export function weaponClassKey(name: string): string | undefined {
  const exact = resolveWeaponClass(name); if (exact) return exact;
  const n = (name ?? '').trim().toLowerCase();
  if (!n) return undefined;
  const rules: { cls: string; kws: string[] }[] = [
    { cls: 'light-ranged', kws: ['轻型投射', '手弩', '手枪', '短铳'] },
    { cls: 'sword', kws: ['剑', '刀', '长剑', '短剑', '巨剑', '武士刀'] },
    { cls: 'axe', kws: ['斧', '战斧', '巨斧', '手斧'] },
    { cls: 'spear', kws: ['长枪', '长兵器', '长矛', '枪矛', '矛', '戟', '长柄', '骑枪'] },
    { cls: 'bow', kws: ['弓', '弩', '长弓', '短弓', '弓箭', '复合弓'] },
    { cls: 'firearm', kws: ['火枪', '燧发枪', '火绳枪', '火铳', '滑膛枪', '铳'] },
    { cls: 'rifle', kws: ['步枪', '机枪', '突击步枪', '卡宾', '狙击枪', 'hk416', 'hk-416', 'ak', '自动枪', '枪'] },
    { cls: 'autocannon', kws: ['机炮', '机关炮', '自动炮', 'autocannon', 'auto cannon'] },
    { cls: 'indirect-cannon', kws: ['曲射', '间接火炮', '榴弹炮', '迫击炮', '投石机', '抛石机', 'howitzer', 'mortar'] },
    { cls: 'cannon', kws: ['炮', '火炮', '舰炮', '野战炮', '坦克炮'] },
    { cls: 'energy', kws: ['等离子', '激光', '轨道炮', '脉冲', '能量', '光剑', '电浆', '粒子'] },
    { cls: 'magic', kws: ['法杖', '魔杖', '魔法', '法术', '权杖'] },
    { cls: 'blunt', kws: ['棍', '棒', '锤', '钝器', '钉头锤'] },
  ];
  for (const { cls, kws } of rules) if (kws.some((k) => n.includes(k))) return cls;
  return undefined;
}

// ---------- 护甲 ----------

/** 护甲种类（档位）显示名 → 档位值；别名兜底（皮甲→轻甲……）。
 *  注意：护甲库名（板甲/锁子甲/防弹衣/动力甲……）不进别名表——它们走库名匹配，保留各自 drScale 原型。 */
const ARMOR_TIER_NAMES = ['无甲', '轻甲', '中甲', '重甲', '超重甲'] as const;
const ARMOR_TIER_ALIASES: { tier: 0 | 1 | 2 | 3 | 4; kws: string[] }[] = [
  { tier: 0, kws: ['布甲', '便装'] },
  { tier: 1, kws: ['皮甲', '软甲', '链甲'] },
  { tier: 2, kws: ['鳞甲', '板条甲', '镶片甲'] },
  { tier: 3, kws: ['全身甲', '札甲'] },
];

function armorTierByName(name: string): 0 | 1 | 2 | 3 | 4 | undefined {
  const n = name.trim();
  if (!n) return undefined;
  const exact = ARMOR_TIER_NAMES.indexOf(n as (typeof ARMOR_TIER_NAMES)[number]);
  if (exact >= 0) return exact as 0 | 1 | 2 | 3 | 4;
  for (const { tier, kws } of ARMOR_TIER_ALIASES) if (kws.some((k) => n.includes(k))) return tier;
  return undefined;
}

/** armor 属性的解析结果：与 WeaponSpec 同构 */
export interface ArmorSpec {
  bonuses?: Enhancements;
  /** 显示名：显式名字段时是 AI 起的名字；纯档位名时是档位名；其余为整串原文（护甲库名/自由文本） */
  label: string;
  /** 护甲档位 0~4；未识别出有效种类时 undefined（走护甲库名匹配/自由文本） */
  tier?: 0 | 1 | 2 | 3 | 4;
  /** 护甲等级 L1~L10（防护品质乘数）；未给出时 undefined */
  level?: number;
  /** AI 显式写出了名字段（种类段有效才算） */
  named?: boolean;
}

/**
 * 解析 armor 属性（与武器同格式：任意名字＋种类＋等级）：
 *   "龙鳞宝铠:重甲L6" → 名字 龙鳞宝铠 ＋ 重甲（档3）＋ L6（品质）
 *   "重甲L6" / "重甲" → 纯种类段（无自定义名）
 *   "板甲" / "龙鳞宝铠" → 识别不出种类段：整串按护甲库名/自由文本处理
 */
export function parseArmorSpec(v: string): ArmorSpec {
  const parsed = parseEnhancementSuffix(v,'armor');
  if(parsed.bonuses)return {...parseArmorSpec(parsed.text),bonuses:parsed.bonuses};
  const s = (v ?? '').trim();
  if (!s) return { label: s };
  const idx = s.search(SPEC_SEP_RE);
  if (idx > 0) {
    const label = s.slice(0, idx).trim();
    const spec = s.slice(idx + 1).trim();
    const m = spec.match(/^(.+?)\s*[lL]\s*(\d{1,2})$/);
    const className = (m ? m[1]! : spec).trim();
    const tier = armorTierByName(className);
    if (tier !== undefined) {
      const lv = m ? clampInt(m[2]!, 1, 10, Number.NaN) : Number.NaN;
      return { label: label || s, tier, ...(Number.isFinite(lv) ? { level: lv } : {}), named: true };
    }
    return { label: s };
  }
  // 纯种类段（可带等级）："重甲L6" / "重甲"
  const m = s.match(/^(.+?)\s*[lL]\s*(\d{1,2})$/);
  if (m) {
    const tier = armorTierByName(m[1]!);
    const level = clampInt(m[2], 1, 10, Number.NaN);
    if (tier !== undefined && Number.isFinite(level)) {
      return { label: ARMOR_TIER_NAMES[tier], tier, level };
    }
    // 带等级但种类没命中（"防弹衣L5"）：整串当护甲库名/自由文本，等级交由库名匹配
    return { label: s };
  }
  const tier = armorTierByName(s);
  if (tier !== undefined) return { label: ARMOR_TIER_NAMES[tier], tier };
  return { label: s };
}

// ---------- 技能 ----------

/** 技能条目的解析结果 */
export interface SkillSpec {
  bonuses?: Enhancements;
  blueprintId: string;
  /** 威力等级 L1~L10；未给出时 undefined（生成时回退单位等级） */
  level?: number;
  /** AI 起的技能名（"名字:蓝图L等级" 的名字段） */
  name?: string;
}

/** 蓝图段 → 蓝图 id：精确 id/名称/类别名 → 名称双向包含兜底（"烈焰"→烈焰风暴） */
function blueprintKey(spec: string): string | undefined {
  const n = spec.trim();
  if (!n) return undefined;
  const generic = parseSkillMechanism(n); if (generic) return skillMechanismId(generic);
  if (/^(?:generic:|物理|魔法|buff|debuff|增益|减益|范围buff|范围debuff)/i.test(n)) return undefined;
  for (const bp of Object.values(ABILITY_BLUEPRINTS)) {
    if (bp.id === n || bp.name === n) return bp.id;
  }
  const category = (Object.keys(DEFAULT_BLUEPRINTS) as Category[]).find((c) => categoryLabel(c) === n || CATEGORY_LABELS[c] === n);
  if (category) return DEFAULT_BLUEPRINTS[category];
  for (const bp of Object.values(ABILITY_BLUEPRINTS)) {
    if (bp.name.includes(n) || n.includes(bp.name)) return bp.id;
  }
  return undefined;
}

/** 单条技能：可选 "名字:" 前缀 + 蓝图（必命中才有效）+ 可选 L等级 */
function parseSkillItem(item: string): SkillSpec | undefined {
  const parsed = parseEnhancementSuffix(item,'skill');
  if(parsed.bonuses){const skill=parseSkillItem(parsed.text);return skill?{...skill,bonuses:parsed.bonuses}:undefined;}
  const s = item.trim();
  if (!s) return undefined;
  const idx = s.search(SPEC_SEP_RE);
  if (idx > 0) {
    const name = s.slice(0, idx).trim();
    const spec = s.slice(idx + 1).trim();
    const m = spec.match(/^(.+?)\s*[lL]\s*(\d{1,2})$/);
    const bpName = (m ? m[1]! : spec).trim();
    const blueprintId = blueprintKey(bpName);
    if (blueprintId) {
      if (m && (Number(m[2]) < 1 || Number(m[2]) > 10)) return undefined;
      const lv = m ? Number(m[2]) : Number.NaN;
      return { blueprintId, ...(Number.isFinite(lv) ? { level: lv } : {}), ...(name ? { name } : {}) };
    }
    // 名字段存在但蓝图没命中：把整条当纯蓝图名再试一次（名字里可能就含分隔符类字符）
    if (/^(?:generic:|物理|魔法|buff|debuff|增益|减益|范围)/i.test(bpName)) return undefined;
    const fallback = blueprintKey(s);
    if (fallback) return { blueprintId: fallback };
    return undefined;
  }
  const m = s.match(/^(.+?)\s*[lL]\s*(\d{1,2})$/);
  if (m) {
    const blueprintId = blueprintKey(m[1]!.trim());
    const level = Number(m[2]);
    if (level < 1 || level > 10) return undefined;
    if (blueprintId && Number.isFinite(level)) return { blueprintId, level };
  }
  const blueprintId = blueprintKey(s);
  return blueprintId ? { blueprintId } : undefined;
}

/** 解析 skills 属性：逗号分隔的多条 "名字:蓝图L等级"；单条不命中不影响其余 */
export function parseAbilitySpec(v: string): SkillSpec[] {
  return (v ?? '')
    .split(/[,，、;；]/)
    .map((x) => parseSkillItem(x))
    .filter((x): x is SkillSpec => !!x);
}

// ---------- 战场环境 ----------

/** 环境声明 → 面板 field 标签键 */
export const FIELD_ENV_KEYS = ['plains', 'urban', 'siege', 'night', 'forest', 'mountain'] as const;
export type FieldEnv = (typeof FIELD_ENV_KEYS)[number];
const FIELD_ENV_KWS: Record<FieldEnv, string[]> = {
  plains: ['野战', '平原', '原野', '野外', '开阔'],
  urban: ['巷战', '城镇', '城市', '街巷', '市区'],
  siege: ['攻城', '围城', '攻坚', '要塞', '城塞'],
  night: ['夜战', '夜晚', '夜间', '黑夜', '夜袭'],
  forest: ['森林', '林地', '树林'],
  mountain: ['山地', '山岭', '山岳'],
};

/** 环境描述 → 环境键（关键词匹配）；识别不出返回 undefined */
export function fieldEnvKey(desc: string): FieldEnv | undefined {
  const n = (desc ?? '').trim();
  if (!n) return undefined;
  for (const key of FIELD_ENV_KEYS) {
    if (n === key || FIELD_ENV_KWS[key].some((k) => n.includes(k))) return key;
  }
  return undefined;
}

export function parseSuggestionTags(text: string): ParseResult {
  const suggestions: Suggestion[] = [];
  const invalid: string[] = [];
  TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(text))) {
    const kind = m[1]!.toLowerCase();
    const a = parseAttrs(m[2] ?? '');
    const raw = m[0];
    try { switch (kind) {
      case 'bless':
      case 'affect': {
        try {
          const content = kind === 'bless' ? a.traits : a.effects;
          if (!a.id?.trim() || !content?.trim()) throw new Error('需要单位与明确效果');
          const durations = ['rounds', 'battles', 'permanent'].filter((key) => a[key] !== undefined);
          if (durations.length !== 1) throw new Error('需要唯一明确期限');
          const key = durations[0]!;
          if (key === 'permanent' ? a[key] !== 'true' : !/^[1-9]\d?$/.test(a[key]!)) throw new Error('非法期限');
          const duration: TraitDuration = key === 'permanent' ? { kind: 'permanent' } : { kind: key as 'rounds' | 'battles', count: Number(a[key]) };
          const names = content.split(/[,，、]/).map((name) => name.trim());
          const name = a.name?.trim() || (kind === 'bless' ? '剧情祝福' : names.join('、'));
          const life = duration.kind !== 'permanent' ? { remaining: duration.count } : {};
          if (kind === 'bless') {
            const traitIds = names.map((name) => resolveTraitId(name) ?? name);
            validateTraitSource({ id: 'parse', name, kind: 'blessing', traitIds, duration, ...life });
            suggestions.push({ kind: 'bless', id: a.id.trim(), name, traitIds, duration, raw });
          } else {
            const registry = standardConditionMap();
            const conditionIds = names.map((name) => [...registry.values()].find((c) => c.id === name || c.name === name)?.id ?? name);
            validateTraitSource({ id: 'parse', name, kind: 'effect', traitIds: [], conditionIds, duration, ...life });
            suggestions.push({ kind: 'affect', id: a.id.trim(), name, conditionIds, duration, raw });
          }
        } catch { invalid.push(raw); }
        break;
      }
      case 'unbless':
      case 'unaffect': {
        if (!a.id?.trim() || !a.source?.trim()) invalid.push(raw);
        else suggestions.push({ kind, id: a.id.trim(), sourceId: a.source.trim(), raw });
        break;
      }
      case 'learn': {
        const skills = parseAbilitySpec(a.skills ?? '');
        if (!a.id?.trim() || !skills.length || skills.length !== (a.skills ?? '').split(/[,，、;；]/).length) invalid.push(raw);
        else suggestions.push({ kind: 'learn', id: a.id.trim(), skills, raw });
        break;
      }
      case 'reforge': {
        try {
          if (!a.id?.trim() || !a.spec?.trim()) throw new Error('缺少装备引用或规格');
          const spec = parseItemSpecification(a.spec, a);
          if (spec.kind === 'consumable') throw new Error('消耗品不能重铸');
          suggestions.push({ kind: 'reforge', id: a.id.trim(), name: a.name?.trim() || undefined, spec, raw });
        } catch { invalid.push(raw); }
        break;
      }
      case 'take': {
        if (!a.id?.trim() || a.qty !== undefined && (!/^\d+$/.test(a.qty) || Number(a.qty) < 1 || Number(a.qty) > 9999)) { invalid.push(raw); break; }
        suggestions.push({ kind: 'take', id: a.id.trim(), qty: Number(a.qty ?? 1), note: a.note, raw });
        break;
      }
      case 'give': {
        const item = (a.item ?? '').trim();
        if (!item) {
          invalid.push(raw);
          break;
        }
        const lootTypes: LootType[] = ['weapon', 'armor', 'consumable', 'material', 'quest', 'misc'];
        const lootType = lootTypes.includes((a.type ?? '') as LootType) ? (a.type as LootType) : 'misc';
        let spec: ItemSpecification | undefined;
        try { if (a.spec !== undefined) spec = parseItemSpecification(a.spec, a); }
        catch { invalid.push(raw); break; }
        suggestions.push({
          kind: 'give', item, note: (a.note ?? '').trim() || undefined,
          qty: clampInt(a.qty, 1, 9999, 1), lootType: spec ? spec.kind === 'shield' ? 'armor' : spec.kind : lootType,
          ...(spec ? { spec } : {}), raw,
        });
        break;
      }
      case 'status': {
        const target = (a.target ?? '').trim();
        const id = (a.id ?? '').trim();
        if (!target || !id) {
          invalid.push(raw);
          break;
        }
        suggestions.push({ kind: 'status', target, conditionId: id, dur: clampInt(a.dur, 1, 99, 3), raw });
        break;
      }
      case 'xp': {
        const amount = clampInt(a.amount, 1, 100000, Number.NaN);
        if (!Number.isFinite(amount)) {
          invalid.push(raw);
          break;
        }
        suggestions.push({ kind: 'xp', amount, reason: (a.reason ?? '').trim() || undefined, raw });
        break;
      }
      case 'field': {
        const env = fieldEnvKey((a.env ?? a.name ?? '').trim());
        if (!env) {
          invalid.push(raw);
          break;
        }
        if (a.light !== undefined && !['day', 'night'].includes(a.light) || env === 'night' && a.light === 'day') { invalid.push(raw); break; }
        suggestions.push({ kind: 'field', env, ...(a.light ? { light: a.light as 'day' | 'night' } : {}), note: (a.note ?? '').trim() || undefined, raw });
        break;
      }
      case 'deploy': {
        const id = (a.id ?? a.ref ?? '').trim();
        if (!id) {
          invalid.push(raw);
          break;
        }
        suggestions.push({ kind: 'deploy', id, name: (a.name ?? '').trim() || undefined, raw });
        break;
      }
      case 'unit_update': {
        const id = (a.id ?? a.ref ?? '').trim() || undefined;
        const name = (a.name ?? '').trim() || undefined;
        const hp = optionalInt(a.hp, 0, 1_000_000_000);
        const hpMax = optionalInt(a.hpMax ?? a.maxHp ?? a.max, 1, 1_000_000_000);
        const morale = optionalInt(a.morale, 0, 1_000_000_000);
        const states = ['ready', 'dying', 'dead', 'routing', 'fled'] as const;
        const stateRaw = (a.state ?? '').trim();
        const state = (states as readonly string[]).includes(stateRaw)
          ? stateRaw as (typeof states)[number]
          : undefined;
        const clear = (a.clear ?? '').split(/[,，、]/).map((x) => x.trim()).filter(Boolean);
        if ((!id && !name) || (hp === undefined && hpMax === undefined && morale === undefined && !state && !clear.length)) {
          invalid.push(raw);
          break;
        }
        suggestions.push({
          kind: 'unit-update', ...(id ? { id } : {}), ...(name ? { name } : {}),
          ...(hp !== undefined ? { hp } : {}), ...(hpMax !== undefined ? { hpMax } : {}),
          ...(morale !== undefined ? { morale } : {}), ...(state ? { state } : {}),
          ...(clear.length ? { clear } : {}), reason: (a.reason ?? '').trim() || undefined, raw,
        });
        break;
      }
      case 'spawn': {
        const name = (a.name ?? '').trim();
        const arch = (a.archetype ?? '').trim();
        if (!name || !(ARCHETYPES as readonly string[]).includes(arch)) {
          invalid.push(raw);
          break;
        }
        const splitList = (v: string | undefined): string[] | undefined => {
          const parts = (v ?? '').split(/[,，、]/).map((x) => x.trim()).filter(Boolean);
          return parts.length ? parts : undefined;
        };
        // 武器：支持 "裂颅者:斧L6"（任意名字＋种类＋等级）——名字给面板显示，种类+等级给数值计算
        const weaponRaw = (a.weapon ?? '').trim();
        const wepSpec = weaponRaw ? parseWeaponSpec(weaponRaw) : undefined;
        // 副武器：同格式 "短剑:剑L3"，仅显式声明才有（不自动配发）
        const sidearmRaw = (a.weapon2 ?? '').trim();
        const sideSpec = sidearmRaw ? parseWeaponSpec(sidearmRaw) : undefined;
        // 护甲：同格式 "龙鳞宝铠:重甲L6"（名字＋档位种类＋品质等级）
        const armorRaw = (a.armor ?? '').trim();
        const armSpec = armorRaw ? parseArmorSpec(armorRaw) : undefined;
        // 技能：逗号分隔 "名字:蓝图L等级"
        const skillsRaw = (a.skills ?? a.abilities ?? '').trim();
        const skills = skillsRaw ? parseAbilitySpec(skillsRaw) : [];
        // 刻度：scale=hero|mook|company（连队=军团会战编制）；缺省由面板按当前战斗规模决定
        const training = parseEnhancementSuffix('L'+(a.level??'1').replace(/^[lL]/,''),'unit');
        const scaleRaw = (a.scale ?? '').trim().toLowerCase();
        suggestions.push({
          kind: 'spawn',
          name,
          archetype: arch as (typeof ARCHETYPES)[number],
          level: clampInt(training.text.slice(1), 1, 10, 1), bonuses: training.bonuses,
          count: clampInt(a.count, 1, 20, 1),
          ...((SCALES as readonly string[]).includes(scaleRaw) ? { scale: scaleRaw as (typeof SCALES)[number] } : {}),
          ...((a.side ?? '').trim() === 'ally' ? { side: 'ally' as const } : {}),
          ...(weaponRaw ? { weapon: weaponRaw } : {}),
          ...(wepSpec?.classKey ? { weaponClass: wepSpec.classKey } : {}),
          weaponBonuses: wepSpec?.bonuses,
          ...(wepSpec?.level ? { weaponLevel: wepSpec.level } : {}),
          ...(wepSpec?.named ? { weaponName: wepSpec.label } : {}),
          ...(sidearmRaw ? { weapon2: sidearmRaw } : {}),
          ...(sideSpec?.classKey ? { weapon2Class: sideSpec.classKey } : {}),
          weapon2Bonuses: sideSpec?.bonuses,
          ...(sideSpec?.level ? { weapon2Level: sideSpec.level } : {}),
          ...(sideSpec ? { weapon2Name: sideSpec.label } : {}),
          ...(armorRaw ? { armor: armorRaw } : {}),
          ...(armSpec?.named ? { armorName: armSpec.label } : {}),
          ...(armSpec?.tier !== undefined ? { armorTier: armSpec.tier } : {}),
          armorBonuses: armSpec?.bonuses,
          ...(armSpec?.level ? { armorLevel: armSpec.level } : {}),
          ...(skills.length ? { skills } : {}),
          ...(splitList(a.traits) ? { traits: splitList(a.traits) } : {}),
          ...((a.leader ?? '').trim() === 'true' ? { leader: true } : {}),
          raw,
        });
        break;
      }
    } } catch { invalid.push(raw); }
  }
  return { suggestions, invalid };
}
