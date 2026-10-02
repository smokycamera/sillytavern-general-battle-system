import { describe, expect, it, vi } from 'vitest';
import { generateUnit, generatedLayeredField, SmallBattle, V11_OVERFLOW_D20, type Combatant } from '../../engine/src/index.js';
import { LlmContextController, llmContextSummary } from './llm-context.js';
import { compileLayout, layoutTask, type LayoutContext } from './llm-layout.js';
import { prepareBattleObjective } from './battle-setup.js';
import { renderTacticalBattle } from './tactical-view.js';
import type { LlmSettings } from './llm-settings.js';

const settings: LlmSettings = { enabled: true, selectBattleScale: true, designMap: true, selectVip: false, windowSize: 4, url: 'https://gateway.example/v1', token: 'key', model: 'flash', models: [] };
function unit(name: string, side: 'ally' | 'enemy', weaponClass = 'sword'): Combatant {
  const u = generateUnit({ name, side, scale: 'hero', rulesVersion: 'v2', level: 3, weaponClass, weaponLevel: 3, traits: [] }, { seed: name, noVariance: true }).unit;
  u.id = 'raw:' + name; return u;
}
const roster = () => [unit('张辽', 'ally'), unit('乐进', 'ally'), unit('弓手', 'ally', 'bow'), unit('步卒', 'ally'), unit('守将', 'enemy'), unit('亲兵', 'enemy'), unit('弩手', 'enemy', 'bow'), unit('门卒', 'enemy')];
const source = () => ({ roster: roster(), setup: { mode: 'small' as const, field: 'plains', lighting: 'day' as const, mapLayout: 'standard' as const, objectiveMode: 'auto' as const, siegeAttacker: 'ally' as const },
  messages: [{ id: 'm1', role: 'assistant', completed: true, text: '我军兵临青石城下，敌军守将率弩手据守城头，南门紧闭。我军在城南列阵准备攻城。' }] });
const siegeChoice = { battle_mode: 'small', field: 'siege', lighting: 'day', objective: 'siege', siege_attacker: 'ally', ally_ability: 'skilled', ally_style: 'siege', enemy_ability: 'regular', enemy_style: 'core', scene: 'city_siege', size: 'standard' };
function twoStep(layout: unknown, choice: Record<string, string> = siegeChoice) {
  return vi.fn<typeof fetch>(async (_url, init) => {
    const task = JSON.parse(String(init?.body)).messages.at(-1).content as string;
    const content = task.startsWith('【第1步') ? { selections: Object.fromEntries(JSON.parse(task.slice(task.lastIndexOf('\n') + 1)).fields.map((f: { id: string }) => [f.id, { value: choice[f.id], confidence: .8 }])) } : layout;
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }));
  });
}
const sent = (request: ReturnType<typeof twoStep>, n: number) => JSON.parse(String(request.mock.calls[n]![1]!.body));
const ctx = (extra: Partial<LayoutContext> = {}): LayoutContext => ({ scene: 'city_siege', size: 'standard', attacker: 'ally', objectiveMode: 'siege', map: [11, 17],
  units: [{ id: 'u1', name: '张辽', side: 'ally', kind: '人物·近战' }, { id: 'u2', name: '弩手', side: 'enemy', kind: '部队·远程' }], ...extra });

describe('two-step preparation with a compass layout', () => {
  it('decides first, then lays out the chosen siege; both steps share the cached prefix and attackers start outside the walls', async () => {
    const request = twoStep({ city: { at: '北方', name: '青石城', gates: [{ name: '南门', state: 'closed' }] }, ally: { at: ['城南'] }, enemy: { post: '城头' } });
    const input = source(), stages: string[] = [], controller = new LlmContextController(request);
    let field: ReturnType<typeof generatedLayeredField> | undefined;
    const result = await controller.select({ ...input, onStage: () => stages.push(controller.stage!.step + '/' + controller.stage!.of) }, settings, () => true, r => {
      field = generatedLayeredField('two-step', 7, 13, [r.field, 'siege'], { roster: input.roster, attackingSide: r.siegeAttacker, plan: r.battlefieldPlan, unitBindings: r.unitBindings });
      field = prepareBattleObjective(field, input.roster, r.objectiveMode, undefined, r.siegeAttacker);
    });
    expect(request).toHaveBeenCalledTimes(2); expect(stages).toEqual(['decide/2', 'layout/2']);
    const [first, second] = [sent(request, 0), sent(request, 1)];
    expect(second.messages.slice(0, 2)).toEqual(first.messages.slice(0, 2));
    const fields = JSON.parse(first.messages[2].content.slice(first.messages[2].content.lastIndexOf('\n') + 1)).fields.map((f: { id: string }) => f.id);
    expect(fields).toEqual(expect.arrayContaining(['scene', 'size', 'objective', 'ally_style'])); expect(fields).not.toContain('map_layout');
    expect(second.messages[2].content).toMatch(/城墙攻防，攻方=我方（在城外），守方=敌方/);
    expect(second.messages[2].content).toContain('u1 · 张辽 · 我方');
    expect(result.battlefieldPlan).toMatchObject({ scene: 'city_siege', size: 'standard', deployments: [{ subject: 'ally', at: ['south'] }, { subject: 'enemy', at: ['north'], post: 'wall' }] });
    expect(llmContextSummary(result)).toContain('战场：城墙攻防 · 中型 · 青石城在北');
    // Adjustments stay out of the one-line summary.
    expect(llmContextSummary({ ...result, designDetail: 'VIP沿用默认选择', layoutNotes: ['河流改沿城外开阔侧'] })).not.toMatch(/VIP沿用|河流改沿/);
    const city = new Set([...field!.city!.inside, ...field!.city!.frontline]);
    for (const u of input.roster) expect(city.has(field!.initialDeployment![u.id]!.pos), u.name).toBe(u.side === 'enemy');
    expect(controller.stage).toBeUndefined();
  });
  it('skips the layout request when the decision is a mass battle', async () => {
    const request = twoStep({}, { ...siegeChoice, battle_mode: 'mass', objective: 'annihilation', scene: 'field' });
    const result = await new LlmContextController(request).select(source(), settings, () => true);
    expect(result.mode).toBe('mass'); expect(result.battlefieldPlan).toBeUndefined(); expect(request).toHaveBeenCalledTimes(1);
  });
  it('sends a failed layout back to the layout step only, and clears it after success', async () => {
    const request = twoStep({ city: { at: 'N' }, ally: { at: ['S'] } }), controller = new LlmContextController(request), input = { ...source(), scope: 'chat' };
    await expect(controller.select(input, settings, () => true, () => { throw Error('塔楼地标部署容量不足'); })).rejects.toThrow('（布置地图）');
    await controller.select(input, settings, () => true);
    const retried = sent(request, 3).messages[2].content as string, decided = sent(request, 2).messages[2].content as string;
    expect(retried).toContain('上次布置未能生成地图，请修正：塔楼地标部署容量不足');
    expect(JSON.parse(decided.slice(decided.lastIndexOf('\n') + 1)).state.retryErrors).toBeUndefined();
    await controller.select(input, settings, () => true);
    expect(sent(request, 5).messages[2].content).not.toContain('上次布置');
  });
  it('discards a layout that arrives after cancellation', async () => {
    let release!: () => void;
    const answer = twoStep({ city: { at: 'N' } }), controller = new LlmContextController(async (url, init) => {
      if (String(init?.body).includes('【第2步')) await new Promise<void>(resolve => { release = resolve; });
      return answer(url, init);
    });
    const pending = controller.select(source(), settings, () => true);
    await vi.waitFor(() => expect(controller.stage?.step).toBe('layout'));
    await vi.waitFor(() => expect(release).toBeDefined());
    controller.cancel(); release();
    await expect(pending).rejects.toThrow('尚未开始战斗'); expect(controller.busy).toBe(false);
  });
});

describe('compass layout compiler', () => {
  it('reads compass words in several spellings and keeps siege roles out of the answer', () => {
    const { plan, notes } = compileLayout({ battlefield: { city: { at: '城北', name: '青石城、外郭', wall: 12 }, ally: { at: ['左下', 'south'], post: 'wall' }, enemy: { at: 'N' } } }, ctx());
    expect(plan.intent!.entities[0]).toMatchObject({ kind: 'city', anchor: 'north', label: '青石城·外郭' });
    expect(plan.fortLevel).toBe(10);
    expect(plan.deployments).toEqual([{ subject: 'ally', at: ['south_west', 'south'] }, { subject: 'enemy', at: ['north'] }]);
  });
  it('supplies a missing siege city on the defending side and routes a moat along its open side', () => {
    const { plan, notes } = compileLayout({ water: { type: '护城河', at: 'S', bridges: [{ name: '吊桥', at: 'S' }] } }, ctx({ attacker: 'enemy' }));
    expect(plan.intent!.entities.find(e => e.kind === 'city')).toMatchObject({ anchor: 'south' });
    expect(plan.intent!.entities.find(e => e.kind === 'river')).toMatchObject({ anchor: 'center' });
    expect(plan).toMatchObject({ water: 'moat' }); expect(plan.intent!.constraints).toContainEqual(expect.objectContaining({ kind: 'crossing_count', value: 1 }));
    expect(notes.join()).toMatch(/守方一侧（南）.*护城河沿城外开阔侧布置/);
  });
  it('turns a siege objective at a town in an open field into a walled siege', () => {
    const { plan } = compileLayout({ city: { at: 'N', name: '坞堡' }, places: [{ type: '府衙', name: '府衙', at: 'N' }, { type: 'building', name: '府衙', at: 'N' }], objective: '府衙' }, ctx({ scene: 'field' }));
    expect(plan.scene).toBe('city_siege');
    const target = plan.intent!.relations[0]!;
    expect(target).toMatchObject({ subject: 'ally', relation: 'targets' });
    expect(plan.intent!.entities.find(e => e.id === target.object)).toMatchObject({ kind: 'building', label: '府衙' });
  });
  it('binds an escort exit to a compass edge and detachments by handle or unique name', () => {
    const { plan } = compileLayout({ ally: { at: 'S' }, objective: '北', units: [{ unit: '张辽', at: 'W' }, { unit: 'U2', at: 'E' }, { unit: '无名', at: 'E' }] }, ctx({ scene: 'field', objectiveMode: 'escort' }));
    expect(plan.intent!.relations).toEqual([expect.objectContaining({ subject: 'ally', relation: 'exits_at', object: 'exit' })]);
    expect(plan.intent!.entities.find(e => e.id === 'exit')).toMatchObject({ kind: 'position', anchor: 'north' });
    expect(plan.deployments).toEqual([{ subject: 'ally', at: ['south'] }, { subject: 'enemy', at: ['north'] }, { subject: 'u1', at: ['west'] }, { subject: 'u2', at: ['east'] }]);
  });
  it('fits the scene: indoor kinds, no outdoor water indoors, and the 12-entity budget', () => {
    const indoor = compileLayout({ places: [{ type: 'building', name: '书房', at: 'N' }, { type: 'hill', name: '假山' }], water: { type: 'river', at: 'E' } }, ctx({ scene: 'interior', objectiveMode: 'annihilation' }));
    expect(indoor.plan.intent!.entities.map(e => e.kind)).toEqual(['room']);
    expect(indoor.notes).toEqual(expect.arrayContaining(['本场景不设水系']));
    const crowded = compileLayout({ city: { at: 'N', gates: [{}, {}, {}, {}] }, water: { type: 'river', at: 'E', bridges: [{}, {}, {}, {}] },
      places: Array.from({ length: 8 }, (_, i) => ({ type: 'cover', name: '掩体' + i, at: 'C' })) }, ctx());
    expect(crowded.plan.intent!.entities).toHaveLength(12);
    expect(crowded.plan.intent!.entities.filter(e => e.kind === 'cover').map(e => e.label)).toEqual(['掩体0', '掩体1']);
  });
  it('lists layout adjustments under the map details, without repeating the scene name', () => {
    const units = roster(), plan = compileLayout({ city: { at: 'N', name: '青石城' }, water: { type: 'river', at: 'N' }, ally: { at: ['N'] } }, ctx()).plan;
    const field = generatedLayeredField('notes', 7, 13, ['siege'], { roster: units, plan: { ...plan, archetype: 'gate_front' } });
    field.generation!.notes = ['河流改沿城外开阔侧', ...field.generation!.notes!];
    const battle = new SmallBattle({ rules: V11_OVERFLOW_D20, battlefield: field, combatants: structuredClone(units), seed: 'notes' }); battle.start();
    const details = /<details class="map-context">([\s\S]*?)<\/details>/.exec(renderTacticalBattle(battle, { mode: 'weapon' }))![1]!;
    expect(details).toContain('<summary>城门前沿 · 上北下南 · 查看布局依据</summary>');
    expect(details).toContain('<li>河流改沿城外开阔侧</li>'); expect(details).toContain('<li>我方改在城外正面开局</li>');
    expect(details).not.toContain('<li>城门前沿</li>');
  });
  it('describes the roles and an example that matches the defending side', () => {
    const task = layoutTask(ctx({ attacker: 'enemy' }), ['上次的错误']);
    expect(task).toContain('攻方=敌方（在城外），守方=我方（守城）');
    expect(task).toContain('"ally":{"post":"wall"}');
    expect(task).toContain('上次布置未能生成地图，请修正：上次的错误');
  });
});
