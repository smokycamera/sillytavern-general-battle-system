import { describe, expect, it, vi } from 'vitest';
import { generateUnit, generatedLayeredField, SmallBattle, V11_OVERFLOW_D20, type Combatant } from '../../engine/src/index.js';
import { AUTO_TRIES, LAYOUT_TRIES, LlmContextController, llmContextSummary } from './llm-context.js';
import { compileLayout, layoutRetryNote, layoutTask, reduceLayout, type LayoutContext } from './llm-layout.js';
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
  it('asks again for the layout alone, with the answer that failed, and clears the memory after success', async () => {
    const request = twoStep({ city: { at: 'N' }, ally: { at: ['S'] } }), controller = new LlmContextController(request), stages: string[] = [];
    const input = { ...source(), scope: 'chat', onStage: () => stages.push(`${controller.stage!.step}#${controller.stage!.attempt}`) };
    let failures = 1;
    await controller.select(input, settings, () => true, () => { if (failures-- > 0) throw Error('塔楼地标部署容量不足'); });
    // One start: the decision is kept and only the layout is asked for again.
    expect(request).toHaveBeenCalledTimes(3); expect(stages).toEqual(['decide#1', 'layout#1', 'layout#2']);
    const retried = sent(request, 2).messages[2].content as string;
    expect(retried).toContain('【上次布置未能生成地图】');
    expect(retried).toContain('上次回答：{"city":{"at":"N"},"ally":{"at":["S"]}}');
    expect(retried).toContain('失败原因与改法：塔楼地标部署容量不足。改法：地点放不下');
    await controller.select(input, settings, () => true);
    expect(sent(request, 4).messages[2].content).not.toContain('上次布置');
  });
  it(`gives up after ${AUTO_TRIES} tries per start, keeps layout errors out of the decision, and does not repeat a transport error`, async () => {
    const request = twoStep({ city: { at: 'N' } }), controller = new LlmContextController(request), input = { ...source(), scope: 'chat' };
    await expect(controller.select(input, settings, () => true, () => { throw Error('塔楼地标部署容量不足'); })).rejects.toThrow(`（布置地图）：塔楼地标部署容量不足。已自动尝试${AUTO_TRIES}次，尚未开战`);
    expect(request).toHaveBeenCalledTimes(1 + AUTO_TRIES);
    // The next start asks for the decision again, without the layout's errors.
    await controller.select(input, settings, () => true);
    const decided = sent(request, 1 + AUTO_TRIES).messages[2].content as string;
    expect(JSON.parse(decided.slice(decided.lastIndexOf('\n') + 1)).state.retryErrors).toBeUndefined();
    const down = vi.fn<typeof fetch>(async () => new Response('upstream down', { status: 500 }));
    const failed = new LlmContextController(down).select(input, settings, () => true);
    await expect(failed).rejects.toThrow('HTTP 500'); await expect(failed).rejects.not.toThrow('已自动尝试');
    expect(down).toHaveBeenCalledTimes(1);
  });
  const beacon = { city: { at: 'N', name: '青石城' }, places: [{ type: 'tower', name: '烽火台', at: 'NE' }, { type: 'building', name: '府衙', at: 'N' }], ally: { at: ['S'] }, enemy: { post: 'wall' } };
  const noBeacon = (r: { battlefieldPlan?: { intent?: { entities: { label?: string }[] } } }) => {
    if (r.battlefieldPlan?.intent?.entities.some(e => e.label === '烽火台')) throw Error('地标烽火台在指定区域部署容量不足');
  };
  it(`builds the ${LAYOUT_TRIES}th failing layout, at the end of the second start, from the parts that can be generated`, async () => {
    const request = twoStep(beacon), controller = new LlmContextController(request), input = { ...source(), scope: 'chat' };
    await expect(controller.select(input, settings, () => true, noBeacon)).rejects.toThrow('地标烽火台在指定区域部署容量不足');
    const result = await controller.select(input, settings, () => true, noBeacon);
    // Two starts, each one decision and three layouts.
    expect(request).toHaveBeenCalledTimes(2 * (1 + AUTO_TRIES)); expect(LAYOUT_TRIES).toBe(2 * AUTO_TRIES);
    const last = JSON.parse(String(request.mock.calls.at(-1)![1]!.body)).messages[2].content as string;
    expect(last).toContain('失败原因与改法：地标烽火台在指定区域部署容量不足。改法：地点「烽火台」放不下');
    // The same failure five times is one note, not five.
    expect(last).not.toContain('更早的失败');
    expect(result.layoutNotes!.slice(0, 2)).toEqual([`连续${LAYOUT_TRIES}次布置未能生成地图，只采用回答中能生成的部分`, '未采用地点「烽火台」']);
    expect(result.battlefieldPlan!.intent!.entities.map(e => e.label)).toEqual(['青石城', '府衙']);
    expect(result.battlefieldPlan!.deployments).toEqual([{ subject: 'ally', at: ['south'] }, { subject: 'enemy', at: ['north'], post: 'wall' }]);
    // Success clears the count: the next start fails its three tries again.
    await expect(controller.select(input, settings, () => true, () => { throw Error('无法为完整名单生成合法部署'); })).rejects.toThrow(`已自动尝试${AUTO_TRIES}次`);
  });
  it('falls back to the local map when no part of the final answer can be built, and reads an unreadable final answer as empty', async () => {
    const input = { ...source(), scope: 'chat' }, planless = (r: { battlefieldPlan?: unknown }) => { if (r.battlefieldPlan) throw Error('无法为完整名单生成合法部署'); };
    const controller = new LlmContextController(twoStep(beacon));
    await expect(controller.select(input, settings, () => true, planless)).rejects.toThrow('布置地图');
    const local = await controller.select(input, settings, () => true, planless);
    expect(local.battlefieldPlan).toBeUndefined(); expect(local.unitBindings).toBeUndefined();
    expect(local.layoutNotes).toEqual([`连续${LAYOUT_TRIES}次布置未能生成地图，只采用回答中能生成的部分`, '双方开局位置改由程序决定', '未采用地点「烽火台」「府衙」',
      '城市改由程序布置', '回答中没有能生成的部分，改用本地生成的地图']);
    const unreadable = new LlmContextController(twoStep('地图如下：无'));
    await expect(unreadable.select(input, settings, () => true)).rejects.toThrow('模型返回无效布置');
    const decided = await unreadable.select(input, settings, () => true);
    expect(decided.battlefieldPlan).toMatchObject({ scene: 'city_siege', size: 'standard' });
    expect(decided.layoutNotes!.slice(0, 2)).toEqual([`连续${LAYOUT_TRIES}次布置未能生成地图，只采用回答中能生成的部分`, '布置回答无法读取，只按开战决策生成']);
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
    const task = layoutTask(ctx({ attacker: 'enemy' }), { answer: { city: { at: 'S' } }, errors: ['更早的错误', '上次的错误'] });
    expect(task).toContain('攻方=敌方（在城外），守方=我方（守城）');
    expect(task).toContain('"ally":{"post":"wall"}');
    expect(task.split('\n').slice(-4)).toEqual(['【上次布置未能生成地图】在上次回答的基础上只改与失败有关的项，其余照旧；拿不准的项直接删去，由程序决定。',
      '上次回答：{"city":{"at":"S"}}', '失败原因与改法：上次的错误', '更早的失败，不要重犯：更早的错误']);
    expect(layoutTask(ctx(), { errors: ['模型返回无效布置'] })).not.toContain('上次回答：');
  });
  it('reports a local failure in the answer\'s own terms, with the usual fix', () => {
    const { plan } = compileLayout({ places: [{ type: 'building', name: '府衙', at: 'N' }, { type: 'tower', at: 'NE' }], objective: '府衙' }, ctx());
    expect(layoutRetryNote('正文关系引用的地点place1没有生成', plan)).toBe('正文关系引用的地点「府衙」没有生成。改法：objective「府衙」处没有可站立的空地：改写为空旷的地点（如广场空地、营地）或九宫格方位，或省略objective');
    expect(layoutRetryNote('地点place2未落在正文指定的north_east区域', plan)).toMatch(/^地点塔楼未落在正文指定的NE（东北）区域。改法：地点「塔楼」放不下/);
    expect(layoutRetryNote('地标tower在指定区域部署容量不足', plan)).toMatch(/^地标塔楼在指定区域部署容量不足。改法：地点「塔楼」放不下/);
    expect(layoutRetryNote('目标必须是合法可通行格')).toMatch(/改法：任务目标处被实心地点占住/);
    expect(layoutRetryNote('模型未返回有效布置 JSON，请检查模型是否支持 JSON 输出')).toBe('模型未返回有效布置 JSON。改法：只输出一个JSON对象，不要附加说明文字、注释或代码块');
    expect(layoutRetryNote('河流与完整城墙重叠，请调整城市或河流方位')).toMatch(/改法：水系写在城市对侧/);
    expect(layoutRetryNote('我方没有可用的开局位置，请调整部署方位')).toMatch(/改法：双方at各写2—3个相邻的空旷方位/);
  });
  it('leaves out the named place first, then the part the error points to, then the least essential part', () => {
    const answer = { battlefield: { city: { at: 'N', gates: [{ name: '南门' }] }, water: { type: 'river', at: 'E', bridges: [{ at: 'E' }] },
      places: [{ type: 'tower', name: '烽火台', at: 'NE' }, { type: 'hill', name: '东坡', at: 'E' }], ally: { at: ['S'] }, units: [{ unit: 'u1', at: 'W' }], objective: '东坡', cover: 'dense' } };
    const steps: string[] = [];
    let rest: unknown = answer;
    for (const error of ['地标烽火台在指定区域部署容量不足', '桥梁部署容量不足，无法保留数量、宽度和位置', '正文任务地点没有合法目标格', '我方没有可用的开局位置，请调整部署方位', '其他', '其他', '其他', '其他', '其他', '其他']) {
      const next = reduceLayout(rest, error, ctx());
      if (!next) break;
      steps.push(next.note); rest = next.answer;
    }
    expect(steps).toEqual(['未采用地点「烽火台」', '桥梁改由程序布置', '未采用任务地点「东坡」', '未采用单独部署：张辽', '未采用地点「东坡」', '城门改由程序布置', '未采用水系',
      '双方开局位置改由程序决定', '城市改由程序布置', '场所风格与掩体改由程序决定']);
    expect(rest).toEqual({});
    expect(reduceLayout(rest, '其他', ctx())).toBeUndefined();
    // The original answer is never changed.
    expect(answer.battlefield.places).toHaveLength(2);
  });
});
