import { enhancementLabel } from '../../engine/src/enhancements.js';
import { ACCESSORY_NAMES, CONSUMABLE_NAMES, type EquipmentSlot } from '../../engine/src/items.js';
import { promptSelected, type PromptSettings } from './prompt-settings.js';
import { gridWeaponRange } from '../../engine/src/small/weapon-range.js';
import { formationWeaponRange } from '../../engine/src/melee.js';
import { armorTraitId, equipmentTraitIds } from '../../engine/src/trait-sources.js';
import { weaponReloadTurns } from '../../engine/src/loadout.js';
import { equipmentDraft, equipmentFields, equipmentSpecification, captureEquipment, type EquipmentDraft } from './equipment-form.js';
import { equipmentReason, effectiveProtection, abilityUsabilityReason, traitRegistry, WEAPON_CLASSES, type BodyKind, type ItemSpecification } from '../../engine/src/index.js';
import { materializeUnitRecord, type UnitRecord } from './unit-state.js';
import {anchoredWeapon,anchoredWeaponLabel,anchoredProtection,armorPowerScale} from '../../engine/src/power-anchors.js';
import { prepareInventoryState, type InventoryAction, type InventoryItem, type InventorySave } from './inventory-state.js';
import type { InventoryPreview } from './narrative-controller.js';
import type { PanelController } from './controller-port.js';

const esc = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const slotNames = { primary: '主武器', sidearm: '副武器', armor: '护甲', shield: '盾牌', accessory1: '配件一', accessory2: '配件二' };
const bodyNames = { human: '普通人形', large: '大型生物', vehicle: '载具平台', giant: '巨型生物' };
const channelNames = { kinetic: '动能', thermal: '热能', arcane: '奥术' };
interface Draft extends EquipmentDraft {
  mode: 'create' | 'define' | 'reforge'; itemId?: string; id: string; qty: string;
}
function newDraft(body = 'human'): Draft {
  return { ...equipmentDraft('weapon', body), mode: 'create', id: crypto.randomUUID(), qty: '1' };
}
export function itemDescription(item: InventoryItem): string {
  const m = item.mechanics;
  if (!m) return '剧情物品 · 尚未设置战斗用途';
  if (m.kind === 'consumable') {
    const e = m.effect;
    if (e.op === 'heal') return `${m.recipe.mechanism === 'repair' ? '修理车辆' : '治疗'}：恢复${e.amount ?? e.dice}点生命，不超过实际损伤`;
    if (e.op === 'resource') return `恢复${e.amount}点精力，不超过上限`;
    if (e.op === 'dispel') return `清除至多${e.count}项不利状态`;
    if (e.op === 'barrier') return `屏障吸收${e.amount}点伤害，持续${e.dur}轮`;
    if (e.op === 'condition') return `提高伤害，持续${e.dur}轮`;
    return `投掷炸弹造成${e.baseDice}伤害，影响目标及附近敌人`;
  }
  if (m.kind === 'accessory') return m.value.traitId ? `装备后获得${traitRegistry().get(m.value.traitId)?.name ?? '特殊能力'}；卸下即失效` : m.value.ability?.desc ?? '装备后可使用附带能力';
  if (m.kind === 'shield') return `盾牌 L${m.value.recipe?.power??3}${enhancementLabel(m.value.recipe?.bonuses)} · 负重${m.value.load} · 满足盾类技能前提`;
  if (m.kind === 'armor') {const u={armor:m.value,body:m.value.recipe?.size},trait=armorTraitId(m.value.tier);return `动能${anchoredProtection(u,'kinetic')} / 热能${anchoredProtection(u,'thermal')} / 奥术${anchoredProtection(u,'arcane')} · 护甲耐久×${Number(armorPowerScale(u).toFixed(2))} · 负重${m.value.load ?? 0}${trait ? ' · 装备自动特质：' + (trait === 'super-heavy' ? '超重装甲（先攻−2，无额外防御）' : '重甲（先攻−1，无额外防御）') : ''}`;}
  const w = m.value;
  return `L${w.level??5}${enhancementLabel(w.recipe?.bonuses)} · ${anchoredWeaponLabel(w)} · ${channelNames[w.channel ?? 'kinetic']} · 格子射程${gridWeaponRange(w)}／会战${formationWeaponRange(w)}阵距 · ${w.hands===0?'不占双手':(w.hands??1)+'手'} · 负重${w.load ?? 0}${w.reload ? ' · 装填' + w.reload : ''}${w.tags?.includes('blast') ? ' · 距离1正常，距离2命中−2' : ''}${w.recipe?.stabilized ? ' · 车载行进稳定，火力让出15%' : ''}`;
}
function gearText(record: UnitRecord | undefined): string {
  const u = record?.snapshot;
  if (!u) return '无装备资料';
  return [u.weapon ? `${u.weapon.name} ${anchoredWeaponLabel(u.weapon)}${u.weapon.recipe?.stabilized ? ' / 行进稳定' : ''}` : '主手空置',
    u.sidearm ? `副武器 ${u.sidearm.name}` : '',
    ...equipmentTraitIds(u).map(id => '装备自动特质：' + (id === 'super-heavy' ? '超重装甲（先攻−2，无额外防御）' : '重甲（先攻−1，无额外防御）')),
    `有效防护 ${anchoredProtection(u, 'kinetic')}/${anchoredProtection(u, 'thermal')}/${anchoredProtection(u, 'arcane')}（动能/热能/奥术） · 护甲耐久×${Number(armorPowerScale(u).toFixed(2))}`,
    u.shield ? '携盾' : '无盾',
    `总负重 ${(u.weapon?.load ?? 0) + (u.sidearm?.load ?? 0) + (u.armor?.load ?? 0) + (u.shield?.load ?? 0) + Object.values(u.accessories ?? {}).reduce((sum,item)=>sum+(item?.load??0),0)}`].filter(Boolean).join(' · ');
}
function gearComparison(before: UnitRecord | undefined, after: UnitRecord): string {
  const rows: string[] = [];
  for (const slot of ['weapon', 'sidearm'] as const) {
    const old = before?.snapshot?.[slot], next = after.snapshot?.[slot];
    if (JSON.stringify(old) === JSON.stringify(next)) continue;
    const label = slot === 'weapon' ? '主武器' : '副武器';
    for (const [name, a, b] of [
      ['格子射程', old ? gridWeaponRange(old) : '—', next ? gridWeaponRange(next) : '—'],
      ['会战阵距', old ? formationWeaponRange(old) : '—', next ? formationWeaponRange(next) : '—'],
      ['装填回合', old ? weaponReloadTurns(old) : '—', next ? weaponReloadTurns(next) : '—'],
      ['穿透', anchoredWeapon(old)?.penetration ?? '—', anchoredWeapon(next)?.penetration ?? '—'],
      ['命中杀伤',old?anchoredWeaponLabel(old):'—',next?anchoredWeaponLabel(next):'—'],
    ]) rows.push(`<tr><td>${label} · ${name}</td><td>${esc(a)}</td><td>${esc(b)}</td></tr>`);
  }
  return rows.length ? `<table class="gear-comparison"><thead><tr><th>变化</th><th>当前</th><th>装备后</th></tr></thead><tbody>${rows.join('')}</tbody></table>` : '';
}
function previewHtml(preview: InventoryPreview): string {
  const intent = preview.intent;
  const changed = (preview.after.storage ?? []).filter((r) => (preview.before.storage ?? []).find((old) => old.id === r.id)?.revision !== r.revision);
  const itemId = 'itemId' in intent ? intent.itemId : undefined;
  const afterItem = preview.after.inventory?.find((i) => i.id === itemId);
  const beforeItem = preview.before.inventory?.find((i) => i.id === itemId);
  const labels: Record<InventoryAction['kind'], string> = { create: '新增物品', define: '设置物品效果', reforge: '改造装备', assign: '调整归属', equip: '更换装备', unequip: '卸下装备', use: '使用物品', discard: '移出库存' };
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
    return `<div class="inventory-difference"><b>${esc(record.name)}</b>${gearComparison(before, record)}<p>${esc(gearText(before))}<br>→ ${esc(gearText(record))}</p><div>生命/人数 ${before?.hp ?? '—'}/${before?.base.hpMax ?? '—'} → ${record.hp}/${record.base.hpMax} · 训练${record.level}</div>${skills ? `<p>${esc(skills)}</p>` : ''}</div>`;
  }).join('');
  const created = intent.kind === 'define' ? preview.after.inventory?.find((i) => i.sourceItemId === intent.itemId && i.id !== intent.itemId && !preview.before.inventory?.some((old) => old.id === i.id)) : undefined;
  const selected = created ?? afterItem;
  const owner = afterItem?.assignedTo ? preview.after.storage?.find((r) => r.id === afterItem.assignedTo)?.name : '未分配';
  return `<div class="inventory-preview" data-role="inventory-preview"><h3>${labels[intent.kind]} · 确认前预览</h3>
    ${selected ? `<b>${esc(selected.name)}</b><p>${esc(itemDescription(selected))}</p>` : ''}
    ${intent.kind === 'reforge' && beforeItem ? `<p>改造前：${esc(itemDescription(beforeItem))}</p>` : ''}
    ${beforeItem && afterItem ? `<div>该条目数量 ${beforeItem.qty} → ${afterItem.qty} · 归属：${esc(owner)}</div>` : ''}
    ${intent.kind === 'unequip' ? '<p>实物返回持有者库存，可以继续转移或装备。</p>' : ''}${units}
    <div class="row"><button class="primary" data-action="inventory-confirm">确认${labels[intent.kind]}</button><button data-action="inventory-cancel">取消预览</button></div></div>`;
}

/** 只展示和提交意图；所有数据变化由常驻控制器校验、保存和发布。 */
export class InventoryPanel {
  private draft?: Draft;
  private preview?: InventoryPreview;
  private error?: string;
  private selectedUnit: string | undefined;
  private context = '';
  constructor(private controller: PanelController, private canView: (record: UnitRecord) => boolean = () => true) {}
  private view(): InventorySave {
    const save = prepareInventoryState(this.controller.snapshot());
    const storage = save.storage?.filter(this.canView);
    return { ...save, storage, inventory: save.inventory?.filter((item) => !item.assignedTo || storage?.some((u) => u.id === item.assignedTo)) };
  }
  private currentItems(save: InventorySave): InventoryItem[] {
    return (save.inventory ?? []).filter((item) => item.qty > 0 && (!item.assignedTo || item.assignedTo === this.selectedUnit))
      .sort((a, b) => {
        const rank = (item: InventoryItem) => item.equippedTo ? 0 : item.assignedTo ? 1 : 2;
        return rank(a) - rank(b);
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
    if (!this.draft || target && !target.closest('#inventory-panel')) return;
    Object.assign(this.draft, captureEquipment('inventory', this.draft));
    const quantity = document.querySelector<HTMLInputElement>('[data-role="inventory-qty"]'); if (quantity) this.draft.qty = quantity.value;
  }
  handleChange(target: Element): boolean {
    if (!target.closest('#inventory-panel')) return false;
    this.capture(target);
    if ((target as HTMLElement).dataset.role === 'inventory-unit') {
      this.selectedUnit = (target as HTMLSelectElement).value;
      if (this.draft?.itemId && !this.currentItems(this.view()).some(item => item.id === this.draft?.itemId)) this.draft = undefined;
    }
    this.preview = undefined; this.error = undefined;
    const role = (target as HTMLElement).dataset.role;
    if (role === 'inventory-kind' && this.draft) {
      const choices = this.draft.kind === 'consumable' ? CONSUMABLE_NAMES : this.draft.kind === 'accessory' ? ACCESSORY_NAMES : WEAPON_CLASSES;
      if (!Object.hasOwn(choices, this.draft.mechanism)) this.draft.mechanism = Object.keys(choices)[0]!;
      if (this.draft.kind === 'accessory') this.draft.bonuses = undefined;
    }
    if (role === 'inventory-kind' || role === 'inventory-unit') this.draw();
    else document.querySelector('[data-role="inventory-feedback"]')?.replaceChildren();
    return true;
  }
  private draftAction(): InventoryAction {
    const d = this.draft!;
    const spec = equipmentSpecification(d);
    const name=d.name.trim() || (d.kind==='weapon'?WEAPON_CLASSES[d.mechanism]?.name:d.kind==='consumable'?CONSUMABLE_NAMES[d.mechanism as keyof typeof CONSUMABLE_NAMES]:d.kind==='accessory'?ACCESSORY_NAMES[d.mechanism as keyof typeof ACCESSORY_NAMES]:d.kind==='shield'?'盾牌':'护甲') || '物品';
    if (d.mode === 'define') return { kind: 'define', itemId: d.itemId!, spec };
    if (d.mode === 'reforge') return { kind: 'reforge', itemId: d.itemId!, name, spec };
    return { kind: 'create', itemId: `item:${d.id}`, name, spec, qty: d.kind === 'consumable' ? Number(d.qty) : 1 };
  }
  async handleAction(element: HTMLElement): Promise<boolean> {
    const action = element.dataset.action ?? '';
    if (!action.startsWith('inventory-')) return false;
    this.capture(); this.error = undefined;
    try {
      const item = this.view().inventory?.find((i) => i.id === element.dataset.item);
      if (action === 'inventory-new') { this.editorScroll = window.scrollY; this.draft = newDraft(this.view().storage?.find((r) => r.id === this.selectedUnit)?.snapshot?.body); this.preview = undefined; }
      else if (action === 'inventory-cancel') this.preview = undefined;
      else if (action === 'inventory-close-draft') { this.draft = undefined; this.preview = undefined; }
      else if (action === 'inventory-confirm') {
        if (!this.preview) throw new Error('请先预览');
        const receipt = await this.controller.commitInventoryPreview(this.preview);
        if (receipt.status === 'failed') throw new Error(receipt.error ?? '尚未保存，可重试当前预览');
        this.preview = undefined; this.draft = undefined;
      } else if (action === 'inventory-preview-draft') {
        if (!this.draft) throw new Error('请先填写规格');
        this.preview = this.controller.previewInventory(this.draftAction(), this.draft.id);
      } else if (action === 'inventory-edit' || action === 'inventory-define') {
        this.editorScroll = window.scrollY;
        if (!item) throw new Error('物品不存在');
        const m = item.mechanics;
        const recipe = m?.kind === 'consumable' ? m.recipe : m?.value.recipe;
        this.draft = { ...newDraft(), ...equipmentDraft(m?.kind ?? (['weapon', 'armor', 'consumable'].includes(item.lootType) ? item.lootType : 'weapon'), 'human', m, item.name), mode: action === 'inventory-edit' ? 'reforge' : 'define', itemId: item.id };
        this.preview = undefined;
      } else {
        if (!item) throw new Error('物品不存在');
        let intent: InventoryAction;
        if (action === 'inventory-assign') intent = { kind: 'assign', itemId: item.id, unitId: this.selectedUnit || undefined };
        else if (action === 'inventory-unassign') intent = { kind: 'assign', itemId: item.id };
        else if (action === 'inventory-equip') intent = { kind: 'equip', itemId: item.id, unitId: this.selectedUnit ?? '', slot: element.dataset.slot as EquipmentSlot };
        else if (action === 'inventory-unequip') intent = { kind: 'unequip', unitId: item.equippedTo!.unitId, slot: item.equippedTo!.slot };
        else if (action === 'inventory-use') intent = { kind: 'use', itemId: item.id, unitId: this.selectedUnit ?? '' };
        else if (action === 'inventory-discard') intent = { kind: 'discard', itemId: item.id, qty: 1 };
        else if (action === 'inventory-delete') intent = { kind: 'discard', itemId: item.id, qty: item.qty };
        else throw new Error('未知库存操作');
        this.preview = this.controller.previewInventory(intent);
      }
    } catch (error) { this.error = error instanceof Error ? error.message : String(error); }
    this.draw();
    if (['inventory-new', 'inventory-edit', 'inventory-define'].includes(action)) document.querySelector<HTMLInputElement>('[data-role="inventory-name"]')?.focus();
    if (action === 'inventory-close-draft' || action === 'inventory-confirm' && !this.draft && !this.error) { window.scrollTo(0, this.editorScroll); document.querySelector<HTMLButtonElement>('[data-action="inventory-new"]')?.focus({ preventScroll: true }); }
    if (this.preview || this.error) document.querySelector('[data-role="inventory-feedback"]')?.scrollIntoView({ block: 'nearest' });
    return true;
  }
  render(): string {
    const context = this.controller.inventoryContext();
    if (this.context !== context) { this.context = context; this.draft = undefined; this.preview = undefined; this.error = undefined; this.selectedUnit = undefined; }
    let save: InventorySave;
    try { save = this.view(); }
    catch (error) { return `<section id="inventory-panel"><h2>装备与物品</h2><p class="grid-reason">${esc(error)}</p></section>`; }
    const records = save.storage ?? [];
    if (this.selectedUnit === undefined || this.selectedUnit !== '' && !records.some(r => r.id === this.selectedUnit)) this.selectedUnit = records.find(r => r.side === 'ally' && !r.retired)?.id ?? '';
    const items = this.currentItems(save), current = records.find(r => r.id === this.selectedUnit), actor = current?.snapshot;
    const locked = !!save.battle && !(save.committedOutcomeIds ?? []).includes(`${save.battle.kind}:${String(save.battle.snap.seed)}`);
    const d = this.draft, disabled = locked ? 'disabled' : '';
    const select = (role: string, value: string, choices: [string, string][], disabled = false) => `<select data-role="inventory-${role}" ${disabled ? 'disabled' : ''}>${choices.map(([id, name]) => `<option value="${esc(id)}" ${id === value ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select>`;
    const feedback = `<div data-role="inventory-feedback" aria-live="polite">${this.error ? `<p class="grid-reason">${esc(this.error)}</p>` : ''}${this.preview ? previewHtml(this.preview) : ''}</div>`;
    const card = (item: InventoryItem): string => {
      const m = item.mechanics, equipped = item.equippedTo, itemData = `data-item="${esc(item.id)}"`;
      const slots: EquipmentSlot[] = m?.kind === 'weapon' ? ['primary', 'sidearm'] : m?.kind === 'accessory' ? ['accessory1', 'accessory2'] : m && m.kind !== 'consumable' ? [m.kind] : [];
      const gearOptions = slots.map(slot => ({ slot, reason: !actor ? '请先选择使用者' : equipmentReason(slot.startsWith('accessory') ? { ...actor, accessories: { ...actor.accessories, [slot]: m?.kind === 'accessory' ? m.value : undefined } } : { ...actor, [slot === 'primary' ? 'weapon' : slot]: m && m.kind !== 'consumable' ? m.value : undefined }) }));
      const complement = m?.kind === 'weapon' && actor?.weapon && !actor.sidearm && !!m.value.tags?.includes('ranged') !== !!actor.weapon.tags?.includes('ranged');
      const recommended = m?.kind === 'accessory' ? gearOptions.find(o => !actor?.accessories?.[o.slot as 'accessory1' | 'accessory2'] && !o.reason) ?? gearOptions[0] : (complement && gearOptions.find(o => o.slot === 'sidearm' && !o.reason)) || gearOptions.find(o => !o.reason) || gearOptions[0];
      const details: string[] = [];
      if (m && m.kind !== 'consumable') details.push(`<button data-action="inventory-edit" ${itemData} ${disabled}>改造</button>`);
      if (!m) details.push(`<button data-action="inventory-define" ${itemData} ${disabled}>设置物品效果</button>`);
      if (!equipped) {
        details.push(...gearOptions.filter(o => o.slot !== recommended?.slot).map(o => `<button data-action="inventory-equip" ${itemData} data-slot="${o.slot}" title="${esc(o.reason ?? '')}" ${locked || !actor || o.reason ? 'disabled' : ''}>装备为${slotNames[o.slot]}</button>`));
        if (item.assignedTo && !(m?.kind==='weapon' && m.value.recipe?.mechanism==='natural')) details.push(`<button data-action="inventory-unassign" ${itemData} ${disabled}>放回公共库存</button>`);
        if (item.qty > 1) details.push(`<button data-action="inventory-discard" ${itemData} ${disabled}>移除1件</button>`);
        details.push(`<button class="danger" data-action="inventory-delete" ${itemData} ${disabled}>删除物品</button>`);
      }
      const stats: [string, string][] = [];
      if (m?.kind === 'weapon') {
        const w = m.value;
        stats.push(['伤害', anchoredWeaponLabel(w).split(' · ')[0]!.replace('单次命中均值', '平均')], ['穿透', String(anchoredWeapon(w)?.penetration ?? w.penetration ?? 0)], ['射程', save.mode === 'mass' ? formationWeaponRange(w) + '阵位' : gridWeaponRange(w) + '格'], ['负重', String(w.load ?? 0)]);
      } else if (m?.kind === 'armor') {
        const unit = { armor: m.value, body: m.value.recipe?.size };
        stats.push(['动能防护', String(anchoredProtection(unit, 'kinetic'))], ['热能防护', String(anchoredProtection(unit, 'thermal'))], ['奥术防护', String(anchoredProtection(unit, 'arcane'))], ['负重', String(m.value.load ?? 0)]);
      }
      const battleOnly = m?.kind === 'consumable' && !['heal', 'repair', 'restore', 'cleanse'].includes(m.recipe.mechanism);
      return `<article class="inventory-card" data-inventory-id="${esc(item.id)}"><div class="inventory-card-heading"><div><b>${esc(item.name)}</b><span class="item-quantity">×${item.qty}</span></div><label class="item-prompt"><input type="checkbox" data-role="prompt-item" data-id="${esc(item.id)}" ${promptSelected(save.promptSettings as PromptSettings | undefined, 'item', item.id) ? 'checked' : ''}><span>供剧情参考</span></label></div>
        <div class="item-location">${equipped ? slotNames[equipped.slot] + ' · 已装备' : item.assignedTo ? '随身物品' : '公共库存'}${m && m.kind !== 'consumable' ? ' · 等级' + (m.value.recipe?.power ?? 1) : ''}</div>
        ${stats.length ? `<dl class="item-stats">${stats.map(([key, value]) => `<div><dt>${key}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl><details class="item-rules" data-detail-id="rules-${esc(item.id)}"><summary>查看完整属性与规则</summary><p>${esc(itemDescription(item))}</p></details>` : `<p>${esc(itemDescription(item))}</p>`}
        <div class="item-actions">${equipped ? `<button class="primary" data-action="inventory-unequip" ${itemData} ${disabled}>卸下</button>` : recommended ? `<button class="primary" data-action="inventory-equip" ${itemData} data-slot="${recommended.slot}" ${locked || !actor || recommended.reason ? 'disabled' : ''}>装备为${slotNames[recommended.slot]}</button>${recommended.reason ? '<span class="grid-reason">' + esc(recommended.reason) + '</span>' : ''}` : ''}
        ${m?.kind === 'consumable' ? `<button class="primary" data-action="inventory-use" ${itemData} title="${battleOnly ? '请在战场的行动列表中使用' : ''}" ${locked || !actor || battleOnly ? 'disabled' : ''}>${battleOnly ? '战斗中使用' : '使用1件'}</button>` : ''}
        ${!equipped && !item.assignedTo && actor ? `<button data-action="inventory-assign" ${itemData} ${disabled}>交给${esc(current!.name)}</button>` : ''}</div>
        ${details.length ? `<details class="inventory-more" data-detail-id="more-${esc(item.id)}"><summary>其他操作</summary><div class="row">${details.join('')}</div></details>` : ''}
        ${item.note || item.history?.length ? `<details data-detail-id="history-${esc(item.id)}"><summary>来源与改造记录</summary>${item.note ? '<p>' + esc(item.note) + '</p>' : ''}${item.history?.map(h => '<p>第' + h.revision + '次记录：' + esc(h.name) + ' · ' + esc(itemDescription({ ...item, mechanics: h.mechanics })) + '</p>').join('') ?? ''}</details>` : ''}</article>`;
    };
    const groups = [
      { name: '已装备', items: items.filter(item => item.equippedTo) },
      { name: '随身物品', items: items.filter(item => item.assignedTo && !item.equippedTo) },
      { name: '公共库存', items: items.filter(item => !item.assignedTo) },
    ];
    return `<section id="inventory-panel"><div class="inventory-title"><h2>装备与物品 <small class="sub">${items.length}种物品</small></h2><button data-action="inventory-new" ${disabled}>新增物品</button></div>
      <div class="inventory-unit-choice"><label>查看单位 ${select('unit', this.selectedUnit, [['', '无主物品'], ...records.map((r): [string, string] => [r.id, `${r.name} · ${r.side === 'ally' ? '我方' : '敌方'} · ${r.hp}/${r.base.hpMax}`])])}</label></div>
      ${current ? `<div class="loadout-current"><h3>${esc(current.name)} · 当前装备</h3><div class="loadout-slots">${items.filter(i => i.equippedTo).map(i => '<span><small>' + slotNames[i.equippedTo!.slot] + '</small>' + esc(i.name) + '</span>').join('') || '<span>尚未装备物品</span>'}</div><details data-detail-id="loadout-summary"><summary>查看整体防护与负重</summary><p>${esc(gearText(current))}</p></details></div>` : ''}
      ${locked ? '<p class="grid-reason">战斗中不能更换装备。请在战场的行动列表中使用随身物品。</p>' : ''}
      ${!d ? feedback : ''}
      <details class="inventory-send" data-detail-id="send-options"><summary>剧情参考设置</summary><div class="row"><button data-action="prompt-select-items" data-selected="true">全部加入参考</button><button data-action="prompt-select-items" data-selected="false">全部移出参考</button></div><p class="sub">只影响当前显示的物品。勾选后，写剧情时会参考这些物品。</p></details>
      ${groups.filter(group => group.items.length).map(group => '<div class="inventory-group"><h3>' + group.name + '<span>' + group.items.length + '</span></h3><div class="inventory-list">' + group.items.map(card).join('') + '</div></div>').join('') || '<p class="inventory-empty">这里还没有物品，可以新增，或在剧情中获得。</p>'}
      ${d ? `<div class="inventory-editor-shade"></div><aside class="inventory-editor" role="dialog" aria-modal="true" aria-label="编辑物品"><header><div><h3>${d.mode === 'reforge' ? '改造装备' : d.mode === 'define' ? '设置物品效果' : '新增物品'}</h3><p class="sub">${current ? esc(current.name) : '公共库存'} · ${esc(d.name || '未命名物品')}</p></div><button data-action="inventory-close-draft" aria-label="关闭物品编辑">关闭</button></header><div class="inventory-editor-body"><div class="inventory-form"><div class="inventory-fields"><label>种类${select('kind', d.kind, [['weapon', '武器'], ['armor', '护甲'], ['shield', '盾牌'], ['accessory', '配件与工具'], ['consumable', '消耗品']], d.mode === 'reforge')}</label>${d.kind === 'consumable' && d.mode === 'create' ? `<label>数量<input data-role="inventory-qty" type="number" min="1" max="9999" value="${esc(d.qty)}"></label>` : ''}</div>${equipmentFields('inventory', d, { nameReadonly: d.mode === 'define' })}</div>${feedback}</div><footer><button class="primary" data-action="inventory-preview-draft">预览结果</button><button data-action="inventory-close-draft">取消</button></footer></aside>` : ''}</section>`;
  }
}
