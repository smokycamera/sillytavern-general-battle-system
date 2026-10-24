import { describe, expect, it, vi } from 'vitest';
import { generateUnit, generatedLayeredField, SmallBattle, V11_OVERFLOW_D20, type Combatant } from '../../engine/src/index.js';
import { AUTO_TRIES, LAYOUT_TRIES, LlmContextController, llmContextSummary } from './llm-context.js';
import { compileLayout, layoutRetryNote, layoutSummary, layoutTask, reduceLayout, type LayoutContext } from './llm-layout.js';
import { prepareBattleObjective } from './battle-setup.js';
import { renderTacticalBattle } from './tactical-view.js';
import type { LlmSettings } from './llm-settings.js';

const settings: LlmSettings = { enabled: true, selectBattleScale: true, designMap: true, selectVip: false, windowSize: 4, url: 'https://gateway.example/v1', token: 'key', model: 'flash', models: [] };
function unit(name: string, side: Combatant['side'], weaponClass = 'sword'): Combatant {
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

describe('indoor preparation vocabulary', () => {
  it('前两次占领区失败、第三次才出现航行错误时，同次开战仍完成回退', async () => {
    const request=twoStep({city:{at:'N'}}),controller=new LlmContextController(request);let attempts=0;
    const result=await controller.select(source(),settings,()=>true,r=>{
      if(!r.battlefieldPlan)return;
      attempts++;
      throw Error(attempts<3?'占领区域不合法':'舰队具有航行特质，但战场没有可用的深水或浅水部署格');
    });
    expect(attempts).toBe(3);expect(request).toHaveBeenCalledTimes(4);expect(result.battlefieldPlan).toBeUndefined();
    expect(result.layoutNotes).toContain('航行单位没有可用水域，改用带水域的本地地图');
  });
  it('航行无水错误返回副 API，三次仍无水时本次开战自动回退带水域地图', async () => {
    const input = { ...source(), scope: 'sailing-water' }; input.roster = [input.roster[0]!, input.roster[4]!]; input.roster[0]!.traits.push('sailing');
    const request = twoStep({ water: { type: 'none' }, ally: { at: ['B4'] }, enemy: { at: ['B1'] } },
      { ...siegeChoice, field: 'plains', objective: 'annihilation', scene: 'interior' });
    let field: ReturnType<typeof generatedLayeredField> | undefined;
    const result = await new LlmContextController(request).select(input, settings, () => true, result => {
      field = generatedLayeredField('sailing-retry', 7, 13, ['plains'], { roster: input.roster, scene: 'interior',
        plan: result.battlefieldPlan, unitBindings: result.unitBindings });
    });
    expect(request).toHaveBeenCalledTimes(1 + AUTO_TRIES);
    const retry = sent(request, 2).messages[2].content as string;
    expect(retry).toContain('航行'); expect(retry).toContain('增加water'); expect(retry).not.toContain('正文没有强调的河流可以删去');
    expect(sent(request, 1).messages[2].content).toContain('航行：只能在深水或浅水部署与移动');
    expect(result.battlefieldPlan).toBeUndefined(); expect(result.layoutNotes).toContain('航行单位没有可用水域，改用带水域的本地地图');
    expect(['deep_water', 'shallow_water']).toContain(field!.tiles[field!.initialDeployment![input.roster[0]!.id]!.pos]);
  });
  it('keeps building use independent of geometry, accepting exact Chinese labels and old answers', () => {
    const indoor=ctx({scene:'interior',objectiveMode:'annihilation'});
    expect(compileLayout({interior:{use:'工坊',pattern:'双翼联通'}},indoor).plan.interior).toEqual({use:'workshop',pattern:'wings'});
    expect(compileLayout({archetype:'residence'},indoor).plan.interior).toBeUndefined();
    const malformed=compileLayout({interior:{use:'warehouse',pattern:'arbitrary code'}},indoor);
    expect(malformed.plan.interior).toEqual({use:'warehouse'});expect(malformed.notes.join(' ')).toContain('室内布局无效');
    expect(compileLayout({interior:{use:'warehouse',pattern:'aisles'}},ctx()).plan.interior).toBeUndefined();
  });
  it('does not turn the height of indoor furniture into a raised floor', () => {
    const plan=compileLayout({places:[{type:'cover',name:'高货架',at:'C',height:2}]},ctx({scene:'interior'})).plan;
    expect(plan.intent!.entities[0]!.height).toBeUndefined();
    expect(layoutTask(ctx({scene:'interior'}))).not.toContain('正文未确定的项省略，由程序变化');
  });
});

describe('named-location unit deployment', () => {
  it('puts grouped units in the named room and another unit in a different room in the same sector, including after restore', () => {
    const combatants = roster();
    const context = ctx({scene:'interior',size:'large',objectiveMode:'annihilation',map:[9,15],units:combatants.map((u,i)=>({id:'u'+(i+1),name:u.name,side:u.side,kind:'人物'}))});
    const answer = {interior:{use:'office',pattern:'hall'},cover:'sparse',ally:{at:['S']},enemy:{at:['NW']},
      places:[{type:'room',name:'档案室',at:'NE'},{type:'room',name:'医务室',at:'NE'},{type:'room',name:'南厅',at:'S'}],
      units:[{unit:['u1','u2'],place:'档案室',at:'S'},{unit:'u3',place:'医务室'}]};
    const parsed = compileLayout(answer,context);
    const field = generatedLayeredField('room-binding-0',9,15,[],{roster:combatants,plan:parsed.plan,unitBindings:Object.fromEntries(combatants.map((u,i)=>['u'+(i+1),u.id]))});
    const battle = new SmallBattle({battlefield:field,combatants,rules:V11_OVERFLOW_D20,seed:'room-binding-0'}); battle.start();
    const restored = SmallBattle.fromSnapshot(battle.toSnapshot());
    for (const [index,label] of [[0,'档案室'],[1,'档案室'],[2,'医务室']] as const) {
      const region = restored.battlefield!.scene!.regions.find(r=>r.label===label)!;
      expect(region.cells).toContain(restored.combatants.find(u=>u.id===combatants[index]!.id)!.pos);
    }
  });
  it('keeps every member of a full 32-unit location group, deduplicates members, and supports third parties', () => {
    const units = Array.from({length:32},(_,i)=>({id:'u'+(i+1),name:'单位'+i,side:(i%3===0?'neutral':i%3===1?'ally':'enemy') as Combatant['side'],kind:'人物'}));
    const parsed = compileLayout({places:[{type:'position',name:'营地',at:'C'}],units:[{unit:units.map(u=>u.id).concat('u1'),place:'营地'},{unit:'u1',at:'N'}]},ctx({scene:'field',units,objectiveMode:'annihilation'}));
    expect(parsed.plan.intent!.relations.filter(r=>r.relation==='guards')).toHaveLength(32);
    expect(parsed.plan.deployments?.some(d=>d.subject==='u1')).toBe(false);
  });
  it('binds bridges and gates by name and falls back on invalid, ambiguous or unsupported bindings', () => {
    const context = ctx({units:[...ctx().units,{id:'u3',name:'第三方',side:'neutral',kind:'人物'}]});
    const parsed = compileLayout({city:{at:'N',gates:[{name:'南门',state:'closed'}]},water:{type:'river',at:'E',bridges:[{name:'石桥',at:'SE'}]},
      units:[{unit:'u1',place:'石桥'},{unit:'u2',place:'南门',relation:'near'},{unit:'u3',place:'不存在',at:'W'}]},context);
    expect(parsed.plan.intent!.relations).toEqual(expect.arrayContaining([
      expect.objectContaining({subject:'u1',relation:'guards',object:parsed.plan.intent!.entities.find(e=>e.label==='石桥')!.id}),
      expect.objectContaining({subject:'u2',relation:'near',object:parsed.plan.intent!.entities.find(e=>e.label==='南门')!.id}),
    ]));
    expect(parsed.plan.deployments).toContainEqual({subject:'u3',at:['west']});
    const bad = compileLayout({places:[{type:'room',name:'侧室',at:'N'},{type:'room',name:'侧室',at:'S'}],units:[{unit:'u1',place:'侧室',at:'SW'},{unit:'u2',place:'侧室',relation:'execute_code',at:'NE'}]},ctx({scene:'interior'}));
    expect(bad.plan.intent!.relations).toHaveLength(0);
    expect(bad.notes.join(' ')).toContain('重名');
    expect(bad.plan.deployments).toEqual(expect.arrayContaining([{subject:'u1',at:['south_west']},{subject:'u2',at:['north_east']}]));
  });
  it('retains only available entity references when named bindings exceed the scene budget', () => {
    const places = Array.from({length:8},(_,i)=>({type:'position',name:'点'+i,at:'S'}));
    const units = Array.from({length:8},(_,i)=>({id:'u'+(i+1),name:'单位'+i,side:'ally' as const,kind:'人物'}));
    const parsed = compileLayout({city:{at:'N',gates:Array.from({length:4},(_,i)=>({name:'门'+i}))},water:{type:'river',at:'E',bridges:Array.from({length:4},(_,i)=>({name:'桥'+i,at:'E'}))},places,units:units.map((u,i)=>({unit:u.id,place:'点'+i,at:'S'}))},ctx({units}));
    expect(parsed.plan.intent!.entities).toHaveLength(12);
    expect(parsed.plan.intent!.relations.every(r=>parsed.plan.intent!.entities.some(e=>e.id===r.object))).toBe(true);
    expect(parsed.notes.join(' ')).toContain('单位绑定地点未保留');
    expect(parsed.plan.deployments!.filter(d=>/^u\d+$/.test(d.subject))).toHaveLength(8);
  });
});

describe('two-step preparation with a compass layout', () => {
  it.each([{ sides: ['ally', 'enemy'] }, { sides: ['ally', 'enemy', 'neutral'] }] as const)('deploys and restores all 32 individually placed units with $sides', ({ sides: sideList }) => {
    const units = Array.from({ length: 32 }, (_, i) => ({ id: 'u' + (i + 1), name: '布阵' + i, side: sideList[i % sideList.length]!, kind: '人物·近战' }));
    const context = ctx({ scene: 'field', size: 'large', objectiveMode: 'annihilation', map: [13, 19], units });
    const sector = { ally: 'S', enemy: 'N', neutral: 'E' };
    const answer = { ...Object.fromEntries(sideList.map(side => [side, { at: [sector[side]] }])), units: units.map(u => ({ unit: u.id, at: sector[u.side] })) };
    const compiled = compileLayout(answer, context);
    const combatants = units.map(u => unit(u.name, u.side));
    const bindings = Object.fromEntries(units.map((u, i) => [u.id, combatants[i]!.id]));
    const field = generatedLayeredField('individual-32-' + sideList.length, 13, 19, [], { roster: combatants, plan: compiled.plan, unitBindings: bindings });
    const b = new SmallBattle({ combatants, battlefield: field, rules: V11_OVERFLOW_D20, seed: 'individual-32' }); b.start();
    const restored = SmallBattle.fromSnapshot(b.toSnapshot());
    expect(restored.combatants.every(u => restored.battlefield!.deploymentZones!.some(z => z.unitId === u.id && z.cells.includes(u.pos!)))).toBe(true);
    expect(restored.combatants).toHaveLength(32);
  });
  it('sends an independent third-party commander and layout in the existing two requests', async () => {
    const input = source(); input.roster.push(unit('第三军', 'neutral'));
    const request = twoStep({ ally: { at: ['S'] }, enemy: { at: ['N'] }, neutral: { at: ['E'] } },
      { ...siegeChoice, field: 'plains', objective: 'annihilation', scene: 'field', neutral_ability: 'master', neutral_style: 'ambush' });
    let field: ReturnType<typeof generatedLayeredField>;
    const result = await new LlmContextController(request).select(input, settings, () => true, r => {
      field = generatedLayeredField('third-party-layout', 7, 13, ['plains'], { roster: input.roster, plan: r.battlefieldPlan, unitBindings: r.unitBindings });
    });
    expect(request).toHaveBeenCalledTimes(2);
    const decision = JSON.parse(sent(request, 0).messages[2].content.split('\n').at(-1));
    expect(decision.fields.filter((f: { id: string }) => f.id.startsWith('neutral_')).map((f: { id: string }) => f.id)).toEqual(['neutral_ability', 'neutral_style']);
    expect(decision.state.commandRules).toContain('neutral:{preferences:{}}');
    const task = sent(request, 1).messages[2].content;
    expect(task).toContain('第三军 · 第三方'); expect(task).toContain('"neutral":{"at":["D2"]}');
    expect(result.commanders?.neutral).toEqual({ ability: 'master', style: 'ambush' });
    const zones = field!.deploymentZones!;
    const third = zones.filter(z => z.side === 'neutral').flatMap(z => z.cells);
    expect(third.length).toBeGreaterThan(0);
    expect(zones.filter(z => z.side !== 'neutral').every(z => z.cells.every(p => !third.includes(p)))).toBe(true);
    expect(input.roster.every(u => zones.some(z => z.side === u.side && z.cells.includes(field!.initialDeployment![u.id]!.pos)))).toBe(true);
  });
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
  it(`builds the ${LAYOUT_TRIES}th failing layout in the same start from the parts that can be generated`, async () => {
    const request = twoStep(beacon), controller = new LlmContextController(request), input = { ...source(), scope: 'chat' };
    const result = await controller.select(input, settings, () => true, noBeacon);
    expect(request).toHaveBeenCalledTimes(1 + AUTO_TRIES); expect(LAYOUT_TRIES).toBe(AUTO_TRIES);
    const last = JSON.parse(String(request.mock.calls.at(-1)![1]!.body)).messages[2].content as string;
    expect(last).toContain('失败原因与改法：地标烽火台在指定区域部署容量不足。改法：地点「烽火台」放不下');
    // Repeated identical failures are one note.
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
    const local = await controller.select(input, settings, () => true, planless);
    expect(local.battlefieldPlan).toBeUndefined(); expect(local.unitBindings).toBeUndefined();
    expect(local.layoutNotes).toEqual([`连续${LAYOUT_TRIES}次布置未能生成地图，只采用回答中能生成的部分`, '双方开局位置改由程序决定', '未采用地点「烽火台」「府衙」',
      '城市改由程序布置', '回答中没有能生成的部分，改用本地生成的地图']);
    const unreadable = new LlmContextController(twoStep('地图如下：无'));
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
  it('reads the wall layout in several spellings, rings a central city and shows the layout in the summary', () => {
    const read = (walls: unknown, at = 'N') => compileLayout({ city: { at, name: '青石城', walls, level: 4 } }, ctx()).plan;
    expect(read('front')).toMatchObject({ shape: 'front', wallLayers: 1, fortLevel: 4 });
    expect(read('ring')).toMatchObject({ shape: 'enclosure', wallLayers: 1 });
    expect(read('double')).toMatchObject({ wallLayers: 2 }); expect(read('double').shape).toBeUndefined();
    expect(read('两重城墙')).toMatchObject({ wallLayers: 2 }); expect(read('瓮城')).toMatchObject({ wallLayers: 2 }); expect(read('四面城墙')).toMatchObject({ shape: 'enclosure' });
    const centre = compileLayout({ city: { at: 'C', walls: 'front' } }, ctx());
    expect(centre.plan.shape).toBe('enclosure'); expect(centre.notes).toContain('城在中央，改为四面城墙');
    // The older level key and a numeric layer count are still read; a level is never taken for a layer count.
    expect(compileLayout({ city: { at: 'N', wall: 5, layers: 2 } }, ctx()).plan).toMatchObject({ fortLevel: 5, wallLayers: 2 });
    expect(compileLayout({ city: { at: 'N', wall: 3 } }, ctx()).plan.wallLayers).toBeUndefined();
    const unknown = compileLayout({ city: { at: 'N', walls: '螺旋' } }, ctx());
    expect(unknown.plan.shape).toBeUndefined(); expect(unknown.notes).toContain('城墙形制无效，由程序决定');
    expect(layoutSummary(read('double'))).toBe('城墙攻防 · 中型 · 青石城在北 · 两重城墙');
  });
  it('asks for the wall layout, and for bridges only when the narrative names them', () => {
    const task = layoutTask(ctx());
    expect(task).toContain('"walls":城墙形制'); expect(task).toContain('double=内外两重城墙');
    expect(task).toContain('正文没提到桥就省略bridges'); expect(task).toContain('[]只用于正文明确无桥可用，程序会留一处可涉水的浅滩');
    expect(layoutTask(ctx({ scene: 'field', objectiveMode: 'annihilation' }))).not.toContain('walls');
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
  it('keeps explicit indoor terrain and water within the 12-entity budget', () => {
    const indoor = compileLayout({ places: [{ type: 'building', name: '书房', at: 'N' }, { type: 'hill', name: '假山' }], water: { type: 'river', at: 'E' } }, ctx({ scene: 'interior', objectiveMode: 'annihilation' }));
    expect(indoor.plan.intent!.entities.map(e => e.kind)).toEqual(['river', 'building', 'hill']);
    expect(indoor.notes).not.toContain('本场景不设水系');
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
    expect(layoutRetryNote('正文关系引用的地点place1没有生成', plan)).toBe('正文关系引用的地点「府衙」没有生成。改法：objective「府衙」处没有可站立的空地：改写为空旷的地点（如广场空地、营地）或4×4分区编号，或省略objective');
    expect(layoutRetryNote('地点place2未落在正文指定的north_east区域', plan)).toMatch(/^地点塔楼未落在正文指定的NE（东北）区域。改法：地点「塔楼」放不下/);
    expect(layoutRetryNote('地标tower在指定区域部署容量不足', plan)).toMatch(/^地标塔楼在指定区域部署容量不足。改法：地点「塔楼」放不下/);
    expect(layoutRetryNote('目标必须是合法可通行格')).toMatch(/改法：任务目标处被实心地点占住/);
    expect(layoutRetryNote('模型未返回有效布置 JSON，请检查模型是否支持 JSON 输出')).toBe('模型未返回有效布置 JSON。改法：只输出一个JSON对象，不要附加说明文字、注释或代码块');
    expect(layoutRetryNote('河流与完整城墙重叠，请调整城市或河流方位')).toMatch(/改法：水系写在城市对侧/);
    expect(layoutRetryNote('我方没有可用的开局位置，请调整部署方位')).toMatch(/改法：各方at各写2—3个相邻的空旷方位/);
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
