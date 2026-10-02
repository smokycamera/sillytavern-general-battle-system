import type { BattlefieldPlan } from '../../engine/src/small/battlefield-plan.js';
import type { MapDesign, Combatant } from '../../engine/src/index.js';
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
  /** Read only from contexts saved by older versions. */
  mapDesign?: MapDesign;
  battlefieldPlan?: BattlefieldPlan;
  unitBindings?: Record<string,string>;
  vipId?: string;
  vipName?: string;
  designDetail?: string;
}

/** VIP choices ride on the decision step; raw unit IDs are never option IDs. The map has its own layout step. */
export function preparationDesignRequest(roster: Combatant[], settings: LlmSettings, setup: EncounterSetup, unitNotes: Record<string, string> = {}): PreparationDesignRequest {
  const result: PreparationDesignRequest = { fields: [], vipIds: {}, notes: [] };
  // A fixed mass battle has no tactical grid or escape objective.
  if (settings.selectBattleScale === false && setup.mode === 'mass') return result;
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
/** An invalid or default VIP keeps the default object; a wrong-side or ineligible unit is never chosen. */
export function applyPreparationDesign(answer: ContextSelectionAnswer, request: PreparationDesignRequest, setup: EncounterSetup, roster: Combatant[]): PreparationDesignResult {
  if (setup.mode !== 'small') return {};
  const result: PreparationDesignResult = {}, notes = [...request.notes];
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
