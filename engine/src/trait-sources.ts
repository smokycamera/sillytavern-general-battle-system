import { revisedLoad } from './load-model.js';
import { shieldGuardUsable } from './arms.js';
import { progression } from './progression.js';
import { physicalTraitIds, armorBurdenTier, hasNaturalArmor } from './body.js';
import { traitsV13 } from './trait-model.js';
/** 特质知识与外部授予分离；持续期/来源身份属于引擎，不交给正文重写。 */
import type { Combatant, Trait, Weapon } from './types.js';
import { traitRegistry, validateTraitLevels, isGradedTrait } from './data/traits.js';
import { standardConditionMap } from './conditions.js';
import { canonicalTraitId, sourceTraitLevel, traitParameter } from './trait-parameters.js';
import { gradedTraitEnabled, traitLevelsV16, phase2Traits } from './trait-level-model.js';
import { baseMechanism } from './data/weapons.js';

export type TraitDuration = { kind: 'permanent' } | { kind: 'rounds' | 'battles'; count: number };
export interface TraitSourceInput {
  battleOnly?: boolean;
  id: string; name: string; kind: 'blessing' | 'equipment' | 'effect'; traitIds: string[];
  conditionIds?: string[];
  duration: TraitDuration; equipmentId?: string;
  /** 已完成分级特质的等级（L1–10）；新V16输入默认L1，历史记录省略仍L5。 */
  traitLevels?: Record<string, number>;
}
export interface TraitSource extends TraitSourceInput { remaining?: number; revoked?: boolean }
function signature(source: TraitSourceInput): string {
  return JSON.stringify([source.kind, source.name, [...new Set(source.traitIds)].sort(), [...new Set(source.conditionIds ?? [])].sort(), source.duration.kind, source.duration.kind === 'permanent' ? undefined : source.duration.count, source.equipmentId, source.battleOnly,
    ...(source.traitLevels && Object.keys(source.traitLevels).length ? [Object.entries(source.traitLevels).sort(([a], [b]) => a.localeCompare(b))] : [])]);
}
export function validateTraitSource(source: TraitSource, registry = traitRegistry()): void {
  if (source?.battleOnly !== undefined && typeof source.battleOnly !== 'boolean') throw new Error('技能临时来源标记损坏');
  if (!source || typeof source.id !== 'string' || !source.id || typeof source.name !== 'string' || !source.name
    || !['blessing', 'equipment', 'effect'].includes(source.kind) || !Array.isArray(source.traitIds)
    || new Set(source.traitIds).size !== source.traitIds.length || source.traitIds.some((id) => !registry.has(id))) throw new Error('特质来源身份或内容损坏');
  const conditions = standardConditionMap(), ids = source.conditionIds ?? [];
  if (!Array.isArray(ids) || new Set(ids).size !== ids.length || ids.some((id) => !conditions.get(id)?.v2SourceReady)
    || source.traitIds.length + ids.length === 0 || source.kind === 'blessing' && ids.length > 0 || source.kind === 'effect' && source.traitIds.length > 0) throw new Error('效果来源为空或包含未完成的状态');
  if (!source.duration || !['permanent', 'rounds', 'battles'].includes(source.duration.kind)) throw new Error('特质来源期限未知');
  if (source.revoked !== undefined && typeof source.revoked !== 'boolean' || source.duration.kind === 'permanent' && source.remaining !== undefined) throw new Error('特质来源生命周期字段损坏');
  if (source.duration.kind !== 'permanent' && (!Number.isSafeInteger(source.duration.count) || source.duration.count < 1 || source.duration.count > 99
    || !Number.isSafeInteger(source.remaining) || source.remaining! < 0 || source.remaining! > source.duration.count)) throw new Error('特质来源剩余期限损坏');
  if (source.kind === 'equipment' && !source.equipmentId) throw new Error('装备授予缺少物品编号');
  validateTraitLevels(source.traitLevels);
  if (Object.keys(source.traitLevels ?? {}).some((id) => !source.traitIds.includes(id))) throw new Error('特质等级只能对应该来源授予的特质');
  if (source.traitIds.some((id) => ['large', 'titan'].includes(id))) throw new Error('身体特质由明确体型自动生效，不能用祝福凭空改变身体与生命');
  if (source.traitIds.some((id) => !registry.get(id)?.v2SourceReady)) throw new Error('该特质的外部来源处理过程尚未完成，不能只授予名字');
  if (source.traitIds.some((id) => id !== 'elite' && registry.get(id)?.effects.some((e) => e.kind === 'stat' && e.stat === 'hpMax'))) throw new Error('体量/生命上限特质需要明确身体与上限事务，不能用临时来源暗改上限');
}
export function grantTraitSource(unit: Combatant, input: TraitSourceInput, registry = traitRegistry()): void {
  if (unit.rulesVersion !== 'v2') throw new Error('请先更新单位规则，再添加特质来源');
  const existing = unit.traitSources?.find((s) => s.id === input.id);
  // 新V16来源省略等级为L1。已有来源重放保留其历史缺省编码，不能把旧L5解释成新L1。
  const levels = { ...input.traitLevels };
  if (traitLevelsV16(unit)) for (const id of input.traitIds) if (isGradedTrait(id) && levels[id] === undefined && !(existing && existing.traitLevels?.[id] === undefined)) levels[id] = 1;
  const source: TraitSource = { ...structuredClone(input), traitIds: [...new Set(input.traitIds)],
    ...(Object.keys(levels).length ? { traitLevels: levels } : {}),
    ...(input.conditionIds ? { conditionIds: [...new Set(input.conditionIds)] } : {}),
    ...(input.duration.kind !== 'permanent' ? { remaining: input.duration.count } : {}) };
  validateTraitSource(source, registry);
  if (existing) {
    if (signature(existing) !== signature(source)) throw new Error('同一特质来源对应不同内容');
    return; // 已到期/被撤销的原消息也不能续期。
  }
  (unit.traitSources ??= []).push(source);
}
export function revokeTraitSource(unit: Combatant, sourceId: string): void {
  const source = unit.traitSources?.find((s) => s.id === sourceId);
  if (!source) throw new Error('特质来源不存在'); source.revoked = true;
  if (phase2Traits(unit) && !activeTraitIds(unit).includes('regen')) unit.regenerationRemainder = 0;
}
export function expireTraitSources(unit: Combatant, boundary: 'rounds' | 'battles'): void {
  for (const source of unit.traitSources ?? []) if (!source.revoked && source.duration.kind === boundary && source.remaining! > 0) source.remaining!--;
  if (boundary === 'battles') for (const source of unit.traitSources ?? []) if (source.battleOnly) source.revoked = true;
  if (phase2Traits(unit) && (boundary === 'battles' || !activeTraitIds(unit).includes('regen'))) unit.regenerationRemainder = 0;
  if (phase2Traits(unit) && !activeTraitIds(unit).includes('regen')) unit.regenerationRemainder = 0;
}
export function traitSourceActive(unit: Combatant, source: TraitSource): boolean {
  if (source.revoked || source.duration.kind !== 'permanent' && !(source.remaining! > 0)) return false;
  return source.kind !== 'equipment' || [unit.weapon?.id, unit.sidearm?.id, unit.armor?.id, unit.shield?.id, ...(unit.gear ?? []).map((item) => item.id)].includes(source.equipmentId);
}
/** 构型而非物品名称决定重装性质；只派生当前装备，不写入永久特质或外部来源。 */
export function armorTraitId(tier?: number): string | undefined {
  return tier === 4 ? 'super-heavy' : tier === 3 ? 'heavy-armor' : undefined;
}
/** V13：主武器是步枪、单发重步枪或能量武器的轻中装地面人形编队，按散兵线作战。 */
const DISPERSED_ARMS = ['rifle', 'heavy-rifle', 'energy'];
export function autoLooseFormation(unit: Pick<Combatant, 'rulesVersion' | 'armor' | 'scale' | 'body' | 'mount' | 'weapon'> & Partial<Pick<Combatant, 'traitModel' | 'traits' | 'traitSources'>>): boolean {
  return unit.rulesVersion === 'v2' && traitsV13(unit) && unit.scale !== 'hero' && (unit.body ?? 'human') === 'human' && !unit.mount
    && (unit.armor?.tier ?? 0) <= 2 && DISPERSED_ARMS.includes(baseMechanism(unit.weapon) ?? '');
}
/** 装备或编制自动产生的特质在界面上的简短说明。 */
export function autoTraitLabel(id: string, unit?: Partial<Pick<Combatant,'numericModel'|'loadModel'>>): string {
  if ((unit?.numericModel || unit && revisedLoad(unit)) && ['heavy-armor','super-heavy'].includes(id)) return (id === 'super-heavy' ? '超重装甲' : '重甲') + '（负担按容量占比）';
  return id === 'super-heavy' ? '超重装甲（先攻−2，无额外防御）' : id === 'heavy-armor' ? '重甲（先攻−1，无额外防御）' : id === 'loose-formation' ? '散兵（步枪类编队自动疏散）' : id;
}
export function equipmentTraitIds(unit: Pick<Combatant, 'rulesVersion' | 'armor'> & Partial<Pick<Combatant, 'traitModel' | 'traits' | 'traitSources' | 'scale' | 'body' | 'mount' | 'weapon'>>): string[] {
  const id = unit.rulesVersion === 'v2' ? armorTraitId(armorBurdenTier(unit)) : undefined;
  return [...(id ? [id] : []), ...(unit.scale !== undefined && autoLooseFormation(unit as Combatant) ? ['loose-formation'] : [])];
}
export function activeTraitIds(unit: Combatant): string[] {
  const ids = [...unit.traits, ...physicalTraitIds(unit), ...equipmentTraitIds(unit), ...Object.values(unit.accessories ?? {}).flatMap(item => item?.traitId ? [item.traitId] : []), ...(unit.gear ?? []).flatMap(item => item.passive?.traits.map(grant => grant.id) ?? []), ...(unit.rulesVersion === 'v2' ? unit.traitSources?.filter((s) => traitSourceActive(unit, s)).flatMap((s) => s.traitIds) ?? [] : [])];
  return [...new Set(traitLevelsV16(unit) ? ids.map(id => canonicalTraitId(id, phase2Traits(unit))) : ids)];
}
export interface TraitLevelSource { id: string; name: string; level: number; remaining?: number }
/** 来源先投影别名再取强；查询不改写身份、期限或本体。 */
export function traitLevelSources(unit: Combatant, id: string, horizon = 0): TraitLevelSource[] {
  const modern = traitLevelsV16(unit), canonical = modern ? canonicalTraitId(id, phase2Traits(unit)) : id;
  const result: TraitLevelSource[] = [];
  const take = (raw: string, level: number | undefined, sourceId: string, name: string, remaining?: number) => {
    if ((modern ? canonicalTraitId(raw, phase2Traits(unit)) : raw) !== canonical) return;
    result.push({ id: sourceId, name, level: gradedTraitEnabled(unit, canonical) ? sourceTraitLevel(raw, level) : 5, ...(remaining === undefined ? {} : { remaining }) });
  };
  for (const raw of unit.traits) take(raw, unit.traitLevels?.[raw], 'intrinsic', '本体');
  if (unit.rulesVersion === 'v2') for (const source of unit.traitSources ?? []) if (traitSourceActive(unit, source) && (source.duration.kind !== 'rounds' || source.remaining! > horizon))
    for (const raw of source.traitIds) take(raw, source.traitLevels?.[raw], source.id, source.name, source.duration.kind === 'rounds' ? source.remaining : undefined);
  for (const item of unit.gear ?? []) for (const grant of item.passive?.traits ?? []) take(grant.id, grant.level, item.id, item.name);
  for (const item of Object.values(unit.accessories ?? {})) if (item?.traitId) take(item.traitId, undefined, item.id, item.name);
  for (const raw of [...physicalTraitIds(unit), ...equipmentTraitIds(unit)]) take(raw, undefined, 'automatic', '身体/装备自动来源');
  return result;
}
export function effectiveTraitLevel(unit: Combatant, id: string, traits?: readonly string[], horizon = 0): number {
  const canonical = traitLevelsV16(unit) ? canonicalTraitId(id, phase2Traits(unit)) : id;
  if (traits && !traits.includes(canonical)) return 0;
  return Math.max(0, ...traitLevelSources(unit, canonical, horizon).map((s) => s.level));
}
export function activeConditionIds(unit: Combatant): string[] {
  return [...new Set([...unit.conditions.filter((c) => c.dur > 0).map((c) => c.id),
    ...(unit.rulesVersion === 'v2' ? unit.traitSources?.filter((s) => traitSourceActive(unit, s)).flatMap((s) => s.conditionIds ?? []) ?? [] : [])])];
}
export function actualTargetTag(unit: Combatant, tag: string): boolean {
  if (unit.rulesVersion !== 'v2') return unit.tags.includes(tag);
  if (tag === 'large') return unit.mount === true || ['large', 'giant', 'vehicle'].includes(unit.body ?? 'human');
  if (tag === 'mounted') return unit.mount === true;
  if (tag === 'airborne') return unit.airborne === true;
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
  if (id === 'loose-formation' && traitsV13(unit) && (!['human', 'large'].includes(unit.body ?? 'human') || unit.mount || unit.airborne || (unit.armor?.tier ?? 0) > 2)) return '疏散需要轻中装、地面、不骑乘的人形或大型身体';
  if (id === 'loose-formation' && !traitsV13(unit) && (unit.scale === 'hero' || !['human', 'large'].includes(unit.body ?? 'human') || unit.mount || unit.airborne || (unit.armor?.tier ?? 0) > 2)) return '疏散需要轻中装地面多人编队，骑乘、重型平台或单个个体不能展开';
  if (id === 'agile' && (!['human', 'large'].includes(unit.body ?? 'human') || (unit.armor?.tier ?? 0) > 2)) return '身法需要轻中装的人形或大型身体';
  if (id === 'large' && !['large', 'giant'].includes(unit.body ?? 'human')) return '大型特质由实际大型或巨型身体提供';
  if (id === 'titan' && unit.body !== 'giant') return '泰坦特质需要实际巨型身体';
  if (['heavy-armor', 'super-heavy'].includes(id) && hasNaturalArmor(unit)) return '天生护甲没有重甲负担';
  if (id === 'heavy-armor' && (unit.armor?.tier ?? 0) < 3) return '需要实际重甲或超重甲';
  if (id === 'super-heavy' && unit.armor?.tier !== 4) return '需要实际超重甲';
  if (id === 'mounted-archer' && unit.mount !== true) return '需要明确坐骑，骑射不适用于装甲车辆';
  if (id === 'mounted-archer' && ![unit.weapon, unit.sidearm].some((w) => w?.tags?.includes('ranged') && (w.load ?? 99) <= 2 && !w.reload)) return '需要适于移动投射的实际轻便武器';
  if (id === 'skirmisher' && (!['human', 'large'].includes(unit.body ?? 'human') || (unit.armor?.tier ?? 0) > 2)) return '游击需要轻装或中装的人形/大型身体';
  if (id === 'anti-mobile' && !traitsV13(unit) && (baseMechanism(weapon) !== 'spear' || context.ranged)) return '需要实际长柄近战武器';
  if (id === 'armor-piercing-shot' && (!context.ranged || !weapon?.tags?.includes('ranged') || weapon.channel !== 'kinetic')) return '需要真实动能投射动作';
  if (['ap-weapon', 'ap-master'].includes(id) && (!weapon || weapon.channel !== 'kinetic')) return '需要可利用弱点的动能武器';
  if (id === 'shield-wall' && !shieldGuardUsable(unit)) return '需要实际盾牌';
  if (id === 'pike-wall' && !traitsV13(unit) && baseMechanism(weapon) !== 'spear') return '需要实际长柄反冲锋武器';
  return undefined;
}
export function traitPenetrationBonus(unit: Combatant, weapon: Weapon | undefined, ranged: boolean, base: number): number {
  if (unit.rulesVersion !== 'v2' || !weapon || weapon.channel !== 'kinetic') return 0;
  const ids = activeTraitIds(unit).filter((id) => !traitPrerequisiteReason(unit, id, { weapon, ranged }));
  const level = effectiveTraitLevel(unit, 'ap-weapon', ids);
  const rank = traitLevelsV16(unit) ? Math.max(level ? traitParameter('penetrationBudget', level, unit.traitLevelModel) : 0, ids.includes('armor-piercing-shot') ? 1 : 0)
    : ids.includes('ap-master') ? 2 : ids.includes('ap-weapon') || ids.includes('armor-piercing-shot') ? 1 : 0;
  return Math.min(rank, Math.max(0, (progression(unit) ? base / 3 : Math.floor(base / 3))));
}
/** V13 改了效果的特质，在旧规则战斗里继续显示旧说明。 */
export function traitDescription(trait: Trait, unit?: Pick<Combatant, 'rulesVersion'> & Partial<Pick<Combatant, 'traitModel'>>): string {
  if (unit?.rulesVersion !== 'v2') return trait.desc;
  return (traitsV13(unit) ? trait.v2Desc : trait.v12Desc ?? trait.v2Desc) ?? trait.desc;
}

type TraitStats = NonNullable<Combatant['bakedTraitStats']>;
export function traitStatContributions(unit: Combatant, ids: string[], registry = traitRegistry(), respectPrerequisites = true, levelMode: 'effective' | 'permanent' | 'historical' = 'effective'): TraitStats {
  const result: TraitStats = {}, armorSpeed: number[] = [];
  for (const id of new Set(ids)) {
    if (['large', 'titan', 'flying'].includes(id) || respectPrerequisites && traitPrerequisiteReason(unit, id)) continue;
    if (respectPrerequisites && id === 'mechanized' && (unit.armor?.tier ?? 0) > 0) result.def = (result.def ?? 0) + 1;
    for (const effect of registry.get(id)?.effects ?? []) {
      if (effect.kind !== 'stat' || effect.stat === 'hpMax' || effect.stat === 'morale' && unit.scale === 'hero') continue;
      if (respectPrerequisites && effect.stat === 'spd' && ['heavy-armor', 'super-heavy'].includes(id)) { if (!unit.numericModel && !revisedLoad(unit)) armorSpeed.push(effect.value); continue; }
      const value = phase2Traits(unit) && levelMode !== 'historical' && id === 'berserk' && effect.stat === 'atk' ? 0
        : phase2Traits(unit) && levelMode !== 'historical' && id === 'skirmisher' && effect.stat === 'spd' ? traitParameter('skirmishInitiative', levelMode === 'permanent' ? unit.traitLevels?.[id] ?? 5 : effectiveTraitLevel(unit, id), unit.traitLevelModel)
        : id === 'stubborn' && effect.stat === 'morale' && levelMode !== 'historical' && traitLevelsV16(unit)
        ? traitParameter('resilience', levelMode === 'permanent' ? unit.traitLevels?.[id] ?? 5 : effectiveTraitLevel(unit, id), unit.traitLevelModel) : effect.value;
      result[effect.stat] = (result[effect.stat] ?? 0) + value;
    }
  }
  if (phase2Traits(unit) && ids.includes('agile') && !traitPrerequisiteReason(unit, 'agile') && levelMode !== 'historical') result.spd = (result.spd ?? 0) + traitParameter('agileInitiative', levelMode === 'permanent' ? unit.traitLevels?.agile ?? 5 : effectiveTraitLevel(unit, 'agile'), unit.traitLevelModel);
  if (armorSpeed.length) result.spd = (result.spd ?? 0) + Math.min(...armorSpeed);
  return result;
}
/** 旧v2.1/v2.2的永久属性曾在生成时烘焙；只读取旧审计，不重掷其装备/基础值。 */
export function bakedTraitStats(unit: Combatant, registry = traitRegistry()): TraitStats {
  return structuredClone(unit.bakedTraitStats ?? traitStatContributions(unit, unit.genAudit?.input.traits ?? [], registry, false, 'historical'));
}
export function traitStatAdjustments(unit: Combatant, registry = traitRegistry()): TraitStats {
  if (unit.rulesVersion !== 'v2') return {};
  // 只读比较，不需要 bakedTraitStats 的副本；每次攻击结算都会经过这里。
  const baked = unit.bakedTraitStats ?? traitStatContributions(unit, unit.genAudit?.input.traits ?? [], registry, false, 'historical');
  const current = traitStatContributions(unit, activeTraitIds(unit), registry), result: TraitStats = {};
  for (const key of ['atk', 'def', 'spd', 'morale'] as const) if ((current[key] ?? 0) !== (baked[key] ?? 0)) result[key] = (current[key] ?? 0) - (baked[key] ?? 0);
  return result;
}
/** 新生成/升级时把永久合法效果计入一次；临时授予始终留在运行时。 */
export function normalizeBakedTraitStats(unit: Combatant, registry = traitRegistry()): void {
  const old = bakedTraitStats(unit, registry), current = traitStatContributions(unit, unit.traits, registry, true, 'permanent');
  for (const key of ['atk', 'def', 'spd'] as const) unit.base[key] += (current[key] ?? 0) - (old[key] ?? 0);
  if (unit.base.moraleMax !== undefined) { unit.base.moraleMax += (current.morale ?? 0) - (old.morale ?? 0); unit.morale = unit.moraleLocked ? unit.base.moraleMax : Math.min(unit.morale ?? unit.base.moraleMax, unit.base.moraleMax); }
  unit.bakedTraitStats = current;
}
