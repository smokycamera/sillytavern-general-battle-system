import { MAP_DESIGN_OPTIONS, validMapDesign, type MapDesign, type Combatant } from '../../engine/src/index.js';
import type { ContextSelectionRequest, ContextSelectionAnswer } from '../../vendor/jev-core/src/index.js';
import type { EncounterSetup } from './jev-context.js';
import type { LlmSettings } from './llm-settings.js';
import { vipCandidates } from './battle-setup.js';

type Field = ContextSelectionRequest['fields'][number];
export interface PreparationDesignRequest {
  fields: Field[];
  vipIds: Partial<Record<'ally' | 'enemy', Record<string, string>>>;
  notes: string[];
}
export interface PreparationDesignResult {
  mapDesign?: MapDesign;
  vipId?: string;
  vipName?: string;
  designDetail?: string;
}
const questions: Record<keyof MapDesign, string> = {
  layout: '根据本次选择的环境与正文地点，决定布局骨架：林地片区、山脊、城市街区、室内房间、攻城据点。不要只为增加障碍而增加障碍。',
  orientation: '地形片区、山脊或墙段主要朝向。上方为敌方，下方为我方，不随攻城进攻方交换坐标。',
  relief: '主题地形覆盖程度：森林对应林地，山地对应高地，城镇/室内对应瓦砾。结合正文，不将开阔平原塞满障碍。',
  cover: '掩体密度，结合树林边缘、岩石、街角、货堆及实际战场规模。',
  obstacles: '墙段密度，只对城市、室内和攻城生效；自然环境不会凭空建墙。',
  route: '接敌/护送通路形态；兼顾正文中的街道、山路、伏击和撤离方向。',
  breadth: '主通路宽度；狭窄通路仍保留替代路线，不能设计必然卡死的关卡。',
  feature: '正文最重要的一个局部地标；仅用已有地形规则表达。不把普通地形声称为水域、桥梁、可破坏建筑或新增技能机制。无明确地标选none。',
  featureZone: '该地标在战场中的相对位置；上敌下我，左/右按地图画面。不改变目标出口或角色部署。',
};

/** Uses the existing preparation request, never an additional API call. Raw unit IDs are not option IDs. */
export function preparationDesignRequest(roster: Combatant[], settings: LlmSettings, setup: EncounterSetup, unitNotes: Record<string, string> = {}): PreparationDesignRequest {
  const result: PreparationDesignRequest = { fields: [], vipIds: {}, notes: [] };
  // A fixed mass battle has no tactical grid or escape objective.
  if (settings.selectBattleScale === false && setup.mode === 'mass') return result;
  if (settings.designMap === true) for (const key of Object.keys(MAP_DESIGN_OPTIONS) as (keyof MapDesign)[]) {
    result.fields.push({ id: 'design_' + key.toLowerCase(), question: questions[key] + ' 若本次最终是军团会战，此项忽略。', options: { ...MAP_DESIGN_OPTIONS[key] } });
  }
  if (settings.selectVip === true) for (const side of ['ally', 'enemy'] as const) {
    const candidates = vipCandidates(roster, side);
    if (!candidates.length) continue;
    // 32 is the protocol's option cap, including the safe default. Never silently drop a VIP.
    if (candidates.length > 31 || new Set(candidates.map(u => u.id)).size !== candidates.length) {
      result.notes.push(`${side === 'ally' ? '我方' : '敌方'}VIP候选名单过多或ID重复，沿用默认对象`); continue;
    }
    const ids: Record<string, string> = {}, options: Record<string, string> = { default: '正文未能确定对象，沿用主控优先／首个合法单位的默认选择' };
    candidates.forEach((u, n) => {
      const key = 'unit_' + n;
      ids[key] = u.id;
      options[key] = `${u.name.slice(0, 160)}｜${u.scale}｜${(unitNotes[u.id] ?? '').slice(0, 400)}`;
    });
    result.vipIds[side] = ids;
    result.fields.push({ id: 'vip_' + side, question: side === 'ally'
      ? '仅当最终任务为escort护送：从我方现有可参战单位选择正文真正要保护/运出的对象；可能是人物、运输队或载具。不要默认选择最强战士或主控；无依据选default。'
      : '仅当最终任务为intercept拦截：从敌方现有可参战单位选择正文真正要拦截的对象。不是选择我方拦截者；无依据选default。', options });
  }
  return result;
}
function choice(answer: ContextSelectionAnswer, fields: Field[], id: string): string | undefined {
  const field = fields.find(f => f.id === id), selected = answer.selections?.[id];
  if (!field || !selected || typeof selected.value !== 'string' || !Object.hasOwn(field.options, selected.value)
    || !Number.isFinite(selected.confidence) || selected.confidence < 0 || selected.confidence > 1) return undefined;
  return selected.value;
}
/** Optional design errors fall back locally; mandatory encounter/commander errors still reject upstream. */
export function applyPreparationDesign(answer: ContextSelectionAnswer, request: PreparationDesignRequest, setup: EncounterSetup, roster: Combatant[]): PreparationDesignResult {
  if (setup.mode !== 'small') return {};
  const result: PreparationDesignResult = {}, notes = [...request.notes];
  if (request.fields.some(f => f.id === 'design_layout')) {
    const candidate = Object.fromEntries((Object.keys(MAP_DESIGN_OPTIONS) as (keyof MapDesign)[]).map(k => [k, choice(answer, request.fields, 'design_' + k.toLowerCase())]));
    if (validMapDesign(candidate)) result.mapDesign = candidate;
    else notes.push('地图设计返回不完整或无效，采用本地随机地图');
  }
  const side = setup.objectiveMode === 'escort' ? 'ally' : setup.objectiveMode === 'intercept' ? 'enemy' : undefined;
  if (side && request.vipIds[side]) {
    const value = choice(answer, request.fields, 'vip_' + side);
    const id = value ? request.vipIds[side]![value] : undefined;
    const unit = id ? vipCandidates(roster, side).find(u => u.id === id) : undefined;
    if (unit) { result.vipId = unit.id; result.vipName = unit.name; }
    else notes.push(value === 'default' ? 'VIP沿用默认选择' : 'VIP选择无效，沿用默认对象');
  }
  if (notes.length) result.designDetail = notes.join('；');
  return result;
}
