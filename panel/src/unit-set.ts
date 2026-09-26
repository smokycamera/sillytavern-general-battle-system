/** 正文战外绝对赋值。所有修改先在副本校验，装备实物与档案一起提交。 */
import type { Ability, Combatant, EquipmentSlot, ItemMechanics, ItemSpecification } from '../../engine/src/index.js';
import { compileItem, equipmentReason, resolveTraitId, traitRegistry, standardConditionMap, parseDice, generateUnit, type GenerateInput } from '../../engine/src/index.js';
import { validateEnhancements, validateChannelProtection, type Enhancements } from '../../engine/src/enhancements.js';
import { anchoredWeapon } from '../../engine/src/power-anchors.js';
import { MAX_PREPARED_SKILLS, compileSkill, resolvePreparedSkills, skillDefinitionId } from '../../engine/src/skill-catalog.js';
import { upgradeCombatSkills } from '../../engine/src/skill-upgrade.js';
import { synchronizePersonnel, nominalLife } from '../../engine/src/combat-model.js';
import { setMemberMaximum } from '../../engine/src/member-health.js';
import { spCapacity } from '../../engine/src/resources.js';
import { xpProgress } from '../../engine/src/xp.js';
import { materializeUnitRecord, unitRecordFromCombatant, combatantFromUnknown } from './unit-state.js';
import { prepareInventoryState, validateInventoryItem } from './inventory-state.js';
import { parseItemSpecification } from './item-spec.js';
import { parseAbilitySpec } from './tags.js';
import type { NarrativeSave } from './narrative-state.js';

type ObjectData = Record<string, unknown>;
export const UNIT_SET_ATTRIBUTES = ['id', 'data', 'reason', 'name', 'side', 'scale', 'archetype', 'level', 'xp', 'xpProgress', 'xpValue', 'hp', 'hpMax', 'memberHp', 'atk', 'def', 'spd', 'morale', 'moraleMax', 'state', 'body', 'mount', 'speed', 'weapon', 'weapon2', 'armor', 'shieldSpec', 'skills', 'traits', 'retired', 'note'] as const;
const direct = ['name', 'side', 'scale', 'archetype', 'level', 'xp', 'xpValue', 'hp', 'morale', 'status', 'body', 'mount', 'speedTier', 'tags', 'base', 'bonuses', 'resources', 'conditions', 'traits', 'traitSources', 'trinkets', 'recoverableWounded', 'formation', 'abilityState', 'fatigue'] as const;
const special = ['xpProgress', 'hpMax', 'memberHp', 'atk', 'def', 'spd', 'moraleMax', 'state', 'speed', 'weapon2', 'weapon', 'sidearm', 'armor', 'shield', 'skills', 'abilities', 'preparedAbilityIds', 'retired', 'note'];
const object = (value: unknown): value is ObjectData => !!value && typeof value === 'object' && !Array.isArray(value);
function requireObject(value: unknown, label: string): ObjectData { if (!object(value)) throw Error(label + '必须为对象'); return value; }
function keys(value: ObjectData, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw Error(`${label}不支持字段 ${key}`);
}
function number(value: unknown, label: string, min = -Number.MAX_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER, integer = false): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || integer && !Number.isSafeInteger(value)) throw Error(`${label}须为${min}–${max}范围内的${integer ? '整数' : '数值'}`);
}
function enumeration(value: unknown, allowed: readonly string[], label: string): void { if (!allowed.includes(String(value))) throw Error(label + '取值无效'); }
function strings(value: unknown, label: string): asserts value is string[] { if (!Array.isArray(value) || value.some(v => typeof v !== 'string' || !v.trim())) throw Error(label + '须为字符串数组'); }
function cleanJson(value: unknown): void {
  if (typeof value === 'number' && !Number.isFinite(value)) throw Error('数值必须有限');
  if (value && typeof value === 'object') for (const [key, entry] of Object.entries(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) throw Error('无效数据键');
    cleanJson(entry);
  }
}
/** 对象递归补丁；数组整体替换，null移除可选值。未知字段在各层拒绝。 */
function merge(target: ObjectData, patch: ObjectData): ObjectData {
  const next = structuredClone(target);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key];
    else next[key] = key !== 'bonuses' && object(value) && object(next[key]) ? merge(next[key] as ObjectData, value) : structuredClone(value);
  }
  return next;
}
export function parseUnitSet(attrs: Record<string, string>): ObjectData {
  if (!attrs.id?.trim()) throw Error('unit_set需要已有单位id');
  const data = attrs.data === undefined ? {} : requireObject(JSON.parse(attrs.data), 'data');
  for (const [key, text] of Object.entries(attrs)) {
    if (['id', 'data', 'reason'].includes(key)) continue;
    const field = ({ weapon2: 'sidearm', shieldSpec: 'shield', state: 'status', speed: 'speedTier' } as Record<string,string>)[key] ?? key;
    let value: unknown = text;
    if (['level', 'xp', 'xpProgress', 'xpValue', 'hp', 'hpMax', 'memberHp', 'atk', 'def', 'spd', 'morale', 'moraleMax', 'speedTier'].includes(field)) value = Number(text);
    if (['mount', 'retired'].includes(field)) { if (!['true','false'].includes(text)) throw Error(field + '需要true/false'); value = text === 'true'; }
    if (field === 'traits') value = text ? text.split(',') : [];
    if (Object.hasOwn(data, field) && JSON.stringify(data[field]) !== JSON.stringify(value)) throw Error(field + '与data冲突');
    data[field] = value;
  }
  validateUnitPatch(data);
  return data;
}
export function validateUnitPatch(data: ObjectData): void {
  cleanJson(data); keys(data, [...direct, ...special], 'unit_set.data');
  if (!Object.keys(data).length) throw Error('unit_set没有修改字段');
}

const weaponFields = ['name','baseDice','apDice','channel','penetration','hands','load','tags','range','minRange','pointBlankPolicy','pointBlankPenalty','indirect','attacks','reload','damageScale','splashTargets','splashFactor','ammunition'];
const armorFields = ['name','tier','protection','load','drScale','powerScale'];
const shieldFields = ['name','load','powerScale'];
function gearValue(input: unknown, previous: ItemMechanics | undefined, slot: EquipmentSlot, id: string, unit: Combatant, seed: string): ItemMechanics | undefined {
  if (input === null || input === '') return undefined;
  const config = typeof input === 'string' ? { spec: input } : requireObject(input, slot);
  keys(config, ['spec','values'], slot);
  let mechanics = previous ? structuredClone(previous) : undefined;
  if (config.spec !== undefined) {
    let spec: ItemSpecification, name: string | undefined;
    if (typeof config.spec === 'string') {
      const parts = config.spec.split(/[:：]/); if (parts.length > 2) throw Error('装备规格使用名称:效果L等级');
      if (parts.length === 2) name = parts.shift()!;
      spec = parseItemSpecification(parts[0]!);
    } else {
      const value = requireObject(config.spec, '装备spec');
      keys(value, ['kind','power','quality','body','bonuses','mechanism','enchantment','stabilized','tier','profile','name'], '装备spec');
      name = typeof value.name === 'string' ? value.name : undefined;
      spec = value as unknown as ItemSpecification;
    }
    number(spec.power, '装备等级', 1, 10, true);
    if (spec.quality !== undefined) number(spec.quality, '装备品质', 1, 5, true);
    if (spec.body !== undefined) enumeration(spec.body, ['human','large','vehicle','giant'], '装备体型');
    if (spec.kind === 'armor') number(spec.tier, '护甲档位', 0, 4, true);
    if (spec.kind === 'weapon' && spec.stabilized !== undefined && typeof spec.stabilized !== 'boolean') throw Error('稳定装置须为布尔值');
    if (spec.kind === 'weapon' && spec.enchantment !== undefined) enumeration(spec.enchantment, ['none','thermal','arcane'], '附魔');
    if (spec.kind === 'armor' && spec.profile !== undefined) enumeration(spec.profile, ['balanced','kinetic','thermal','arcane'], '防护类型');
    const old = previous && previous.kind !== 'consumable' ? previous.value : undefined;
    mechanics = compileItem({ ...spec, body: spec.body ?? unit.body, quality: spec.quality ?? old?.recipe?.quality }, { id, name: name ?? (old && 'name' in old ? old.name : undefined) ?? slot, seed: old?.recipe?.seed ?? seed, creatingUnit: true });
  }
  if (!mechanics || mechanics.kind === 'consumable' || mechanics.kind !== (['primary','sidearm'].includes(slot) ? 'weapon' : slot)) throw Error(slot + '需要匹配槽位的装备规格');
  if (config.values !== undefined) {
    const values = requireObject(config.values, '装备values');
    keys(values, mechanics.kind === 'weapon' ? weaponFields : mechanics.kind === 'armor' ? armorFields : shieldFields, '装备values');
    // 明确的原始数值指的是V4实际值，不能在入场时被威力投影覆盖。
    if (mechanics.kind === 'weapon') mechanics.value = { ...anchoredWeapon(mechanics.value)!, customized: true };
    mechanics.value = merge(mechanics.value as unknown as ObjectData, values) as unknown as typeof mechanics.value;
    if (mechanics.kind === 'armor' && values.protection !== undefined) mechanics.value.protectionOverride = values.protection !== null;
  }
  const gear = mechanics.value as unknown as ObjectData;
  for (const key of ['load','range','minRange','reload','attacks','splashTargets']) if (gear[key] !== undefined) number(gear[key], key, 0, Number.MAX_SAFE_INTEGER, true);
  if(gear.penetration!==undefined)number(gear.penetration,'穿透',0);
  if(gear.protection!==undefined)validateChannelProtection(gear.protection);
  for (const key of ['damageScale','drScale','powerScale']) if (gear[key] !== undefined) number(gear[key], key, Number.MIN_VALUE);
  if (gear.splashFactor !== undefined) number(gear.splashFactor, 'splashFactor', 0, 1);
  if (gear.pointBlankPenalty !== undefined) number(gear.pointBlankPenalty, 'pointBlankPenalty');
  if (gear.hands !== undefined) number(gear.hands, 'hands', 1, 2, true);
  if (gear.indirect !== undefined && typeof gear.indirect !== 'boolean') throw Error('indirect须为布尔值');
  if (gear.pointBlankPolicy !== undefined) enumeration(gear.pointBlankPolicy, ['allow','penalty','forbid'], '贴身策略');
  if (gear.ammunition !== undefined) enumeration(gear.ammunition, ['he','ap'], '弹种');
  if (gear.tags !== undefined) strings(gear.tags, '武器tags');
  if (gear.range !== undefined && Number(gear.minRange ?? 0) > Number(gear.range)) throw Error('最小射程不能超过最大射程');
  return mechanics;
}

const skillFields = ['name','desc','category','power','bonuses','weaponUse','areaExposure','damageBasis','delivery','weaponDamageMult','shape','fixedPower','requires','unavailableReason','channel','penetration','cost','cooldown','usesPerBattle','range','target','effects','damageScale'];
function skillValues(unit: Combatant, input: unknown): Ability[] {
  const entries = typeof input === 'string' ? input ? input.split(/[,，、;；]/) : [] : input;
  if (!Array.isArray(entries)) throw Error('skills须为规格列表，abilities须为完整记录列表');
  return entries.map((entry, index) => {
    const config = typeof entry === 'string' ? { spec: entry } : requireObject(entry, '技能');
    keys(config, ['id','spec','values'], '技能');
    let ability = typeof config.id === 'string' ? unit.abilities.find(a => a.id === config.id) : undefined;
    if (config.id !== undefined && !ability) throw Error('技能id不存在');
    ability = ability ? structuredClone(ability) : undefined;
    if (config.spec !== undefined) {
      const parsed = typeof config.spec === 'string' ? parseAbilitySpec(config.spec) : [];
      const spec = typeof config.spec === 'string' ? parsed.length === 1 ? { id: parsed[0]!.blueprintId, level: parsed[0]!.level, name: parsed[0]!.name, bonuses: parsed[0]!.bonuses } : undefined : requireObject(config.spec, '技能spec');
      if (!spec) throw Error('无法识别技能等级');
      keys(spec, ['id','level','name','bonuses'], '技能spec');
      const definition = skillDefinitionId(String(spec.id)); if (!definition) throw Error('未知技能效果');
      const power = spec.level ?? ability?.power ?? 5; number(power, '技能等级', 1, 10, true);
      const old = ability;
      ability = compileSkill({ id: definition, name: spec.name as string | undefined, bonuses: spec.bonuses as Enhancements | undefined }, power, unit.id);
      ability.id = old?.id ?? `${unit.id}:story-skill:${index}:${ability.id}`;
      const carrier = { ...unit, combatModel: 'cohort-v2' as const, abilities: [ability] }; upgradeCombatSkills(carrier);
    }
    if (!ability) throw Error('技能需要已有id或spec');
    if (config.values !== undefined) {
      const values = requireObject(config.values, '技能values'); keys(values, skillFields, '技能values');
      if (values.power !== undefined && values.power !== ability.power || values.bonuses !== undefined) {
        if (!ability.definitionId || !skillDefinitionId(ability.definitionId)) throw Error('无配方技能请直接设置效果数值，不能按公式重建');
        const power = values.power ?? ability.power ?? 5; number(power,'技能等级',1,10,true);
        const old = ability;
        ability=compileSkill({id:old.definitionId!,name:old.name,bonuses:values.bonuses===null?{}:(values.bonuses??old.bonuses) as Enhancements|undefined},power,unit.id);
        ability.id=old.id;ability.cooldownGroup=old.cooldownGroup;
        upgradeCombatSkills({...unit,combatModel:'cohort-v2',abilities:[ability]});
      }
      ability = merge(ability as unknown as ObjectData, values) as unknown as Ability;
      ability.customized = true;
    }
    validateAbility(ability);
    return ability;
  });
}
function validateAbility(a: Ability): void {
  if (typeof a.id !== 'string' || !a.id.trim()) throw Error('技能需要记录id');
  if (typeof a.name !== 'string' || !a.name.trim()) throw Error('技能需要名称');
  if (a.power !== undefined) number(a.power, '技能等级', 1, 10, true);
  validateEnhancements(a.bonuses, 'skill'); enumeration(a.target, ['enemy','ally','self','zone'], '技能目标');
  if (a.channel !== undefined) enumeration(a.channel, ['kinetic','thermal','arcane'], '伤害通道');
  if (a.shape !== undefined) enumeration(a.shape, ['single','burst'], '技能范围');
  if (a.requires !== undefined) enumeration(a.requires, ['shield','melee','weapon','reserve','corpse'], '技能前提');
  if (a.fixedPower !== undefined && typeof a.fixedPower !== 'boolean') throw Error('fixedPower须为布尔值');
  for (const [key,value] of Object.entries({ cooldown:a.cooldown, usesPerBattle:a.usesPerBattle })) if (value !== undefined) number(value, key, 0, Number.MAX_SAFE_INTEGER, true);
  if(a.penetration!==undefined)number(a.penetration,'技能穿透',0);
  if (a.cost) { keys(requireObject(a.cost, 'cost'), ['resource','amount'], 'cost'); if (typeof a.cost.resource !== 'string' || !a.cost.resource) throw Error('缺少消耗资源'); number(a.cost.amount, 'cost.amount', 0); }
  if (a.range) { keys(requireObject(a.range, 'range'), ['min','max','metric','requiresLineOfSight','allowEngaged'], 'range'); number(a.range.min,'range.min',0,Number.MAX_SAFE_INTEGER,true); number(a.range.max,'range.max',a.range.min,Number.MAX_SAFE_INTEGER,true); enumeration(a.range.metric,['grid','zone','global','self'],'距离模型'); for (const key of ['requiresLineOfSight','allowEngaged'] as const) if(a.range[key]!==undefined&&typeof a.range[key]!=='boolean')throw Error(key+'须为布尔值'); }
  if (!Array.isArray(a.effects)) throw Error('effects须为数组');
  for (const e of a.effects) {
    if (e.op === 'condition') { if (!standardConditionMap().has(e.conditionId)) throw Error('未知技能状态'); number(e.dur,'状态持续',1,99,true); }
    if (e.op === 'resource') { if (typeof e.resource !== 'string' || !e.resource) throw Error('缺少资源名'); number(e.amount,'资源变化'); }
    if (e.op === 'morale') number(e.amount,'士气变化');
    if (e.op === 'summon') { if (typeof e.templateId !== 'string' || !e.templateId) throw Error('缺少召唤模板'); number(e.count,'召唤数量',1,Number.MAX_SAFE_INTEGER,true); }
    if (e.op === 'damage' && e.apDice !== undefined) parseDice(e.apDice);
  }
}

/** 重算被训练/身体/强化改变的标准部分，保留原档的手动数值偏移；显式base随后覆盖。 */
function rebase(unit: Combatant, data: ObjectData): void {
  if (!['level','body','archetype','scale','bonuses','traits'].some(key=>Object.hasOwn(data,key))) return;
  const registry=traitRegistry();
  const baseline=(value: ObjectData) => {
    strings(value.traits,'traits');
    const traits=value.traits.map(name=>{const id=resolveTraitId(name,registry);if(!id)throw Error('未知特质：'+name);return id;});
    const input={name:unit.name,side:unit.side,rulesVersion:'v2',scale:value.scale,body:value.body,archetype:value.archetype,level:value.level,bonuses:value.bonuses??undefined,traits,armorTier:0} as GenerateInput;
    return generateUnit(input,{seed:'unit-set-baseline',registry,noVariance:true}).unit;
  };
  const old=baseline(unit as unknown as ObjectData), changed=merge(unit as unknown as ObjectData,Object.fromEntries(['level','body','archetype','scale','bonuses','traits'].filter(key=>Object.hasOwn(data,key)).map(key=>[key,data[key]]))), next=baseline(changed);
  for(const key of ['atk','def','spd'] as const)unit.base[key]+=next.base[key]-old.base[key];
  if(next.scale==='hero')unit.base.hpMax=Math.max(1,Math.min(1000,unit.base.hpMax+next.base.hpMax-old.base.hpMax));
  if(next.scale==='company')unit.base.moraleMax=(unit.base.moraleMax??old.base.moraleMax??0)+(next.base.moraleMax??0)-(old.base.moraleMax??0);
  else {delete unit.base.moraleMax;delete unit.morale;}
  if(unit.formation)setMemberMaximum(unit,Math.max(1,Math.round(unit.formation.memberHp+nominalLife(next)-nominalLife(old))));
  unit.xpValue=next.xpValue;
  unit.bakedTraitStats=next.bakedTraitStats;
  unit.tags=[...new Set([...unit.tags.filter(tag=>!old.tags.includes(tag)),...next.tags])];
}

export function applyUnitSet(save: NarrativeSave, id: string, patch: ObjectData, sourceId: string): NarrativeSave {
  validateUnitPatch(patch);
  if (save.battle && !(save.committedOutcomeIds ?? []).includes(`${save.battle.kind}:${String(save.battle.snap.seed)}`)) throw Error('unit_set仅限战外，须先结算当前战斗');
  const next = prepareInventoryState(save), previous = next.storage?.find(r => r.id === id);
  if (!previous) throw Error('unit_set目标档案不存在');
  const registry = traitRegistry();
  let unit = materializeUnitRecord(previous, registry);
  const oldProgress = xpProgress(unit)?.current ?? 0;
  const data = structuredClone(patch);
  for (const [alias, key] of Object.entries({state:'status',speed:'speedTier',weapon2:'sidearm'})) if (data[alias] !== undefined) {
    if (data[key] !== undefined) throw Error(alias + '与' + key + '不能同时指定'); data[key] = data[alias]; delete data[alias];
  }
  if (object(data.formation)) {
    if (data.formation.members !== undefined) {
      if (data.hp !== undefined && data.hp !== data.formation.members) throw Error('formation.members与hp冲突');
      data.hp = data.formation.members;
    }
    if (data.formation.capacity !== undefined) {
      if (data.hpMax !== undefined && data.hpMax !== data.formation.capacity) throw Error('formation.capacity与hpMax冲突');
      if (object(data.base) && data.base.hpMax !== undefined && data.base.hpMax !== data.formation.capacity) throw Error('formation.capacity与base.hpMax冲突');
      if (!object(data.base) || data.base.hpMax === undefined) data.hpMax = data.formation.capacity;
    }
  }
  for (const key of ['atk','def','spd','hpMax','moraleMax']) if (data[key] !== undefined) {
    data.base ??= {}; const base = requireObject(data.base,'base');
    if (base[key] !== undefined) throw Error(key + '与base冲突'); base[key] = data[key];
  }
  if (data.base !== undefined) keys(requireObject(data.base,'base'), ['atk','def','spd','hpMax','moraleMax'], 'base');
  rebase(unit,data);
  const fields = Object.fromEntries(direct.filter(key => Object.hasOwn(data,key)).map(key => [key,data[key]]));
  unit = merge(unit as unknown as ObjectData, fields) as unknown as Combatant;
  if(data.hp===undefined)unit.hp=Math.min(unit.hp,unit.base.hpMax);
  if(data.morale===undefined&&unit.base.moraleMax!==undefined)unit.morale=Math.min(unit.morale??unit.base.moraleMax,unit.base.moraleMax);
  if (typeof unit.name !== 'string' || !unit.name.trim()) throw Error('单位名称不能为空');
  enumeration(unit.side,['ally','enemy','neutral'],'side'); enumeration(unit.scale,['hero','company'],'scale');
  enumeration(unit.archetype ?? 'infantry',['infantry','ranged','mobile'],'archetype'); enumeration(unit.body ?? 'human',['human','large','vehicle','giant'],'body');
  number(unit.level,'训练等级',1,10,true); number(unit.base.hpMax,'hpMax',1,unit.scale==='hero'?1000:1e9,true);
  number(unit.hp,'hp',0,unit.base.hpMax,true);
  for (const key of ['atk','def','spd'] as const) number(unit.base[key],key);
  if (unit.base.moraleMax !== undefined) number(unit.base.moraleMax,'moraleMax',0);
  if (unit.morale !== undefined) number(unit.morale,'morale',0,unit.base.moraleMax ?? Number.MAX_SAFE_INTEGER);
  if (unit.speedTier !== undefined) number(unit.speedTier,'speedTier',1,5,true);
  if (unit.mount !== undefined && typeof unit.mount !== 'boolean') throw Error('mount须为布尔值');
  validateEnhancements(unit.bonuses,'unit');
  for (const key of ['xp','xpValue'] as const) if (unit[key] !== undefined) number(unit[key],key,0);
  if (data.xp !== undefined || data.xpProgress !== undefined || data.level !== undefined) {
    const progress = data.xpProgress ?? (data.level !== undefined ? 0 : Math.max(0,oldProgress + Number(data.xp ?? unit.xp ?? 0) - Number(previous.xp ?? 0)));
    number(progress,'xpProgress',0);
    // XP是累计账本；显式改等级不偷偷换算等级。下次经验结算再按本级进度升级。
    unit.xpCurve = 'effort-v1'; unit.xpLevelStart = (unit.xp ?? 0) - progress;
  }
  enumeration(unit.status,['ready','dying','dead','routing','fled'],'status');
  if (data.status === 'dead' || data.status === 'dying') {
    if (data.hp !== undefined && data.hp !== 0) throw Error('dead/dying必须hp=0'); unit.hp = 0;
  } else if (unit.hp === 0 && data.status === 'ready') throw Error('复活需要同时给出正数hp');
  else if (unit.hp === 0 && unit.status !== 'dying') unit.status = 'dead';
  else if (unit.hp > 0 && (unit.status === 'dead' || unit.status === 'dying')) throw Error('复活需要明确status=ready');
  if(unit.status==='dead'&&data.recoverableWounded===undefined)unit.recoverableWounded=0;
  else if(data.recoverableWounded===undefined&&unit.recoverableWounded!==undefined)unit.recoverableWounded=Math.min(unit.recoverableWounded,Math.max(0,unit.base.hpMax-unit.hp));
  if (data.retired !== undefined && typeof data.retired !== 'boolean') throw Error('retired须为布尔值');
  if (data.note !== undefined && data.note !== null && typeof data.note !== 'string') throw Error('note须为字符串');
  strings(unit.tags,'tags'); strings(unit.traits,'traits');
  unit.traits = unit.traits.map(name => { const resolved = resolveTraitId(name,registry); if (!resolved) throw Error('未知特质：'+name); return resolved; });
  unit.traits = [...new Set(unit.traits)];
  if(unit.trinkets!==undefined) {
    if(!Array.isArray(unit.trinkets))throw Error('trinkets须为数组');
    for(const t of unit.trinkets) {keys(requireObject(t,'trinket'),['id','name','grantsTrait','desc'],'trinket'); if(typeof t.id!=='string'||!t.id||typeof t.name!=='string'||!t.name||!registry.has(t.grantsTrait))throw Error('饰品身份、名称或特质无效');}
  }
  if (data.formation !== undefined) keys(requireObject(data.formation,'formation'), ['members','capacity','memberHp','health','woundedRemainder'], 'formation');
  if (unit.scale === 'hero') { if (data.formation || data.memberHp !== undefined) throw Error('个体不使用formation/memberHp'); delete unit.formation; }
  else {
    unit.combatModel = 'cohort-v2';
    unit.formation ??= { members:unit.hp,capacity:unit.base.hpMax,memberHp:Math.min(1000,nominalLife(unit)) };
    if (data.formation !== undefined) {
      const f = data.formation as ObjectData;
      if (f.members !== undefined) { if(data.hp!==undefined&&data.hp!==f.members)throw Error('formation.members与hp冲突'); number(f.members,'members',0,unit.base.hpMax,true); unit.hp=f.members; }
      if (f.capacity !== undefined) { if((data.base as ObjectData|undefined)?.hpMax!==undefined&&unit.base.hpMax!==f.capacity)throw Error('formation.capacity与hpMax冲突'); number(f.capacity,'capacity',1,1e9,true); unit.base.hpMax=f.capacity; }
    }
    if (data.memberHp !== undefined) { number(data.memberHp,'memberHp',1,1000,true); setMemberMaximum(unit,data.memberHp); }
    number(unit.formation.memberHp,'memberHp',1,1000,true);
    if (!(data.formation as ObjectData|undefined)?.health) synchronizePersonnel(unit,true);
    else { unit.formation.members=unit.hp; unit.formation.capacity=unit.base.hpMax; }
  }
  requireObject(unit.resources,'resources'); for (const [key,value] of Object.entries(unit.resources)) { if(key.startsWith('item:'))throw Error('携行物品数量由库存管理'); number(value,'资源 '+key,0); }
  if (unit.resources.reserve !== undefined) number(unit.resources.reserve,'reserve',0,2,true);
  if (!Array.isArray(unit.conditions)) throw Error('conditions须为数组');
  for (const c of unit.conditions) { if (!standardConditionMap().has(c.id)) throw Error('未知状态：'+c.id); number(c.dur,'状态持续',1,99,true); }
  number(unit.fatigue,'fatigue',0,4,true);
  for (const key of ['resources','abilityState','fatigue'] as const) if (Object.hasOwn(data,key)) (unit.storyState ??= {})[key] = true;

  const slotKeys = { weapon:'primary',sidearm:'sidearm',armor:'armor',shield:'shield' } as const;
  for (const [key,slot] of Object.entries(slotKeys) as [keyof typeof slotKeys,EquipmentSlot][]) {
    if (!Object.hasOwn(data,key)) continue;
    const old = next.inventory!.find(i => i.equippedTo?.unitId===id && i.equippedTo.slot===slot);
    const itemId = old?.id ?? `equipment:${sourceId}:${id}:${slot}`;
    const mechanics = gearValue(data[key],old?.mechanics,slot,itemId,unit,sourceId);
    if (mechanics && mechanics.kind !== 'consumable') {
      const item = { ...old, id:itemId, name:('name' in mechanics.value ? mechanics.value.name : undefined) || '盾牌',qty:1,lootType:mechanics.kind==='weapon'?'weapon':'armor',mechanics,assignedTo:id,equippedTo:{unitId:id,slot},revision:(old?.revision??0)+1 };
      validateInventoryItem(item);
      if (old?.mechanics) item.history = [...(old.history??[]),{revision:old.revision??1,name:old.name,mechanics:structuredClone(old.mechanics),sourceId}];
      next.inventory = [...next.inventory!.filter(i=>i.id!==itemId),item];
      (unit as unknown as ObjectData)[key] = structuredClone(mechanics.value);
    } else { if(old)delete old.equippedTo; delete unit[key]; }
  }
  if (data.skills !== undefined && data.abilities !== undefined) throw Error('skills与abilities不能同时指定');
  if (data.skills !== undefined) unit.abilities = skillValues(unit,data.skills);
  if (data.abilities !== undefined) {
    if (!Array.isArray(data.abilities)) throw Error('abilities须为完整技能记录数组');
    unit.abilities = structuredClone(data.abilities) as Ability[];
    for(const a of unit.abilities) { keys(requireObject(a,'ability'),['id','definitionId','sourceId','cooldownGroup','recipe','effectVersion','customized',...skillFields],'ability'); a.customized=true; validateAbility(a); }
  }
  if(new Set(unit.abilities.map(a=>a.id)).size!==unit.abilities.length)throw Error('技能id重复');
  const prepared = data.preparedAbilityIds ?? (data.skills !== undefined || data.abilities !== undefined ? unit.abilities.slice(0, MAX_PREPARED_SKILLS).map(a=>a.id) : unit.preparedAbilityIds?.filter(id=>unit.abilities.some(a=>a.id===id)) ?? []);
  strings(prepared,'preparedAbilityIds'); unit.preparedAbilityIds=resolvePreparedSkills(unit.abilities,prepared);
  if (data.resources !== undefined && unit.resources.SP !== undefined) number(unit.resources.SP,'SP',0,spCapacity(unit));
  else if(unit.storyState?.resources&&unit.resources.SP!==undefined)unit.resources.SP=Math.min(unit.resources.SP,spCapacity(unit));
  if(data.skills!==undefined||data.abilities!==undefined)unit.abilityState=unit.abilityState.filter(s=>unit.abilities.some(a=>(a.cooldownGroup??a.id)===s.abilityId));
  if(!Array.isArray(unit.abilityState))throw Error('abilityState须为数组');
  for(const s of unit.abilityState) { if(!unit.abilities.some(a=>(a.cooldownGroup??a.id)===s.abilityId))throw Error('冷却状态没有对应技能'); number(s.cdLeft,'cdLeft',0,Number.MAX_SAFE_INTEGER,true); number(s.used,'used',0,Number.MAX_SAFE_INTEGER,true); }
  if (['weapon','sidearm','armor','shield','body','scale'].some(key=>Object.hasOwn(data,key))) {
    const reason=equipmentReason(unit); if(reason)throw Error(reason);
  }
  // 校验精确值在写入前执行，避免归档函数的旧档容错替调用者截断或修复。
  combatantFromUnknown(unit);
  const record=unitRecordFromCombatant(unit,previous,{kind:'update',sourceId});
  record.equipmentManaged=true;
  record.preparedAbilityIds=[...unit.preparedAbilityIds];
  if(data.status==='ready'&&data.retired===undefined)delete record.retired;
  if(data.retired!==undefined)record.retired=data.retired as boolean;
  if(data.note!==undefined)record.note=data.note===null?undefined:data.note as string;
  next.storage=next.storage!.map(r=>r.id===id?record:r);
  const result=prepareInventoryState(next) as NarrativeSave;
  materializeUnitRecord(result.storage!.find(r=>r.id===id)!,registry);
  return result;
}
