import { bonusMultiplier, bonusSteps, validateEnhancements, type Enhancements } from '../enhancements.js';
import { spCapacity } from '../resources.js';
import { capSingleLife, SINGLE_LIFE_LIMIT } from '../health-limits.js';
import { compileAbility } from './abilities.js';
import { MAX_PREPARED_SKILLS, compileSkill, resolvePreparedSkills } from '../skill-catalog.js';
import { validateMount } from '../loadout.js';
/** V2 配方编译：复用现有机制曲线/骰子重建，训练、规格、体量、品质各守其职责。 */
import type { Ability, Combatant, GenerateInput, Weapon } from '../types.js';
import type { GenOptions, GenResult } from './generator.js';
import { curveAt, ARCHETYPE_MODS } from '../data/curves.js';
import { diceAvg, rebuildDice } from '../data/weapons.js';
import { ABILITY_BLUEPRINTS, abilityFromBlueprint } from '../data/ability-blueprints.js';
import { traitRegistry } from '../data/traits.js';
import { SeededRng, randomSeed } from '../rng.js';
import { BODY, FORMULA_VERSION as EQUIPMENT_FORMULA_VERSION, compileArmor, compileWeapon } from './equipment.js';
import { equipmentReason } from '../items.js';
import { normalizeBakedTraitStats } from '../trait-sources.js';

export const FORMULA_VERSION = EQUIPMENT_FORMULA_VERSION + '+traits-v2';
function integer(value: number, min: number, max: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${label} 必须是 ${min}–${max} 的整数`);
  return value;
}

export function generateMechanismUnit(raw: GenerateInput, opts: GenOptions): GenResult {
  const oldScale = raw.scale === 'mook';
  if (oldScale) raw = { ...raw, scale: 'company', hpMax: raw.hpMax ?? 10 };
  const seed = opts.seed ?? randomSeed();
  const registry = opts.registry ?? traitRegistry();
  validateMount(raw);
  const body = raw.body ?? 'human';
  if (!BODY[body]) throw new Error('不支持的身体/平台');
  const quality = integer(raw.quality ?? 3, 1, 5, '品质Q');
  validateEnhancements(raw.bonuses, 'unit');
  const training = integer(raw.level, 1, 10, '训练T');
  const arch = raw.archetype ?? 'infantry';
  const curve = curveAt(training); const archMod = ARCHETYPE_MODS[arch];
  const id = `unit:${encodeURIComponent(seed)}`;
  const warnings: string[] = [];
  if (oldScale) warnings.push('旧刻度输入已归为编队，保留指定人数、装备和训练');
  if (raw.era) warnings.push('旧 era 只保留为迁移信息，未参与 V2 数值');
  if (raw.weaponName && !raw.weaponClass && !raw.weaponId) warnings.push('武器仅指定名称：使用显示的默认机制，未按名称推断特殊能力');
  if (raw.armorName && raw.armorTier === undefined && !raw.armorId) warnings.push('护甲仅指定名称：默认轻甲构型，特殊防护需明确规格');
  const weaponFor = (slot: 'primary' | 'sidearm'): Weapon | undefined => {
    const weaponId = slot === 'primary' ? raw.weaponId : raw.sidearmId;
    const classId = slot === 'primary' ? raw.weaponClass : raw.sidearmClass;
    const name = slot === 'primary' ? raw.weaponName : raw.sidearmName;
    if (slot === 'sidearm' && !weaponId && !classId && !name) return undefined;
    const mechanism = classId ?? (weaponId ? undefined : slot === 'sidearm' ? 'sword' : raw.loadout === 'ranged' || arch === 'ranged' ? 'bow' : 'sword');
    return compileWeapon({ mechanism, weaponId, bonuses: slot === 'primary' ? raw.weaponBonuses : raw.sidearmBonuses, power: (slot === 'primary' ? raw.weaponLevel : raw.sidearmLevel) ?? 1, stabilized: slot === 'primary' ? raw.weaponStabilized : raw.sidearmStabilized, enchantment: slot === 'primary' ? raw.weaponEnchantment : raw.sidearmEnchantment },
      { id: `${id}:${slot}`, name, seed: seed + ':' + slot, body, quality, noVariance: opts.noVariance, creatingUnit: true });
  };
  const weapon = weaponFor('primary')!; const sidearm = weaponFor('sidearm');
  const hasArmor = raw.armorTier !== undefined || !!raw.armorId || !!raw.armorName?.trim();
  const armor = compileArmor({ bonuses: raw.armorBonuses, tier: hasArmor ? raw.armorTier : 0, profile: raw.armorProfile, armorId: raw.armorId, power: raw.armorLevel ?? (hasArmor ? 5 : 1) }, { id: `${id}:armor`, name: raw.armorName, seed: seed + ':armor', body, quality });
  const tier = armor.tier, armorPower = armor.level!;
  const conflict = equipmentReason({ body, scale: raw.scale, weapon, sidearm, armor, shield: raw.shield ? { id: `${id}:shield`, load: 2 } : undefined });
  if (conflict) warnings.push('建档已保留配装：' + conflict + '；实际使用由战斗规则判定');
  const group = raw.scale !== 'hero';
  const requestedMax = integer(raw.hpMax ?? (group ? 50 : Math.round((curve.hp * BODY[body].hp + archMod.hp) * bonusMultiplier(raw.bonuses, 'health'))), 1, group ? 1e9 : Number.MAX_SAFE_INTEGER, group ? '编制上限' : '生命上限');
  const requestedHp = integer(raw.hp ?? requestedMax, 0, requestedMax, '当前值');
  const hpMax = group ? requestedMax : capSingleLife(requestedMax), hp = Math.min(requestedHp, hpMax);
  if (hpMax !== requestedMax) warnings.push(`单体生命上限${requestedMax}超过硬上限，已限制为${SINGLE_LIFE_LIMIT}`);
  const traits = [...new Set(raw.traits)];
  const base = { atk: curve.atk + archMod.atk, def: curve.def + archMod.def, spd: Math.max(1, curve.spd + archMod.spd + bonusSteps(raw.bonuses, 'speed', 5)), hpMax,
    ...(group ? { moraleMax: curve.morale + bonusSteps(raw.bonuses, 'morale') } : {}) };
  const tags = new Set<string>([arch, raw.scale, body]);
  for (const traitId of traits) {
    const trait = registry.get(traitId);
    if (!trait) throw new Error(`未知特质 ${traitId}`);
    if (['large', 'titan'].includes(traitId)) {
      if (traitId === 'large' && !['large', 'giant'].includes(body) || traitId === 'titan' && body !== 'giant') warnings.push(`${trait.name} 需要匹配的实际身体，已保留声明但不会改变体型或上限`);
      continue;
    }
    for (const effect of trait.effects) {
      if (effect.kind === 'stat') {
        if (effect.stat === 'atk' || effect.stat === 'def' || effect.stat === 'spd') base[effect.stat] += effect.value;
        else if (effect.stat === 'hpMax' && !group && raw.hpMax === undefined) base.hpMax += effect.value;
        else if (effect.stat === 'morale' && base.moraleMax !== undefined) base.moraleMax += effect.value;
      }
      if (effect.kind === 'armorTier' && !['heavy-armor', 'super-heavy', 'mechanized'].includes(traitId)) warnings.push(`${trait.name} 不代替装备，不额外提高 V2 防护`);
    }
    for (const tag of trait.grantsTags ?? []) if (!['large', 'titan', 'flying', 'spear', 'ranged-capable', 'mounted'].includes(tag)) tags.add(tag);
  }
  if (!group) base.hpMax = capSingleLife(base.hpMax);
  const currentHp = raw.hp === undefined ? base.hpMax : Math.min(hp, base.hpMax);
  if (raw.abilityIds?.length) throw new Error('旧固定技能需先迁移为明确机制配方，不能直接进入 V2');
  const abilities: Ability[] = []; const abilityAudit: { blueprintId: string; power: number }[] = [];
  for (const spec of raw.abilityBlueprints ?? []) {
    const definitionId = typeof spec === 'string' ? spec : spec.id;
    if (!definitionId.startsWith('generic:') && abilities.some((a) => a.definitionId === definitionId)) throw new Error('同源技能重复，请明确保留一个等级');
    const bp = ABILITY_BLUEPRINTS[definitionId];
    const power = integer((typeof spec === 'string' ? undefined : spec.level) ?? 5, 1, 10, '技能强度P');
    const ability = compileSkill(spec, power, id);
    if (abilities.some((a) => a.id === ability.id || ability.recipe && a.name === ability.name)) throw new Error('同名技能请合并为一项，不能重复创建');
    if (bp?.fixedPower && typeof spec !== 'string' && spec.level !== undefined) warnings.push(`${bp.name}使用固定预备来源，技能等级不改变援军`);
    abilities.push(ability); abilityAudit.push({ blueprintId: definitionId, power: ability.power! });
  }
  const prepared = raw.preparedAbilityIds ?? abilities.slice(0, MAX_PREPARED_SKILLS).map((a) => a.recipe ? a.id : a.definitionId!);
  const preparedIds = resolvePreparedSkills(abilities, prepared);
  if (!raw.preparedAbilityIds && abilities.length > MAX_PREPARED_SKILLS) warnings.push(`仅默认准备前${MAX_PREPARED_SKILLS}个技能，其余已学保留，需在配装中选择`);
  const input: GenerateInput = { ...raw, era: undefined, body, quality, level: training, weaponClass: weapon.recipe!.mechanism,
    weaponLevel: weapon.level, sidearmLevel: sidearm?.level, armorTier: tier, armorLevel: armorPower, hpMax: base.hpMax, hp: currentHp, preparedAbilityIds: prepared,
    abilityBlueprints: (raw.abilityBlueprints ?? []).map((s) => typeof s === 'string' ? { id: s, level: 5 } : { ...s, level: s.level ?? 5 }) };
  const unit: Combatant = { id, name: raw.name, side: raw.side, scale: raw.scale, archetype: arch, level: training,
    rulesVersion: 'v2', bonuses: raw.bonuses, body, ...(raw.speedTier !== undefined ? { speedTier: raw.speedTier } : {}), ...(raw.mount ? { mount: true } : {}), base, hp: currentHp, tags: [...tags], traits,
    weapon, sidearm, armor, shield: raw.shield ? { id: `${id}:shield`, load: 2 } : undefined,
    abilities, preparedAbilityIds: preparedIds,
    conditions: [], abilityState: [], resources: { SP: 6 + Math.floor(training / 2), reserve: integer(raw.reserves ?? 0, 0, 2, '随队预备份额') },
    morale: base.moraleMax, engagedWith: [], status: hp > 0 ? 'ready' : 'dead', fatigue: 0,
    xpValue: curve.xp, generationWarnings: warnings,
    genAudit: { seed, deltas: {}, formulaVersion: FORMULA_VERSION, input, abilities: abilityAudit } };
  unit.resources.SP = spCapacity(unit);
  normalizeBakedTraitStats(unit, registry);
  if (oldScale) unit.legacyScale = 'mook';
  return { unit, audit: unit.genAudit! };
}
