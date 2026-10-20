import { displayNumber } from '../../engine/src/display-number.js';
import { MAX_PREPARED_SKILLS } from '../../engine/src/skill-catalog.js';
import { equipmentLoadLabel } from '../../engine/src/body.js';
import { enhancementLabel } from '../../engine/src/enhancements.js';
import { gridAbility } from '../../engine/src/small/skill-range.js';
import { singleLifeLimit } from '../../engine/src/health-limits.js';
import { memberDurability } from '../../engine/src/combat-model.js';
import {memberHealthSummary,memberHealth,memberHealthMax,memberNoun,hasMemberHealth} from '../../engine/src/member-health.js';
import {anchoredWeaponLabel,anchoredProtection,armorEffectLabel} from '../../engine/src/power-anchors.js';
import { fallbackAbilityRange } from '../../engine/src/actions.js';
import { armorTraitId, equipmentTraitIds, autoTraitLabel } from '../../engine/src/trait-sources.js';
import { playerTraitDescription, playerTraitLevelDescription } from './player-trait-description.js';
import { SKILL_CATEGORIES, skillMechanismName } from '../../engine/src/data/skill-mechanisms.js';
import { skillDefinitionName, skillDefinitionId } from '../../engine/src/skill-catalog.js';
import { WEAPON_CLASSES, ABILITY_BLUEPRINTS, traitCatalog, isGradedTrait, type Trait, type Combatant, abilityUsabilityReason, effectiveProtection, equipmentReason } from '../../engine/src/index.js';
import { bodyChoices, equipmentFields, captureEquipment, selectField, htmlText as esc } from './equipment-form.js';
import type { UnitDraft } from './unit-builder.js';
export function captureUnitDraft(prefix: string, d: UnitDraft, opts: { managed?: boolean } = {}): UnitDraft {
  const root = document.querySelector(`[data-builder-form="${prefix}"]`); if (!root) return d;
  const next = structuredClone(d);
  for (const key of ['name', 'side', 'scale', 'level', 'body', 'speedTier', 'hp', 'hpMax', 'memberHp', 'note', 'reserves'] as const) { const el = root.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-role="${prefix}-${key}"]`); if (el) next[key] = el.value; }
  for (const key of ['mount', 'autoPrepare'] as const) { const el = root.querySelector<HTMLInputElement>(`[data-role="${prefix}-${key}"]`); if (el) next[key] = el.checked; }
  // Managed gear is a frozen inventory projection, not an editable recipe. Even
  // untouched controls lose absent/zero bonuses and unsupported legacy values.
  if (!opts.managed) {
    for (const key of ['sidearmEnabled', 'shield'] as const) { const el = root.querySelector<HTMLInputElement>(`[data-role="${prefix}-${key}"]`); if (el) next[key] = el.checked; }
    for (const slot of ['primary', 'sidearm', 'armor', 'shieldGear'] as const) next[slot] = captureEquipment(prefix + '-' + slot, d[slot]);
  }
  next.traits = [...d.traits.filter((id) => ['large', 'titan'].includes(id)), ...root.querySelectorAll<HTMLInputElement>(`[data-role="${prefix}-trait"]:checked`)].map((el) => typeof el === 'string' ? el : el.value);
  next.traitLevels = {};
  for (const id of next.traits) if (isGradedTrait(id)) {
    const value = root.querySelector<HTMLInputElement>(`[data-role="${prefix}-trait-level"][data-trait="${id}"]`)?.value;
    const level = Number(value ?? d.traitLevels?.[id] ?? 1);
    next.traitLevels[id] = level;
  }
  if (!Object.keys(next.traitLevels).length && d.traitLevels === undefined) delete next.traitLevels;
  // 未改动的效果名沿用已存的定义：旧记录里现已不再提供的写法（例如攻击技能附带治疗）照常保留。
  next.skills = [...root.querySelectorAll<HTMLInputElement>(`[data-role="${prefix}-skill"]`)].map((el, i) => ({ id: d.skills[i] && el.value.trim() === skillDefinitionName(d.skills[i]!.id) ? d.skills[i]!.id : skillDefinitionId(el.value.trim()) ?? 'invalid:' + el.value, instanceId: d.skills[i]?.instanceId,
    name: root.querySelector<HTMLInputElement>(`[data-role="${prefix}-skill-name"][data-index="${i}"]`)?.value ?? '',
    power: root.querySelector<HTMLInputElement>(`[data-role="${prefix}-skill-power"][data-index="${i}"]`)?.value ?? '5',
    prepared: root.querySelector<HTMLInputElement>(`[data-role="${prefix}-skill-prepared"][data-index="${i}"]`)?.checked ?? d.skills[i]?.prepared ?? false }));
  return next;
}
export function unitForm(prefix: string, d: UnitDraft, registry: Map<string, Trait>, opts: { editing?: boolean; managed?: boolean } = {}): string {
  const select = (key: string, options: [string, string][], disabled = false) => selectField(prefix + '-' + key, String(d[key as keyof UnitDraft]), options, disabled);
  const input = (key: string, extra = '') => `<input data-role="${prefix}-${key}" value="${esc(d[key as keyof UnitDraft])}" ${extra}>`;
  const disabled = opts.managed ? 'disabled' : '';
  const armorTrait = d.traits.includes('natural-armor') ? undefined : armorTraitId(Number(d.armor.tier));
  const describe = playerTraitDescription;
  const choice = (t: Trait) => {
    const level = d.traitLevels?.[t.id] ?? 1, graded = isGradedTrait(t.id);
    return `<label title="${esc(graded ? t.name + 'L' + level + '：' + playerTraitLevelDescription(t.id, level, 'traits-items-v2') : describe(t))}"><input type="checkbox" data-role="${prefix}-trait" value="${t.id}" ${d.traits.includes(t.id) ? 'checked' : ''}>${t.name}${graded ? `<input type="number" min="1" max="10" value="${level}" data-role="${prefix}-trait-level" data-trait="${t.id}" aria-label="${t.name}等级">` : ''}</label>`;
  };
  const listed = new Set(traitCatalog(registry).flatMap((g) => g.traits.map((t) => t.id)));
  const legacy = d.traits.filter((id) => !listed.has(id)).flatMap((id) => registry.get(id) ? [registry.get(id)!] : []);
  const armorTraitDefinition = armorTrait ? registry.get(armorTrait) : undefined;
  const controlRules = [
    ['嘲讽','taunt','一次正常激活中敌对行动指向施加者，可接近、固守或自保'], ['致盲','blind','两次正常激活，自身感知/直接点名限1格或阵位，攻击−4、防御−2'], ['混乱','confuse','一次正常激活，按保存的随机目标普通攻击，加速不重选'], ['魅惑','charm','一次正常激活由AI按施术者一方行动，真实归属不变；可施给编队，现员每翻一倍抵抗+1；随队人物不能单独魅惑'],
    ['眩晕', 'stun', '跳过下一次行动'], ['定身', 'root', '限制移动'], ['沉默', 'silence', '限制魔法'], ['缴械', 'disarm', '限制手持武器'],
    ['惊惧', 'fear', '降低攻击与士气'], ['减速', 'slow', '降低先攻与移动，会战不能冲锋'], ['击退', 'push', '推离目标'], ['拉拽', 'pull', '拉近目标'],
  ];
  const selectedControls = controlRules.filter(([name]) => d.skills.some(s => skillDefinitionName(s.id).includes(name!)));
  return `<div data-builder-form="${prefix}" class="unit-builder"><div class="builder-basics">
    <label>名称${input('name', 'placeholder="角色或编队名称"')}</label><label>归属${select('side', [['ally', '我方'], ['enemy', '敌方'], ['neutral', '第三方']])}</label>
    <label>单位类型${select('scale', [['hero', '个体'], ['company', '编队']], opts.editing)}</label><label>训练${input('level', 'type="number" min="1" max="10" ' + (opts.editing ? 'readonly title="随经验成长"' : ''))}</label>
    ${d.scale === 'company' || opts.editing ? `<label>${d.scale === 'company' ? '编制上限' : '生命上限'}${input('hpMax', 'type="number" min="1" placeholder="50"' + (d.scale === 'hero' ? ' max="' + singleLifeLimit(d.damageModel) + '"' : ''))}</label>` : ''}
    ${opts.editing ? `<label>${d.scale === 'company' ? '当前人数' : '当前生命'}${input('hp', 'type="number" min="0"')}</label>` : ''}</div>
    <div class="builder-recommendation"><span>当前方案</span><b>${esc(d.primary.name || WEAPON_CLASSES[d.primary.mechanism]?.name || '主武器')} · ${['无甲', '轻甲', '中甲', '重甲', '超重甲'][Number(d.armor.tier)] ?? '护甲'}${d.mount ? ' · 骑乘' : ''}${d.shield ? ' · 携盾' : ''}</b><small>${opts.editing ? '修改后先预览，未改动的记录保持原样。' : '默认无甲、L1主武器；需要装备或特殊能力时再展开调整。'}</small></div>
    <details class="builder-section" data-detail-id="${prefix}-body"><summary>身体与装备 <span>调整配装</span></summary><p class="sub">基础速度决定移动格数，与训练先攻独立；护甲、负重、坐骑、地形、状态和疲劳继续影响实际机动。人形容量14，负重达到12时移动−1、先攻−2；大型容量18。</p>
      <div class="builder-basics"><label>身体${select('body', bodyChoices)}</label><label>基础速度${select('speedTier', [['', '随身体'], ['1', '1 · 迟缓'], ['2', '2 · 缓行'], ['3', '3 · 标准'], ['4', '4 · 快速'], ['5', '5 · 疾速']])}</label><label class="check-field"><input type="checkbox" data-role="${prefix}-mount" ${d.mount ? 'checked' : ''}>骑乘</label></div>
      ${opts.editing ? '<p class="sub">身体变化不会重铸原装备或增加生命/兵员。训练随经验成长。</p>' : ''}
      ${opts.managed ? '<p class="builder-hint">在配装页更换或编辑装备。<button data-action="workspace-tab" data-tab="inventory">前往配装</button></p>' : ''}
      <fieldset ${disabled}><legend>主武器</legend>${equipmentFields(prefix + '-primary', d.primary, { disabled: opts.managed })}</fieldset>
      <label class="check-field"><input type="checkbox" data-role="${prefix}-sidearmEnabled" ${d.sidearmEnabled ? 'checked' : ''} ${disabled}>携带副武器</label>
      ${d.sidearmEnabled ? `<fieldset ${disabled}><legend>副武器</legend>${equipmentFields(prefix + '-sidearm', d.sidearm, { disabled: opts.managed, sidearm: true })}</fieldset>` : ''}
      <fieldset ${disabled}><legend>护甲</legend>${equipmentFields(prefix + '-armor', d.armor, { disabled: opts.managed })}${armorTrait ? `<p class="sub" data-role="equipment-traits">装备自动特质：${esc(armorTraitDefinition?.name ?? armorTrait)}。${esc(armorTraitDefinition ? describe(armorTraitDefinition) : '')}</p>` : ''}</fieldset>
      <label class="check-field"><input type="checkbox" data-role="${prefix}-shield" ${d.shield ? 'checked' : ''} ${disabled}>携带盾牌</label>
      ${d.shield ? `<fieldset ${disabled}><legend>盾牌</legend>${equipmentFields(prefix + '-shieldGear', d.shieldGear, { disabled: opts.managed, primaryHands: ['greatsword','great-weapon','heavy-polearm'].includes(d.primary.mechanism) || (WEAPON_CLASSES[d.primary.mechanism]!.profile.range > 1 && !['throwing','light-ranged'].includes(d.primary.mechanism)) || d.primary.mechanism === 'sprayer' ? 2 : 1 })}</fieldset>` : ''}
    </details>
    <details class="builder-section" data-detail-id="${prefix}-skills"><summary>技能 <span>${d.skills.length ? d.skills.length + '项已学' : '按需要添加'}</span></summary>
      <label class="check-field"><input type="checkbox" data-role="${prefix}-autoPrepare" ${d.autoPrepare ? 'checked' : ''}>系统保留准备技能并补齐空缺</label>
      ${d.skills.map((s, i) => `<div class="builder-skill"><input data-role="${prefix}-skill" data-index="${i}" list="${prefix}-mechanisms" value="${esc(skillDefinitionName(s.id))}" aria-label="技能效果" placeholder="物理单体、魔法范围、增益、减益"><input data-role="${prefix}-skill-name" data-index="${i}" value="${esc(s.name)}" placeholder="自定名字（可省略）"><input data-role="${prefix}-skill-power" data-index="${i}" type="number" min="1" max="10" value="${esc(s.power)}" aria-label="技能等级" ${ABILITY_BLUEPRINTS[s.id]?.fixedPower ? 'readonly title="固定预备来源"' : ''}>
        ${!d.autoPrepare ? `<label class="check-field"><input type="checkbox" data-role="${prefix}-skill-prepared" data-index="${i}" ${s.prepared ? 'checked' : ''}>准备</label>` : ''}<button data-action="builder-skill-remove" data-builder="${prefix}" data-index="${i}" aria-label="移除此技能">移除</button></div>`).join('')}
      <datalist id="${prefix}-mechanisms">${[...SKILL_CATEGORIES.map((c) => c.name), '物理单体近战', '物理单体射击', '物理范围击退', '魔法范围热能+燃烧', '增益范围治疗', '增益加速', '增益净化', '增益回能', '增益屏障', '增益召唤', '增益特质飞行', '眩晕', '定身', '沉默', '缴械', '减速', '击退', '拉拽', '魔法范围扇形', '魔法范围直线', '魔法范围环形', '魔法范围连锁', '魔法范围火墙', '魔法范围毒雾', '增益烟幕', '增益治疗区域', '减益陷阱', '冲锋', '物理单体近战+突进', '物理单体射击+后撤', '魔法单体闪现', '突进', '闪现', '后撤'].map((name) => '<option value="' + esc(name) + '"></option>').join('')}</datalist>
      <button data-action="builder-skill-add" data-builder="${prefix}">添加技能</button><div class="control-presets" aria-label="快速添加控制技能"><span>控制效果</span>${controlRules.map(([name,id,rule])=>'<button data-action="builder-skill-add" data-builder="'+prefix+'" data-mechanism="generic:debuff:'+id+'" data-name="'+name+'" title="'+rule+'">'+name+'</button>').join('')}</div>${selectedControls.length?'<p class="sub">'+selectedControls.map(([name,,rule])=>name+'：'+rule).join('；')+'。目标可抵抗，净化可解除。</p>':''}${d.skills.some((s) => s.id === 'bp-call-reinforce') ? `<label>预备份额${input('reserves', 'type="number" min="0" max="2"')}</label>` : ''}
      <p class="sub">准备技能数量不限，同种效果共享冷却。效果可填“增益治疗”或“物理单体近战+突进”。</p>
      <details data-detail-id="${prefix}-skill-help"><summary>效果写法示例</summary><p>类型：物理单体、物理范围、魔法单体、魔法范围、增益、减益。可添加治疗、加速、定身等具体效果。</p><p>突进（冲锋）、闪现在出手前接近目标；后撤在出手后拉开距离。单写突进、闪现、后撤时，只移动自己。</p></details>
    </details>
    <details class="builder-section" data-detail-id="${prefix}-traits"><summary>特质 <span>${d.traits.length ? d.traits.length + '项' : '可选专长'}</span></summary><div class="builder-traits">${[...traitCatalog(registry), ...(legacy.length ? [{ group: '已有特质（可取消）', traits: legacy }] : [])].map((g) => `<div><h4>${g.group}</h4>${g.traits.map(choice).join('')}</div>`).join('')}</div><p class="sub">体量与重甲由身体和护甲自动提供，训练程度用训练等级，快慢用速度档；骑射需要实际坐骑，盾墙需要实际盾牌。</p></details>
    ${d.scale==='company'?`<label>单个${d.body==='vehicle'?'载具':'成员'}最大生命${input('memberHp','type="number" min="1" max="'+singleLifeLimit(d.damageModel)+'" placeholder="按同模板个体生命计算"')}</label><p class="sub">现员与成员生命分别保存。伤害先扣成员当前生命，归零后才减员；已有较低生命不会补满。</p>`:''}
    <p class="sub">个体与每名成员生命硬上限${singleLifeLimit(d.damageModel)}，超出自动截断；编队人数和总生命不受此单体上限限制。</p>
    <details class="builder-section" data-detail-id="${prefix}-notes"><summary>备注与自定义生命</summary><label>备注${input('note')}</label>${!opts.editing && d.scale === 'hero' ? `<div class="builder-basics"><label>生命上限${input('hpMax', 'type="number" min="1" max="'+singleLifeLimit(d.damageModel)+'" placeholder="系统计算"')}</label><label>当前生命${input('hp', 'type="number" min="0" max="'+singleLifeLimit(d.damageModel)+'" placeholder="首次默认满生命"')}</label></div><p class="sub">高生命个体也会因持续受创降低士气，具备不溃能力时继续作战。</p>` : ''}</details>
  </div>`;
}
export function buildPreview(unit: Combatant, before?: Combatant): string {
  const change = (value: string, old?: string) => old && value !== old ? esc(old) + ' → ' + esc(value) : esc(value);
  const gear = (u: Combatant) => [u.weapon?.name ?? '主手空置', u.sidearm && '副武器' + u.sidearm.name, u.armor?.name ?? '无甲', u.shield && '携盾'].filter(Boolean).join(' · ');
  return `<div class="builder-preview" data-role="builder-preview"><h3>${before ? '确认档案变化' : '确认加入队伍'}</h3><b>${esc(unit.name)}</b><p>${change(`${displayNumber(unit.hp)}/${displayNumber(unit.base.hpMax)}`, before && `${displayNumber(before.hp)}/${displayNumber(before.base.hpMax)}`)} ${unit.scale === 'hero' ? '生命' : '人数'} · 训练${unit.level}${unit.scale!=='hero'?' · 成员耐久 '+displayNumber(memberDurability(unit)):''}</p><p>${change(gear(unit), before && gear(before))}</p>
    ${hasMemberHealth(unit)?`<p>总生命 ${displayNumber(memberHealth(unit))}/${displayNumber(memberHealthMax(unit))} · ${esc(memberHealthSummary(unit))}</p>`:''}
    <p>${esc(anchoredWeaponLabel(unit.weapon,unit.damageModel))}</p><p>${esc(equipmentLoadLabel(unit))} · 防护 动能${displayNumber(anchoredProtection(unit, 'kinetic'))} / 热能${displayNumber(anchoredProtection(unit, 'thermal'))} / 奥术${displayNumber(anchoredProtection(unit, 'arcane'))}${armorEffectLabel(unit) ? ' · ' + esc(armorEffectLabel(unit)) : ''}</p>
    ${equipmentTraitIds(unit).length ? `<p data-role="equipment-traits">装备自动特质：${equipmentTraitIds(unit).map(id => esc(autoTraitLabel(id))).join('、')}，无需另行勾选。</p>` : ''}
    ${equipmentReason(unit) ? `<p class="grid-reason">${esc(equipmentReason(unit))}</p>` : ''}
    ${unit.abilities.length ? `<div class="builder-skills-preview">${unit.abilities.map((a) => `<p><b>${esc(a.name)}</b> · ${esc(skillDefinitionName(a.definitionId ?? a.id))} L${a.power ?? 5}${esc(enhancementLabel(a.bonuses))}<br><small>格子射程${displayNumber(fallbackAbilityRange(unit, gridAbility(a, unit.armsModel), true).min)}–${displayNumber(fallbackAbilityRange(unit, gridAbility(a, unit.armsModel), true).max)}／会战${displayNumber(fallbackAbilityRange(unit, a).min)}–${displayNumber(fallbackAbilityRange(unit, a).max)}阵距 · ${a.cost ? (a.cost.resource==='SP'?'精力':a.cost.resource) + ' ' + displayNumber(a.cost.amount) : '无资源消耗'} · 冷却${a.cooldown ?? 0} · ${esc(abilityUsabilityReason(unit, a) ?? '已准备，可用')}</small></p>`).join('')}</div>` : ''}
    <div class="row"><button class="primary" data-action="builder-confirm">确认${before ? '保存修改' : '加入队伍'}</button><button data-action="builder-cancel-preview">返回调整</button></div></div>`;
}
