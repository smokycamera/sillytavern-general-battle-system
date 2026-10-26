import type { Combatant } from './types.js';
import { canonicalTraitId } from './trait-parameters.js';
import { traitSourceActive, revokeTraitSource } from './trait-sources.js';

/** 部分解除保留原来源作为重放凭据；剩余内容复制到同期限的子来源。 */
export function clearEffectSources(unit: Combatant, clear: ReadonlySet<string>, operationId: string, onlySource?: string): void {
  const all = clear.has('all');
  for (const source of [...unit.traitSources ?? []]) {
    if (source.kind === 'equipment' || !traitSourceActive(unit, source) || onlySource && source.id !== onlySource) continue;
    const traits = all ? [] : source.traitIds.filter(id => !clear.has(canonicalTraitId(id, true)));
    const conditions = all ? [] : (source.conditionIds ?? []).filter(id => !clear.has(id));
    const barrier = source.barrier && !all && !clear.has('barrier') ? source.barrier : undefined;
    if (!all && traits.length === source.traitIds.length && conditions.length === (source.conditionIds?.length ?? 0) && barrier === source.barrier) continue;
    if (traits.length || conditions.length || barrier) {
      const remaining = structuredClone(source), base = `${source.id}:clear:${operationId}`;
      let id = base;
      for (let n = 2; unit.traitSources!.some(existing => existing.id === id); n++) id = `${base}:${n}`;
      remaining.id = id;
      remaining.traitIds = traits;
      if (source.conditionIds !== undefined) remaining.conditionIds = conditions;
      if (source.conditions !== undefined) remaining.conditions = source.conditions.filter(c => conditions.includes(c.id)).map(c => ({ ...c }));
      if (!barrier) delete remaining.barrier;
      if (remaining.traitLevels) remaining.traitLevels = Object.fromEntries(Object.entries(remaining.traitLevels).filter(([trait]) => traits.includes(trait)));
      unit.traitSources!.push(remaining);
      // 先接续剩余状态，再撤销旧来源，不能重建已驱散的状态或重置其运行状态。
      for (const condition of unit.conditions) if (condition.effectSourceId === source.id && conditions.includes(condition.id)) condition.effectSourceId = id;
      if (barrier && unit.barrier?.sourceId === source.id) unit.barrier.sourceId = id;
      if (barrier) for (const grant of unit.barrier?.grants ?? []) if (grant.effectSourceId === source.id) grant.effectSourceId = id;
    }
    revokeTraitSource(unit, source.id);
  }
}
