import { expireTraitSources, revokeTraitSource, traitRegistry, type Combatant } from '../../engine/src/index.js';
import { materializeUnitRecord, unitRecordFromCombatant } from './unit-state.js';
import type { NarrativeSave } from './narrative-state.js';

/** 保护外部来源不被普通编辑覆盖；战果只允许引擎期限进度的一次归档。 */
export function assertTraitSourcePanelWrite(previous: NarrativeSave, next: NarrativeSave): void {
  const battle = next.battle;
  const id = battle ? `${battle.kind}:${String(battle.snap.seed)}` : undefined;
  const committing = !!id && !(previous.committedOutcomeIds ?? []).includes(id) && (next.committedOutcomeIds ?? []).includes(id);
  for (const record of next.storage ?? []) {
    const old = previous.storage?.find((r) => r.id === record.id);
    const incoming = record.snapshot?.traitSources ?? [];
    if (JSON.stringify(old?.snapshot?.traitSources ?? []) === JSON.stringify(incoming)) continue;
    const combatant = committing && (battle!.snap.combatants as Combatant[] | undefined)?.find((u) => u.id === record.id);
    if (!combatant) throw new Error('祝福、增减益及装备来源须经来源事务修改，不能被普通编辑覆盖');
    const final = structuredClone(combatant); expireTraitSources(final, 'battles');
    if (JSON.stringify(final.traitSources ?? []) !== JSON.stringify(incoming)) throw new Error('战果来源期限与引擎快照不一致');
  }
}
export function prepareBlessingRevocation(save: NarrativeSave, unitId: string, sourceId: string): NarrativeSave {
  if (save.battle && !(save.committedOutcomeIds ?? []).includes(`${save.battle.kind}:${String(save.battle.snap.seed)}`)) throw new Error('战中不能通过档案操作撤销效果');
  const record = save.storage?.find((r) => r.id === unitId);
  if (!record) throw new Error('单位档案不存在');
  const unit = materializeUnitRecord(record, traitRegistry());
  const source = unit.traitSources?.find((s) => s.id === sourceId);
  if (!source || source.kind === 'equipment') throw new Error('需要本单位的剧情效果来源');
  if (source.revoked) return structuredClone(save);
  revokeTraitSource(unit, sourceId);
  return { ...structuredClone(save), storage: save.storage!.map((r) => r.id === unitId ? unitRecordFromCombatant(unit, record, { kind: 'update', sourceId: 'revoke:' + sourceId }) : structuredClone(r)), factRevision: (save.factRevision ?? 0) + 1 };
}
