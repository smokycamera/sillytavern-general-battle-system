import { applyRecovery, recoveryCapacity } from '../../engine/src/recovery.js';
import { memberDurability } from '../../engine/src/combat-model.js';
import { hasMemberHealth } from '../../engine/src/member-health.js';
import type { Trait } from '../../engine/src/types.js';
import { materializeUnitRecord, unitRecordFromCombatant, type UnitRecord } from './unit-state.js';

function materializeRecoverable(record: UnitRecord, registry: Map<string, Trait>) {
  if (record.retired || record.status === 'dead' || record.hp <= 0 && record.status !== 'dying') throw Error('阵亡或解散档案不能通过战后恢复复活');
  return materializeUnitRecord(record, registry);
}

/** Explicit out-of-battle treatment. Cohorts recover wounded personnel, not permanent casualties. */
export function recoverUnitRecord(record: UnitRecord, registry: Map<string, Trait>): UnitRecord {
  const unit = materializeRecoverable(record, registry);
  if (unit.status === 'routing' || unit.status === 'fled') unit.status = 'ready';
  applyRecovery(unit, recoveryCapacity(unit));
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
  const countOnly = unit.scale !== 'hero' && !hasMemberHealth(unit);
  const wounded = unit.recoverableWounded ?? 0;
  const capacity = recoveryCapacity(unit);
  const limit = countOnly ? Math.min(capacity, wounded) : capacity;
  const budget = life === 'all' ? limit : countOnly ? Math.floor(life / memberDurability(unit)) : life;
  const healed = applyRecovery(unit, Math.min(limit, budget));
  if (!healed) return record;
  if (withdrawn) unit.status = withdrawn;
  if (countOnly) unit.recoverableWounded = wounded - healed;
  return unitRecordFromCombatant(unit, record, { kind: 'update', sourceId });
}
