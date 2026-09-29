import { safeLandmarkLabel, MAP_DESIGN_OPTIONS, BATTLEFIELD_SCENES, type BattlefieldScene, type MapDesign } from './map-design.js';
import { ROUTE_TOPOLOGIES, type RouteTopology } from './route-graph.js';
import type { CityShape } from './layers.js';
export const BREACH_SECTORS = ['auto', 'front_left', 'front_right', 'left', 'right', 'rear'] as const;
export interface BreachPlan { count: 0 | 1 | 2 | 3; width?: 1 | 2; sector?: typeof BREACH_SECTORS[number] }
export const CITY_SHAPES = ['front', 'enclosure', 'riverside', 'hillside', 'broken'] as const;
export const LANDMARK_KINDS = ['square', 'tower', 'ruins', 'fortification', 'hill', 'forest', 'bridge', 'building', 'room', 'cover', 'position'] as const;
export const LANDMARK_ANCHORS = ['approach', 'front_left', 'front_right', 'inside_left', 'inside_right', 'core', 'rear', 'center', 'riverbank'] as const;
export interface LandmarkPlan {
  kind: typeof LANDMARK_KINDS[number];
  anchor: typeof LANDMARK_ANCHORS[number];
  scale?: 'minor' | 'major';
  label?: string;
  level?: number;
}
export const GATE_SECTORS = ['auto', 'front_left', 'front_center', 'front_right', 'left', 'right', 'rear'] as const;
export interface GatePlan { sector: typeof GATE_SECTORS[number]; state: 'closed' | 'open' | 'destroyed' }
export interface BattlefieldPlan {
  scene?: BattlefieldScene;
  /** Array length is the exact number of gates; each state is independent. Overrides legacy gates/gateState. */
  gatePlan?: GatePlan[];
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
  const enums = { scene: BATTLEFIELD_SCENES, size: ['compact', 'standard', 'large'], layout: Object.keys(MAP_DESIGN_OPTIONS.layout), shape: CITY_SHAPES,
    topology: Object.keys(ROUTE_TOPOLOGIES), density: ['sparse', 'balanced', 'dense'], water: ['none', 'ford', 'river', 'moat'], gates: ['none', 'single', 'side', 'double'], gateState: ['closed', 'open', 'destroyed'],
    orientation: Object.keys(MAP_DESIGN_OPTIONS.orientation), relief: Object.keys(MAP_DESIGN_OPTIONS.relief),
    cover: Object.keys(MAP_DESIGN_OPTIONS.cover), obstacles: Object.keys(MAP_DESIGN_OPTIONS.obstacles), breadth: Object.keys(MAP_DESIGN_OPTIONS.breadth) };
  for (const [key, choices] of Object.entries(enums)) if (input[key] !== undefined) {
    if (typeof input[key] === 'string' && (choices as readonly string[]).includes(input[key] as string)) (plan as Record<string, unknown>)[key] = input[key];
    else notes.push(`地图${key}无效，采用本地默认`);
  }
  if (input.gatePlan !== undefined) {
    if (!Array.isArray(input.gatePlan) || input.gatePlan.length > 4 || input.gatePlan.some(raw => {
      const g = object(raw); return !g || !(GATE_SECTORS as readonly unknown[]).includes(g.sector)
        || !['closed', 'open', 'destroyed'].includes(String(g.state));
    })) throw new BattlefieldPlanError('gatePlan须为0—4个门的列表，每个门给出合法sector与state');
    plan.gatePlan = input.gatePlan.map(raw => ({ sector: raw.sector, state: raw.state }));
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
    if (!Array.isArray(input.landmarks)) notes.push('地标列表无效');
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
/** Bounded, credential-free diagnostics safe to show before a battle starts. */
export class BattlefieldPlanError extends Error {
  constructor(message: string) { super(message); this.name = 'BattlefieldPlanError'; }
}
export function requireApiLandmarks(plan: BattlefieldPlan | undefined): asserts plan is BattlefieldPlan {
  if (!plan?.landmarks?.length) throw new BattlefieldPlanError('副API须返回1—5个有效地标；本次未返回，不使用保底地标，请重试地图设计或关闭LLM设计地图');
}
export const BATTLEFIELD_PLAN_PROMPT = `返回紧凑battlefield对象。结合正文、时代和交战地点合理设计，未写明的空间细节可以合理补全；名称可以概括，不必逐字引用正文。不输出解释、坐标、逐格数组、血量或每单位指令。
先选scene=field野战|city_siege城市攻防|city_streets城区巷战|building_siege围攻单栋建筑|interior室内交战|trenches堑壕战。场景与环境、尺寸独立：城内作战用city_streets，不自动套城墙和夺旗；室内扩容仍是房间与走廊；building_siege有目标建筑的可进入内院/内部和外围；trenches有战斗壕、交通壕与无人地带。
各维度自由组合：size=compact|standard|large；layout=scattered|lanes|crossroads|ring|strongpoint|broken（空间布局，非城墙破损）；shape=front正面战段|enclosure封闭据点|riverside临河|hillside依山；topology=${Object.keys(ROUTE_TOPOLOGIES).join('|')}。城市先道路后整块街区；房间、掩体、壕线符合地点用途，局部变化而非逐格散点。
可选细化：orientation=longitudinal|transverse|diagonal；breadth=narrow|normal|broad；relief/cover/obstacles各自=sparse|balanced|dense；density为后两项共用默认；water=none|ford|river|moat；fortLevel=1..10。室内不设置室外自然地形。
gatePlan=[{sector:auto|front_left|front_center|front_right|left|right|rear,state:closed|open|destroyed},...]，0—4项，项数就是门数，可各门不同状态；空数组表示无门。城市攻防是城门，建筑围攻是建筑入口，室内是隔间门。不存在对应方位墙段时选最近合法段并显示调整。旧gates=none|single|side|double与gateState仍可读取，但gatePlan优先。
城防或建筑外围可单独给breaches:{count:0..3,width:1|2,sector:auto|front_left|front_right|left|right|rear}；与轮廓、门数、门状态独立。count=0或省略表示完整；每处宽度1—2格。保留正文明确的完整或损坏状态，其余按场景合理选择。
landmarks必须1—5项，每项{kind:square|tower|ruins|fortification|hill|forest|bridge|building|room|cover|position,anchor:approach|front_left|front_right|inside_left|inside_right|core|rear|center|riverbank,scale:minor|major,label?:短名称,level?:1..10}。选择实际有战术意义的地点：室内可用room议事厅、cover桌柜掩体、position走廊转角；城区可用building目标建筑、square路口广场；堑壕可用fortification机枪阵地、position交通壕交汇。地标不要求宏伟或正文已有专名，但须符合场景；桥梁要有水域。最多5个，不把每栋普通建筑都列为地标。anchor按攻守角色，左右按画面。模型漏返地标会中止准备，不自动补保底地标。
结构锚定：L1临时 L2简易 L3正规 L4重型 L5要塞 L6超凡 L7史诗 L8传奇 L9半神 L10神造。结构、单位、装备等级独立；根据材料、建造规格和设定中的超常强化选级，不按守军等级抬升建筑。模型不修改单位能力；部署不足由本地扩图，仍保持场景。`;
