/** Building use and spatial organization are independent, bounded choices. */
export const INTERIOR_USES = ['residence', 'inn', 'temple', 'warehouse', 'workshop', 'office', 'prison', 'ruins'] as const;
export const INTERIOR_PATTERNS = ['suite', 'hall', 'ring', 'cross', 'wings', 'aisles', 'cells', 'broken'] as const;
export type InteriorUse = typeof INTERIOR_USES[number];
export type InteriorPattern = typeof INTERIOR_PATTERNS[number];
export interface InteriorPlan { use?: InteriorUse; pattern?: InteriorPattern }
export function primaryInteriorRoom(mark: {label?: string; scale?: 'minor'|'major'}): boolean {
  return mark.scale==='major'||/正殿|大厅|主厅|客堂|客厅|起居室|主工坊/.test(mark.label??'');
}
export const INTERIOR_USE_NAMES: Record<InteriorUse, string> = {
  residence: '住宅', inn: '客栈酒馆', temple: '殿堂寺院', warehouse: '仓库', workshop: '工坊', office: '办公设施', prison: '牢房', ruins: '废弃建筑',
};
export const INTERIOR_PATTERN_NAMES: Record<InteriorPattern, string> = {
  suite: '穿堂连室', hall: '主厅侧室', ring: '环形回廊', cross: '交叉通道', wings: '双翼联通', aisles: '货架通道', cells: '走廊小室', broken: '破损连室',
};
/** Actual room floors and portals, frozen with the map for inspection; never used to reconstruct a loaded map. */
export interface InteriorLayoutRecord {
  use: InteriorUse;
  pattern: InteriorPattern;
  rooms: { cells: number[]; label: string; planId?: string }[];
  doorways: number[];
  fixtures?: number[];
}
