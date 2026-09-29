import { safeLandmarkLabel, MAP_DESIGN_OPTIONS, type MapDesign } from './map-design.js';
import { ROUTE_TOPOLOGIES, type RouteTopology } from './route-graph.js';
import type { CityShape } from './layers.js';
export const CITY_SHAPES = ['front', 'enclosure', 'riverside', 'hillside', 'broken'] as const;
export const LANDMARK_KINDS = ['square', 'tower', 'ruins', 'fortification', 'hill', 'forest', 'bridge'] as const;
export const LANDMARK_ANCHORS = ['approach', 'front_left', 'front_right', 'inside_left', 'inside_right', 'core', 'rear', 'center', 'riverbank'] as const;
export interface LandmarkPlan {
  kind: typeof LANDMARK_KINDS[number];
  anchor: typeof LANDMARK_ANCHORS[number];
  scale?: 'minor' | 'major';
  label?: string;
  level?: number;
}
export interface BattlefieldPlan {
  size?: 'compact' | 'standard' | 'large';
  layout?: MapDesign['layout'];
  shape?: CityShape;
  topology?: RouteTopology;
  density?: 'sparse' | 'balanced' | 'dense';
  water?: 'none' | 'ford' | 'river' | 'moat';
  fortLevel?: number;
  gates?: 'single' | 'side' | 'double';
  landmarks?: LandmarkPlan[];
}
const object = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
/** Partial plans degrade field-by-field, never accept coordinates, HP, commands or free-form weights. */
export function normalizeBattlefieldPlan(value: unknown): { plan?: BattlefieldPlan; notes: string[] } {
  const input = object(value), notes: string[] = [], plan: BattlefieldPlan = {};
  if (!input) return { notes: value === undefined ? [] : ['地图设计格式无效，采用本地生成'] };
  const enums = { size: ['compact', 'standard', 'large'], layout: Object.keys(MAP_DESIGN_OPTIONS.layout), shape: CITY_SHAPES,
    topology: Object.keys(ROUTE_TOPOLOGIES), density: ['sparse', 'balanced', 'dense'], water: ['none', 'ford', 'river', 'moat'], gates: ['single', 'side', 'double'] };
  for (const [key, choices] of Object.entries(enums)) if (input[key] !== undefined) {
    if (typeof input[key] === 'string' && (choices as readonly string[]).includes(input[key] as string)) (plan as Record<string, unknown>)[key] = input[key];
    else notes.push(`地图${key}无效，采用本地默认`);
  }
  if (input.fortLevel !== undefined) {
    if (Number.isInteger(input.fortLevel) && Number(input.fortLevel) >= 1 && Number(input.fortLevel) <= 10) plan.fortLevel = Number(input.fortLevel);
    else notes.push('结构等级无效，采用本地默认');
  }
  if (input.landmarks !== undefined) {
    if (!Array.isArray(input.landmarks)) notes.push('地标列表无效，采用本地默认');
    else {
      plan.landmarks = [];
      if (input.landmarks.length > 5) notes.push('地标最多5个，超出项未采用');
      for (const raw of input.landmarks.slice(0, 5)) {
        const m = object(raw);
        if (!m || !(LANDMARK_KINDS as readonly unknown[]).includes(m.kind) || !(LANDMARK_ANCHORS as readonly unknown[]).includes(m.anchor)) { notes.push('无效地标未采用'); continue; }
        const mark: LandmarkPlan = { kind: m.kind as LandmarkPlan['kind'], anchor: m.anchor as LandmarkPlan['anchor'] };
        if (m.scale === 'minor' || m.scale === 'major') mark.scale = m.scale;
        const label = safeLandmarkLabel(m.label); if (label) mark.label = label;
        if (Number.isInteger(m.level) && Number(m.level) >= 1 && Number(m.level) <= 10) mark.level = Number(m.level);
        plan.landmarks.push(mark);
      }
    }
  }
  return { plan, notes };
}
export const BATTLEFIELD_PLAN_PROMPT = `战场设计只返回紧凑的battlefield对象；可省略无依据项，不输出解释、坐标、逐格数组、血量或每单位指令。
字段：size=compact|standard|large；layout=scattered|lanes|crossroads|ring|strongpoint|broken；shape=front|enclosure|riverside|hillside|broken（只用于攻城）；topology=${Object.keys(ROUTE_TOPOLOGIES).join('|')}；density=sparse|balanced|dense；water=none|ford|river|moat；fortLevel=1..10；gates=single|side|double。
landmarks最多5项，每项{kind:square|tower|ruins|fortification|hill|forest|bridge,anchor:approach|front_left|front_right|inside_left|inside_right|core|rear|center|riverbank,scale:minor|major,label?:短名称,level?:1..10}。地标不是城市每栋普通建筑，不能借嵌套规避上限。anchor按攻守角色解释，不是固定上下阵营。urban同样生成城市街区，但没有强制城墙与攻城旗点。
结构锚定：L1临时 L2简易 L3正规 L4重型 L5要塞 L6超凡 L7史诗 L8传奇 L9半神 L10神造。结构、单位、装备等级独立；按材料和建造规格选，不能因为守军强就提高城墙等级。普通材质没有明确超常强化时不得选L6以上。模型不修改单位能力；深水可由本地桥梁保证通行。`;
