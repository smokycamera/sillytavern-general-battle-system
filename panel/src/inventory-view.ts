import { enhancementLabel } from '../../engine/src/enhancements.js';
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
const slotNames = { primary: '主武器', sidearm: '副武器', armor: '护甲', shield: '盾牌' };
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
  if (!m) return '叙事记录 · 尚未指定可执行效果';
  if (m.kind === 'consumable') return `使用1件恢复${m.effect.amount}生命，上限为目标缺失生命`;
  if (m.kind === 'shield') return `盾牌 L${m.value.recipe?.power??3}${enhancementLabel(m.value.recipe?.bonuses)} · 负载${m.value.load} · 满足盾类技能前提`;
  if (m.kind === 'armor') {const u={armor:m.value,body:m.value.recipe?.size},trait=armorTraitId(m.value.tier);return `动能${anchoredProtection(u,'kinetic')} / 热能${anchoredProtection(u,'thermal')} / 奥术${anchoredProtection(u,'arcane')} · 装甲等效耐久×${Number(armorPowerScale(u).toFixed(2))} · 负载${m.value.load ?? 0}${trait ? ' · 装备自动特质：' + (trait === 'super-heavy' ? '超重装甲（先攻−2，无额外防御）' : '重甲（先攻−1，无额外防御）') : ''}`;}
  const w = m.value;
  return `L${w.level??5}${enhancementLabel(w.recipe?.bonuses)} · ${anchoredWeaponLabel(w)} · ${channelNames[w.channel ?? 'kinetic']} · 格子射程${gridWeaponRange(w)}／会战${formationWeaponRange(w)}阵距 · ${w.hands ?? 1}手 · 负载${w.load ?? 0}${w.reload ? ' · 装填' + w.reload : ''}${w.tags?.includes('blast') ? ' · 距离1正常，距离2命中−2' : ''}${w.recipe?.stabilized ? ' · 车载行进稳定，火力预算让出15%' : ''}`;
}
function gearText(record: UnitRecord | undefined): string {
  const u = record?.snapshot;
  if (!u) return '无装备资料';
  return [u.weapon ? `${u.weapon.name} ${anchoredWeaponLabel(u.weapon)}${u.weapon.recipe?.stabilized ? ' / 行进稳定' : ''}` : '主手空置',
    u.sidearm ? `副武器 ${u.sidearm.name}` : '',
    ...equipmentTraitIds(u).map(id => '装备自动特质：' + (id === 'super-heavy' ? '超重装甲（先攻−2，无额外防御）' : '重甲（先攻−1，无额外防御）')),
    `有效防护 ${anchoredProtection(u, 'kinetic')}/${anchoredProtection(u, 'thermal')}/${anchoredProtection(u, 'arcane')}（动能/热能/奥术） · 装甲等效耐久×${Number(armorPowerScale(u).toFixed(2))}`,
    u.shield ? '携盾' : '无盾',
    `总负载 ${(u.weapon?.load ?? 0) + (u.sidearm?.load ?? 0) + (u.armor?.load ?? 0) + (u.shield?.load ?? 0)}`].filter(Boolean).join(' · ');
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
  const labels: Record<InventoryAction['kind'], string> = { create: '生成入库', define: '补全1件规格', reforge: '改造装备', assign: '调整归属', equip: '更换装备', unequip: '卸下装备', use: '使用物品', discard: '移出库存' };
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
    if (role === 'inventory-kind' || role === 'inventory-unit') this.draw();
    else document.querySelector('[data-role="inventory-feedback"]')?.replaceChildren();
    return true;
  }
  private draftAction(): InventoryAction {
    const d = this.draft!;
    const spec = equipmentSpecification(d);
    if (d.mode === 'define') return { kind: 'define', itemId: d.itemId!, spec };
    if (d.mode === 'reforge') return { kind: 'reforge', itemId: d.itemId!, name: d.name, spec };
    return { kind: 'create', itemId: `item:${d.id}`, name: d.name, spec, qty: d.kind === 'consumable' ? Number(d.qty) : 1 };
  }
  async handleAction(element: HTMLElement): Promise<boolean> {
    const action = element.dataset.action ?? '';
    if (!action.startsWith('inventory-')) return false;
    this.capture(); this.error = undefined;
    try {
      const item = this.view().inventory?.find((i) => i.id === element.dataset.item);
      if (action === 'inventory-new') { this.draft = newDraft(this.view().storage?.find((r) => r.id === this.selectedUnit)?.snapshot?.body); this.preview = undefined; }
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
        else if (action === 'inventory-equip') intent = { kind: 'equip', itemId: item.id, unitId: this.selectedUnit ?? '', slot: element.dataset.slot as 'primary' | 'sidearm' | 'armor' | 'shield' };
        else if (action === 'inventory-unequip') intent = { kind: 'unequip', unitId: item.equippedTo!.unitId, slot: item.equippedTo!.slot };
        else if (action === 'inventory-use') intent = { kind: 'use', itemId: item.id, unitId: this.selectedUnit ?? '' };
        else if (action === 'inventory-discard') intent = { kind: 'discard', itemId: item.id, qty: 1 };
        else if (action === 'inventory-delete') intent = { kind: 'discard', itemId: item.id, qty: item.qty };
        else throw new Error('未知库存操作');
        this.preview = this.controller.previewInventory(intent);
      }
    } catch (error) { this.error = error instanceof Error ? error.message : String(error); }
    this.draw();
    if (this.preview || this.error) document.querySelector('[data-role="inventory-feedback"]')?.scrollIntoView({ block: 'nearest' });
    return true;
  }
  render(): string {
    const context = this.controller.inventoryContext();
    if (this.context !== context) { this.context = context; this.draft = undefined; this.preview = undefined; this.error = undefined; this.selectedUnit = undefined; }
    let save: InventorySave;
    try { save = this.view(); }
    catch (error) { return `<section id="inventory-panel"><h2>配装与库存</h2><p class="grid-reason">${esc(error)}</p></section>`; }
    const records = save.storage ?? [];
    if (this.selectedUnit === undefined || this.selectedUnit !== '' && !records.some((r) => r.id === this.selectedUnit)) this.selectedUnit = records.find((r) => r.side === 'ally' && !r.retired)?.id ?? '';
    const items = this.currentItems(save);
    const current = records.find((r) => r.id === this.selectedUnit);
    const locked = !!save.battle && !(save.committedOutcomeIds ?? []).includes(`${save.battle.kind}:${String(save.battle.snap.seed)}`);
    const d = this.draft;
    const select = (role: string, value: string, choices: [string, string][], disabled = false) => `<select data-role="inventory-${role}" ${disabled ? 'disabled' : ''}>${choices.map(([id, name]) => `<option value="${esc(id)}" ${id === value ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select>`;
    return `<section id="inventory-panel"><h2>配装与库存 <small class="sub">${items.length}条实物与记录</small></h2>
      <div class="row"><label>操作对象 ${select('unit', this.selectedUnit, [['', '无主物品'], ...records.map((r): [string, string] => [r.id, `${r.name} · ${r.side === 'ally' ? '我方' : '敌方'} · ${r.hp}/${r.base.hpMax}`])])}</label><button data-action="inventory-new" ${locked ? 'disabled' : ''}>新增物品</button></div>
      ${current ? `<div class="loadout-current"><h3>${esc(current.name)} · 当前配装</h3><p>${esc(gearText(current))}</p></div>` : ''}
      <div class="row"><button data-action="prompt-select-items" data-selected="true">发送全选</button><button data-action="prompt-select-items" data-selected="false">发送全不选</button><span class="sub">仅调整当前显示物品的发送状态，新物品默认选中。</span></div>
      <p class="sub">${locked ? '战内配装已锁定，消耗品在战场“行动”中使用，占用主行动或所属编队主任务。' : '战前把消耗品分配给携行者，开战后才会出现物品行动。未分配物品留在公共库存。'}</p>
      ${d ? `<div class="inventory-form"><h3>${d.mode === 'reforge' ? '改造装备' : d.mode === 'define' ? '为1件旧记录补全规格' : '生成新物品'}</h3><div class="inventory-fields"><label>种类${select('kind', d.kind, [['weapon', '武器'], ['armor', '护甲'], ['shield', '盾牌'], ['consumable', '治疗用品']], d.mode === 'reforge')}</label>${d.kind === 'consumable' && d.mode === 'create' ? `<label>数量<input data-role="inventory-qty" type="number" min="1" max="9999" value="${esc(d.qty)}"></label>` : ''}</div>
        ${equipmentFields('inventory', d, { nameReadonly: d.mode === 'define' })}
        <div class="row"><button data-action="inventory-preview-draft">预览结果</button><button data-action="inventory-close-draft">收起</button></div></div>` : ''}
      <div data-role="inventory-feedback" aria-live="polite">${this.error ? `<p class="grid-reason">${esc(this.error)}</p>` : ''}${this.preview ? previewHtml(this.preview) : ''}</div>
      <div class="inventory-list">${items.map((item) => {
        const owner = records.find((r) => r.id === item.assignedTo)?.name ?? '未分配';
        const equipped = item.equippedTo, m = item.mechanics;
        const disabled = locked ? 'disabled' : '';
        const selected = this.selectedUnit && (!item.assignedTo || item.assignedTo === this.selectedUnit);
        const actor = records.find((r) => r.id === this.selectedUnit)?.snapshot;
        const slots = m?.kind === 'weapon' ? ['primary', 'sidearm'] as const : m && m.kind !== 'consumable' ? [m.kind] as const : [];
        const gearOptions = slots.map((slot) => ({ slot, reason: !actor ? '先选择单位' : equipmentReason({ ...actor, [slot === 'primary' ? 'weapon' : slot]: m && m.kind !== 'consumable' ? m.value : undefined }) }));
        const complement = m?.kind === 'weapon' && actor?.weapon && !actor.sidearm && !!m.value.tags?.includes('ranged') !== !!actor.weapon.tags?.includes('ranged');
        const recommended = (complement && gearOptions.find((o) => o.slot === 'sidearm' && !o.reason)) || gearOptions.find((o) => !o.reason) || gearOptions[0];
        const itemData = `data-item="${esc(item.id)}"`;
        return `<article class="inventory-card" data-inventory-id="${esc(item.id)}"><div><b>${esc(item.name)}</b> ×${item.qty}<label><input type="checkbox" data-role="prompt-item" data-id="${esc(item.id)}" ${promptSelected(save.promptSettings as PromptSettings | undefined, 'item', item.id) ? 'checked' : ''}>发送给AI</label><span class="tag">${esc(owner)}${equipped ? ' · ' + slotNames[equipped.slot] : ' · 库存'}</span></div><p>${esc(itemDescription(item))}</p>
          <div class="row">${equipped ? `<button data-action="inventory-unequip" ${itemData} ${disabled}>卸下</button>` : `<button data-action="inventory-assign" ${itemData} ${disabled}>${this.selectedUnit ? '分配给当前单位' : '取消归属'}</button>`}
          ${!equipped && recommended ? `<button class="primary" data-action="inventory-equip" ${itemData} data-slot="${recommended.slot}" title="${esc(recommended.reason ?? '预览实际配装变化')}" ${locked || !selected || recommended.reason ? 'disabled' : ''}>装备为${slotNames[recommended.slot]}</button>${recommended.reason ? '<span class="grid-reason">' + esc(recommended.reason) + '</span>' : ''}` : ''}
          ${m?.kind === 'consumable' ? `<button data-action="inventory-use" ${itemData} ${locked || !selected ? 'disabled' : ''}>使用1件</button>` : ''}
          ${m && m.kind !== 'consumable' ? `<button data-action="inventory-edit" ${itemData} ${disabled}>改造</button>` : !m ? `<button data-action="inventory-define" ${itemData} ${disabled}>补全规格</button>` : ''}
          <button data-action="inventory-delete" ${itemData} title="${equipped ? '先卸下再删除' : '删除整条记录（含全部数量），确认前有预览'}" ${locked || equipped ? 'disabled' : ''}>删除</button>
          </div><details class="inventory-more"><summary>更多操作</summary><div class="row">${!equipped ? gearOptions.filter((o) => o.slot !== recommended?.slot).map((o) => `<button data-action="inventory-equip" ${itemData} data-slot="${o.slot}" title="${esc(o.reason ?? '')}" ${locked || !selected || o.reason ? 'disabled' : ''}>装备为${slotNames[o.slot]}</button>`).join('') + (item.assignedTo ? `<button data-action="inventory-unassign" ${itemData} ${disabled}>放回公共库存</button>` : '') + (item.qty > 1 ? `<button data-action="inventory-discard" ${itemData} ${disabled}>移除1件</button>` : '') : ''}</div></details>
          ${item.note || item.history?.length ? `<details><summary>来源与改造记录</summary>${item.note ? `<p>${esc(item.note)}</p>` : ''}${item.history?.map((h) => `<p>第${h.revision}版 ${esc(h.name)} · ${esc(itemDescription({ ...item, mechanics: h.mechanics }))}</p>`).join('') ?? ''}</details>` : ''}</article>`;
      }).join('') || '<p class="sub">暂无库存，可生成物品或由正文事件获得。</p>'}</div></section>`;
  }
}
