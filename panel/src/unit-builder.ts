import { spCapacity } from '../../engine/src/resources.js';
import { prepareCombatModel,nominalLife } from '../../engine/src/combat-model.js';
import { capSingleLife } from '../../engine/src/health-limits.js';
import {setMemberMaximum} from '../../engine/src/member-health.js';
import { upgradeCombatSkills } from '../../engine/src/skill-upgrade.js';
import { V4_D20 } from '../../engine/src/rules.js';
import { BODY } from '../../engine/src/body.js';
import { skillDefinitionKnown, skillDefinitionName } from '../../engine/src/skill-catalog.js';
import { generateUnit, compileItem, equipmentReason, validateMount, learnAbilities, normalizeBakedTraitStats, ABILITY_BLUEPRINTS, abilityPower, type Combatant, type GenerateInput, type Trait, type ItemMechanics } from '../../engine/src/index.js';
import { equipmentDraft, equipmentSpecification, type EquipmentDraft } from './equipment-form.js';
import { editUnitRecord, unitRecordFromCombatant, type UnitRecord } from './unit-state.js';
export interface UnitDraft {
  memberHp?:string;
  name: string; side: string; scale: string; level: string; body: string; speedTier: string; mount: boolean; hp: string; hpMax: string; note: string; reserves: string;
  primary: EquipmentDraft; sidearm: EquipmentDraft; armor: EquipmentDraft; shieldGear: EquipmentDraft; sidearmEnabled: boolean; shield: boolean;
  traits: string[]; skills: { id: string; name: string; power: string; prepared: boolean; instanceId?: string }[]; autoPrepare: boolean;
}
export function newUnitDraft(): UnitDraft {
  return { name: '', side: 'ally', scale: 'hero', level: '3', body: 'human', speedTier: '', mount: false, hp: '', hpMax: '', memberHp:'',note: '', reserves: '0',
    primary: { ...equipmentDraft(), power: '1' }, sidearm: { ...equipmentDraft(), power: '1' }, armor: { ...equipmentDraft('armor'), tier: '0', power: '1' }, shieldGear: equipmentDraft('shield'), sidearmEnabled: false, shield: false, traits: [], skills: [], autoPrepare: true };
}
export function unitDraftFromRecord(r: UnitRecord): UnitDraft {
  const u = r.snapshot!, body = u.body ?? 'human';
  return { ...newUnitDraft(), name: r.name, side: r.side, scale: r.scale, level: String(r.level), body, speedTier: u.speedTier === undefined ? '' : String(u.speedTier), mount: !!u.mount, hp: String(r.hp), hpMax: String(r.base.hpMax),memberHp:String(u.formation?.memberHp??nominalLife(u)), note: r.note ?? '', reserves: String(u.resources.reserve ?? 0),
    primary: equipmentDraft('weapon', body, u.weapon ? { kind: 'weapon', value: u.weapon } : undefined, u.weapon?.name),
    sidearm: equipmentDraft('weapon', body, u.sidearm ? { kind: 'weapon', value: u.sidearm } : undefined, u.sidearm?.name),
    armor: equipmentDraft('armor', body, u.armor ? { kind: 'armor', value: u.armor } : undefined, u.armor?.name),
    shieldGear: equipmentDraft('shield', body, u.shield ? { kind: 'shield', value: u.shield } : undefined),
    sidearmEnabled: !!u.sidearm, shield: !!u.shield, traits: [...r.traits], autoPrepare: false,
    skills: u.abilities.filter((a) => skillDefinitionKnown(a.definitionId ?? a.id)).map((a) => ({ id: a.definitionId ?? a.id, instanceId: a.id, name: a.name, power: String(abilityPower(u, a)), prepared: !!u.preparedAbilityIds?.includes(a.id) })) };
}
function integer(s: string, min: number, max: number, label: string): number {
  const n = Number(s); if (!s.trim() || !Number.isSafeInteger(n) || n < min || n > max) throw Error(label + '必须为' + min + '–' + max + '的整数'); return n;
}
function identityInput(d: UnitDraft): GenerateInput {
  if (!d.name.trim()) throw Error('请填写单位名称');
  if (!['ally', 'enemy'].includes(d.side) || !['hero', 'company'].includes(d.scale)) throw Error('单位归属或人数形式无效');
  return { name: d.name.trim(), side: d.side as 'ally' | 'enemy', scale: d.scale as 'hero' | 'company', level: integer(d.level, 1, 10, '训练'), rulesVersion: 'v2', traits: [...d.traits], body: d.body as GenerateInput['body'], mount: d.mount, speedTier: d.speedTier ? integer(d.speedTier, 1, 5, '速度档位') : undefined,
    hpMax: d.hpMax.trim() ? (d.scale === 'hero' ? capSingleLife(integer(d.hpMax, 1, Number.MAX_SAFE_INTEGER, '生命上限')) : integer(d.hpMax, 1, 1e9, '编制上限')) : d.scale === 'company' ? 50 : undefined,
    hp: d.hp.trim() ? (d.scale === 'hero' ? capSingleLife(integer(d.hp, 0, Number.MAX_SAFE_INTEGER, '当前生命')) : integer(d.hp, 0, 1e9, '当前人数')) : undefined,
    reserves: integer(d.reserves, 0, 2, '预备份额'),
    abilityBlueprints: d.skills.filter((s) => s.id).map((s) => ({ id: s.id, instanceId: s.instanceId, name: s.name.trim() || undefined, ...(ABILITY_BLUEPRINTS[s.id]?.fixedPower ? {} : { level: integer(s.power, 1, 10, '技能规格') }) })) };
}
const mechanics = (u: Combatant, slot: 'primary' | 'sidearm' | 'armor' | 'shieldGear'): ItemMechanics | undefined => slot === 'primary' ? u.weapon && { kind: 'weapon', value: u.weapon } : slot === 'sidearm' ? u.sidearm && { kind: 'weapon', value: u.sidearm } : slot === 'armor' ? u.armor && { kind: 'armor', value: u.armor } : u.shield && { kind: 'shield', value: u.shield };
function setGear(u: Combatant, d: UnitDraft, oldDraft?: UnitDraft): void {
  for (const slot of ['primary', 'sidearm', 'armor', 'shieldGear'] as const) {
    const enabled = slot === 'sidearm' ? d.sidearmEnabled : slot === 'shieldGear' ? d.shield : true;
    const old = mechanics(u, slot), draft = d[slot], before = oldDraft?.[slot];
    if (!old && before && ['primary', 'armor'].includes(slot) && JSON.stringify(before) === JSON.stringify(draft)) continue;
    if (!enabled) { if (slot === 'sidearm') delete u.sidearm; if (slot === 'shieldGear') delete u.shield; continue; }
    const unchanged = old && before && JSON.stringify({ ...before, name: '' }) === JSON.stringify({ ...draft, name: '' });
    const result = unchanged ? structuredClone(old) : compileItem(equipmentSpecification(draft), { id: old && old.kind !== 'consumable' ? old.value.id : u.id + ':' + (slot === 'shieldGear' ? 'shield' : slot), name: draft.name.trim() || undefined,
      seed: old && old.kind !== 'consumable' ? old.value.recipe?.seed ?? (u.genAudit?.seed ?? u.id) + ':' + slot : (u.genAudit?.seed ?? u.id) + ':' + slot, creatingUnit: !oldDraft });
    if (result.kind === 'consumable') throw Error('配装槽不能装入消耗品');
    if (unchanged && draft.name.trim()) result.value.name = draft.name.trim();
    if (slot === 'primary' && result.kind === 'weapon') u.weapon = result.value;
    if (slot === 'sidearm' && result.kind === 'weapon') u.sidearm = result.value;
    if (slot === 'armor' && result.kind === 'armor') u.armor = result.value;
    if (slot === 'shieldGear' && result.kind === 'shield') u.shield = result.value;
  }
  const reason = equipmentReason(u); if (reason && oldDraft) throw Error(reason);
  if (reason && !oldDraft) u.generationWarnings = [...(u.generationWarnings ?? []), '建档已保留配装：' + reason];
  if (u.genAudit) Object.assign(u.genAudit.input, { body: u.body, mount: u.mount, shield: !!u.shield,
    weaponName: u.weapon?.name, weaponClass: u.weapon?.recipe?.mechanism, weaponLevel: u.weapon?.level, weaponStabilized: u.weapon?.recipe?.stabilized, weaponEnchantment: u.weapon?.recipe?.enchantment,
    sidearmName: u.sidearm?.name, sidearmClass: u.sidearm?.recipe?.mechanism, sidearmLevel: u.sidearm?.level, sidearmStabilized: u.sidearm?.recipe?.stabilized, sidearmEnchantment: u.sidearm?.recipe?.enchantment,
    armorName: u.armor?.name, armorTier: u.armor?.tier, armorLevel: u.armor?.level, armorProfile: u.armor?.recipe?.protectionProfile });
}
export function buildUnit(d: UnitDraft, registry: Map<string, Trait>, seed: string): Combatant {
  const input = identityInput(d), weapon = equipmentSpecification(d.primary), armor = equipmentSpecification(d.armor);
  if (weapon.kind !== 'weapon' || armor.kind !== 'armor') throw Error('装备类型无效');
  let unit = generateUnit({ ...input, weaponClass: weapon.mechanism, weaponLevel: weapon.power, armorTier: armor.tier, armorLevel: armor.power, preparedAbilityIds: [] }, { seed, registry }).unit;
  setGear(unit, d); unit = learnAbilities(unit, [], { prepared: d.autoPrepare ? undefined : d.skills.filter((s) => s.prepared).map((s) => unit.abilities.find((a) => a.id === s.instanceId || a.definitionId === s.id && a.name === (s.name.trim() || skillDefinitionName(s.id)))?.id ?? s.id) });
  prepareCombatModel(unit,V4_D20,(d.memberHp??'').trim()?capSingleLife(integer(d.memberHp!,1,Number.MAX_SAFE_INTEGER,'成员最大生命')):undefined); upgradeCombatSkills(unit);
  unit.resources.SP = spCapacity(unit); normalizeBakedTraitStats(unit, registry); return unit;
}
/** 只编译变更的配方；名称、体型和训练显示不重掷其他实物。 */
export function editUnitBuild(previous: UnitRecord, d: UnitDraft, registry: Map<string, Trait>): UnitRecord {
  if (previous.snapshot?.rulesVersion !== 'v2' || previous.retired || previous.status === 'dead') throw Error('该档案需要转制或为只读历史');
  const oldDraft = unitDraftFromRecord(previous), input = identityInput(d);
  if (input.hp !== undefined && input.hp > (input.hpMax ?? previous.base.hpMax)) throw Error('当前生命/人数不能超过上限');
  if (input.scale !== previous.scale) throw Error('已有档案不能通过编辑改变生命/人数语义');
  if (input.level !== previous.level) throw Error('已有单位训练由经验成长，编辑不伪造升级');
  const gearKeys = ['primary', 'sidearm', 'armor', 'shieldGear', 'sidearmEnabled', 'shield'] as const;
  if (previous.equipmentManaged && gearKeys.some((key) => JSON.stringify(d[key]) !== JSON.stringify(oldDraft[key]))) throw Error('实物装备请在配装工作区更换或改造');
  const edited = structuredClone(previous); edited.name = input.name; edited.side = input.side; edited.hp = input.hp ?? previous.hp; edited.base.hpMax = input.hpMax ?? previous.base.hpMax; edited.note = d.note;
  edited.traits = [...input.traits];
  const next = editUnitRecord(previous, edited, registry), unit = next.snapshot!;
  unit.body = input.body; unit.mount = input.mount; unit.speedTier = input.speedTier; validateMount(unit);
  prepareCombatModel(unit,V4_D20);
  if(unit.formation&&(d.memberHp??'').trim())setMemberMaximum(unit,integer(d.memberHp!,1,Number.MAX_SAFE_INTEGER,'成员最大生命'));
  unit.abilityState = structuredClone(previous.snapshot.abilityState); unit.resources = { ...previous.snapshot.resources, reserve: input.reserves ?? 0 };
  if (!previous.equipmentManaged) setGear(unit, d, oldDraft);
  else { const reason = equipmentReason(unit); if (reason) throw Error(reason); }
  if (unit.genAudit) Object.assign(unit.genAudit.input, { body: unit.body, mount: unit.mount, speedTier: unit.speedTier, reserves: unit.resources.reserve });
  normalizeBakedTraitStats(unit, registry);
  const specs = d.skills.filter((s) => s.id).map((s) => ({ id: s.id, instanceId: s.instanceId, name: s.name, ...(oldDraft.skills.find((old) => old.instanceId === s.instanceId || !s.instanceId && old.id === s.id)?.power === s.power || ABILITY_BLUEPRINTS[s.id]?.fixedPower ? {} : { level: integer(s.power, 1, 10, '技能规格') }) }));
  let prepared = learnAbilities(unit, specs, { replace: true });
  if (!d.autoPrepare) {
    const ids = d.skills.filter(s => s.prepared).map(s => prepared.abilities.find(a => s.instanceId ? a.id === s.instanceId
      : a.definitionId === s.id && a.name === (s.name.trim() || skillDefinitionName(s.id)))?.id ?? s.id);
    prepared = learnAbilities(prepared, [], { prepared: ids });
  }
  return { ...unitRecordFromCombatant(prepared, previous, { kind: 'edit' }), note: d.note };
}
