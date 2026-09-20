import { validateEnhancements } from './enhancements.js';
import type { Ability } from './types.js';
import { ABILITY_BLUEPRINTS, type BlueprintSpec } from './data/ability-blueprints.js';
import { parseSkillMechanism, skillMechanismFromId, skillMechanismId, skillMechanismName } from './data/skill-mechanisms.js';
import { compileAbility } from './gen/abilities.js';
import { compileGenericSkill } from './gen/generic-skills.js';

export const MAX_PREPARED_SKILLS = 5;

export function skillDefinitionKnown(id: string): boolean { return !!skillMechanismFromId(id) || !!ABILITY_BLUEPRINTS[id]; }
export function skillDefinitionName(id: string): string { return skillMechanismName(id) || ABILITY_BLUEPRINTS[id]?.name || id.replace(/^invalid:/, ''); }
export function skillDefinitionId(text: string): string | undefined {
  if (skillDefinitionKnown(text)) return text;
  const mechanism = parseSkillMechanism(text); if (mechanism) return skillMechanismId(mechanism);
  return Object.values(ABILITY_BLUEPRINTS).find((bp) => bp.name === text)?.id;
}
export function compileSkill(spec: BlueprintSpec, power: number, ownerId: string): Ability {
  const id = typeof spec === 'string' ? spec : spec.id, name = typeof spec === 'string' ? undefined : spec.name;
  const ability = id.startsWith('generic:') ? compileGenericSkill(id, power, ownerId, name)
    : ABILITY_BLUEPRINTS[id] ? compileAbility(ABILITY_BLUEPRINTS[id]!, power, ownerId, name) : undefined;
  if (typeof spec !== 'string') { validateEnhancements(spec.bonuses, 'skill'); if (ability) ability.bonuses = spec.bonuses; }
  if (!ability) throw new Error('未知技能机制：' + skillDefinitionName(id));
  if (typeof spec !== 'string' && spec.instanceId) ability.id = spec.instanceId;
  return ability;
}
export function resolvePreparedSkills(abilities: Ability[], requested: string[]): string[] {
  const result = requested.map((id) => {
    const exact = abilities.find((a) => a.id === id); if (exact) return exact.id;
    const family = abilities.filter((a) => a.definitionId === id);
    if (family.length !== 1) throw new Error('准备技能需指向唯一已学实例');
    return family[0]!.id;
  });
  if (result.length > MAX_PREPARED_SKILLS || new Set(result).size !== result.length) throw new Error(`准备技能最多${MAX_PREPARED_SKILLS}个且不能重复`);
  return result;
}
