import type { Combatant, SmallBattle } from '../../engine/src/index.js';

/** 「托管非主控」开关与当前主控：未单独设置的我方单位按此决定是否交给AI。 */
export interface AllyControlDefaults { nonProtagonist: boolean; protagonistId?: string }

const defaultAi = (id: string, d: AllyControlDefaults) => d.nonProtagonist && id !== d.protagonistId;

/** 轮到该单位时是否由AI行动：敌方与中立始终由AI；我方单位的单独设置优先于「托管非主控」。 */
export function aiActsFor(b: SmallBattle, unit: Pick<Combatant, 'id' | 'side'>, d: AllyControlDefaults): boolean {
  return unit.side !== 'ally' || (b.allyAiControl.get(unit.id) ?? defaultAi(unit.id, d));
}

/** 单独托管或收回一个我方单位；与默认相同时不留记录，之后随默认变化。 */
export function setUnitAi(b: SmallBattle, id: string, ai: boolean, d: AllyControlDefaults): void {
  if (ai === defaultAi(id, d)) b.allyAiControl.delete(id); else b.allyAiControl.set(id, ai);
}

/** 「托管非主控」作用于全部非主控单位：清掉它们的单独设置，主控的设置保留。 */
export function resetNonProtagonistAi(b: SmallBattle, d: AllyControlDefaults): void {
  for (const id of [...b.allyAiControl.keys()]) if (id !== d.protagonistId) b.allyAiControl.delete(id);
}

/** 仍在场、轮到时会交给AI的我方单位（地图标记用）。 */
export function aiControlledAllyIds(b: SmallBattle, d: AllyControlDefaults): Set<string> {
  return new Set(b.combatants.filter(u => u.side === 'ally' && !['dead', 'fled'].includes(u.status) && aiActsFor(b, u, d)).map(u => u.id));
}
