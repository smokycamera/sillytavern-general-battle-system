import { bonusMultiplier, validateEnhancements, type Enhancements } from './enhancements.js';
import { recoveryCapacity } from './recovery.js';
import {hasMemberHealth} from './member-health.js';
import type { Ability, Armor, BodyKind, Combatant, EffectOp, ItemRecipe, Weapon } from './types.js';
import { curveAt } from './data/curves.js';
import { BODY, compileArmor, compileWeapon, equipmentRecipe, type EquipmentContext } from './gen/equipment.js';

export type EquipmentSlot = 'primary' | 'sidearm' | 'armor' | 'shield' | 'accessory1' | 'accessory2';
export const CONSUMABLE_NAMES = { heal: '治疗药剂', restore: '回能药剂', cleanse: '净化药剂', empower: '强攻药剂', barrier: '屏障药剂', grenade: '投掷炸弹', repair: '维修包' } as const;
export type ConsumableKind = keyof typeof CONSUMABLE_NAMES;
export const ACCESSORY_NAMES = { guardian: '守护护符', night: '夜视镜', woodland: '林行靴', endurance: '耐力护符', healing: '治疗护符', barrier: '屏障护符', cleansing: '净化护符' } as const;
export type AccessoryKind = keyof typeof ACCESSORY_NAMES;
export interface AccessoryItem { id: string; name: string; load: number; recipe: ItemRecipe; traitId?: string; ability?: Ability }
export type ConsumableEffect = Extract<EffectOp, { op: 'heal' | 'resource' | 'dispel' | 'condition' | 'barrier' | 'damage' }>;
export type ShieldItem = NonNullable<Combatant['shield']> & { name?: string; recipe?: ItemRecipe };
type ItemSpecificationBase = { bonuses?: Enhancements; power: number; quality?: number; body?: BodyKind };
export type ItemSpecification = ItemSpecificationBase & (
  | { kind: 'weapon'; mechanism: string; enchantment?: 'none' | 'thermal' | 'arcane'; stabilized?: boolean }
  | { kind: 'armor'; tier: Armor['tier']; profile?: ItemRecipe['protectionProfile'] }
  | { kind: 'shield' }
  | { kind: 'consumable'; mechanism: ConsumableKind }
  | { kind: 'accessory'; mechanism: AccessoryKind }
);
export type ItemMechanics =
  | { kind: 'weapon'; value: Weapon }
  | { kind: 'armor'; value: Armor }
  | { kind: 'shield'; value: ShieldItem }
  | { kind: 'consumable'; recipe: ItemRecipe; effect: ConsumableEffect }
  | { kind: 'accessory'; value: AccessoryItem };

export interface CarriedItem {
  id: string; name: string; quantity: number; revision: number;
  mechanics: Extract<ItemMechanics, { kind: 'consumable' }>;
}
export function carriedItemAbility(item: CarriedItem): Ability {
  if (!item.id || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 9999
    || item.mechanics.kind !== 'consumable') throw new Error('携行物品规格损坏');
  if (item.mechanics.recipe.mechanism !== 'heal') {
    const mechanism = item.mechanics.recipe.mechanism as ConsumableKind;
    if (!Object.hasOwn(CONSUMABLE_NAMES, mechanism)) throw Error('未知消耗品用途');
    const hostile = mechanism === 'grenade';
    return { id: 'item:' + item.id, itemSourceId: item.id, name: '使用' + item.name, category: '物品', customized: true,
      desc: `消耗1件${CONSUMABLE_NAMES[mechanism]}，占用本次主要行动`,
      cost: { resource: 'item:' + item.id, amount: 1 }, target: hostile ? 'enemy' : 'ally',
      range: { min: 0, max: hostile ? 3 : 1, metric: 'grid', allowEngaged: true, requiresLineOfSight: true },
      ...(hostile ? { delivery: 'ranged' as const, channel: 'kinetic' as const, penetration: 2 * item.mechanics.recipe.power, shape: 'burst' as const } : {}),
      ...(mechanism === 'repair' ? { targetBody: 'vehicle' as const } : {}), effects: [structuredClone(item.mechanics.effect)] };
  }
  const effect = item.mechanics.effect;
  if (effect.op !== 'heal' || !Number.isSafeInteger(effect.amount) || !effect.amount || effect.amount <= 0) throw Error('治疗用品的恢复量不正确');
  return { id: 'item:' + item.id, itemSourceId: item.id, name: '使用' + item.name, category: '物品',
    desc: `消耗1件，最多恢复生命或可救伤兵${effect.amount}；占主行动，友方相邻或自身`,
    cost: { resource: 'item:' + item.id, amount: 1 }, target: 'ally',
    range: { min: 0, max: 1, metric: 'grid', allowEngaged: true, requiresLineOfSight: true },
    effects: [structuredClone(item.mechanics.effect)] };
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
  if (items.length) next.carriedItems = structuredClone(items);
  for (const item of items) { const action = carriedItemAbility(item); next.abilities.push(action); next.resources[action.cost!.resource] = item.quantity; }
  return next;
}

/** 物品编译不依赖持有者等级，也不生成临时人物；效果创建后冻结。 */
export function compileItem(spec: ItemSpecification, identity: Pick<EquipmentContext, 'id' | 'name' | 'seed' | 'creatingUnit'>): ItemMechanics {
  validateEnhancements(spec.bonuses, spec.kind);
  const context = { ...identity, body: spec.body, quality: spec.quality, bonuses: spec.bonuses };
  switch (spec.kind) {
    case 'weapon': return { kind: 'weapon', value: compileWeapon(spec, context) };
    case 'armor': return { kind: 'armor', value: compileArmor(spec, context) };
    case 'shield': return { kind: 'shield', value: { id: identity.id, name: identity.name ?? '盾牌', load: 2, recipe: equipmentRecipe('shield', spec.power, context) } };
    case 'consumable': {
      if (!Object.hasOwn(CONSUMABLE_NAMES, spec.mechanism)) throw new Error('不支持的消耗品用途');
      const recipe = equipmentRecipe('heal', spec.power, context); recipe.mechanism = spec.mechanism;
      const amount = Math.max(1, Math.round(curveAt(recipe.power).hp * 0.25 * bonusMultiplier(recipe.bonuses, 'healing') * (0.85 + recipe.quality * 0.05)));
      const effect: ConsumableEffect = spec.mechanism === 'restore' ? { op: 'resource', resource: 'SP', amount: 2 + Math.ceil(recipe.power / 2), maximum: 'training' }
        : spec.mechanism === 'cleanse' ? { op: 'dispel', polarity: 'negative', count: recipe.power >= 6 ? 2 : 1 }
        : spec.mechanism === 'empower' ? { op: 'condition', conditionId: 'empowered', dur: 3, magnitude: 1 }
        : spec.mechanism === 'barrier' ? { op: 'barrier', amount: amount * 2, dur: 3 }
        : spec.mechanism === 'grenade' ? { op: 'damage', baseDice: `${Math.max(1, Math.ceil(recipe.power / 2))}d6`, shape: 'burst' }
        : { op: 'heal', amount };
      return { kind: 'consumable', recipe, effect };
    }
    case 'accessory': {
      if (!Object.hasOwn(ACCESSORY_NAMES, spec.mechanism)) throw Error('不支持的配件用途');
      const recipe = equipmentRecipe('accessory:' + spec.mechanism, spec.power, context);
      const traitId = ({ guardian: 'guardian', night: 'night-fighter', woodland: 'forest-lore', endurance: 'fatigue-trained' } as Partial<Record<AccessoryKind, string>>)[spec.mechanism];
      const value: AccessoryItem = { id: identity.id, name: identity.name ?? ACCESSORY_NAMES[spec.mechanism], load: 1, recipe, ...(traitId ? { traitId } : {}) };
      if (!traitId) value.ability = { id: 'equipment:' + identity.id, equipmentSourceId: identity.id, name: value.name,
        customized: true, category: '装备能力', target: 'ally', delivery: 'magic', power: recipe.power,
        desc: '装备时可用，每场战斗最多使用两次，每次消耗2点精力。', cost: { resource: 'SP', amount: 2 }, usesPerBattle: 2,
        range: { min: 0, max: 3, metric: 'grid', allowEngaged: true, requiresLineOfSight: true },
        effects: [spec.mechanism === 'cleansing' ? { op: 'dispel', polarity: 'negative', count: recipe.power >= 6 ? 2 : 1 }
          : spec.mechanism === 'barrier' ? { op: 'barrier', amount: 6 + recipe.power * 4, dur: 3 }
          : { op: 'heal', amount: 4 + recipe.power * 3 }] };
      return { kind: 'accessory', value };
    }
    default: throw new Error('不支持的物品用途');
  }
}

/** 生成、换装和动作共同检查当前真实装备，不会调整或重掷实例。 */
export function equipmentReason(unit: Pick<Combatant, 'body' | 'scale' | 'weapon' | 'sidearm' | 'armor' | 'shield' | 'accessories'>): string | undefined {
  const body = BODY[unit.body ?? 'human'];
  if (!body) return '不支持的身体/平台';
  for (const weapon of [unit.weapon, unit.sidearm]) {
    if (weapon?.recipe?.stabilized && unit.body !== 'vehicle') return '稳定车载武器需要实际车辆平台，不能由步行或骑乘单位装备';
    if (['cannon', 'indirect-cannon', 'autocannon'].includes(weapon?.recipe?.mechanism ?? '') && unit.scale === 'hero' && (unit.body ?? 'human') === 'human') return '重型攻击需要炮组或明确载具/大型平台';
  }
  const accessories = Object.values(unit.accessories ?? {}).filter((item): item is AccessoryItem => !!item);
  if (new Set(accessories.map(item => item.recipe.mechanism)).size !== accessories.length) return '同类配件只能装备一件';
  const load = (unit.weapon?.load ?? 0) + (unit.sidearm?.load ?? 0) + (unit.armor?.load ?? 0) + (unit.shield?.load ?? 0) + accessories.reduce((sum, item) => sum + item.load, 0);
  return load > body.capacity ? `负重 ${load} 超过身体容量 ${body.capacity}` : undefined;
}

/** 装备授予的能力始终跟随实物；卸下后不残留为已学技能。 */
export function syncAccessoryAbilities(unit: Combatant): void {
  const old = new Set(unit.abilities.filter(a => a.equipmentSourceId).map(a => a.id));
  unit.abilities = [...unit.abilities.filter(a => !a.equipmentSourceId), ...Object.values(unit.accessories ?? {}).flatMap(item => item?.ability ? [structuredClone(item.ability)] : [])];
  const remaining = new Set(unit.abilities.map(a => a.id));
  unit.abilityState = unit.abilityState.filter(state => !old.has(state.abilityId) || remaining.has(state.abilityId));
  if (unit.preparedAbilityIds) unit.preparedAbilityIds = unit.preparedAbilityIds.filter(id => !old.has(id));
}

/** 配件效果由现存实物决定，读档不能附加另一种被动能力或无限使用次数。 */
export function validateAccessories(unit: Combatant): void {
  if (unit.accessories === undefined) {
    if (unit.abilities?.some(a=>a.equipmentSourceId)) throw Error('装备能力缺少对应配件');
    return;
  }
  if (!unit.accessories || Array.isArray(unit.accessories) || typeof unit.accessories!=='object' || Object.keys(unit.accessories).some(key=>!['accessory1','accessory2'].includes(key))) throw Error('配件栏记录不正确');
  const ids=new Set<string>(),kinds=new Set<string>();
  const definition=(a:Ability|undefined)=>a?JSON.stringify({...a,name:undefined,desc:undefined,category:undefined},(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]])):value):undefined;
  for(const item of Object.values(unit.accessories)) {
    if(!item || typeof item.id!=='string' || !item.id || typeof item.name!=='string' || !item.recipe || typeof item.recipe.mechanism!=='string' || !item.recipe.mechanism.startsWith('accessory:') || ids.has(item.id) || kinds.has(item.recipe.mechanism))throw Error('配件记录不完整或重复');
    ids.add(item.id);kinds.add(item.recipe.mechanism);
    const r=item.recipe,expected=compileItem({kind:'accessory',mechanism:r.mechanism.slice(10) as AccessoryKind,power:r.power,quality:r.quality,body:r.size,bonuses:r.bonuses},{id:item.id,name:item.name,seed:r.seed});
    if(expected.kind!=='accessory' || item.load!==expected.value.load || item.traitId!==expected.value.traitId || definition(item.ability)!==definition(expected.value.ability))throw Error('配件效果与物品类型不一致');
    const granted=unit.abilities?.filter(a=>a.equipmentSourceId===item.id)??[];
    if(granted.length!==(item.ability?1:0) || item.ability&&definition(granted[0])!==definition(item.ability))throw Error('装备能力与对应配件不一致');
  }
  if(unit.abilities?.some(a=>a.equipmentSourceId&&!ids.has(a.equipmentSourceId)))throw Error('装备能力缺少对应配件');
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
