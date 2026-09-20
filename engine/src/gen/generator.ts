/**
 * 造怪器：原型 × 威胁等级 × 特质 → 基准曲线出值 → 小范围随机浮动 → 冻结成单位。
 * 浮动用带种子的 RNG 掷出并写入审计（可复现、确认前可重掷）。
 */

import type { Ability, Combatant, GenAudit, GenerateInput, Trait } from '../types.js';
import { curveAt, ARCHETYPE_MODS, SCALE_MODS } from '../data/curves.js';
import { traitRegistry } from '../data/traits.js';
import { getSkin, defaultWeaponId } from '../data/skins.js';
import { WEAPON_LIBRARY, buildWeaponDice, getWeaponProfile, getWeaponClass } from '../data/weapons.js';
import { ARMOR_LIBRARY, getArmorProfile } from '../data/armors.js';
import { getAbilityTemplate } from '../data/abilities.js';
import { abilitiesFromBlueprints } from '../data/ability-blueprints.js';
import { SeededRng, randomSeed } from '../rng.js';
import { parseDice } from '../dice.js';
import { generateMechanismUnit } from './mechanism.js';

export interface GenOptions {
  seed?: string;
  registry?: Map<string, Trait>;
  /** 关闭随机浮动（基准值直出） */
  noVariance?: boolean;
}

export interface GenResult {
  unit: Combatant;
  audit: GenAudit;
}

/** 在骰子表达式的固定加值上叠加修正并重建字符串（xp 升级重算武器骰共用） */
export function withFlat(expr: string, delta: number): string {
  const e = parseDice(expr);
  const flat = e.flat + delta;
  const keep = e.keepHigh !== undefined ? `kh${e.keepHigh}` : e.keepLow !== undefined ? `kl${e.keepLow}` : '';
  return `${e.count}d${e.sides}${keep}${flat >= 0 ? '+' : ''}${flat}`;
}

export function generateUnit(input: GenerateInput, opts: GenOptions = {}): GenResult {
  if (input.rulesVersion === 'v2') return generateMechanismUnit(input, opts);
  const registry = opts.registry ?? traitRegistry();
  const seed = opts.seed ?? randomSeed();
  const rng = new SeededRng(seed);
  const deltas: Record<string, number> = {};
  // 特质去重：AI 标签/面板勾选可能重复给同一特质，重复修正没有意义
  const traitIds = [...new Set(input.traits)];
  const inputDeduped = { ...input, traits: traitIds };

  const curve = curveAt(input.level);
  const arch = input.archetype ?? 'infantry';
  const archMod = ARCHETYPE_MODS[arch];
  const scaleMod = SCALE_MODS[input.scale];
  const skin = getSkin(input.era);

  // ---- 基准 + 原型 + 刻度 ----
  let atk = curve.atk + archMod.atk + scaleMod.atkAdj;
  let def = curve.def + archMod.def + scaleMod.defAdj;
  let spd = curve.spd + archMod.spd;
  let hpMax: number;
  let xpValue = Math.round(curve.xp * scaleMod.xpMult);

  if (input.scale === 'mook') {
    hpMax = 1; // 任何命中即倒
  } else if (input.scale === 'company') {
    hpMax = curve.men; // 兵员数
  } else {
    hpMax = Math.round(curve.hp * scaleMod.hpMult) + archMod.hp;
  }

  // ---- 特质静态修正（属性/HP/士气） ----
  let moraleMax = input.scale === 'company' ? curve.morale : undefined;
  const tags = new Set<string>([arch, input.scale]);
  for (const id of traitIds) {
    const t = registry.get(id);
    if (!t) continue;
    for (const tag of t.grantsTags ?? []) tags.add(tag);
    for (const e of t.effects) {
      if (e.kind === 'stat') {
        if (e.stat === 'atk') atk += e.value;
        else if (e.stat === 'def') def += e.value;
        else if (e.stat === 'spd') spd += e.value;
        else if (e.stat === 'hpMax') hpMax += e.value;
        else if (e.stat === 'morale' && moraleMax !== undefined) moraleMax += e.value;
      }
      // armorTier 特质不落静态值：运行时由 armorDR() 动态计算，避免缓存不同步
    }
  }

  // ---- 小范围随机浮动 ----
  if (!opts.noVariance) {
    for (const key of ['atk', 'def', 'spd'] as const) {
      const delta = Math.floor(rng.next() * 5) - 2; // -2..+2
      if (delta !== 0) {
        if (key === 'atk') atk += delta;
        else if (key === 'def') def += delta;
        else spd += delta;
        deltas[key] = (deltas[key] ?? 0) + delta;
      }
    }
    const hpDelta = Math.round(hpMax * (rng.next() * 0.2 - 0.1)); // ±10%
    if (hpDelta !== 0 && input.scale !== 'mook') {
      hpMax += hpDelta;
      deltas.hp = hpDelta;
    }
    const dmgDelta = rng.next() < 0.5 ? -1 : rng.next() < 0.8 ? 1 : 2;
    deltas.dmgFlat = dmgDelta;
    // 护甲浮动：50% 持平 / 35% +1 / 15% −1（同级同类单位不再护甲零差异）
    const armorRoll = rng.next();
    const armorDelta = armorRoll < 0.15 ? -1 : armorRoll < 0.5 ? 1 : 0;
    if (armorDelta !== 0) deltas.armorTier = armorDelta;
  } else {
    deltas.dmgFlat = 0;
  }

  // ---- 武器（公式生成：曲线 × 武器原型参数 + 浮动；风格独立于原型） ----
  const loadout = input.loadout ?? (arch === 'ranged' ? 'ranged' : 'melee');
  const dmgFlatTotal = archMod.dmgFlat + (deltas.dmgFlat ?? 0);
  // 分类武器：AI 给了 weaponClass → 用该分类性质 + 武器自身等级 走强度曲线
  // （武器等级与单位等级解耦：剑L5 是 5 级品质的剑，不是持剑者的等级）
  const classProf = getWeaponClass(input.weaponClass);
  const weaponCurve = classProf && input.weaponLevel ? curveAt(input.weaponLevel) : curve;
  const baseProfile =
    getWeaponProfile(input.weaponId) ??
    (classProf ? classProf.profile : WEAPON_LIBRARY[defaultWeaponId(skin, arch, loadout)]!);
  // 威力浮动 ±5%：仅参数化武器（mult≠1）参与，默认位（mult=1）的波动由 dmgFlat 承担
  let profile = baseProfile;
  if (!opts.noVariance && baseProfile.dmgMult !== 1) {
    const jitter = 1 + (rng.next() * 0.1 - 0.05);
    profile = { ...baseProfile, dmgMult: Math.round(baseProfile.dmgMult * jitter * 100) / 100 };
    deltas.weaponMult = Math.round((profile.dmgMult - baseProfile.dmgMult) * 100) / 100;
  }
  const built = buildWeaponDice({
    curve: weaponCurve,
    profile,
    dmgFlat: dmgFlatTotal,
    ranged: loadout === 'ranged',
    // 破甲段门禁：分类武器用自身等级（剑L5 在 L5 才有破甲段）；否则沿用单位等级（远程 L5+ 门禁）
    level: classProf && input.weaponLevel ? input.weaponLevel : input.level,
    scale: input.scale,
  });
  const weapon = {
    id: `w-${seed.slice(0, 4)}`,
    name: input.weaponName?.trim() || profile.name,
    baseDice: built.baseDice,
    apDice: built.apDice,
    tags: loadout === 'ranged' ? ['ranged'] : [],
    range: built.range,
    ...(profile.minRange !== undefined ? { minRange: profile.minRange } : {}),
    ...(profile.pointBlankPolicy ? { pointBlankPolicy: profile.pointBlankPolicy } : {}),
    ...(profile.pointBlankPenalty !== undefined ? { pointBlankPenalty: profile.pointBlankPenalty } : {}),
    ...(profile.indirect ? { indirect: true } : {}),
    // 品质等级戳：显式武器等级 ?? 佩戴者等级（等级差护甲压制与审计共用）
    level: input.weaponLevel ?? input.level,
    ...(built.attacks ? { attacks: built.attacks } : {}),
    ...(built.reload ? { reload: built.reload } : {}),
  };

  // ---- 副武器（显式声明才有：weapon2="名字:种类L等级"；不自动配发） ----
  // 解析优先级：库原型 id > 分类（种类定性质）> 皮肤时代默认近战位兜底；
  let sidearm: Combatant['sidearm'];
  if (input.sidearmId || input.sidearmClass || input.sidearmName) {
    const sideClassProf = getWeaponClass(input.sidearmClass);
    const fallback = WEAPON_LIBRARY[skin.sidearmId]!;
    const sideProfile =
      getWeaponProfile(input.sidearmId) ??
      (sideClassProf ? sideClassProf.profile : undefined) ??
      fallback;
    const sideBuilt = buildWeaponDice({
      curve: sideClassProf && input.sidearmLevel ? curveAt(input.sidearmLevel) : curve,
      profile: sideProfile,
      dmgFlat: dmgFlatTotal,
      ranged: sideProfile.range > 1,
      level: input.sidearmLevel ?? input.level,
      scale: input.scale,
    });
    sidearm = {
      id: `w2-${seed.slice(0, 4)}`,
      name: input.sidearmName?.trim() || sideProfile.name,
      baseDice: sideBuilt.baseDice,
      apDice: sideBuilt.apDice,
      tags: sideProfile.range > 1 ? ['ranged'] : [],
      range: sideBuilt.range,
      minRange: sideProfile.minRange ?? 0,
      pointBlankPolicy: sideProfile.pointBlankPolicy ?? 'allow',
      ...(sideProfile.pointBlankPenalty !== undefined ? { pointBlankPenalty: sideProfile.pointBlankPenalty } : {}),
      ...(sideProfile.indirect ? { indirect: true } : {}),
      level: input.sidearmLevel ?? input.level,
      ...(sideBuilt.attacks ? { attacks: sideBuilt.attacks } : {}),
      ...(sideBuilt.reload ? { reload: sideBuilt.reload } : {}),
    };
  }

  // ---- 护甲：输入覆盖 > 指定原型 > 皮肤默认位 > 原型基准 + 浮动；效率 ±0.05 浮动 ----
  const armorProfile =
    getArmorProfile(input.armorId) ??
    ARMOR_LIBRARY[skin.armorIds[arch as keyof typeof skin.armorIds] ?? 'infantry']!;
  const armorTierFinal =
    input.armorTier !== undefined
      ? input.armorTier
      : armorProfile.tier !== undefined
        ? (Math.max(0, Math.min(4, armorProfile.tier + (deltas.armorTier ?? 0))) as 0 | 1 | 2 | 3 | 4)
        : (Math.max(0, Math.min(4, archMod.armorTier + (deltas.armorTier ?? 0))) as 0 | 1 | 2 | 3 | 4);
  let drScale = armorProfile.drScale;
  // AI 护甲等级（L1~L10）：防护品质乘数，L5=标准 1.0（神铠 L9≈1.16、粗制 L2≈0.88）
  if (input.armorLevel) {
    drScale = Math.round(drScale * (0.8 + 0.04 * Math.max(1, Math.min(10, input.armorLevel))) * 100) / 100;
    deltas.armorLevel = input.armorLevel;
  }
  if (!opts.noVariance) {
    const jitter = Math.round((rng.next() * 0.1 - 0.05) * 100) / 100;
    if (jitter !== 0) {
      drScale = Math.round((drScale + jitter) * 100) / 100;
      deltas.armorDr = jitter;
    }
  }

  const hp = Math.max(1, hpMax);
  // 技能：只来自「生成输入显式声明」——abilityIds 模板 + abilityBlueprints（分类蓝图）。
  // 不再自动硬塞签名技能，也不做 persona 关键词匹配；技能由 skills="名字:蓝图L等级" 显式驱动。
  const abilities: Ability[] = [];
  for (const id of input.abilityIds ?? []) {
    const tpl = getAbilityTemplate(id);
    if (tpl && !abilities.some((a) => a.id === tpl.id)) abilities.push({ ...tpl, effects: tpl.effects.map((e) => ({ ...e })) });
  }
  let abilityAudit: { blueprintId: string; power: number }[] | undefined;
  if (input.scale !== 'mook' && input.abilityBlueprints?.length) {
    const bp = abilitiesFromBlueprints(input.abilityBlueprints, {
      curve,
      level: input.level,
      jitter: opts.noVariance ? 0 : 0.05,
      max: 2,
      rand: () => rng.next(),
    });
    for (const a of bp.abilities) {
      if (!abilities.some((x) => x.id === a.id)) abilities.push(a);
    }
    if (bp.audit.length) abilityAudit = bp.audit;
  }
  const unit: Combatant = {
    id: `${input.name}-L${input.level}-${seed.slice(0, 4)}`,
    name: input.name,
    side: input.side,
    scale: input.scale,
    archetype: arch,
    level: input.level,
    tags: [...tags],
    base: { atk, def, spd, hpMax: hp, ...(moraleMax !== undefined ? { moraleMax } : {}) },
    hp,
    ...(moraleMax !== undefined ? { morale: moraleMax } : {}),
    conditions: [],
    weapon,
    ...(sidearm ? { sidearm } : {}),
    armor: {
      id: `a-${seed.slice(0, 4)}`,
      // 显式档位=改穿该档装备（按档位命名）；armorId/皮肤默认位=穿这件原型（按原型命名）；
      // 自由文本名（正文对应）优先级最高
      name: input.armorName?.trim() ||
        (input.armorTier !== undefined
          ? ['无甲', '轻甲', '中甲', '重甲', '超重甲'][armorTierFinal]!
          : armorProfile.name ?? ['无甲', '轻甲', '中甲', '重甲', '超重甲'][armorTierFinal]!),
      tier: armorTierFinal,
      // 品质等级戳：显式护甲等级 ?? 佩戴者等级（等级差护甲压制与审计共用）
      level: input.armorLevel ?? input.level,
      ...(drScale !== 1 ? { drScale } : {}),
    },
    abilities,
    abilityState: [],
    resources: input.scale === 'hero' ? { SP: 3 + input.level } : {},
    traits: [...traitIds],
    engagedWith: [],
    status: 'ready',
    fatigue: 0,
    xpValue,
    genAudit: { seed, deltas, weapon: built.audit, ...(abilityAudit ? { abilities: abilityAudit } : {}), input: inputDeduped },
  };

  return { unit, audit: unit.genAudit! };
}

/** 造怪器可用特质清单（按用途分组，面板选择器用） */
export function traitCatalog(registry?: Map<string, Trait>): { group: string; traits: Trait[] }[] {
  const reg = registry ?? traitRegistry();
  const groups: Record<string, string[]> = {
    反制: ['ap-weapon', 'ap-master', 'armor-piercing-shot', 'anti-infantry', 'anti-large', 'anti-mobile', 'pike-wall', 'monster-hunter'],
    防御: ['heavy-armor', 'super-heavy', 'shield-wall', 'guardian', 'guardian-greater', 'regen'],
    攻击: ['berserk', 'poison-strike', 'trample'],
    士气: ['fear', 'terror', 'steadfast', 'stubborn', 'commander'],
    机动: ['charge-strong', 'mounted-archer', 'skirmisher', 'vanguard', 'stalk', 'fast'],
    风格: ['melee-master', 'sharpshooter', 'versatile', 'mechanized'],
    环境: ['urban-fighter', 'siege-breaker', 'fortification', 'plains-runner', 'forest-lore', 'mountain-born', 'night-fighter'],
    规模: ['large', 'titan', 'flying', 'loose-formation'],
    精英: ['veteran', 'elite', 'fatigue-trained'],
  };
  return Object.entries(groups).map(([group, ids]) => ({
    group,
    traits: ids.map((id) => reg.get(id)).filter((t): t is Trait => !!t),
  }));
}
