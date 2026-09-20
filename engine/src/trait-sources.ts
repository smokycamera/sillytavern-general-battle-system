import { physicalTraitIds } from './body.js';
/** 特质知识与外部授予分离；持续期/来源身份属于引擎，不交给正文重写。 */
import type { Combatant, Trait, Weapon } from './types.js';
import { traitRegistry } from './data/traits.js';
import { standardConditionMap } from './conditions.js';

export type TraitDuration = { kind: 'permanent' } | { kind: 'rounds' | 'battles'; count: number };
export interface TraitSourceInput {
  battleOnly?: boolean;
  id: string; name: string; kind: 'blessing' | 'equipment' | 'effect'; traitIds: string[];
  conditionIds?: string[];
  duration: TraitDuration; equipmentId?: string;
}
export interface TraitSource extends TraitSourceInput { remaining?: number; revoked?: boolean }
function signature(source: TraitSourceInput): string {
  return JSON.stringify([source.kind, source.name, [...new Set(source.traitIds)].sort(), [...new Set(source.conditionIds ?? [])].sort(), source.duration.kind, source.duration.kind === 'permanent' ? undefined : source.duration.count, source.equipmentId, source.battleOnly]);
}
export function validateTraitSource(source: TraitSource, registry = traitRegistry()): void {
  if (source?.battleOnly !== undefined && typeof source.battleOnly !== 'boolean') throw new Error('技能临时来源标记损坏');
  if (!source || typeof source.id !== 'string' || !source.id || typeof source.name !== 'string' || !source.name
    || !['blessing', 'equipment', 'effect'].includes(source.kind) || !Array.isArray(source.traitIds)
    || new Set(source.traitIds).size !== source.traitIds.length || source.traitIds.some((id) => !registry.has(id))) throw new Error('特质来源身份或内容损坏');
  const conditions = standardConditionMap(), ids = source.conditionIds ?? [];
  if (!Array.isArray(ids) || new Set(ids).size !== ids.length || ids.some((id) => !conditions.get(id)?.v2SourceReady)
    || source.traitIds.length + ids.length === 0 || source.kind === 'blessing' && ids.length > 0 || source.kind === 'effect' && source.traitIds.length > 0) throw new Error('效果来源为空或包含未贯通的状态');
  if (!source.duration || !['permanent', 'rounds', 'battles'].includes(source.duration.kind)) throw new Error('特质来源期限未知');
  if (source.revoked !== undefined && typeof source.revoked !== 'boolean' || source.duration.kind === 'permanent' && source.remaining !== undefined) throw new Error('特质来源生命周期字段损坏');
  if (source.duration.kind !== 'permanent' && (!Number.isSafeInteger(source.duration.count) || source.duration.count < 1 || source.duration.count > 99
    || !Number.isSafeInteger(source.remaining) || source.remaining! < 0 || source.remaining! > source.duration.count)) throw new Error('特质来源剩余期限损坏');
  if (source.kind === 'equipment' && !source.equipmentId) throw new Error('装备授予缺少实物身份');
  if (source.traitIds.some((id) => ['large', 'titan'].includes(id))) throw new Error('身体特质由明确体型自动生效，不能用祝福凭空改变身体与生命');
  if (source.traitIds.some((id) => !registry.get(id)?.v2SourceReady)) throw new Error('该特质的外部来源执行链尚未完成，不能只授予名字');
  if (source.traitIds.some((id) => id !== 'elite' && registry.get(id)?.effects.some((e) => e.kind === 'stat' && e.stat === 'hpMax'))) throw new Error('体量/生命上限特质需要明确身体与上限事务，不能用临时来源暗改上限');
}
export function grantTraitSource(unit: Combatant, input: TraitSourceInput, registry = traitRegistry()): void {
  if (unit.rulesVersion !== 'v2') throw new Error('特质来源需要先转制为V2');
  const source: TraitSource = { ...structuredClone(input), traitIds: [...new Set(input.traitIds)],
    ...(input.conditionIds ? { conditionIds: [...new Set(input.conditionIds)] } : {}),
    ...(input.duration.kind !== 'permanent' ? { remaining: input.duration.count } : {}) };
  validateTraitSource(source, registry);
  const existing = unit.traitSources?.find((s) => s.id === source.id);
  if (existing) {
    if (signature(existing) !== signature(source)) throw new Error('同一特质来源对应不同内容');
    return; // 已到期/被撤销的原消息也不能续期。
  }
  (unit.traitSources ??= []).push(source);
}
export function revokeTraitSource(unit: Combatant, sourceId: string): void {
  const source = unit.traitSources?.find((s) => s.id === sourceId);
  if (!source) throw new Error('特质来源不存在'); source.revoked = true;
}
export function expireTraitSources(unit: Combatant, boundary: 'rounds' | 'battles'): void {
  for (const source of unit.traitSources ?? []) if (!source.revoked && source.duration.kind === boundary && source.remaining! > 0) source.remaining!--;
  if (boundary === 'battles') for (const source of unit.traitSources ?? []) if (source.battleOnly) source.revoked = true;
}
export function traitSourceActive(unit: Combatant, source: TraitSource): boolean {
  if (source.revoked || source.duration.kind !== 'permanent' && !(source.remaining! > 0)) return false;
  return source.kind !== 'equipment' || [unit.weapon?.id, unit.sidearm?.id, unit.armor?.id, unit.shield?.id, ...(unit.trinkets ?? []).map((t) => t.id)].includes(source.equipmentId);
}
/** 构型而非物品名称决定重装性质；只派生当前装备，不写入永久特质或外部来源。 */
export function armorTraitId(tier?: number): string | undefined {
  return tier === 4 ? 'super-heavy' : tier === 3 ? 'heavy-armor' : undefined;
}
export function equipmentTraitIds(unit: Pick<Combatant, 'rulesVersion' | 'armor'>): string[] {
  const id = unit.rulesVersion === 'v2' ? armorTraitId(unit.armor?.tier) : undefined;
  return id ? [id] : [];
}
export function activeTraitIds(unit: Combatant): string[] {
  return [...new Set([...unit.traits, ...physicalTraitIds(unit), ...equipmentTraitIds(unit), ...(unit.rulesVersion === 'v2' ? unit.traitSources?.filter((s) => traitSourceActive(unit, s)).flatMap((s) => s.traitIds) ?? [] : [])])];
}
export function activeConditionIds(unit: Combatant): string[] {
  return [...new Set([...unit.conditions.filter((c) => c.dur > 0).map((c) => c.id),
    ...(unit.rulesVersion === 'v2' ? unit.traitSources?.filter((s) => traitSourceActive(unit, s)).flatMap((s) => s.conditionIds ?? []) ?? [] : [])])];
}
export function actualTargetTag(unit: Combatant, tag: string): boolean {
  if (unit.rulesVersion !== 'v2') return unit.tags.includes(tag);
  if (tag === 'large') return unit.mount === true || ['large', 'giant', 'vehicle'].includes(unit.body ?? 'human');
  if (tag === 'mounted') return unit.mount === true;
  if (tag === 'titan') return unit.body === 'giant';
  if (tag === 'infantry') return (unit.body ?? 'human') === 'human' && !unit.mount && !unit.airborne;
  if (tag === 'mobile') return unit.mount === true || unit.body === 'vehicle' || unit.archetype === 'mobile';
  if (['ranged', 'caster', 'brute'].includes(tag)) return unit.archetype === tag;
  if (tag === 'mook') return false;
  if (tag === 'company') return unit.scale !== 'hero';
  if (tag === 'hero') return unit.scale === 'hero';
  return unit.tags.includes(tag);
}
export interface TraitContext { weapon?: Weapon; ranged?: boolean }
export function bodyRank(unit: Pick<Combatant, 'body' | 'mount'>): number { return Math.max(unit.mount ? 2 : 1, { human: 1, large: 2, vehicle: 3, giant: 4 }[unit.body ?? 'human']); }
/** 这里是机械前提，未实现的空间特质不能靠此函数伪称完成。 */
export function traitPrerequisiteReason(unit: Combatant, id: string, context: TraitContext = {}): string | undefined {
  if (unit.rulesVersion !== 'v2') return undefined;
  const weapon = context.weapon ?? unit.weapon;
  if (id === 'loose-formation' && (unit.scale === 'hero' || !['human', 'large'].includes(unit.body ?? 'human') || unit.mount || unit.airborne || (unit.armor?.tier ?? 0) > 2)) return '疏散需要轻中装地面多人编队，骑乘、重型平台或单个个体不能展开';
  if (id === 'large' && !['large', 'giant'].includes(unit.body ?? 'human')) return '大型特质由实际大型或巨型身体提供';
  if (id === 'titan' && unit.body !== 'giant') return '泰坦特质需要实际巨型身体';
  if (id === 'heavy-armor' && (unit.armor?.tier ?? 0) < 3) return '需要实际重甲或超重甲';
  if (id === 'super-heavy' && unit.armor?.tier !== 4) return '需要实际超重甲';
  if (id === 'mounted-archer' && unit.mount !== true) return '需要明确坐骑，骑射不适用于装甲车辆';
  if (id === 'mounted-archer' && ![unit.weapon, unit.sidearm].some((w) => w?.tags?.includes('ranged') && (w.load ?? 99) <= 2 && !w.reload)) return '需要适于移动投射的实际轻便武器';
  if (id === 'mechanized' && unit.body !== 'vehicle') return '需要明确载具平台';
  if (id === 'skirmisher' && (!['human', 'large'].includes(unit.body ?? 'human') || (unit.armor?.tier ?? 0) > 2)) return '游击需要轻装或中装的人形/大型身体';
  if (id === 'anti-mobile' && (weapon?.recipe?.mechanism !== 'spear' || context.ranged)) return '需要实际长柄近战武器';
  if (id === 'armor-piercing-shot' && (!context.ranged || !weapon?.tags?.includes('ranged') || weapon.channel !== 'kinetic')) return '需要真实动能投射动作';
  if (['ap-weapon', 'ap-master'].includes(id) && (!weapon || weapon.channel !== 'kinetic')) return '需要可利用弱点的动能武器';
  if (id === 'shield-wall' && !unit.shield) return '需要实际盾牌';
  if (id === 'pike-wall' && weapon?.recipe?.mechanism !== 'spear') return '需要实际长柄反冲锋武器';
  return undefined;
}
export function traitPenetrationBonus(unit: Combatant, weapon: Weapon | undefined, ranged: boolean, base: number): number {
  if (unit.rulesVersion !== 'v2' || !weapon || weapon.channel !== 'kinetic') return 0;
  const ids = activeTraitIds(unit).filter((id) => !traitPrerequisiteReason(unit, id, { weapon, ranged }));
  const rank = ids.includes('ap-master') ? 2 : ids.includes('ap-weapon') || ids.includes('armor-piercing-shot') ? 1 : 0;
  return Math.min(rank, Math.max(0, Math.floor(base / 3)));
}
export function traitDescription(trait: Trait, unit?: Pick<Combatant, 'rulesVersion'>): string {
  return unit?.rulesVersion === 'v2' ? trait.v2Desc ?? trait.desc : trait.desc;
}

type TraitStats = NonNullable<Combatant['bakedTraitStats']>;
export function traitStatContributions(unit: Combatant, ids: string[], registry = traitRegistry(), respectPrerequisites = true): TraitStats {
  const result: TraitStats = {}, armorSpeed: number[] = [];
  for (const id of new Set(ids)) {
    if (['large', 'titan', 'flying'].includes(id) || respectPrerequisites && traitPrerequisiteReason(unit, id)) continue;
    if (respectPrerequisites && id === 'mechanized' && (unit.armor?.tier ?? 0) > 0) result.def = (result.def ?? 0) + 1;
    for (const effect of registry.get(id)?.effects ?? []) {
      if (effect.kind !== 'stat' || effect.stat === 'hpMax' || effect.stat === 'morale' && unit.scale === 'hero') continue;
      if (respectPrerequisites && effect.stat === 'spd' && ['heavy-armor', 'super-heavy'].includes(id)) { armorSpeed.push(effect.value); continue; }
      result[effect.stat] = (result[effect.stat] ?? 0) + effect.value;
    }
  }
  if (armorSpeed.length) result.spd = (result.spd ?? 0) + Math.min(...armorSpeed);
  return result;
}
/** 旧v2.1/v2.2的永久属性曾在生成时烘焙；只读取旧审计，不重掷其装备/基础值。 */
export function bakedTraitStats(unit: Combatant, registry = traitRegistry()): TraitStats {
  return structuredClone(unit.bakedTraitStats ?? traitStatContributions(unit, unit.genAudit?.input.traits ?? [], registry, false));
}
export function traitStatAdjustments(unit: Combatant, registry = traitRegistry()): TraitStats {
  if (unit.rulesVersion !== 'v2') return {};
  const baked = bakedTraitStats(unit, registry), current = traitStatContributions(unit, activeTraitIds(unit), registry), result: TraitStats = {};
  for (const key of ['atk', 'def', 'spd', 'morale'] as const) if ((current[key] ?? 0) !== (baked[key] ?? 0)) result[key] = (current[key] ?? 0) - (baked[key] ?? 0);
  return result;
}
/** 新生成/升级时把永久合法效果计入一次；临时授予始终留在运行时。 */
export function normalizeBakedTraitStats(unit: Combatant, registry = traitRegistry()): void {
  const old = bakedTraitStats(unit, registry), current = traitStatContributions(unit, unit.traits, registry);
  for (const key of ['atk', 'def', 'spd'] as const) unit.base[key] += (current[key] ?? 0) - (old[key] ?? 0);
  if (unit.base.moraleMax !== undefined) { unit.base.moraleMax += (current.morale ?? 0) - (old.morale ?? 0); unit.morale = Math.min(unit.morale ?? unit.base.moraleMax, unit.base.moraleMax); }
  unit.bakedTraitStats = current;
}
