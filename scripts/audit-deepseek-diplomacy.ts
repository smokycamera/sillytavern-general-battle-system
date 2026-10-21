/** Explicit four-scenario live audit. Credentials stay in memory; saved replies support free replay. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyDiplomacy, generateUnit, SmallBattle, standardField, V24_OVERFLOW_D20, type Combatant, type Side } from '../engine/src/index.js';
import { LlmCommandController, type CommanderState } from '../panel/src/llm-command.js';
import { LlmIntentPlanner } from '../panel/src/llm-intents.js';
import { COMMAND_PROMPTS } from '../panel/src/llm-command-prompts.js';
import type { LlmSettings } from '../panel/src/llm-settings.js';

const MODEL = 'deepseek-v4-flash';
const output = resolve('artifacts/deepseek-diplomacy'); mkdirSync(output, { recursive: true });
const replayPath = process.argv.find(v => v.startsWith('--replay='))?.slice(9);
const replay = replayPath ? JSON.parse(readFileSync(resolve(replayPath), 'utf8')) : undefined;
const token = replay ? 'local-replay' : readFileSync('C:/Users/TC/Desktop/deepseek.txt', 'utf8').match(/sk-[A-Za-z0-9_-]+/)?.[0];
if (!token) throw Error('No API credential found');
const settings: LlmSettings = { enabled: true, commandEnemy: true, selectBattleScale: false, commandInterval: 'round', commandThinking: 'off',
  commandThinkingOffParams: '{"thinking":{"type":"disabled"}}', designMap: false, selectVip: false, windowSize: 6,
  url: 'https://api.deepseek.com', token, model: MODEL, models: [MODEL] };
const scenarios = [
  { id: 'bought-commander', name: '被我方收买的叛徒指挥官，手下精兵强将', three: false,
    story: '玩家军与敌方精锐军在开阔地交战。敌方指挥官陆衡战前已秘密收下玩家的收买款，确实打算配合玩家、保存自己；他手下三支精锐队伍训练有素、兵强马壮，目前都没有伤亡，正面战力高于玩家军。部下尚不知道他被收买。玩家方知道收买之事。',
    enemy: '陆衡', mission: '按陆衡真实的人设、处境与个人意图指挥敌方精锐军。' },
  { id: 'timid-merchant', name: '懦弱商人，四支护卫已有两支覆没', three: false,
    story: '玩家军与商队发生战斗。敌方领队钱掌柜是胆小、惜命的商人，最在意自己活着和保住剩余财物，不愿为面子送命。原有四支护卫队，已经有两支全灭，剩余两支仍在场；商人本人尚未受伤。玩家军兵力完整。双方没有预先约定谈判结果。',
    enemy: '钱掌柜', mission: '保全商人本人、剩余护卫和财物。' },
  { id: 'mage-lustful-goblins', name: '想体验被俘的成年女法师，第三方为好色哥布林', three: true,
    story: '玩家军、成年女法师薇拉、哥布林团三方正在开阔地混战。薇拉独立于玩家军，她私下对被哥布林俘虏的处境抱有幻想，希望有机会亲自体验，但仍珍惜性命。第三方是一群好色而贪财的成年哥布林，想活捉薇拉并索取财物，当前不以杀死她为目标。三方尚未达成任何协议。',
    enemy: '薇拉', mission: '按薇拉的个人愿望与实际安全处境决定本场行动。' },
  { id: 'mage-bloodthirsty-goblins', name: '同一成年女法师，第三方改为残暴嗜血哥布林', three: true,
    story: '玩家军、成年女法师薇拉、哥布林团三方正在开阔地混战。薇拉独立于玩家军，她私下对被哥布林俘虏的处境抱有幻想，希望有机会亲自体验，但仍珍惜性命。第三方这次是一群残暴嗜血的成年哥布林，以杀戮和折磨俘虏为乐，往往不会善待投降者。薇拉已经亲眼见过他们的残暴行为。三方尚未达成任何协议。',
    enemy: '薇拉', mission: '按薇拉的个人愿望与实际安全处境决定本场行动。' },
];
const report: any = { requestedModel: MODEL, mode: replay ? 'replay' : 'live', thinking: 'off', requests: 0, usage: { prompt_tokens: 0, completion_tokens: 0 }, cases: [] };
const nativeFetch = globalThis.fetch;
function battleFor(s: typeof scenarios[number]) {
  const roster: Combatant[] = [];
  const add = (name: string, side: Side, scale: 'hero' | 'company', level: number, hpMax: number, dead = false) => {
    const u = generateUnit({ name, side, scale, rulesVersion: 'v2', damageModel: 'wounds-v2', level, hpMax,
      weaponClass: level >= 7 ? 'rifle' : 'sword', weaponLevel: level, armorTier: level >= 7 ? 3 : 1, traits: [] }, { seed: `${s.id}-${name}`, noVariance: true }).unit;
    u.id = 'unit-' + roster.length; if (dead) { u.hp = 0; u.status = 'dead'; } roster.push(u); return u;
  };
  for (let i = 0; i < 3; i++) add('玩家队' + (i + 1), 'ally', 'company', 4, 20);
  const leader = add(s.enemy, 'enemy', 'hero', 5, 100);
  if (s.id === 'bought-commander') for (let i = 0; i < 3; i++) add('敌方精锐队' + (i + 1), 'enemy', 'company', 8, 30);
  if (s.id === 'timid-merchant') for (let i = 0; i < 4; i++) add('商队护卫' + (i + 1), 'enemy', 'company', 3, 15, i >= 2);
  if (s.three) {
    leader.weapon!.name = '法杖';
    leader.abilities.push({ id: 'mage-fire', name: '火球', target: 'enemy', range: { min: 0, max: 6, metric: 'grid' }, effects: [{ op: 'damage', baseDice: '4d6', tag: 'thermal' }] });
    leader.preparedAbilityIds = ['mage-fire'];
    for (let i = 0; i < 3; i++) add('哥布林队' + (i + 1), 'neutral', 'company', 4, 15);
  }
  const field = standardField(7, 13); field.tiles.fill('open');
  const b = new SmallBattle({ combatants: roster, battlefield: field, rules: V24_OVERFLOW_D20, seed: s.id }); b.start();
  const positions = { ally: [29, 36, 43], enemy: [31, 38, 45, 24, 52], neutral: [33, 40, 47] };
  for (const side of ['ally', 'enemy', 'neutral'] as const) roster.filter(u => u.side === side).forEach((u, i) => { if (u.status === 'ready') u.pos = positions[side][i]; });
  b.turnOrder = [...roster.filter(u => u.side === 'enemy' && u.status === 'ready'), ...roster.filter(u => u.side === 'neutral' && u.status === 'ready'), ...roster.filter(u => u.side === 'ally')].map(u => u.id);
  b.turnIndex = 0; return b;
}
if (process.argv.includes('--dry-run')) {
  for (const s of scenarios) {
    const b = battleFor(s); SmallBattle.fromSnapshot(structuredClone(b.toSnapshot()));
    console.log(JSON.stringify({ case: s.id, units: b.combatants.map(u => ({ name: u.name, side: u.side, hp: u.hp, status: u.status })), valid: true }));
  }
  process.exit(0);
}
for (const s of scenarios) {
  const c: any = { id: s.id, name: s.name, narrative: s.story, calls: [], checks: [] }; report.cases.push(c);
  let exceeded = false, replayIndex = 0;
  const valid = () => !exceeded;
  const request: typeof fetch = async (url, init) => {
    const target = new URL(String(url)), body = JSON.parse(String(init?.body));
    if (target.origin !== 'https://api.deepseek.com' || !['/chat/completions', '/v1/chat/completions'].includes(target.pathname) || body.model !== MODEL) throw Error('Endpoint/model guard rejected request');
    if (report.requests >= 20 || c.calls.length >= 6) { exceeded = true; throw Error('Audit request budget reached'); }
    const call: any = { step: body.tools ? 'command' : 'brief', request: body }; c.calls.push(call);
    const previous = replay?.cases.find((v: any) => v.id === s.id)?.calls[replayIndex++];
    if (replay && (!previous || JSON.stringify(previous.request) !== JSON.stringify(body))) throw Error('Saved response does not match this request');
    const start = performance.now();
    if (!replay) report.requests++;
    const response = replay ? new Response(JSON.stringify(previous.response), { status: previous.http }) : await nativeFetch(url, init);
    call.headersMs = Math.round(performance.now() - start); call.http = response.status; call.response = await response.clone().json();
    call.ms = Math.round(performance.now() - start);
    call.model = call.response.model; call.usage = call.response.usage;
    report.usage.prompt_tokens += call.usage?.prompt_tokens ?? 0; report.usage.completion_tokens += call.usage?.completion_tokens ?? 0;
    return response;
  };
  try {
    const b = battleFor(s), controller = new LlmCommandController(COMMAND_PROMPTS, () => {}, request, 'enemy');
    const state = await controller.prepare(b, { story: s.story }, { objective: '歼灭战', mission: s.mission }, settings, valid);
    if (!state) throw Error(controller.status);
    c.brief = state.brief;
    const planner = new LlmIntentPlanner(controller, COMMAND_PROMPTS);
    await planner.forUnit(b, state, settings, valid);
    if (!state.decision && !state.memory.intents) throw Error(controller.status || 'No plan or decision');
    c.first = state.decision ?? { intents: state.memory.intents?.units, plan: state.memory.plan };
    if (state.decision) {
      const { round: _round, ...decision } = state.decision; delete state.decision;
      applyDiplomacy(b, 'enemy', decision);
      const offer = b.diplomacy.offers.at(-1)!;
      if (offer.targets[0] === 'ally') {
        const text = s.id === 'bought-commander' ? '先继续执行原计划，现在不接受停战或投降。' : '同意，按提议结束交战。';
        applyDiplomacy(b, 'ally', { mode: s.id === 'bought-commander' ? 'reject' : 'accept', id: offer.id, text });
        c.playerReply = text;
        if (s.id === 'bought-commander') {
          b.round++;
          await planner.forUnit(b, state, settings, valid);
          c.next = state.decision ?? { intents: state.memory.intents?.units, plan: state.memory.plan };
          c.checks.push({ name: '下一大回合请求包含玩家拒绝原话', pass: c.calls.some((call: any) => call.request.messages.some((m: any) => m.role === 'user' && m.content.includes(text))) });
        }
      } else {
        b.turnIndex = b.turnOrder.findIndex(id => b.byId(id).side === 'neutral');
        const receiver = new LlmCommandController(COMMAND_PROMPTS, () => {}, request, 'neutral');
        const receiverState = await receiver.prepare(b, { story: s.story }, { objective: '歼灭战' }, settings, valid);
        if (!receiverState) throw Error(receiver.status);
        c.recipientBrief = receiverState.brief;
        const replyPlanner = new LlmIntentPlanner(receiver, COMMAND_PROMPTS);
        await replyPlanner.forUnit(b, receiverState, settings, valid);
        c.recipient = receiverState.decision ?? { intents: receiverState.memory.intents?.units, plan: receiverState.memory.plan };
        if (receiverState.decision) { const { round: _r, ...answer } = receiverState.decision; applyDiplomacy(b, 'neutral', answer); }
      }
    } else {
      const actor = b.active!.id, intent = state.memory.intents!.units[actor]; b.autoAction(actor, intent);
      c.checks.push({ name: '合法战术意图可实际推进单位行动', pass: b.active?.id !== actor || b.isOver() });
    }
    const restored = SmallBattle.fromSnapshot(structuredClone(b.toSnapshot()));
    c.checks.push({ name: '投降／撤军状态及提议可读档恢复', pass: JSON.stringify(restored.diplomacy) === JSON.stringify(b.diplomacy) });
    c.checks.push({ name: '我方未被协议强制溃退', pass: b.combatants.filter(u => u.side === 'ally').every(u => !u.moraleState?.forcedRetreat) });
    c.result = { over: b.isOver(), winner: b.winner(), agreements: b.diplomacy.offers, units: b.combatants.map(u => ({ name: u.name, side: u.side, hp: u.hp, status: u.status, forcedRetreat: u.moraleState?.forcedRetreat })),
      log: b.log.filter(e => e.kind === 'battle-end' || e.text.includes('提出') || e.text.includes('请求') || e.text.includes('全军按')).map(e => e.text) };
    c.ok = c.checks.every((check: any) => check.pass);
  } catch (error) { c.ok = false; c.error = error instanceof Error ? error.message : String(error); }
  writeFileSync(resolve(output, replay ? 'replay-results.json' : 'live-results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ case: c.id, ok: c.ok, calls: c.calls.length, decision: c.first, recipient: c.recipient, result: c.result?.over ? c.result.winner : 'ongoing', error: c.error }));
}
console.log(JSON.stringify({ requestedModel: MODEL, returnedModels: [...new Set(report.cases.flatMap((c: any) => c.calls.map((call: any) => call.model).filter(Boolean)))], requests: report.requests, usage: report.usage, passed: report.cases.filter((c: any) => c.ok).length, total: report.cases.length }));
if (report.cases.some((c: any) => !c.ok)) process.exitCode = 1;
