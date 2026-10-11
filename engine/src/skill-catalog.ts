import { validateEnhancements } from './enhancements.js';
import type { Ability } from './types.js';
import { ABILITY_BLUEPRINTS, CATEGORY_LABELS, type BlueprintSpec, type Category } from './data/ability-blueprints.js';
import { parseSkillMechanism, skillMechanismFromId, skillMechanismId, skillMechanismName } from './data/skill-mechanisms.js';
import { compileAbility } from './gen/abilities.js';
import { compileGenericSkill } from './gen/generic-skills.js';
import { upgradeZoneSkill } from './zone-skills.js';
import { attachDefensePower } from './barrier.js';
import type { SkillModel } from './skill-model.js';

export const MAX_PREPARED_SKILLS = 5;

export function skillDefinitionKnown(id: string): boolean { return !!skillMechanismFromId(id) || !!ABILITY_BLUEPRINTS[id]; }
export function skillDefinitionName(id: string): string { return skillMechanismName(id) || ABILITY_BLUEPRINTS[id]?.name || id.replace(/^invalid:/, ''); }
/** 旧版预制技能与九类简称的新写法：新输入一律落到通用机制，避免“防御”变成必须持盾的铁壁、“诅咒”变成伤害法术。
 *  已学的 bp-* 技能照旧结算；呼叫援军（调用预备兵力）与亡者苏生没有通用对应，保留原定义。 */
export const LEGACY_SKILL_EQUIVALENTS: Readonly<Record<string, string>> = {
  'bp-binding': '减益定身', 'bp-shield-bash': '物理单体盾牌+击退', 'bp-force-wave': '魔法单体击退', 'bp-purify': '增益净化', 'bp-unravel': '减益驱散',
  'bp-mending': '增益治疗', 'bp-field-triage': '增益治疗', 'bp-crushing-blow': '物理单体近战', 'bp-assassinate': '物理单体近战',
  'bp-whirlwind': '物理范围近战', 'bp-grenade': '物理范围投射', 'bp-arcane-bolt': '魔法单体', 'bp-smite': '魔法单体', 'bp-hex-bolt': '魔法单体诅咒',
  'bp-firestorm': '魔法范围热能', 'bp-frost-nova': '魔法范围热能+减速', 'bp-iron-guard': '增益防御', 'bp-aegis-shield': '增益防御',
  'bp-dread-howl': '减益范围惊惧+士气', 'bp-demoralize': '减益范围惊惧+士气', 'bp-battle-hymn': '增益攻击+士气', 'bp-courage-horn': '增益攻击+士气',
};
const LEGACY_CATEGORY_EQUIVALENTS: Partial<Record<Category, string>> = { defense: '增益防御', 'morale-dmg': '减益范围惊惧+士气', 'morale-buff': '增益攻击+士气' };
/** 旧技能名、旧 bp 名称或九类简称对应的通用机制 id；fuzzy 时也接受名称互相包含（“烈焰”→烈焰风暴）。精确 bp id（存档内部）不在此改写。 */
export function legacySkillEquivalent(text: string, fuzzy = false): { id: string; legacy: string } | undefined {
  const name = text.trim();
  if (!name) return undefined;
  const blueprints = Object.values(ABILITY_BLUEPRINTS);
  const bp = blueprints.find((b) => b.name === name) ?? (fuzzy && !(Object.values(CATEGORY_LABELS) as string[]).includes(name) ? blueprints.find((b) => b.name.includes(name) || name.includes(b.name)) : undefined);
  const category = (Object.keys(CATEGORY_LABELS) as Category[]).find((c) => CATEGORY_LABELS[c] === name);
  const target = bp ? LEGACY_SKILL_EQUIVALENTS[bp.id] : category ? LEGACY_CATEGORY_EQUIVALENTS[category] : undefined;
  const mechanism = target ? parseSkillMechanism(target) : undefined;
  return mechanism ? { id: skillMechanismId(mechanism), legacy: bp?.name ?? name } : undefined;
}
export function skillDefinitionId(text: string): string | undefined {
  if (skillDefinitionKnown(text)) return text;
  const mechanism = parseSkillMechanism(text); if (mechanism) return skillMechanismId(mechanism);
  return legacySkillEquivalent(text)?.id ?? Object.values(ABILITY_BLUEPRINTS).find((bp) => bp.name === text)?.id;
}
export function compileSkill(spec: BlueprintSpec, power: number, ownerId: string, formula?: SkillModel): Ability {
  const id = typeof spec === 'string' ? spec : spec.id, name = typeof spec === 'string' ? undefined : spec.name;
  const ability = id.startsWith('generic:') ? compileGenericSkill(id, power, ownerId, name, undefined, formula)
    : ABILITY_BLUEPRINTS[id] ? compileAbility(ABILITY_BLUEPRINTS[id]!, power, ownerId, name) : undefined;
  if (typeof spec !== 'string') { validateEnhancements(spec.bonuses, 'skill'); if (ability) ability.bonuses = spec.bonuses; }
  if (!ability) throw new Error('未知技能效果：' + skillDefinitionName(id));
  if (typeof spec !== 'string' && spec.instanceId) ability.id = spec.instanceId;
  upgradeZoneSkill(ability);
  attachDefensePower(ability);
  return ability;
}
export function resolvePreparedSkills(abilities: Ability[], requested: string[]): string[] {
  const result = requested.map((id) => {
    const exact = abilities.find((a) => a.id === id); if (exact) return exact.id;
    const family = abilities.filter((a) => a.definitionId === id);
    if (family.length !== 1) throw new Error('准备技能需指向唯一已学记录');
    return family[0]!.id;
  });
  if (result.length > MAX_PREPARED_SKILLS || new Set(result).size !== result.length) throw new Error(`准备技能最多${MAX_PREPARED_SKILLS}个且不能重复`);
  return result;
}
