import { PROMPT_SECTIONS, selectPromptEntries } from './prompt-settings.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAdapter } from './tavern.js';
import { NarrativeController, narrativeProjection } from './narrative-controller.js';
import { generateUnit, traitRegistry, SmallBattle, standardField, V2_D20 } from '../../engine/src/index.js';
import { unitRecordFromCombatant, commitBattleOutcome, migratePanelUnits } from './unit-state.js';
import { prepareBattleItems } from './battle-items.js';
import type { NarrativeSave } from './narrative-state.js';
import { createInventoryItem } from './inventory-state.js';
import { protocolExcerpt } from './protocol.js';
const disposers: (() => void)[] = [];
afterEach(() => { disposers.splice(0).forEach((f) => f()); vi.unstubAllGlobals(); });
async function flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
function setup(initialOverride?: NarrativeSave) {
  const reg = traitRegistry();
  const unit = generateUnit({ name: 'A军团', side: 'ally', scale: 'company', level: 4, traits: [] }, { seed: 'controller', registry: reg }).unit;
  unit.id = 'a'; unit.hp = 70; unit.base.hpMax = 560;
  const initial: NarrativeSave = { storage: [unitRecordFromCombatant(unit)], rosterIds: [], factRevision: 1, schemaVersion: 2, storySync: true };
  const stores: Record<string, { panel?: NarrativeSave }> = { a: { panel: initialOverride ?? initial }, b: {} };
  const native: { gen_finished?: string; extra?: { error?: boolean }; swipe_id: number }[] = [];
  let msg = { role: 'assistant', message_id: 1, swipe_id: 0, swipes: [''], is_hidden: false };
  const local = new Map<string, string>(); let fail = false; let delay: Promise<unknown> | undefined;
  const callbacks = new Map<string, Set<(...args: unknown[]) => void>>();
  const ctx = { chatId: 'a', characterId: 0, characters: [{ avatar: 'char.png' }], chat: native, setExtensionPrompt: vi.fn(), generation_started: false };
  const eventTypes = Object.fromEntries(['GENERATION_AFTER_COMMANDS', 'GENERATION_STARTED', 'GENERATION_ENDED', 'GENERATION_STOPPED', 'MESSAGE_RECEIVED', 'MESSAGE_EDITED', 'MESSAGE_SWIPED', 'CHAT_CHANGED', 'MESSAGE_SENT'].map((s) => [s, s]));
  const th = {
    getVariables: () => stores[ctx.chatId],
    insertOrAssignVariables: (next: { panel: NarrativeSave }) => { if (fail) throw new Error('quota'); Object.assign(stores[ctx.chatId]!, structuredClone(next)); },
    getChatMessages: () => delay ?? [structuredClone(msg)],
  };
  vi.stubGlobal('window', { TavernHelper: th, SillyTavern: { getContext: () => ctx }, event_types: eventTypes,
    eventSource: { on: (k: string, cb: (...a: unknown[]) => void) => { if (!callbacks.has(k)) callbacks.set(k, new Set()); callbacks.get(k)!.add(cb); }, off: (k: string, cb: (...a: unknown[]) => void) => callbacks.get(k)?.delete(cb) } });
  vi.stubGlobal('localStorage', { getItem: (k: string) => local.get(k) ?? null, setItem: (k: string, v: string) => { if (fail) throw new Error('quota'); local.set(k, v); } });
  const emit = (key: string, ...args: unknown[]) => { for (const cb of callbacks.get(key) ?? []) cb(...args); };
  const controller = new NarrativeController(createAdapter()); disposers.push(() => controller.dispose());
  const message = (text: string, id = 1, complete = true) => {
    msg = { ...msg, message_id: id, swipes: [text] };
    native[id] = { swipe_id: 0, gen_finished: complete ? '2026-09-05' : undefined };
  };
  const generate = async (text: string, id = 1, stopped = false, complete = true) => {
    emit('GENERATION_AFTER_COMMANDS', 'normal', {}, false); message(text, id, complete);
    emit('MESSAGE_RECEIVED', id, 'normal'); if (stopped) emit('GENERATION_STOPPED'); emit('GENERATION_ENDED', id); await flush();
  };
  return { controller, ctx, stores, emit, message, generate, callbacks,
    fail: (value: boolean) => { fail = value; }, delay: (value?: Promise<unknown>) => { delay = value; } };
}
describe('常驻宿主生命周期与故障', () => {
  it('动态提示开关编辑、单位物品选择默认全选，无清单上限且普通保存不丢设置', () => {
    const { controller, ctx } = setup(); const save = controller.snapshot();
    save.inventory = Array.from({ length: 20 }, (_, i) => ({ id: 'i-' + i, name: '材料' + i, qty: 1, lootType: 'material' }));
    controller.persistPanel(save, save.factRevision!);
    expect(narrativeProjection(controller.snapshot())).toContain('"id":"i-19"');
    let settings = selectPromptEntries(undefined, 'unit', ['a'], false);
    settings = { ...selectPromptEntries(settings, 'item', ['i-1'], false), sections: { facts: { template: '自定义事实\n{{content}}' }, reminder: { enabled: false } } };
    expect(controller.setPromptSettings(settings).status).toBe('saved');
    const projected = ctx.setExtensionPrompt.mock.calls.at(-1)![1] as string;
    expect(projected).toContain('自定义事实'); expect(projected).not.toContain('"id":"a"'); expect(projected).not.toContain('"id":"i-1"');
    expect(projected).toContain('"id":"i-19"'); expect(projected).not.toContain('【本次输出约束】');
    const current = controller.snapshot(); delete current.promptSettings; controller.persistPanel(current, current.factRevision!);
    expect(controller.snapshot().promptSettings).toEqual(settings);
    const allOff = { sections: Object.fromEntries(PROMPT_SECTIONS.map((s) => [s.id, { enabled: false }])) };
    controller.setPromptSettings(allOff); expect(narrativeProjection(controller.snapshot())).toBe('');
    controller.setPromptSettings({}); expect(narrativeProjection(controller.snapshot())).toContain('"id":"a"');
  });

  it('技能与特质同样过滤：混合保留支持项，全未知建档无技能，未知学习不阻断，删除失败保留档案', async () => {
    const learner = generateUnit({ rulesVersion: 'v2', name: '学习单位', side: 'ally', scale: 'hero', level: 3, weaponClass: 'sword', traits: [] }, { seed: 'learn' }).unit; learner.id = 'a';
    const { controller, generate, fail } = setup({ schemaVersion: 2, factRevision: 1, storySync: true, storage: [unitRecordFromCombatant(learner)], rosterIds: [] });
    await generate('<tb><spawn name="法师" side="ally" scale="hero" skills="火花:魔法单体L3,自创未知术L5"/><spawn name="普通人" side="ally" scale="hero" skills="未知技能"/><learn id="a" skills="术弹:魔法单体L3,无此技能"/><learn id="a" skills="全都未知"/></tb>');
    const p = controller.snapshot().proposals!.at(-1)!;
    expect(p.status).toBe('pending'); expect(p.events).toHaveLength(3); expect(p.notices?.join(' ')).toContain('已忽略未支持技能');
    expect(controller.approve(p.id).status).toBe('saved'); const saved = controller.snapshot();
    expect(saved.storage!.find((r) => r.name === '法师')!.snapshot!.abilities).toHaveLength(1);
    expect(saved.storage!.find((r) => r.name === '普通人')!.snapshot!.abilities).toHaveLength(0);
    const id = saved.storage!.find((r) => r.name === '法师')!.id;
    fail(true); expect(controller.deleteUnit(id).status).toBe('failed'); expect(controller.snapshot().storage).toEqual(saved.storage);
    fail(false); expect(controller.deleteUnit(id).status).toBe('saved'); expect(controller.snapshot().storage!.some((r) => r.id === id)).toBe(false);
    await controller.scan(); expect(controller.snapshot().storage!.some((r) => r.id === id)).toBe(false);
  });

  it('空聊天首次正文建档同时部署，面板恢复不会因缺版本丢队伍；已丢名单可原批恢复而不重发奖励', async () => {
    const { controller, generate, message, emit } = setup({});
    await generate('<tb><spawn name="我方" side="ally" scale="hero"/><spawn name="敌方" side="enemy" scale="company" hpMax="20"/></tb>');
    const p = controller.snapshot().proposals!.at(-1)!; expect(controller.approve(p.id).status).toBe('saved');
    const saved = controller.snapshot(); expect(saved.schemaVersion).toBe(2); expect(saved.rosterIds).toHaveLength(2);
    const migrated = migratePanelUnits({ ...saved, schemaVersion: undefined, registry: traitRegistry() });
    expect(migrated.roster).toHaveLength(2); expect(migrated.warnings).toEqual([]);
    controller.persistPanel({ ...saved, rosterIds: [] }, saved.factRevision!);
    const before = controller.snapshot(); expect(controller.restoreDeployment(p.id).status).toBe('saved');
    const repaired = controller.snapshot(); expect(repaired.rosterIds).toEqual(saved.rosterIds);
    expect(repaired.storage).toEqual(before.storage); expect(repaired.proposals).toEqual(before.proposals);
    controller.restoreDeployment(p.id); expect(controller.snapshot().rosterIds).toHaveLength(2);
    message('<tb><spawn name="我方" side="ally" scale="hero" traits="未知特质"/><spawn name="敌方" side="enemy" scale="company" hpMax="20"/></tb>');
    emit('MESSAGE_EDITED', 1); await flush();
    expect(controller.snapshot().proposals).toHaveLength(1); expect(controller.snapshot().rosterIds).toHaveLength(2);
  });

  it('完整消息缺开始事件时直接待确认，不自动入账也不要求重复预览；旧缺绑定候选原位升级', async () => {
    const { controller, message, delay } = setup();
    message('<tb><unit_update id="a" hp="500"/></tb>', 1, false); await controller.scan();
    const old = controller.snapshot().proposals!.at(-1)!; expect(old.status).toBe('legacy');
    message('<tb><unit_update id="a" hp="500"/></tb>', 1, true); await controller.scan();
    const p = controller.snapshot().proposals!.at(-1)!;
    expect(p.id).toBe(old.id); expect(controller.snapshot().proposals).toHaveLength(1);
    expect(p.status).toBe('pending'); expect(p.reason).toBeUndefined(); expect(p.expected?.manualOnly).toBe(true);
    expect(controller.snapshot().storage![0]!.hp).toBe(70);
    expect(controller.approve(p.id).status).toBe('saved'); expect(controller.snapshot().storage![0]!.hp).toBe(500);
    await controller.scan(); expect(controller.snapshot().proposals).toHaveLength(1);
    delay(Promise.resolve([{ role: 'assistant', message_id: '2', swipe_id: '0', gen_finished: '2026-09-07', swipes: ['<tb><unit_update id="a" hp="560"/></tb>'] }]));
    await controller.scan(2); const next = controller.snapshot().proposals!.at(-1)!;
    expect(next.source.messageId).toBe('2'); expect(next.source.complete).toBe(true); expect(next.status).toBe('pending');
    expect(controller.snapshot().storage![0]!.hp).toBe(500);

  });
  it.each(['no-received', 'no-ended-id', 'ended-first'])('兼容生命周期缺参数与顺序差异（%s）', async (mode) => {
    const { controller, message, emit } = setup(); emit('GENERATION_AFTER_COMMANDS');
    message('<tb><unit_update id="a" hp="500"/></tb>');
    if (mode === 'no-received') emit('GENERATION_ENDED', '1');
    if (mode === 'no-ended-id') { emit('MESSAGE_RECEIVED', { message_id: 1 }); emit('GENERATION_ENDED'); }
    if (mode === 'ended-first') { emit('GENERATION_ENDED'); await flush(); emit('MESSAGE_RECEIVED', '1'); }
    await flush(); expect(controller.snapshot().storage![0]!.hp).toBe(500);
    expect(controller.snapshot().proposals).toHaveLength(1); expect(controller.snapshot().proposals![0]!.status).toBe('committed');
  });
  it('未知特质自动排除，保留已识别特质；全部未知仍建档，未知祝福不阻断其他事件', async () => {
    const { controller, generate } = setup();
    await generate('<tb><spawn name="矿工" side="ally" scale="company" hpMax="20" traits="射击专家,宇宙无敌矿工"/><spawn name="民兵" side="ally" scale="hero" traits="自创特质"/><bless id="a" name="虚构祝福" traits="无此特质" permanent="true"/></tb>');
    const p = controller.snapshot().proposals!.at(-1)!;
    expect(p.status).toBe('pending'); expect(p.events).toHaveLength(2); expect(p.notices?.join(' ')).toContain('已忽略未支持特质');
    expect(controller.approve(p.id).status).toBe('saved');
    const records = controller.snapshot().storage!;
    expect(records.find((r) => r.name === '矿工')!.snapshot!.traits).toContain('sharpshooter');
    expect(records.find((r) => r.name === '民兵')).toBeDefined();
    expect(records.some((r) => r.snapshot?.traits.some((id) => id.includes('自创') || id.includes('宇宙')))).toBe(false);
  });

  it('非末尾非标准事件自动识别；待补全草稿可本地修正、预览并一次入账', async () => {
    const { controller, generate, stores, fail, ctx, emit } = setup();
    await generate('正文<TB><UNIT-UPDATE ref=a HP="５００人"></UNIT-UPDATE></TB>后续故事');
    expect(controller.snapshot().storage![0]!.hp).toBe(500);
    await generate('继续正文<tb><unit_update id=a hp="未知"/><deploy id=a/></tb>结束', 2);
    const original = controller.snapshot().proposals!.at(-1)!;
    expect(original.status).toBe('unresolved'); expect(original.events).toHaveLength(1);
    expect(controller.snapshot().rosterIds).toEqual([]);
    const draft = '<unit_update id=a hp="560人"/><deploy ref=a>';
    fail(true); expect(controller.correctProposal(original.id, draft).status).toBe('failed');
    expect(controller.snapshot().proposals!.at(-1)!.id).toBe(original.id);
    fail(false); expect(controller.correctProposal(original.id, draft).status).toBe('saved');
    const corrected = controller.snapshot().proposals!.at(-1)!;
    expect(corrected.status).toBe('pending'); expect(corrected.corrected).toBe(true);
    expect(corrected.originalText).toBe(original.source.text);
    expect(controller.snapshot().storage![0]!.hp).toBe(500);
    expect(controller.approve(corrected.id).status).toBe('saved');
    expect(controller.snapshot().storage![0]!.hp).toBe(560); expect(controller.snapshot().rosterIds).toEqual(['a']);
    expect(() => controller.correctProposal(original.id, draft)).toThrow(/已同步/);
    expect(stores.a!.panel!.proposals!.at(-1)!.source.text).not.toMatch(/继续正文|结束/);
    ctx.chatId = 'b'; emit('CHAT_CHANGED'); expect(() => controller.correctProposal(original.id, draft)).toThrow();
  });
  it.each(['before-generation', 'during-generation'])('旧扫描未完成时保留最终消息信号（%s）', async (timing) => {
    const { controller, emit, message, delay } = setup();
    const text = '<tb><unit_update id="a" hp="500"/></tb>';
    if (timing === 'during-generation') emit('GENERATION_AFTER_COMMANDS');
    message(text, 1, false);
    let finish!: (value: unknown) => void;
    delay(new Promise((resolve) => { finish = resolve; }));
    const reading = controller.scan(1);
    if (timing === 'before-generation') emit('GENERATION_AFTER_COMMANDS');
    message(text, 1, true);
    emit('MESSAGE_RECEIVED', 1); emit('GENERATION_ENDED', 1);
    delay();
    finish([{ role: 'assistant', message_id: 1, swipe_id: 0, swipes: [text], is_hidden: false }]);
    await reading; await flush();
    expect(controller.snapshot().storage![0]!.hp).toBe(500);
    expect(controller.snapshot().proposals?.filter((p) => p.status === 'committed')).toHaveLength(1);
  });
  it('记录只存事件块；删除可持久化且不回滚档案/重复入账，失败保留记录，修改被拒事件可重扫', async () => {
    const { controller, generate, fail, stores, message, emit } = setup();
    const block = '<tb><unit_update id="a" hp="500"/></tb>';
    await generate('<think><tb><unit_update id="a" hp="0"/></tb>推理区</think>正文内容' + block);
    const p = controller.snapshot().proposals![0]!;
    expect(p.source.text).toBe(protocolExcerpt(block)); expect(stores.a!.panel!.proposals![0]!.source.text).toBe(protocolExcerpt(block));
    fail(true); expect(controller.deleteRecords([p.id]).status).toBe('failed'); expect(controller.snapshot().proposals).toHaveLength(1);
    fail(false); expect(controller.deleteRecords([p.id]).status).not.toBe('failed'); expect(controller.snapshot().proposals).toHaveLength(0);
    expect(controller.snapshot().storage![0]!.hp).toBe(500);
    const save = controller.snapshot(); controller.persistPanel(save, save.factRevision!);
    message('<tb><unit_update id="a" hp="560"/></tb>'); emit('MESSAGE_EDITED', 1); await flush();
    expect(controller.snapshot().storage![0]!.hp).toBe(500); expect(controller.snapshot().proposals).toHaveLength(0);
    await generate('<tb><unsupported/></tb>', 2); controller.deleteRecords([controller.snapshot().proposals!.at(-1)!.id]); await controller.scan(2);
    expect(controller.snapshot().proposals).toHaveLength(0);
    await generate('<tb><unit_update id="a" hp="560"/></tb>', 2);
    expect(controller.snapshot().storage![0]!.hp).toBe(560); expect(controller.snapshot().proposals).toHaveLength(1);
    stores.a!.panel!.proposals![0]!.source.text = '历史正文<think>旧推理</think>' + stores.a!.panel!.proposals![0]!.source.text;
    controller.dispose(); const reopened = new NarrativeController(createAdapter()); disposers.push(() => reopened.dispose());
    expect(reopened.snapshot().proposals![0]!.source.text).toBe(protocolExcerpt('<tb><unit_update id="a" hp="560"/></tb>'));
    reopened.deleteRecords(); await reopened.scan(2); expect(reopened.snapshot().proposals).toHaveLength(0);
  });
  it.each(['bless', 'affect'])('正文%s整批审查，保存失败不授予；撤销失败可重试且旧聊天按钮无效', async (kind) => {
    const { controller, stores, emit, generate, fail, ctx } = setup();
    const u = generateUnit({ name: '受祝福军团', side: 'ally', scale: 'company', rulesVersion: 'v2', level: 3, hpMax: 560, hp: 70, traits: [] }, { seed: 'blessing-controller', registry: traitRegistry() }).unit;
    u.id = 'a'; stores.a!.panel = { schemaVersion: 2, factRevision: 1, storage: [unitRecordFromCombatant(u)], rosterIds: ['a'] }; emit('CHAT_CHANGED');
    await generate(`<tb><${kind} id="a" name="军神裁定" ${kind === 'bless' ? 'traits="大守护"' : 'effects="诅咒,士气低下"'} battles="2"/></tb>`);
    const pending = controller.snapshot(); const proposal = pending.proposals![0]!;
    fail(true); expect(controller.approve(proposal.id).status).toBe('failed'); expect(controller.snapshot().storage![0]!.snapshot!.traitSources).toBeUndefined();
    fail(false); expect(controller.approve(proposal.id).status).not.toBe('failed');
    const saved = controller.snapshot(), sourceId = saved.storage![0]!.snapshot!.traitSources![0]!.id, context = controller.inventoryContext();
    expect(narrativeProjection(saved)).toContain('军神裁定'); expect(narrativeProjection(saved)).toContain('remaining');
    expect(narrativeProjection(saved)).toContain(kind === 'bless' ? '大守护' : '士气低下');
    const forged = structuredClone(saved); forged.storage![0]!.snapshot!.traitSources = [];
    expect(controller.persistPanel(forged, saved.factRevision!).receipt.status).toBe('failed');
    fail(true); expect(controller.revokeBlessing('a', sourceId, saved.factRevision!, context).status).toBe('failed'); expect(controller.snapshot()).toEqual(saved);
    fail(false); expect(controller.revokeBlessing('a', sourceId, saved.factRevision!, context).status).not.toBe('failed');
    expect(controller.snapshot().storage![0]!.snapshot!.traitSources![0]!.revoked).toBe(true);
    ctx.chatId = 'b'; emit('CHAT_CHANGED');
    expect(() => controller.revokeBlessing('a', sourceId, 0, context)).toThrow(/上下文/);
    expect(controller.snapshot()).toEqual({});
  });
  it('战内用药与快照同存，失败不扣，重试/重放/归档/下一战不重复或补回', () => {
    const { controller, stores, emit, fail } = setup();
    const reg = traitRegistry();
    const units = ['ally', 'enemy'].map((side) => {
      const unit = generateUnit({ name: side, side: side as 'ally' | 'enemy', scale: 'hero', rulesVersion: 'v2', level: 3, traits: [], hp: 10, hpMax: 40 }, { seed: side, registry: reg }).unit;
      unit.id = side; return unit;
    });
    stores.a!.panel = { schemaVersion: 2, factRevision: 1, storage: units.map((u) => unitRecordFromCombatant(u)), rosterIds: units.map((u) => u.id),
      inventory: [{ ...createInventoryItem('dose', '药剂', { kind: 'consumable', mechanism: 'heal', power: 3 }, 'dose', 3), assignedTo: 'ally' }] };
    emit('CHAT_CHANGED');
    const b = new SmallBattle({ rules: V2_D20, battlefield: standardField(), combatants: prepareBattleItems(units, controller.snapshot()), seed: 'battle-items', traitRegistry: reg });
    b.start(); while (b.active?.id !== 'ally') b.endTurn();
    const write = () => controller.persistPanel({ ...controller.snapshot(), battle: { kind: 'small', snap: b.toSnapshot() } }, controller.snapshot().factRevision!);
    expect(write().receipt.status).not.toBe('failed');
    const before = controller.snapshot(); b.useAbility('ally', 'item:dose', 'ally');
    fail(true); expect(write().receipt.status).toBe('failed'); expect(controller.snapshot()).toEqual(before);
    fail(false); expect(write().receipt.status).not.toBe('failed');
    expect(controller.snapshot().inventory![0]!.qty).toBe(2);
    const saved = controller.snapshot(); write(); expect(controller.snapshot()).toEqual(saved);
    const forged = structuredClone(saved); (forged.battle!.snap.combatants as typeof units)[0]!.resources['item:dose'] = 3;
    expect(controller.persistPanel(forged, saved.factRevision!).receipt.status).toBe('failed'); expect(controller.snapshot()).toEqual(saved);
    const result = commitBattleOutcome({ battleId: 'small:battle-items', committedIds: [], records: saved.storage!, roster: units, combatants: b.combatants, awards: [], registry: reg });
    expect(controller.persistPanel({ ...saved, storage: result.records, committedOutcomeIds: result.committedIds }, saved.factRevision!).receipt.status).not.toBe('failed');
    const ended = controller.snapshot(); expect(ended.storage![0]!.hp).toBe(17);
    expect(ended.storage![0]!.snapshot!.abilities.some((a) => a.itemSourceId)).toBe(false);
    controller.inventoryAction({ id: 'post-battle-dose', kind: 'use', itemId: 'dose', unitId: 'ally', expectedRevision: ended.factRevision! });
    const later = controller.snapshot(); expect(later.inventory![0]!.qty).toBe(1);
    expect(controller.persistPanel(later, later.factRevision!).receipt.status).not.toBe('failed');
    expect(controller.snapshot().storage![0]!.hp).toBe(24);
    const nextUnits = prepareBattleItems(later.storage!.map((r) => r.snapshot!), later);
    expect(nextUnits[0]!.resources['item:dose']).toBe(1);
    expect(nextUnits[1]!.resources['item:dose']).toBeUndefined();
  });
  it('库存预览不保存；聊天切换即使版本相同也拒绝旧确认，保存失败可重试同一预览', () => {
    const { controller, stores, ctx, emit, fail } = setup();
    const before = controller.snapshot();
    const preview = controller.previewInventory({ kind: 'create', itemId: 'preview-item', name: '药剂', spec: { kind: 'consumable', mechanism: 'heal', power: 3 } }, 'stable-preview');
    expect(controller.snapshot()).toEqual(before);
    expect(controller.previewInventory(preview.action, preview.intent.id).after).toEqual(preview.after);
    fail(true); expect(controller.commitInventoryPreview(preview).status).toBe('failed'); expect(controller.snapshot()).toEqual(before);
    fail(false); expect(controller.commitInventoryPreview(preview).status).not.toBe('failed');
    const next = controller.snapshot();
    controller.commitInventoryPreview(preview); expect(controller.snapshot()).toEqual(next);
    const oldContext = controller.previewInventory({ kind: 'create', itemId: 'other', name: '旧聊天药剂', spec: { kind: 'consumable', mechanism: 'heal', power: 3 } });
    stores.b!.panel = structuredClone(next); ctx.chatId = 'b'; emit('CHAT_CHANGED');
    expect(() => controller.commitInventoryPreview(oldContext)).toThrow(/聊天|上下文/);
    expect(controller.snapshot()).toEqual(next);
  });
  it('库存换装与治疗保存失败均不提交，重试一次；普通面板写入不能绕过实物投影', () => {
    const { controller, stores, emit, fail } = setup();
    const unit = generateUnit({ name: '测试携行者', side: 'ally', scale: 'hero', rulesVersion: 'v2', level: 3, traits: [], hp: 18, hpMax: 40 }, { seed: 'item-carrier', registry: traitRegistry() }).unit;
    stores.a!.panel = { schemaVersion: 2, factRevision: 1, storage: [unitRecordFromCombatant(unit)], rosterIds: [unit.id], inventory: [
      createInventoryItem('blade', '新武器', { kind: 'weapon', mechanism: 'axe', power: 8 }, 'blade'),
      createInventoryItem('dose', '补给', { kind: 'consumable', mechanism: 'heal', power: 3 }, 'dose', 2),
    ] };
    emit('CHAT_CHANGED');
    const equip = { id: 'equip', expectedRevision: 1, kind: 'equip' as const, unitId: unit.id, itemId: 'blade', slot: 'primary' as const };
    const before = controller.snapshot();
    fail(true); expect(controller.inventoryAction(equip).status).toBe('failed'); expect(controller.snapshot()).toEqual(before);
    fail(false); expect(controller.inventoryAction(equip).status).not.toBe('failed');
    expect(controller.snapshot().storage![0]!.snapshot!.weapon!.id).toBe('blade');
    const equipped = controller.snapshot();
    const use = { id: 'heal', expectedRevision: equipped.factRevision!, kind: 'use' as const, unitId: unit.id, itemId: 'dose' };
    fail(true); expect(controller.inventoryAction(use).status).toBe('failed'); expect(controller.snapshot()).toEqual(equipped);
    fail(false); expect(controller.inventoryAction(use).status).not.toBe('failed');
    const healed = controller.snapshot();
    expect(healed.storage![0]!.hp).toBeGreaterThan(18);
    expect(healed.inventory!.find((i) => i.id === 'dose')!.qty).toBe(1);
    controller.inventoryAction(use); expect(controller.snapshot()).toEqual(healed);
    const bypass = controller.snapshot(); bypass.storage![0]!.snapshot!.weapon!.baseDice = '999d6';
    expect(controller.persistPanel(bypass, bypass.factRevision!).receipt.status).toBe('failed');
    expect(controller.snapshot()).toEqual(healed);
    const stolen = controller.snapshot(); stolen.inventory!.find((i) => i.id === 'blade')!.mechanics = createInventoryItem('blade', '改写', { kind: 'weapon', mechanism: 'sword', power: 10 }, 'altered').mechanics;
    expect(controller.persistPanel(stolen, stolen.factRevision!).receipt.status).toBe('failed');
    expect(controller.snapshot()).toEqual(healed);
  });
  it('已归档濒死英雄可由明确战外急救并部署，保留长期伤势', async () => {
    const { controller, stores, emit, generate } = setup();
    const unit = generateUnit({ name: '获救者', side: 'ally', scale: 'hero', rulesVersion: 'v2', level: 4, traits: [], hpMax: 40 }, { seed: 'rescued', registry: traitRegistry() }).unit;
    unit.hp = 0; unit.status = 'dying'; unit.conditions = [{ id: 'wounded', dur: 3 }];
    stores.a!.panel = { schemaVersion: 2, factRevision: 1, storage: [unitRecordFromCombatant(unit)], rosterIds: [], storySync: true };
    emit('CHAT_CHANGED');
    await generate(`<tb><deploy id="${unit.id}"/><unit_update id="${unit.id}" hp="5"/></tb>`);
    expect(controller.snapshot().storage?.[0]).toMatchObject({ id: unit.id, hp: 5, status: 'ready', conditions: unit.conditions });
    expect(controller.snapshot().rosterIds).toEqual([unit.id]);
  });
  it('迁移预览期间不写旧档；保存失败保持待审，接受后可恢复完整原档', () => {
    const { controller, stores, emit, fail } = setup();
    const original = { ...stores.a!.panel!, schemaVersion: 1, roster: [] };
    stores.a!.panel = original; emit('CHAT_CHANGED');
    expect(controller.migrationReview()).toBeDefined();
    expect(controller.setStorySync(false).status).toBe('failed'); expect(stores.a!.panel).toEqual(original);
    fail(true); expect(controller.acceptMigration().status).toBe('failed'); expect(controller.migrationReview()).toBeDefined();
    fail(false); expect(controller.acceptMigration().status).not.toBe('failed'); expect(controller.migrationReview()).toBeUndefined();
    expect(Array.isArray(controller.snapshot().migrationBackups)).toBe(true);
    expect(controller.restoreMigrationBackup().status).not.toBe('failed');
    expect(controller.migrationReview()!.original.storage).toEqual(original.storage);
    expect(stores.a!.panel?.schemaVersion).toBe(1);
  });
  it('初次空存档界面补齐空字段不使已准备消息过期', async () => {
    const { controller, generate } = setup();
    const old = controller.snapshot();
    controller.persistPanel({ ...old, field: '', battle: null, committedOutcomeIds: [], inventory: [] }, old.factRevision!);
    expect(controller.snapshot().factRevision).toBe(old.factRevision);
    await generate('<tb><unit_update id="a" hp="500"/></tb>');
    expect(controller.snapshot().storage?.[0]?.hp).toBe(500);
  });
  it('无面板也能注入与自动补员+部署；重复事件/重生成不重做', async () => {
    const { controller, ctx, generate, emit, message } = setup();
    await generate('<tb><deploy id="a"/><unit_update id="a" hp="500"/></tb>');
    expect(controller.snapshot().storage?.[0]?.hp).toBe(500);
    expect(controller.snapshot().rosterIds).toEqual(['a']);
    const revision = controller.snapshot().factRevision;
    emit('GENERATION_ENDED', 1); await flush();
    expect(controller.snapshot().factRevision).toBe(revision);
    message('<tb><unit_update id="a" hp="560"/></tb>'); emit('MESSAGE_EDITED', 1); await flush();
    expect(controller.snapshot().storage?.[0]?.hp).toBe(500);
    expect(controller.snapshot().proposals?.at(-1)?.status).toBe('stale');
    expect(ctx.setExtensionPrompt.mock.calls.at(-1)?.[1]).toContain('"hp":500');
  });
  it('两个独立消息可以重复同文补员，事实版本不同不靠 raw 全局去重', async () => {
    const { controller, generate } = setup();
    await generate('<tb><unit_update id="a" hp="500"/></tb>');
    const save = controller.snapshot(); save.storage![0]!.hp = 70;
    controller.persistPanel(save, save.factRevision!);
    await generate('<tb><unit_update id="a" hp="500"/></tb>', 2);
    expect(controller.snapshot().storage?.[0]?.hp).toBe(500);
    expect(controller.snapshot().proposals?.filter((p) => p.status === 'committed')).toHaveLength(2);
  });
  it('停止/缺完成标记不会自动执行，生命周期不能用结束事件冒充成功', async () => {
    const { controller, generate } = setup();
    await generate('<tb><unit_update id="a" hp="500"/></tb>', 1, true);
    await generate('<tb><unit_update id="a" hp="560"/></tb>', 2, false, false);
    expect(controller.snapshot().storage?.[0]?.hp).toBe(70);
    expect(controller.snapshot().proposals?.every((p) => p.status === 'legacy' || p.status === 'pending' && p.expected?.manualOnly)).toBe(true);
  });
  it('生成期间档案变化使旧回复过期，失败整包可按原身份重试', async () => {
    const { controller, emit, message, fail, generate } = setup();
    emit('GENERATION_AFTER_COMMANDS');
    const save = controller.snapshot(); save.storage![0]!.hp = 60; controller.persistPanel(save, save.factRevision!);
    message('<tb><unit_update id="a" hp="500"/></tb>'); emit('MESSAGE_RECEIVED', 1); emit('GENERATION_ENDED', 1); await flush();
    expect(controller.snapshot().storage?.[0]?.hp).toBe(60);
    expect(controller.snapshot().proposals?.at(-1)?.status).toBe('stale');
    fail(true); await generate('<tb><unit_update id="a" hp="560"/></tb>', 2);
    expect(controller.snapshot().storage?.[0]?.hp).toBe(60);
    const p = controller.snapshot().proposals!.at(-1)!; expect(p.status).toBe('failed');
    fail(false); expect(controller.approve(p.id).status).toBe('saved');
    expect(controller.snapshot().storage?.[0]?.hp).toBe(560);
    expect(() => controller.approve(p.id)).toThrow();
  });
  it('切聊天时丢弃未完成旧读取，清理注入；销毁后没有剩余监听', async () => {
    const { controller, ctx, emit, delay, callbacks, stores } = setup();
    let finish!: (value: unknown) => void;
    delay(new Promise((resolve) => { finish = resolve; }));
    const reading = controller.scan();
    ctx.chatId = 'b'; emit('CHAT_CHANGED');
    finish([{ role: 'assistant', message_id: 1, message: '<tb><unit_update id="a" hp="500"/></tb>' }]);
    await reading;
    expect(controller.snapshot()).toEqual({}); expect(stores.b).toEqual({});
    controller.dispose(); expect([...callbacks.values()].every((set) => set.size === 0)).toBe(true);
  });
  it('已结算旧副本不污染最新档案投影，长仓库全量输出不截断', () => {
    const { controller } = setup(); const save = controller.snapshot(); save.storage![0]!.hp = 500;
    save.battle = { kind: 'small', snap: { seed: 'old', combatants: [{ id: 'a', hp: 70, base: { hpMax: 560 } }] } }; save.committedOutcomeIds = ['small:old'];
    expect(narrativeProjection(save)).toContain('"hp":500'); expect(narrativeProjection(save)).not.toContain('"hp":70');
    save.storage = Array.from({ length: 300 }, (_, i) => ({ ...save.storage![0]!, id: String(i) }));
    expect(narrativeProjection(save)).toContain('"id":"299"'); expect(narrativeProjection(save).length).toBeGreaterThan(5300);
  });
  it('注入使用有限末尾深度、清理为空串；点名旧档优先，名称不闭合事实标签，超量反馈可更正', async () => {
    const { controller, ctx, generate, stores, emit } = setup();
    expect(ctx.setExtensionPrompt.mock.calls.at(-1)?.slice(2)).toEqual([1, 0, false, 0]);
    const save = controller.snapshot(), base = save.storage![0]!;
    save.storage = Array.from({ length: 80 }, (_, n) => ({ ...structuredClone(base), id: 'record-' + n, name: '旧档' + n }));
    save.storage[79]!.name = '待查档案</tb_context>';
    const projection = narrativeProjection(save, '请调取' + save.storage[79]!.name);
    expect(projection).toContain('record-79'); expect(projection).not.toContain('</tb_context>');
    expect(projection).toContain('"id":"record-0"'); expect(projection.length).toBeGreaterThan(5300);
    await generate('<tb><spawn name="士兵" side="enemy" scale="hero" count="80"/></tb>');
    expect(controller.snapshot().storage).toHaveLength(1);
    expect(ctx.setExtensionPrompt.mock.calls.at(-1)?.[1]).not.toContain('上次候选未应用');
    // 同一swipe的不同非法正文必须刷新错误，不能因两次canonical为空而被误去重。
    await generate('<tb><unsupported/></tb>');
    expect(controller.snapshot().proposals!.at(-1)!.reason).toContain('不支持事件');
    expect(stores.a!.panel!.storage).toHaveLength(1);
    controller.dispose(); expect(ctx.setExtensionPrompt.mock.calls.at(-1)).toEqual(['tavern-battle:context', '', 1, 0, false, 0]);
  });
});
