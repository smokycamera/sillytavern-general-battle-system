/** Bounded design vocabulary shared by the local builder and the optional LLM director.
 * A design describes geometry, never executable code or a replacement tile array. */
export const MAP_DESIGN_OPTIONS = {
  layout: { automatic: '按环境随机组合', scattered: '分散片区／独立街区', lanes: '条带／纵深巷道', crossroads: '交叉通路', ring: '环绕中央空地／庭院', strongpoint: '偏置据点与接近地带', broken: '破碎地形／废墟缺口' },
  orientation: { longitudinal: '沿双方推进方向', transverse: '横切推进方向', diagonal: '斜向错位' },
  relief: { sparse: '主题地形稀疏', balanced: '主题地形适中', dense: '主题地形成片' },
  cover: { sparse: '掩体较少', balanced: '掩体适中', dense: '掩体较多' },
  obstacles: { sparse: '少量墙段', balanced: '分区墙段', dense: '较密墙段（仍保留通路）' },
  route: { direct: '直接通路', winding: '曲折通路', flank: '侧翼绕行' },
  breadth: { narrow: '窄主路并保留替代路线', normal: '普通路宽', broad: '较宽接近地带' },
  feature: { none: '无额外地标', clearing: '开阔地／广场', cover: '掩体群', rough: '崎岖带／瓦砾', forest: '林地', hill: '高地' },
  featureZone: { enemy_left: '敌方纵深左侧', enemy_center: '敌方纵深中部', enemy_right: '敌方纵深右侧', center_left: '战场中段左侧', center: '战场中段中部', center_right: '战场中段右侧', ally_left: '我方纵深左侧', ally_center: '我方纵深中部', ally_right: '我方纵深右侧' },
} as const;
export type MapDesign = { -readonly [K in keyof typeof MAP_DESIGN_OPTIONS]: keyof typeof MAP_DESIGN_OPTIONS[K] };
export type MapFamily = 'plains' | 'forest' | 'mountain' | 'urban' | 'siege' | 'indoor';
export interface MapGenerationRecord {
  version: 3;
  family: MapFamily;
  source: 'random' | 'context';
  design: MapDesign;
  /** Actual surviving landmark tiles, after safety repair; never a claim of new mechanics. */
  landmark?: { terrain: string; cells: number[] };
}
export function mapFamily(tags: readonly string[], width: number): MapFamily {
  return tags.includes('siege') ? 'siege' : width === 5 ? 'indoor'
    : tags.includes('urban') ? 'urban' : tags.includes('forest') ? 'forest'
      : tags.includes('mountain') ? 'mountain' : 'plains';
}
/** Reject incomplete/untrusted plans as a whole. Missing fields must not silently become defaults. */
export function validMapDesign(value: unknown): value is MapDesign {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(MAP_DESIGN_OPTIONS).every(([key, options]) => {
    const v = (value as Record<string, unknown>)[key];
    return typeof v === 'string' && Object.prototype.hasOwnProperty.call(options, v);
  });
}
export function mapDesignSummary(design: MapDesign): string {
  return `${MAP_DESIGN_OPTIONS.layout[design.layout]} · ${MAP_DESIGN_OPTIONS.route[design.route]} · ${MAP_DESIGN_OPTIONS.cover[design.cover]}`;
}
