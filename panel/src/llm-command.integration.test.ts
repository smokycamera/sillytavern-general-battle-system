// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { nativeFixture } from '../../runtime/tests/native-fixture.js';
import { generateUnit, SmallBattle, standardField, V24_OVERFLOW_D20 } from '../../engine/src/index.js';
import { unitRecordFromCombatant } from './unit-state.js';
import { LLM_SETTINGS_KEY } from './llm-settings.js';
import type { LlmEncounterContext } from './llm-context.js';
import { encounterRequest, normalizeContextSettings } from './jev-context.js';
vi.mock('./panel-runtime.js', async () => import('../../extension/src/panel-runtime.js'));
afterEach(() => { window.dispatchEvent(new Event('pagehide')); vi.unstubAllGlobals(); });

it('prepares independent commanders for three factions, persists their plans with the battle, and resumes their next activation', async () => {
  const f = nativeFixture(); await f.service.start(); localStorage.clear();
  const units = (['ally', 'enemy', 'neutral'] as const).map((side, i) => {
    const unit = generateUnit({ name: side + '-unit', side, scale: 'hero', rulesVersion: 'v2', damageModel: 'wounds-v2',
      level: 4, weaponClass: 'sword', hpMax: 200, traits: [] }, { seed: side, noVariance: true }).unit;
    unit.id = 'u' + i; return unit;
  });
  const field = standardField(7, 13); field.tiles.fill('open');
  const battle = new SmallBattle({ combatants: units, battlefield: field, rules: V24_OVERFLOW_D20, seed: 'command-ui' });
  battle.start(); battle.turnOrder = ['u0', 'u1', 'u2']; battle.turnIndex = 0;
  battle.combatants.forEach((u, i) => { u.pos = 35 + i * 2; });
  const brief = (side: 'enemy' | 'neutral') => ({ battleSeed: battle.seed, side,
    brief: { name: side + '-commander', persona: '谨慎', known: ['本方观察'], mission: '维持阵地' }, memory: { plan: side + '-private-plan', notes: [], terrain: [] } });
  const base = encounterRequest({ roster: units, setup: { mode: 'small', field: 'plains', lighting: 'day', mapLayout: 'standard', objectiveMode: 'annihilation', siegeAttacker: 'ally' }, settings: normalizeContextSettings(), messages: [], windowSize: 0, roles: [], phase: 'preparation' }).base;
  const context = { ...base,
    llmCommanders: { enemy: brief('enemy'), neutral: brief('neutral') } } as LlmEncounterContext;
  Object.assign(context, { rawResponse: 'discard-provider-response', messages: ['discard-provider-messages'] });
  Object.assign(context.llmCommanders!.enemy!, { reasoning_content: 'discard-provider-reasoning' });
  await f.service.transact(() => ({ schemaVersion: 2, storage: units.map(u => unitRecordFromCombatant(u)), rosterIds: units.map(u => u.id),
    protagonistId: 'u0', autoTurn: false, encounterContext: context, battle: { kind: 'small', snap: battle.toSnapshot() } }));
  localStorage.setItem(LLM_SETTINGS_KEY, JSON.stringify({ enabled: true, commandEnemy: true, designMap: false, selectVip: false,
    commandThinking: 'off', commandThinkingOffParams: '{"reasoning_effort":"none"}',
    url: 'https://fixture.invalid/v1', token: 'never-save-token', model: 'fixture', models: [] }));
  Object.assign(window, { __tavernBattleNative: { service: f.service, messages: {} }, __TAURITAVERN__: {}, SillyTavern: { getContext: () => f.context } });
  let commandCount = 0, preparationCount = 0;
  const request = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const payload = JSON.parse(String(init?.body)), latest = payload.messages.filter((m: any) => m.role === 'user').at(-1).content;
    if (payload.tools) {
      expect(payload.reasoning_effort).toBe('none'); expect(payload).not.toHaveProperty('thinking');
      const data = JSON.parse(latest), actor = data.observation.actorId;
      expect(data.observation.units.find((u: any) => u.id === actor).side).toBe('friendly');
      if (actor === 'u1') expect(JSON.stringify(data)).not.toContain('neutral-private-plan');
      if (actor === 'u2') expect(JSON.stringify(data)).not.toContain('enemy-private-plan');
      commandCount++;
      return new Response(JSON.stringify({ choices: [{ message: { tool_calls: [
        { id: 'plan', type: 'function', function: { name: 'commander_plan', arguments: JSON.stringify({ plan: actor + '-new-plan', notes: ['本轮完成部署'] }) } },
        { id: 'act', type: 'function', function: { name: 'commander_act', arguments: JSON.stringify({ choice: data.choices.find((c: any) => c.action?.type === 'end_turn').id }) } },
      ] } }] }));
    }
    if (payload.messages[0].content.includes('指挥官设定助手')) {
      expect(payload).not.toHaveProperty('reasoning_effort'); expect(payload).not.toHaveProperty('thinking');
      preparationCount++;
      const data = JSON.parse(latest), friendly = data.observation.units.find((u: any) => u.side === 'friendly');
      expect(data.perspective).toEqual({ self: 'friendly', playerFaction: 'opponent-1', controlledUnits: [{ id: friendly.id, name: friendly.name }] });
      expect(data.perspective.controlledUnits).not.toContainEqual({ id: 'u0', name: 'ally-unit' });
      expect(JSON.stringify(data.narrative)).toContain('我率领ally-unit');
      expect(payload.messages[0].content).toContain('将正文中的“我”“我们”归于剧情中的实际叙述者');
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ name: friendly.name + '-leader', persona: '谨慎', known: [], mission: '守住阵地' }) } }] }));
    }
    expect(payload).not.toHaveProperty('reasoning_effort'); expect(payload).not.toHaveProperty('thinking');
    const data = JSON.parse(latest.slice(latest.lastIndexOf('\n') + 1)), selected: Record<string, string> = { field: 'plains', lighting: 'day', objective: 'annihilation', map_layout: 'standard' };
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ selections: Object.fromEntries(data.fields.map((field: any) => [field.id,
      { value: selected[field.id] ?? Object.keys(field.options)[0], confidence: 1 }])) }) } }] }));
  });
  vi.stubGlobal('fetch', request);
  document.body.innerHTML = '<div id="app"></div><div id="toast"></div>';
  await import('./main.js');
  const idle = () => vi.waitFor(() => expect(document.body.getAttribute('aria-busy')).not.toBe('true'), { timeout: 10000 });
  const notesButton = document.querySelector<HTMLButtonElement>('[data-action="llm-notes"]')!;
  expect(notesButton.previousElementSibling?.getAttribute('data-reason')).toBe('surrender');
  const beforeNotes = JSON.stringify(f.service.snapshot()); notesButton.click();
  expect(document.querySelector('[aria-labelledby="llm-notes-title"]')?.textContent).toContain('enemy-private-plan');
  expect(document.querySelector('[aria-labelledby="llm-notes-title"]')?.textContent).toContain('neutral-private-plan');
  expect(JSON.stringify(f.service.snapshot())).toBe(beforeNotes); expect(request).not.toHaveBeenCalled();
  document.querySelector<HTMLButtonElement>('button[data-action="llm-notes-close"]')!.click();
  expect(document.querySelector('[aria-labelledby="llm-notes-title"]')).toBeNull();
  document.querySelector<HTMLButtonElement>('[data-action="grid-endturn"]')!.click(); await idle();
  expect(commandCount).toBe(2);
  const saved = f.service.snapshot(), restored = SmallBattle.fromSnapshot(saved.battle!.snap);
  expect(restored.active?.id).toBe('u0');
  expect((saved.encounterContext as LlmEncounterContext).llmCommanders).toMatchObject({ enemy: { memory: { plan: 'u1-new-plan' } }, neutral: { memory: { plan: 'u2-new-plan' } } });
  expect(JSON.stringify(saved)).not.toContain('never-save-token');
  expect(JSON.stringify(saved)).not.toContain('discard-provider');
  document.querySelector<HTMLButtonElement>('[data-action="llm-notes"]')!.click();
  expect(document.querySelector('[aria-labelledby="llm-notes-title"]')?.textContent).toContain('u1-new-plan');
  document.querySelector<HTMLButtonElement>('button[data-action="llm-notes-close"]')!.click();
  // A new preparation generates two separate briefs before any new battle is written.
  await f.service.transact(() => ({ ...saved, battle: null, encounterContext: undefined })); await idle();
  f.context.chat!.push({ is_user: false, mes: '我率领ally-unit向enemy-unit进攻，neutral-unit在附近观望。', gen_finished: 'done' });
  document.querySelector<HTMLButtonElement>('[data-action="small-start"]')!.click(); await idle();
  expect(preparationCount).toBe(2);
  expect(f.service.snapshot().battle).toBeDefined();
  expect((f.service.snapshot().encounterContext as LlmEncounterContext).llmCommanders).toMatchObject({ enemy: { side: 'enemy' }, neutral: { side: 'neutral' } });
  f.service.dispose();
}, 20000);
