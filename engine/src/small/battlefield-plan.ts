import { safeLandmarkLabel, MAP_DESIGN_OPTIONS, type MapDesign } from './map-design.js';
import { ROUTE_TOPOLOGIES, type RouteTopology } from './route-graph.js';
import type { CityShape } from './layers.js';
export const BREACH_SECTORS = ['auto', 'front_left', 'front_right', 'left', 'right', 'rear'] as const;
export interface BreachPlan { count: 0 | 1 | 2 | 3; width?: 1 | 2; sector?: typeof BREACH_SECTORS[number] }
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
  gates?: 'none' | 'single' | 'side' | 'double';
  gateState?: 'closed' | 'open' | 'destroyed';
  /** Damage is independent of the city's geometry; omitted means intact for model plans. */
  breaches?: BreachPlan;
  orientation?: MapDesign['orientation'];
  relief?: MapDesign['relief'];
  cover?: MapDesign['cover'];
  obstacles?: MapDesign['obstacles'];
  breadth?: MapDesign['breadth'];
  landmarks?: LandmarkPlan[];
}
const object = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
/** Partial plans degrade field-by-field, never accept coordinates, HP, commands or free-form weights. */
export function normalizeBattlefieldPlan(value: unknown): { plan?: BattlefieldPlan; notes: string[] } {
  const input = object(value), notes: string[] = [], plan: BattlefieldPlan = {};
  if (!input) return { notes: value === undefined ? [] : ['地图设计格式无效，采用本地生成'] };
  const enums = { size: ['compact', 'standard', 'large'], layout: Object.keys(MAP_DESIGN_OPTIONS.layout), shape: CITY_SHAPES,
    topology: Object.keys(ROUTE_TOPOLOGIES), density: ['sparse', 'balanced', 'dense'], water: ['none', 'ford', 'river', 'moat'], gates: ['none', 'single', 'side', 'double'], gateState: ['closed', 'open', 'destroyed'],
    orientation: Object.keys(MAP_DESIGN_OPTIONS.orientation), relief: Object.keys(MAP_DESIGN_OPTIONS.relief),
    cover: Object.keys(MAP_DESIGN_OPTIONS.cover), obstacles: Object.keys(MAP_DESIGN_OPTIONS.obstacles), breadth: Object.keys(MAP_DESIGN_OPTIONS.breadth) };
  for (const [key, choices] of Object.entries(enums)) if (input[key] !== undefined) {
    if (typeof input[key] === 'string' && (choices as readonly string[]).includes(input[key] as string)) (plan as Record<string, unknown>)[key] = input[key];
    else notes.push(`地图${key}无效，采用本地默认`);
  }
  if (input.breaches !== undefined) {
    const b = object(input.breaches);
    if (!b || !Number.isInteger(b.count) || Number(b.count) < 0 || Number(b.count) > 3) notes.push('破口数量无效，默认完整城防');
    else {
      plan.breaches = { count: b.count as BreachPlan['count'] };
      if (b.width === 1 || b.width === 2) plan.breaches.width = b.width;
      else if (b.width !== undefined) notes.push('破口宽度无效，采用1格');
      if ((BREACH_SECTORS as readonly unknown[]).includes(b.sector)) plan.breaches.sector = b.sector as BreachPlan['sector'];
      else if (b.sector !== undefined) notes.push('破口方位无效，采用合法随机墙段');
    }
    // An invalid explicit state must not accidentally inherit legacy broken/random damage.
    plan.breaches ??= { count: 0 };
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
各维度可独立组合，不要把“临河/依山”和“已有破口”当作互斥模板：size=compact|standard|large；layout=scattered|lanes|crossroads|ring|strongpoint|broken（街区布局，不代表城墙破损）；shape=front正面战段|enclosure封闭据点|riverside临河|hillside依山（仅攻城）；topology=${Object.keys(ROUTE_TOPOLOGIES).join('|')}。
可选细化：orientation=longitudinal|transverse|diagonal；breadth=narrow|normal|broad；relief/cover/obstacles各自=sparse|balanced|dense；density为后两项的共用默认；water=none|ford|river|moat；fortLevel=1..10；gates=none|single|side|double；gateState=closed|open|destroyed。
攻城可单独给breaches:{count:0..3,width:1|2,sector:auto|front_left|front_right|left|right|rear}。count=0保证没有初始墙体破口，省略也默认0；破门与墙体破口分开。width是每处连续缺口宽度；方位按攻守角色，左右按画面；侧后方仅封闭轮廓具备，无对应墙段时就近采用合法位置并报告。明确完好的城墙不可随机开口；按正文已有损伤选择，不替攻方预先拆墙。无依据项省略而不是填满所有字段。
landmarks最多5项，每项{kind:square|tower|ruins|fortification|hill|forest|bridge,anchor:approach|front_left|front_right|inside_left|inside_right|core|rear|center|riverbank,scale:minor|major,label?:短名称,level?:1..10}。地标不是城市每栋普通建筑，不能借嵌套规避上限。anchor按攻守角色解释。urban同样生成城市街区，但不强加城墙与攻城旗点。地图尺寸在部署容量不足时本地上调，不再请求模型。
结构锚定：L1临时 L2简易 L3正规 L4重型 L5要塞 L6超凡 L7史诗 L8传奇 L9半神 L10神造。结构、单位、装备等级独立；按材料和建造规格选，不能因为守军强就提高城墙等级。普通材质没有明确超常强化时不得选L6以上。模型不修改单位能力；深水可由本地桥梁保证通行。`;
