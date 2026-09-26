import type { Ability, Combatant } from './types.js';
import { ABILITY_BLUEPRINTS, type BlueprintSpec } from './data/ability-blueprints.js';
import { MAX_PREPARED_SKILLS, compileSkill, resolvePreparedSkills, skillDefinitionKnown, skillDefinitionName } from './skill-catalog.js';
import { meleeWeapon, isRangedWeapon } from './loadout.js';
import { isCohort } from './combat-model.js';
import { upgradeCombatSkills } from './skill-upgrade.js';

export function abilityPower(unit: Combatant, ability: Ability): number {
  if (ability.fixedPower) return 1;
  if (ability.power !== undefined) return ability.power;
  const input = unit.genAudit?.input.abilityBlueprints?.find((s) => (typeof s === 'string' ? s : s.id) === (ability.definitionId ?? ability.id));
  return typeof input === 'object' ? input.level ?? 5 : 5;
}
function canPrepare(unit: Combatant, ability: Ability): boolean {
  return !ability.equipmentSourceId && !ability.itemSourceId && !ability.unavailableReason && !(ability.requires === 'shield' && !unit.shield)
    && !(ability.weaponUse === 'ranged' && ![unit.weapon, unit.sidearm].some((w) => !!w && isRangedWeapon(w)))
    && !(ability.weaponUse === 'melee' && !meleeWeapon(unit)) && !(ability.requires === 'weapon' && !unit.weapon && !unit.sidearm)
    && !(ability.requires === 'melee' && !meleeWeapon(unit)) && !(ability.requires === 'reserve' && !((unit.resources.reserve ?? 0) > 0));
}
/** 逐项学习/替换。未涉及的实例保留；改名、删除后重学都不清除当前冷却/次数账本。 */
export function learnAbilities(unit: Combatant, specs: BlueprintSpec[], opts: { replace?: boolean; prepared?: string[]; rebuildRequested?: boolean } = {}): Combatant {
  if (unit.rulesVersion !== 'v2') throw new Error('学习新技能需要V2档案');
  const ids = specs.map((s) => typeof s === 'string' ? s : s.instanceId ?? (s.id.startsWith('generic:') ? 'name:' + (s.name?.trim() || skillDefinitionName(s.id)) : s.id));
  if (new Set(ids).size !== ids.length) throw new Error('同一技能请合并为一项学习规格');
  const next = structuredClone(unit), replacements = new Map<string, Ability>();
  for (const spec of specs) {
    const id = typeof spec === 'string' ? spec : spec.id, bp = ABILITY_BLUEPRINTS[id];
    if (!skillDefinitionKnown(id)) throw new Error('未知学习效果');
    const generic = id.startsWith('generic:'), instanceId = typeof spec === 'string' ? undefined : spec.instanceId;
    const named = (typeof spec === 'string' ? undefined : spec.name)?.trim() || skillDefinitionName(id);
    const candidates = instanceId ? unit.abilities.filter((a) => a.id === instanceId)
      : generic ? unit.abilities.filter((a) => !a.itemSourceId && !a.equipmentSourceId && a.name === named) : unit.abilities.filter((a) => (a.definitionId ?? a.id) === id);
    if (candidates.length > 1 || instanceId && !candidates.length) throw new Error('技能身份不唯一或已失效，请在面板选择具体记录');
    const old = candidates[0];
    if (old?.equipmentSourceId || old?.itemSourceId) throw Error('物品提供的能力请在装备页修改');
    if (id === 'bp-raise-dead') { if (!old) throw new Error('尸体苏生不在当前学习范围'); replacements.set(old.id, structuredClone(old)); continue; }
    const requested = typeof spec === 'string' ? undefined : spec.level;
    if (requested !== undefined && (!Number.isSafeInteger(requested) || requested < 1 || requested > 10)) throw new Error('技能等级必须为1–10整数');
    const power = bp?.fixedPower ? 1 : requested ?? (old ? abilityPower(unit, old) : 5);
    const name = (typeof spec === 'string' ? undefined : spec.name)?.trim() || old?.name || skillDefinitionName(id);
    const rebuild = typeof spec !== 'string' && spec.bonuses !== undefined && JSON.stringify(spec.bonuses) !== JSON.stringify(old?.bonuses) || !old || old.definitionId !== id || power !== abilityPower(unit, old) || opts.rebuildRequested && requested !== undefined;
    const ability = rebuild ? compileSkill(typeof spec === 'string' ? { id, name } : { ...spec, bonuses: spec.bonuses ?? old?.bonuses, name }, power, unit.id) : { ...structuredClone(old!), name };
    if (!generic && !old && unit.genAudit?.seed) ability.id = `unit:${encodeURIComponent(unit.genAudit.seed)}:${id}`;
    if (old) {
      ability.id = old.id; ability.sourceId = old.sourceId ?? unit.id;
      if (!generic) ability.cooldownGroup = old.cooldownGroup ?? old.definitionId ?? old.id;
      const prior = next.abilityState.find((s) => s.abilityId === (old.cooldownGroup ?? old.id));
      if (prior && prior.abilityId !== ability.cooldownGroup) {
        const group = next.abilityState.find((s) => s.abilityId === ability.cooldownGroup);
        if (group) { group.cdLeft = Math.max(group.cdLeft, prior.cdLeft); group.used = Math.max(group.used, prior.used); }
        else next.abilityState.push({ ...prior, abilityId: ability.cooldownGroup! });
      }
    }
    replacements.set(ability.id, ability);
  }
  const key = (a: Ability) => a.definitionId ?? a.id;
  next.abilities = opts.replace
    ? [...unit.abilities.filter((a) => !skillDefinitionKnown(key(a))).map((a) => structuredClone(a)), ...replacements.values()]
    : [...unit.abilities.map((a) => replacements.get(a.id) ?? structuredClone(a)), ...[...replacements].filter(([id]) => !unit.abilities.some((a) => a.id === id)).map(([, a]) => a)];
  if (new Set(next.abilities.map((a) => a.id)).size !== next.abilities.length) throw new Error('技能唯一编号冲突');
  if (opts.prepared) {
    next.preparedAbilityIds = resolvePreparedSkills(next.abilities, opts.prepared);
  } else {
    next.preparedAbilityIds = (unit.preparedAbilityIds ?? []).filter((id) => next.abilities.some((a) => a.id === id)).slice(0, MAX_PREPARED_SKILLS);
    for (const ability of next.abilities) if (next.preparedAbilityIds.length < MAX_PREPARED_SKILLS && !next.preparedAbilityIds.includes(ability.id) && canPrepare(next, ability)) next.preparedAbilityIds.push(ability.id);
  }
  if (next.genAudit) {
    next.genAudit.input.abilityBlueprints = next.abilities.filter((a) => skillDefinitionKnown(key(a))).map((a) => ({ id: key(a), ...(a.recipe ? { instanceId: a.id } : {}), ...(a.fixedPower ? {} : { level: abilityPower(next, a) }), name: a.name, bonuses: a.bonuses }));
    next.genAudit.input.abilityIds = undefined;
    next.genAudit.input.preparedAbilityIds = next.abilities.filter((a) => next.preparedAbilityIds?.includes(a.id)).map((a) => a.recipe ? a.id : key(a));
    next.genAudit.abilities = next.abilities.filter((a) => skillDefinitionKnown(key(a))).map((a) => ({ blueprintId: key(a), power: abilityPower(next, a) }));
  }
  if(isCohort(next))upgradeCombatSkills(next);
  return next;
}
