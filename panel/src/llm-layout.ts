import { normalizeBattlefieldPlan, MAX_DEPLOYMENT_PLANS, type BattlefieldPlan, type DeploymentPlan } from '../../engine/src/small/battlefield-plan.js';
import { BattlefieldPlanError } from '../../engine/src/small/battlefield-error.js';
import { safeLandmarkLabel } from '../../engine/src/small/map-label.js';
import { SCENE_ARCHETYPE_NAMES, type SceneArchetype, type SceneConstraint, type SceneEntity, type SceneRelation, type WorldAnchor } from '../../engine/src/small/scene-intent.js';
import { recommendedCitySize } from '../../engine/src/small/layered-generator.js';
import type { BattlefieldScene } from '../../engine/src/small/map-design.js';
import { hasFlightAbility, isRangedWeapon, type Combatant } from '../../engine/src/index.js';
import type { BattleObjectiveMode } from './battle-setup.js';

/**
 * Second preparation step: the model places the battle on a 3×3 compass grid and the local generator builds every
 * cell. The answer has no IDs, citations or relation verbs to get wrong; every slip that has one reading is repaired
 * and reported, and the scene's roles (who holds the walls) are enforced locally rather than requested.
 */
export const SCENE_CHOICES: Record<BattlefieldScene, string> = {
  field: '野外交战：平原、林地、山地、河谷、渡口等；附近若有城镇只作背景，双方都在城外',
  city_siege: '城墙攻防：攻方在城外攻城，守方在城内或城头',
  city_streets: '城内巷战：双方都在城镇街巷里交战',
  building_siege: '围攻单个院落、庄园或小据点：攻方在外，守方在院内',
  interior: '室内：房间、走廊、大厅等紧凑空间',
  trenches: '堑壕阵地战：双方各据战壕',
};
export const SIZE_CHOICES = { compact: '小：局部遭遇、少量人物', standard: '中：一般战斗（不确定时选这项）', large: '大：多支部队、大范围战场' } as const;
export type LayoutSize = keyof typeof SIZE_CHOICES;

const CODES = { NW: 'north_west', N: 'north', NE: 'north_east', W: 'west', C: 'center', E: 'east', SW: 'south_west', S: 'south', SE: 'south_east' } as const;
type Code = keyof typeof CODES;
const CODE_NAMES: Record<Code, string> = { NW: '西北', N: '北', NE: '东北', W: '西', C: '中央', E: '东', SW: '西南', S: '南', SE: '东南' };
const CODE_OF = Object.fromEntries(Object.entries(CODES).map(([code, anchor]) => [anchor, code])) as Record<WorldAnchor, Code>;
const ZH_SECTORS: Record<string, Code> = { 北: 'N', 南: 'S', 东: 'E', 西: 'W', 东北: 'NE', 北东: 'NE', 西北: 'NW', 北西: 'NW', 东南: 'SE', 南东: 'SE', 西南: 'SW', 南西: 'SW',
  中: 'C', 中央: 'C', 中间: 'C', 中部: 'C', 中心: 'C', 正中: 'C',
  // The prompt states the map is drawn north up, so screen directions have one reading.
  上: 'N', 下: 'S', 左: 'W', 右: 'E', 左上: 'NW', 右上: 'NE', 左下: 'SW', 右下: 'SE' };
const EN_SECTORS: Record<string, Code> = { north: 'N', south: 'S', east: 'E', west: 'W', northeast: 'NE', north_east: 'NE', northwest: 'NW', north_west: 'NW',
  southeast: 'SE', south_east: 'SE', southwest: 'SW', south_west: 'SW', center: 'C', centre: 'C', middle: 'C', central: 'C' };
const PLACE_KINDS = ['hill', 'forest', 'square', 'tower', 'ruins', 'fortification', 'building', 'room', 'cover', 'position'] as const;
type PlaceKind = typeof PLACE_KINDS[number];
const PLACE_NAMES: Record<PlaceKind, string> = { hill: '高地', forest: '树林', square: '广场空地', tower: '塔楼', ruins: '废墟', fortification: '工事阵地', building: '重要建筑', room: '房间', cover: '掩体群', position: '战术要点或营地' };
const KIND_ALIASES: Record<string, PlaceKind> = { ridge: 'hill', mountain: 'hill', highland: 'hill', high_ground: 'hill', woods: 'forest', wood: 'forest', jungle: 'forest',
  plaza: 'square', clearing: 'square', wall: 'fortification', trench: 'fortification', fort: 'fortification', barricade: 'cover', house: 'building', ruin: 'ruins', camp: 'position',
  高地: 'hill', 山丘: 'hill', 山坡: 'hill', 山岗: 'hill', 土丘: 'hill', 山: 'hill', 坡: 'hill', 树林: 'forest', 森林: 'forest', 林地: 'forest', 林: 'forest', 广场: 'square', 空地: 'square',
  塔楼: 'tower', 塔: 'tower', 箭楼: 'tower', 哨塔: 'tower', 钟楼: 'tower', 废墟: 'ruins', 残垣: 'ruins', 工事: 'fortification', 阵地: 'fortification', 壕沟: 'fortification', 堡垒: 'fortification',
  建筑: 'building', 房屋: 'building', 宅院: 'building', 仓库: 'building', 房间: 'room', 掩体: 'cover', 掩体群: 'cover', 要点: 'position', 营地: 'position', 据点: 'position' };
const DESTROYABLE: readonly string[] = ['building', 'tower', 'fortification', 'cover', 'ruins'];
const ARCHETYPES: Record<BattlefieldScene, SceneArchetype[]> = {
  field: ['farmland', 'river_crossing', 'rolling_hills', 'forest_path', 'forest_stream', 'forest_edge', 'mountain_pass', 'ridge_valley', 'terraces', 'outskirts'],
  city_siege: ['gate_front', 'old_town', 'market', 'warehouse', 'riverside', 'hilltown'],
  city_streets: ['old_town', 'market', 'warehouse', 'riverside'],
  building_siege: ['warehouse', 'fortress'],
  interior: ['residence', 'great_hall', 'fortress'],
  trenches: ['trench_line', 'trench_depth'],
};
const MAX_PLACES = 8, MAX_DETACHMENTS = MAX_DEPLOYMENT_PLANS - 2;

export interface LayoutUnit { id: string; name: string; side: 'ally' | 'enemy'; kind: string; note?: string }
export interface LayoutContext {
  scene: BattlefieldScene;
  size?: LayoutSize;
  /** The side attacking the walls; only meaningful in a siege. */
  attacker: 'ally' | 'enemy';
  objectiveMode: BattleObjectiveMode;
  units: LayoutUnit[];
  vipName?: string;
  map: [number, number];
}
export function layoutUnits(roster: readonly Combatant[], publicId: (id: string) => string, notes: Record<string, string> = {}): LayoutUnit[] {
  return roster.filter(u => u.hp > 0 && u.status === 'ready' && (u.side === 'ally' || u.side === 'enemy')).slice(0, 32).map(u => ({
    id: publicId(u.id), name: u.name.slice(0, 40), side: u.side as 'ally' | 'enemy',
    kind: [u.scale === 'hero' ? '人物' : '部队', u.body === 'vehicle' ? '载具' : u.body && u.body !== 'human' ? '大型' : u.mount ? '骑乘' : '',
      hasFlightAbility(u) ? '可飞行' : '', isRangedWeapon(u.weapon) ? '远程' : '近战'].filter(Boolean).join('·'),
    ...(notes[u.id]?.trim() ? { note: notes[u.id]!.trim().slice(0, 60) } : {}) }));
}
/** The generator's starting size for the scene; capacity may still enlarge the map. */
export function layoutMapSize(scene: BattlefieldScene, roster: readonly Combatant[], size?: LayoutSize): [number, number] {
  const active = roster.filter(u => u.hp > 0 && u.status === 'ready');
  if (['city_siege', 'city_streets', 'building_siege'].includes(scene)) return recommendedCitySize(active, size);
  if (scene === 'interior') return size === 'large' ? [9, 15] : size === 'standard' ? [7, 13] : [5, 7];
  return size === 'large' ? [11, 17] : size === 'compact' ? [7, 9] : [7, 13];
}

const sideName = (side: 'ally' | 'enemy') => side === 'ally' ? '我方' : '敌方';
const defenderOf = (ctx: LayoutContext) => ctx.attacker === 'ally' ? 'enemy' : 'ally';
const besieged = (scene: BattlefieldScene) => scene === 'city_siege' || scene === 'building_siege';
const allowsCity = (scene: BattlefieldScene) => scene === 'city_siege' || scene === 'field';
const allowsWater = (scene: BattlefieldScene) => scene === 'field' || scene === 'city_siege' || scene === 'city_streets';
function placeKinds(scene: BattlefieldScene): PlaceKind[] {
  return scene === 'interior' ? ['room', 'cover', 'position', 'ruins', 'fortification'] : PLACE_KINDS.filter(k => k !== 'room' || scene === 'building_siege');
}
function exitSide(ctx: LayoutContext): 'ally' | 'enemy' | undefined { return ctx.objectiveMode === 'escort' ? 'ally' : ctx.objectiveMode === 'intercept' ? 'enemy' : undefined; }

function sceneLine(ctx: LayoutContext): string {
  const a = sideName(ctx.attacker), d = sideName(defenderOf(ctx));
  return ctx.scene === 'city_siege' ? `城墙攻防，攻方=${a}（在城外），守方=${d}（守城）`
    : ctx.scene === 'building_siege' ? `围攻院落或据点，攻方=${a}（在外），守方=${d}（在院内）`
    : ctx.scene === 'city_streets' ? '城内巷战，双方都在街巷里'
    : ctx.scene === 'interior' ? '室内交战（房间与走廊）' : ctx.scene === 'trenches' ? '堑壕阵地战' : '野外交战';
}
function objectiveLine(ctx: LayoutContext): string {
  const exit = exitSide(ctx);
  if (exit) return `${sideName(exit)}护送${ctx.vipName ? '「' + ctx.vipName + '」' : '目标'}到撤离点，${sideName(exit === 'ally' ? 'enemy' : 'ally')}拦截`;
  if (ctx.objectiveMode === 'siege') return `${sideName(ctx.attacker)}夺取并控制${sideName(defenderOf(ctx))}据守的核心地点`;
  return '击败敌军';
}
function example(ctx: LayoutContext): Record<string, unknown> {
  const d = defenderOf(ctx), a = ctx.attacker;
  if (ctx.scene === 'city_siege') return { archetype: 'gate_front', cover: 'balanced', city: { at: d === 'enemy' ? 'N' : 'S', name: '青石城', wall: 3, breaches: 0, gates: [{ name: '城门', state: 'closed' }] },
    places: [{ type: 'building', name: '府衙', at: d === 'enemy' ? 'N' : 'S' }, { type: 'position', name: '攻城营地', at: d === 'enemy' ? 'S' : 'N' }],
    [a]: { at: d === 'enemy' ? ['S', 'SW'] : ['N', 'NE'] }, [d]: { post: 'wall' }, ...(ctx.objectiveMode === 'siege' ? { objective: '府衙' } : {}) };
  if (ctx.scene === 'interior') return { archetype: 'residence', places: [{ type: 'room', name: '书房', at: 'N' }, { type: 'cover', name: '屏风', at: 'C' }], ally: { at: ['S'] }, enemy: { at: ['N'] } };
  if (ctx.scene === 'building_siege') return { archetype: 'fortress', city: { wall: 3, gates: [{ name: '院门', state: 'closed' }] }, places: [{ type: 'tower', name: '角楼', at: d === 'enemy' ? 'NE' : 'SE' }],
    [a]: { at: [d === 'enemy' ? 'S' : 'N'] }, [d]: { post: 'inside' } };
  return { archetype: ctx.scene === 'city_streets' ? 'old_town' : 'farmland', cover: 'balanced',
    places: [{ type: 'hill', name: '北坡', at: 'NE', height: 2 }, { type: 'forest', name: '南林', at: 'SW' }],
    ally: { at: ['S'] }, enemy: { at: ['N'] }, ...(exitSide(ctx) ? { objective: exitSide(ctx) === 'ally' ? 'N' : 'S' } : {}) };
}
/** What the next layout request is told about failed ones: the model's own last answer and one note per failure, newest last. */
export interface LayoutRetry { answer?: unknown; errors: readonly string[] }
/** The model cannot see its last answer otherwise, so a retry would rewrite the same layout from the same narrative. */
function retryLines(retry: LayoutRetry): string[] {
  const answer = retry.answer === undefined ? '' : JSON.stringify(retry.answer), earlier = retry.errors.slice(0, -1);
  return ['【上次布置未能生成地图】在上次回答的基础上只改与失败有关的项，其余照旧；拿不准的项直接删去，由程序决定。',
    ...(answer ? ['上次回答：' + (answer.length > 2000 ? answer.slice(0, 2000) + '…' : answer)] : []),
    '失败原因与改法：' + retry.errors.at(-1),
    ...(earlier.length ? ['更早的失败，不要重犯：' + earlier.join('；')] : [])];
}
/** The user message for the layout step. Shared system and narrative messages precede it. */
export function layoutTask(ctx: LayoutContext, retry?: LayoutRetry): string {
  const siege = besieged(ctx.scene), d = defenderOf(ctx);
  const kinds = placeKinds(ctx.scene).map(k => `${k}${PLACE_NAMES[k]}`).join('|');
  const lines = [
    '【第2步：布置战场】根据正文，在九宫格上布置本场战斗。程序会据此生成地形、建筑与道路，并把单位放进对应区域。',
    `本场：${sceneLine(ctx)}。任务：${objectiveLine(ctx)}。地图约${ctx.map[0]}列×${ctx.map[1]}行，上北下南。`,
    '参战单位（短ID · 名称 · 阵营 · 类型 · 备注）：',
    ...ctx.units.map(u => [u.id, u.name, sideName(u.side), u.kind, u.note].filter(Boolean).join(' · ')),
    '九宫格方位（东西南北是地图上的绝对方向，与攻守无关）：',
    'NW西北 | N北 | NE东北', 'W西 | C中央 | E东', 'SW西南 | S南 | SE东南',
    '只输出一个JSON对象，不需要的项省略。各项：',
    `- archetype：场所风格，可选 ${ARCHETYPES[ctx.scene].map(a => a + SCENE_ARCHETYPE_NAMES[a]).join('|')}。`,
    '- cover：掩体与障碍多少，sparse少|balanced适中|dense多。',
    ctx.scene === 'city_siege' ? '- city：必须写。{"at":方位,"name":"城名","wall":城墙等级,"breaches":破口数,"gates":[{"name":"门名","state":"closed"}]}。at为N/S/E/W时城市占地图该侧约一半，城墙朝向地图中央；C为四面有墙的城。gates列出本战区可见的城门（省略为一座），state=closed关闭|open开启|destroyed已毁，门由程序放在面向攻方的城墙上。wall=1临时 2简易 3正规 4重型 5要塞 6超凡 7史诗 8传奇 9半神 10神造，按材料与强化选；breaches=开战时已有的城墙破口0-3。'
      : ctx.scene === 'building_siege' ? '- city：院墙与门，{"wall":院墙等级1-10,"breaches":破口数0-3,"gates":[{"name":"院门","state":"closed|open|destroyed"}]}，院落位置由程序决定。'
      : ctx.scene === 'field' ? '- city：仅当交战地点旁有城镇时写，{"at":方位,"name":"城名","gates":[...]}；双方默认在城外，写gates时会画出朝向战场的城墙与门。' : '',
    allowsWater(ctx.scene) ? '- water：{"type":"river深水河|ford可涉水浅滩|moat护城河|none无水","at":方位,"bridges":[{"name":"桥名","at":方位,"state":"intact完好|destroyed已断"}]}。只有一条主河；bridges写出全部桥梁，[]表示没有桥，省略则由程序配两座桥。' : '',
    `- places：最多${MAX_PLACES}个有战术意义的地点，优先写正文提到的，[{"type":类型,"name":"名称","at":方位,"height":0-3,"state":"destroyed"}]。type=${kinds}。height只给高地等写，2-3为明显高地；state=destroyed表示已毁。普通房屋、树木、杂物由程序补全，不要写。`,
    siege ? `- ally / enemy：双方开局位置。${sideName(ctx.attacker)}是攻方，写{"at":["S"]}这样的1-3个${ctx.scene === 'city_siege' ? '城' : '院'}外方位。${sideName(d)}是守方，默认在${ctx.scene === 'city_siege' ? '城' : '院'}内，只需写post：wall城头为主|inside${ctx.scene === 'city_siege' ? '城内街巷' : '院内'}，不上墙|outside出${ctx.scene === 'city_siege' ? '城' : '院'}列阵（这时再写at为外面的方位）。`
      : `- ally / enemy：双方开局位置，{"at":["S"]}，可写1-3个方位。${ctx.scene === 'city_streets' ? '双方默认在街区内。' : ''}`,
    `- units：只在正文明确某个单位单独行动时写，如潜伏、断后、守桥，[{"unit":"u3","at":"NE"${siege ? ',"post":"wall"' : ''}}]，最多${MAX_DETACHMENTS}个。`,
    exitSide(ctx) ? '- objective：撤离点，写九宫格方位（放在该方向的地图边缘）或places里的name；省略时按部署方向决定。'
      : ctx.objectiveMode === 'siege' ? `- objective：${sideName(ctx.attacker)}要夺取的地点，写places里的name；省略时为${ctx.scene === 'city_siege' ? '城中心' : '守方后方核心'}。` : '',
    '示例（只示格式，内容按正文）：' + JSON.stringify(example(ctx)),
    ...(retry?.errors.length ? retryLines(retry) : []),
  ];
  return lines.filter(Boolean).join('\n');
}

type Json = Record<string, unknown>;
const object = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const token = (v: unknown) => typeof v === 'string' ? v.trim().toLowerCase().replace(/[\s-]+/g, '_') : '';
function sectorOf(v: unknown): WorldAnchor | undefined {
  if (typeof v !== 'string') return;
  const text = v.trim(), upper = text.toUpperCase();
  if (Object.hasOwn(CODES, upper)) return CODES[upper as Code];
  const english = token(text);
  if (Object.hasOwn(EN_SECTORS, english)) return CODES[EN_SECTORS[english]!];
  const zh = text.replace(/^(地图|偏|城|正)/, '').replace(/(方向|一带|方|侧|部|边|面|角)$/, '');
  return Object.hasOwn(ZH_SECTORS, zh) ? CODES[ZH_SECTORS[zh]!] : undefined;
}
function sectors(v: unknown, notes: Set<string>, what: string): WorldAnchor[] {
  const list = Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v];
  const found = [...new Set(list.map(sectorOf).filter((a): a is WorldAnchor => !!a))].slice(0, 4);
  if (found.length < list.length) notes.add(`${what}方位无效`);
  return found;
}
/** Display names keep their words; separators become a middle dot and other symbols are removed. */
function labelOf(v: unknown): string | undefined {
  if (typeof v !== 'string') return;
  const text = v.replace(/[、/／|｜,，;；:：]+/g, '·').replace(/[^\p{L}\p{N} ·・—–\-()（）]+/gu, ' ').replace(/\s+/g, ' ').replace(/^[\s·]+|[\s·]+$/g, '');
  return safeLandmarkLabel([...text].slice(0, 32).join('').replace(/[\s·]+$/, ''));
}
function integer(v: unknown, min: number, max: number): number | undefined {
  const n = typeof v === 'string' && v.trim() ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : undefined;
}
function stateOf(v: unknown): string | undefined {
  const t = token(v);
  return { intact: 'intact', open: 'open', opened: 'open', closed: 'closed', shut: 'closed', locked: 'closed', destroyed: 'destroyed', broken: 'destroyed', ruined: 'destroyed', collapsed: 'destroyed',
    完好: 'intact', 开启: 'open', 打开: 'open', 敞开: 'open', 开: 'open', 关闭: 'closed', 紧闭: 'closed', 关: 'closed', 已毁: 'destroyed', 被毁: 'destroyed', 损毁: 'destroyed', 已断: 'destroyed', 断: 'destroyed', 破: 'destroyed' }[t];
}
function postOf(v: unknown): DeploymentPlan['post'] {
  const t = token(v);
  return ({ wall: 'wall', walls: 'wall', on_wall: 'wall', 城头: 'wall', 城墙: 'wall', 墙上: 'wall', 城楼: 'wall', inside: 'inside', streets: 'inside', 城内: 'inside', 院内: 'inside', 内: 'inside',
    outside: 'outside', sortie: 'outside', 出城: 'outside', 城外: 'outside', 院外: 'outside', 出城列阵: 'outside' } as Record<string, DeploymentPlan['post']>)[t];
}
const opposite = (a: WorldAnchor): WorldAnchor => a === 'center' ? 'north' : a.replace(/north|south|east|west/g, w => ({ north: 'south', south: 'north', east: 'west', west: 'east' })[w]!) as WorldAnchor;

export interface CompiledLayout { plan: BattlefieldPlan; notes: string[] }
/** Repairs every slip with one reading, then hands the generator a plan that passes the same strict validation as manual JSON. */
export function compileLayout(answer: unknown, ctx: LayoutContext): CompiledLayout {
  const notes = new Set<string>(), top = object(answer) ? answer : {};
  const raw: Json = ['battlefield', 'layout', 'map'].map(k => top[k]).find(object) ?? top;
  let scene = ctx.scene;
  const cityRaw = object(raw.city) ? raw.city : undefined;
  // A siege objective at a stated city is fought at its walls, not in an open field beside it.
  if (scene === 'field' && ctx.objectiveMode === 'siege' && cityRaw && sectorOf(cityRaw.at)) { scene = 'city_siege'; notes.add('按攻城任务改为城墙攻防'); }
  const inferred = { basis: 'inferred' as const, sources: [] as string[] };
  const entities: SceneEntity[] = [], relations: SceneRelation[] = [], constraints: SceneConstraint[] = [];
  const names = new Map<string, string>();
  const plan: BattlefieldPlan = { scene, ...(ctx.size ? { size: ctx.size } : {}) };
  const archetype = token(raw.archetype);
  if ((ARCHETYPES[scene] as string[]).includes(archetype)) plan.archetype = archetype as SceneArchetype;
  const cover = token(raw.cover ?? raw.density);
  if (['sparse', 'balanced', 'dense'].includes(cover)) plan.density = cover as BattlefieldPlan['density'];

  // City walls, gates and their damage.
  if (cityRaw && (allowsCity(scene) || scene === 'building_siege')) {
    const wall = integer(cityRaw.wall ?? cityRaw.level, 1, 10), breaches = integer(cityRaw.breaches, 0, 3);
    if (wall !== undefined) plan.fortLevel = wall;
    if (breaches !== undefined && besieged(scene)) plan.breaches = { count: breaches as 0 | 1 | 2 | 3 };
  } else if (cityRaw && scene === 'city_streets') notes.add('巷战不设城市方位');
  else if (cityRaw) notes.add('本场景不设城市');
  let cityAt = cityRaw ? sectorOf(cityRaw.at) : undefined;
  if (scene === 'city_siege' && !cityAt) {
    cityAt = defenderOf(ctx) === 'enemy' ? 'north' : 'south';
    notes.add(`城市放在守方一侧（${CODE_NAMES[CODE_OF[cityAt]]}）`);
  }
  if (allowsCity(scene) && cityAt) {
    const label = labelOf(cityRaw?.name ?? cityRaw?.label);
    entities.push({ id: 'city', kind: 'city', anchor: cityAt, ...(label ? { label } : {}), ...inferred });
    if (label) names.set(label, 'city');
  }
  const gatesRaw = Array.isArray(cityRaw?.gates) ? cityRaw!.gates : undefined;
  // In an open field an empty gate list means an unwalled town, not walls without a way in.
  if (gatesRaw && (scene === 'city_siege' || scene === 'building_siege' || scene === 'field' && cityAt && gatesRaw.length)) {
    if (gatesRaw.length > 4) notes.add('城门最多4处');
    gatesRaw.slice(0, 4).forEach((g, i) => {
      const gate: Json = object(g) ? g : { name: g }, label = labelOf(gate.name ?? gate.label), state = stateOf(gate.state), at = sectorOf(gate.at);
      const id = `gate${i + 1}`;
      entities.push({ id, kind: 'gate', state: state === 'open' || state === 'destroyed' ? state : 'closed', ...(label ? { label } : {}), ...(at && scene !== 'building_siege' ? { anchor: at } : {}), ...inferred });
      if (label) names.set(label, id);
    });
    if (scene !== 'building_siege') constraints.push({ kind: 'gate_count', entity: 'city', value: Math.min(4, gatesRaw.length), ...inferred });
    // A compound has no city entity to count against; an empty list still means no gate.
    else if (!gatesRaw.length) plan.gatePlan = [];
  }

  // One main river and the exact bridges over it.
  const waterRaw = object(raw.water) ? raw.water : undefined, waterType = waterRaw ? ({ river: 'river', 河: 'river', 河流: 'river', 深水: 'river', ford: 'ford', 浅滩: 'ford', 浅水: 'ford',
    moat: 'moat', 护城河: 'moat', none: 'none', 无: 'none', 无水: 'none' } as Record<string, 'river' | 'ford' | 'moat' | 'none'>)[token(waterRaw.type ?? waterRaw.kind)] : undefined;
  if (waterRaw && !waterType) notes.add('水域类型无效，未布置');
  if (waterType && waterType !== 'none' && !allowsWater(scene)) notes.add('本场景不设水系');
  else if (waterType && waterType !== 'none') {
    plan.water = waterType;
    let riverAt = sectorOf(waterRaw!.at) ?? 'center';
    // A moat, or a river on the city's own side, runs along the city's open side; the generator routes an
    // unplaced river there instead of through the streets or the garrison's line to its walls.
    const shared = (a: WorldAnchor, b: WorldAnchor) => ['north', 'south', 'east', 'west'].some(d => a.includes(d) && b.includes(d));
    if (cityAt && allowsCity(scene) && riverAt !== 'center' && (waterType === 'moat' || shared(riverAt, cityAt) || cityAt === 'center')) {
      riverAt = 'center'; notes.add(waterType === 'moat' ? '护城河沿城外开阔侧布置' : '河流改沿城外开阔侧');
    }
    entities.push({ id: 'river', kind: 'river', anchor: riverAt, ...inferred });
    if (Array.isArray(waterRaw!.bridges)) {
      if (waterRaw!.bridges.length > 4) notes.add('桥梁最多4座');
      waterRaw!.bridges.slice(0, 4).forEach((b, i) => {
        const bridge: Json = object(b) ? b : { name: b }, label = labelOf(bridge.name ?? bridge.label), at = sectorOf(bridge.at), id = `bridge${i + 1}`;
        const width = integer(bridge.width, 1, 2);
        entities.push({ id, kind: 'bridge', ...(stateOf(bridge.state) === 'destroyed' ? { state: 'destroyed' as const } : {}), ...(label ? { label } : {}), ...(at ? { anchor: at } : {}), ...(width ? { width: width as 1 | 2 } : {}), ...inferred });
        if (label) names.set(label, id);
      });
      constraints.push({ kind: 'crossing_count', entity: 'river', value: Math.min(4, waterRaw!.bridges.length), ...inferred });
    }
  }

  // Named places of tactical meaning; the generator fills ordinary houses and trees.
  const placesRaw = Array.isArray(raw.places) ? raw.places : Array.isArray(raw.landmarks) ? raw.landmarks : [];
  if (placesRaw.length > MAX_PLACES) notes.add(`地点最多${MAX_PLACES}个`);
  const allowed = placeKinds(scene);
  let n = 0;
  for (const item of placesRaw.slice(0, MAX_PLACES)) {
    if (!object(item)) { notes.add('无效地点未采用'); continue; }
    const written = token(item.type ?? item.kind), stated = (PLACE_KINDS as readonly string[]).includes(written) ? written as PlaceKind : KIND_ALIASES[written] ?? KIND_ALIASES[String(item.type ?? item.kind ?? '').trim()];
    let kind = stated;
    if (kind && !allowed.includes(kind)) kind = scene === 'interior' && ['building', 'square', 'tower'].includes(kind) ? 'room' : kind === 'room' ? 'building' : undefined;
    if (!kind) { notes.add('部分地点类型无效，已省略'); continue; }
    if (kind !== stated) notes.add('部分地点改用相近类型');
    const label = labelOf(item.name ?? item.label), at = sectorOf(item.at), height = integer(item.height, 0, 3), id = `place${++n}`;
    entities.push({ id, kind, ...(at ? { anchor: at } : {}), ...(label ? { label } : {}), ...(height !== undefined ? { height } : {}),
      ...(stateOf(item.state) === 'destroyed' && DESTROYABLE.includes(kind) ? { state: 'destroyed' as const } : {}),
      ...(token(item.size ?? item.scale) === 'large' || token(item.size ?? item.scale) === 'major' ? { scale: 'major' as const } : {}), ...inferred });
    if (label && !names.has(label)) names.set(label, id);
    if (!at) notes.add(`${label ?? PLACE_NAMES[kind]}放在中央`);
  }

  // The contested place or the exit, bound to the side the task names.
  const exit = exitSide(ctx), goalRaw = object(raw.objective) ? raw.objective.name ?? raw.objective.place ?? raw.objective.at : raw.objective;
  if (goalRaw !== undefined && goalRaw !== null && goalRaw !== '') {
    const subject = exit ?? (ctx.objectiveMode === 'siege' ? ctx.attacker : undefined);
    const named = typeof goalRaw === 'string' ? names.get(goalRaw.trim()) ?? names.get(labelOf(goalRaw) ?? '') : undefined, at = sectorOf(goalRaw);
    // Annihilation has no place to bind; taking the city itself is the default core objective.
    if (subject && named !== 'city' && (named || at)) {
      let object = named;
      if (!object) { object = exit ? 'exit' : 'target'; entities.push({ id: object, kind: 'position', anchor: at!, label: exit ? '撤离点' : '争夺点', ...inferred }); }
      relations.push({ subject, relation: exit ? 'exits_at' : 'targets', object, ...inferred });
    } else if (subject && named !== 'city') notes.add('任务地点无效，用默认位置');
  }

  // Starting areas: each side, then detachments named by unit handle or exact name.
  const deployments: DeploymentPlan[] = [];
  const siege = besieged(scene), defender = defenderOf(ctx);
  for (const side of ['ally', 'enemy'] as const) {
    const entry = raw[side], record = object(entry) ? entry : { at: entry };
    const at = sectors(record.at ?? record.position, notes, sideName(side));
    let post = postOf(record.post);
    // Attackers hold no post on the walls or in the streets they are assaulting.
    if (post && siege && side !== defender) post = undefined;
    if (at.length) deployments.push({ subject: side, at, ...(post ? { post } : {}) });
    else if (post && siege && side === defender) deployments.push({ subject: side, at: [entities.find(e => e.kind === 'city')?.anchor ?? (defender === 'enemy' ? 'north' : 'south')], post });
  }
  if (!siege) {
    // Without walls to separate them, an unplaced side faces the placed one, or takes its own map edge.
    for (const side of ['enemy', 'ally'] as const) if (!deployments.some(d => d.subject === side)) {
      const other = deployments.find(d => d.subject !== side)?.at[0];
      deployments.push({ subject: side, at: [other ? opposite(other) : side === 'enemy' ? 'north' : 'south'] });
    }
  }
  const handles = new Map(ctx.units.map(u => [u.id.toLowerCase(), u.id])), byName = new Map(ctx.units.filter(u => ctx.units.filter(o => o.name === u.name).length === 1).map(u => [u.name, u.id]));
  const detachments = Array.isArray(raw.units) ? raw.units : [];
  if (detachments.length > MAX_DETACHMENTS) notes.add(`单独部署最多${MAX_DETACHMENTS}个`);
  for (const item of detachments.slice(0, MAX_DETACHMENTS)) {
    if (!object(item)) continue;
    const written = String(item.unit ?? item.id ?? item.name ?? '').trim(), id = handles.get(written.toLowerCase()) ?? byName.get(written);
    const at = sectors(item.at, notes, written || '单位');
    if (!id) { notes.add('忽略了名单外的单位'); continue; }
    if (!at.length || deployments.some(d => d.subject === id)) continue;
    const unit = ctx.units.find(u => u.id === id)!;
    const post = postOf(item.post);
    deployments.push({ subject: id, at, ...(post && (!siege || unit.side === defender) ? { post } : {}) });
  }
  if (deployments.length) plan.deployments = deployments;
  // The scene budget is 12 entities: structures and the task place first, then places in the order written.
  const kept = new Set(entities.filter(e => e.kind === 'city' || e.kind === 'river' || e.kind === 'gate' || e.kind === 'bridge' || relations.some(r => r.object === e.id)));
  for (const e of entities) if (kept.size < 12) kept.add(e);
  if (kept.size < entities.length) notes.add('地点过多，保留前12项');
  plan.intent = { schema: 'scene-intent-v1', entities: entities.filter(e => kept.has(e)), relations, constraints };
  // The compiled plan meets the same strict checks as manual or MCP JSON; a failure here is a local defect.
  const strict = normalizeBattlefieldPlan(plan);
  if (!strict.plan || strict.notes.length) throw new BattlefieldPlanError('地图布置未通过本地校验：' + strict.notes.join('；'));
  return { plan: strict.plan, notes: [...notes] };
}

const ENTITY_NAMES: Record<string, string> = { ...PLACE_NAMES, city: '城市', river: '水系', gate: '城门', bridge: '桥梁' };
/** The place a local error names, as the generator prints it: the label the answer wrote, or the kind when unnamed. */
const NAMED_PLACE = /(?:地标|地点)(.+?)(?:没有合法位置|在指定区域|未落在|没有符合|没有保留|未能落实)/;
/**
 * One note for the next layout request: the local error in the answer's own terms (its names and compass codes rather
 * than compiled IDs and anchors), then the change that usually fixes that family of failures.
 */
export function layoutRetryNote(error: string, plan?: BattlefieldPlan): string {
  const entities = plan?.intent?.entities ?? [];
  const name = (id: string) => {
    if (id === 'exit' || id === 'target') return 'objective';
    const e = entities.find(x => x.id === id);
    return e?.label ? `「${e.label}」` : ENTITY_NAMES[e?.kind ?? id.replace(/\d+$/, '')] ?? id;
  };
  const text = error.replace(/，请检查模型是否支持 JSON 输出$/, '')
    .replace(/\b(?:place\d+|gate\d+|bridge\d+|exit|target|city|river)\b/g, name)
    .replace(/\b(?:north_west|north_east|south_west|south_east|north|south|east|west|center)\b/g, a => `${CODE_OF[a as WorldAnchor]}（${CODE_NAMES[CODE_OF[a as WorldAnchor]]}）`)
    .replace(/地标(hill|forest|square|tower|ruins|fortification|building|room|cover|position)\b/g, (_, kind: PlaceKind) => '地标' + PLACE_NAMES[kind]);
  return `${text}。改法：${layoutAdvice(text, plan)}`;
}
function layoutAdvice(error: string, plan?: BattlefieldPlan): string {
  const goal = plan?.intent?.relations.find(r => r.relation === 'targets' || r.relation === 'exits_at');
  const place = goal && plan!.intent!.entities.find(e => e.id === goal.object);
  const written = !place ? '' : place.id === 'exit' || place.id === 'target' ? `（${CODE_OF[place.anchor ?? 'center']}）` : place.label ? `「${place.label}」` : '';
  if (/JSON|无效布置/.test(error)) return '只输出一个JSON对象，不要附加说明文字、注释或代码块';
  if (/任务|目标|出口|撤离|关系引用的地点/.test(error)) return goal
    ? `objective${written}处没有可站立的空地：改写为空旷的地点（如广场空地、营地）或九宫格方位，或省略objective`
    : '任务目标处被实心地点占住：中央和城中心不要放建筑、塔楼或工事，或用objective指定一处空旷地点';
  const named = NAMED_PLACE.exec(error)?.[1];
  if (named || /地标|地点/.test(error)) return `地点${!named ? '' : named.startsWith('「') ? named : `「${named}」`}放不下：换到更空旷的九宫格方位、type改为position或cover，或删去它；不要把几个地点和部队挤在同一格`;
  if (/桥/.test(error)) return 'bridges少写几座或写[]，桥不写at，由程序放置';
  if (/门/.test(error)) return 'gates少写几座，门不写at，由程序放在面向攻方的城墙上';
  if (/河|水/.test(error)) return '水系写在城市对侧或不写water.at；正文没有强调的河流可以删去';
  if (/开局|部署|容量|名单/.test(error)) return '双方at各写2—3个相邻的空旷方位，不要与对方、城市或地点挤在同一格；删去units里的单独部署';
  return '删去或改写与这条报错有关的项，拿不准就删去';
}

interface LayoutPart { present(raw: Json): boolean; drop(raw: Json, ctx: LayoutContext): string }
const listOf = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const placesOf = (raw: Json): unknown[] => Array.isArray(raw.places) ? raw.places : listOf(raw.landmarks);
const PARTS: Record<'units' | 'objective' | 'places' | 'bridges' | 'gates' | 'water' | 'sides' | 'city' | 'style', LayoutPart> = {
  units: { present: r => listOf(r.units).length > 0, drop: (r, ctx) => {
    const names = listOf(r.units).map(u => {
      const written = object(u) ? String(u.unit ?? u.id ?? u.name ?? '').trim() : '';
      return ctx.units.find(x => x.id.toLowerCase() === written.toLowerCase())?.name ?? written;
    }).filter(Boolean);
    delete r.units; return '未采用单独部署' + (names.length ? '：' + names.join('、') : '');
  } },
  objective: { present: r => r.objective !== undefined && r.objective !== null && r.objective !== '', drop: r => {
    const goal = object(r.objective) ? r.objective.name ?? r.objective.place ?? r.objective.at : r.objective, label = labelOf(goal);
    delete r.objective; return '未采用任务地点' + (label ? `「${label}」` : '');
  } },
  places: { present: r => placesOf(r).length > 0, drop: r => {
    const names = placesOf(r).map(p => object(p) ? labelOf(p.name ?? p.label) : undefined).filter(Boolean);
    delete r.places; delete r.landmarks; return '未采用地点' + names.map(n => `「${n}」`).join('');
  } },
  bridges: { present: r => object(r.water) && Array.isArray(r.water.bridges), drop: r => { delete (r.water as Json).bridges; return '桥梁改由程序布置'; } },
  gates: { present: r => object(r.city) && Array.isArray(r.city.gates), drop: r => { delete (r.city as Json).gates; return '城门改由程序布置'; } },
  water: { present: r => r.water !== undefined, drop: r => { delete r.water; return '未采用水系'; } },
  sides: { present: r => r.ally !== undefined || r.enemy !== undefined, drop: r => { delete r.ally; delete r.enemy; return '双方开局位置改由程序决定'; } },
  city: { present: r => r.city !== undefined, drop: r => { delete r.city; return '城市改由程序布置'; } },
  style: { present: r => r.archetype !== undefined || r.cover !== undefined || r.density !== undefined, drop: r => {
    delete r.archetype; delete r.cover; delete r.density; return '场所风格与掩体改由程序决定';
  } },
};
/** Errors that point at a part try it first; the order is otherwise from the least essential part to the scene itself. */
const TARGETS: [RegExp, LayoutPart[]][] = [
  [/任务|目标|出口|撤离|关系引用的地点/, [PARTS.objective, PARTS.places]], [/地标|地点/, [PARTS.places]], [/桥/, [PARTS.bridges, PARTS.water]],
  [/门/, [PARTS.gates]], [/河|水/, [PARTS.water]], [/开局|部署|容量|名单/, [PARTS.units, PARTS.sides]],
];
const ORDER = [PARTS.units, PARTS.objective, PARTS.places, PARTS.bridges, PARTS.gates, PARTS.water, PARTS.sides, PARTS.city, PARTS.style];
export interface LayoutReduction { answer: Json; note: string }
/**
 * The final try keeps what can be built. Each call leaves out one more part: the place the local error names, else the
 * part it points to, else the least essential part still present. Undefined once nothing is left to leave out.
 */
export function reduceLayout(answer: unknown, error: string, ctx: LayoutContext): LayoutReduction | undefined {
  const top = object(answer) ? answer : {};
  const raw = structuredClone(['battlefield', 'layout', 'map'].map(k => top[k]).find(object) ?? top) as Json;
  const places = placesOf(raw), named = NAMED_PLACE.exec(error)?.[1];
  const i = named ? places.findIndex(p => object(p) && labelOf(p.name ?? p.label) === named) : -1;
  if (i >= 0) { places.splice(i, 1); return { answer: raw, note: `未采用地点「${named}」` }; }
  const part = TARGETS.flatMap(([pattern, parts]) => pattern.test(error) ? parts : []).find(p => p.present(raw)) ?? ORDER.find(p => p.present(raw));
  return part && { answer: raw, note: part.drop(raw, ctx) };
}

/** One line for the preparation summary. */
export function layoutSummary(plan: BattlefieldPlan): string {
  const scene = { field: '野外', city_siege: '城墙攻防', city_streets: '巷战', building_siege: '围攻院落', interior: '室内', trenches: '堑壕' }[plan.scene ?? 'field'];
  const size = { compact: '小', standard: '中', large: '大' }[plan.size ?? 'standard'];
  const places = plan.intent?.entities.filter(e => !['city', 'river', 'gate', 'bridge'].includes(e.kind)).length ?? plan.landmarks?.length ?? 0;
  const city = plan.intent?.entities.find(e => e.kind === 'city');
  return [scene, size + '型', city ? `${city.label ?? '城市'}在${CODE_NAMES[CODE_OF[city.anchor ?? 'center']]}` : '', places ? places + '处地点' : ''].filter(Boolean).join(' · ');
}
