import { validateEnhancements, enhancementLabel, type Enhancements, type BonusStat } from './enhancements.js';
import { recoveryCapacity } from './recovery.js';
import { equipmentLoad } from './body.js';
import { hasMemberHealth, memberHealth, memberHealthMax } from './member-health.js';
import { diceAvg } from './data/weapons.js';
import type { Ability, Armor, BodyKind, Combatant, EffectOp, ItemRecipe, Weapon } from './types.js';
import { BODY, compileArmor, compileWeapon, equipmentRecipe, type EquipmentContext } from './gen/equipment.js';
import { compileSkill } from './skill-catalog.js';
import { upgradeCombatSkills } from './skill-upgrade.js';
import { SKILL_MODEL } from './skill-model.js';
import { parseSkillMechanism, skillMechanismFromId, skillMechanismId, skillMechanismName } from './data/skill-mechanisms.js';
import { TRAITS, traitRegistry, isGradedTrait, validTraitLevel } from './data/traits.js';
import { itemsV15 } from './item-model.js';
import { isCohort, personnel } from './combat-model.js';

/**
 * 道具 = 形态 × 效果 × 等级。
 * - 效果：一次性与充能道具写技能机制（与技能同一套词表与编译器），佩戴道具写特质与单位修正。
 * - 等级：L1–10，沿用规格等级锚定表，与使用者训练等级无关。
 * - 形态：一次性（按件消耗）、充能（装备后每战 1–2 次）、佩戴（被动）；没有效果的叙事物品不建机制。
 * 行动在建档时按当时的统一伤害模型与 V14 技能计价编译一次后冻结，之后不随规则或使用者重算。
 */
export type EquipmentSlot = 'primary' | 'sidearm' | 'armor' | 'shield' | 'gear';
export type ItemForm = 'single' | 'charged' | 'worn';
export const ITEM_FORM_NAMES: Readonly<Record<ItemForm, string>> = { single: '一次性', charged: '充能', worn: '佩戴' };
export const ITEM_VERSION = 'items-v1' as const;
export interface ItemTraitGrant { id: string; level?: number }
export interface ItemPassive { traits: ItemTraitGrant[]; bonuses?: Enhancements }
/** 道具实物的冻结配方；有 legacy 的是旧版药剂与护符转换来的，保留原效果、不受佩戴预算限制。 */
export interface ItemEffectRecipe {
  version: typeof ITEM_VERSION; form: ItemForm; power: number; seed: string;
  /** 一次性、充能：通用技能机制 id。 */
  active?: string;
  /** 佩戴：授予的特质；专精的等级就是道具等级。 */
  traits?: ItemTraitGrant[];
  /** 一次性、充能用技能方向；佩戴用单位方向（gear）。 */
  bonuses?: Enhancements;
  legacy?: string;
}
export interface ItemValue {
  recipe: ItemEffectRecipe;
  /** 一次性、充能道具的行动模板（身份在携带或装备时才写入）。 */
  ability?: Ability;
  passive?: ItemPassive;
}
/** 装备在单位身上的佩戴、充能道具；和武器护甲一样是库存实物的冻结投影。 */
export interface GearItem { id: string; name: string; load: number; recipe: ItemEffectRecipe; ability?: Ability; passive?: ItemPassive }
/** V15 之前两格配件的旧记录；只在尚未结束的旧战斗快照里出现。 */
export interface LegacyAccessory { id: string; name: string; load: number; recipe: ItemRecipe; traitId?: string; ability?: Ability }
export type ShieldItem = NonNullable<Combatant['shield']> & { name?: string; recipe?: ItemRecipe };
type ItemSpecificationBase = { bonuses?: Enhancements; power: number; quality?: number; body?: BodyKind };
export type ItemSpecification = ItemSpecificationBase & (
  | { kind: 'weapon'; mechanism: string; enchantment?: 'none' | 'thermal' | 'arcane'; stabilized?: boolean }
  | { kind: 'armor'; tier: Armor['tier']; profile?: ItemRecipe['protectionProfile'] }
  | { kind: 'shield' }
  | { kind: 'item'; form: ItemForm; active?: string; traits?: ItemTraitGrant[]; legacy?: string }
);
export type ItemMechanics =
  | { kind: 'weapon'; value: Weapon }
  | { kind: 'armor'; value: Armor }
  | { kind: 'shield'; value: ShieldItem }
  | { kind: 'item'; value: ItemValue };
/** 旧版机制，只作为迁移输入。 */
export type LegacyItemMechanics =
  | { kind: 'consumable'; recipe: ItemRecipe; effect: EffectOp }
  | { kind: 'accessory'; value: LegacyAccessory };

export interface CarriedItem {
  id: string; name: string; quantity: number; revision: number;
  mechanics: ItemMechanics | LegacyItemMechanics;
  /** 开战时生成并冻结的行动；战内账本只比对它，不再按配方重算。 */
  action?: Ability;
}

// ---------- 佩戴预算 ----------
/** 强力特质占 6 点，专精占 ⌈L/2⌉ 点，其余特质 3 点；正向修正每点 1 点，负面修正不返还。 */
export const STRONG_TRAITS: readonly string[] = ['flying', 'terror', 'guardian-greater', 'regen', 'indomitable', 'steadfast', 'ap-master'];
const BODY_TRAITS = new Set(['natural-armor', 'inorganic']);
/** 佩戴道具可以授予的特质：外部来源已接通、未停用、不由身体或装备派生，且不是身体本身的特质。 */
export function wornTraitAllowed(id: string): boolean {
  const trait = traitRegistry().get(id);
  return !!trait?.v2SourceReady && !trait.legacy && !trait.derived && !BODY_TRAITS.has(id);
}
export const WORN_TRAITS: readonly string[] = TRAITS.filter((t) => wornTraitAllowed(t.id)).map((t) => t.id);
export function traitPoints(grant: ItemTraitGrant, power: number): number {
  return isGradedTrait(grant.id) ? Math.ceil((grant.level ?? power) / 2) : STRONG_TRAITS.includes(grant.id) ? 6 : 3;
}
export function passiveCost(passive: ItemPassive, power: number): number {
  return passive.traits.reduce((sum, grant) => sum + traitPoints(grant, power), 0)
    + Object.values(passive.bonuses ?? {}).reduce((sum, points) => sum + Math.max(0, points ?? 0), 0);
}

// ---------- 行动模板 ----------
const HARD_CONTROLS = new Set(['stunned', 'restrained', 'disarmed', 'silenced']);
const isArea = (a: Ability) => a.shape === 'burst' || !!a.area || a.target === 'zone';
/** 一件一个效果：区域、召唤、纯士气；其余按每人一份。 */
export function objectScaledAbility(a: Ability): boolean {
  return a.effects.some((e) => e.op === 'zone' || e.op === 'summon') || a.effects.length > 0 && a.effects.every((e) => e.op === 'morale');
}
/** 喝、敷、注射：给自己或一名友军的增益与治疗，不含伤害、区域、召唤与位移。 */
export function quickAbility(a: Ability): boolean {
  return (a.target === 'ally' || a.target === 'self') && !isArea(a) && a.effects.every((e) => !['damage', 'zone', 'summon', 'move', 'push'].includes(e.op));
}
/** 充能道具每战次数：单体或自身 2 次；范围、区域、召唤、眩晕定身沉默缴械 1 次。 */
export function chargedUses(a: Ability): number {
  return isArea(a) || a.effects.some((e) => e.op === 'zone' || e.op === 'summon' || e.op === 'condition' && HARD_CONTROLS.has(e.conditionId)) ? 1 : 2;
}
function templateHost(ability: Ability, power: number): Combatant {
  return { id: 'item', name: '道具', side: 'ally', scale: 'hero', level: power, tags: [], base: { atk: 0, def: 0, spd: 0, hpMax: 1 }, hp: 1, conditions: [],
    abilities: [ability], abilityState: [], resources: {}, traits: [], engagedWith: [], status: 'ready', fatigue: 0,
    rulesVersion: 'v2', damageModel: 'wounds-v2', combatModel: 'cohort-v2', skillModel: SKILL_MODEL };
}
/** 与已学技能走同一条编译与入场升级路径，再改成道具：不耗精力、单独计冷却、默认非魔法。 */
export function itemAbilityTemplate(id: string, power: number, bonuses: Enhancements | undefined, form: 'single' | 'charged', name = '道具'): Ability {
  const mechanism = skillMechanismFromId(id);
  if (!mechanism) throw new Error('未知或矛盾的道具效果');
  const host = templateHost(compileSkill({ id, name, bonuses }, power, 'item', SKILL_MODEL), power);
  upgradeCombatSkills(host);
  const a = host.abilities[0]!;
  a.id = 'item'; delete a.sourceId; delete a.cost; delete a.cooldownGroup;
  a.customized = true;
  if (!mechanism.category.startsWith('magic') && a.delivery === 'magic') delete a.delivery;
  if (form === 'single') { delete a.cooldown; delete a.usesPerBattle; }
  else a.usesPerBattle = chargedUses(a);
  if (form === 'single' && quickAbility(a)) { a.itemQuick = true; a.range = { min: 0, max: 1, metric: 'grid', allowEngaged: true, requiresLineOfSight: true }; }
  a.itemScaling = objectScaledAbility(a) ? 'object' : 'member';
  a.desc = (form === 'single' ? (a.itemQuick ? '一次性：自身或相邻友军，可用加速动作' : '一次性：占主行动') : `充能：装备后每战${a.usesPerBattle}次，占主行动`)
    + '；不耗精力；' + skillMechanismName(mechanism) + 'L' + power + enhancementLabel(bonuses) + (a.delivery === 'magic' ? '（魔法）' : '');
  return a;
}

// ---------- 编译 ----------
function integerPower(power: number): number {
  if (!Number.isSafeInteger(power) || power < 1 || power > 10) throw new Error('道具等级必须为L1–L10整数');
  return power;
}
export function normalizeTraitGrants(traits: readonly ItemTraitGrant[], power: number, legacy = false): ItemTraitGrant[] {
  const ids = new Set<string>();
  return traits.map((grant) => {
    if (!grant || typeof grant.id !== 'string' || !(legacy ? traitRegistry().get(grant.id)?.v2SourceReady : wornTraitAllowed(grant.id))) throw new Error('佩戴道具不能授予这个特质：' + (traitRegistry().get(grant?.id)?.name ?? grant?.id));
    if (ids.has(grant.id)) throw new Error('同一道具重复授予特质：' + traitRegistry().get(grant.id)?.name);
    ids.add(grant.id);
    if (!isGradedTrait(grant.id)) { if (grant.level !== undefined) throw new Error('只有五项专精可以带等级'); return { id: grant.id }; }
    const level = grant.level ?? power;
    if (!validTraitLevel(level)) throw new Error('专精等级须为L1–L10整数');
    return { id: grant.id, level };
  });
}
function compileItemValue(spec: Extract<ItemSpecification, { kind: 'item' }>, seed: string, name?: string): ItemValue {
  const power = integerPower(spec.power);
  if (!['single', 'charged', 'worn'].includes(spec.form)) throw new Error('未知道具形态');
  if (spec.form === 'worn') {
    if (spec.active) throw new Error('佩戴道具写特质或修正；主动效果请写成一次性或充能道具');
    validateEnhancements(spec.bonuses, 'gear');
    const traits = normalizeTraitGrants(spec.traits ?? [], power, !!spec.legacy);
    const bonuses = spec.bonuses && Object.values(spec.bonuses).some((v) => v) ? Object.fromEntries(Object.entries(spec.bonuses).filter(([, v]) => v)) as Enhancements : undefined;
    if (!traits.length && !bonuses) throw new Error('佩戴道具需要特质或单位修正');
    const passive: ItemPassive = { traits, ...(bonuses ? { bonuses } : {}) };
    const need = passiveCost(passive, power);
    if (!spec.legacy && need > power) throw new Error(`佩戴效果需要${need}点，L${power}只有${power}点（普通特质3点、强力特质6点、专精占等级的一半，正向修正每点1点）`);
    return { recipe: { version: ITEM_VERSION, form: 'worn', power, seed, ...(traits.length ? { traits } : {}), ...(bonuses ? { bonuses } : {}), ...(spec.legacy ? { legacy: spec.legacy } : {}) }, passive };
  }
  if (!spec.active || spec.traits?.length) throw new Error('一次性与充能道具写技能机制，如buff治疗L3、物理范围投射L4');
  validateEnhancements(spec.bonuses, 'skill');
  const ability = itemAbilityTemplate(spec.active, power, spec.bonuses, spec.form, name);
  return { recipe: { version: ITEM_VERSION, form: spec.form, power, seed, active: spec.active, ...(spec.bonuses && Object.keys(spec.bonuses).length ? { bonuses: spec.bonuses } : {}), ...(spec.legacy ? { legacy: spec.legacy } : {}) }, ability };
}

/** 物品编译不依赖持有者等级，也不生成临时人物；效果创建后冻结。 */
export function compileItem(spec: ItemSpecification, identity: Pick<EquipmentContext, 'id' | 'name' | 'seed' | 'creatingUnit' | 'damageModel' | 'noVariance' | 'variance'>): ItemMechanics {
  if (spec.kind === 'item') return { kind: 'item', value: compileItemValue(spec, identity.seed, identity.name) };
  validateEnhancements(spec.bonuses, spec.kind);
  const context = { ...identity, body: spec.body, quality: spec.quality, bonuses: spec.bonuses };
  switch (spec.kind) {
    case 'weapon': return { kind: 'weapon', value: compileWeapon(spec, context) };
    case 'armor': return { kind: 'armor', value: compileArmor(spec, context) };
    case 'shield': return { kind: 'shield', value: { id: identity.id, name: identity.name ?? '盾牌', load: 2, recipe: equipmentRecipe('shield', spec.power, context) } };
    default: throw new Error('不支持的物品用途');
  }
}
/** 道具配方的规范写法，与正文 spec 一致（充能前缀、特质、等级与修正）。 */
export function itemSpecText(recipe: ItemEffectRecipe): string {
  if (recipe.form === 'worn') {
    const names = (recipe.traits ?? []).map((t) => traitRegistry().get(t.id)?.name ?? t.id);
    // 旧版夜视镜、林行靴按 L5 专精转换，写出实际生效的专精等级，照抄回正文也得到同样的效果。
    const level = recipe.legacy && recipe.traits?.length === 1 && recipe.traits[0]!.level !== undefined ? recipe.traits[0]!.level : recipe.power;
    return (names.length ? names.join('、') : '佩戴') + 'L' + level + enhancementLabel(recipe.bonuses);
  }
  return (recipe.form === 'charged' ? '充能' : '') + skillMechanismName(recipe.active ?? '') + 'L' + recipe.power + enhancementLabel(recipe.bonuses);
}
export function itemSpecificationFromRecipe(recipe: ItemEffectRecipe): Extract<ItemSpecification, { kind: 'item' }> {
  return { kind: 'item', form: recipe.form, power: recipe.power, ...(recipe.active ? { active: recipe.active } : {}), ...(recipe.traits ? { traits: structuredClone(recipe.traits) } : {}),
    ...(recipe.bonuses ? { bonuses: { ...recipe.bonuses } } : {}), ...(recipe.legacy ? { legacy: recipe.legacy } : {}) };
}

// ---------- 旧版药剂与护符 ----------
const LEGACY_CONSUMABLES: Readonly<Record<string, string>> = { heal: '增益治疗', repair: '增益治疗', restore: '增益回能', cleanse: '增益净化', empower: '增益伤害', barrier: '增益屏障', grenade: '物理范围投射' };
const LEGACY_ACCESSORY_TRAITS: Readonly<Record<string, string>> = { guardian: 'guardian', night: 'night-fighter', woodland: 'forest-lore', endurance: 'fatigue-trained' };
const LEGACY_ACCESSORY_SKILLS: Readonly<Record<string, string>> = { healing: '增益治疗', barrier: '增益屏障', cleansing: '增益净化' };
const legacyMechanism = (text: string) => skillMechanismId(parseSkillMechanism(text)!);
/** 旧版 7 种药剂与 7 种护符按对照表换成新道具；等级、名称不变，原强化方向保留到技能修正里。 */
export function migrateLegacyItem(mechanics: LegacyItemMechanics, name: string, seed: string): Extract<ItemMechanics, { kind: 'item' }> {
  if (mechanics.kind === 'consumable') {
    const mechanism = String(mechanics.recipe.mechanism), active = LEGACY_CONSUMABLES[mechanism];
    if (!active) throw new Error('旧版消耗品用途未知，不能转换：' + mechanism);
    const bonuses = mechanics.recipe.bonuses && Object.keys(mechanics.recipe.bonuses).length ? { ...mechanics.recipe.bonuses } : undefined;
    return compileItem({ kind: 'item', form: 'single', power: mechanics.recipe.power, active: legacyMechanism(active), ...(bonuses ? { bonuses } : {}), legacy: 'consumable:' + mechanism }, { id: seed, name, seed: mechanics.recipe.seed || seed }) as Extract<ItemMechanics, { kind: 'item' }>;
  }
  const kind = String(mechanics.value.recipe?.mechanism ?? '').replace(/^accessory:/, ''), power = mechanics.value.recipe?.power ?? 1;
  const trait = LEGACY_ACCESSORY_TRAITS[kind], skill = LEGACY_ACCESSORY_SKILLS[kind];
  if (trait) return compileItem({ kind: 'item', form: 'worn', power, traits: [{ id: trait, ...(isGradedTrait(trait) ? { level: 5 } : {}) }], legacy: 'accessory:' + kind }, { id: seed, name, seed: mechanics.value.recipe?.seed || seed }) as Extract<ItemMechanics, { kind: 'item' }>;
  if (skill) return compileItem({ kind: 'item', form: 'charged', power, active: legacyMechanism(skill), legacy: 'accessory:' + kind }, { id: seed, name, seed: mechanics.value.recipe?.seed || seed }) as Extract<ItemMechanics, { kind: 'item' }>;
  throw new Error('旧版配件用途未知，不能转换：' + kind);
}
export const isLegacyItemMechanics = (value: { kind?: unknown } | undefined): value is LegacyItemMechanics => value?.kind === 'consumable' || value?.kind === 'accessory';

// ---------- 携行（一次性） ----------
function itemAction(id: string, name: string, template: Ability): Ability {
  return { ...structuredClone(template), id: 'item:' + id, itemSourceId: id, name: '使用' + name, cost: { resource: 'item:' + id, amount: 1 }, cooldownGroup: 'item:' + id };
}
export function carriedItemAbility(item: CarriedItem): Ability {
  if (!item.id || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 9999) throw new Error('携行物品规格损坏');
  if (item.action) return structuredClone(item.action);
  const m = item.mechanics;
  if (m.kind !== 'item' || m.value.recipe.form !== 'single' || !m.value.ability) throw new Error('只有一次性道具可以携带进战斗使用');
  return itemAction(item.id, item.name, m.value.ability);
}
/** 归档时移除临时物品行动和次数；不把消耗品变成永久已学技能。 */
export function stripCarriedItems(unit: Combatant): Combatant {
  const next = structuredClone(unit), ids = new Set(next.abilities.filter((a) => a.itemSourceId).map((a) => a.id));
  next.abilities = next.abilities.filter((a) => !a.itemSourceId);
  next.abilityState = next.abilityState.filter((s) => !ids.has(s.abilityId));
  if (next.preparedAbilityIds) next.preparedAbilityIds = next.preparedAbilityIds.filter((id) => !ids.has(id));
  for (const key of Object.keys(next.resources)) if (key.startsWith('item:')) delete next.resources[key];
  delete next.carriedItems; return next;
}
/** 仅开新战斗时调用；恢复战斗直接读取原快照，绝不重新授予数量。 */
export function attachCarriedItems(unit: Combatant, items: CarriedItem[]): Combatant {
  const next = stripCarriedItems(unit);
  if (next.rulesVersion !== 'v2') return next;
  if (new Set(items.map((i) => i.id)).size !== items.length) throw new Error('携行物品身份重复');
  const carried = items.map((item) => ({ ...structuredClone(item), action: carriedItemAbility({ ...item, action: undefined }) }));
  if (carried.length) next.carriedItems = carried;
  for (const item of carried) { next.abilities.push(structuredClone(item.action)); next.resources[item.action.cost!.resource] = item.quantity; }
  return next;
}

// ---------- 装备（佩戴、充能） ----------
export function gearItem(id: string, name: string, value: ItemValue): GearItem {
  if (value.recipe.form === 'single') throw new Error('一次性道具不能装备，携带进战斗后使用');
  const ability = value.recipe.form === 'charged' && value.ability
    ? { ...structuredClone(value.ability), id: 'equipment:' + id, equipmentSourceId: id, name, cooldownGroup: 'item:' + id } : undefined;
  return { id, name, load: 0, recipe: structuredClone(value.recipe), ...(ability ? { ability } : {}), ...(value.passive ? { passive: structuredClone(value.passive) } : {}) };
}
function equippedAbilities(unit: Combatant): Ability[] {
  return [...Object.values(unit.accessories ?? {}).flatMap((item) => item?.ability ? [structuredClone(item.ability)] : []),
    ...(unit.gear ?? []).flatMap((item) => item.ability ? [structuredClone(item.ability)] : [])];
}
/** 装备授予的能力始终跟随实物；卸下后不残留为已学技能。 */
export function syncGearAbilities(unit: Combatant): void {
  const old = new Set(unit.abilities.filter((a) => a.equipmentSourceId).map((a) => a.id));
  unit.abilities = [...unit.abilities.filter((a) => !a.equipmentSourceId), ...equippedAbilities(unit)];
  const remaining = new Set(unit.abilities.map((a) => a.id));
  unit.abilityState = unit.abilityState.filter((state) => !old.has(state.abilityId) || remaining.has(state.abilityId));
  if (unit.preparedAbilityIds) unit.preparedAbilityIds = unit.preparedAbilityIds.filter((id) => !old.has(id));
}
export function equippedSourceIds(unit: Pick<Combatant, 'accessories' | 'gear'>): string[] {
  return [...Object.values(unit.accessories ?? {}).flatMap((item) => item ? [item.id] : []), ...(unit.gear ?? []).map((item) => item.id)];
}

/** 生成、换装和动作共同检查当前真实装备，不会调整或重掷实例。 */
export function equipmentReason(unit: Pick<Combatant, 'body' | 'scale' | 'weapon' | 'sidearm' | 'armor' | 'shield' | 'accessories' | 'gear'>): string | undefined {
  const body = BODY[unit.body ?? 'human'];
  if (!body) return '不支持的身体/平台';
  for (const weapon of [unit.weapon, unit.sidearm]) {
    if (weapon?.recipe?.stabilized && unit.body !== 'vehicle') return '稳定车载武器需要实际车辆平台，不能由步行或骑乘单位装备';
  }
  if (new Set((unit.gear ?? []).map((item) => item.id)).size !== (unit.gear ?? []).length) return '同一件道具不能重复装备';
  const load = equipmentLoad(unit);
  return load > body.capacity ? `负重 ${load} 超过身体容量 ${body.capacity}` : undefined;
}

const definition = (a: Ability | undefined) => a ? JSON.stringify({ ...a, name: undefined, desc: undefined, category: undefined }, (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]])) : value) : undefined;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
/** 道具实物的结构校验：形态、等级、效果与授予能力一致；不按当前公式重算冻结行动。 */
export function validateItemValue(value: unknown): asserts value is ItemValue {
  if (!object(value) || !object(value.recipe)) throw new Error('道具配方损坏');
  const r = value.recipe;
  if (r.version !== ITEM_VERSION || !['single', 'charged', 'worn'].includes(String(r.form)) || !Number.isSafeInteger(r.power) || Number(r.power) < 1 || Number(r.power) > 10
    || typeof r.seed !== 'string' || !r.seed || r.legacy !== undefined && typeof r.legacy !== 'string') throw new Error('道具配方版本、形态或等级损坏');
  if (r.form === 'worn') {
    if (r.active !== undefined || value.ability !== undefined || !object(value.passive) || !Array.isArray(value.passive.traits)) throw new Error('佩戴道具的效果记录损坏');
    validateEnhancements(value.passive.bonuses as Enhancements | undefined, 'gear');
    const traits = normalizeTraitGrants(value.passive.traits as ItemTraitGrant[], Number(r.power), !!r.legacy);
    if (JSON.stringify(traits) !== JSON.stringify(value.passive.traits) || JSON.stringify(r.traits ?? []) !== JSON.stringify(value.passive.traits)
      || JSON.stringify(r.bonuses ?? null) !== JSON.stringify(value.passive.bonuses ?? null)) throw new Error('佩戴道具的特质或修正与配方不一致');
    if (!r.legacy && passiveCost(value.passive as unknown as ItemPassive, Number(r.power)) > Number(r.power)) throw new Error('佩戴道具超出等级预算');
    return;
  }
  if (typeof r.active !== 'string' || !skillMechanismFromId(r.active) || r.traits !== undefined || value.passive !== undefined) throw new Error('道具效果机制损坏');
  validateEnhancements(r.bonuses as Enhancements | undefined, 'skill');
  const a = value.ability;
  if (!object(a) || !Array.isArray(a.effects) || a.customized !== true || a.itemSourceId !== undefined || a.equipmentSourceId !== undefined
    || r.form === 'charged' && (!Number.isSafeInteger(a.usesPerBattle) || ![1, 2].includes(Number(a.usesPerBattle))) || r.form === 'single' && a.usesPerBattle !== undefined) throw new Error('道具行动记录损坏');
}

/** 配件与道具效果由现存实物决定，读档不能附加另一种被动能力或无限使用次数。 */
export function validateGear(unit: Combatant): void {
  const ids = new Set<string>();
  if (unit.accessories !== undefined) {
    if (!object(unit.accessories) || Object.keys(unit.accessories).some((key) => !['accessory1', 'accessory2'].includes(key))) throw new Error('配件栏记录不正确');
    for (const item of Object.values(unit.accessories)) {
      if (!item || typeof item.id !== 'string' || !item.id || typeof item.name !== 'string' || ids.has(item.id) || !object(item.recipe) || !String(item.recipe.mechanism).startsWith('accessory:')
        || item.traitId !== undefined && !traitRegistry().has(item.traitId) || !!item.traitId === !!item.ability) throw new Error('配件记录不完整或重复');
      ids.add(item.id);
    }
  }
  if (unit.gear !== undefined) {
    if (!Array.isArray(unit.gear)) throw new Error('道具装备记录损坏');
    for (const item of unit.gear) {
      if (!object(item) || typeof item.id !== 'string' || !item.id || typeof item.name !== 'string' || !item.name || ids.has(item.id) || item.load !== 0) throw new Error('道具装备记录不完整或重复');
      ids.add(item.id);
      validateItemValue({ recipe: item.recipe, ...(item.passive ? { passive: item.passive } : {}), ...(item.ability ? { ability: { ...item.ability, id: 'item', name: undefined, equipmentSourceId: undefined, cooldownGroup: undefined } } : {}) });
      if (item.recipe.form === 'single') throw new Error('一次性道具不能装备');
      if (item.recipe.form === 'charged' && (item.ability?.id !== 'equipment:' + item.id || item.ability.equipmentSourceId !== item.id)) throw new Error('充能道具的行动身份损坏');
    }
  }
  const granted = unit.abilities?.filter((a) => a.equipmentSourceId) ?? [];
  if (granted.some((a) => !ids.has(a.equipmentSourceId!))) throw new Error('装备能力缺少对应配件或道具');
  for (const expected of equippedAbilities(unit)) {
    const actual = granted.filter((a) => a.equipmentSourceId === expected.equipmentSourceId);
    if (actual.length !== 1 || definition(actual[0]) !== definition(expected)) throw new Error('装备能力与对应道具不一致');
  }
  if (granted.length !== equippedAbilities(unit).length) throw new Error('装备能力与对应道具不一致');
}

// 战斗中的佩戴修正见 gear-bonuses.ts（被修正栈引用，保持为叶子模块）。
export { gearBonuses, combatBonuses } from './gear-bonuses.js';

// ---------- V15 一次性道具的使用 ----------
/** 能否用加速动作（非技能行动）使用：V15 只限喝、敷、注射类；旧规则所有携行物品都可以。 */
export function quickItemAction(unit: Pick<Combatant, 'itemModel'>, ability: Ability): boolean {
  return !!ability.itemSourceId && (!itemsV15(unit) || ability.itemQuick === true);
}
const BINARY_EFFECTS = new Set(['trait', 'dispel', 'push', 'move']);
/** 编队的现员数；英雄与旧档单位按一人（战斗中英雄同样带编队战斗模型，personnel 读到的是生命值）。 */
const membersOf = (unit: Combatant) => unit.scale !== 'hero' && isCohort(unit) ? Math.max(1, personnel(unit)) : 1;
/**
 * V15：编队使用“每人一份”的一次性道具，一次最多消耗现员数件；给友方用时还不超过目标需要的件数。
 * 件数不足时伤害按实际件数的投掷人数结算，治疗按件数累加，状态、屏障、精力和士气按覆盖比例折算；
 * 授予特质、驱散与位移这类“有/无”的效果需要覆盖全员。英雄、旧规则与一件一个效果的道具不变。
 */
export function itemUseAbility(actor: Combatant, ability: Ability, target?: Combatant): { ability: Ability; reason?: string } {
  if (!ability.itemSourceId || !itemsV15(actor) || ability.itemScaling !== 'member' || !ability.cost) return { ability };
  const have = Math.max(0, actor.resources[ability.cost.resource] ?? 0);
  const support = ability.target === 'ally' || ability.target === 'self';
  const recipient = support ? target ?? actor : undefined;
  const need = recipient ? membersOf(recipient) : membersOf(actor);
  const users = membersOf(actor);
  const doses = Math.max(1, Math.min(have, users, need));
  if (doses <= 1 && need <= 1) return { ability };
  const share = Math.min(1, doses / need);
  if (share < 1 && ability.effects.some((e) => BINARY_EFFECTS.has(e.op))) return { ability, reason: `件数不足以覆盖全队（需要${need}件）` };
  const scaled = structuredClone(ability);
  scaled.cost = { ...scaled.cost!, amount: doses }; scaled.itemDoses = doses;
  scaled.effects = scaled.effects.map((e): EffectOp => {
    if (e.op === 'heal') return e.amount !== undefined ? { op: 'heal', amount: Math.max(1, Math.round(e.amount * (support ? doses : 1))) } : e;
    if (!support) return e;
    if (e.op === 'condition') return { ...e, magnitude: Math.max(0.25, (e.magnitude ?? 1) * share) };
    if (e.op === 'barrier') return { ...e, amount: Math.max(1, Math.round(e.amount * share)) };
    if (e.op === 'resource') return { ...e, amount: Math.sign(e.amount) * Math.max(1, Math.round(Math.abs(e.amount) * share)) };
    if (e.op === 'morale') return { ...e, amount: Math.round(e.amount * share) };
    return e;
  });
  return { ability: scaled };
}

/**
 * V15 AI 的保留价值：治疗品计满额恢复量的一半，伤害类计同级命中期望的四分之一；最后一份再 ×1.5。
 * 其余道具沿用通用的资源价格。危急目标（濒死、生命低于 35%）由战斗 AI 另乘 0.2。
 */
export function itemReserveCost(actor: Combatant, ability: Ability): number | undefined {
  if (!ability.itemSourceId || !itemsV15(actor) || !ability.cost) return undefined;
  const doses = ability.itemDoses ?? 1, have = actor.resources[ability.cost.resource] ?? 0;
  const heal = ability.effects.reduce((sum, e) => e.op === 'heal' && e.amount !== undefined ? sum + e.amount : sum, 0);
  const damage = ability.effects.reduce((sum, e) => e.op === 'damage' ? sum + diceAvg(e.baseDice) * (ability.damageScale ?? 1) * 0.55 * doses : sum, 0);
  if (!heal && !damage) return undefined;
  return (heal * 0.5 + damage * 0.25) * (have <= doses ? 1.5 : 1);
}
export const ITEM_EMERGENCY_DISCOUNT = 0.2;
/** 治疗品的危急目标：濒死，或剩余生命不足 35%。 */
export function itemEmergency(target: Combatant): boolean {
  if (target.status === 'dying') return true;
  const max = hasMemberHealth(target) ? memberHealthMax(target) : target.base.hpMax;
  return max > 0 && (hasMemberHealth(target) ? memberHealth(target) : target.hp) / max < 0.35;
}

/** 同一恢复语义供物品、战外事务和后续引擎动作使用；不处理资源扣费。 */
export function healingAmount(target: Pick<Combatant, 'hp' | 'base' | 'scale' | 'status' | 'rulesVersion' | 'recoverableWounded'> & Partial<Pick<Combatant,'combatModel'|'formation'>>, amount: number): number {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('恢复量必须是正整数');
  if (target.scale !== 'hero' && !hasMemberHealth(target) && (target.rulesVersion !== 'v2' || !target.recoverableWounded)) throw new Error('群体恢复需要可恢复伤员记录，不能凭空生成兵员');
  if (target.status === 'dead' || target.hp <= 0 && target.status !== 'dying') throw new Error('普通治疗不能复活阵亡目标');
  if (!hasMemberHealth(target)&&target.hp >= target.base.hpMax) throw new Error('生命已满，无需消耗物品');
  const restored = Math.min(amount, recoveryCapacity(target));
  if (!restored) throw new Error('当前目标没有可恢复损伤');
  return restored;
}
