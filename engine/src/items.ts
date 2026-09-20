import { bonusMultiplier, validateEnhancements, type Enhancements } from './enhancements.js';
import { recoveryCapacity } from './recovery.js';
import {hasMemberHealth} from './member-health.js';
import type { Ability, Armor, BodyKind, Combatant, ItemRecipe, Weapon } from './types.js';
import { curveAt } from './data/curves.js';
import { BODY, compileArmor, compileWeapon, equipmentRecipe, type EquipmentContext } from './gen/equipment.js';

export type EquipmentSlot = 'primary' | 'sidearm' | 'armor' | 'shield';
export type ShieldItem = NonNullable<Combatant['shield']> & { name?: string; recipe?: ItemRecipe };
type ItemSpecificationBase = { bonuses?: Enhancements; power: number; quality?: number; body?: BodyKind };
export type ItemSpecification = ItemSpecificationBase & (
  | { kind: 'weapon'; mechanism: string; enchantment?: 'none' | 'thermal' | 'arcane'; stabilized?: boolean }
  | { kind: 'armor'; tier: Armor['tier']; profile?: ItemRecipe['protectionProfile'] }
  | { kind: 'shield' }
  | { kind: 'consumable'; mechanism: 'heal' }
);
export type ItemMechanics =
  | { kind: 'weapon'; value: Weapon }
  | { kind: 'armor'; value: Armor }
  | { kind: 'shield'; value: ShieldItem }
  | { kind: 'consumable'; recipe: ItemRecipe; effect: { op: 'heal'; amount: number } };

export interface CarriedItem {
  id: string; name: string; quantity: number; revision: number;
  mechanics: Extract<ItemMechanics, { kind: 'consumable' }>;
}
export function carriedItemAbility(item: CarriedItem): Ability {
  if (!item.id || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 9999
    || item.mechanics.kind !== 'consumable' || item.mechanics.effect.op !== 'heal'
    || !Number.isSafeInteger(item.mechanics.effect.amount) || item.mechanics.effect.amount <= 0) throw new Error('携行物品规格损坏');
  return { id: 'item:' + item.id, itemSourceId: item.id, name: '使用' + item.name, category: '物品',
    desc: `消耗1件，最多恢复生命或可救伤兵${item.mechanics.effect.amount}；占主行动，友方相邻或自身`,
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
      if (spec.mechanism !== 'heal') throw new Error('不支持的消耗品机制');
      const recipe = equipmentRecipe('heal', spec.power, context);
      return { kind: 'consumable', recipe, effect: { op: 'heal', amount: Math.max(1, Math.round(curveAt(recipe.power).hp * 0.25 * bonusMultiplier(recipe.bonuses, 'healing') * (0.85 + recipe.quality * 0.05))) } };
    }
    default: throw new Error('不支持的物品机制');
  }
}

/** 生成、换装和动作共同检查当前真实装备，不会调整或重掷实例。 */
export function equipmentReason(unit: Pick<Combatant, 'body' | 'scale' | 'weapon' | 'sidearm' | 'armor' | 'shield'>): string | undefined {
  const body = BODY[unit.body ?? 'human'];
  if (!body) return '不支持的身体/平台';
  for (const weapon of [unit.weapon, unit.sidearm]) {
    if (weapon?.recipe?.stabilized && unit.body !== 'vehicle') return '稳定车载武器需要实际车辆平台，不能由步行或骑乘单位装备';
    if (['cannon', 'autocannon'].includes(weapon?.recipe?.mechanism ?? '') && unit.scale === 'hero' && (unit.body ?? 'human') === 'human') return '重型投送需要炮组或明确载具/大型平台';
  }
  const load = (unit.weapon?.load ?? 0) + (unit.sidearm?.load ?? 0) + (unit.armor?.load ?? 0) + (unit.shield?.load ?? 0);
  return load > body.capacity ? `负载 ${load} 超过身体容量 ${body.capacity}` : undefined;
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
