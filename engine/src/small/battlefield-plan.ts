import { safeLandmarkLabel, MAP_DESIGN_OPTIONS, BATTLEFIELD_SCENES, type BattlefieldScene, type MapDesign } from './map-design.js';
import { ROUTE_TOPOLOGIES, type RouteTopology } from './route-graph.js';
import type { CityShape } from './layers.js';
import {BattlefieldPlanError} from './battlefield-error.js';
export {BattlefieldPlanError} from './battlefield-error.js';
import { normalizeSceneIntent, SCENE_ARCHETYPES, WORLD_ANCHORS, SCENE_INTENT_PROMPT, type SceneIntent, type SceneArchetype, type WorldAnchor } from './scene-intent.js';
export const BREACH_SECTORS = ['auto', 'front_left', 'front_right', 'left', 'right', 'rear'] as const;
export interface BreachPlan { count: 0 | 1 | 2 | 3; width?: 1 | 2; sector?: typeof BREACH_SECTORS[number] }
export const CITY_SHAPES = ['front', 'enclosure', 'riverside', 'hillside', 'broken'] as const;
export const LANDMARK_KINDS = ['square', 'tower', 'ruins', 'fortification', 'hill', 'forest', 'bridge', 'building', 'room', 'cover', 'position'] as const;
export const LANDMARK_ANCHORS = ['approach', 'front_left', 'front_right', 'inside_left', 'inside_right', 'core', 'rear', 'center', 'riverbank',
  'ally_left','ally_center','ally_right','enemy_left','enemy_center','enemy_right','center_left','center_right', ...WORLD_ANCHORS.filter(a=>a!=='center')] as const;
export interface LandmarkPlan {
  kind: typeof LANDMARK_KINDS[number];
  anchor: typeof LANDMARK_ANCHORS[number];
  scale?: 'minor' | 'major';
  label?: string;
  level?: number;
  id?: string;
  height?: number;
  edge?: boolean;
}
export interface BridgePlan { id?: string; anchor: WorldAnchor; state: 'intact' | 'destroyed'; width?: 1 | 2 }
export const GATE_SECTORS = ['auto', 'front_left', 'front_center', 'front_right', 'left', 'right', 'rear','north','south','east','west'] as const;
export interface GatePlan { id?: string; sector: typeof GATE_SECTORS[number]; state: 'closed' | 'open' | 'destroyed' }
export interface BattlefieldPlan {
  scene?: BattlefieldScene;
  intent?: SceneIntent;
  archetype?: SceneArchetype;
  cityPosition?: WorldAnchor;
  waterAxis?: 'horizontal' | 'vertical';
  waterPosition?: WorldAnchor;
  bridgePlan?: BridgePlan[];
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
    cover: Object.keys(MAP_DESIGN_OPTIONS.cover), obstacles: Object.keys(MAP_DESIGN_OPTIONS.obstacles), breadth: Object.keys(MAP_DESIGN_OPTIONS.breadth),
    archetype: SCENE_ARCHETYPES, cityPosition: WORLD_ANCHORS, waterAxis: ['horizontal','vertical'], waterPosition: WORLD_ANCHORS };
  for (const [key, choices] of Object.entries(enums)) if (input[key] !== undefined) {
    if (typeof input[key] === 'string' && (choices as readonly string[]).includes(input[key] as string)) (plan as Record<string, unknown>)[key] = input[key];
    else notes.push(`地图${key}无效，采用本地默认`);
  }
  if (input.intent !== undefined) {
    try { plan.intent = normalizeSceneIntent(input.intent); }
    catch (error) { throw new BattlefieldPlanError(error instanceof Error ? error.message : '场景意图无效'); }
  }
  if (input.bridgePlan !== undefined) {
    if (!Array.isArray(input.bridgePlan) || input.bridgePlan.length > 4) throw new BattlefieldPlanError('bridgePlan须为0—4座桥的列表');
    plan.bridgePlan = input.bridgePlan.map(raw => {
      const b = object(raw);
      if (!b || !(WORLD_ANCHORS as readonly unknown[]).includes(b.anchor) || !['intact','destroyed'].includes(String(b.state))) throw new BattlefieldPlanError('桥梁方位或状态无效');
      return { anchor: b.anchor as WorldAnchor, state: b.state as BridgePlan['state'], ...(b.width===1||b.width===2?{width:b.width}:{}),
        ...(typeof b.id==='string' && /^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/.test(b.id)?{id:b.id}:{}) };
    });
  }
  if (input.gatePlan !== undefined) {
    if (!Array.isArray(input.gatePlan) || input.gatePlan.length > 4 || input.gatePlan.some(raw => {
      const g = object(raw); return !g || !(GATE_SECTORS as readonly unknown[]).includes(g.sector)
        || !['closed', 'open', 'destroyed'].includes(String(g.state));
    })) throw new BattlefieldPlanError('gatePlan须为0—4个门的列表，每个门给出合法sector与state');
    plan.gatePlan = input.gatePlan.map(raw => ({ sector: raw.sector, state: raw.state,
      ...(typeof raw.id === 'string' && /^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/.test(raw.id) ? { id: raw.id } : {}) }));
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
        if (typeof m.id==='string' && /^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/.test(m.id)) mark.id=m.id;
        if (Number.isInteger(m.height) && Number(m.height)>=0 && Number(m.height)<=3) mark.height=Number(m.height);
        if(m.edge===true)mark.edge=true;
        plan.landmarks.push(mark);
      }
    }
  }
  return { plan, notes };
}
/** Bounded, credential-free diagnostics safe to show before a battle starts. */
export function requireApiLandmarks(plan: BattlefieldPlan | undefined): asserts plan is BattlefieldPlan {
  if (!plan || !plan.intent && !plan.landmarks?.length) throw new BattlefieldPlanError('副API须返回场景意图或1—5个有效地标；本次未返回，不使用保底地标，请重试地图设计或关闭LLM设计地图');
}
export const BATTLEFIELD_PLAN_PROMPT = `返回battlefield对象，以正文中的时代、交战地点和当前局势设计战区。
scene=field野战或城外交战|city_siege城市攻防|city_streets城区巷战|building_siege围攻单栋建筑|interior室内交战|trenches堑壕战。室内由房间和走廊组织；建筑围攻包含目标建筑、可进入的内部或内院及外围；堑壕包含战斗壕、交通壕和无人地带。
可选布局：size=compact|standard|large；layout=scattered|lanes|crossroads|ring|strongpoint|broken（布局破碎）；shape=front正面战段|enclosure封闭据点|riverside临河|hillside依山；topology=${Object.keys(ROUTE_TOPOLOGIES).join('|')}。城市先道路后整块街区，建筑、掩体和壕线符合场所用途。
可选细化：orientation=longitudinal|transverse|diagonal；breadth=narrow|normal|broad；relief/cover/obstacles=sparse|balanced|dense；density为cover与obstacles的共用默认。
water=none|ford|river|moat：none代表无水域；ford代表浅水，可涉水的浅滩；river代表深水河流；moat代表护城河。按正文的深浅和可涉水情况选择；室内不设置室外水系。
cityPosition=${WORLD_ANCHORS.join('|')}；waterPosition采用同一组绝对方位；waterAxis=horizontal|vertical。
城防或建筑外围破口可给breaches:{count:0..3,width:1|2,sector:auto|front_left|front_right|left|right|rear}，count=0表示完整。桥梁、城门及地标统一写入intent.entities，各自保留位置、数量和状态。
fortLevel=1..10：L1临时 L2简易 L3正规 L4重型 L5要塞 L6超凡 L7史诗 L8传奇 L9半神 L10神造。根据材料、建造规格和超常强化选级，不按守军等级抬升建筑。
${SCENE_INTENT_PROMPT}`;
