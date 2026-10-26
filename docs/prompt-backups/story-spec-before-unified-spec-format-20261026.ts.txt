import { enhancementLabel } from '../../engine/src/enhancements.js';
import { WEAPON_CLASSES, SHIELD_CLASSES, type ShieldClass } from '../../engine/src/data/weapons.js';
import { skillDefinitionName } from '../../engine/src/skill-catalog.js';
import { skillMechanismFromId, skillMechanismName } from '../../engine/src/data/skill-mechanisms.js';
import type { Ability } from '../../engine/src/types.js';
import type { InventoryItem } from './inventory-state.js';

/** 正文资料沿用已确认的属性行；只转换身份字段，名称与规格中的文字保持原样。 */
export function storyFields(fields: Record<string, string | number | boolean | undefined>, publicId: (id: string) => string): string {
  return Object.entries(fields).filter(([, value]) => value !== undefined).map(([key, value]) => {
    const text = typeof value === 'string' && ['id', 'owner'].includes(key) ? publicId(value) : String(value);
    return key + '="' + text.replace(/[&"<>\r\n]/g, c => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;', '\r': '&#13;', '\n': '&#10;' })[c]!) + '"';
  }).join(' ');
}

export function storyEquipmentSpec(item: InventoryItem): string {
  const m = item.mechanics;
  if (!m || m.kind === 'item') return item.name;
  const recipe = m.value.recipe;
  const mechanism = m.kind === 'weapon' ? WEAPON_CLASSES[recipe?.mechanism ?? '']?.name
    : m.kind === 'armor' ? ['无甲', '轻甲', '中甲', '重甲', '超重甲'][m.value.tier]
    : SHIELD_CLASSES[(recipe?.mechanism ?? 'shield') as ShieldClass]?.name;
  // 无可信配方的自定义实物只保留名字，不能从当前公式猜造旧实物规格。
  return mechanism && recipe ? item.name + ':' + mechanism + 'L' + recipe.power + enhancementLabel(recipe.bonuses) : item.name;
}

export function storySkillSpec(ability: Ability): string {
  const mechanism = ability.recipe ?? skillMechanismFromId(ability.definitionId ?? '');
  const power = ability.power ?? ability.recipe?.power;
  if (!mechanism) return ability.name + (ability.definitionId && !ability.customized ? ':' + skillDefinitionName(ability.definitionId) + (power === undefined ? '' : 'L' + power) : '');
  const words = skillMechanismName(mechanism).replace(/^增益/, 'buff').replace(/^减益/, 'debuff');
  const graded = mechanism.categoryPower !== undefined || Object.keys(mechanism.modifierPowers ?? {}).length > 0;
  return ability.name + ':' + (graded ? '（' + words + '）' : words) + (power === undefined ? '' : 'L' + power) + enhancementLabel(ability.bonuses);
}
