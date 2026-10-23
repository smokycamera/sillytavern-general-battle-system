import { prepareTraitLevelModel } from '../../engine/src/trait-level-model.js';
import { prepareCombatModel } from '../../engine/src/combat-model.js';
import { upgradeCombatSkills } from '../../engine/src/skill-upgrade.js';
import { V6_D20, V29_OVERFLOW_D20 } from '../../engine/src/rules.js';
import { prepareSkillModel } from '../../engine/src/skill-model.js';
import { prepareItemModel } from '../../engine/src/item-model.js';
import { randomId } from '../../host/src/browser-compat.js';
import type { PromptSettings } from './prompt-settings.js';
import { PANEL_SAVE_SCHEMA_VERSION, learnUnitRecord } from './unit-state.js';
import { generateUnit, grantTraitSource, revokeTraitSource, traitRegistry, narrativeTraitLevel, isGradedTrait, type Combatant, type GenerateInput } from '../../engine/src/index.js';
import { deployUnitRecord, materializeUnitRecord, unitRecordFromCombatant, updateUnitRecord, type UnitRecord } from './unit-state.js';
import { parseProtocol, protocolExcerpt } from './protocol.js';
import type { Suggestion } from './tags.js';
import { migrateSavedSuggestion } from './saved-suggestion.js';
import { createInventoryItem, isInventoryStack, narrativeTakeParts, prepareInventoryState, prepareInventoryTransaction, type InventoryItem } from './inventory-state.js';
import { assertNarrativeCapacity, hasNarrativeDeployment, MAX_SCENE_UNITS } from './narrative-limits.js';
import { applyUnitSet, UNIT_EQUIPMENT_FIELDS, unitSetReferencesGear, type UnitSetContext } from './unit-set.js';
import { mapNarrativeReferences, narrativeIds, prepareNarrativeIds, type NarrativeIdState } from './narrative-ids.js';
import { newUnitId, planNewUnits, type NewUnitPlan } from './narrative-new-units.js';
import { handOverItems, type HandOver } from './item-handover.js';
import { weaponItemSpecification } from './item-spec.js';

export interface MessageEnvelope {
  characterId: string;
  chatId: string;
  branchId: string;
  messageId: string;
  swipeId: string;
  role: 'assistant' | 'user' | 'system' | 'unknown';
  text: string;
  complete: boolean;
  generationId?: string;
}
export interface GenerationBinding {
  /** 消息读取时建立的预览绑定，不代表捕获了生成起点，必须手动确认。 */
  manualOnly?: boolean;
  messageId?: string;
  id: string;
  namespace: string;
  factRevision: number;
  unitVersions: Record<string, number>;
  narrativeIdState?: NarrativeIdState;
  complete: boolean;
}
export interface NarrativeProposal {
  id: string;
  source: MessageEnvelope;
  sourceKey: string;
  canonical: string;
  events: Suggestion[];
  expected?: GenerationBinding;
  status: 'pending' | 'committed' | 'rejected' | 'stale' | 'failed' | 'legacy' | 'unresolved';
  reason?: string;
  notices?: string[];
  /** 玩家修正的是本地事件草稿，宿主原消息未修改。 */
  corrected?: boolean;
  origin?: 'ai-scan';
  originalText?: string;
}
export interface NarrativeSave {
  classMigration?: 'arms-v2';
  reports?: import('./battle-reports.js').BattleReport[];
  activeBattleStart?: import('./report-history.js').BattleStart;
  deletedReport?: import('./report-history.js').DeletedReport;
  deletedReportIds?: string[];
  promptSettings?: PromptSettings;
  schemaVersion?: number;
  storage?: UnitRecord[];
  rosterIds?: string[];
  storySync?: boolean;
  autoApprove?: boolean;
  factRevision?: number;
  proposals?: NarrativeProposal[];
  /** 删除记录只移除可见正文副本；提交来源键仍防止同一消息重复入账。 */
  committedNarrativeSources?: string[];
  deletedNarrativeReceipts?: string[];
  field?: string;
  lighting?: 'day' | 'night';
  inventory?: InventoryItem[];
  narrativeIdState?: NarrativeIdState;
  inventoryOperations?: { id: string; fingerprint: string }[];
  battle?: { kind: 'small' | 'mass'; snap: Record<string, unknown> } | null;
  committedOutcomeIds?: string[];
  [key: string]: unknown;
}
export function namespaceOf(message: Pick<MessageEnvelope, 'characterId' | 'chatId' | 'branchId'>): string {
  return JSON.stringify([message.characterId, message.chatId, message.branchId]);
}
export function messageSourceKey(message: MessageEnvelope): string {
  return JSON.stringify([namespaceOf(message), message.messageId]);
}
export function factsOf(save: NarrativeSave): string {
  return JSON.stringify({ records: save.storage ?? [], roster: save.rosterIds ?? [], battle: save.battle ?? null,
    committed: save.committedOutcomeIds ?? [], field: save.field ?? '', lighting: save.lighting ?? (save.field === 'night' ? 'night' : 'day'), inventory: save.inventory ?? [] });
}
export function captureGeneration(save: NarrativeSave, namespace: string, id: string): GenerationBinding {
  return { id, namespace, factRevision: save.factRevision ?? 0,
    unitVersions: Object.fromEntries((save.storage ?? []).map((r) => [r.id, r.revision ?? 1])), narrativeIdState: narrativeIds(save).state, complete: false };
}
export const narrativeAutoApproval = (save: NarrativeSave): boolean => save.autoApprove ?? save.storySync ?? false;
/** 非鉴权散列，仅用于删除后的重复扫描去重；提交守卫使用完整来源键。 */
export function narrativeReceiptKey(proposal: NarrativeProposal): string {
  const value = JSON.stringify([proposal.sourceKey, proposal.source.swipeId, proposal.canonical || proposal.source.text]);
  const state = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  for (let i = 0; i < value.length; i++) for (let n = 0; n < state.length; n++) state[n] = Math.imul(state[n]! ^ (value.charCodeAt(i) + n), [16777619, 2246822519, 3266489917, 668265263][n]!);
  return state.map((n) => (n >>> 0).toString(16).padStart(8, '0')).join('');
}
export function compactNarrativeSources(save: NarrativeSave): NarrativeSave {
  if (save.classMigration !== undefined && save.classMigration !== 'arms-v2') throw Error('武器类别更新标记损坏');
  // The panel shows twelve completed records. Keep their details, and retain only
  // deduplication receipts for older completed records; unresolved work stays intact.
  const completed = (save.proposals ?? []).filter(p => p.status === 'committed' || p.status === 'rejected');
  if (completed.length > 12) save = deleteNarrativeRecords(save, completed.slice(0, -12).map(p => p.id));
  return prepareNarrativeIds({ ...save, ...(Array.isArray(save.proposals) ? { proposals: save.proposals.map((p) => ({ ...p, source: { ...p.source, text: protocolExcerpt(p.source.text) },
    ...(p.originalText !== undefined ? { originalText: protocolExcerpt(p.originalText) } : {}) })) } : {}) });
}
export function deleteNarrativeRecords(save: NarrativeSave, ids?: string[]): NarrativeSave {
  const selected = ids ? new Set(ids) : undefined;
  const removed = (save.proposals ?? []).filter((p) => selected ? selected.has(p.id) : ['committed', 'rejected', 'stale'].includes(p.status));
  const removedSet = new Set(removed);
  return { ...save, proposals: (save.proposals ?? []).filter((p) => !removedSet.has(p)),
    committedNarrativeSources: [...new Set([...(save.committedNarrativeSources ?? []), ...removed.filter((p) => p.status === 'committed').map((p) => p.sourceKey)])],
    deletedNarrativeReceipts: [...new Set([...(save.deletedNarrativeReceipts ?? []), ...removed.map(narrativeReceiptKey)])] };
}
export function proposalFromMessage(source: MessageEnvelope, expected?: GenerationBinding): NarrativeProposal | undefined {
  const parsed = parseProtocol(source.text);
  if (!parsed.events.length && !parsed.errors.length) return undefined;
  const trusted = source.role === 'assistant' && source.complete && !!source.messageId && !!source.swipeId && (!expected?.messageId || expected.messageId === source.messageId) && source.generationId && source.generationId === expected?.id && expected.complete && namespaceOf(source) === expected.namespace;
  return {
    id: randomId(), source: { ...structuredClone(source), text: protocolExcerpt(source.text) }, sourceKey: messageSourceKey(source),
    canonical: parsed.canonical, events: parsed.events, expected: expected ? structuredClone(expected) : undefined,
    status: parsed.errors.length ? 'unresolved' : trusted ? 'pending' : 'legacy',
    notices: parsed.warnings,
    reason: parsed.errors.length ? '已识别' + parsed.events.length + '项，待补全：' + parsed.errors.join('；')
      : (!trusted ? !source.complete ? '正文尚未确认生成完成，等待完整消息后刷新' : '无法确定原消息身份，请重新读取或核对来源' : undefined),
  };
}

/** The local scan is a separate source; it never replaces or tags the original chat message. */
export function prepareAiScanProposal(save: NarrativeSave, namespace: string, text: string): NarrativeSave {
  const [characterId, chatId, branchId] = JSON.parse(namespace) as string[];
  const id = randomId(), binding = captureGeneration(save, namespace, id); binding.complete = true;
  const source: MessageEnvelope = { characterId: characterId!, chatId: chatId!, branchId: branchId!, messageId: 'ai-scan:' + id, swipeId: '0',
    role: 'assistant', complete: true, generationId: id, text };
  const proposal = proposalFromMessage(source, binding);
  if (!proposal) throw Error('扫描结果没有事件');
  proposal.origin = 'ai-scan';
  const candidate = { ...save, proposals: [...(save.proposals ?? []), proposal] };
  if (proposal.status === 'pending' && narrativeAutoApproval(save)) {
    try { return prepareNarrativeTransaction(candidate, proposal, namespace); }
    catch (error) { proposal.status = 'unresolved'; proposal.reason = error instanceof Error ? error.message : String(error); }
  }
  return candidate;
}

/** 相同正文仍可因消息完成或手动重扫获得新的事实绑定；已入账/拒绝不重开。 */
export function shouldRefreshNarrativeProposal(previous: NarrativeProposal | undefined, next: NarrativeProposal, manual = false): boolean {
  if (!previous || next.status !== 'pending') return false;
  if (manual && ['legacy', 'pending', 'stale', 'failed', 'unresolved'].includes(previous.status)) return true;
  return previous.status === 'legacy' || previous.status === 'unresolved' && !!previous.reason?.startsWith('已识别')
    || previous.status === 'pending' && !!previous.expected?.manualOnly && !next.expected?.manualOnly;
}

function spawnInput(event: Extract<Suggestion, { kind: 'spawn' }>): GenerateInput {
  const registry = traitRegistry();
  // 兼容更新前已保存的候选：未知特质不会令建档再次失败。专精等级随特质写在一起（forest-loreL8）。
  const parsed = (event.traits ?? []).map((name) => narrativeTraitLevel(name, registry));
  const traits = [...new Set(parsed.flatMap((p) => p.kind === 'trait' ? [p.id] : []))];
  const levels: Record<string, number> = {};
  for (const p of parsed) if (p.kind === 'trait' && isGradedTrait(p.id)) levels[p.id] = Math.max(levels[p.id] ?? 0, p.level ?? 5);
  return {
    ...(Object.keys(levels).length ? { traitLevels: levels } : {}),
    rulesVersion: 'v2', damageModel: 'wounds-v2', numericModel: 'graded-v1', loadModel: 'capacity-v2', body: event.body, mount: event.mount, speedTier: event.speedTier, quality: event.quality, shield: event.shield,
    shieldName: event.shieldName, shieldLevel: event.shieldLevel, shieldClass: event.shieldClass, shieldBonuses: event.shieldBonuses,
    ...((event.scale ?? 'hero') === 'hero' ? {} : { hp: event.hp, hpMax: event.hpMax }),
    name: event.name, scale: event.scale ?? 'hero', archetype: event.archetype, level: event.level, side: event.side ?? 'enemy',
    traits: traits as string[], weaponName: event.weaponName ?? event.weapon, weaponClass: event.weaponClass,
    bonuses: event.bonuses, weaponBonuses: event.weaponBonuses, sidearmBonuses: event.weapon2Bonuses, armorBonuses: event.armorBonuses,
    weaponLevel: event.weaponLevel, weaponStabilized: event.weaponStabilized, weaponEnchantment: event.weaponEnchantment, reserves: event.reserves, armorProfile: event.armorProfile, sidearmName: event.weapon2Name, sidearmClass: event.weapon2Class, sidearmLevel: event.weapon2Level,
    armorName: event.armorName ?? event.armor, armorTier: event.armorTier, armorLevel: event.armorLevel,
    abilityBlueprints: event.skills?.map((s) => ({ id: s.blueprintId, level: s.level, name: s.name, bonuses: s.bonuses })),
  };
}

/** hero 生命上限仍由训练/身体/修正推导；正文 hp/hpMax 只按比例表示伤势，新建至少保留1点生命。 */
function applySpawnWound(unit: Combatant, event: Extract<Suggestion, { kind: 'spawn' }>): void {
  if (unit.scale !== 'hero' || event.hp === undefined || !event.hpMax || event.hp >= event.hpMax) return;
  unit.hp = Math.max(1, Math.min(unit.base.hpMax, Math.round(unit.base.hpMax * event.hp / event.hpMax)));
  if (unit.genAudit) unit.genAudit.input.hp = unit.hp;
}

/** 同一档案允许互补/相同赋值；真正冲突仍需澄清，不能靠执行顺序暗中覆盖。 */
function assertCompatibleUnitChanges(events: Suggestion[]): void {
  const changes = new Map<string, Map<string, string>>();
  const aliases: Record<string, string> = { state: 'status', speed: 'speedTier', weapon2: 'sidearm',
    'base.hpMax': 'hpMax', 'base.atk': 'atk', 'base.def': 'def', 'base.spd': 'spd', 'base.moraleMax': 'moraleMax',
    'formation.members': 'hp', 'formation.capacity': 'hpMax' };
  for (const event of events) {
    if (event.kind !== 'unit-set' && event.kind !== 'unit-update') continue;
    const fields = changes.get(event.id!) ?? new Map<string, string>();
    changes.set(event.id!, fields);
    const visit = (value: unknown, path: string): void => {
      if (value === undefined) return;
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        for (const [key, child] of Object.entries(value)) visit(child, path ? path + '.' + key : key);
        return;
      }
      path = aliases[path] ?? path;
      const encoded = JSON.stringify(value);
      for (const [previous, encodedPrevious] of fields) {
        if (previous === path ? encodedPrevious !== encoded : previous.startsWith(path + '.') || path.startsWith(previous + '.')) {
          throw new Error(`档案 ${event.id} 的 ${path} 更新冲突，请合并为明确的绝对值`);
        }
      }
      fields.set(path, encoded);
    };
    visit(event.kind === 'unit-set' ? event.data : { hp: event.hp, hpMax: event.hpMax, morale: event.morale, status: event.state }, '');
  }
}

type Registry = ReturnType<typeof traitRegistry>;
function mergePatch(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const child = target[key]; target[key] = child && typeof child === 'object' && !Array.isArray(child) ? child : {};
      mergePatch(target[key] as Record<string, unknown>, value as Record<string, unknown>);
    } else target[key] = structuredClone(value);
  }
}
/** 补员/状态与单位字段：同一档案的 unit_set 合并后一次赋值，unit_update 并入其中或单独更新。 */
function applyUnitChanges(save: NarrativeSave, events: Suggestion[], combined: Map<string, Record<string, unknown>>, proposalId: string, registry: Registry, context: UnitSetContext): NarrativeSave {
  let next = save, records = next.storage ?? [];
  // 只交道具（items）的 unit_set 不改档案字段，道具在入账最后交出。
  for (const event of events) if (event.kind === 'unit-set' && Object.keys(event.data).length) {
    const patch = combined.get(event.id) ?? {}; mergePatch(patch, event.data); combined.set(event.id, patch);
  }
  for (const event of events) {
    if (event.kind !== 'unit-update') continue;
    const combinedPatch = combined.get(event.id!);
    if (combinedPatch) {
      mergePatch(combinedPatch, { hp: event.hp, hpMax: event.hpMax, morale: event.morale, status: event.state });
      if (event.clear?.length) {
        const conditions = (combinedPatch.conditions ?? records.find(r => r.id === event.id)?.conditions ?? []) as Combatant['conditions'];
        combinedPatch.conditions = event.clear.includes('all') || event.clear.includes('全部') ? [] : conditions.filter(c => !event.clear!.includes(c.id));
      }
      continue;
    }
    records = records.map((r) => r.id === event.id ? updateUnitRecord(r, event, registry, proposalId) : r);
  }
  next.storage = records;
  for (const [id, patch] of combined) {
    const side = patch.side ?? records.find(record => record.id === id)?.side;
    const reforged = context.reforgedEquipment?.filter(item => item.qty > 0 && (side === 'ally' || item.equippedTo?.unitId === id)
      && (item.assignedTo === id || !item.assignedTo && side === 'ally')) ?? [];
    const incoming = [...context.deferEquipmentFor?.get(id) ?? [], ...reforged];
    if (incoming.length && context.deferredEquipment) {
      const deferred = context.deferredEquipment.get(id) ?? {};
      const resolve = narrativeIds(next).realId;
      for (const key of UNIT_EQUIPMENT_FIELDS) if (Object.hasOwn(patch, key)) {
        const slot = key === 'weapon' ? 'primary' : key === 'weapon2' ? 'sidearm' : key;
        const matches = incoming.filter(item => (!item.equippedTo || item.equippedTo.unitId === id && item.equippedTo.slot === slot
          || context.deferEquipmentFor?.get(id)?.some(given => given.id === item.id))
          && unitSetReferencesGear(key, patch[key], item, resolve, context.reforgedNames));
        if (!matches.length) continue;
        const unique = [...new Set(matches.map(item => item.id))];
        // 重铸与转移完成后再穿戴，字符串引用先锁定原实物；不能按改名后的名称另造一件。
        deferred[key] = typeof patch[key] === 'string' && unique.length === 1 ? unique[0] : patch[key];
        delete patch[key];
      }
      if (['weapon','weapon2','sidearm'].some(key => Object.hasOwn(deferred,key))) for (const key of ['enchant','stabilized']) {
        if (!Object.hasOwn(patch,key)) continue;
        deferred[key] = patch[key];
        if (!['weapon','weapon2','sidearm'].some(field => Object.hasOwn(patch,field))) delete patch[key];
      }
      if (Object.hasOwn(deferred,'armor') && Object.hasOwn(patch,'protection')) { deferred.protection = patch.protection; delete patch.protection; }
      if (Object.keys(deferred).length) context.deferredEquipment.set(id, deferred);
    }
    if (Object.keys(patch).length) next = applyUnitSet(next, id, patch, proposalId, context);
  }
  return next;
}
/** 学习技能与剧情效果来源；来源编号带事件序号，同一回复重复学习需合并。 */
function applyUnitEffect(storage: UnitRecord[], event: Extract<Suggestion, { kind: 'learn' | 'bless' | 'unbless' | 'affect' | 'unaffect' }>, index: number, proposalId: string, registry: Registry, learned: Set<string>): UnitRecord[] {
  if (event.kind === 'learn') {
    if (learned.has(event.id)) throw new Error('同一回复请合并对同一档案的技能学习');
    learned.add(event.id);
    return storage.map((record) => record.id === event.id ? learnUnitRecord(record, event.skills.map((s) => ({ id: s.blueprintId, level: s.level, name: s.name, bonuses: s.bonuses })), registry, `learn:${proposalId}:${index}`) : record);
  }
  const record: UnitRecord = storage.find((r) => r.id === event.id)!;
  if (record.retired || record.hp <= 0 || record.status === 'dead') throw new Error('不能通过效果来源复活阵亡或解散档案');
  const unit = materializeUnitRecord(record, registry);
  prepareTraitLevelModel(unit, V29_OVERFLOW_D20);
  if (event.kind === 'bless') grantTraitSource(unit, { id: `bless:${proposalId}:${index}`, name: event.name, kind: 'blessing', traitIds: event.traitIds, ...(event.traitLevels ? { traitLevels: event.traitLevels } : {}), duration: event.duration });
  else if (event.kind === 'affect') grantTraitSource(unit, { id: `affect:${proposalId}:${index}`, name: event.name, kind: 'effect', traitIds: [], conditionIds: event.conditionIds, duration: event.duration });
  else {
    const kind = unit.traitSources?.find((s) => s.id === event.sourceId)?.kind;
    if (!kind || kind === 'equipment' || event.kind === 'unbless' && kind !== 'blessing') throw new Error('只能解除本单位的明确剧情效果来源');
    revokeTraitSource(unit, event.sourceId);
  }
  return storage.map((r) => r.id === record.id ? unitRecordFromCombatant(unit, record, { sourceId: proposalId, kind: 'update' }) : r);
}
/** 同批新建单位建档之后再执行指向它们的修改，阶段顺序与已有单位相同。 */
function applyToNewUnits(save: NarrativeSave, events: Suggestion[], fresh: NewUnitPlan, proposalId: string, registry: Registry, deploys: string[], context: UnitSetContext): NarrativeSave {
  const isNew = (event: Suggestion) => 'id' in event && !!event.id && fresh.created.has(event.id);
  let next = applyUnitChanges(save, events.filter(isNew), new Map([...fresh.patches].map(([id, patch]) => [id, structuredClone(patch)])), proposalId, registry, context);
  const learned = new Set<string>();
  for (const [index, event] of events.entries()) {
    if (!isNew(event)) continue;
    if (event.kind === 'unbless' || event.kind === 'unaffect') throw new Error('新建单位还没有可解除的效果来源');
    if (event.kind === 'learn' || event.kind === 'bless' || event.kind === 'affect') next.storage = applyUnitEffect(next.storage!, event, index, proposalId, registry, learned);
  }
  const fit = (id: string) => next.storage!.some((r) => r.id === id && r.hp > 0 && !r.retired && r.status !== 'dead');
  next.rosterIds = [...new Set([...next.rosterIds ?? [], ...deploys])].filter((id) => !fresh.created.has(id) || fit(id));
  return next;
}

/** 整包准备与校验；调用方持久化成功后才替换当前事实。 */
export function prepareNarrativeTransaction(save: NarrativeSave, proposal: NarrativeProposal, namespace: string, manual = false): NarrativeSave {
  proposal = { ...proposal, events: proposal.events.map(migrateSavedSuggestion) };
  if (proposal.status === 'unresolved') throw new Error('还有待补全的事件，请先修正草稿或明确仅保留已识别部分');
  if (proposal.status !== 'pending') throw new Error('待确认内容未处于可提交状态');
  if (!proposal.events.length) throw new Error('没有可入账的事件');
  const expected = proposal.expected;
  if (!expected || expected.namespace !== namespace || expected.factRevision !== (save.factRevision ?? 0)) throw new Error('待确认内容已过期或属于其他聊天/分支');
  if (!proposal.source.complete || proposal.source.role !== 'assistant') throw new Error('只接受完整 assistant 正文');
  if (save.battle) {
    const id = `${save.battle.kind}:${String(save.battle.snap.seed)}`;
    if (!(save.committedOutcomeIds ?? []).includes(id)) throw new Error('战内与未结算战果只能由引擎更新');
  }
  if (save.committedNarrativeSources?.includes(proposal.sourceKey) || (save.proposals ?? []).some((p) => p.sourceKey === proposal.sourceKey && p.status === 'committed')) throw new Error('此消息已经提交，编辑/重生成不会重复执行');
  const preparedSave = prepareInventoryState(save);
  const ids = narrativeIds({ ...preparedSave, narrativeIdState: expected.narrativeIdState ?? save.narrativeIdState });
  // 正文给新单位自编的编号只在本批指代该新单位；已有编号照常还原为存档身份。
  const fresh = planNewUnits(preparedSave, proposal.id, mapNarrativeReferences(proposal.events, ids.realId), ids);
  proposal = { ...proposal, events: fresh.events };
  const isNew = (event: Suggestion) => 'id' in event && !!event.id && fresh.created.has(event.id);
  if (!manual && expected.manualOnly) throw new Error('此消息需要预览确认后提交');
  if (!manual && !narrativeAutoApproval(save)) throw new Error('自动批准未开启，需要确认后提交');
  assertNarrativeCapacity(save, proposal.events);
  const replacesRoster = hasNarrativeDeployment(proposal.events);
  let next = structuredClone(save);
  // 只清候选副本的出场选择，档案/装备/战果保持；校验或保存失败仍保留旧事实。
  if (replacesRoster) next.rosterIds = [];
  // 先占用正文写给新单位的空闲编号，本批其他新实例不会抢到它。
  if (fresh.handles.size) next.narrativeIdState = { aliases: { ...next.narrativeIdState?.aliases, ...Object.fromEntries(fresh.handles) } };
  const registry = traitRegistry();
  let records = next.storage ?? [];
  assertCompatibleUnitChanges([...proposal.events, ...[...fresh.patches].map(([id, data]): Suggestion => ({ kind: 'unit-set', id, data, raw: '' }))]);
  for (const event of proposal.events) {
    const recipients = event.kind === 'give' ? event.to ?? [] : event.kind === 'add' ? event.to ? [event.to] : []
      : ['unit-set', 'unit-update', 'deploy', 'bless', 'unbless', 'affect', 'unaffect', 'learn'].includes(event.kind) ? ['id' in event ? event.id ?? '' : ''] : [];
    for (const unitId of recipients) {
      if (fresh.created.has(unitId)) continue;
      const record = records.find((r) => r.id === unitId);
      // 缺失与过期分开说明：编错编号需要改草稿，过期才需要重新扫描。
      if (!record || !unitId) throw new Error(`档案 ${ids.publicId(unitId)} 缺失：这个编号不是已有单位。修改已有单位请用单位资料里的编号，新单位用 spawn 新建`);
      if (expected.unitVersions[unitId] !== (record.revision ?? 1)) throw new Error(`档案 ${ids.publicId(unitId)}（${record.name}）在这条回复之后已有改动，版本过期，请重新扫描`);
    }
  }
  // 固定阶段：移除旧实物 → 新入库实物 → 补员/状态 → 单位字段 → 实物改造/学习/效果 → 部署。
  // 新入库排在单位字段之前：unit_set 换上的若正是同一回复 add 的那件，直接取用而不另造一件。
  // 版本只对批次开始前的事实校验；后续任一步失败只丢弃此候选副本。
  const givenStacks = new Set(proposal.events.flatMap(event => event.kind === 'give' && preparedSave.inventory?.some(item => item.id === event.id && isInventoryStack(item)) ? [event.id] : []));
  const take = (event: Extract<Suggestion, { kind: 'take' }>, index: number) => {
    next = prepareInventoryState(next);
    const parts = narrativeTakeParts(next.inventory ?? [], event.id, event.qty);
    for (const [partIndex, part] of parts.entries()) {
      const item = next.inventory!.find(item => item.id === part.itemId)!;
      const operation = proposal.id + ':' + index + (partIndex ? ':part:' + partIndex : '');
      if (item.equippedTo) next = prepareInventoryTransaction(next, { kind: 'unequip', id: 'take-unequip:' + operation, expectedRevision: next.factRevision ?? 0, ...item.equippedTo, itemId: item.id });
      next = prepareInventoryTransaction(next, { kind: 'discard', id: 'take:' + operation, expectedRevision: next.factRevision ?? 0, ...part });
    }
  };
  for (const [index, event] of proposal.events.entries()) {
    if (event.kind === 'take' && !givenStacks.has(event.id)) take(event, index);
  }
  for (const [index, event] of proposal.events.entries()) {
    if (event.kind !== 'add' || !event.id) continue;
    next = prepareInventoryTransaction(next, { kind: 'add', id: `add:${proposal.id}:${index}`, expectedRevision: next.factRevision ?? 0, itemId: event.id, qty: event.qty });
  }
  // given：换装可取用的同一回复实物；handed：同一回复 add 的全部实物，unit_set 的 items 先从这里交出。
  const given = new Set<string>(), handed = new Set<string>(), notices: string[] = [];
  const deferredEquipment = new Map<string, Record<string, unknown>>();
  const incomingEquipment = new Map<string, InventoryItem[]>();
  for (const event of proposal.events) if (event.kind === 'give') {
    const item = preparedSave.inventory?.find(item => item.id === event.id);
    if (item) for (const unitId of event.to ?? []) incomingEquipment.set(unitId, [...incomingEquipment.get(unitId) ?? [], item]);
  }
  const reforgedNames = new Map(proposal.events.flatMap(event => event.kind === 'reforge' && event.name ? [[event.id, event.name] as const] : []));
  const reforgeIds = new Set(proposal.events.flatMap(event => event.kind === 'reforge' ? [event.id] : []));
  const unitSetContext: UnitSetContext = { given, notices, deferredEquipment, deferEquipmentFor: incomingEquipment, reforgedNames,
    reforgedEquipment: preparedSave.inventory?.filter(item => reforgeIds.has(item.id)) };
  const directGives = new Map<string, string>();
  for (const [index, event] of proposal.events.entries()) {
    if (event.kind !== 'add' || event.item === undefined) continue;
    const id = `loot-${proposal.id}-${index}`;
    if (event.to) for (let i = 0; i < (event.spec && !(event.spec.kind === 'item' && event.spec.form === 'single') ? event.qty : 1); i++) {
      directGives.set(event.spec && !(event.spec.kind === 'item' && event.spec.form === 'single') && event.qty !== 1 ? `${id}-${i}` : id, event.to);
    }
    if (!event.spec) { next.inventory = [...(next.inventory ?? []), { id, name: event.item, qty: event.qty, lootType: event.lootType, note: event.note }]; given.add(id); handed.add(id); }
    else if (event.spec.kind === 'item' && event.spec.form === 'single') { next.inventory = [...(next.inventory ?? []), { ...createInventoryItem(id, event.item, event.spec, id, event.qty), note: event.note }]; handed.add(id); }
    else {
      for (let i = 0; i < event.qty; i++) {
        const itemId = event.qty === 1 ? id : `${id}-${i}`;
        next.inventory = [...(next.inventory ?? []), { ...createInventoryItem(itemId, event.item, event.spec, itemId), note: event.note }];
        given.add(itemId); handed.add(itemId);
      }
    }
  }
  next = applyUnitChanges(next, proposal.events.filter((event) => !isNew(event)), new Map(), proposal.id, registry, unitSetContext);
  const reforged = new Set<string>(), learned = new Set<string>();
  for (const [index, event] of proposal.events.entries()) {
    if (event.kind === 'learn' || event.kind === 'bless' || event.kind === 'unbless' || event.kind === 'affect' || event.kind === 'unaffect') {
      if (!isNew(event)) next.storage = applyUnitEffect(next.storage!, event, index, proposal.id, registry, learned);
    } else if (event.kind === 'reforge') {
      if (reforged.has(event.id)) throw new Error('同一回复请合并对同一实物的改造');
      reforged.add(event.id);
      // 改造道具时写的武器词条换成对应道具，形态不变。
      const target = next.inventory?.find((i) => i.id === event.id)?.mechanics;
      const spec = target?.kind === 'item' && event.spec.kind === 'weapon' ? weaponItemSpecification(event.spec, target.value.recipe.form === 'single' ? 'single' : target.value.recipe.form === 'charged' ? 'charged' : undefined, notices) : event.spec;
      next = prepareInventoryTransaction(next, { kind: 'reforge', id: `reforge:${proposal.id}:${index}`, expectedRevision: next.factRevision ?? 0, itemId: event.id, name: event.name, spec });
    }
  }
  records = next.storage!;
  let roster: Combatant[] = (next.rosterIds ?? []).map((id) => records.find((r) => r.id === id)).filter((r): r is UnitRecord => !!r && r.hp > 0 && !r.retired).map((r) => materializeUnitRecord(r, registry));
  const newDeploys: string[] = [];
  let spawnedGear = false;
  for (const [index, event] of proposal.events.entries()) {
    if (event.kind === 'deploy') { if (isNew(event)) newDeploys.push(event.id); else roster = deployUnitRecord(records, roster, event.id, registry); }
    else if (event.kind === 'spawn') {
      for (let i = 0; i < event.count; i++) {
        const id = newUnitId(proposal.id, index, i);
        if (records.some((r) => r.id === id)) throw new Error('新单位身份已存在');
        const unit = generateUnit(spawnInput(event), { registry, seed: id, skillModel: 'skills-v4' }).unit;
        unit.id = id;
        prepareSkillModel(unit,V29_OVERFLOW_D20); prepareCombatModel(unit,V29_OVERFLOW_D20); upgradeCombatSkills(unit); prepareItemModel(unit,V29_OVERFLOW_D20);prepareTraitLevelModel(unit,V29_OVERFLOW_D20); applySpawnWound(unit, event);
        records.push(unitRecordFromCombatant(unit, undefined, { sourceId: proposal.id }));
        if (unit.hp > 0 && !event.archiveOnly) roster.push(materializeUnitRecord(records.at(-1)!, registry));
        // 随身道具每张卡各一套，归这张卡；佩戴、充能道具装上（编队一件即整卡配发），一次性道具开战时随身携带。
        for (const [n, entry] of (event.items ?? []).entries()) {
          const itemId = `spawn-item-${proposal.id}-${index}-${i}-${n}`;
          if (!entry.spec) { next.inventory = [...(next.inventory ?? []), { id: itemId, name: entry.name, qty: entry.qty, lootType: 'misc', assignedTo: id }]; continue; }
          if (entry.spec.form === 'single') { next.inventory = [...(next.inventory ?? []), { ...createInventoryItem(itemId, entry.name, entry.spec, itemId, entry.qty), assignedTo: id }]; continue; }
          const pieces = unit.scale === 'hero' ? entry.qty : 1;
          if (pieces < entry.qty && i === 0) notices.push(`${event.name}是编队，佩戴、充能道具一件就是整张单位卡的配发，「${entry.name}」按每卡1件建档`);
          for (let piece = 0; piece < pieces; piece++) {
            const pieceId = pieces === 1 ? itemId : `${itemId}-${piece}`;
            next.inventory = [...(next.inventory ?? []), { ...createInventoryItem(pieceId, entry.name, entry.spec, pieceId), assignedTo: id, equippedTo: { unitId: id, slot: 'gear' } }];
          }
          spawnedGear = true;
        }
      }
    } else if (event.kind === 'field') { next.field = event.env; next.lighting = event.light ?? (event.env === 'night' ? 'night' : 'day'); }
    else if (!['unit-set', 'unit-update', 'take', 'add', 'give', 'reforge', 'learn', 'bless', 'unbless', 'affect', 'unaffect'].includes(event.kind)) throw new Error('不支持此类正文写回');
  }
  next.schemaVersion = PANEL_SAVE_SCHEMA_VERSION;
  next.storage = records;
  // 新单位装上的佩戴、充能道具立即投影进档案，开战时随单位生效。
  if (spawnedGear) { next = prepareInventoryState(next) as NarrativeSave; records = next.storage!; }
  next.rosterIds = [...new Set(roster.map((u) => u.id))];
  if (fresh.created.size) next = applyToNewUnits(next, proposal.events, fresh, proposal.id, registry, newDeploys, unitSetContext);
  // Apply explicit recipients after this batch's new units exist. The given
  // items keep their original identity and are never created a second time.
  for (const [itemId, unitId] of directGives) {
    const item = next.inventory?.find(i => i.id === itemId), record = next.storage?.find(r => r.id === unitId);
    if (!item || !record) throw new Error('add 的接收单位或新物品不存在');
    if (item.assignedTo && item.assignedTo !== unitId || item.equippedTo && item.equippedTo.unitId !== unitId) throw new Error('add 的接收单位与同批物品分配冲突');
    item.assignedTo = unitId;
    handed.delete(itemId); // Already owned: items lists count it as held instead of creating it again.
    if (item.mechanics?.kind === 'item' && item.mechanics.value.recipe.form !== 'single') item.equippedTo = { unitId, slot: 'gear' };
  }
  if (directGives.size) next = prepareInventoryState(next) as NarrativeSave;
  // 不同接收数量可分写多条give：先核对同一来源的总支出，避免整件移交后又从新主人扣回。
  const transferTotals = new Map<string, number>();
  for (const event of proposal.events) {
    if (event.kind !== 'give') continue;
    const total = (transferTotals.get(event.id) ?? 0) + event.qty * new Set(event.to ?? [undefined]).size;
    const item = next.inventory?.find(item => item.id === event.id);
    if (!Number.isSafeInteger(total) || !item || total > item.qty) throw new Error('同一实物的转移总数量超出库存');
    transferTotals.set(event.id, total);
  }
  // 显式转移在新单位建档后执行，保留实物与冻结属性，不额外发放。
  for (const [index, event] of proposal.events.entries()) {
    if (event.kind !== 'give') continue;
    next = prepareInventoryTransaction(next, { kind: 'transfer', id: `give:${proposal.id}:${index}`, expectedRevision: next.factRevision ?? 0, itemId: event.id, unitIds: event.to, qty: event.qty });
  }
  // 同批分配整叠后再扣取，标签前后顺序一致；允许从任一持有者的拆分份额扣除。
  for (const [index, event] of proposal.events.entries()) {
    if (event.kind === 'take' && givenStacks.has(event.id)) take(event, index);
  }
  const transferred = new Set(proposal.events.flatMap(event => event.kind === 'give' ? [event.id] : []));
  for (const [unitId, patch] of deferredEquipment) {
    next = applyUnitSet(next, unitId, patch, proposal.id, { given, notices, transferred });
  }
  // unit_set 的 items 最后交出：此时同一回复 add 的已入库，新建单位也已建档。
  const handovers: HandOver[] = [...proposal.events.entries()].flatMap(([index, event]) => event.kind === 'unit-set' && event.items?.length ? [{ unitId: event.id, items: event.items, index }] : []);
  for (const [unitId, items] of fresh.items) handovers.push({ unitId, items, index: proposal.events.length + handovers.length });
  next = handOverItems(next, handovers, { proposalId: proposal.id, given: handed, notices });
  const deployed = next.rosterIds ?? [];
  const oldDeployedAlive = (save.storage ?? []).filter(r=>(save.rosterIds ?? []).includes(r.id)&&r.hp>0&&!r.retired).length;
  if (deployed.length > MAX_SCENE_UNITS && (replacesRoster || deployed.length > oldDeployedAlive)) throw Error(`本场参战单位卡上限${MAX_SCENE_UNITS}，整批未应用`);
  next.factRevision = (save.factRevision ?? 0) + 1;
  next.proposals = [...(save.proposals ?? []).filter((p) => p.id !== proposal.id), { ...structuredClone(proposal), status: 'committed', reason: undefined,
    ...(notices.length ? { notices: [...notices, ...proposal.notices ?? []] } : {}) }];
  return prepareNarrativeIds(next);
}

/** 只找原批次已经存在的出场单位，不重做生成/治疗/奖励。 */
export function narrativeDeploymentIds(save: NarrativeSave, proposalId: string): string[] {
  const selected = save.proposals?.find((p) => p.id === proposalId);
  const committed = selected && save.proposals?.find((p) => p.sourceKey === selected.sourceKey && p.status === 'committed');
  if (!committed) return [];
  const ids = committed.events.flatMap((event, index) => event.kind === 'deploy' ? [event.id] : event.kind === 'spawn' && !event.archiveOnly
    ? Array.from({ length: event.count }, (_, n) => newUnitId(committed.id, index, n)) : []);
  return [...new Set(ids)].filter((id) => save.storage?.some((r) => r.id === id && r.hp > 0 && !r.retired && r.status !== 'dead' && r.status !== 'dying'));
}
/** 已有本批全部单位但夹带旧单位时，也应允许从历史记录修复名单。 */
export function needsNarrativeDeploymentRestore(save: NarrativeSave, proposalId: string): boolean {
  const ids = narrativeDeploymentIds(save, proposalId), current = new Set(save.rosterIds ?? []);
  return ids.length > 0 && (ids.length !== current.size || ids.some((id) => !current.has(id)));
}
export function restoreNarrativeDeployment(save: NarrativeSave, proposalId: string): NarrativeSave {
  if (save.battle && !(save.committedOutcomeIds ?? []).includes(`${save.battle.kind}:${String(save.battle.snap.seed)}`)) throw Error('请先结束并结算当前战斗');
  const ids = narrativeDeploymentIds(save, proposalId);
  if (!ids.length) throw Error('原批次没有仍可参战的已建档单位');
  assertNarrativeCapacity(save, ids.map((id) => ({ kind: 'deploy', id, raw: '' })));
  const rosterIds = ids, previous = save.rosterIds ?? [];
  const changed = rosterIds.length !== previous.length || rosterIds.some((id, index) => id !== previous[index]);
  return { ...save, schemaVersion: PANEL_SAVE_SCHEMA_VERSION, rosterIds, factRevision: (save.factRevision ?? 0) + Number(changed) };
}
