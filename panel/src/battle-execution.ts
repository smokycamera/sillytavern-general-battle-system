import type { MassBattle, Order } from '../../engine/src/index.js';
import type { OrderDrafts } from './formation-orders.js';

/** 先验证全部草案，再锁定回合；异常由调用方恢复进入此入口前的快照。 */
export function executeMassPlan(battle: MassBattle, drafts: OrderDrafts, automatic: boolean, expectedRound = battle.round): void {
  if (automatic && Object.keys(drafts).length) throw Error('当前由系统指挥；请取消尚未提交的草案，或恢复指挥资格');
  const orders: Order[] = Object.entries(drafts).map(([unitId, draft]) => ({ unitId, ...draft }));
  if (orders.some(o => !battle.combatants.some(u => u.id === o.unitId && u.side === 'ally'))) throw Error('草案包含不属于我方的编队');
  const result = battle.replaceOrders(orders, expectedRound);
  if (!result.ok) throw Error(result.reason);
  battle.autoOrders('ally');
  battle.resolveRound(expectedRound);
}

/** 保存失败和执行异常都回到最后的持久快照，避免只保留半次动作。 */
export function executeAndSave(execute: () => void, save: () => boolean, restore: () => void): boolean {
  try { execute(); return save(); }
  catch (error) { restore(); throw error; }
}

export async function executeAndSaveAsync(execute: () => void | Promise<void>, save: () => boolean | Promise<boolean>, restore: () => void): Promise<boolean> {
  try { await execute(); return await save(); }
  catch (error) { restore(); throw error; }
}
