import { canonicalTraitId, resolveTraitId, traitRegistry, standardConditionMap, type Combatant } from '../../engine/src/index.js';
import { clearEffectSources } from '../../engine/src/effect-sources.js';
import { SKILL_MODIFIERS } from '../../engine/src/data/skill-mechanisms.js';

/** 正文只需填写状态或授予能力的名称；保存时仍兼容原有状态 id。 */
export function normalizeUnitClear(input: unknown): string[] {
  if (!Array.isArray(input) || !input.length || input.some(value => typeof value !== 'string' || !value.trim())) throw Error('clear需要明确的状态、剧情能力名或all');
  const conditions = standardConditionMap(), traits = traitRegistry();
  const ids = input.flatMap((value: string) => {
    const name = value.trim();
    if (name === '全部' || name.toLowerCase() === 'all') return ['all'];
    const condition = conditions.has(name) ? name : [...conditions.values()].find(entry => entry.name === name)?.id;
    const trait = resolveTraitId(name, traits);
    const modifiers = SKILL_MODIFIERS.filter(m => m.name === name || m.id === name);
    const found = [condition, trait && canonicalTraitId(trait, true), ...modifiers.flatMap(m => m.condition ? [m.condition] : m.id === 'barrier' ? ['barrier'] : [])].filter((id): id is string => !!id);
    if (!found.length) throw Error('clear未知状态或剧情能力：' + name);
    return found;
  });
  return [...new Set(ids)];
}

/** 解除点名的效果；来源部分解除时保留原记录，剩余效果沿用原来的期限。 */
export function clearUnitEffects(unit: Combatant, input: unknown, operationId: string): void {
  const clear = new Set(normalizeUnitClear(input)), all = clear.has('all');
  unit.conditions = all ? [] : unit.conditions.filter(condition => !clear.has(condition.id));
  if (all || clear.has('barrier')) delete unit.barrier;
  clearEffectSources(unit, clear, operationId);
}
