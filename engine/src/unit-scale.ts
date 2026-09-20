import type { Combatant, Scale } from './types.js';

export type V2Scale = Exclude<Scale, 'mook'>;
export function v2Scale(scale: Scale): V2Scale { return scale === 'hero' ? 'hero' : 'company'; }
/** 只规范旧V2别名，不生成单位、不调整人数/装备/训练。legacy规则快照保留。 */
export function normalizeV2Scale(unit: Combatant): void {
  if (unit.rulesVersion !== 'v2' || unit.scale !== 'mook') return;
  unit.scale = 'company'; unit.legacyScale = 'mook';
  unit.tags = [...new Set([...unit.tags.filter((t) => t !== 'mook'), 'company'])];
  if (unit.genAudit?.input) unit.genAudit.input.scale = 'company';
}
export function scaleLabel(unit: Pick<Combatant, 'scale'> & Partial<Pick<Combatant, 'rulesVersion'>>): string {
  return unit.scale === 'hero' ? '个体' : unit.scale === 'mook' && unit.rulesVersion !== 'v2' ? '编队（旧规则）' : '编队';
}
