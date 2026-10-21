/** Geometry for new maps only. These records do not change saved battle rules. */
export const COMPOUND_PATTERNS = ['courtyard', 'forecourt', 'wings', 'dogleg', 'bailey', 'ruined'] as const;
export type CompoundPattern = typeof COMPOUND_PATTERNS[number];
export const COMPOUND_PATTERN_NAMES: Record<CompoundPattern, string> = {
  courtyard: '单院', forecourt: '前后院', wings: '双翼夹院', dogleg: '曲折院落', bailey: '内外院', ruined: '破损院落',
};
export const TRENCH_PATTERNS = ['opposed', 'depth', 'echelon', 'salient', 'strongpoints', 'saps'] as const;
export type TrenchPattern = typeof TRENCH_PATTERNS[number];
export const TRENCH_PATTERN_NAMES: Record<TrenchPattern, string> = {
  opposed: '相对前沿', depth: '纵深防线', echelon: '梯次斜线', salient: '突出部', strongpoints: '分散支撑点', saps: '前伸支壕',
};
export interface CompoundPlan { pattern?: CompoundPattern }
export interface TrenchPlan { pattern?: TrenchPattern }
export interface PositionArea { label: string; kind: 'room' | 'court' | 'passage'; cells: number[] }
export interface CompoundRecord { pattern: CompoundPattern; areas: PositionArea[]; passages: number[]; internalDoors: number[] }
export interface TrenchNetwork { side: 'ally' | 'enemy'; front: number[]; support: number[]; communication: number[]; saps: number[]; cells: number[] }
export interface TrenchRecord { pattern: TrenchPattern; networks: TrenchNetwork[]; noMansLand: number[] }
