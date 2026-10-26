import { canonicalTraitId, resolveTraitId, traitRegistry, standardConditionMap, traitSourceActive, revokeTraitSource, type Combatant } from '../../engine/src/index.js';

/** 正文只需填写状态或授予能力的名称；保存时仍兼容原有状态 id。 */
export function normalizeUnitClear(input: unknown): string[] {
  if (!Array.isArray(input) || !input.length || input.some(value => typeof value !== 'string' || !value.trim())) throw Error('clear需要明确的状态、剧情能力名或all');
  const conditions = standardConditionMap(), traits = traitRegistry();
  const ids = input.flatMap((value: string) => {
    const name = value.trim();
    if (name === '全部' || name.toLowerCase() === 'all') return ['all'];
    const condition = conditions.has(name) ? name : [...conditions.values()].find(entry => entry.name === name)?.id;
    const trait = resolveTraitId(name, traits);
    const found = [condition, trait && canonicalTraitId(trait, true)].filter((id): id is string => !!id);
    if (!found.length) throw Error('clear未知状态或剧情能力：' + name);
    return found;
  });
  return [...new Set(ids)];
}

/** 解除点名的效果；来源部分解除时保留原记录，剩余效果沿用原来的期限。 */
export function clearUnitEffects(unit: Combatant, input: unknown, operationId: string): void {
  const clear = new Set(normalizeUnitClear(input)), all = clear.has('all');
  unit.conditions = all ? [] : unit.conditions.filter(condition => !clear.has(condition.id));
  const sources = (unit.traitSources ?? []).filter(source => source.kind !== 'equipment' && traitSourceActive(unit, source));
  for (const source of sources) {
    const traits = all ? [] : source.traitIds.filter(id => !clear.has(canonicalTraitId(id, true)));
    const conditions = all ? [] : (source.conditionIds ?? []).filter(id => !clear.has(id));
    if (!all && traits.length === source.traitIds.length && conditions.length === (source.conditionIds?.length ?? 0)) continue;
    if (traits.length || conditions.length) {
      const remaining = structuredClone(source), base = `${source.id}:clear:${operationId}`;
      let id = base;
      for (let n = 2; unit.traitSources!.some(existing => existing.id === id); n++) id = `${base}:${n}`;
      remaining.id = id;
      remaining.traitIds = traits;
      if (source.conditionIds !== undefined) remaining.conditionIds = conditions;
      if (remaining.traitLevels) remaining.traitLevels = Object.fromEntries(Object.entries(remaining.traitLevels).filter(([trait]) => traits.includes(trait)));
      // 先保留剩余来源，避免解除其他效果时丢掉仍然有效的再生累计值。
      unit.traitSources!.push(remaining);
    }
    // 原来源与内容保留，重复读取旧授予事件不会重新授予或延长期限。
    revokeTraitSource(unit, source.id);
  }
}
