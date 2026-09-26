import { isCannonWeapon } from '../../engine/src/loadout.js';
import { parseEnhancementSuffix, enhancementLabel, ENHANCEMENT_STATS, BONUS_NAMES, type BonusKind, type Enhancements } from '../../engine/src/enhancements.js';
import { WEAPON_CLASSES, type BodyKind, type ItemMechanics, type ItemSpecification } from '../../engine/src/index.js';
import {POWER_ANCHORS} from '../../engine/src/power-anchors.js';
import { ACCESSORY_NAMES, CONSUMABLE_NAMES, type AccessoryKind, type ConsumableKind } from '../../engine/src/items.js';
export const bodyChoices: [string, string][] = [['human', '普通人形'], ['large', '大型生物'], ['vehicle', '车辆平台'], ['giant', '巨型生物']];
export const armorChoices: [string, string][] = ['无甲', '轻甲', '中甲', '重甲', '超重甲'].map((name, i) => [String(i), name]);
export interface EquipmentDraft { bonuses?: Enhancements; name: string; kind: string; mechanism: string; power: string; quality: string; body: string; tier: string; enchantment: string; stabilized: boolean; profile: string }
export const htmlText = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export function selectField(role: string, value: string, choices: [string, string][], disabled = false): string {
  return `<select data-role="${role}" ${disabled ? 'disabled' : ''}>${choices.map(([id, label]) => `<option value="${htmlText(id)}" ${id === value ? 'selected' : ''}>${htmlText(label)}</option>`).join('')}</select>`;
}
export function equipmentDraft(kind = 'weapon', body = 'human', mechanics?: ItemMechanics, name = ''): EquipmentDraft {
  const r = mechanics?.kind === 'consumable' ? mechanics.recipe : mechanics?.value.recipe;
  return { bonuses: r?.bonuses, name, kind: mechanics?.kind ?? kind, mechanism: (mechanics?.kind === 'weapon' && isCannonWeapon(mechanics.value) && mechanics.value.indirect ? 'indirect-cannon' : r?.mechanism?.replace(/^accessory:/, '')) ?? (kind === 'consumable' ? 'heal' : kind === 'accessory' ? 'guardian' : 'sword'), power: String(r?.power ?? (kind === 'shield' ? 3 : 5)), quality: String(r?.quality ?? 3), body: r?.size ?? body, tier: mechanics?.kind === 'armor' ? String(mechanics.value.tier) : '1', enchantment: r?.enchantment ?? '', stabilized: !!r?.stabilized, profile: r?.protectionProfile ?? 'balanced' };
}
export function equipmentSpecification(d: EquipmentDraft): ItemSpecification {
  const base = { bonuses: d.bonuses, power: Number(d.power), quality: Number(d.quality), body: d.body as BodyKind };
  if (d.kind === 'weapon') return { ...base, kind: 'weapon', mechanism: d.mechanism, enchantment: (d.enchantment || 'none') as 'none' | 'thermal' | 'arcane', stabilized: d.stabilized };
  if (d.kind === 'armor') return { ...base, kind: 'armor', tier: Number(d.tier) as 0 | 1 | 2 | 3 | 4, profile: d.profile as 'balanced' | 'kinetic' | 'thermal' | 'arcane' };
  if (d.kind === 'shield') return { ...base, kind: 'shield' };
  if (d.kind === 'consumable') return { ...base, kind: 'consumable', mechanism: d.mechanism as ConsumableKind };
  if (d.kind === 'accessory') return { ...base, kind: 'accessory', mechanism: d.mechanism as AccessoryKind };
  throw Error('请选择支持的物品种类');
}
export function captureEquipment(prefix: string, current: EquipmentDraft): EquipmentDraft {
  const next = { ...current };
  for (const key of ['name', 'kind', 'mechanism', 'power', 'quality', 'body', 'tier', 'enchantment', 'profile'] as const) {
    const el = document.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-role="${prefix}-${key}"]`); if (el) next[key] = el.value;
  }
  const stable = document.querySelector<HTMLInputElement>(`[data-role="${prefix}-stabilized"]`); if (stable) next.stabilized = stable.checked;
  const bonuses = document.querySelector<HTMLInputElement>(`[data-role="${prefix}-bonuses"]`);
  if(bonuses){
    const value=bonuses.value.trim(),parsed=parseEnhancementSuffix('L1'+value,next.kind as BonusKind);
    if(value&&parsed.text!=='L1')throw Error('属性修正请写成+3伤害-2精度');
    next.bonuses=parsed.bonuses??{};
  }
  return next;
}
/** 新建、编辑与库存共用中文字段和实际配方；高级数值默认收起。 */
export function equipmentFields(prefix: string, d: EquipmentDraft, opts: { disabled?: boolean; sidearm?: boolean; nameReadonly?: boolean } = {}): string {
  const disabled = !!opts.disabled, ro = disabled || opts.nameReadonly ? 'readonly' : '', lock = disabled ? 'disabled' : '';
  const select = (key: string, choices: [string, string][]) => selectField(prefix + '-' + key, String(d[key as keyof EquipmentDraft]), choices, disabled);
  const weapons = Object.values(WEAPON_CLASSES).map((w): [string, string] => [w.id, w.name]);
  return `<div class="equipment-fields"><label>名称<input data-role="${prefix}-name" value="${htmlText(d.name)}" placeholder="留空采用类型名称" ${ro}></label>
    ${d.kind === 'weapon' ? `<label>武器${select('mechanism', weapons)}</label><p class="sub">${htmlText(WEAPON_CLASSES[d.mechanism]?.profile.desc ?? '')}</p>` : d.kind === 'armor' ? `<label>护甲${select('tier', armorChoices)}</label>` : d.kind === 'consumable' ? `<label>用途${select('mechanism', Object.entries(CONSUMABLE_NAMES))}</label>` : d.kind === 'accessory' ? `<label>用途${select('mechanism', Object.entries(ACCESSORY_NAMES))}</label><p class="sub">每个单位最多佩戴两件不同用途的配件，卸下后不再提供能力。</p>` : ''}
    <label>规格<input data-role="${prefix}-power" type="number" min="1" max="10" value="${htmlText(d.power)}" ${disabled ? 'readonly' : ''}></label></div>
    ${d.kind==='weapon'?`<p class="sub power-anchor">L${htmlText(d.power)} · ${htmlText(POWER_ANCHORS[Number(d.power)-1]?.name??'请选择1–10')}：${htmlText(POWER_ANCHORS[Number(d.power)-1]?.example??'')}</p>`:''}
    <details class="equipment-advanced" data-detail-id="${prefix}-advanced"><summary>特殊配置与品质</summary><div class="equipment-fields">
    ${d.kind!=='accessory'?`<label>属性修正（每项−10至+10）<input data-role="${prefix}-bonuses" value="${htmlText(enhancementLabel(d.bonuses))}" placeholder="如+3伤害-2精度；留空清除" ${disabled?'readonly':''}></label><p class="sub">${htmlText((ENHANCEMENT_STATS[d.kind as BonusKind]??[]).map(k=>BONUS_NAMES[k]).join('、'))}。单通道修正只影响该通道；穿透与防护每点0.2档。</p>`:''}
    <label>品质<input data-role="${prefix}-quality" type="number" min="1" max="5" value="${htmlText(d.quality)}" ${disabled ? 'readonly' : ''}></label><label>装备体量${select('body', bodyChoices)}</label>
    ${d.kind === 'weapon' ? `<label>伤害转化${select('enchantment', [['', '保持原伤害类型'], ['thermal', '热能转化'], ['arcane', '奥术转化']])}</label><label class="check-field"><input data-role="${prefix}-stabilized" type="checkbox" ${d.stabilized ? 'checked' : ''} ${lock}>车载行进稳定</label>` : ''}
    ${d.kind === 'armor' ? `<label>防护侧重${select('profile', [['balanced', '综合防护'], ['kinetic', '侧重动能'], ['thermal', '侧重热能'], ['arcane', '侧重奥术']])}</label>` : ''}
    </div>${d.kind === 'weapon' ? '<p class="sub">稳定装置需要真实车辆平台，保留装填并让出部分火力。</p>' : d.kind === 'armor' ? '<p class="sub">防护侧重会从其他通道转移防护；上方单通道属性修正独立增减，不转移其他通道。</p>' : ''}</details>`;
}
