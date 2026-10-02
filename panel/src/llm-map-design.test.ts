import { describe, expect, it, vi } from 'vitest';
import { generateUnit, generatedField } from '../../engine/src/index.js';
import type { ContextSelectionAnswer } from '../../vendor/jev-core/src/index.js';
import { LlmContextController, llmContextSummary } from './llm-context.js';
import { preparationDesignRequest, applyPreparationDesign } from './llm-map-design.js';
import { prepareBattleObjective } from './battle-setup.js';
import type { LlmSettings } from './llm-settings.js';
const settings: LlmSettings = { enabled: true, selectBattleScale: false, designMap: false, selectVip: true, windowSize: 6, url: 'https://gateway.example/v1', token: 'key', model: 'chosen', models: [] };
function input() {
  const roster = (['ally', 'ally', 'enemy', 'enemy', 'enemy'] as const).map((side, n) => {
    const u = generateUnit({ name: ['护卫', '运输队', '敌军卫队', '<b>运载车</b>', '已溃退单位'][n]!, side, scale: 'company', level: 3, hpMax: 12, rulesVersion: 'v2', traits: [] }, { seed: String(n) }).unit;
    u.id = `raw:id:${n}/not-an-option`; if (n === 4) u.status = 'routing'; return u;
  });
  return { roster, setup: { mode: 'small' as const, field: 'urban', lighting: 'day' as const, mapLayout: 'standard' as const, objectiveMode: 'intercept' as const, siegeAttacker: 'ally' as const },
    messages: [{ id: 'last', role: 'assistant', completed: true, text: '需要截获敌方运载车，运输队是我们自己的。敌方左侧高地与废弃庭院之间有狭窄侧路。' }],
    unitNotes: { [roster[3]!.id]: '载有任务重要货物，不是护卫' } };
}
const decisionBody = (init?: RequestInit) => { const task = JSON.parse(String(init?.body)).messages.at(-1).content as string; return JSON.parse(task.slice(task.lastIndexOf('\n') + 1)); };
function model(overrides: Record<string, unknown> = {}) {
  return vi.fn<typeof fetch>(async (_url, init) => {
    const request = decisionBody(init);
    const values = { battle_mode: 'small', field: 'urban', lighting: 'night', map_layout: 'standard', objective: 'intercept', siege_attacker: 'enemy', ally_ability: 'skilled', ally_style: 'balanced', enemy_ability: 'expert', enemy_style: 'cautious', vip_ally: 'unit_1', vip_enemy: 'unit_1', ...overrides };
    const selections = Object.fromEntries(request.fields.map((f: { id: string }) => [f.id, { value: (values as Record<string, unknown>)[f.id], confidence: 0 }]));
    // Deliberate unsolicited output must not make disabled switches take effect.
    selections.vip_enemy ??= { value: 'unit_1', confidence: 1 };
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ selections }) } }] }));
  });
}
describe('optional ordinary LLM VIP preparation', () => {
  it('selects the enemy VIP in the decision request and binds it to the objective', async () => {
    const source = input(), before = structuredClone(source), request = model();
    const result = await new LlmContextController(request).select(source, settings, () => true);
    expect(request).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ vipId: source.roster[3]!.id, vipName: '<b>运载车</b>' });
    const task = JSON.parse(String(request.mock.calls[0]![1]!.body)).messages.at(-1).content as string;
    expect(task).toContain('载有任务重要货物');
    const body = decisionBody(request.mock.calls[0]![1]);
    expect(body.fields).toHaveLength(11); // 9 core + 2 VIP
    expect(body.fields.find((f: {id:string}) => f.id === 'vip_enemy').options).not.toHaveProperty('unit_2');
    const objective = prepareBattleObjective(generatedField('context', 7, 13, ['urban', 'night']), source.roster, result.objectiveMode, source.roster[0]!.id, result.siegeAttacker, result.vipId);
    expect(objective.objective).toMatchObject({ unitId: source.roster[3]!.id });
    expect(llmContextSummary(result)).toContain('VIP：<b>运载车</b>');
    expect(source).toEqual(before);
  });
  it.each([false, true])('VIP switch %s, including unsolicited answers', async selectVip => {
    const source = input(), request = model({ objective: 'escort' });
    const result = await new LlmContextController(request).select(source, { ...settings, selectVip }, () => true);
    const fields = decisionBody(request.mock.calls[0]![1]).fields;
    expect(fields.some((f: { id: string }) => f.id.startsWith('vip_'))).toBe(selectVip);
    expect(result.vipId).toBe(selectVip ? source.roster[1]!.id : undefined);
  });
  it.each(['raw:id:3/not-an-option', 'unit_99', 'default', '__proto__'])('invalid/default VIP %s cannot introduce an arbitrary or wrong-side target', async invalid => {
    const source = input();
    const result = await new LlmContextController(model({ vip_enemy: invalid })).select(source, settings, () => true);
    expect(result.vipId).toBeUndefined(); expect(result.designDetail).toContain('默认');
    const field = prepareBattleObjective(generatedField('fallback'), source.roster, 'intercept', source.roster[0]!.id, 'ally', result.vipId);
    expect(field.objective).toMatchObject({ unitId: source.roster[2]!.id });
  });
  it('mass mode and non-escort objectives ignore inapplicable VIP output', async () => {
    const source = input(), fixedMass = { ...source, setup: { ...source.setup, mode: 'mass' as const } }, request = model();
    const mass = await new LlmContextController(request).select(fixedMass, { ...settings, designMap: true }, () => true);
    expect(mass.vipId).toBeUndefined(); expect(mass.battlefieldPlan).toBeUndefined(); expect(request).toHaveBeenCalledTimes(1);
    const fields = decisionBody(request.mock.calls[0]![1]).fields;
    expect(fields.some((f: { id: string }) => /^(scene|size|vip_)/.test(f.id))).toBe(false);
    const annihilation = await new LlmContextController(model({ objective: 'annihilation' })).select(source, settings, () => true);
    expect(annihilation.vipId).toBeUndefined();
  });
  it('revalidates eligibility at objective construction and never swaps sides', () => {
    const source = input(), field = generatedField('guard');
    for (const id of [source.roster[1]!.id, source.roster[4]!.id, 'missing']) {
      expect(prepareBattleObjective(field, source.roster, 'intercept', undefined, 'ally', id).objective).toMatchObject({ unitId: source.roster[2]!.id });
    }
    source.roster[3]!.hp = 0;
    expect(prepareBattleObjective(field, source.roster, 'intercept', undefined, 'ally', source.roster[3]!.id).objective).toMatchObject({ unitId: source.roster[2]!.id });
  });
  it('bounds candidate aliases and ignores non-finite confidence', () => {
    const source = input(), extension = preparationDesignRequest(source.roster, settings, source.setup);
    const answer: ContextSelectionAnswer = { model: 'model', selections: Object.fromEntries(extension.fields.map(f => [f.id, { value: Object.keys(f.options)[1]!, confidence: Infinity }])) };
    expect(applyPreparationDesign(answer, extension, source.setup, source.roster)).toEqual({ designDetail: 'VIP选择无效，沿用默认对象' });
    const tooMany = Array.from({length: 32}, (_, n) => ({ ...source.roster[0]!, id: String(n) }));
    const bounded = preparationDesignRequest(tooMany, settings, source.setup);
    expect(bounded.fields.some(f => f.id === 'vip_ally')).toBe(false); expect(bounded.notes[0]).toContain('过多');
  });
});
