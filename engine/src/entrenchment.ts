/**
 * V13 工事据守：工事是阵地而不是随身属性。开战时或获得工事时记下所在位置（小战格子、会战阵位），
 * 离开该位置即失效，回到原位仍有效；在别处（或开战时没能构筑，例如还在空中）原地完整休整一轮，改在新位置构筑。
 * 旧规则战斗不记位置，沿用原效果。
 */
import type { Combatant } from './types.js';
import { activeTraitIds, traitPrerequisiteReason } from './trait-sources.js';
import { traitsV13 } from './trait-model.js';
import { formationNode } from './mass/formation.js';

function massSpot(unit: Combatant): string | undefined {
  try { return formationNode(unit).id; } catch { return undefined; }
}
/** 小战记格子编号，会战记阵位 id。 */
export function entrenched(unit: Combatant): boolean {
  const at = unit.entrenchedAt;
  if (at === undefined || unit.airborne) return false;
  return typeof at === 'number' ? unit.pos === at : massSpot(unit) === at;
}
export function canEntrench(unit: Combatant): boolean {
  return traitsV13(unit) && unit.status === 'ready' && !unit.airborne && activeTraitIds(unit).includes('fortification') && !traitPrerequisiteReason(unit, 'fortification');
}
/** 在当前位置构筑；返回是否新建了据守位置（已在此处据守时不重复记）。 */
export function entrench(unit: Combatant, mode: 'small' | 'mass'): boolean {
  if (!canEntrench(unit)) return false;
  const spot = mode === 'mass' ? massSpot(unit) : unit.pos;
  if (spot === undefined || unit.entrenchedAt === spot) return false;
  unit.entrenchedAt = spot;
  return true;
}
/** 战斗中的工事状态说明（单位详情、行动栏、正文事实）；V12 及以前的战斗与没有工事的单位不显示。 */
export function worksLabel(unit: Combatant): string | undefined {
  if (!traitsV13(unit) || !activeTraitIds(unit).includes('fortification') || traitPrerequisiteReason(unit, 'fortification')) return undefined;
  if (entrenched(unit)) return '据守工事：离开即失效';
  return unit.entrenchedAt === undefined ? '尚未构筑工事：原地完整休整一轮构筑' : '已离开工事：回到原位，或原地完整休整一轮重建';
}
