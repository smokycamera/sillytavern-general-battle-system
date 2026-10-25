import { isCannonWeapon } from '../../engine/src/loadout.js';
import { parseEnhancementSuffix, enhancementLabel, ENHANCEMENT_STATS, BONUS_NAMES, type BonusKind, type Enhancements } from '../../engine/src/enhancements.js';
import { WEAPON_CLASSES, SHIELD_CLASSES, ITEM_FORM_NAMES, skillMechanismName, traitRegistry, type BodyKind, type ItemForm, type ItemMechanics, type ItemSpecification } from '../../engine/src/index.js';
import {POWER_ANCHORS} from '../../engine/src/power-anchors.js';
import { parseItemSpecification } from './item-spec.js';
export const bodyChoices: [string, string][] = [['human', '普通人形'], ['large', '大型生物'], ['vehicle', '车辆平台'], ['giant', '巨型生物']];
export const armorChoices: [string, string][] = ['无甲', '轻甲', '中甲', '重甲', '超重甲'].map((name, i) => [String(i), name]);
/** 道具：form 形态，effect 效果写法（技能机制、特质或“佩戴”），与正文 spec 同一套写法。 */
export interface EquipmentDraft { bonuses?: Enhancements; name: string; kind: string; mechanism: string; power: string; quality: string; body: string; tier: string; enchantment: string; stabilized: boolean; profile: string; form: ItemForm; effect: string }
export const htmlText = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export function selectField(role: string, value: string, choices: [string, string][], disabled = false): string {
  return `<select data-role="${role}" ${disabled ? 'disabled' : ''}>${choices.map(([id, label]) => `<option value="${htmlText(id)}" ${id === value ? 'selected' : ''}>${htmlText(label)}</option>`).join('')}</select>`;
}
/** 道具配方 → 表单里的效果写法。 */
function itemEffectText(mechanics: Extract<ItemMechanics, { kind: 'item' }>): string {
  const recipe = mechanics.value.recipe;
  if (recipe.active) return skillMechanismName(recipe.active);
  const names = (recipe.traits ?? []).map((t) => traitRegistry().get(t.id)?.name ?? t.id);
  return names.length ? names.join('、') : '佩戴';
}
export function equipmentDraft(kind = 'weapon', body = 'human', mechanics?: ItemMechanics, name = ''): EquipmentDraft {
  if (mechanics?.kind === 'item' || !mechanics && kind === 'item') {
    const recipe = mechanics?.kind === 'item' ? mechanics.value.recipe : undefined;
    return { bonuses: recipe?.bonuses, name, kind: 'item', mechanism: '', power: String(recipe?.power ?? 3), quality: '3', body, tier: '1', enchantment: '', stabilized: false, profile: 'balanced',
      form: recipe?.form ?? 'single', effect: mechanics?.kind === 'item' ? itemEffectText(mechanics) : 'buff治疗' };
  }
  const r = mechanics?.value.recipe;
  return { bonuses: r?.bonuses, name, kind: mechanics?.kind ?? kind, mechanism: (mechanics?.kind === 'weapon' && isCannonWeapon(mechanics.value) && mechanics.value.indirect ? 'indirect-cannon' : r?.mechanism) ?? (kind === 'shield' ? 'shield' : 'sword'), power: String(r?.power ?? (kind === 'shield' ? 3 : 5)), quality: String(r?.quality ?? 3), body: r?.size ?? body, tier: mechanics?.kind === 'armor' ? String(mechanics.value.tier) : '1', enchantment: r?.enchantment ?? '', stabilized: !!r?.stabilized, profile: r?.protectionProfile ?? 'balanced', form: 'single', effect: '' };
}
const bonusKind = (d: Pick<EquipmentDraft, 'kind' | 'form'>): BonusKind => d.kind === 'item' ? d.form === 'worn' ? 'gear' : d.form === 'charged' ? 'charged' : 'skill' : d.kind as BonusKind;
export function equipmentSpecification(d: EquipmentDraft): ItemSpecification {
  const base = { bonuses: d.bonuses, power: Number(d.power), quality: Number(d.quality), body: d.body as BodyKind };
  if (d.kind === 'weapon') return { ...base, kind: 'weapon', mechanism: d.mechanism, enchantment: (d.enchantment || 'none') as 'none' | 'thermal' | 'arcane', stabilized: d.stabilized };
  if (d.kind === 'armor') return { ...base, kind: 'armor', tier: Number(d.tier) as 0 | 1 | 2 | 3 | 4, profile: d.profile as 'balanced' | 'kinetic' | 'thermal' | 'arcane' };
  if (d.kind === 'shield') return { ...base, kind: 'shield', mechanism: d.mechanism as keyof typeof SHIELD_CLASSES };
  if (d.kind === 'item') {
    const effect = d.effect.trim();
    if (!effect) throw Error('请填写道具效果，如buff治疗、物理范围投射、夜战专精或佩戴');
    const spec = parseItemSpecification((d.form === 'charged' ? '充能' : '') + effect + 'L' + d.power + enhancementLabel(d.bonuses));
    if (spec.kind !== 'item') throw Error('道具效果写技能机制、特质或“佩戴”，武器护甲请选对应种类');
    if (d.form === 'worn' && spec.form !== 'worn') throw Error('佩戴道具写特质或“佩戴”，主动效果请选一次性或充能');
    if (d.form !== 'worn' && spec.form === 'worn') throw Error('特质写在佩戴道具里；一次性或充能道具写技能机制，如buff夜战专精');
    return spec;
  }
  throw Error('请选择支持的物品种类');
}
export function captureEquipment(prefix: string, current: EquipmentDraft): EquipmentDraft {
  const next = { ...current };
  for (const key of ['name', 'kind', 'mechanism', 'power', 'quality', 'body', 'tier', 'enchantment', 'profile', 'effect'] as const) {
    const el = document.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-role="${prefix}-${key}"]`); if (el && !el.disabled) next[key] = el.value;
  }
  const form = document.querySelector<HTMLSelectElement>(`[data-role="${prefix}-form"]`); if (form) next.form = form.value as ItemForm;
  const stable = document.querySelector<HTMLInputElement>(`[data-role="${prefix}-stabilized"]`); if (stable) next.stabilized = stable.checked;
  const bonuses = document.querySelector<HTMLInputElement>(`[data-role="${prefix}-bonuses"]`);
  if(bonuses){
    const value=bonuses.value.trim(),parsed=parseEnhancementSuffix('L1'+value,bonusKind(next));
    if(value&&parsed.text!=='L1')throw Error('属性修正请写成+3伤害-2精度');
    next.bonuses=parsed.bonuses??{};
  }
  return next;
}
const EFFECT_EXAMPLES = ['buff治疗', '物理范围投射', '物理范围投射+燃烧', '烟幕', 'debuff范围眩晕', '陷阱', '魔法范围热能', '物理单体射击+燃烧', 'buff屏障', 'buff净化', '夜战专精', '林地专精', '潜伏', '侦察', '登城', '佩戴'];
/** 新建、编辑与库存共用中文字段和实际配方；高级数值默认收起。 */
export function equipmentFields(prefix: string, d: EquipmentDraft, opts: { disabled?: boolean; sidearm?: boolean; nameReadonly?: boolean; primaryHands?: number } = {}): string {
  const disabled = !!opts.disabled, ro = disabled || opts.nameReadonly ? 'readonly' : '', lock = disabled ? 'disabled' : '';
  const select = (key: string, choices: [string, string][]) => selectField(prefix + '-' + key, String(d[key as keyof EquipmentDraft]), choices, disabled);
  const groups: [string, string[]][] = [['近战', ['sword','greatsword','dagger','axe','great-weapon','blunt','spear','heavy-polearm']], ['远程', ['throwing','light-ranged','bow','crossbow','firearm','rifle','shotgun','heavy-rifle','energy','sprayer','magic']], ['重武器', ['autocannon','cannon','rocket','indirect-cannon']], ['其他', ['natural','demolition','summon']]];
  const weapons = '<select data-role="' + prefix + '-mechanism" ' + lock + '>' + groups.map(([name, ids]) => '<optgroup label="' + name + '">' + ids.map(id => '<option value="' + id + '" ' + (d.mechanism === id ? 'selected' : '') + '>' + WEAPON_CLASSES[id]!.name + '</option>').join('') + '</optgroup>').join('') + '</select>';
  const shields = Object.entries(SHIELD_CLASSES).filter(([id]) => opts.primaryHands !== 2 || ['buckler', 'energy-shield'].includes(id)).map(([id, value]): [string, string] => [id, value.name]);
  const item = d.kind === 'item';
  const anchor = `<p class="sub power-anchor">L${htmlText(d.power)} · ${htmlText(POWER_ANCHORS[Number(d.power)-1]?.name??'请选择1–10')}：${htmlText(POWER_ANCHORS[Number(d.power)-1]?.example??'')}</p>`;
  return `<div class="equipment-fields"><label>名称<input data-role="${prefix}-name" value="${htmlText(d.name)}" placeholder="留空采用类型名称" ${ro}></label>
    ${d.kind === 'weapon' ? `<label>武器${weapons}</label><p class="sub">${htmlText(WEAPON_CLASSES[d.mechanism]?.profile.desc ?? '')}</p>` : d.kind === 'armor' ? `<label>护甲${select('tier', armorChoices)}</label>`
      : d.kind === 'shield' ? `<label>盾类型${select('mechanism', shields).replace('</select>', opts.primaryHands === 2 && ['shield','tower-shield'].includes(d.mechanism) ? '<option value="'+d.mechanism+'" selected disabled hidden>'+SHIELD_CLASSES[d.mechanism as keyof typeof SHIELD_CLASSES].name+'（挂背）</option></select>' : '</select>')}</label>${opts.primaryHands === 2 && ['shield','tower-shield'].includes(d.mechanism) ? '<p class="sub">挂背（主武器双手）：双手武器只能配小盾或能量盾</p>' : ''}` : item ? `<label>形态${select('form', (Object.entries(ITEM_FORM_NAMES) as [string, string][]))}</label><label>效果<input data-role="${prefix}-effect" list="${prefix}-effect-examples" value="${htmlText(d.effect)}" placeholder="如buff治疗、物理范围投射、夜战专精" ${disabled ? 'readonly' : ''}><datalist id="${prefix}-effect-examples">${EFFECT_EXAMPLES.map((e) => `<option value="${htmlText(e)}"></option>`).join('')}</datalist></label>
        <p class="sub">${d.form==='single'?'使用后消耗，喝、敷类可用加速动作。效果写法与技能相同。':d.form==='charged'?'装备后每战可使用1–2次。效果写法与技能相同。':'装备后被动生效，件数不限。效果填写特质或“佩戴”加修正。'}</p>` : ''}
    <label>规格<input data-role="${prefix}-power" type="number" min="1" max="10" value="${htmlText(d.power)}" ${disabled ? 'readonly' : ''}></label></div>
    ${d.kind==='weapon'||item?anchor:''}
    <details class="equipment-advanced" data-detail-id="${prefix}-advanced"><summary>${item ? '属性修正' : '特殊配置与品质'}</summary><div class="equipment-fields">
    <label>属性修正（每项−10至+10）<input data-role="${prefix}-bonuses" value="${htmlText(enhancementLabel(d.bonuses))}" placeholder="如+3伤害-2精度；留空清除" ${disabled?'readonly':''}></label><p class="sub">${htmlText((ENHANCEMENT_STATS[bonusKind(d)]??[]).map(k=>BONUS_NAMES[k]).join('、'))}。单通道修正只影响该通道；穿透与防护每点0.2档。${['weapon','armor','shield'].includes(d.kind) ? '重量每+1使负载×1.1，每−1使负载÷1.1；各方向数量不限。' : ''}</p>
    ${item ? '' : `<label>品质<input data-role="${prefix}-quality" type="number" min="1" max="5" value="${htmlText(d.quality)}" ${disabled ? 'readonly' : ''}></label><label>装备体量${select('body', bodyChoices)}</label>`}
    ${d.kind === 'weapon' ? `<label>伤害转化${select('enchantment', [['', '保持原伤害类型'], ['thermal', '热能转化'], ['arcane', '奥术转化']])}</label><label class="check-field"><input data-role="${prefix}-stabilized" type="checkbox" ${d.stabilized ? 'checked' : ''} ${lock}>车载行进稳定</label>` : ''}
    ${d.kind === 'armor' ? `<label>防护侧重${select('profile', [['balanced', '综合防护'], ['kinetic', '侧重动能'], ['thermal', '侧重热能'], ['arcane', '侧重奥术']])}</label>` : ''}
    </div>${d.kind === 'weapon' ? '<p class="sub">稳定装置需要真实车辆平台，保留装填并让出部分火力。</p>' : d.kind === 'armor' ? '<p class="sub">防护侧重会从其他通道转移防护；上方单通道属性修正独立增减，不转移其他通道。</p>' : ''}</details>`;
}
