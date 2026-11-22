import { ui } from './ui-language.js';
import { batchWeapons, protectionGroups } from '../../engine/src/equipment-batches.js';
import { rideEditor } from './ride-editor.js';
import { platformUnits } from './platform-records.js';
import { V34_OVERFLOW_D20 } from '../../engine/src/rules.js';
import { equipmentStep } from '../../engine/src/numeric-model.js';
import { BOUNDED_BLAST_MODEL } from '../../engine/src/artillery-model.js';
import { displayNumber } from '../../engine/src/display-number.js';
import { SHIELD_CLASSES, classMismatchHint } from '../../engine/src/data/weapons.js';
import { shieldClass, energyShieldPool, energyShieldRecharge, shieldPlatformScale, energyOverloadThreshold } from '../../engine/src/arms.js';
import { instanceVarianceLabel } from '../../engine/src/instance-variance.js';
import { randomId } from '../../host/src/browser-compat.js';
import { equipmentLoadLabel } from '../../engine/src/body.js';
import { enhancementLabel, bonusMultiplier } from '../../engine/src/enhancements.js';
import { gearItem, ITEM_FORM_NAMES, itemSpecText, historicalRecoveryItem, historicalWornItem, type EquipmentSlot } from '../../engine/src/items.js';
import { itemValueSummary, itemPassiveSummary, itemEffectRows, overshadowedGear } from './item-description.js';
import { promptSelected, type PromptSettings } from './prompt-settings.js';
import { gridWeaponRange } from '../../engine/src/small/weapon-range.js';
const ARMS_MODEL = 'arms-v2' as const;
import { TRAIT_MODEL } from '../../engine/src/trait-model.js';
import { formationWeaponRange } from '../../engine/src/melee.js';
import { armorTraitId, equipmentTraitIds, autoTraitLabel } from '../../engine/src/trait-sources.js';
import { weaponReloadTurns } from '../../engine/src/loadout.js';
import { equipmentDraft, equipmentFields, equipmentSpecification, captureEquipment, type EquipmentDraft } from './equipment-form.js';
import { ARMOR_TIERS } from './item-spec.js';
import { equipmentReason, effectiveProtection, abilityUsabilityReason, traitRegistry, WEAPON_CLASSES, type BodyKind, type ItemSpecification } from '../../engine/src/index.js';
import { materializeUnitRecord, type UnitRecord } from './unit-state.js';
import {anchoredWeapon,anchoredWeaponLabel,anchoredProtection,armorEffectLabel,shieldProtection,weaponAverageDamage} from '../../engine/src/power-anchors.js';
import { FALLEN_GEAR_FLOORS, prepareInventoryState, outOfBattleUse, type InventoryAction, type InventoryItem, type InventorySave } from './inventory-state.js';
import type { InventoryPreview } from './narrative-controller.js';
import type { PanelController } from './controller-port.js';
import { narrativeIds } from './narrative-ids.js';
import { storyEquipmentSpec, storyFields } from './story-spec.js';
import type { LootVaultAccess } from './panel-runtime.js';

const esc = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const slotNames = { primary: '武器', sidearm: '武器', armor: '护甲', shield: '盾牌', gear: '佩戴' };
const slotOrder: Record<EquipmentSlot, number> = { primary: 0, sidearm: 1, armor: 2, shield: 3, gear: 4 };
const bodyNames = { human: '普通人形', large: '大型生物', vehicle: '载具平台', giant: '巨型生物' };
const channelNames = { kinetic: '动能', thermal: '热能', arcane: '奥术' };
interface Draft extends EquipmentDraft {
  mode: 'create' | 'define' | 'reforge' | 'add' | 'discard'; itemId?: string; id: string; qty: string;
}
function newDraft(body = 'human'): Draft {
  return { ...equipmentDraft('weapon', body), mode: 'create', id: randomId(), qty: '1' };
}
export function itemDescription(item: InventoryItem): string {
  const mechanics = item.mechanics, variance = mechanics && mechanics.kind !== 'item' ? mechanics.value.recipe?.variance : undefined;
  const hint = mechanics && (mechanics.kind==='weapon'||mechanics.kind==='shield') ? classMismatchHint(item.name,mechanics.value.recipe?.mechanism ?? 'shield', ui) : '';
  const morale = mechanics && (mechanics.kind === 'armor' || mechanics.kind === 'shield') && mechanics.value.recipe?.bonuses?.morale
    ? ui('士气{value}', {value:signed(equipmentStep(mechanics.value.recipe,'morale'))}) : '';
  return [itemDescriptionBase(item), morale, hint, instanceVarianceLabel(variance, ui)].filter(Boolean).join(' · ');
}

function itemDescriptionBase(item: InventoryItem): string {
  const m = item.mechanics;
  if (!m) return ui('剧情物品 · 尚未设置战斗用途');
  if (m.kind === 'item') return itemValueSummary(m.value, item.name);
  const mechanism = m.kind === 'weapon' ? m.value.recipe?.mechanism ?? m.value.tags?.find(tag => tag.startsWith('mechanism:'))?.slice(10) : undefined;
  const kind = m.kind === 'shield' ? SHIELD_CLASSES[shieldClass({shield:m.value})].name
    : m.kind === 'armor' ? ARMOR_TIERS[m.value.tier] ?? '护甲'
    : (mechanism && WEAPON_CLASSES[mechanism]?.name) || '武器';
  const power = m.value.recipe?.power ?? (m.kind === 'shield' ? 3 : m.value.level ?? 5);
  const spec = ui('{kind}L{level}', { kind: ui(kind), level: power }) + enhancementLabel(m.value.recipe?.bonuses, ui);
  const load = ui('负重{value}', { value: displayNumber(m.value.load ?? 0) });
  if (m.kind === 'shield') {
    const shield = shieldClass({shield:m.value});
    const head = spec + ' · ' + load;
    if (shield === 'energy-shield') return head + ' · ' + ui('每人{pool}点护盾，每次激活回充{recharge}点 · 不能盾击、持盾固守或盾墙', {
      pool: displayNumber(energyShieldPool(power, shieldPlatformScale({shield:m.value}))), recharge: displayNumber(energyShieldRecharge(power)),
    });
    const extra = { buckler: '近战格挡+1，可配双手武器', shield: '可持盾固守、盾墙', 'tower-shield': m.value.recipe?.numericModel || m.value.recipe?.loadModel ? '远程命中−1，只配单手主武器' : '远程命中−1、移动−1，只配单手主武器' }[shield];
    const protection = (['kinetic', 'thermal', 'arcane'] as const).map(channel => displayNumber(shieldProtection({shield:m.value}, channel)));
    return [head, ui('覆盖{value}%', {value:Math.round(SHIELD_CLASSES[shield].coverage * 100)}), ui('防护{value}', {value:protection.join('/')}), ui(extra)].join(' · ');
  }
  if (m.kind === 'armor') {
    const unit = {armor:m.value, body:m.value.recipe?.size, damageModel:'wounds-v2' as const, armsModel:ARMS_MODEL};
    const trait = armorTraitId(m.value.tier);
    const protection = (['kinetic', 'thermal', 'arcane'] as const).map(channel =>
      ui('{label}{value}', {label:ui(channelNames[channel]), value:displayNumber(anchoredProtection(unit, channel))})).join(' / ');
    const defense = m.value.recipe?.bonuses?.defense ? ui('防御{value}', {value:signed(equipmentStep(m.value.recipe,'defense'))}) : '';
    const speed = m.value.recipe?.numericModel && m.value.recipe.bonuses?.speed ? equipmentStep(m.value.recipe,'speed') : 0;
    const limits = speed ? ui('移动{move}、先攻{initiative}', {move:signed(speed), initiative:signed(2*speed)}) : '';
    const traitLabel = trait ? ui(m.value.recipe?.numericModel || m.value.recipe?.loadModel ? autoTraitLabel(trait,m.value.recipe)
      : trait === 'super-heavy' ? '超重装甲（先攻−2）' : '重甲（先攻−1）') : '';
    return [spec, protection, armorEffectLabel(unit, ui), load, defense, limits, traitLabel ? ui('装备自动特质：{trait}', {trait:traitLabel}) : ''].filter(Boolean).join(' · ');
  }
  const w = m.value;
  return [
    spec, anchoredWeaponLabel(w,'wounds-v2',BOUNDED_BLAST_MODEL,V34_OVERFLOW_D20.sprayerDamageMultiplier,V34_OVERFLOW_D20.sprayerGroupDamageMultiplier,ui),
    w.recipe?.bonuses?.accuracy ? ui('精度{value}', {value:signed(equipmentStep(w.recipe,'accuracy'))}) : '',
    w.recipe?.bonuses?.defense ? ui('防御{value}', {value:signed(equipmentStep(w.recipe,'defense'))}) : '',
    ui(channelNames[w.channel ?? 'kinetic']), ui('格子射程{grid}／会战{formation}阵距', {grid:gridWeaponRange(w,true,ARMS_MODEL), formation:formationWeaponRange(w)}),
    w.hands === 0 ? ui('不占双手') : ui('{count}手', {count:w.hands ?? 1}), load,
    w.reload ? ui('装填{value}', {value:w.reload}) : '', w.tags?.includes('blast') ? ui('距离2命中−2') : '', w.recipe?.stabilized ? ui('行进稳定') : '',
  ].filter(Boolean).join(' · ');
}
function issuedGroups(record: UnitRecord): string {
  const unit=record.snapshot;
  if (!unit?.equipmentBatches?.length || unit.scale==='hero') return '';
  const groups=protectionGroups(unit,true);
  if (!groups.length) return '';
  return '<div class="loadout-slots">'+groups.map(g=>{
    const kit=[g.weapon?.name,g.armor?.name,g.shield?.name,...(g.gear ?? []).map(item=>item.name)].filter(Boolean);
    return '<span>'+esc(kit.join(' · ') || ui('未配装'))+' ×'+g.size+'</span>';
  }).join('')+'</div>';
}
function gearText(record: UnitRecord | undefined): string {
  const u = record?.snapshot ? { ...record.snapshot, armsModel: ARMS_MODEL, traitModel: TRAIT_MODEL } : undefined;
  if (!u) return ui('无装备资料');
  const protection = (['kinetic', 'thermal', 'arcane'] as const).map(channel => displayNumber(anchoredProtection(u, channel))).join('/');
  return [...batchWeapons(u).map(w => w.name+' '+anchoredWeaponLabel(w,u.damageModel,u.artilleryModel,u.sprayerDamageMultiplier,u.sprayerGroupDamageMultiplier,ui)+(w.recipe?.stabilized ? ' / '+ui('行进稳定') : '')),
    ...equipmentTraitIds(u).map(id => ui('装备自动特质：{trait}', {trait:ui(autoTraitLabel(id, u))})),
    ui('有效防护 {value}（动能/热能/奥术）', {value:protection}), armorEffectLabel(u, ui),
    ui(u.shield ? '携盾' : '无盾'),
    u.gear?.length ? ui('佩戴') + ' ' + u.gear.map((g) => g.name).join('、') : '',
    equipmentLoadLabel(u, ui)].filter(Boolean).join(' · ');
}
function gearComparison(before: UnitRecord | undefined, after: UnitRecord): string {
  const rows: string[] = [];
  const compare = (label: string, a: unknown, b: unknown) => {
    if (a !== b) rows.push(`<tr><td>${label}</td><td>${esc(a)}</td><td>${esc(b)}</td></tr>`);
  };
  const previous = before?.snapshot ? batchWeapons(before.snapshot) : [];
  const current = after.snapshot ? batchWeapons(after.snapshot) : [];
  for (const id of new Set([...previous,...current].map(w => w.id))) {
    const old = previous.find(w=>w.id===id), next = current.find(w=>w.id===id);
    if (JSON.stringify(old) === JSON.stringify(next)) continue;
    const label = (next ?? old)!.name;
    for (const [name, a, b] of [
      ['装备', old?.name ?? '空置', next?.name ?? '空置'],
      ['格子射程', old ? gridWeaponRange(old,true,ARMS_MODEL) : '—', next ? gridWeaponRange(next,true,ARMS_MODEL) : '—'],
      ['会战阵距', old ? formationWeaponRange(old) : '—', next ? formationWeaponRange(next) : '—'],
      ['装填回合', old ? weaponReloadTurns(old) : '—', next ? weaponReloadTurns(next) : '—'],
      ['穿透', anchoredWeapon(old,undefined,before?.snapshot?.damageModel)?.penetration ?? '—', anchoredWeapon(next,undefined,after.snapshot?.damageModel)?.penetration ?? '—'],
      ['命中杀伤',old?anchoredWeaponLabel(old,before?.snapshot?.damageModel):'—',next?anchoredWeaponLabel(next,after.snapshot?.damageModel):'—'],
    ]) compare(`${label} · ${name}`, a, b);
  }
  compare('护甲', before?.snapshot?.armor?.name ?? '空置', after.snapshot?.armor?.name ?? '空置');
  const shieldLabel = (record?: UnitRecord) => record?.snapshot?.shield ? '盾牌 L' + (record.snapshot.shield.recipe?.power ?? 3) : '空置';
  compare('盾牌', shieldLabel(before), shieldLabel(after));
  compare('佩戴', before?.snapshot?.gear?.map(g => g.name).join('、') || '无', after.snapshot?.gear?.map(g => g.name).join('、') || '无');
  for (const channel of ['kinetic', 'thermal', 'arcane'] as const) {
    compare(channelNames[channel] + '防护', before?.snapshot ? anchoredProtection(before.snapshot, channel) : '—', after.snapshot ? anchoredProtection(after.snapshot, channel) : '—');
    compare('盾牌 · ' + channelNames[channel] + '防护', before?.snapshot ? shieldProtection(before.snapshot, channel) : '—', after.snapshot ? shieldProtection(after.snapshot, channel) : '—');
  }
  compare('负重', before?.snapshot ? equipmentLoadLabel(before.snapshot) : '—', after.snapshot ? equipmentLoadLabel(after.snapshot) : '—');
  return rows.length ? `<table class="gear-comparison"><thead><tr><th>${ui("变化")}</th><th>${ui("当前")}</th><th>${ui("装备后")}</th></tr></thead><tbody>${rows.join('')}</tbody></table>` : '';
}
function previewHtml(preview: InventoryPreview): string {
  const intent = preview.intent;
  if (intent.kind === 'discard-many') {
    const names = new Map(preview.before.inventory?.map(item => [item.id, item.name]));
    return `<div class="inventory-preview" data-role="inventory-preview" role="alertdialog" aria-label="${ui("确认批量删除")}"><h3>删除已选的${intent.items.length}项物品？</h3>
      <div class="inventory-delete-list">${intent.items.map(item => `<div>${esc(names.get(item.itemId) ?? item.itemId)} ×${item.qty}</div>`).join('')}</div>
      <div class="row"><button class="danger" data-action="inventory-confirm">${ui("确认删除")}</button><button data-action="inventory-cancel">${ui("取消")}</button></div></div>`;
  }
  const changed = (preview.after.storage ?? []).filter((r) => (preview.before.storage ?? []).find((old) => old.id === r.id)?.revision !== r.revision);
  const itemId = 'itemId' in intent ? intent.itemId : undefined;
  const afterItem = preview.after.inventory?.find((i) => i.id === itemId);
  const beforeItem = preview.before.inventory?.find((i) => i.id === itemId);
  const labels: Record<InventoryAction['kind'], string> = { ride: '坐骑／载具', create: '新增物品', define: '设置物品效果', reforge: beforeItem?.mechanics?.kind === 'item' ? '改造道具' : '编辑装备', add: '增加数量', 'upgrade-budget': beforeItem?.mechanics?.kind === 'item' && beforeItem.mechanics.value.recipe.form === 'worn' ? '更新佩戴数值' : '升级治疗／屏障数值', assign: '调整归属', transfer: '转移物品', equip: '装备', unequip: '卸下装备', use: '使用物品', discard: '减少数量', 'discard-many': '批量删除', collect: '收缴道具' };
  const units = changed.map((record) => {
    const before = preview.before.storage?.find((r) => r.id === record.id);
    const registry = traitRegistry();
    const current = materializeUnitRecord(record, registry);
    const old = before ? materializeUnitRecord(before, registry) : undefined;
    const skills = current.abilities.map((a) => {
      const prior = old?.abilities.find((b) => b.id === a.id);
      const previousReason = prior && old ? abilityUsabilityReason(old, prior) ?? '可用' : '未拥有';
      const reason = abilityUsabilityReason(current, a) ?? '可用';
      return previousReason === reason ? '' : `${a.name}：${previousReason} → ${reason}`;
    }).filter(Boolean).join('；');
    const lifeChanged = !before || before.hp !== record.hp || before.base.hpMax !== record.base.hpMax;
    const levelChanged = !before || before.level !== record.level;
    const beforeGear = gearText(before), afterGear = gearText(record);
    return `<div class="inventory-difference"><b>${esc(record.name)}</b>${gearComparison(before, record)}${lifeChanged ? `<p>${record.scale === 'hero' ? '生命' : '人数'} ${before?.hp ?? '—'}/${before?.base.hpMax ?? '—'} → ${displayNumber(record.hp)}/${displayNumber(record.base.hpMax)}</p>` : ''}${levelChanged ? `<p>${ui("训练")} ${before?.level ?? '—'} → ${record.level}</p>` : ''}${skills ? `<p>${esc(skills)}</p>` : ''}${beforeGear !== afterGear ? `<details data-detail-id="gear-preview-${esc(record.id)}"><summary>${ui("查看完整配装")}</summary><p>${ui("当前：")}${esc(beforeGear)}<br>${ui("装备后：")}${esc(afterGear)}</p></details>` : ''}</div>`;
  }).join('');
  const created = intent.kind === 'define' ? preview.after.inventory?.find((i) => i.sourceItemId === intent.itemId && i.id !== intent.itemId && !preview.before.inventory?.some((old) => old.id === i.id)) : undefined;
  const selected = created ?? afterItem;
  const owner = afterItem?.assignedTo ? preview.after.storage?.find((r) => r.id === afterItem.assignedTo)?.name : '未分配';
  const itemChanges = beforeItem && afterItem ? [beforeItem.qty !== afterItem.qty ? `数量 ${beforeItem.qty} → ${afterItem.qty}` : '', beforeItem.assignedTo !== afterItem.assignedTo ? '归属：' + (owner ?? '未分配') : ''].filter(Boolean).join(' · ') : '';
  // 收缴：列出从该单位转入公共库存的物品。
  const collected = intent.kind === 'collect' ? (preview.before.inventory ?? []).filter((item) => item.assignedTo === intent.unitId && !preview.after.inventory?.find((i) => i.id === item.id)?.assignedTo) : [];
  return `<div class="inventory-preview" data-role="inventory-preview"><h3>${labels[intent.kind]} · 确认前预览</h3>
    ${collected.length ? `<div class="inventory-delete-list" data-role="collect-list"><p>${ui("转入公共库存：")}</p>${collected.map((item) => `<div>${esc(item.name)} ×${item.qty}</div>`).join('')}</div>` : ''}
    ${selected ? `<b>${esc(selected.name)}</b><p>${esc(itemDescription(selected))}</p>` : ''}
    ${(intent.kind === 'reforge' || intent.kind === 'upgrade-budget') && beforeItem ? `<details data-detail-id="item-before-edit"><summary>${ui("查看修改前属性")}</summary><p>${esc(itemDescription(beforeItem))}</p></details>` : ''}
    ${itemChanges ? `<div>${esc(itemChanges)}</div>` : ''}
    ${intent.kind === 'unequip' ? `<p>${ui("卸下")} ${intent.qty ?? beforeItem?.qty ?? 1} 件。</p>` : ''}${units}
    <div class="row"><button class="primary" data-action="inventory-confirm">${ui("确认")}${labels[intent.kind]}</button><button data-action="inventory-cancel">${ui("取消预览")}</button></div></div>`;
}

/** 只展示和提交意图；所有数据变化由常驻控制器校验、保存和发布。 */
export class InventoryPanel {
  private bulkDelete = false;
  private selectedItems = new Set<string>();
  private committing = false;
  private draft?: Draft;
  private preview?: InventoryPreview;
  private error?: string;
  private selectedUnit: string | undefined;
  private context = '';
  private lootOpen = false;
  private lootSelection = new Set<string>();
  private lootRetentionDraft?: string;
  private lootStatus?: string;
  constructor(private controller: PanelController, private canView: (record: UnitRecord) => boolean = () => true,
    private loot?: LootVaultAccess) {}
  private view(): InventorySave {
    const save = prepareInventoryState(this.controller.snapshot());
    const storage = save.storage?.filter(this.canView);
    return { ...save, storage, inventory: save.inventory?.filter((item) => !item.assignedTo || storage?.some((u) => u.id === item.assignedTo)) };
  }
  private currentItems(save: InventorySave): InventoryItem[] {
    return (save.inventory ?? []).filter((item) => item.qty > 0 && (!item.assignedTo || item.assignedTo === this.selectedUnit))
      .sort((a, b) => {
        const rank = (item: InventoryItem) => item.equippedTo ? 0 : item.assignedTo ? 1 : 2;
        return rank(a) - rank(b) || (a.equippedTo && b.equippedTo ? slotOrder[a.equippedTo.slot] - slotOrder[b.equippedTo.slot] : 0);
      });
  }
  visibleItemIds(): string[] { return this.currentItems(this.view()).map((item) => item.id); }
  private editorScroll = 0;
  private draw(): void {
    const root = document.getElementById('inventory-panel');
    if (root) {
      const open = new Set([...root.querySelectorAll<HTMLDetailsElement>('details[open][data-detail-id]')].map((d) => d.dataset.detailId));
      root.outerHTML = this.render();
      for (const detail of document.querySelectorAll<HTMLDetailsElement>('#inventory-panel details[data-detail-id]')) detail.open = open.has(detail.dataset.detailId);
    }
  }
  capture(target?: Element): void {
    if (target instanceof HTMLInputElement && target.dataset.role === 'inventory-loot-floors') this.lootRetentionDraft = target.value;
    if (!this.draft || target && !target.closest('#inventory-panel')) return;
    Object.assign(this.draft, captureEquipment('inventory', this.draft));
    const quantity = document.querySelector<HTMLInputElement>('[data-role="inventory-qty"]'); if (quantity) this.draft.qty = quantity.value;
  }
  handleChange(target: Element): boolean {
    if (!target.closest('#inventory-panel')) return false;
    if (target instanceof HTMLInputElement && target.dataset.role === 'inventory-loot-select') {
      const id = target.dataset.item!;
      if (target.checked) this.lootSelection.add(id); else this.lootSelection.delete(id);
      this.draw();
      document.querySelector<HTMLInputElement>(`[data-role="inventory-loot-select"][data-item="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
      return true;
    }
    if ((target as HTMLElement).dataset.role === 'inventory-select') {
      const input = target as HTMLInputElement;
      const item = this.currentItems(this.view()).find(item => item.id === input.dataset.item);
      if (this.bulkDelete && item && !item.equippedTo && !input.disabled) {
        if (input.checked) this.selectedItems.add(item.id); else this.selectedItems.delete(item.id);
        this.preview = undefined; this.error = undefined; this.draw();
      }
      return true;
    }
    this.capture(target);
    if ((target as HTMLElement).dataset.role === 'inventory-unit') {
      this.selectedItems.clear();
      this.selectedUnit = (target as HTMLSelectElement).value;
      if (this.draft?.itemId && !this.currentItems(this.view()).some(item => item.id === this.draft?.itemId)) this.draft = undefined;
    }
    this.preview = undefined; this.error = undefined;
    const role = (target as HTMLElement).dataset.role;
    if (role === 'inventory-kind' && this.draft) {
      if (this.draft.kind === 'weapon' && !Object.hasOwn(WEAPON_CLASSES, this.draft.mechanism)) this.draft.mechanism = Object.keys(WEAPON_CLASSES)[0]!;
      if (this.draft.kind === 'item' && !this.draft.effect) { this.draft.form = 'single'; this.draft.effect = 'buff治疗'; }
      this.draft.bonuses = undefined;
    }
    if (role === 'inventory-form' && this.draft) this.draft.bonuses = undefined;
    if (role === 'inventory-kind' || role === 'inventory-unit' || role === 'inventory-form') this.draw();
    else document.querySelector('[data-role="inventory-feedback"]')?.replaceChildren();
    return true;
  }
  private draftAction(): InventoryAction {
    const d = this.draft!;
    if (d.mode === 'add' || d.mode === 'discard') return { kind: d.mode, itemId: d.itemId!, qty: Number(d.qty) };
    const spec = equipmentSpecification(d);
    const name=d.name.trim() || (d.kind==='weapon'?WEAPON_CLASSES[d.mechanism]?.name:d.kind==='item'?d.effect.trim()||'道具':d.kind==='shield'?'盾牌':'护甲') || '物品';
    if (d.mode === 'define') return { kind: 'define', itemId: d.itemId!, spec };
    if (d.mode === 'reforge') return { kind: 'reforge', itemId: d.itemId!, name, spec };
    return { kind: 'create', itemId: `item:${d.id}`, name, spec, qty: Number(d.qty) };
  }
  private async commitPreview(preview: InventoryPreview): Promise<void> {
    const context = this.controller.inventoryContext(), shownPreview = this.preview;
    this.committing = true; this.draw();
    try {
      const receipt = await this.controller.commitInventoryPreview(preview);
      // A late acknowledgement must not clear another chat or a newly selected form.
      if (context !== this.controller.inventoryContext() || this.preview !== shownPreview) return;
      if (receipt.status === 'failed') throw new Error(receipt.error ?? '尚未保存，请重试');
      this.preview = undefined; this.draft = undefined;
      if (preview.intent.kind === 'discard-many') { this.bulkDelete = false; this.selectedItems.clear(); }
    } finally { this.committing = false; this.draw(); }
  }
  async handleAction(element: HTMLElement): Promise<boolean> {
    const action = element.dataset.action ?? '';
    if (!action.startsWith('inventory-')) return false;
    if (this.committing || element instanceof HTMLButtonElement && element.disabled) return true;
    if (action.startsWith('inventory-loot-')) { await this.handleLootAction(element); return true; }
    const actionContext = this.controller.inventoryContext();
    this.capture(); this.error = undefined;
    try {
      const item = this.view().inventory?.find((i) => i.id === element.dataset.item);
      if (action === 'inventory-bulk') {
        this.bulkDelete = true; this.selectedItems.clear(); this.preview = undefined; this.draft = undefined;
      } else if (action === 'inventory-bulk-cancel') {
        this.bulkDelete = false; this.selectedItems.clear(); this.preview = undefined;
      } else if (action === 'inventory-select-all') {
        const eligible = this.currentItems(this.view()).filter(item => !item.equippedTo);
        if (eligible.every(item => this.selectedItems.has(item.id))) this.selectedItems.clear();
        else this.selectedItems = new Set(eligible.map(item => item.id));
        this.preview = undefined;
      } else if (action === 'inventory-delete-selected') {
        const selected = this.currentItems(this.view()).filter(item => this.selectedItems.has(item.id));
        this.preview = this.controller.previewInventory({ kind: 'discard-many', items: selected.map(item => ({ itemId: item.id, qty: item.qty })) });
      } else if (action === 'inventory-new') { this.editorScroll = window.scrollY; this.draft = newDraft(this.view().storage?.find((r) => r.id === this.selectedUnit)?.snapshot?.body); this.preview = undefined; }
      else if (action === 'inventory-cancel') this.preview = undefined;
      else if (action === 'inventory-close-draft') { this.draft = undefined; this.preview = undefined; }
      else if (action === 'inventory-confirm') {
        if (!this.preview) throw new Error('请先预览');
        await this.commitPreview(this.preview);
      } else if (action === 'inventory-preview-draft') {
        if (!this.draft) throw new Error('请先填写规格');
        this.preview = this.controller.previewInventory(this.draftAction(), this.draft.id);
      } else if (action === 'inventory-add' || action === 'inventory-discard') {
        this.editorScroll = window.scrollY;
        if (!item) throw new Error('物品不存在');
        this.draft = { ...newDraft(), mode: action === 'inventory-add' ? 'add' : 'discard', itemId: item.id, name: item.name };
        this.preview = undefined;
      } else if (action === 'inventory-edit' || action === 'inventory-define') {
        this.editorScroll = window.scrollY;
        if (!item) throw new Error('物品不存在');
        const m = item.mechanics;
        const kind = m?.kind ?? (['weapon', 'armor'].includes(item.lootType) ? item.lootType : ['item', 'consumable', 'accessory', 'misc', 'material', 'quest'].includes(item.lootType) ? 'item' : 'weapon');
        this.draft = { ...newDraft(), ...equipmentDraft(kind, 'human', m, item.name), mode: action === 'inventory-edit' ? 'reforge' : 'define', itemId: item.id };
        this.preview = undefined;
      } else if (action === 'inventory-collect') {
        this.preview = this.controller.previewInventory({ kind: 'collect', unitId: element.dataset.id ?? '' });
      } else {
        if (!item) throw new Error('物品不存在');
        let intent: InventoryAction;
        if (action === 'inventory-assign') intent = { kind: 'assign', itemId: item.id, unitId: this.selectedUnit || undefined };
        else if (action === 'inventory-unassign') intent = { kind: 'assign', itemId: item.id };
        else if (action === 'inventory-equip') intent = { kind: 'equip', itemId: item.id, unitId: this.selectedUnit ?? '', slot: element.dataset.slot as EquipmentSlot, qty:Number(element.closest('.inventory-card')?.querySelector<HTMLInputElement>('[data-issue-qty]')?.value ?? item.qty) };
        else if (action === 'inventory-unequip') intent = { kind: 'unequip', unitId: item.equippedTo!.unitId, slot: item.equippedTo!.slot, itemId:item.id, qty:Number(element.closest('.inventory-card')?.querySelector<HTMLInputElement>('[data-issue-qty]')?.value ?? item.qty) };
        else if (action === 'inventory-use') intent = { kind: 'use', itemId: item.id, unitId: this.selectedUnit ?? '' };
        else if (action === 'inventory-upgrade-budget') intent = { kind: 'upgrade-budget', itemId: item.id };
        else if (action === 'inventory-delete') intent = { kind: 'discard', itemId: item.id, qty: item.qty };
        else throw new Error('未知库存操作');
        const preview = this.controller.previewInventory(intent);
        if (intent.kind === 'equip' || intent.kind === 'unequip') {
          this.preview = undefined;
          await this.commitPreview(preview);
        } else this.preview = preview;
      }
    } catch (error) {
      if (actionContext === this.controller.inventoryContext()) this.error = error instanceof Error ? error.message : String(error);
    }
    this.draw();
    if (actionContext !== this.controller.inventoryContext()) return true;
    if (['inventory-new', 'inventory-edit', 'inventory-define'].includes(action)) document.querySelector<HTMLInputElement>('[data-role="inventory-name"]')?.focus();
    if (action === 'inventory-add' || action === 'inventory-discard') document.querySelector<HTMLInputElement>('[data-role="inventory-qty"]')?.focus();
    if (action === 'inventory-close-draft' || action === 'inventory-confirm' && !this.draft && !this.error) { window.scrollTo(0, this.editorScroll); document.querySelector<HTMLButtonElement>('[data-action="inventory-new"]')?.focus({ preventScroll: true }); }
    if (this.preview || this.error) document.querySelector('[data-role="inventory-feedback"]')?.scrollIntoView({ block: 'nearest' });
    return true;
  }
  private async handleLootAction(element: HTMLElement): Promise<void> {
    if (!this.loot) return;
    const action = element.dataset.action;
    if (action === 'inventory-loot-open' || action === 'inventory-loot-close') {
      this.lootOpen = action === 'inventory-loot-open';
      this.lootStatus = undefined;
      this.lootSelection.clear();
      this.lootRetentionDraft = undefined;
      this.draw();
      document.querySelector<HTMLButtonElement>(`[data-action="inventory-loot-${this.lootOpen ? 'close' : 'open'}"]`)?.focus({ preventScroll: true });
      return;
    }
    if (!this.lootOpen || action !== 'inventory-loot-send' && action !== 'inventory-loot-delete' && action !== 'inventory-loot-retention') return;
    const context = this.controller.inventoryContext();
    const floors = this.lootRetentionDraft ?? document.querySelector<HTMLInputElement>('[data-role="inventory-loot-floors"]')?.value;
    this.committing = true;
    this.lootStatus = undefined;
    this.draw();
    try {
      const save = this.controller.snapshot(['fallenGear', 'narrativeIdState']);
      const floor = this.loot.floor();
      const selected = (save.fallenGear ?? []).filter(entry => entry.expiresAt > floor && this.lootSelection.has(entry.item.id));
      if (action === 'inventory-loot-send') {
        if (!selected.length) return;
        const { publicId } = narrativeIds(save);
        const text = [`【${ui('战利品库')}】`, ...selected.map(({ item }) => storyFields({
          id: item.id, gear: storyEquipmentSpec(item), qty: item.qty,
        }, publicId))].join('\n');
        const receipt = await this.loot.send(text);
        if (context !== this.controller.inventoryContext()) return;
        if (receipt.status === 'failed') throw Error(receipt.detail ?? '发送失败，可重试');
        this.lootStatus = receipt.status === 'unknown' ? '投递结果未知，请核对聊天后处理' : '已将所选装备放入聊天';
        this.lootSelection.clear();
      } else {
        if (action === 'inventory-loot-delete' && !selected.length) return;
        const receipt = action === 'inventory-loot-retention'
          ? await this.loot.setRetention(Number(floors))
          : await this.loot.remove(selected.map(entry => entry.item.id));
        if (context !== this.controller.inventoryContext()) return;
        if (receipt.status === 'failed') throw Error(receipt.error ?? '保存失败');
        this.lootStatus = action === 'inventory-loot-retention' ? '已保存暂存层数' : '已删除所选装备';
        if (action === 'inventory-loot-retention') this.lootRetentionDraft = undefined;
        else this.lootSelection.clear();
      }
    } catch (error) {
      if (context === this.controller.inventoryContext()) this.lootStatus = error instanceof Error ? error.message : String(error);
    } finally { this.committing = false; this.draw(); }
  }
  private renderLoot(loot: LootVaultAccess): string {
    const save = this.controller.snapshot(['fallenGear', 'fallenGearFloors', 'narrativeIdState']);
    const floor = loot.floor();
    const entries = (save.fallenGear ?? []).filter(entry => entry.expiresAt > floor);
    const present = new Set(entries.map(entry => entry.item.id));
    for (const id of this.lootSelection) if (!present.has(id)) this.lootSelection.delete(id);
    const { publicId } = narrativeIds(save);
    const busy = this.committing ? 'disabled' : '';
    const noSelection = this.committing || !this.lootSelection.size ? 'disabled' : '';
    const floors = this.lootRetentionDraft ?? save.fallenGearFloors ?? FALLEN_GEAR_FLOORS;
    const rows = entries.map(({ item, expiresAt }) => `<label class="inventory-card inventory-loot-row">
      <input type="checkbox" data-role="inventory-loot-select" data-item="${esc(item.id)}" ${this.lootSelection.has(item.id) ? 'checked' : ''} ${busy}>
      <span><strong>${esc(item.name)}</strong> <small class="sub">${esc(publicId(item.id))}</small> <span class="item-quantity">×${item.qty}</span>
      <small class="sub">${ui('剩余 {count} 层', { count: expiresAt - floor })}</small></span></label>`).join('');
    return `<section id="inventory-panel"><div class="inventory-title"><h2>${ui('战利品库')}</h2><button data-action="inventory-loot-close" ${busy}>${ui('返回配装')}</button></div>
      <p class="sub">${ui('用于临时保存阵亡和删除单位物品')}</p>
      <div class="row"><label>${ui('暂存层数')} <input data-role="inventory-loot-floors" type="number" min="1" step="1" value="${esc(floors)}" ${busy}></label>
        <button data-action="inventory-loot-retention" ${busy}>${ui('保存')}</button></div>
      <div class="item-actions"><button data-action="inventory-loot-send" ${noSelection}>${ui('发送所选')}</button>
        <button class="danger" data-action="inventory-loot-delete" ${noSelection}>${ui('删除所选')}</button></div>
      <div role="status">${this.lootStatus ? `<p class="sub">${esc(ui(this.lootStatus))}</p>` : ''}</div>
      ${rows ? `<div class="inventory-list">${rows}</div>` : `<p class="inventory-empty">${ui('暂无暂存装备')}</p>`}</section>`;
  }
  render(): string {
    const context = this.controller.inventoryContext();
    if (this.context !== context) { this.context = context; this.draft = undefined; this.preview = undefined; this.error = undefined; this.selectedUnit = undefined; this.bulkDelete = false; this.selectedItems.clear(); this.lootOpen = false; this.lootSelection.clear(); this.lootRetentionDraft = undefined; this.lootStatus = undefined; }
    if (this.loot && this.lootOpen) return this.renderLoot(this.loot);
    let save: InventorySave;
    try { save = this.view(); }
    catch (error) { return `<section id="inventory-panel"><h2>${ui("装备与物品")}</h2><p class="grid-reason">${esc(error)}</p></section>`; }
    const { publicId } = narrativeIds(save);
    const records = save.storage ?? [];
    if (this.selectedUnit === undefined || this.selectedUnit !== '' && !records.some(r => r.id === this.selectedUnit)) this.selectedUnit = records.find(r => r.side === 'ally' && !r.retired)?.id ?? '';
    const items = this.currentItems(save), current = records.find(r => r.id === this.selectedUnit), actor = current?.snapshot;
    const locked = !!save.battle && !(save.committedOutcomeIds ?? []).includes(`${save.battle.kind}:${String(save.battle.snap.seed)}`);
    const eligible = items.filter(item => !item.equippedTo);
    const eligibleIds = new Set(eligible.map(item => item.id));
    const removedSelection = [...this.selectedItems].some(id => !eligibleIds.has(id));
    if (removedSelection || locked) { this.selectedItems = new Set([...this.selectedItems].filter(id => !locked && eligibleIds.has(id))); if (this.preview?.intent.kind === 'discard-many') this.preview = undefined; }
    const allSelected = eligible.length > 0 && eligible.every(item => this.selectedItems.has(item.id));
    // 阵亡、撤离或解散的敌方单位身上剩余的道具可以收缴进公共库存。
    const collectible = !!current && current.side === 'enemy' && (current.status === 'dead' || current.status === 'fled' || current.hp <= 0 || !!current.retired)
      && items.some((item) => item.assignedTo === current.id && (!item.mechanics || item.mechanics.kind === 'item'));
    const d = this.draft, disabled = locked || this.committing ? 'disabled' : '';
    const select = (role: string, value: string, choices: [string, string][], disabled = false) => `<select data-role="inventory-${role}" ${disabled ? 'disabled' : ''}>${choices.map(([id, name]) => `<option value="${esc(id)}" ${id === value ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select>`;
    const feedback = `<div data-role="inventory-feedback" aria-live="polite">${this.error ? `<p class="grid-reason">${esc(ui(this.error))}</p>` : ''}${this.preview ? previewHtml(this.preview).replaceAll('data-action="inventory-confirm"', 'data-action="inventory-confirm"' + (this.committing ? ' disabled' : '')) : ''}</div>`;
    const card = (item: InventoryItem): string => {
      const m = item.mechanics, equipped = item.equippedTo, itemData = `data-item="${esc(item.id)}"`;
      const single = m?.kind === 'item' && m.value.recipe.form === 'single';
      const slot: EquipmentSlot | undefined = m?.kind === 'weapon' ? 'primary' : m?.kind === 'item' ? single ? undefined : 'gear' : m?.kind;
      const recommended = slot && {slot, reason: !actor ? '请先选择使用者' : equipmentReason(slot === 'gear' && m?.kind === 'item' ? { ...actor, gear: [...(actor.gear ?? []), gearItem(item.id,item.name,m.value)] } : { ...actor, [slot === 'primary' ? 'weapon' : slot]: m && m.kind !== 'item' ? m.value : undefined })};
      const details: string[] = [];
      if (m) details.push(`<button data-action="inventory-edit" ${itemData} ${disabled}>${ui(m.kind === 'item' ? '改造道具' : '编辑装备')}</button>`);
      if (!(m?.kind === 'weapon' && m.value.recipe?.mechanism === 'natural')) details.push(`<button data-action="inventory-add" ${itemData} ${disabled}>${ui("增加数量")}</button>`);
      if ((!equipped || item.batch) && !(m?.kind==='weapon' && m.value.recipe?.mechanism==='natural')) details.push(`<button data-action="inventory-discard" ${itemData} ${disabled}>${ui("减少数量")}</button>`);
      if (!m) details.push(`<button data-action="inventory-define" ${itemData} ${disabled}>${ui("设置物品效果")}</button>`);
      if (!equipped) {
        if (item.assignedTo && !(m?.kind==='weapon' && m.value.recipe?.mechanism==='natural')) details.push(`<button data-action="inventory-unassign" ${itemData} ${disabled}>${ui("放回公共库存")}</button>`);
        details.push(`<button class="danger" data-action="inventory-delete" ${itemData} ${disabled}>${ui("删除物品")}</button>`);
      }
      const stats: [string, string, string?][] = [];
      if (m?.kind === 'weapon') {
        const w = m.value, projected = anchoredWeapon(w, undefined, 'wounds-v2');
        const range = save.mode === 'mass' ? ui('{count}阵位', {count:formationWeaponRange(w)})
          : ui('{count}格', {count:gridWeaponRange(w,true,ARMS_MODEL)});
        stats.push(['伤害', projected ? String(weaponAverageDamage(projected, V34_OVERFLOW_D20.sprayerDamageMultiplier)) : '—'],
          ['穿透', displayNumber(projected?.penetration ?? w.penetration ?? 0)], ['射程', range], ['负重', displayNumber(w.load ?? 0)]);
      } else if (m?.kind === 'armor') {
        const unit = { armor: m.value, body: m.value.recipe?.size, damageModel:'wounds-v2' as const, armsModel: ARMS_MODEL };
        stats.push(['动能防护', displayNumber(anchoredProtection(unit, 'kinetic'))], ['热能防护', displayNumber(anchoredProtection(unit, 'thermal'))], ['奥术防护', displayNumber(anchoredProtection(unit, 'arcane'))], ['负重', displayNumber(m.value.load ?? 0)]);
      }
      if (m?.kind === 'item') stats.push(...itemEffectRows(m.value).map(row => [row.name, ui(row.actual), row.next ? ui('升L{level} {value}', {level:m.value.recipe.power + 1, value:ui(row.next)}) : undefined] as [string, string, string?]));
      const battleOnly = single && !outOfBattleUse(item);
      // 不叠加：同方向修正只取最高一件、同一特质只算一次，被盖过的效果在卡片上注明。
      const shadowed = equipped?.slot === 'gear' && actor ? overshadowedGear(actor, item.id) : [];
      return `<article class="inventory-card" data-inventory-id="${esc(item.id)}"><div class="inventory-card-heading"><div>${this.bulkDelete ? `<input type="checkbox" class="inventory-select" data-role="inventory-select" ${itemData} aria-label="选择${esc(item.name)}" ${this.selectedItems.has(item.id) ? 'checked' : ''} ${locked || equipped || this.committing ? 'disabled' : ''}>` : ''}<b>${esc(item.name)}</b><span class="sub">${esc(publicId(item.id))}</span><span class="item-quantity">×${item.qty}</span></div>${this.bulkDelete ? '' : `<label class="item-prompt"><input type="checkbox" data-role="prompt-item" data-id="${esc(item.id)}" ${promptSelected(save.promptSettings as PromptSettings | undefined, 'item', item.id) ? 'checked' : ''}><span>${ui("供剧情参考")}</span></label>`}</div>
        <div class="item-location">${equipped ? (equipped.slot === 'gear' ? ui('已装备') : ui(slotNames[equipped.slot]) + ' · ' + ui('已装备')) : ui(item.assignedTo ? '随身物品' : '公共库存')}${m?.kind === 'item' ? ' · ' + ui(ITEM_FORM_NAMES[m.value.recipe.form] + '道具') : ''}${m ? ' · ' + ui('等级{value}', {value:displayNumber(m.value.recipe?.power ?? 1)}) : ''}</div>
        ${shadowed.length ? `<p class="sub" data-role="gear-overshadowed">${ui("未生效：")}${esc(shadowed.join('、'))}${ui("（已被覆盖）")}</p>` : ''}
        ${stats.length && m?.kind === 'item' && m.value.passive?.traits.length ? '<p>' + esc(itemPassiveSummary({ traits: m.value.passive.traits }, undefined, false)) + '</p>' : ''}
        ${stats.length ? `<dl class="item-stats">${stats.map(([key, value, next]) => `<div><dt>${esc(ui(key))}</dt><dd>${esc(value)}${next ? '<br><small class="sub">' + esc(next) + '</small>' : ''}</dd></div>`).join('')}</dl>${m?.kind === 'item' && historicalWornItem(m.value) ? `<p class="sub">${ui("旧版数值，可预览更新。")}</p>` : ''}<details class="item-rules" data-detail-id="rules-${esc(item.id)}"><summary>${ui("查看完整属性")}</summary>${m?.kind === 'item' ? '<p>' + ui('配方：') + esc(itemSpecText(m.value.recipe)) + '</p>' : ''}<p>${esc(itemDescription(item))}</p>${m?.kind === 'item' && !m.value.passive?.actualEffects && m.value.passive?.bonuses?.speed ? `<p>${ui("旧版速度只加先攻；更新后增加移动。")}</p>` : ''}</details>` : `<p>${esc(itemDescription(item))}</p>`}
        ${item.batch && item.qty>1 && (equipped || recommended) ? `<label>${ui(equipped ? '卸下件数' : '配发件数')} <input data-issue-qty type="number" min="1" max="${item.qty}" value="${item.qty}"></label>` : ''}
        <div class="item-actions" ${this.bulkDelete ? 'hidden' : ''}>${equipped ? `<button class="primary" data-action="inventory-unequip" ${itemData} ${disabled}>${ui("卸下")}</button>` : recommended ? `<button class="primary" data-action="inventory-equip" ${itemData} data-slot="${recommended.slot}" ${locked || !actor || recommended.reason ? 'disabled' : ''}>${recommended.slot === 'gear' ? ui('佩戴') : ui('装备{kind}', {kind:ui(slotNames[recommended.slot])})}</button>${recommended.reason ? '<span class="grid-reason">' + esc(ui(recommended.reason)) + '</span>' : ''}` : ''}
        ${single ? `<button class="primary" data-action="inventory-use" ${itemData} title="${battleOnly ? ui('请在战场的行动列表中使用') : ''}" ${locked || !actor || battleOnly ? 'disabled' : ''}>${ui(battleOnly ? '战斗中使用' : '使用1件')}</button>` : ''}
        ${m?.kind === 'item' && (historicalRecoveryItem(m.value) || historicalWornItem(m.value)) ? `<button data-action="inventory-upgrade-budget" ${itemData} ${disabled}>${ui(m.value.recipe.form === 'worn' ? '更新佩戴数值' : '升级治疗／屏障数值')}</button>` : ''}
        ${!equipped && !item.assignedTo && actor ? `<button data-action="inventory-assign" ${itemData} ${disabled}>${ui("交给")}${esc(current!.name)}</button>` : ''}</div>
        ${!this.bulkDelete && details.length ? `<details class="inventory-more" data-detail-id="more-${esc(item.id)}"><summary>${ui("其他操作")}</summary><div class="row">${details.join('')}</div></details>` : ''}
        ${item.note ? `<details data-detail-id="note-${esc(item.id)}"><summary>${ui("备注")}</summary><p>${esc(item.note)}</p></details>` : ''}</article>`;
    };
    const groups = [
      { name: '已装备', items: items.filter(item => item.equippedTo) },
      { name: '随身物品', items: items.filter(item => item.assignedTo && !item.equippedTo) },
      { name: '公共库存', items: items.filter(item => !item.assignedTo) },
    ];
    return `<section id="inventory-panel"><div class="inventory-title"><div class="inventory-title-heading"><h2>${ui("装备与物品")} <small class="sub">${ui('{count}种物品', { count: items.length })}</small></h2>${this.loot ? `<button data-action="inventory-loot-open">${ui('战利品库')}</button>` : ''}</div><div class="inventory-title-actions">${this.bulkDelete ? `<button data-action="inventory-select-all" ${locked || !eligible.length || this.committing ? 'disabled' : ''}>${ui(allSelected ? '取消全选' : '全选')}</button><button class="danger" data-action="inventory-delete-selected" ${locked || !this.selectedItems.size || this.committing ? 'disabled' : ''}>${ui('删除（{count}）', { count: this.selectedItems.size })}</button><button data-action="inventory-bulk-cancel" ${this.committing ? 'disabled' : ''}>${ui("取消")}</button>` : `<button data-action="inventory-bulk" ${locked || !eligible.length ? 'disabled' : ''}>${ui("批量删除")}</button><button data-action="loadout-skills" data-id="${esc(current?.id ?? '')}" ${!actor || actor.rulesVersion !== 'v2' || current?.retired || current?.status === 'dead' || locked && actor.side !== 'ally' ? 'disabled' : ''}>${ui("技能选择")}</button><button data-action="inventory-new" ${disabled}>${ui("新增物品")}</button>${collectible ? `<button data-action="inventory-collect" data-id="${esc(current!.id)}" ${disabled}>${ui("收缴道具")}</button>` : ''}`}</div></div>
      <div class="inventory-unit-choice"><label>${ui("查看单位")} ${select('unit', this.selectedUnit, [['', ui('无主物品')], ...records.map((r): [string, string] => [r.id, `${r.name} · ${ui(r.side === 'ally' ? '我方' : '敌方')} · ${displayNumber(r.hp)}/${displayNumber(r.base.hpMax)}`])])}</label></div>
      ${current ? `<div class="loadout-current"><h3>${esc(current.name)} ${ui("· 当前装备")}</h3><div class="loadout-slots">${items.filter(i => i.equippedTo).map(i => '<span><small>' + ui(slotNames[i.equippedTo!.slot]) + '</small>' + esc(i.name) + ' ×' + i.qty + '</span>').join('') || `<span>${ui("尚未装备物品")}</span>`}</div>${rideEditor(current.id,platformUnits(records.filter(r => r.snapshot)),locked || this.committing)}<details data-detail-id="loadout-summary"><summary>${ui("查看配装、整体防护与负重")}</summary>${issuedGroups(current)}<p>${esc(gearText(current))}</p></details></div>` : ''}
      ${locked ? `<p class="grid-reason">${ui("战斗中不能更换装备。请在战场的行动列表中使用随身物品。")}</p>` : ''}
      ${!d ? feedback : ''}
      <details class="inventory-send" data-detail-id="send-options"><summary>${ui("剧情参考设置")}</summary><div class="row"><button data-action="prompt-select-items" data-selected="true">${ui("全部加入参考")}</button><button data-action="prompt-select-items" data-selected="false">${ui("全部移出参考")}</button></div><p class="sub">${ui("只影响当前显示的物品。勾选后，写剧情时会参考这些物品。")}</p></details>
      ${groups.filter(group => group.items.length).map(group => '<div class="inventory-group"><h3>' + ui(group.name) + '<span>' + group.items.length + '</span></h3><div class="inventory-list">' + group.items.map(card).join('') + '</div></div>').join('') || `<p class="inventory-empty">${ui("这里还没有物品，可以新增，或在剧情中获得。")}</p>`}
      ${d ? `<div class="inventory-editor-shade"></div><aside class="inventory-editor" role="dialog" aria-modal="true" aria-label="${ui("编辑物品")}"><header><div><h3>${ui(d.mode === 'add' ? '增加数量' : d.mode === 'discard' ? '减少数量' : d.mode === 'reforge' ? d.kind === 'item' ? '改造道具' : '编辑装备' : d.mode === 'define' ? '设置物品效果' : '新增物品')}</h3><p class="sub">${current ? esc(current.name) : ui('公共库存')} · ${esc(d.name || ui('未命名物品'))}</p></div><button data-action="inventory-close-draft" aria-label="${ui("关闭物品编辑")}">${ui("关闭")}</button></header><div class="inventory-editor-body"><div class="inventory-form">${d.mode === 'add' || d.mode === 'discard' ? `<label>${d.mode === 'add' ? '增加件数' : '减少件数'}<input data-role="inventory-qty" type="number" min="1" step="1" ${d.mode === 'discard' ? 'max="'+(items.find(i=>i.id===d.itemId)?.qty ?? 0)+'"' : ''} value="${esc(d.qty)}"></label>` : `<div class="inventory-fields"><label>${ui("种类")}${select('kind', d.kind, [['weapon', '武器'], ['armor', '护甲'], ['shield', '盾牌'], ['item', '道具']], d.mode === 'reforge')}</label>${d.mode === 'create' ? `<label>${ui("数量")}<input data-role="inventory-qty" type="number" min="1" value="${esc(d.qty)}"></label>` : ''}</div>${equipmentFields('inventory', d, { nameReadonly: d.mode === 'define' })}`}</div>${feedback}</div><footer><button class="primary" data-action="inventory-preview-draft">${ui("预览结果")}</button><button data-action="inventory-close-draft">${ui("取消")}</button></footer></aside>` : ''}</section>`;
  }
}

const signed = (n: number) => (n > 0 ? '+' : '') + displayNumber(n);
