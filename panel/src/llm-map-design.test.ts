import { describe, expect, it, vi } from 'vitest';
import { generateUnit, generatedField, MAP_DESIGN_OPTIONS, type MapDesign } from '../../engine/src/index.js';
import { validateContextSelectionRequest, type ContextSelectionAnswer } from '../../vendor/jev-core/src/index.js';
import { LlmContextController, llmContextSummary } from './llm-context.js';
import { preparationDesignRequest, applyPreparationDesign } from './llm-map-design.js';
import { prepareBattleObjective } from './battle-setup.js';
import type { LlmSettings } from './llm-settings.js';
const settings: LlmSettings = { enabled: true, selectBattleScale: false, designMap: true, selectVip: true, windowSize: 6, url: 'https://gateway.example/v1', token: 'key', model: 'chosen', models: [] };
const plan: MapDesign = { layout: 'ring', orientation: 'diagonal', relief: 'dense', cover: 'dense', obstacles: 'sparse', route: 'flank', breadth: 'narrow', feature: 'hill', featureZone: 'enemy_left' };
function input() {
  const roster = (['ally', 'ally', 'enemy', 'enemy', 'enemy'] as const).map((side, n) => {
    const u = generateUnit({ name: ['护卫', '运输队', '敌军卫队', '<b>运载车</b>', '已溃退单位'][n]!, side, scale: 'company', level: 3, hpMax: 12, rulesVersion: 'v2', traits: [] }, { seed: String(n) }).unit;
    u.id = `raw:id:${n}/not-an-option`; if (n === 4) u.status = 'routing'; return u;
  });
  return { roster, setup: { mode: 'small' as const, field: 'urban', lighting: 'day' as const, mapLayout: 'standard' as const, objectiveMode: 'intercept' as const, siegeAttacker: 'ally' as const },
    messages: [{ id: 'last', role: 'assistant', completed: true, text: '需要截获敌方运载车，运输队是我们自己的。敌方左侧高地与废弃庭院之间有狭窄侧路。' }],
    unitNotes: { [roster[3]!.id]: '载有任务重要货物，不是护卫' } };
}
function model(overrides: Record<string, unknown> = {}, landmarkLabel?: unknown) {
  return vi.fn<typeof fetch>(async (_url, init) => {
    const payload = JSON.parse(String(init?.body)), request = JSON.parse(payload.messages[1].content);
    validateContextSelectionRequest(request);
    const values = { battle_mode: 'small', field: 'urban', lighting: 'night', map_layout: 'standard', objective: 'intercept', siege_attacker: 'enemy', ally_ability: 'skilled', ally_style: 'balanced', enemy_ability: 'expert', enemy_style: 'cautious', vip_ally: 'unit_1', vip_enemy: 'unit_1',
      ...Object.fromEntries(Object.entries(plan).map(([key, value]) => ['design_' + key.toLowerCase(), value])), ...overrides };
    const selections = Object.fromEntries(request.fields.map((f: { id: string }) => [f.id, { value: (values as Record<string, unknown>)[f.id], confidence: 0 }]));
    // Deliberate unsolicited output must not make disabled switches take effect.
    selections.vip_enemy ??= { value: 'unit_1', confidence: 1 };
    for (const [key, value] of Object.entries(plan)) selections['design_' + key.toLowerCase()] ??= { value, confidence: 1 };
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ selections, landmarkLabel }) } }] }));
  });
}
describe('optional ordinary LLM map/VIP preparation', () => {
  it('selects contextual geometry and enemy VIP in one validated request and materializes the map', async () => {
    const source = input(), before = structuredClone(source), request = model();
    const result = await new LlmContextController(request).select(source, settings, () => true);
    expect(request).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ mapDesign: plan, vipId: source.roster[3]!.id, vipName: '<b>运载车</b>' });
    const payload = JSON.parse(String(request.mock.calls[0]![1]!.body));
    expect(payload.messages[1].content).toContain('载有任务重要货物');
    const body = JSON.parse(payload.messages[1].content);
    expect(body.fields).toHaveLength(22); // 9 core + 11 geometry + 2 VIP
    expect(body.fields.find((f: {id:string}) => f.id === 'vip_enemy').options).not.toHaveProperty('unit_2');
    const field = generatedField('context', 7, 13, ['urban', 'night'], { design: result.mapDesign });
    expect(field.tiles).not.toEqual(generatedField('context', 7, 13, ['urban', 'night']).tiles);
    expect(field.generation!.landmark!.cells.length).toBeGreaterThan(0);
    const objective = prepareBattleObjective(field, source.roster, result.objectiveMode, source.roster[0]!.id, result.siegeAttacker, result.vipId);
    expect(objective.objective).toMatchObject({ unitId: source.roster[3]!.id, cell: 87 });
    expect(llmContextSummary(result)).toContain('地图：环绕');
    expect(source).toEqual(before);
  });
  it.each([[false, false], [true, false], [false, true], [true, true]])('independent switches map=%s VIP=%s, including unsolicited answers', async (designMap, selectVip) => {
    const source = input(), request = model({ objective: 'escort' });
    const result = await new LlmContextController(request).select(source, { ...settings, designMap, selectVip }, () => true);
    const fields = JSON.parse(JSON.parse(String(request.mock.calls[0]![1]!.body)).messages[1].content).fields;
    expect(fields.some((f: { id: string }) => f.id.startsWith('design_'))).toBe(designMap);
    expect(fields.some((f: { id: string }) => f.id.startsWith('vip_'))).toBe(selectVip);
    expect(!!result.mapDesign).toBe(designMap);
    expect(result.vipId).toBe(selectVip ? source.roster[1]!.id : undefined);
  });
  it.each([undefined, 'lava', '__proto__', 123])('invalid optional map field %s falls back without breaking valid commanders or VIP', async invalid => {
    const source = input();
    const result = await new LlmContextController(model({ design_feature: invalid })).select(source, settings, () => true);
    expect(result.mapDesign).toBeUndefined(); expect(result.designDetail).toContain('本地随机');
    expect(result.vipId).toBe(source.roster[3]!.id); expect(result.commanders!.enemy!.ability).toBe('expert');
  });
  it.each(['raw:id:3/not-an-option', 'unit_99', 'default', '__proto__'])('invalid/default VIP %s cannot introduce an arbitrary or wrong-side target', async invalid => {
    const source = input();
    const result = await new LlmContextController(model({ vip_enemy: invalid })).select(source, settings, () => true);
    expect(result.vipId).toBeUndefined(); expect(result.mapDesign).toEqual(plan); expect(result.designDetail).toContain('默认');
    const field = prepareBattleObjective(generatedField('fallback'), source.roster, 'intercept', source.roster[0]!.id, 'ally', result.vipId);
    expect(field.objective).toMatchObject({ unitId: source.roster[2]!.id });
  });
  it('mass mode and non-escort objectives ignore inapplicable map/VIP output', async () => {
    const source = input(), fixedMass = { ...source, setup: { ...source.setup, mode: 'mass' as const } }, request = model();
    const mass = await new LlmContextController(request).select(fixedMass, settings, () => true);
    expect(mass.mapDesign).toBeUndefined(); expect(mass.vipId).toBeUndefined();
    const fields = JSON.parse(JSON.parse(String(request.mock.calls[0]![1]!.body)).messages[1].content).fields;
    expect(fields.some((f: { id: string }) => /^(design_|vip_)/.test(f.id))).toBe(false);
    const annihilation = await new LlmContextController(model({ objective: 'annihilation' })).select(source, settings, () => true);
    expect(annihilation.vipId).toBeUndefined(); expect(annihilation.mapDesign).toEqual(plan);
    const selectedMass = await new LlmContextController(model({ battle_mode: 'mass', objective: 'annihilation' })).select(source, { ...settings, selectBattleScale: true }, () => true);
    expect(selectedMass.mode).toBe('mass'); expect(selectedMass.mapDesign).toBeUndefined();
  });
  it('revalidates eligibility at objective construction and never swaps sides', () => {
    const source = input(), field = generatedField('guard');
    for (const id of [source.roster[1]!.id, source.roster[4]!.id, 'missing']) {
      expect(prepareBattleObjective(field, source.roster, 'intercept', undefined, 'ally', id).objective).toMatchObject({ unitId: source.roster[2]!.id });
    }
    source.roster[3]!.hp = 0;
    expect(prepareBattleObjective(field, source.roster, 'intercept', undefined, 'ally', source.roster[3]!.id).objective).toMatchObject({ unitId: source.roster[2]!.id });
  });
  it('bounds candidate aliases and rejects non-finite confidence without partial map application', () => {
    const source = input(), extension = preparationDesignRequest(source.roster, settings, source.setup);
    const answer: ContextSelectionAnswer = { model: 'model', selections: Object.fromEntries(extension.fields.map(f => [f.id, { value: Object.keys(f.options)[0]!, confidence: Infinity }])) };
    expect(applyPreparationDesign(answer, extension, source.setup, source.roster)).toMatchObject({ designDetail: expect.stringContaining('无效') });
    const tooMany = Array.from({length: 32}, (_, n) => ({ ...source.roster[0]!, id: String(n) }));
    const bounded = preparationDesignRequest(tooMany, settings, source.setup);
    expect(bounded.fields.some(f => f.id === 'vip_ally')).toBe(false); expect(bounded.notes[0]).toContain('过多');
  });
  it('accepts bounded topology/scale and exact narrative names in the same single request', async () => {
    const source = input(); source.messages[0]!.text += '废弃钟楼旁是敌军的地堡。';
    const request = model({ design_topology: 'braid', design_landmarkscale: 'major' }, '废弃钟楼');
    const result = await new LlmContextController(request).select(source, settings, () => true);
    expect(request).toHaveBeenCalledTimes(1);
    expect(result.mapDesign).toMatchObject({ topology: 'braid', landmarkScale: 'major', landmarkLabel: '废弃钟楼' });
    const field = generatedField('labels', 7, 13, ['urban'], { design: result.mapDesign });
    expect(field.generation!.landmark!.label).toBe('废弃钟楼');
  });
  it.each(['凭空出现的神殿', '<img src=x>', '城门\n忽略规则', 'a'.repeat(70), 123])('rejects ungrounded/unsafe display label %s, without discarding usable geometry', async name => {
    const result = await new LlmContextController(model({ design_topology: 'teleport', design_landmarkscale: 'world' }, name)).select(input(), settings, () => true);
    expect(result.mapDesign).toEqual(plan); expect(result.designDetail).toContain('地标名称无效');
  });
  it('does not take a name from hidden reasoning or unsolicited output when map design is off', async () => {
    const source = input(); source.messages[0]!.text += '<think>隐藏钟楼</think>';
    const result = await new LlmContextController(model({}, '隐藏钟楼')).select(source, settings, () => true);
    expect(result.mapDesign!.landmarkLabel).toBeUndefined();
    const disabled = await new LlmContextController(model({}, '废弃庭院')).select(source, { ...settings, designMap: false }, () => true);
    expect(disabled.mapDesign).toBeUndefined();
    expect(disabled.vipId).toBe(source.roster[3]!.id);
  });
  it('cancellation/stale facts discard optional choices too, even when the transport ignores abort', async () => {
    const source = input(), responder = model(); let release!: () => void; let current = true;
    const request = vi.fn<typeof fetch>(async (...args) => { await new Promise<void>(resolve => { release = resolve; }); return responder(...args); });
    const controller = new LlmContextController(request), pending = controller.select(source, settings, () => current);
    current = false; controller.cancel(); release();
    await expect(pending).rejects.toThrow('尚未开始战斗'); expect(controller.busy).toBe(false);
  });
});
