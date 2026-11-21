import { applyRecovery, recoveryCapacity } from '../../engine/src/recovery.js';
import { memberDurability } from '../../engine/src/combat-model.js';
import { hasMemberHealth } from '../../engine/src/member-health.js';
import type { Combatant, Trait } from '../../engine/src/types.js';
import { materializeUnitRecord, unitRecordFromCombatant, type UnitRecord } from './unit-state.js';

function materializeRecoverable(record: UnitRecord, registry: Map<string, Trait>) {
  if (record.retired || record.status === 'dead' || record.hp <= 0 && record.status !== 'dying') throw Error('阵亡或解散档案不能通过战后恢复复活');
  return materializeUnitRecord(record, registry);
}

function recoverArchivedLife(unit: Combatant, life: number | 'all'): number {
  const capacity = recoveryCapacity(unit);
  if (unit.scale === 'hero' || hasMemberHealth(unit)) {
    return applyRecovery(unit, life === 'all' ? capacity : Math.min(life, capacity));
  }
  const wounded = unit.recoverableWounded ?? 0;
  const limit = Math.min(capacity, wounded);
  const personnel = life === 'all' ? limit : Math.min(limit, Math.floor(life / memberDurability(unit)));
  const restored = applyRecovery(unit, personnel);
  if (restored > 0) unit.recoverableWounded = wounded - restored;
  return restored;
}

/** Explicit out-of-battle treatment. Cohorts recover wounded personnel, not permanent casualties. */
export function recoverUnitRecord(record: UnitRecord, registry: Map<string, Trait>): UnitRecord {
  const unit = materializeRecoverable(record, registry);
  if (unit.status === 'routing' || unit.status === 'fled') unit.status = 'ready';
  recoverArchivedLife(unit, 'all');
  if (unit.hp > 0 && unit.status === 'dying') unit.status = 'ready';
  if (unit.base.moraleMax !== undefined) unit.morale = unit.base.moraleMax;
  return unitRecordFromCombatant(unit, record, { kind: 'update' });
}

/** 剧情治疗使用生命点数。旧编队只记录整员损失，按成员耐久换算可救人数。 */
export function treatUnitRecord(record: UnitRecord, registry: Map<string, Trait>, life: number | 'all', sourceId: string): UnitRecord {
  if (life !== 'all' && (!Number.isSafeInteger(life) || life <= 0)) throw Error('治疗量须为正整数或 all');
  const unit = materializeRecoverable(record, registry);
  const withdrawn = unit.status === 'fled' ? unit.status : undefined;
  if (withdrawn) unit.status = 'ready';
  if (!recoverArchivedLife(unit, life)) return record;
  if (withdrawn) unit.status = withdrawn;
  return unitRecordFromCombatant(unit, record, { kind: 'update', sourceId });
}

export function loseArchivedWounded(record: UnitRecord, registry: Map<string, Trait>, count: number | 'all', sourceId: string): UnitRecord {
  const unit = materializeRecoverable(record, registry);
  const wounded = unit.recoverableWounded ?? 0;
  if (unit.scale === 'hero' || !wounded) throw Error('该档案没有可扣减的可救伤兵');
  const loss = count === 'all' ? wounded : count;
  if (!Number.isSafeInteger(loss) || loss <= 0 || loss > wounded) throw Error('死亡人数须在现有可救伤兵人数以内');
  if (unit.unequippedWounded) unit.unequippedWounded = Math.max(0,unit.unequippedWounded - loss);
  unit.recoverableWounded = wounded - loss;
  if (!unit.hp && !unit.recoverableWounded) unit.status = 'dead';
  return unitRecordFromCombatant(unit, record, { kind: 'update', sourceId });
}
