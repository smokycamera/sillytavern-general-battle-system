import type { PromptSettings } from './prompt-settings.js';
import { PANEL_SAVE_SCHEMA_VERSION, learnUnitRecord } from './unit-state.js';
import { generateUnit, grantTraitSource, revokeTraitSource, traitRegistry, resolveTraitId, type Combatant, type GenerateInput } from '../../engine/src/index.js';
import { deployUnitRecord, materializeUnitRecord, unitRecordFromCombatant, updateUnitRecord, type UnitRecord } from './unit-state.js';
import { parseProtocol, protocolExcerpt } from './protocol.js';
import type { Suggestion } from './tags.js';
import { createInventoryItem, prepareInventoryState, prepareInventoryTransaction, type InventoryItem } from './inventory-state.js';
import { assertNarrativeCapacity } from './narrative-limits.js';
import { applyUnitSet } from './unit-set.js';

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
  originalText?: string;
}
export interface NarrativeSave {
  reports?: import('./battle-reports.js').BattleReport[];
  activeBattleStart?: import('./report-history.js').BattleStart;
  deletedReport?: import('./report-history.js').DeletedReport;
  deletedReportIds?: string[];
  promptSettings?: PromptSettings;
  schemaVersion?: number;
  storage?: UnitRecord[];
  rosterIds?: string[];
  storySync?: boolean;
  factRevision?: number;
  proposals?: NarrativeProposal[];
  /** 删除记录只移除可见正文副本；提交来源键仍防止同一消息重复入账。 */
  committedNarrativeSources?: string[];
  deletedNarrativeReceipts?: string[];
  field?: string;
  lighting?: 'day' | 'night';
  inventory?: InventoryItem[];
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
    unitVersions: Object.fromEntries((save.storage ?? []).map((r) => [r.id, r.revision ?? 1])), complete: false };
}
/** 非鉴权散列，仅用于删除后的重复扫描去重；提交守卫使用完整来源键。 */
export function narrativeReceiptKey(proposal: NarrativeProposal): string {
  const value = JSON.stringify([proposal.sourceKey, proposal.source.swipeId, proposal.canonical || proposal.source.text]);
  const state = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  for (let i = 0; i < value.length; i++) for (let n = 0; n < state.length; n++) state[n] = Math.imul(state[n]! ^ (value.charCodeAt(i) + n), [16777619, 2246822519, 3266489917, 668265263][n]!);
  return state.map((n) => (n >>> 0).toString(16).padStart(8, '0')).join('');
}
export function compactNarrativeSources(save: NarrativeSave): NarrativeSave {
  return { ...save, ...(Array.isArray(save.proposals) ? { proposals: save.proposals.map((p) => ({ ...p, source: { ...p.source, text: protocolExcerpt(p.source.text) },
    ...(p.originalText !== undefined ? { originalText: protocolExcerpt(p.originalText) } : {}) })) } : {}) };
}
export function deleteNarrativeRecords(save: NarrativeSave, ids?: string[]): NarrativeSave {
  const removed = (save.proposals ?? []).filter((p) => ids ? ids.includes(p.id) : ['committed', 'rejected', 'stale'].includes(p.status));
  return { ...save, proposals: (save.proposals ?? []).filter((p) => !removed.includes(p)),
    committedNarrativeSources: [...new Set([...(save.committedNarrativeSources ?? []), ...removed.filter((p) => p.status === 'committed').map((p) => p.sourceKey)])],
    deletedNarrativeReceipts: [...new Set([...(save.deletedNarrativeReceipts ?? []), ...removed.map(narrativeReceiptKey)])] };
}
export function proposalFromMessage(source: MessageEnvelope, expected?: GenerationBinding): NarrativeProposal | undefined {
  const parsed = parseProtocol(source.text);
  if (!parsed.events.length && !parsed.errors.length) return undefined;
  const trusted = source.role === 'assistant' && source.complete && !!source.messageId && !!source.swipeId && (!expected?.messageId || expected.messageId === source.messageId) && source.generationId && source.generationId === expected?.id && expected.complete && namespaceOf(source) === expected.namespace;
  return {
    id: crypto.randomUUID(), source: { ...structuredClone(source), text: protocolExcerpt(source.text) }, sourceKey: messageSourceKey(source),
    canonical: parsed.canonical, events: parsed.events, expected: expected ? structuredClone(expected) : undefined,
    status: parsed.errors.length ? 'unresolved' : trusted ? 'pending' : 'legacy',
    notices: parsed.warnings,
    reason: parsed.errors.length ? '已识别' + parsed.events.length + '项，待补全：' + parsed.errors.join('；')
      : (!trusted ? !source.complete ? '正文尚未确认生成完成，等待完整消息后刷新' : '无法确定原消息身份，请重新读取或核对来源' : undefined),
  };
}

function spawnInput(event: Extract<Suggestion, { kind: 'spawn' }>): GenerateInput {
  const registry = traitRegistry();
  // 兼容更新前已保存的候选：未知特质不会令建档再次失败。
  const traits = [...new Set((event.traits ?? []).map((name) => resolveTraitId(name, registry)).filter((id): id is string => !!id))];
  return {
    rulesVersion: 'v2', body: event.body, mount: event.mount, speedTier: event.speedTier, quality: event.quality, shield: event.shield,
    hp: event.hp, hpMax: event.hpMax,
    name: event.name, scale: event.scale ?? 'hero', archetype: event.archetype, level: event.level, side: event.side ?? 'enemy',
    traits: traits as string[], weaponName: event.weaponName ?? event.weapon, weaponClass: event.weaponClass,
    bonuses: event.bonuses, weaponBonuses: event.weaponBonuses, sidearmBonuses: event.weapon2Bonuses, armorBonuses: event.armorBonuses,
    weaponLevel: event.weaponLevel, weaponStabilized: event.weaponStabilized, reserves: event.reserves, armorProfile: event.armorProfile, sidearmName: event.weapon2Name, sidearmClass: event.weapon2Class, sidearmLevel: event.weapon2Level,
    armorName: event.armorName ?? event.armor, armorTier: event.armorTier, armorLevel: event.armorLevel,
    abilityBlueprints: event.skills?.map((s) => ({ id: s.blueprintId, level: s.level, name: s.name, bonuses: s.bonuses })),
  };
}

/** 整包准备与校验；调用方持久化成功后才替换当前事实。 */
export function prepareNarrativeTransaction(save: NarrativeSave, proposal: NarrativeProposal, namespace: string, manual = false): NarrativeSave {
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
  if (!manual && expected.manualOnly) throw new Error('此消息需要预览确认后提交');
  if (!manual && (!save.storySync || proposal.events.some((e) => !['unit-set', 'unit-update', 'deploy'].includes(e.kind)))) throw new Error('此类变更需人工审查');
  assertNarrativeCapacity(save, proposal.events);
  let next = structuredClone(save);
  const registry = traitRegistry();
  let records = next.storage ?? [];
  const changed = new Set<string>();
  for (const event of proposal.events) {
    if (event.kind !== 'unit-set' && event.kind !== 'unit-update' && event.kind !== 'deploy' && event.kind !== 'bless' && event.kind !== 'unbless' && event.kind !== 'affect' && event.kind !== 'unaffect' && event.kind !== 'learn') continue;
    const record = records.find((r) => r.id === event.id);
    if (!record || !event.id || expected.unitVersions[event.id] !== (record.revision ?? 1)) throw new Error(`档案 ${event.id} 缺失或版本过期`);
    if (event.kind === 'unit-update' || event.kind === 'unit-set') {
      if (changed.has(event.id)) throw new Error('同一回复不能多次更新同一档案，请合并为一个绝对更新');
      changed.add(event.id);
    }
  }
  // 顺序固定：更新全部档案，再部署。后续任一步失败只丢弃此候选副本。
  for (const event of proposal.events) {
    if (event.kind !== 'unit-update') continue;
    records = records.map((r) => r.id === event.id ? updateUnitRecord(r, event, registry, proposal.id) : r);
  }
  next.storage = records;
  for (const event of proposal.events) if (event.kind === 'unit-set') next = applyUnitSet(next,event.id,event.data,proposal.id);
  let newEquipment = 0;
  const reforged = new Set<string>(), learned = new Set<string>();
  for (const [index, event] of proposal.events.entries()) {
    if (event.kind === 'learn') {
      if (learned.has(event.id)) throw new Error('同一回复请合并对同一档案的技能学习');
      learned.add(event.id);
      next.storage = next.storage!.map((record) => record.id === event.id ? learnUnitRecord(record, event.skills.map((s) => ({ id: s.blueprintId, level: s.level, name: s.name, bonuses: s.bonuses })), registry, `learn:${proposal.id}:${index}`) : record);
    } else if (event.kind === 'bless' || event.kind === 'unbless' || event.kind === 'affect' || event.kind === 'unaffect') {
      const record: UnitRecord = next.storage!.find((r) => r.id === event.id)!;
      if (record.retired || record.hp <= 0 || record.status === 'dead') throw new Error('不能通过效果来源复活阵亡或解散档案');
      const unit = materializeUnitRecord(record, registry);
      if (event.kind === 'bless') grantTraitSource(unit, { id: `bless:${proposal.id}:${index}`, name: event.name, kind: 'blessing', traitIds: event.traitIds, duration: event.duration });
      else if (event.kind === 'affect') grantTraitSource(unit, { id: `affect:${proposal.id}:${index}`, name: event.name, kind: 'effect', traitIds: [], conditionIds: event.conditionIds, duration: event.duration });
      else {
        const kind = unit.traitSources?.find((s) => s.id === event.sourceId)?.kind;
        if (!kind || kind === 'equipment' || event.kind === 'unbless' && kind !== 'blessing') throw new Error('只能解除本单位的明确剧情效果来源');
        revokeTraitSource(unit, event.sourceId);
      }
      next.storage = next.storage!.map((r) => r.id === record.id ? unitRecordFromCombatant(unit, record, { sourceId: proposal.id, kind: 'update' }) : r);
    } else if (event.kind === 'take') {
      next = prepareInventoryState(next);
      const item = next.inventory?.find((i) => i.id === event.id);
      if (!item || item.qty < event.qty) throw new Error('物品不存在或移除数量超出库存');
      if (item.equippedTo) next = prepareInventoryTransaction(next, { kind: 'unequip', id: 'take-unequip:' + proposal.id + ':' + index, expectedRevision: next.factRevision ?? 0, ...item.equippedTo });
      next = prepareInventoryTransaction(next, { kind: 'discard', id: 'take:' + proposal.id + ':' + index, expectedRevision: next.factRevision ?? 0, itemId: event.id, qty: event.qty });
    } else if (event.kind === 'give') {
      const id = `loot-${proposal.id}-${index}`;
      if (!event.spec) next.inventory = [...(next.inventory ?? []), { id, name: event.item, qty: event.qty, lootType: event.lootType, note: event.note }];
      else if (event.spec.kind === 'consumable') next.inventory = [...(next.inventory ?? []), { ...createInventoryItem(id, event.item, event.spec, id, event.qty), note: event.note }];
      else {
        if ((newEquipment += event.qty) > 64) throw new Error('单批机械装备最多64件，请拆分');
        for (let i = 0; i < event.qty; i++) {
          const itemId = event.qty === 1 ? id : `${id}-${i}`;
          next.inventory = [...(next.inventory ?? []), { ...createInventoryItem(itemId, event.item, event.spec, itemId), note: event.note }];
        }
      }
    } else if (event.kind === 'reforge') {
      if (reforged.has(event.id)) throw new Error('同一回复请合并对同一装备的改造');
      reforged.add(event.id);
      next = prepareInventoryTransaction(next, { kind: 'reforge', id: `reforge:${proposal.id}:${index}`, expectedRevision: next.factRevision ?? 0, itemId: event.id, name: event.name, spec: event.spec });
    }
  }
  records = next.storage!;
  let roster: Combatant[] = (next.rosterIds ?? []).map((id) => records.find((r) => r.id === id)).filter((r): r is UnitRecord => !!r && r.hp > 0 && !r.retired).map((r) => materializeUnitRecord(r, registry));
  for (const [index, event] of proposal.events.entries()) {
    if (event.kind === 'deploy') roster = deployUnitRecord(records, roster, event.id, registry);
    else if (event.kind === 'spawn') {
      for (let i = 0; i < event.count; i++) {
        const id = `unit-${proposal.id}-${index}-${i}`;
        if (records.some((r) => r.id === id)) throw new Error('新单位身份已存在');
        const unit = generateUnit(spawnInput(event), { registry, seed: id }).unit;
        unit.id = id;
        records.push(unitRecordFromCombatant(unit, undefined, { sourceId: proposal.id }));
        if (unit.hp > 0) roster.push(materializeUnitRecord(records.at(-1)!, registry));
      }
    } else if (event.kind === 'field') { next.field = event.env; next.lighting = event.light ?? (event.env === 'night' ? 'night' : 'day'); }
    else if (!['unit-set', 'unit-update', 'take', 'give', 'reforge', 'learn', 'bless', 'unbless', 'affect', 'unaffect'].includes(event.kind)) throw new Error('不支持此类正文写回');
  }
  next.schemaVersion = PANEL_SAVE_SCHEMA_VERSION;
  next.storage = records;
  next.rosterIds = [...new Set(roster.map((u) => u.id))];
  const oldDeployedAlive = (save.storage ?? []).filter(r=>(save.rosterIds ?? []).includes(r.id)&&r.hp>0&&!r.retired).length;
  if (next.rosterIds.length > 32 && next.rosterIds.length > oldDeployedAlive) throw Error('本场参战单位卡上限32，整批未应用');
  next.factRevision = (save.factRevision ?? 0) + 1;
  next.proposals = [...(save.proposals ?? []).filter((p) => p.id !== proposal.id), { ...structuredClone(proposal), status: 'committed', reason: undefined }];
  return next;
}

/** 只找原批次已经存在的出场单位，不重做生成/治疗/奖励。 */
export function narrativeDeploymentIds(save: NarrativeSave, proposalId: string): string[] {
  const selected = save.proposals?.find((p) => p.id === proposalId);
  const committed = selected && save.proposals?.find((p) => p.sourceKey === selected.sourceKey && p.status === 'committed');
  if (!committed) return [];
  const ids = committed.events.flatMap((event, index) => event.kind === 'deploy' ? [event.id] : event.kind === 'spawn'
    ? Array.from({ length: event.count }, (_, n) => `unit-${committed.id}-${index}-${n}`) : []);
  return [...new Set(ids)].filter((id) => save.storage?.some((r) => r.id === id && r.hp > 0 && !r.retired && r.status !== 'dead' && r.status !== 'dying'));
}
export function restoreNarrativeDeployment(save: NarrativeSave, proposalId: string): NarrativeSave {
  if (save.battle && !(save.committedOutcomeIds ?? []).includes(`${save.battle.kind}:${String(save.battle.snap.seed)}`)) throw Error('请先结束并结算当前战斗');
  const ids = narrativeDeploymentIds(save, proposalId);
  if (!ids.length) throw Error('原批次没有仍可参战的已建档单位');
  assertNarrativeCapacity(save, ids.map((id) => ({ kind: 'deploy', id, raw: '' })));
  const rosterIds = [...new Set([...(save.rosterIds ?? []), ...ids])];
  return { ...save, schemaVersion: PANEL_SAVE_SCHEMA_VERSION, rosterIds, factRevision: (save.factRevision ?? 0) + Number(rosterIds.length !== (save.rosterIds ?? []).length) };
}
