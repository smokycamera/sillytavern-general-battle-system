import type { Combatant, SmallBattle } from '../../engine/src/index.js';

/** 我方托管开关：未单独设置的我方单位按此决定是否交给AI，与主控无关。 */
export interface AllyControlDefaults { allAllies: boolean }

const defaultAi = (d: AllyControlDefaults) => d.allAllies;

/** 轮到该单位时是否由AI行动：敌方与中立始终由AI；我方单位的单独设置优先于「我方」。 */
export function aiActsFor(b: SmallBattle, unit: Pick<Combatant, 'id' | 'side'>, d: AllyControlDefaults): boolean {
  return unit.side !== 'ally' || (b.allyAiControl.get(unit.id) ?? defaultAi(d));
}

/** 单独托管或收回一个我方单位；与默认相同时不留记录，之后随默认变化。 */
export function setUnitAi(b: SmallBattle, id: string, ai: boolean, d: AllyControlDefaults): void {
  if (ai === defaultAi(d)) b.allyAiControl.delete(id); else b.allyAiControl.set(id, ai);
}

/** 「我方」覆盖所有单位的单独设置；之后仍可逐个收回手动。 */
export function resetAllyAi(b: SmallBattle): void {
  b.allyAiControl.clear();
}

/** 仍在场、轮到时会交给AI的我方单位（地图标记用）。 */
export function aiControlledAllyIds(b: SmallBattle, d: AllyControlDefaults): Set<string> {
  return new Set(b.combatants.filter(u => u.side === 'ally' && !['dead', 'fled'].includes(u.status) && aiActsFor(b, u, d)).map(u => u.id));
}
