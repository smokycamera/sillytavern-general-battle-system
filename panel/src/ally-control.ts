import type { Combatant, SmallBattle } from '../../engine/src/index.js';
import { controlPolicy } from '../../engine/src/battle-control.js';

/** 「除主控」默认托管其余我方单位；主控仍可通过「此单位」单独托管。 */
export interface AllyControlDefaults { allAllies: boolean; protagonistId?: string }

const defaultAi = (d: AllyControlDefaults, id: string) => d.allAllies && id !== d.protagonistId;

/** 敌方与中立始终由AI；我方单位的单独设置优先于「除主控」。 */
export function aiActsFor(b: SmallBattle, unit: Pick<Combatant, 'id' | 'side'>, d: AllyControlDefaults): boolean {
  const current=b.combatants.find(u=>u.id===unit.id), policy=current&&controlPolicy(current);
  if(policy==='charmed'||policy==='confused')return true;
  return unit.side !== 'ally' || (b.allyAiControl.get(unit.id) ?? defaultAi(d, unit.id));
}

/** 单独托管或收回一个我方单位；与默认相同时不留记录，之后随默认变化。 */
export function setUnitAi(b: SmallBattle, id: string, ai: boolean, d: AllyControlDefaults): void {
  if (ai === defaultAi(d, id)) b.allyAiControl.delete(id); else b.allyAiControl.set(id, ai);
}

/** 切换「除主控」清除单独设置，主控回到手动；之后仍可逐个调整。 */
export function resetAllyAi(b: SmallBattle): void {
  b.allyAiControl.clear();
}

/** 仍在场、轮到时会交给AI的我方单位（地图标记用）。 */
export function aiControlledAllyIds(b: SmallBattle, d: AllyControlDefaults): Set<string> {
  return new Set(b.combatants.filter(u => u.side === 'ally' && !['dead', 'fled'].includes(u.status) && aiActsFor(b, u, d)).map(u => u.id));
}
