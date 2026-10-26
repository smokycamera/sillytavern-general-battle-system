import { enhancementLabel, type Enhancements } from '../../engine/src/enhancements.js';
import { WEAPON_CLASSES, SHIELD_CLASSES, type ShieldClass } from '../../engine/src/data/weapons.js';
import { skillDefinitionName } from '../../engine/src/skill-catalog.js';
import { skillMechanismFromId, skillMechanismName, SKILL_CATEGORIES, SKILL_MODIFIERS, MOVEMENT_MODIFIERS, acceptsModifierPower, type SkillMechanism } from '../../engine/src/data/skill-mechanisms.js';
import type { Ability, Combatant } from '../../engine/src/types.js';
import type { TraitSource } from '../../engine/src/trait-sources.js';
import { storyRoundEndId } from '../../engine/src/story-effect-types.js';
import { parseSkillMechanism } from '../../engine/src/data/skill-mechanisms.js';
import { canonicalTraitId } from '../../engine/src/trait-parameters.js';
import { normalizeNarrativeSkill } from './spec-tolerance.js';
import { splitSkillLevel } from './skill-notation.js';
import { parseEnhancementSuffix } from '../../engine/src/enhancements.js';
import { itemSpecText } from '../../engine/src/items.js';
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
  return ability.name + ':' + storyMechanismSpec(mechanism, power, ability.bonuses);
}

/** 正文只看仍有效的效果与标准规格；冻结来源不重编，部分解除不改其强度或期限。 */
export function storyEffectSpec(source: TraitSource, unit: Combatant): string | undefined {
  if (!source.specification || source.conditions === undefined) return undefined;
  const normalized = normalizeNarrativeSkill(source.specification, []), separator = normalized.indexOf(':');
  const notation = splitSkillLevel(normalized.slice(separator + 1));
  const mechanism = parseSkillMechanism(notation.mechanism);
  if (!mechanism) return undefined;
  const conditions = new Set(unit.conditions.filter(c => c.effectSourceId === source.id && c.dur > 0).map(c => c.id));
  const barrier = !!source.barrier && !!unit.barrier?.grants?.some(g => g.effectSourceId === source.id && g.remaining > 0);
  const periodic = new Set(source.roundEndEffects?.map(storyRoundEndId));
  if (!conditions.size && !source.traitIds.length && !barrier && !periodic.size) return undefined;
  const modifiers = mechanism.modifiers.filter(id => {
    const modifier = SKILL_MODIFIERS.find(m => m.id === id)!;
    if (modifier.trait) return source.traitIds.includes(canonicalTraitId(modifier.trait, true));
    if (id === 'ward') return source.traitIds.includes('guardian') || conditions.has('blessed');
    if (modifier.condition) return conditions.has(modifier.condition);
    if (id === 'barrier') return barrier;
    if (periodic.has(id as ReturnType<typeof storyRoundEndId>)) return true;
    return id === 'martial';
  });
  const bonuses = notation.suffix ? parseEnhancementSuffix('技能L' + notation.level + notation.suffix, 'skill').bonuses : undefined;
  return source.name + ':' + storyMechanismSpec({ ...mechanism, modifiers }, notation.level, bonuses);
}

/** 只整理正文规格，不修改已保存的配方与冻结效果。 */
function storyMechanismSpec(mechanism: SkillMechanism, power: number | undefined, bonuses?: Enhancements): string {
  // 历史组合可以另有主体伤害等级；保留括号共享等级，避免复制回去时把技能整体等级改掉。
  if (power === undefined || mechanism.categoryPower !== undefined && mechanism.categoryPower !== power) {
    const words = skillMechanismName(mechanism).replace(/^增益/, 'buff').replace(/^减益/, 'debuff');
    return (power === undefined ? words : '（' + words + '）L' + power) + enhancementLabel(bonuses);
  }
  const category = mechanism.category === 'buff' ? 'buff' : mechanism.category === 'debuff' ? 'debuff' : SKILL_CATEGORIES.find(c => c.id === mechanism.category)!.name;
  const area = mechanism.area && !mechanism.category.endsWith('area') ? '范围' : '';
  const ids = mechanism.modifiers.length ? mechanism.modifiers : mechanism.category === 'buff' ? ['attack', 'defense'] : mechanism.category === 'debuff' ? ['weaken'] : [];
  const words = [...ids].sort((a,b) => Number(MOVEMENT_MODIFIERS.includes(a)) - Number(MOVEMENT_MODIFIERS.includes(b))).map(id => {
    const modifier = SKILL_MODIFIERS.find(m => m.id === id)!;
    return modifier.name.replace(/^特质/, '') + (acceptsModifierPower(modifier) ? 'L' + (mechanism.modifierPowers?.[id] ?? power) : '');
  });
  return category + area + 'L' + power + (words.length ? '+' + words.join('+') : '') + enhancementLabel(bonuses);
}

export function storyItemSpec(item: InventoryItem): string {
  const m = item.mechanics;
  if (!m || m.kind !== 'item') return item.name;
  const recipe = m.value.recipe;
  if (recipe.form === 'worn') return item.name + ':' + itemSpecText(recipe);
  const mechanism = skillMechanismFromId(recipe.active ?? '');
  return item.name + ':' + (mechanism ? (recipe.form === 'charged' ? '充能+' : '') + storyMechanismSpec(mechanism, recipe.power, recipe.bonuses) : itemSpecText(recipe));
}
