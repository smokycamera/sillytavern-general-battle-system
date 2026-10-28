import type { Combatant, RulePack } from './types.js';
import type { GearItem } from './items.js';
import { REVISED_ITEM_BARRIER } from './progression.js';
import { grantBarrier, refreshBarrier, validDefensePower } from './barrier.js';

export interface WornBarrier { power: number; amount: number }
export function compileWornBarrier(power: number): WornBarrier {
  if (!validDefensePower(power)) throw Error('佩戴屏障等级须为L1–L10');
  return { power, amount: REVISED_ITEM_BARRIER[power - 1]! };
}
export function strongestWornBarrier(unit: Pick<Combatant, 'gear'>): GearItem | undefined {
  let best: GearItem | undefined;
  for (const item of unit.gear ?? []) {
    const barrier = item.passive?.barrier, prior = best?.passive?.barrier;
    if (barrier && (!prior || barrier.power > prior.power || barrier.power === prior.power && barrier.amount > prior.amount)) best = item;
  }
  return best;
}
/** New battle only. Archive projections already discard these layers; direct engine callers do too. */
export function resetWornBarrier(unit: Combatant): void {
  delete unit.wornBarrierUsed;
  if (unit.barrier?.grants?.some(g => g.battleLong)) {
    unit.barrier.grants = unit.barrier.grants.filter(g => !g.battleLong);
    refreshBarrier(unit);
  }
}
/** An entry with no item still consumes the receipt: equipping later never refreshes a barrier. */
export function grantEntryWornBarrier(unit: Combatant, rules: Pick<RulePack, 'wornBarrierModel'>): string | undefined {
  if (rules.wornBarrierModel !== 'entry-once-v1' || unit.wornBarrierUsed) return;
  unit.wornBarrierUsed = true;
  if (unit.hp <= 0 || !['ready', 'routing'].includes(unit.status)) return;
  const item = strongestWornBarrier(unit), barrier = item?.passive?.barrier;
  if (!item || !barrier) return;
  const key = JSON.stringify(['worn-entry', unit.id]);
  const gained = grantBarrier(unit, barrier.amount, 99, item.id, barrier.power, key);
  const layer = unit.barrier?.grants?.find(g => g.sourceId === item.id && !g.effectSourceId && !g.legacy && g.key === JSON.stringify([key, barrier.power]));
  if (layer) { layer.battleLong = true; refreshBarrier(unit); }
  return gained > 0 ? `${unit.name} 的${item.name}生成屏障${gained}点` : undefined;
}
