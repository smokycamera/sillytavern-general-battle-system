import { MAX_PREPARED_SKILLS } from '../../engine/src/skill-catalog.js';
import { enhancementLabel } from '../../engine/src/enhancements.js';
import { gridAbility } from '../../engine/src/small/skill-range.js';
import { SINGLE_LIFE_LIMIT } from '../../engine/src/health-limits.js';
import { memberDurability } from '../../engine/src/combat-model.js';
import {memberHealthSummary,memberHealth,memberHealthMax,memberNoun,hasMemberHealth} from '../../engine/src/member-health.js';
import {anchoredWeaponLabel,anchoredProtection,armorPowerScale} from '../../engine/src/power-anchors.js';
import { fallbackAbilityRange } from '../../engine/src/actions.js';
import { armorTraitId, equipmentTraitIds } from '../../engine/src/trait-sources.js';
import { SKILL_CATEGORIES, skillMechanismName } from '../../engine/src/data/skill-mechanisms.js';
import { skillDefinitionName, skillDefinitionId } from '../../engine/src/skill-catalog.js';
import { WEAPON_CLASSES, ABILITY_BLUEPRINTS, traitCatalog, traitDescription, type Trait, type Combatant, abilityUsabilityReason, effectiveProtection, equipmentReason, BODY } from '../../engine/src/index.js';
import { bodyChoices, equipmentFields, captureEquipment, selectField, htmlText as esc } from './equipment-form.js';
import type { UnitDraft } from './unit-builder.js';
export function captureUnitDraft(prefix: string, d: UnitDraft): UnitDraft {
  const root = document.querySelector(`[data-builder-form="${prefix}"]`); if (!root) return d;
  const next = structuredClone(d);
  for (const key of ['name', 'side', 'scale', 'level', 'body', 'speedTier', 'hp', 'hpMax', 'memberHp', 'note', 'reserves'] as const) { const el = root.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-role="${prefix}-${key}"]`); if (el) next[key] = el.value; }
  for (const key of ['mount', 'sidearmEnabled', 'shield', 'autoPrepare'] as const) { const el = root.querySelector<HTMLInputElement>(`[data-role="${prefix}-${key}"]`); if (el) next[key] = el.checked; }
  for (const slot of ['primary', 'sidearm', 'armor', 'shieldGear'] as const) next[slot] = captureEquipment(prefix + '-' + slot, d[slot]);
  next.traits = [...d.traits.filter((id) => ['large', 'titan'].includes(id)), ...root.querySelectorAll<HTMLInputElement>(`[data-role="${prefix}-trait"]:checked`)].map((el) => typeof el === 'string' ? el : el.value);
  next.skills = [...root.querySelectorAll<HTMLInputElement>(`[data-role="${prefix}-skill"]`)].map((el, i) => ({ id: skillDefinitionId(el.value.trim()) ?? 'invalid:' + el.value, instanceId: d.skills[i]?.instanceId,
    name: root.querySelector<HTMLInputElement>(`[data-role="${prefix}-skill-name"][data-index="${i}"]`)?.value ?? '',
    power: root.querySelector<HTMLInputElement>(`[data-role="${prefix}-skill-power"][data-index="${i}"]`)?.value ?? '5',
    prepared: root.querySelector<HTMLInputElement>(`[data-role="${prefix}-skill-prepared"][data-index="${i}"]`)?.checked ?? d.skills[i]?.prepared ?? false }));
  return next;
}
export function unitForm(prefix: string, d: UnitDraft, registry: Map<string, Trait>, opts: { editing?: boolean; managed?: boolean } = {}): string {
  const select = (key: string, options: [string, string][], disabled = false) => selectField(prefix + '-' + key, String(d[key as keyof UnitDraft]), options, disabled);
  const input = (key: string, extra = '') => `<input data-role="${prefix}-${key}" value="${esc(d[key as keyof UnitDraft])}" ${extra}>`;
  const disabled = opts.managed ? 'disabled' : '';
  const armorTrait = armorTraitId(Number(d.armor.tier));
  const armorTraitDefinition = armorTrait ? registry.get(armorTrait) : undefined;
  return `<div data-builder-form="${prefix}" class="unit-builder"><div class="builder-basics">
    <label>名称${input('name', 'placeholder="角色或编队名称"')}</label><label>归属${select('side', [['ally', '我方'], ['enemy', '敌方']])}</label>
    <label>人数形式${select('scale', [['hero', '个体'], ['company', '编队']], opts.editing)}</label><label>训练${input('level', 'type="number" min="1" max="10" ' + (opts.editing ? 'readonly title="随经验成长"' : ''))}</label>
    ${d.scale === 'company' || opts.editing ? `<label>${d.scale === 'company' ? '编制上限' : '生命上限'}${input('hpMax', 'type="number" min="1" placeholder="50"' + (d.scale === 'hero' ? ' max="' + SINGLE_LIFE_LIMIT + '"' : ''))}</label>` : ''}
    ${opts.editing ? `<label>${d.scale === 'company' ? '当前人数' : '当前生命'}${input('hp', 'type="number" min="0"')}</label>` : ''}</div>
    <div class="builder-recommendation"><span>当前方案</span><b>${esc(d.primary.name || WEAPON_CLASSES[d.primary.mechanism]?.name || '主武器')} · ${['无甲', '轻甲', '中甲', '重甲', '超重甲'][Number(d.armor.tier)] ?? '护甲'}${d.mount ? ' · 骑乘' : ''}${d.shield ? ' · 携盾' : ''}</b><small>${opts.editing ? '修改后先预览，未改动的记录保持原样。' : '默认无甲、L1主武器；需要装备或特殊能力时再展开调整。'}</small></div>
    <details class="builder-section" data-detail-id="${prefix}-body"><summary>身体与装备 <span>调整配装</span></summary><p class="sub">基础速度决定移动格数，与训练先攻独立；护甲、坐骑、地形、状态和疲劳继续影响实际机动。</p>
      <div class="builder-basics"><label>身体${select('body', bodyChoices)}</label><label>基础速度${select('speedTier', [['', '随身体'], ['1', '1 · 迟缓'], ['2', '2 · 缓行'], ['3', '3 · 标准'], ['4', '4 · 快速'], ['5', '5 · 疾速']])}</label><label class="check-field"><input type="checkbox" data-role="${prefix}-mount" ${d.mount ? 'checked' : ''}>明确骑乘</label></div>
      ${opts.editing ? '<p class="sub">身体变化不会重铸原装备或增加生命/兵员。训练随经验成长。</p>' : ''}
      ${opts.managed ? '<p class="builder-hint">这套装备由实物库存管理。<button data-action="workspace-tab" data-tab="inventory">前往配装与改造</button></p>' : ''}
      <fieldset ${disabled}><legend>主武器</legend>${equipmentFields(prefix + '-primary', d.primary, { disabled: opts.managed })}</fieldset>
      <label class="check-field"><input type="checkbox" data-role="${prefix}-sidearmEnabled" ${d.sidearmEnabled ? 'checked' : ''} ${disabled}>携带副武器</label>
      ${d.sidearmEnabled ? `<fieldset ${disabled}><legend>副武器</legend>${equipmentFields(prefix + '-sidearm', d.sidearm, { disabled: opts.managed, sidearm: true })}</fieldset>` : ''}
      <fieldset ${disabled}><legend>护甲</legend>${equipmentFields(prefix + '-armor', d.armor, { disabled: opts.managed })}${armorTrait ? `<p class="sub" data-role="equipment-traits">装备自动特质：${esc(armorTraitDefinition?.name ?? armorTrait)}。${esc(armorTraitDefinition ? traitDescription(armorTraitDefinition, { rulesVersion: 'v2' }) : '')}</p>` : ''}</fieldset>
      <label class="check-field"><input type="checkbox" data-role="${prefix}-shield" ${d.shield ? 'checked' : ''} ${disabled}>携带盾牌</label>
      ${d.shield ? `<fieldset ${disabled}><legend>盾牌</legend>${equipmentFields(prefix + '-shieldGear', d.shieldGear, { disabled: opts.managed })}</fieldset>` : ''}
    </details>
    <details class="builder-section" data-detail-id="${prefix}-skills"><summary>技能 <span>${d.skills.length ? d.skills.length + '项已学' : '按需要添加'}</span></summary>
      <label class="check-field"><input type="checkbox" data-role="${prefix}-autoPrepare" ${d.autoPrepare ? 'checked' : ''}>系统保留准备技能并补齐空缺</label>
      ${d.skills.map((s, i) => `<div class="builder-skill"><input data-role="${prefix}-skill" data-index="${i}" list="${prefix}-mechanisms" value="${esc(skillDefinitionName(s.id))}" aria-label="技能效果" placeholder="物理单体、魔法范围、增益、减益"><input data-role="${prefix}-skill-name" data-index="${i}" value="${esc(s.name)}" placeholder="自定名字（可省略）"><input data-role="${prefix}-skill-power" data-index="${i}" type="number" min="1" max="10" value="${esc(s.power)}" aria-label="技能等级" ${ABILITY_BLUEPRINTS[s.id]?.fixedPower ? 'readonly title="固定预备来源"' : ''}>
        ${!d.autoPrepare ? `<label class="check-field"><input type="checkbox" data-role="${prefix}-skill-prepared" data-index="${i}" ${s.prepared ? 'checked' : ''}>准备</label>` : ''}<button data-action="builder-skill-remove" data-builder="${prefix}" data-index="${i}" aria-label="移除此技能">移除</button></div>`).join('')}
      <datalist id="${prefix}-mechanisms">${[...SKILL_CATEGORIES.map((c) => c.name), '物理单体近战', '物理单体射击', '物理范围击退', '魔法范围热能+燃烧', '增益范围治疗', '增益加速', '增益净化', '增益回能', '增益屏障', '增益召唤', '增益特质飞行', '眩晕', '定身', '沉默', '缴械', '减速', '击退', '拉拽', '魔法范围扇形', '魔法范围直线', '魔法范围环形', '魔法范围连锁', '魔法范围火墙', '魔法范围毒雾', '增益烟幕', '增益治疗区域', '减益陷阱'].map((name) => '<option value="' + esc(name) + '"></option>').join('')}</datalist>
      <button data-action="builder-skill-add" data-builder="${prefix}">添加技能</button><div class="control-presets" aria-label="快速添加控制技能"><span>控制效果</span>${[['眩晕','stun'],['定身','root'],['沉默','silence'],['缴械','disarm'],['惊惧','fear'],['减速','slow'],['击退','push'],['拉拽','pull']].map(([name,id])=>'<button data-action="builder-skill-add" data-builder="'+prefix+'" data-mechanism="generic:debuff:'+id+'" data-name="'+name+'">'+name+'</button>').join('')}</div><p class="sub">眩晕会跳过下一次行动；定身只限制移动；沉默限制魔法；缴械限制手持武器。目标可以抵抗，净化可以解除。</p>${d.skills.some((s) => s.id === 'bp-call-reinforce') ? `<label>预备份额${input('reserves', 'type="number" min="0" max="2"')}</label>` : ''}
      <p class="sub">填写自定义名称、效果类型与等级。六类为物理单体、物理范围、魔法单体、魔法范围、增益、减益；需要具体效果时在效果后加治疗、加速、定身等。最多准备${MAX_PREPARED_SKILLS}项，同种效果共享冷却。旧记录名称仅用于保留原效果。</p>
    </details>
    <details class="builder-section" data-detail-id="${prefix}-traits"><summary>特质 <span>${d.traits.length ? d.traits.length + '项' : '可选专长'}</span></summary><div class="builder-traits">${traitCatalog(registry).map((g) => `<div><h4>${g.group}</h4>${g.traits.filter((t) => !['large', 'titan'].includes(t.id)).map((t) => `<label title="${esc(traitDescription(t, { rulesVersion: 'v2' }))}"><input type="checkbox" data-role="${prefix}-trait" value="${t.id}" ${d.traits.includes(t.id) ? 'checked' : ''}>${t.name}</label>`).join('')}</div>`).join('')}</div><p class="sub">体量性质由身体提供；骑射、盾墙等专长仍需要实际坐骑或装备。</p></details>
    ${d.scale==='company'?`<label>单个${d.body==='vehicle'?'载具':'成员'}最大生命${input('memberHp','type="number" min="1" max="'+SINGLE_LIFE_LIMIT+'" placeholder="按同模板个体生命计算"')}</label><p class="sub">现员与成员生命分别保存。伤害先扣成员当前生命，归零后才减员；已有较低生命不会补满。</p>`:''}
    <p class="sub">个体与每名成员生命硬上限${SINGLE_LIFE_LIMIT}，超出自动截断；编队人数和总生命不受此单体上限限制。</p>
    <details class="builder-section" data-detail-id="${prefix}-notes"><summary>备注与自定义生命</summary><label>备注${input('note')}</label>${!opts.editing && d.scale === 'hero' ? `<div class="builder-basics"><label>生命上限${input('hpMax', 'type="number" min="1" max="'+SINGLE_LIFE_LIMIT+'" placeholder="系统计算"')}</label><label>当前生命${input('hp', 'type="number" min="0" max="'+SINGLE_LIFE_LIMIT+'" placeholder="首次默认满生命"')}</label></div><p class="sub">高生命个体也会因持续受创降低士气，具备不溃能力时继续作战。</p>` : ''}</details>
  </div>`;
}
export function buildPreview(unit: Combatant, before?: Combatant): string {
  const change = (value: string, old?: string) => old && value !== old ? esc(old) + ' → ' + esc(value) : esc(value);
  const gear = (u: Combatant) => [u.weapon?.name ?? '主手空置', u.sidearm && '副武器' + u.sidearm.name, u.armor?.name ?? '无甲', u.shield && '携盾'].filter(Boolean).join(' · ');
  const load = (unit.weapon?.load ?? 0) + (unit.sidearm?.load ?? 0) + (unit.armor?.load ?? 0) + (unit.shield?.load ?? 0) + Object.values(unit.accessories ?? {}).reduce((sum,item)=>sum+(item?.load??0),0);
  return `<div class="builder-preview" data-role="builder-preview"><h3>${before ? '确认档案变化' : '确认加入队伍'}</h3><b>${esc(unit.name)}</b><p>${change(`${unit.hp}/${unit.base.hpMax}`, before && `${before.hp}/${before.base.hpMax}`)} ${unit.scale === 'hero' ? '生命' : '人数'} · 训练${unit.level}${unit.scale!=='hero'?' · 成员耐久 '+memberDurability(unit):''}</p><p>${change(gear(unit), before && gear(before))}</p>
    ${hasMemberHealth(unit)?`<p>总生命 ${memberHealth(unit)}/${memberHealthMax(unit)} · ${esc(memberHealthSummary(unit))}</p>`:''}
    <p>${esc(anchoredWeaponLabel(unit.weapon))}</p><p>负重 ${load}/${BODY[unit.body ?? 'human'].capacity} · 防护 动能${anchoredProtection(unit, 'kinetic')} / 热能${anchoredProtection(unit, 'thermal')} / 奥术${anchoredProtection(unit, 'arcane')} · 装甲等效耐久×${Number(armorPowerScale(unit).toFixed(2))}</p>
    ${equipmentTraitIds(unit).length ? `<p data-role="equipment-traits">装备自动特质：${equipmentTraitIds(unit).map(id => esc(id === 'super-heavy' ? '超重装甲（先攻−2，无额外防御）' : '重甲（先攻−1，无额外防御）')).join('、')}，无需另行勾选。</p>` : ''}
    ${equipmentReason(unit) ? `<p class="grid-reason">${esc(equipmentReason(unit))}</p>` : ''}
    ${unit.abilities.length ? `<div class="builder-skills-preview">${unit.abilities.map((a) => `<p><b>${esc(a.name)}</b> · ${esc(skillDefinitionName(a.definitionId ?? a.id))} L${a.power ?? 5}${esc(enhancementLabel(a.bonuses))}<br><small>格子射程${fallbackAbilityRange(unit, gridAbility(a)).min}–${fallbackAbilityRange(unit, gridAbility(a)).max}／会战${fallbackAbilityRange(unit, a).min}–${fallbackAbilityRange(unit, a).max}阵距 · ${a.cost ? (a.cost.resource==='SP'?'精力':a.cost.resource) + ' ' + a.cost.amount : '无资源消耗'} · 冷却${a.cooldown ?? 0} · ${esc(abilityUsabilityReason(unit, a) ?? '已准备，可用')}</small></p>`).join('')}</div>` : ''}
    <div class="row"><button class="primary" data-action="builder-confirm">确认${before ? '保存修改' : '加入队伍'}</button><button data-action="builder-cancel-preview">返回调整</button></div></div>`;
}

