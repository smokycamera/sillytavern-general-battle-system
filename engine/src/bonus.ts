/**
 * 加成栈（Modifier Stack）：所有加成统一为一个模型，
 * 攻击/防御/伤害/士气结算全部走同一套收集与合成规则，
 * 且全程输出明细（面板悬浮与结算卡共用）。
 */

import type { Combatant, Trait, TraitEffect } from './types.js';
import type { ConditionDef } from './types.js';
import { standardConditionMap } from './conditions.js';
import { defensivePostureMods, looseFormation } from './tactics.js';
import { activeTraitIds, actualTargetTag, traitPrerequisiteReason, traitStatAdjustments, bodyRank, traitSourceActive } from './trait-sources.js';

export type ModSource = 'intrinsic' | 'stance' | 'condition' | 'hero' | 'temp' | 'command';
export type ModKind = 'atk' | 'def' | 'dmg' | 'morale' | 'spd' | 'ward';
export type ModType = 'flat' | 'mult';

/** 条件生效约束：不满足则该修正不参与合成 */
export interface ModCond {
  /** 仅在（被）冲锋时生效 */
  charge?: boolean;
  /** 仅在远程攻击中生效（盾墙类，挂在受击方） */
  ranged?: boolean;
  /** 仅对带此标签的目标生效（克制类） */
  vsTag?: string;
  /** 仅对某刻度目标生效 */
  vsScale?: Combatant['scale'];
}

export interface Modifier {
  sourceId?: string;
  stackGroup?: string;
  source: ModSource;
  /** 明细显示名，如「冲锋」「克制机动」「恐惧」 */
  name: string;
  kind: ModKind;
  type: ModType;
  /** flat：平加值；mult：倍率(如 1.5)；ward：百分比减免 */
  value: number;
  /** 剩余回合（状态类），缺省=持久 */
  duration?: number;
  cond?: ModCond;
}

/** 一次结算中某类加成的合成结果 */
export interface StackResult {
  /** 参与合成的明细（被剔除的不进） */
  lines: StackLine[];
  flatTotal: number;
  multTotal: number;
  hasAdv: boolean;
  hasDis: boolean;
}

export interface StackLine {
  name: string;
  source: ModSource;
  value: number;
  type: ModType;
}

export interface ResolveContext {
  skillDelivery?: 'melee' | 'ranged' | 'magic';
  area?: boolean;
  fieldTags?: string[];
  terrain?: string;
  opponentTerrain?: string;
  distance?: number;
  engaged?: boolean;
  weapon?: import('./types.js').Weapon;
  /** 攻击方 */
  attacker?: Combatant;
  /** 防御方 */
  defender?: Combatant;
  /** 是否冲锋攻击 */
  charge?: boolean;
  /** 是否远程攻击 */
  ranged?: boolean;
  /** 地形等环境修正（由管线组装好传入） */
  stanceMods?: Modifier[];
}

/** 条件是否满足 */
function condMet(cond: ModCond | undefined, ctx: ResolveContext): boolean {
  if (!cond) return true;
  if (cond.charge !== undefined && cond.charge !== !!ctx.charge) return false;
  if (cond.ranged !== undefined && cond.ranged !== !!ctx.ranged) return false;
  if (cond.vsTag !== undefined) {
    const target = ctx.defender;
    if (!target || !actualTargetTag(target, cond.vsTag)) return false;
  }
  if (cond.vsScale !== undefined) {
    const target = ctx.defender;
    if (!target || target.scale !== cond.vsScale) return false;
  }
  return true;
}

/**
 * 合成加成栈：
 * - 同名（source+name）平加值不叠加，取绝对值最高（规则包可关闭）
 * - mult 乘法叠加
 * - 平加值总和按上限截断
 */
export function resolveStack(
  mods: Modifier[],
  kind: ModKind,
  ctx: ResolveContext,
  opts: { sameNameKeepsHighest?: boolean; maxFlat?: number } = {},
): StackResult {
  const { sameNameKeepsHighest = true, maxFlat = 30 } = opts;
  const active = mods.filter((m) => m.kind === kind && condMet(m.cond, ctx));

  // 平加值：同名去重
  const flats = active.filter((m) => m.type === 'flat');
  const byName = new Map<string, Modifier>();
  for (const m of flats) {
    const key = m.stackGroup ?? m.sourceId ?? `${m.source}::${m.name}`;
    const prev = byName.get(key);
    if (!prev) byName.set(key, m);
    else if (!sameNameKeepsHighest) byName.set(key, { ...m, value: prev.value + m.value });
    else if (Math.abs(m.value) > Math.abs(prev.value)) byName.set(key, m);
  }

  let flatTotal = [...byName.values()].reduce((s, m) => s + m.value, 0);
  flatTotal = Math.max(-maxFlat, Math.min(maxFlat, flatTotal));

  const grouped = new Map<string, Modifier>();
  const mults = active.filter((m) => m.type === 'mult' && !m.stackGroup && !m.sourceId);
  for (const m of active.filter((m) => m.type === 'mult' && (m.stackGroup || m.sourceId))) {
    const key = m.stackGroup ?? m.sourceId!; const previous = grouped.get(key);
    if (!previous || Math.abs(m.value - 1) > Math.abs(previous.value - 1)) grouped.set(key, m);
  }
  mults.push(...grouped.values());
  let multTotal = mults.reduce((s, m) => s * m.value, 1);

  const lines: StackLine[] = [
    ...[...byName.values()].map((m) => ({ name: m.name, source: m.source, value: m.value, type: 'flat' as const })),
    ...mults.map((m) => ({ name: m.name, source: m.source, value: m.value, type: 'mult' as const })),
  ];

  return { lines, flatTotal, multTotal, hasAdv: false, hasDis: false };
}

/** 把栈结果写成明细行文本（结算卡与审计用） */
export function describeStack(r: StackResult): string {
  const parts = r.lines
    .filter((l) => l.type === 'flat' ? l.value !== 0 : l.value !== 1)
    .map((l) => (l.type === 'flat' ? `${l.name} ${l.value > 0 ? '+' : ''}${l.value}` : `${l.name} ×${l.value}`));
  return parts.join('，');
}

// ---------- 从特质与状态收集修正 ----------

const TRAIT_REGISTRY_DEFAULT = new Map<string, Trait>();
const SOURCE_CONDITIONS = standardConditionMap();

export function setTraitRegistry(traits: Trait[]) {
  TRAIT_REGISTRY_DEFAULT.clear();
  for (const t of traits) TRAIT_REGISTRY_DEFAULT.set(t.id, t);
}

export function getTrait(id: string, registry?: Map<string, Trait>): Trait | undefined {
  return (registry ?? TRAIT_REGISTRY_DEFAULT).get(id);
}

/** 单位是否带有某行为旗标特质（如 mounted-archer 骑射） */
export function hasFlag(unit: Combatant, flag: string, registry?: Map<string, Trait>): boolean {
  for (const id of activeTraitIds(unit)) {
    if (unit.rulesVersion === 'v2' && traitPrerequisiteReason(unit, id)) continue;
    const t = getTrait(id, registry);
    for (const e of t?.effects ?? []) {
      if (e.kind === 'flag' && e.flag === flag) return true;
    }
  }
  return false;
}

/** 特质效果 → 运行时修正（仅 atk/def/dmg/morale/spd/ward 类；stat 类在派生阶段消费） */
export function traitRuntimeMods(traitIds: string[], registry?: Map<string, Trait>, unit?: Combatant, context: ResolveContext = {}): Modifier[] {
  const out: Modifier[] = [];
  for (const id of unit ? activeTraitIds(unit) : [...new Set(traitIds)]) {
    if (unit?.rulesVersion === 'v2' && ['large', 'titan', 'flying', 'shield-wall', 'pike-wall', 'fortification'].includes(id)) continue;
    const t = getTrait(id, registry);
    if (!t) continue;
    if (unit && traitPrerequisiteReason(unit, id, context)) continue;
    if (unit?.rulesVersion === 'v2' && id === 'loose-formation') {
      if (looseFormation(unit)) {
        if (context.area && !context.engaged) out.push({ source: 'intrinsic', sourceId: 'loose:area', name: '疏散减轻范围暴露', kind: 'ward', type: 'mult', value: 0.5 });
        if (!context.ranged && (context.distance ?? 0) <= 1) out.push({ source: 'intrinsic', sourceId: 'loose:melee', name: '疏散近战薄弱', kind: 'def', type: 'flat', value: -1 });
      }
      continue;
    }
    if (unit?.rulesVersion === 'v2' && id === 'trample') {
      if (context.charge && !context.ranged && context.defender && bodyRank(unit) > bodyRank(context.defender)) out.push({ source: 'intrinsic', sourceId: 'trample:impact', name: t.name, kind: 'dmg', type: 'mult', value: 1.25 });
      continue;
    }
    for (const [index, e] of t.effects.entries()) {
      if (unit?.rulesVersion === 'v2') {
        if (e.kind === 'stat') continue;
        if (id === 'skirmisher' && e.kind === 'rangedGuardDR' && (context.engaged || (context.distance ?? 0) <= 1)) continue;
        if (id === 'shield-wall' && !unit.shield) continue;
        if (id === 'pike-wall' && unit.weapon?.recipe?.mechanism !== 'spear') continue;
        if (e.kind === 'attackStyle') {
          if (context.skillDelivery === 'magic') continue;
          if (e.atk) out.push({ source: 'intrinsic', sourceId: `${id}:${index}:atk`, name: t.name, kind: 'atk', type: 'flat', value: e.atk, cond: { ranged: e.style === 'ranged' } });
          if (e.dmgMult) out.push({ source: 'intrinsic', sourceId: `${id}:${index}:dmg`, name: t.name, kind: 'dmg', type: 'mult', value: e.dmgMult, cond: { ranged: e.style === 'ranged' } });
          continue;
        }
      }
      const m = traitEffectToMod(e, t.name);
      if (m && unit?.rulesVersion === 'v2') {
        m.sourceId = `${id}:${index}`;
        if (id === 'guardian' || id === 'guardian-greater') m.stackGroup = 'guardian:' + m.kind;
        if (id === 'anti-large' || id === 'monster-hunter') m.stackGroup = 'counter-large:' + m.kind;
      }
      if (m) out.push(m);
    }
  }
  if (unit?.rulesVersion === 'v2') for (const [kind, value] of Object.entries(traitStatAdjustments(unit, registry))) {
    out.push({ source: 'intrinsic', sourceId: 'trait-current:' + kind, name: '当前特质与原基础的净修正', kind: kind as ModKind, type: 'flat', value });
  }
  return out;
}

function traitEffectToMod(e: TraitEffect, traitName: string): Modifier | undefined {
  switch (e.kind) {
    case 'stat':
      if (e.stat === 'morale') return { source: 'intrinsic', name: traitName, kind: 'morale', type: 'flat', value: e.value };
      if (e.stat === 'atk' || e.stat === 'def' || e.stat === 'spd')
        return { source: 'intrinsic', name: traitName, kind: e.stat, type: 'flat', value: e.value };
      return undefined; // hpMax 在派生阶段消费
    case 'ward':
      return { source: 'intrinsic', name: traitName, kind: 'ward', type: 'mult', value: 1 - e.percent / 100 };
    case 'conditionalAtk':
      return {
        source: 'intrinsic',
        name: traitName,
        kind: 'atk',
        type: 'flat',
        value: e.value,
        cond: { vsTag: e.vsTag },
      };
    case 'conditionalDmgMult':
      return {
        source: 'intrinsic',
        name: traitName,
        kind: 'dmg',
        type: 'mult',
        value: e.mult,
        cond: { vsTag: e.vsTag },
      };
    case 'chargeBonus':
      return { source: 'intrinsic', name: traitName, kind: 'atk', type: 'flat', value: e.value, cond: { charge: true } };
    case 'attackStyle':
      // 近战特化：仅非射击攻击；射击专家：仅射击攻击（cond.ranged 的真假两用）
      if (e.atk) {
        return { source: 'intrinsic', name: traitName, kind: 'atk', type: 'flat', value: e.atk, cond: { ranged: e.style === 'ranged' } };
      }
      if (e.dmgMult) {
        return { source: 'intrinsic', name: traitName, kind: 'dmg', type: 'mult', value: e.dmgMult, cond: { ranged: e.style === 'ranged' } };
      }
      return undefined;
    case 'counterChargeDR':
      return { source: 'intrinsic', name: traitName, kind: 'ward', type: 'mult', value: 1 - e.percent / 100, cond: { charge: true } };
    case 'rangedGuardDR':
      return { source: 'intrinsic', name: traitName, kind: 'ward', type: 'mult', value: 1 - e.percent / 100, cond: { ranged: true } };
    default:
      return undefined;
  }
}

/** 激活状态 → 修正 */
function conditionStackGroup(mod: Modifier): string {
  if (mod.stackGroup) return mod.stackGroup;
  if (mod.kind === 'ward') return mod.value <= 1 ? 'guardian:ward' : 'vulnerability:ward';
  // 普通状态在同一属性、同一方向取强；正负组分别保留，再合成。
  return `condition:${mod.kind}:${mod.type}:${mod.value >= (mod.type === 'mult' ? 1 : 0) ? 'positive' : 'negative'}`;
}
export function conditionMods(
  conds: Combatant['conditions'],
  conditionDefs: Map<string, ConditionDef>,
  unit?: Combatant,
  registry?: Map<string, Trait>,
): Modifier[] {
  const out: Modifier[] = [];
  for (const c of conds) {
    if (unit?.rulesVersion === 'v2' && c.dur <= 0) continue;
    if (unit?.rulesVersion === 'v2' && c.id === 'fearful' && activeTraitIds(unit).some((id) => getTrait(id, registry)?.effects.some((e) => e.kind === 'immuneMorale'))) continue;
    if (unit?.rulesVersion === 'v2' && c.id === 'poisoned' && unit.body === 'vehicle') continue;
    const def = conditionDefs.get(c.id);
    if (!def?.mods) continue;
    for (const [index, m] of def.mods.entries()) out.push({ ...m, duration: c.dur,
      ...(unit?.rulesVersion === 'v2' && c.potency !== undefined && m.type === 'flat' && ['inspired', 'encouraged'].includes(c.id) ? { value: Math.sign(m.value) * Math.max(1, Math.min(3, c.potency)) } : {}),
      ...(unit?.rulesVersion === 'v2' && c.magnitude !== undefined ? { value: m.type === 'mult' ? 1 + (m.value - 1) * c.magnitude : m.value * c.magnitude } : {}),
      ...(unit?.rulesVersion === 'v2' ? { sourceId: `condition:${c.id}:${index}`, stackGroup: conditionStackGroup(m) } : {}) });
  }
  return out;
}

/** 收集一个单位在某上下文下的全部修正（特质+状态+外部注入） */
export function collectMods(
  unit: Combatant,
  ctx: ResolveContext,
  conditionDefs: Map<string, ConditionDef>,
  extra: Modifier[] = [],
  registry?: Map<string, Trait>,
): Modifier[] {
  const equipment: Modifier[] = [];
  if (unit.rulesVersion === 'v2') {
    const traits = activeTraitIds(unit);
    if (ctx.fieldTags?.includes('night') && !traits.includes('night-fighter')) equipment.push({ source: 'stance', sourceId: 'environment:night', name: '夜间行动', kind: 'atk', type: 'flat', value: -2 });
    if (ctx.terrain === 'forest' && !traits.includes('forest-lore') || ctx.terrain === 'hill' && !traits.includes('mountain-born')) equipment.push({ source: 'stance', sourceId: 'environment:ground', name: '困难地形', kind: 'atk', type: 'flat', value: -1 });
    if (ctx.ranged && (ctx.distance ?? 0) > 1 && ctx.terrain === 'forest') equipment.push({ source: 'stance', sourceId: 'environment:forest-cover', name: '林木掩护', kind: 'def', type: 'flat', value: 2 });
    if (ctx.terrain === 'hill' && ctx.opponentTerrain !== 'hill') equipment.push({ source: 'stance', sourceId: 'environment:high-ground', name: '高地', kind: 'def', type: 'flat', value: 1 });
    equipment.push(...fieldModsFor(unit, ctx.fieldTags ?? [], registry));
  }
  if (unit.rulesVersion === 'v2' && unit.fatigue >= 2) equipment.push({ source: 'condition', sourceId: 'fatigue:atk', name: '持续作战疲劳', kind: 'atk', type: 'flat', value: -Math.floor(unit.fatigue / 2) });
  const sourceConditions: Modifier[] = [];
  if (unit.rulesVersion === 'v2') for (const source of unit.traitSources ?? []) {
    if (!traitSourceActive(unit, source)) continue;
    for (const id of (source.conditionIds ?? []).filter((id) => id !== 'fearful' || !activeTraitIds(unit).some((trait) => getTrait(trait, registry)?.effects.some((e) => e.kind === 'immuneMorale')))) for (const [index, mod] of ((conditionDefs.get(id) ?? SOURCE_CONDITIONS.get(id))?.mods ?? []).entries()) {
      sourceConditions.push({ ...mod, sourceId: `${source.id}:${id}:${index}`, stackGroup: conditionStackGroup(mod),
        name: `${mod.name}（${source.name}）`, duration: source.duration.kind === 'rounds' ? source.remaining : undefined });
    }
  }
  const quality = unit.rulesVersion === 'v2' && unit.armor?.tier ? unit.armor.recipe?.quality ?? 3 : 3;
  const fit = quality === 1 ? -1 : quality === 5 ? 1 : 0;
  if (fit) equipment.push({ source: 'intrinsic', sourceId: unit.armor!.id + ':quality', name: '护甲品质·防护可靠性', kind: 'def', type: 'flat', value: fit });
  return [...traitRuntimeMods(unit.traits, registry, unit, ctx), ...equipment, ...conditionMods(unit.conditions, conditionDefs, unit, registry), ...sourceConditions, ...defensivePostureMods(unit, ctx, conditionDefs, registry), ...extra];
}

/** 收集单位在特定战场环境下的修正（fieldMod 特质 → 攻/防/士气），供战斗层注入 */
export function fieldModsFor(unit: Combatant, fieldTags: string[], registry?: Map<string, Trait>): Modifier[] {
  const out: Modifier[] = [];
  for (const id of activeTraitIds(unit)) {
    const t = getTrait(id, registry);
    if (!t) continue;
    if (unit.rulesVersion === 'v2' && id === 'fortification') continue;
    if (unit.rulesVersion === 'v2' && id === 'plains-runner' && fieldTags.includes('plains')) out.push({ source: 'stance', sourceId: 'plains-runner:spd', name: t.name, kind: 'spd', type: 'flat', value: 2 });
    for (const e of t.effects) {
      if (e.kind !== 'fieldMod' || !fieldTags.includes(e.field)) continue;
      for (const kind of ['atk', 'def', 'morale'] as const) if (e[kind]) out.push({ source: 'stance',
        name: unit.rulesVersion === 'v2' ? t.name : `${t.name}·${e.field}`,
        ...(unit.rulesVersion === 'v2' ? { sourceId: `field:${id}:${kind}` } : {}), kind, type: 'flat', value: e[kind]! });
    }
  }
  return out;
}
