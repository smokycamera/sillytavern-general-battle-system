import { MAX_SMALL_UNITS, activeBattleUnits, assertBattleCapacity } from '../../engine/src/battle-limits.js';
import { BATTLEFIELD_PLAN_PROMPT, BattlefieldPlanError } from '../../engine/src/small/battlefield-plan.js';
import { normalizeCommanderProfiles } from '../../engine/src/commander-profile.js';
import { activeTraitIds, isRangedWeapon } from '../../engine/src/index.js';
import { preparationDesignRequest, applyPreparationDesign, type PreparationDesignResult } from './llm-map-design.js';
import { mapDesignSummary, validMapDesign } from '../../engine/src/small/map-design.js';
import { directJevRequest, fetchJevModels, JevConnectionError } from './jev-connection.js';
import { JevTransportError } from './jev-transport.js';
import { encounterRequest, applyEncounterSelection, normalizeContextSettings, ABILITY_LABELS, STYLE_PRESETS, encounterSummary, type EncounterSetup, type JevEncounterContext } from './jev-context.js';
import { llmConnection, type LlmSettings } from './llm-settings.js';
import type { Combatant } from '../../engine/src/index.js';
import type { CommanderProfiles, CommanderProfile } from '../../engine/src/commander-profile.js';
import type { NarrativeMessage, ContextSelectionAnswer } from '../../vendor/jev-core/src/index.js';
import type { NarrativeIdState } from './narrative-ids.js';
import { narrativeIds } from './narrative-ids.js';
import { narrativeMapSources } from './narrative-map-source.js';
import { sha256, withAbort } from '../../host/src/browser-compat.js';

export interface LlmEncounterContext extends JevEncounterContext, PreparationDesignResult { commanders?: CommanderProfiles }
export function llmContextSummary(context: LlmEncounterContext): string {
  const commanders = Object.entries(context.commanders ?? {}).map(([side, p]) => `${side === 'ally' ? '我方' : '敌方'}指挥：${ABILITY_LABELS[p!.ability]} · ${STYLE_PRESETS[p!.style].label}`);
  return [...commanders, encounterSummary(context).split('；').slice(1).join('；'), validMapDesign(context.mapDesign) ? '地图：' + mapDesignSummary(context.mapDesign) : '', context.battlefieldPlan ? '战场：' + (context.battlefieldPlan.size ?? '自动尺寸') + ' / ' + (context.battlefieldPlan.shape ?? context.battlefieldPlan.layout ?? '组合布局') + ' / ' + (context.battlefieldPlan.landmarks?.length ?? '自动') + '地标' + (context.battlefieldPlan.breaches ? ' / ' + context.battlefieldPlan.breaches.count + '处破口' : '') : '', context.vipName ? 'VIP：' + context.vipName : '', context.designDetail].filter(Boolean).join('；');
}
export class LlmContextController {
  private aborter?: AbortController;
  private retry?: { key: string; errors: string[]; expires: number };
  busy = false;
  constructor(private request: typeof fetch = (url, init) => fetch(url, init)) {}
  cancel(clearRetry = true): void { this.aborter?.abort(); if (clearRetry) this.retry = undefined; }
  async models(settings: LlmSettings): Promise<string[]> {
    try { return await fetchJevModels(llmConnection(settings), this.request); }
    catch (error) { throw Error(llmFailure(error)); }
  }
  async select(input: { roster: Combatant[]; setup: EncounterSetup; messages: NarrativeMessage[]; unitNotes?: Record<string, string>; narrativeIdState?: NarrativeIdState; scope?: string }, settings: LlmSettings, valid: () => boolean, validate?: (result: LlmEncounterContext) => void): Promise<LlmEncounterContext> {
    if (this.busy) throw Error('正在读取上下文，请稍候');
    const connection = llmConnection(settings);
    if (!connection.model) throw Error('请先拉取并选择模型，或填写模型 ID');
    // One layer = one completed user/assistant message, in the host's chronological order.
    const messages = input.messages.map(m => ({ ...m, text: m.text.replace(/<(think|analysis|reasoning)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, '').trim() }));
    // Never ask the model to choose an impossible >32-card grid, or spend tokens designing one.
    assertBattleCapacity(input.roster,'mass');
    const forcedMass = activeBattleUnits(input.roster).length > MAX_SMALL_UNITS;
    // Freeze the prepared scale when opted out, including scene-driven mode changes.
    const contextInput = { ...input, messages, settings: normalizeContextSettings({ battleMode: forcedMass ? 'mass' : settings.selectBattleScale === false ? input.setup.mode : 'auto' }), windowSize: settings.windowSize, roles: ['user', 'assistant'], phase: 'preparation' as const };
    const { base, request } = encounterRequest(contextInput);
    if (!request) {
      if (settings.designMap && base.mode === 'small') throw new BattlefieldPlanError('所选范围没有可读取的正文，无法请求副API设计地标；请调整扫描范围或关闭LLM设计地图');
      return { ...base, detail: '所选范围没有可读取的已完成正文，沿用准备设置' };
    }
    request.fields = request.fields.filter(f => f.id !== 'enemy_ability' && !f.id.startsWith('style_'));
    // Preparation needs a concrete choice even when the narrative only provides indirect clues.
    for (const field of request.fields) delete field.options.unknown;
    for (const side of ['ally', 'enemy']) {
      const who = side === 'ally' ? '我方实际指挥官（主控不一定是指挥官）' : '敌方实际指挥官';
      request.fields.push({ id: side + '_ability', question: `结合身份、经历、组织与行动表现，判断${who}的指挥能力；不把战斗等级、人数或胜负直接等同于指挥能力。`, options: { ...ABILITY_LABELS } });
      request.fields.push({ id: side + '_style', question: `结合行为倾向、当前任务与处境，选择${who}的指挥风格。`, options: Object.fromEntries(Object.entries(STYLE_PRESETS).map(([k, v]) => [k, v.label])) });
    }
    const coreRequest = { ...request, fields: [...request.fields] };
    const designRequest = preparationDesignRequest(input.roster, forcedMass ? { ...settings, selectBattleScale: false } : settings, forcedMass ? { ...input.setup, mode: 'mass' } : input.setup, input.unitNotes, request.messages.map(m => m.text).join('\n'), true);
    const bindings=narrativeIds({storage:input.roster,narrativeIdState:input.narrativeIdState});
    if(designRequest.compactMap) {
      const source=narrativeMapSources(request.messages); request.messages=source.messages;
      designRequest.narrativeSources=source.sources;
      designRequest.unitBindings=Object.fromEntries(activeBattleUnits(input.roster).map(u=>[bindings.publicId(u.id),u.id]));
    }
    request.fields.push(...designRequest.fields);
    request.state = {
      encounter: request.state,
      protocol: 'battlefield-v2',
      ...(designRequest.compactMap ? { mapRules: BATTLEFIELD_PLAN_PROMPT } : {}),
      ...(designRequest.compactMap ? { narrativeSources:designRequest.narrativeSources?.map(s=>({id:s.id})) } : {}),
      commandRules: '可返回顶层commanders:{ally:{preferences:{}},enemy:{preferences:{}}}。preferences从reserve预备队/risk冒险/counterattack反击/cohesion协同/breach破障选最多3项，各0—4整数，2为普通。根据当前任务选择偏好，防守结合前沿、机动和纵深防区。',
      ...(designRequest.compactMap ? { units: activeBattleUnits(input.roster).slice(0, 32).map(u => ({ id:bindings.publicId(u.id),name: u.name.slice(0, 80), side: u.side, body: u.body ?? 'human',
        note: (input.unitNotes?.[u.id] ?? '').slice(0, 160), traits: activeTraitIds(u), ranged: isRangedWeapon(u.weapon), weaponLevel: u.weapon?.level ?? 1,
        spells: u.abilities.filter(a => a.delivery === 'magic' && a.effects.some(e => e.op === 'damage')).map(a => a.power ?? 1).slice(0, 3) })) } : {}),
    };
    const aborter = new AbortController(); this.aborter = aborter; this.busy = true;
    const check = () => { if (aborter.signal.aborted || !valid()) throw Error('上下文读取已取消或准备信息已变化，尚未开始战斗'); };
    try {
      check();
      const key = await sha256(new TextEncoder().encode(JSON.stringify([input.scope, connection, request])));
      check();
      if (this.retry?.key !== key || this.retry.expires < Date.now()) this.retry = { key, errors: [], expires: Date.now() + 300000 };
      if (this.retry.errors.length) request.state = { ...request.state as object, retryErrors: this.retry.errors };
      const answer = await withAbort({ timeout: 45000, signals: [aborter.signal] }, signal =>
        directJevRequest(connection, 'select-context', request, signal, this.request)) as ContextSelectionAnswer;
      check();
      for (const field of coreRequest.fields) {
        const selected = answer.selections?.[field.id];
        if (!selected || !Object.hasOwn(field.options, selected.value) || !Number.isFinite(selected.confidence) || selected.confidence < 0 || selected.confidence > 1)
          throw new BattlefieldPlanError(`selections.${field.id}须含合法value和0—1的confidence；value可选${Object.keys(field.options).join('|')}`);
      }
      // Validate supported choices; confidence describes uncertainty, not a fallback threshold.
      const result: LlmEncounterContext = applyEncounterSelection(contextInput, base, coreRequest, answer);
      result.commanders = {};
      for (const side of ['ally', 'enemy'] as const) {
        const ability = answer.selections[side + '_ability']!.value;
        const style = answer.selections[side + '_style']!.value;
        const raw = (answer as ContextSelectionAnswer & { commanders?: CommanderProfiles }).commanders?.[side];
        result.commanders[side] = normalizeCommanderProfiles({ [side]: { ability, style, ...(raw?.preferences ? { preferences: raw.preferences } : {}) } })[side] ?? { ability, style } as CommanderProfile;
      }
      if (result.commanders.enemy) result.enemy = { ability: result.commanders.enemy.ability, style: { ...STYLE_PRESETS[result.commanders.enemy.style].style }, source: 'context' };
      Object.assign(result, applyPreparationDesign(answer, designRequest, result, input.roster));
      try { validate?.(result); }
      catch (error) { throw new BattlefieldPlanError(error instanceof Error ? error.message : '本地地图与部署校验失败'); }
      check();
      this.retry = undefined;
      return result;
    } catch (error) {
      check();
      const detail = error instanceof Error && error.name === 'TimeoutError' ? '模型请求超过45秒，请重试' : llmFailure(error);
      if (this.retry && (error instanceof BattlefieldPlanError || error instanceof JevConnectionError && /JSON|答案|评分/.test(error.message))) {
        this.retry.errors = [...new Set([...this.retry.errors, detail.slice(0, 280)])].slice(-4);
        this.retry.expires = Date.now() + 300000;
      }
      throw Error(`上下文读取失败：${detail}。尚未开战，可重试或在设置中改为手动配置。`);
    } finally { this.busy = false; if (this.aborter === aborter) this.aborter = undefined; }
  }
}
function llmFailure(error: unknown): string {
  if (error instanceof BattlefieldPlanError) return error.message;
  if (!(error instanceof JevConnectionError || error instanceof JevTransportError)) return error instanceof Error && /请先填写 API|普通 LLM/.test(error.message) ? error.message : '模型请求或返回格式无效';
  // These error classes already contain bounded, credential-free diagnostics.
  // Preserve actionable host, timeout and CORS details instead of hiding the cause.
  return error.message;
}
