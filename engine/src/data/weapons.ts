/**
 * 武器生成器：与单位生成机制同构——武器原型参数 × 等级曲线 → 公式计算骰子表达式，全程审计。
 *
 * 设计动机：原先武器数值完全继承等级曲线（时代皮肤只换名字），导致
 * ①「卫兵扛轨道炮」类术语/数值错位；②时代差异只能靠整包规则手调。
 * 现在武器原型自带数值参数（dmgMult/apShare/range），术语与数值同源：
 *   燧发枪 1.15 倍伤害、轨道炮 1.4 倍 + 130% 破甲、野战炮射程 4 带。
 *
 * 公式（mult=1 且 apShare=1 时走曲线直出，保证既有默认武器数值不变）：
 *   普通段均值 = (曲线均值 + 原型/浮动固定加值) × dmgMult → 按曲线骰型重建 NdM+K
 *   破甲段均值 = 曲线破甲均值 × apShare → 重建 Nd4+K（有无破甲仍按刻度/风格/等级门禁）
 */

import { parseDice } from '../dice.js';
import type { CurveRow } from '../data/curves.js';
import type { Scale, Weapon } from '../types.js';
import { MELEE_PROFILES } from '../melee.js';

/** 在骰子表达式的固定加值上叠加修正并重建字符串（与 generator.withFlat 同式，避免循环依赖） */
function withFlatLocal(expr: string, delta: number): string {
  const e = parseDice(expr);
  const flat = e.flat + delta;
  const keep = e.keepHigh !== undefined ? `kh${e.keepHigh}` : e.keepLow !== undefined ? `kl${e.keepLow}` : '';
  return `${e.count}d${e.sides}${keep}${flat >= 0 ? '+' : ''}${flat}`;
}

export interface WeaponProfile {
  id: string;
  name: string;
  /** 普通段伤害均值乘数（1 = 曲线基准） */
  dmgMult: number;
  /** 破甲段均值乘数（1 = 曲线基准） */
  apShare: number;
  /** 射程带：近战 0 / 长柄 1 / 枪械 3 / 重火力 4 */
  range: number;
  minRange?: number;
  pointBlankPolicy?: Weapon['pointBlankPolicy'];
  pointBlankPenalty?: number;
  indirect?: boolean;
  /** 编队内部爆破：最多两份投送，每份最多四名成员暴露；不跨单位溅射。 */
  blast?: boolean;
  /** 每回合攻击结算次数（速射）；缺省 1 */
  attacks?: number;
  /** 发射后装填回合数；缺省 0 */
  reload?: number;
  desc?: string;
}

/** 武器大类库：AI 输出「武器等级 + 分类」时，按分类取数值原型、按武器等级走强度曲线。
 *  分类 = 语义化的大类，等级 = 该武器自身的品质档（L1~L10）。
 *  例如 剑L5、长兵器L7、步枪L3 —— 分类定性质（破甲/射程/速射），武器等级定强度。 */
export interface WeaponClassProfile {
  id: string;
  /** 分类显示名 / AI 关键词 */
  name: string;
  /** 数值原型（与 WEAPON_LIBRARY 同构）：分类只决定性质，等级曲线决定威力 */
  profile: WeaponProfile;
}

export const WEAPON_CLASSES: Record<string, WeaponClassProfile> = {
  'light-ranged': { id: 'light-ranged', name: '轻型投射', profile: { id: 'cls-light-ranged', name: '轻型投射', dmgMult: 0.8, apShare: 0.8, range: 2, minRange: 0, pointBlankPolicy: 'penalty', pointBlankPenalty: -2, desc: '单手轻型投射：短射程，可作为副武器，占同一主行动' } },
  demolition: { id: 'demolition', name: '爆破装置', profile: { id: 'cls-demolition', name: '爆破装置', dmgMult: 1.6, apShare: 1.2, range: 2, minRange: 0, pointBlankPolicy: 'allow', reload: 1, blast: true, desc: '短距爆破：距离1正常、距离2命中−2；英雄一份、编队最多两份投送，每份最多六名成员暴露；较强穿透，使用后准备一回合，不跨单位溅射' } },
  sword: { id: 'sword', name: '剑', profile: { id: 'cls-sword', name: '剑', dmgMult: 1.0, apShare: 1.0, range: 0, desc: MELEE_PROFILES.sword!.description } },
  axe: { id: 'axe', name: '斧', profile: { id: 'cls-axe', name: '斧', dmgMult: 1.15, apShare: 1.1, range: 0, desc: MELEE_PROFILES.axe!.description } },
  spear: { id: 'spear', name: '长兵器', profile: { id: 'cls-spear', name: '长兵器', dmgMult: 1.05, apShare: 1.15, range: 1, desc: MELEE_PROFILES.spear!.description } },
  bow: { id: 'bow', name: '弓弩', profile: { id: 'cls-bow', name: '弓弩', dmgMult: 1.0, apShare: 1.0, range: 4, minRange: 1, pointBlankPolicy: 'forbid', desc: '远程射击：可越过友军，不能越过墙体或存活敌方前排' } },
  firearm: { id: 'firearm', name: '火枪', profile: { id: 'cls-firearm', name: '火枪', dmgMult: 1.5, apShare: 1.05, range: 4, minRange: 0, pointBlankPolicy: 'penalty', pointBlankPenalty: -2, reload: 1, desc: '单发火枪：高单发威力、穿透额外+1，射后装填一回合' } },
  rifle: { id: 'rifle', name: '步枪', profile: { id: 'cls-rifle', name: '步枪', dmgMult: 1.2, apShare: 1.1, range: 4, minRange: 0, pointBlankPolicy: 'penalty', pointBlankPenalty: -2, attacks: 2, desc: '自动步枪：每回合两段速射' } },
  autocannon: { id: 'autocannon', name: '机炮', profile: { id: 'cls-autocannon', name: '机炮', dmgMult: 1.4, apShare: 1.15, range: 5, minRange: 0, pointBlankPolicy: 'penalty', pointBlankPenalty: -3, attacks: 3, desc: '直射连续点射：三段分摊火力预算，穿透额外+2，擅长连续火力和装甲交战；重型投送需要炮组或大型/载具平台' } },
  cannon: { id: 'cannon', name: '直射火炮', profile: { id: 'cls-cannon', name: '直射火炮', dmgMult: 1.6, apShare: 1.2, range: 5, minRange: 0, pointBlankPolicy: 'penalty', pointBlankPenalty: -3, reload: 1, desc: '直射重火力：受地形与单位视线遮挡，隔回合一发' } },
  'indirect-cannon': { id: 'indirect-cannon', name: '曲射火炮', profile: { id: 'cls-indirect-cannon', name: '曲射火炮', dmgMult: 1.6, apShare: 1.2, range: 5, minRange: 2, pointBlankPolicy: 'forbid', indirect: true, reload: 1, desc: '间接重火力：可越过遮挡，需己方观察者；最小射程2，隔回合一发' } },
  energy: { id: 'energy', name: '能量武器', profile: { id: 'cls-energy', name: '能量武器', dmgMult: 1.3, apShare: 1.2, range: 4, minRange: 0, pointBlankPolicy: 'penalty', pointBlankPenalty: -2, attacks: 2, desc: '等离子/激光：护甲破甲优势' } },
  magic: { id: 'magic', name: '法杖', profile: { id: 'cls-magic', name: '法杖', dmgMult: 0.9, apShare: 1.3, range: 4, minRange: 0, pointBlankPolicy: 'allow', desc: '魔弹：部分无视护甲；可越过友军，不能越过墙体或存活敌方前排' } },
  blunt: { id: 'blunt', name: '钝器', profile: { id: 'cls-blunt', name: '钝器', dmgMult: 1.1, apShare: 1.2, range: 0, desc: MELEE_PROFILES.blunt!.description } },
};

/** 新正文的明确同义词。只选择既有机制，不附送名称暗示的额外效果。 */
export const WEAPON_CLASS_ALIASES: Record<string, string[]> = {
  demolition: ['爆破', '炸药', '炸药包', '爆破包', '火药桶', '矿用火药桶', '炸药桶', 'powder keg', 'explosive', 'explosives'],
  sword: ['刀', '长剑', '短剑', '巨剑', '双手剑', '战刃', '鞭剑', '军刀', '马刀', '武士刀', '链锯剑', '单分子刀', 'saber', 'blade'],
  axe: ['战斧', '巨斧', '手斧', '双手斧', '双手巨斧'],
  spear: ['矛', '长矛', '长枪', '枪矛', '戟', '长戟', '长柄', '骑枪', '长杆武器', 'pike', 'lance'],
  bow: ['弓', '弩', '长弓', '短弓', '弓箭', '复合弓', '十字弩', 'crossbow'],
  'light-ranged': ['手枪', '手弩', '短铳', '左轮手枪', 'pistol', 'hand crossbow'],
  firearm: ['燧发枪', '火绳枪', '火铳', '滑膛枪', '前装枪', 'musket'],
  rifle: ['机枪', '突击步枪', '自动步枪', '卡宾枪', '狙击枪', '爆弹枪', '冲锋枪', '车载机枪', 'assault rifle', 'machine gun'],
  autocannon: ['自动炮', '车载机炮', '转管机炮', '机关炮', 'autocannon', 'auto cannon'],
  'indirect-cannon': ['曲射炮', '间接火炮', '间接火力', '榴弹炮', '迫击炮', '投石机', '抛石机', 'howitzer', 'mortar'],
  cannon: ['火炮', '直射炮', '炮', '大炮', '坦克炮', '舰炮', '加农炮', '轨道炮', '电磁炮', '直射火炮', 'railgun'],
  energy: ['激光枪', '激光步枪', '激光', '等离子枪', '等离子步枪', '电浆枪', '粒子枪', '脉冲枪', '能量枪', '光束枪', 'lasgun', 'laser rifle', 'plasma gun'],
  magic: ['魔杖', '魔法杖', '施法法杖', 'staff', 'wand'],
  blunt: ['棍', '棒', '锤', '战锤', '钉头锤', '狼牙棒', '权杖', 'mace', 'hammer'],
};
export function resolveWeaponClass(name: string): string | undefined {
  const value = name.trim().toLowerCase();
  return Object.values(WEAPON_CLASSES).find((c) => c.id === value || c.name === value)?.id
    ?? Object.entries(WEAPON_CLASS_ALIASES).find(([, names]) => names.includes(value))?.[0];
}

/** AI 描述的武器名 → 分类（关键词映射）。命中分类后按「分类×武器等级」计算数值。 */
const CLASS_KEYWORDS: { cls: string; kws: string[] }[] = [
  { cls: 'demolition', kws: ['爆破装置', '火药桶', '炸药桶', '爆破包', '炸药包'] },
  { cls: 'light-ranged', kws: ['轻型投射', '手弩', '手枪', '短铳'] },
  { cls: 'sword', kws: ['剑', '刀', '长剑', '短剑', '巨剑', '武士刀'] },
  { cls: 'axe', kws: ['斧', '战斧', '巨斧', '手斧'] },
  { cls: 'spear', kws: ['长枪', '长兵器', '长矛', '枪矛', '戟', '长柄', '骑枪'] },
  { cls: 'bow', kws: ['弓', '弩', '长弓', '短弓', '弓箭', '复合弓'] },
  { cls: 'firearm', kws: ['火枪', '燧发枪', '火绳枪', '火铳', '铳枪', '滑膛枪'] },
  { cls: 'rifle', kws: ['步枪', '机枪', '突击步枪', '步枪', '卡宾', 'hk416', '自动枪', '枪', '狙击枪', '车载机枪'] },
  { cls: 'autocannon', kws: ['机炮', '机关炮', '自动炮', 'autocannon', 'auto cannon'] },
  { cls: 'indirect-cannon', kws: ['曲射', '间接火炮', '榴弹炮', '迫击炮', '投石机', '抛石机', 'howitzer', 'mortar'] },
  { cls: 'cannon', kws: ['炮', '火炮', '舰炮', '野战炮', '坦克炮'] },
  { cls: 'energy', kws: ['等离子', '激光', '轨道炮', '脉冲', '能量', '光剑', '电浆', '粒子'] },
  { cls: 'magic', kws: ['法杖', '魔杖', '魔杖', '魔法', '法术', '魔杖'] },
  { cls: 'blunt', kws: ['棍', '棒', '锤', '钝器', '钉头锤', '权杖'] },
];

/** 依据 AI 描述的武器名推断分类（未命中返回 undefined）。 */
export function weaponClassFromName(name: string): string | undefined {
  const n = (name ?? '').trim().toLowerCase();
  if (!n) return undefined;
  for (const { cls, kws } of CLASS_KEYWORDS) {
    if (kws.some((k) => n.includes(k.toLowerCase()))) return cls;
  }
  return undefined;
}

/** 取分类的原型（供 generateUnit 用）；未知名回退剑。 */
export function getWeaponClass(id?: string): WeaponClassProfile | undefined {
  return id ? WEAPON_CLASSES[id] : undefined;
}


/** 武器原型注册表：皮肤默认位引用 + 配方 weaponId 显式指定 */
export const WEAPON_LIBRARY: Record<string, WeaponProfile> = {
  // ---- 冷兵器时代（基准 1.0/1.0：数值=曲线，兼容既有生成） ----
  'wpn-sword': { id: 'wpn-sword', name: '长剑', dmgMult: 1, apShare: 1, range: 0 },
  'wpn-bow': { id: 'wpn-bow', name: '长弓', dmgMult: 1, apShare: 1, range: 4, minRange: 1, pointBlankPolicy: 'forbid' },
  'wpn-lance': { id: 'wpn-lance', name: '骑枪', dmgMult: 1, apShare: 1, range: 1 },
  'wpn-horsebow': { id: 'wpn-horsebow', name: '骑弓', dmgMult: 1, apShare: 1, range: 4, minRange: 1, pointBlankPolicy: 'forbid' },
  'wpn-pike': { id: 'wpn-pike', name: '长枪', dmgMult: 1.05, apShare: 1.15, range: 1, desc: '两丈长杆：拒马方阵的骨干，长柄可先敌一步' },
  'wpn-staff': { id: 'wpn-staff', name: '法杖', dmgMult: 0.9, apShare: 1.25, range: 4, minRange: 0, pointBlankPolicy: 'allow', desc: '魔弹威力平平，但部分无视护甲' },

  // ---- 火药时代（火器伤害略高、破甲渐强） ----
  'wpn-saber': { id: 'wpn-saber', name: '马刀', dmgMult: 1, apShare: 1, range: 0 },
  'wpn-musket': { id: 'wpn-musket', name: '燧发枪', dmgMult: 1.5, apShare: 1.05, range: 4, minRange: 0, pointBlankPolicy: 'penalty', pointBlankPenalty: -2, reload: 1, desc: '燧发枪：射后装填一回合' },
  'wpn-matchlock': { id: 'wpn-matchlock', name: '火绳枪', dmgMult: 1.5, apShare: 1.1, range: 4, minRange: 0, pointBlankPolicy: 'penalty', pointBlankPenalty: -2, reload: 1, desc: '缓燃的火绳与铁钎：威力可观，装填漫长（隔回合一发）' },
  'wpn-fieldgun': { id: 'wpn-fieldgun', name: '野战炮', dmgMult: 1.3, apShare: 1.15, range: 5, minRange: 2, pointBlankPolicy: 'forbid', indirect: true, reload: 1, desc: '一发入魂，但装填要一整个回合' },
  'wpn-stonegun': { id: 'wpn-stonegun', name: '射石炮', dmgMult: 1.4, apShare: 1.2, range: 5, minRange: 2, pointBlankPolicy: 'forbid', indirect: true, reload: 1, desc: '轰塌城墙的巨石：比野战炮更重，也更慢' },
  'wpn-carbine': { id: 'wpn-carbine', name: '卡宾枪', dmgMult: 1.05, apShare: 1, range: 4, minRange: 0, pointBlankPolicy: 'penalty', pointBlankPenalty: -1 },

  // ---- 现代战争（自动武器火力密度 + 对轻甲压制） ----
  'wpn-ar': { id: 'wpn-ar', name: '突击步枪', dmgMult: 1.2, apShare: 1.1, range: 4, minRange: 0, pointBlankPolicy: 'penalty', pointBlankPenalty: -2, attacks: 2, desc: '全自动：每回合两段点射' },
  'wpn-mortar': { id: 'wpn-mortar', name: '迫击炮', dmgMult: 1.35, apShare: 1.2, range: 5, minRange: 2, pointBlankPolicy: 'forbid', indirect: true, reload: 1 },
  'wpn-vmg': { id: 'wpn-vmg', name: '车载机枪', dmgMult: 1.25, apShare: 1.1, range: 4, minRange: 0, pointBlankPolicy: 'penalty', pointBlankPenalty: -2, attacks: 2 },
  'wpn-vmc': { id: 'wpn-vmc', name: '车载机炮', dmgMult: 1.4, apShare: 1.15, range: 5, minRange: 0, pointBlankPolicy: 'penalty', pointBlankPenalty: -3, attacks: 3 },
  'wpn-tankgun': { id: 'wpn-tankgun', name: '坦克炮', dmgMult: 1.6, apShare: 1.4, range: 5, minRange: 0, pointBlankPolicy: 'penalty', pointBlankPenalty: -3, reload: 1, desc: '高膛压滑膛炮：可近距离直射，但瞄准困难' },
  'wpn-atgm': { id: 'wpn-atgm', name: '反坦克导弹', dmgMult: 1.6, apShare: 1.5, range: 5, minRange: 1, pointBlankPolicy: 'forbid', reload: 1, desc: '攻顶制导：对重甲单位的头号威胁，装填下一发需要时间' },
  'wpn-entrench': { id: 'wpn-entrench', name: '工兵铲', dmgMult: 1, apShare: 1, range: 0, desc: '近身格斗/枪托砸击：现代远程单位的近战副武器默认位' },

  // ---- 星际战争（能量武器破甲优势显著） ----
  'wpn-plasma': { id: 'wpn-plasma', name: '等离子步枪', dmgMult: 1.25, apShare: 1.15, range: 4, minRange: 0, pointBlankPolicy: 'penalty', pointBlankPenalty: -2, attacks: 2 },
  'wpn-railgun': { id: 'wpn-railgun', name: '轨道炮', dmgMult: 1.6, apShare: 1.3, range: 5, minRange: 0, pointBlankPolicy: 'penalty', pointBlankPenalty: -3, reload: 1, desc: '电磁加速弹丸，充能一回合' },
  'wpn-pulse': { id: 'wpn-pulse', name: '脉冲炮', dmgMult: 1.3, apShare: 1.2, range: 4, minRange: 0, pointBlankPolicy: 'penalty', pointBlankPenalty: -2, reload: 1 },
  'wpn-hoverpulse': { id: 'wpn-hoverpulse', name: '悬浮脉冲炮', dmgMult: 1.3, apShare: 1.2, range: 4, minRange: 0, pointBlankPolicy: 'penalty', pointBlankPenalty: -2, reload: 1 },

  // ---- 体系特化（配方/面板经 weaponId 显式引用） ----
  'wpn-lasgun': { id: 'wpn-lasgun', name: '激光枪', dmgMult: 0.95, apShare: 1, range: 4, minRange: 0, pointBlankPolicy: 'penalty', pointBlankPenalty: -2, attacks: 2, desc: '卫队制式，可靠但威力平平' },
  'wpn-bolter': { id: 'wpn-bolter', name: '爆弹枪', dmgMult: 1.45, apShare: 1.3, range: 4, minRange: 0, pointBlankPolicy: 'penalty', pointBlankPenalty: -2, attacks: 2, desc: '阿斯塔特制式，每一发都是小型炸弹' },
  'wpn-chainsword': { id: 'wpn-chainsword', name: '链锯剑', dmgMult: 1.15, apShare: 1.2, range: 0 },
  'wpn-smartgun': { id: 'wpn-smartgun', name: '智能枪', dmgMult: 1.3, apShare: 1.2, range: 4, minRange: 0, pointBlankPolicy: 'penalty', pointBlankPenalty: -1, attacks: 2, desc: '弹道修正 + 空爆弹' },
  'wpn-monokatana': { id: 'wpn-monokatana', name: '单分子刀', dmgMult: 1.35, apShare: 1.4, range: 0, desc: '切开护甲如切开空气' },
};

export function getWeaponProfile(id?: string): WeaponProfile | undefined {
  return id ? WEAPON_LIBRARY[id] : undefined;
}

/** 2026-09 射程校准：远程分类整体 +1（轻型副武器与爆破保持短距）。
 *  射程是分类的确定性参数而非掷骰结果，旧实例低于当前分类值时补齐到分类射程；
 *  幂等，不重掷任何骰子，近战/长柄（射程带<2）不动。 */
export function calibrateWeaponRange<T extends { customized?: boolean; range?: number; recipe?: { mechanism?: string } }>(weapon: T | undefined): void {
  if (!weapon || weapon.customized) return;
  const mechanism = weapon.recipe?.mechanism;
  const profile = mechanism ? WEAPON_CLASSES[mechanism]?.profile : undefined;
  if (profile && profile.range >= 2 && (weapon.range ?? 0) < profile.range) weapon.range = profile.range;
}

/** 骰子表达式均值（技能蓝图公式共用） */
export function diceAvg(expr: string): number {
  const e = parseDice(expr);
  return e.count * (e.sides + 1) / 2 + e.flat;
}

/** 按目标均值与骰面重建 NdM+K（flat 非负；count 至少 1）；技能蓝图公式共用 */
export function rebuildDice(targetAvg: number, sides: number): string {
  const avgDie = (sides + 1) / 2;
  const count = Math.max(1, Math.floor(targetAvg / avgDie));
  const flat = Math.max(0, Math.round(targetAvg - count * avgDie));
  return `${count}d${sides}${flat > 0 ? `+${flat}` : ''}`;
}

/** 远程武器破甲段渐进系数：L1=25% → L5=100%（L5+ 全额）。
 *  取代旧的「L5 整段解锁」门禁——那会让 L4→L5 伤害翻倍，且 L1~L4 火枪对甲反而不如刀剑。 */
export function rangedApFactor(level: number): number {
  return Math.min(1, 0.25 + (0.75 * Math.max(0, level - 1)) / 4);
}

/** 按均值重建破甲段骰子：低均值换用 d2 骰面（rebuildDice 最低一整粒 d4 会造成底部跳变） */
export function rebuildApDice(apAvg: number, exact?: string): string | undefined {
  if (!Number.isFinite(apAvg) || apAvg <= 0) return undefined;
  if (exact) return exact;
  return rebuildDice(apAvg, apAvg < 2.25 ? 2 : 4);
}

export interface BuildWeaponOpts {
  curve: CurveRow;
  profile: WeaponProfile;
  /** 原型/浮动叠加的固定加值（既有的 archMod.dmgFlat + deltas.dmgFlat） */
  dmgFlat: number;
  /** 射击风格（骑射/远程） */
  ranged: boolean;
  level: number;
  scale: Scale;
}

export interface BuiltWeaponDice {
  baseDice: string;
  apDice?: string;
  range: number;
  /** 速射：每回合攻击结算次数 */
  attacks?: number;
  /** 装填：发射后冷却回合数 */
  reload?: number;
  /** 生成审计：参数与重建结果留档 */
  audit: {
    profileId: string;
    dmgMult: number;
    apShare: number;
    baseAvg: number;
    apAvg: number | null;
  };
}

/** 公式入口：曲线 + 武器原型 + 固定加值 → 骰子表达式（含审计） */
export function buildWeaponDice(opts: BuildWeaponOpts): BuiltWeaponDice {
  const { curve, profile, dmgFlat, ranged, level, scale } = opts;

  // 普通段：mult=1 时走曲线直出（骰型与既有行为完全一致）
  const baseAvgRaw = diceAvg(curve.dmgBase) + dmgFlat;
  const baseAvg = baseAvgRaw * profile.dmgMult;
  const baseDice =
    profile.dmgMult === 1
      ? withFlatLocal(curve.dmgBase, dmgFlat)
      : rebuildDice(baseAvg, parseDice(curve.dmgBase).sides);

  // 破甲段：曲线有就有（L2+）；远程 L5 前按渐进系数缩放（L1=25%…L5=100%）
  const wantAp = scale !== 'mook' && !!curve.dmgAp;
  let apDice: string | undefined;
  let apAvg: number | null = null;
  if (wantAp) {
    const factor = ranged ? rangedApFactor(level) : 1;
    apAvg = diceAvg(curve.dmgAp!) * profile.apShare * factor;
    apDice = rebuildApDice(apAvg, profile.apShare === 1 && factor === 1 ? curve.dmgAp! : undefined);
  }

  return {
    baseDice,
    apDice,
    range: profile.range,
    ...(profile.attacks !== undefined && profile.attacks !== 1 ? { attacks: profile.attacks } : {}),
    ...(profile.reload ? { reload: profile.reload } : {}),
    audit: { profileId: profile.id, dmgMult: profile.dmgMult, apShare: profile.apShare, baseAvg, apAvg },
  };
}
