import { artilleryDirect, artillerySplash, artilleryRetention, BOUNDED_BLAST_MODEL, sprayerSplashAt } from './artillery-model.js';
import { displayNumber } from './display-number.js';
import { targetWidthLimit } from './target-width.js';
import { WEAPON_CLASSES } from './data/weapons.js';
import { progression, stackingRevision } from './progression.js';
import { traitParameter } from './trait-parameters.js';
import { wornEffects, wornDamageMultiplier } from './gear-bonuses.js';
import { phase2Traits } from './trait-level-model.js';
import { effectiveTraitLevel } from './trait-sources.js';
import { phase2Value } from './phase2-traits.js';
import { isWoundModel } from './balance.js';
import { equipmentStep, unitMultiplier, unitStep } from './numeric-model.js';
import { instanceMultiplier } from './instance-variance.js';
import { bonusMultiplier, bonusSteps, trainingEdge, trainingDamage } from './enhancements.js';
import { barrierAmount } from './barrier.js';
import { weaponConditions, poisonHint, poisonValue } from './afflictions.js';
import { defensivePostureMods, looseFormation } from './tactics.js';
import { traitsV13 } from './trait-model.js';
import { entrenched } from './entrenchment.js';
import { effectiveProtection, overloadPenalty } from './body.js';
import { applyHealthLoss, applyDamagePlan, type MemberDamagePlan } from './recovery.js';
import { MEMBER_HEALTH_MODEL, hasMemberHealth, memberHealth, damageMemberGroups } from './member-health.js';
import { combatWeapon, anchoredProtection,penetrationThrough,armorPowerScale,armorTransmission,shieldTransmission,overmatchMultiplier,defensePower,gradeOvermatch } from './power-anchors.js';
import { meleeProfile } from './melee.js';
import { meleeWeapon, isCannonWeapon } from './loadout.js';
import { cloneData } from './clone.js';
import { fatiguePenalty } from './resources.js';
import { energyHeavyHit, energyShieldActive, energyPower } from './shield-state.js';
import { isArmsV3 } from './arms-model.js';
import { diceAvg } from './data/weapons.js';
import { isArmsV2, MOUNTED_SPRINT_DAMAGE, HOOK_ACCURACY, shieldUsable, shieldClass, shieldCoverage, applyShieldWear, weaponCrew, demolitionPackets, humanSizedIndividual, loneHeavyOperator, LONE_AUTOCANNON_SHARE, ARTILLERY_SMALL_TARGET } from './arms.js';
/**
 * 伤害管线：命中判定 + 分段伤害。
 *
 * 伤害分两段（战锤全面战争制）：
 *   普通段 baseDice —— 受目标护甲减伤比例(DR%)作用
 *   破甲段 apDice   —— 无视 DR，全额结算
 * 「守护」类特质为乘法叠加的全伤害减免，不可被破甲绕过。
 * 每一步都写入 Resolution，引擎算的和人算的必须一致。
 */

import type { Combatant, RulePack, Weapon } from './types.js';
import type { ConditionDef } from './types.js';
import { SeededRng, type Rng } from './rng.js';
import { rollDice, rollDicePortion, rollDicePortionTotal, type DiceRollDetail } from './dice.js';
import { collectMods, resolveStack, describeStack, hasFlag, type Modifier, type StackResult } from './bonus.js';
import { averageDice, estimateHitChance, d20HitWeight } from './actions.js';
import { damageMoments, diceDistribution, v2DamageAmount, roundDamage } from './probability.js';
import { engagementWidth } from './exposure.js';
import { activeTraitIds, traitPenetrationBonus } from './trait-sources.js';
import { combatBonuses } from './gear-bonuses.js';
import { itemsV15 } from './item-model.js';
import { COHORT_MODEL, COHORT_REFERENCE, personnel, memberDurability } from './combat-model.js';

export interface AttackResolution {
  overmatchMultiplier?:number;
  attackPower?:number;
  protectionPower?:number;
  shieldWear?: number;
  shieldBroken?: boolean;
  barrierAbsorbed?: number;
  /** R16 喷射武器攻击的武器规格，供惊惧检定。 */
  spray?: number;
  /** R15 能量盾吸收量与这次过载的份数；V21 跨代换算时另记盾的消耗。 */
  energyAbsorbed?: number;
  energySpent?: number;
  energyOverloaded?: number;
  unshieldedDamage?: number;
  armorScale?:number;
  armorFactor?:number;
  shieldFactor?:number;
  ammunition?:'he'|'ap';
  damageModel?: 'member-health';
  membersBefore?:number;
  membersAfter?:number;
  directDamage?:number;
  /** 直击伤害中传递给同队其他成员的实际生命损失，已包含在directDamage中。 */
  overflowDamage?:number;
  splashDamage?:number;
  damagePlans?:MemberDamagePlan[];
  packetCount?: number;
  packetHits?: number;
  packetRolls?: {hit:boolean;crit:boolean;damage:number;potentialDamage?:number;attack?:number;base?:number;ap?:number}[];
  onHitConditions?: Combatant['conditions'];
  participants?: number;
  channel?: import('./types.js').DamageChannel;
  penetration?: number;
  resistance?: number;
  penetrationFactor?: number;
  attackerId: string;
  defenderId: string;
  attackerName: string;
  defenderName: string;
  /** 有高低差的实际高度地图上双方的站立高度；空中单位不记。战报据此写居高或仰攻。 */
  attackerHeight?: number;
  defenderHeight?: number;
  defenderScale?: Combatant['scale'];
  hit: boolean;
  crit: boolean;
  /** d20 模式：攻击掷骰详情；tw 模式：命中概率 */
  attackRoll?: DiceRollDetail;
  hitChance?: number;
  netAtk: number;
  targetDef: number;
  atkDetail: string;
  /** 伤害明细 */
  baseRoll?: DiceRollDetail;
  apRoll?: DiceRollDetail;
  drPercent: number;
  baseAfterDR: number;
  apTotal: number;
  dmgMult: number;
  wardMult: number;
  finalDamage: number;
  hpBefore: number;
  hpAfter: number;
  defenderStatus: Combatant['status'];
  /** 完整可读结算行（结算卡直接用） */
  text: string;
}

export interface AttackOpts {
  macroEnvironment?: boolean; chargeDistance?: number; moved?: boolean; chargeStraight?: boolean; opportunity?: boolean;
  /** R16 油箱爆炸：自动命中、不暴击、不附加命中状态。 */
  autoHit?: boolean;
  /** 行动本身的伤害预算，不改变参战人数、段数或抽样次数。 */
  actionDamageScale?: number;
  /** 仅限成员伤损抽样预览：守方可变状态相同的攻击段共用确定部分，并省略结算文字。 */
  previewMemo?: PreviewMemo;
  packetShare?: number;
  fieldTags?: string[];
  attackerTerrain?: string;
  localTerrain?: boolean;
  heightRules?: boolean;
  heightAdvantage?: number;
  attackerHeight?: number;
  defenderHeight?: number;
  defenderTerrain?: string;
  defenderEngaged?: boolean;
  distance?: number;
  participants?: number;
  attacker: Combatant;
  defender: Combatant;
  rng: Rng;
  rules: RulePack;
  conditionDefs: Map<string, ConditionDef>;
  traitRegistry?: Map<string, import('./types.js').Trait>;
  /** 态势/指挥/光环等外部修正（含克制矩阵项） */
  extraMods?: Modifier[];
  /** 防御方外部修正（战场环境 def 类等；防御方特质的走其自带栈） */
  defenderMods?: Modifier[];
  charge?: boolean;
  ranged?: boolean;
  /** 结算用武器覆盖（副武器近战切换）：骰子源、武器等级、近战惩罚判定都看它 */
  weaponOverride?: Weapon;
  /** 优势/劣势（d20 模式） */
  advantage?: 'none' | 'adv' | 'dis';
  /** 技能伤害（覆盖武器） */
  abilityDamage?: { power?: number; accuracy?: number; damageScale?:number; areaExposure?: number; delivery?: 'melee' | 'ranged' | 'magic'; weaponBased?: boolean; shape?: 'single' | 'burst'; baseDice: string; apDice?: string; channel?: import('./types.js').DamageChannel; penetration?: number };
}

/** 护甲等级 → 减伤比例（含特质护甲修正与护甲原型效率） */
export function armorDR(unit: Combatant, rules: RulePack, traitRegistry?: Map<string, import('./types.js').Trait>): number {
  if (unit.rulesVersion === 'v2') return 0; // V2 是按通道穿透对抗，不能伪装成一条通用减伤百分比。
  let tier = unit.armor?.tier ?? 0;
  // 特质里的护甲档位修正
  for (const id of unit.traits) {
    const t = traitRegistry?.get(id);
    if (!t) continue;
    for (const e of t.effects) if (e.kind === 'armorTier') tier += e.value;
  }
  const clamped = Math.max(0, Math.min(rules.armorDR.length - 1, tier));
  // 护甲原型效率（防弹衣 0.6 / 动力甲 1.15），实际减伤 = 表值 × drScale，封顶 90%
  const dr = (rules.armorDR[clamped] ?? 0) * (unit.armor?.drScale ?? 1);
  return Math.max(0, Math.min(0.9, dr));
}

/** 等级差压制：护甲品质远高于来袭武器时，普通段减伤额外提升——防止低级武器集火磨死高级甲。
 *  gap = 护甲等级 − 武器等级（缺省各自随佩戴者生成时等级），每级 +4%，上限 +36%；
 *  只对穿甲（tier≥1）生效，总减伤仍封顶 90%。破甲段不受影响（破甲本就是护甲的天敌）。 */
export function qualityGapDR(attacker: Combatant, defender: Combatant, weaponOverride?: Weapon): number {
  if (attacker.rulesVersion === 'v2' || defender.rulesVersion === 'v2') return 0;
  const armor = defender.armor;
  if (!armor || (armor.tier ?? 0) <= 0) return 0;
  const gap = (armor.level ?? defender.level) - ((weaponOverride ?? attacker.weapon)?.level ?? attacker.level);
  return gap > 0 ? Math.min(0.36, 0.04 * gap) : 0;
}

/** 武器射程带：显式 range 优先，否则按 ranged 标签推断（3 或 0=仅接战） */
export function weaponRange(w?: Weapon): number {
  if (!w) return 0;
  if (w.range !== undefined) return w.range;
  return w.tags?.includes('ranged') ? 3 : 0;
}

/** 是否具备射击资格：远程原型或武器带 ranged 标签（骑射手=机动+远程武器） */
export function isRangedCapable(u: Combatant): boolean {
  if (u.rulesVersion === 'v2') return !!u.weapon?.tags?.includes('ranged');
  return u.archetype === 'ranged' || !!(u.weapon?.tags?.includes('ranged'));
}

/** 连续穿透系数；保留整数档锚点，小数差值在相邻档间线性插值。 */
export function penetrationFactor(power: number, resistance: number): number {
  return penetrationThrough(power,resistance);
}
/** 小战按格子结算（有坐标、不在会战阵位）；会战没有坐标。 */
function gridAttack(attacker: Combatant): boolean { return attacker.pos !== undefined && attacker.formationPosition === undefined; }
/** 守方受损前，同一攻击输入的结算武器；预览全程及单段结算内只折算一次。 */
export interface ResolvedWeapon { weapon: Weapon | undefined }
function resolveWeapon(opts: Pick<AttackOpts, 'attacker' | 'defender' | 'weaponOverride'> & Partial<Pick<AttackOpts,'rules'|'autoHit'>>): ResolvedWeapon {
  const original=opts.weaponOverride ?? opts.attacker.weapon;
  const weapon = opts.rules?.combatModel===MEMBER_HEALTH_MODEL?combatWeapon(original,{...opts.attacker,artilleryModel:opts.rules.artilleryModel},opts.defender,opts.rules?.weaponOverflow,opts.rules?.damageModel,opts.rules?.overmatch,opts.rules?.overmatchCurve):original;
  if (!isArmsV2(opts.rules?.armsModel) || !weapon || opts.defender.scale === 'hero') return { weapon };
  // R12 霰弹散射；R16 会战喷射同“爆炸覆盖目标编队”。
  if (original?.recipe?.mechanism === 'shotgun') return { weapon: { ...weapon, splashTargets: 2, splashFactor: .5 } };
  if (original?.recipe?.mechanism === 'sprayer' && !gridAttack(opts.attacker) && !opts.autoHit) return { weapon: { ...weapon, splashTargets: opts.rules?.artilleryModel === BOUNDED_BLAST_MODEL ? sprayerSplashAt(original.recipe.power) : 1e9 } };
  return { weapon };
}
export function penetrationContext(opts: Pick<AttackOpts, 'attacker' | 'defender' | 'weaponOverride' | 'abilityDamage' | 'ranged'> & Partial<Pick<AttackOpts,'rules'|'conditionDefs'|'charge'|'chargeStraight'|'chargeDistance'>>, resolved: ResolvedWeapon = resolveWeapon(opts)) {
  const modern=opts.rules?.combatModel===MEMBER_HEALTH_MODEL;
  const weapon=resolved.weapon;
  const channel = opts.abilityDamage?.channel ?? weapon?.channel ?? 'kinetic';
  const base = opts.abilityDamage?.penetration ?? weapon?.penetration ?? 1 + Math.floor((weapon?.level ?? 5) / 2);
  const sprint = isArmsV2(opts.rules?.armsModel) && (!opts.abilityDamage || opts.abilityDamage.weaponBased) && weapon?.recipe?.mechanism === 'spear' && (opts.attacker.mount || opts.attacker.body === 'large') && opts.charge && !opts.attacker.chargeInterrupted && opts.chargeStraight && (opts.chargeDistance ?? opts.attacker.chargeDistance ?? 0) >= 2;
  const penetration = base + (sprint ? 2 : 0) + (opts.abilityDamage && !opts.abilityDamage.weaponBased ? 0 : traitPenetrationBonus(opts.attacker, weapon, opts.ranged ?? !!weapon?.tags?.includes('ranged'), base));
  // The battle rules, not a possibly stale unit field, decide the armor projection.
  const target={...opts.defender,damageModel:opts.rules?.damageModel,armsModel:opts.rules?opts.rules.armsModel:opts.defender.armsModel};
  const blockingShield = shieldUsable(target,weapon);
  if (!blockingShield) delete target.shield;
  const resistance = modern?anchoredProtection(target,channel):effectiveProtection(target, channel);
  const wounds=isWoundModel(opts.rules?.damageModel);
  const armorFactor=wounds?armorTransmission(target,channel,penetration):penetrationFactor(penetration,resistance);
  const spray=isArmsV2(opts.rules?.armsModel)&&(!opts.abilityDamage||!!opts.abilityDamage.weaponBased)&&weapon?.recipe?.mechanism==='sprayer';
  const area=spray||(opts.abilityDamage ? opts.abilityDamage.shape==='burst'||!!opts.abilityDamage.weaponBased&&(!!weapon?.tags?.includes('blast')||!!weapon?.splashTargets && weapon.recipe?.mechanism !== 'shotgun') : !!weapon?.tags?.includes('blast')||!!weapon?.splashTargets && weapon.recipe?.mechanism !== 'shotgun');
  // R1/R8/R20：挂背、碎盾或被巨型冷兵器无视的盾不挡，屏障换算与磨损也按不挡计。
  const canBlock=!(isArmsV2(opts.rules?.armsModel)&&opts.defender.shield&&!blockingShield)&&!opts.defender.conditions.some(c=>c.dur>0&&(opts.conditionDefs?.get(c.id)?.skipTurn||opts.conditionDefs?.get(c.id)?.preventAttack));
  const shieldFactor=wounds?shieldTransmission(target,channel,penetration,area,canBlock):1;
  const power=opts.abilityDamage&&!opts.abilityDamage.weaponBased?opts.abilityDamage.power:weapon?.recipe?.power??weapon?.level;
  return { channel, penetration, resistance, factor:armorFactor*shieldFactor,armorScale:modern?armorPowerScale(target):1,...(wounds?{armorFactor,shieldFactor}:{}),
    ...(modern&&opts.rules?.overmatch?{attackPower:power,protectionPower:defensePower(target,channel),overmatchMultiplier:overmatchMultiplier(power,target,channel,penetration,area,canBlock,false,opts.rules.overmatchCurve),area,canBlock,...(opts.rules.overmatchCurve?{curve:opts.rules.overmatchCurve}:{})}:{}) };
}

/** 与执行共用属性栈与穿透。期望值不读取实战 RNG；骰子取整/暴击导致实际结果有波动。 */
function criticalInfo(opts: Omit<AttackOpts,'rng'>, weapon?: Weapon): { minimum: number; forced: boolean } {
  const applies = isArmsV2(opts.rules.armsModel) && (!opts.abilityDamage || opts.abilityDamage.weaponBased), actual=weapon?.recipe?.mechanism;
  return { minimum: applies ? Math.min(opts.rules.critMin,WEAPON_CLASSES[actual ?? '']?.profile.critMin ?? opts.rules.critMin) : opts.rules.critMin,
    forced: !!applies && actual === 'dagger' && opts.defender.conditions.some(c=>c.dur>0&&['stunned','restrained','blinded','disarmed','confused','charmed'].includes(c.id)) };
}
export function previewAttack(opts: Omit<AttackOpts, 'rng'>): import('./actions.js').ActionPreview & { hitChance: number; expectedDamage: number; conditionValue?: number } {
  const preview = previewAttackOutcome(opts);
  const chance = preview.anyHitChance ?? preview.hitChance;
  const remaining = opts.rules.combatModel === MEMBER_HEALTH_MODEL ? memberHealth(opts.defender) : opts.defender.hp;
  return { ...preview, attackRollCount: (preview.aggregationSamples ?? 1) * (opts.abilityDamage ? 1 : (opts.weaponOverride ?? opts.attacker.weapon)?.attacks ?? 1), damageOnHit: preview.damageOnHit ?? Math.min(remaining, chance > 0 ? preview.expectedDamage / chance : 0) };
}

/** 保留含未命中的期望供战术 AI 使用；玩家展示由上层转换为命中后的损失。 */
function previewAttackOutcome(opts: Omit<AttackOpts, 'rng'>): import('./actions.js').ActionPreview & { hitChance: number; expectedDamage: number; conditionValue?: number } {
  const ctx = attackContext(opts), critInfo = criticalInfo(opts,ctx.weapon), resolved: ResolvedWeapon = { weapon: ctx.weapon };
  const hitChance = estimateHitChance(opts.rules, ctx.netAtk, ctx.targetDef);
  const source = opts.abilityDamage ?? ctx.weapon;
  const onHit = opts.rules.resolutionVersion === 'v2' && (!opts.abilityDamage || opts.abilityDamage.weaponBased) ? poisonHint(opts.attacker, opts.defender, ctx.weapon) : undefined;
  const dmg = resolveStack(ctx.atkMods, 'dmg', ctx.ctxAtk, { sameNameKeepsHighest: opts.rules.sameNameKeepsHighest, maxFlat: opts.rules.maxFlat });
  const ward = resolveStack(ctx.defMods, 'ward', ctx.ctxDef, { sameNameKeepsHighest: opts.rules.sameNameKeepsHighest, maxFlat: opts.rules.maxFlat });
  const protection = opts.rules.resolutionVersion === 'v2' ? penetrationContext(opts, resolved) : undefined;
  const factor = protection?.factor;
  const diagnostics = { ...(opts.rules.combatModel ? {participants:outcomeScale(opts,resolved).participants,memberHp:opts.defender.scale!=='hero'?memberDurability(opts.defender):undefined,aggregationSamples:cohortSamples(opts,resolved)} : {}), ...(protection ? { channel: protection.channel, penetration: protection.penetration, resistance: protection.resistance,armorScale:protection.armorScale,armorFactor:protection.armorFactor,shieldFactor:protection.shieldFactor } : {}),
    ...(opts.rules.overmatch?{overmatchMultiplier:protection?.overmatchMultiplier,attackPower:protection?.attackPower,protectionPower:protection?.protectionPower}:{}),
    weaponName: !opts.abilityDamage || opts.abilityDamage.weaponBased ? ctx.weapon?.name : undefined,
    attackScore: ctx.netAtk, defenseScore: ctx.targetDef, attackModifiers: ctx.attackDetail, defenseModifiers: describeStack(ctx.defStack) };
  const dr = factor === undefined ? Math.min(0.9, armorDR(opts.defender, opts.rules, opts.traitRegistry) + qualityGapDR(opts.attacker, opts.defender, ctx.weapon)) : 1 - factor;
  const total = averageDice(source?.baseDice) * (1 - dr) + averageDice(source?.apDice) * (factor ?? 1);
  const scale = outcomeScale(opts,resolved);
  if(opts.rules.combatModel===MEMBER_HEALTH_MODEL)return previewMemberAttack(opts,ctx,source,dmg.multTotal*ward.multTotal/(protection?.armorScale??1)*(protection?.overmatchMultiplier??1),factor??1,diagnostics,resolved,protection);
  if (factor !== undefined) {
    let hit = hitChance, critical = 0;
    if (opts.rules.hitMode === 'd20') {
      hit = 0;
      for (let n = 1; n <= 20; n++) {
        const p = opts.advantage === 'adv' ? (2 * n - 1) / 400 : opts.advantage === 'dis' ? (41 - 2 * n) / 400 : 1 / 20;
        hit += p * d20HitWeight({...opts.rules,critMin:critInfo.minimum}, n, ctx.netAtk, ctx.targetDef);
        if (n > 1 && n >= critInfo.minimum) critical += p;
      }
    }
    if (critInfo.forced) critical = hit;
    const samples=cohortSamples(opts,resolved);
    const multiplier = dmg.multTotal * ward.multTotal * scale.multiplier / samples;
    const normal = damageMoments(source?.baseDice, source?.apDice, 1, factor, multiplier);
    const crit = damageMoments(source?.baseDice, source?.apDice, opts.rules.critRule === 'doubleDice' ? 2 : 1, factor, multiplier);
    if (normal && crit) {
      const count = (opts.abilityDamage ? 1 : ctx.weapon?.attacks ?? 1) * samples;
      const mean = (hit - critical) * normal.mean + critical * crit.mean;
      const second = (hit - critical) * normal.second + critical * crit.second;
      const damageChance = 1 - Math.pow(1 - ((hit - critical) * normal.positive + critical * crit.positive), count);
      return { ...diagnostics, ...(opts.abilityDamage?.weaponBased ? { weaponName: ctx.weapon?.name } : {}), ...(onHit ? { onHit, conditionValue: poisonValue(opts.attacker, opts.defender, ctx.weapon, damageChance) } : {}), hitChance: hit, ...(isArmsV2(opts.rules.armsModel)?{critChance:critical}:{}), anyHitChance: 1-Math.pow(1-hit,count), damageChance, expectedDamage: mean * count, penetrationFactor: factor, exact: samples === 1,
        ...(count === 1 ? { normalHitDamage: normal.mean, ...(critical > 0 ? { criticalHitDamage: crit.mean } : {}) } : {}),
        variance: Math.max(0, second - mean * mean) * count, minDamage: hit < 1 ? 0 : normal.min * count, maxDamage: Math.max(normal.max, critical > 0 ? crit.max : 0) * count };
    }
  }
  return { ...diagnostics, ...(onHit ? { onHit, conditionValue: poisonValue(opts.attacker, opts.defender, ctx.weapon, total > 0 ? hitChance : 0) } : {}), hitChance, expectedDamage: total * dmg.multTotal * ward.multTotal * hitChance * (opts.abilityDamage ? 1 : ctx.weapon?.attacks ?? 1) * scale.multiplier, penetrationFactor: factor };
}

/** Independent burst budget is divided across exposed members within one target card. */
function memberAreaBudget(opts: Omit<AttackOpts,'rng'>): number {
  return opts.rules.damageModel === 'wounds-v2' && hasMemberHealth(opts.defender)
    && opts.abilityDamage && !opts.abilityDamage.weaponBased && opts.abilityDamage.shape === 'burst'
    ? 1 / Math.max(1, Math.min(opts.defender.hp, opts.abilityDamage.areaExposure ?? 4)) : 1;
}
/** resolved/penetration 须来自同一输入且守方尚未受损；缺省时自行计算。 */
function memberPlan(opts:Omit<AttackOpts,'rng'>,direct:number,targets:number,resolved?:ResolvedWeapon,penetration?:ReturnType<typeof penetrationContext>,ward?:StackResult):MemberDamagePlan {
  const weapon=resolved?resolved.weapon:combatWeapon(opts.weaponOverride??opts.attacker.weapon,opts.attacker,opts.defender,opts.rules.weaponOverflow,opts.rules.damageModel,opts.rules.overmatch,opts.rules.overmatchCurve);
  const rawExtra=hasMemberHealth(opts.defender)&&(!opts.abilityDamage||opts.abilityDamage.weaponBased)?Math.min(opts.defender.hp,weapon?.splashTargets??0):0;
  // V13 散兵：疏散的编队未被近敌牵制时，榴弹溅射波及的人数减半。
  const extra = stackingRevision(opts.defender) ? Math.floor(rawExtra * (ward?.protection?.exposure ?? 1)) : rawExtra&&traitsV13(opts.defender)&&!opts.defenderEngaged&&looseFormation(opts.defender)?Math.floor(rawExtra * (1 - phase2Value(opts.defender, 'loose-formation', 'formationReduction', .5))):rawExtra;
  const members=hasMemberHealth(opts.defender),directTargets=members?Math.min(opts.defender.hp,targets):targets>0?1:0,splashTargets=Math.min(opts.defender.hp,targets*extra),max=members?opts.defender.formation!.memberHp:opts.defender.base.hpMax;
  const overflow=members&&attackOverflow(opts,penetration,resolved);
  const artillery = opts.rules.artilleryModel && isCannonWeapon(weapon) && (!opts.abilityDamage || opts.abilityDamage.weaponBased);
  // Grid spray keeps its existing cone; tank ruptures keep their explicit auto-hit budget.
  const sprayDecay = opts.rules.artilleryModel === BOUNDED_BLAST_MODEL && weapon?.recipe?.mechanism === 'sprayer' && !opts.autoHit && (!opts.abilityDamage || opts.abilityDamage.weaponBased);
  const reference = max * directTargets, rawDirect = direct;
  if (artillery) direct = Math.round(artilleryDirect(rawDirect,reference,artilleryRetention(opts.defender,weapon?.recipe?.power ?? weapon?.level ?? 1)));
  const cappedDirect=overflow&&directTargets>0?direct:Math.min(direct,max*directTargets);
  const incomingSplash=Math.round(artillery || sprayDecay ? artillerySplash(rawDirect,reference,extra,weapon?.splashFactor??0) : direct*extra*(weapon?.splashFactor??0)),splash=Math.min(max*splashTargets,incomingSplash);
  const context=opts.rules.overmatch?penetration??penetrationContext(opts,resolved):undefined;
  // R15 重击：武器攻击与武器技能按结算武器的基础单段命中均值判定，预览与结算同一结果。V21 先按盾规格跨代换算。
  const energy=energyTier(opts,context);
  const heavy=(!opts.abilityDamage||opts.abilityDamage.weaponBased)&&!!weapon&&energyHeavyHit({...opts.defender,armsModel:opts.rules.armsModel},(diceAvg(weapon.baseDice)+(weapon.apDice?diceAvg(weapon.apDice):0))*(weapon.damageScale??1),energy?.tier);
  return {direct:cappedDirect,targets:directTargets,...(overflow?{overflow:true}:{}),...(heavy?{heavy:true as const}:{}),...(energy&&energy.ratio!==1?{energyRatio:energy.ratio}:{}),
    ...(context&&(context.overmatchMultiplier??1)>1?{overmatch:{power:context.attackPower,channel:context.channel,penetration:context.penetration,area:!!context.area,canBlock:context.canBlock!==false,multiplier:context.overmatchMultiplier!,...(opts.rules.overmatchCurve?{curve:opts.rules.overmatchCurve}:{})}}:{}),
    ...(direct>cappedDirect?{incomingDirect:direct}:{}),
    ...(extra&&targets?{splash,splashTargets,...(incomingSplash>splash?{incomingSplash}:{})}:{})};
}
/**
 * V21 能量盾规格：攻击规格P高于盾L时按跨代倍率多耗，低于盾L时按反向倍率少耗；
 * 伤害里已乘的对身体跨代倍率先除掉，盾按自己的规格吸收（同屏障的防御规格）。tier 用于重击判定，ratio 是每点伤害的盾消耗。
 */
function energyTier(opts:Omit<AttackOpts,'rng'>,context?:ReturnType<typeof penetrationContext>):{tier:number;ratio:number}|undefined {
  if(!isArmsV3(opts.rules.armsModel)||!energyShieldActive({...opts.defender,armsModel:opts.rules.armsModel})||context?.attackPower===undefined)return undefined;
  const P=context.attackPower,L=energyPower(opts.defender),curve=opts.rules.overmatchCurve;
  const tier=gradeOvermatch(P,L,1,0,curve)/gradeOvermatch(L,P,1,0,curve);
  return {tier,ratio:tier/(context.overmatchMultiplier??1)};
}
/** Independent direct spells release overflow only on overmatch; ordinary V6 spell pacing stays intact. */
function attackOverflow(opts:Omit<AttackOpts,'rng'>,penetration?:ReturnType<typeof penetrationContext>,resolved?:ResolvedWeapon):boolean {
  return !!opts.rules.weaponOverflow&&(!opts.abilityDamage||!!opts.abilityDamage.weaponBased
    ||!!opts.rules.overmatch&&((penetration??penetrationContext(opts,resolved)).overmatchMultiplier??1)>1);
}
function previewMemberPlan(unit:Combatant,plan:MemberDamagePlan):{damage:number;casualties:number} {
  if (unit.barrier || unit.energyShield) { const copy = cloneData(unit), before = copy.hp; const loss = applyDamagePlan(copy, plan); return { damage: loss.direct + loss.splash, casualties: hasMemberHealth(unit) ? before - copy.hp : 0 }; }
  if(!hasMemberHealth(unit))return {damage:Math.min(unit.hp,plan.direct),casualties:0};
  const copy={...unit,...(unit.shieldDurability?{shieldDurability:{...unit.shieldDurability}}:{}),formation:{...unit.formation!,health:unit.formation!.health!.map(g=>({...g}))}};
  const direct=damageMemberGroups(copy,plan.direct,plan.targets,plan.overflow);
  const splash=plan.splash&&plan.splashTargets?damageMemberGroups(copy,plan.splash,plan.splashTargets):{health:0,casualties:0};
  return {damage:direct.health+splash.health,casualties:direct.casualties+splash.casualties};
}
const memberPreviewCache=new Map<string,{mean:number;second:number;positive:number;casualties:number;max:number}>();

interface SampledMemberPreview { sum: number; squares: number; positive: number; casualties: number; maximum: number; hits: number }
const SAMPLED_PREVIEW_COUNT = 96;
// Cache values, not live units/resolutions. Both entry count and key memory are bounded.
const sampledMemberPreviewCache = new Map<string, SampledMemberPreview>();
const SAMPLE_CACHE_ENTRIES = 128, SAMPLE_CACHE_CHARS = 2 * 1024 * 1024;
let sampledPreviewChars = 0, sampledPreviewRuns = 0;
/** 成员伤损抽样预览实际执行的次数（缓存命中不计）；供测试确认缓存命中与失效。 */
export function sampledPreviewComputations(): number { return sampledPreviewRuns; }

// One AI decision previews thousands of what-if pairs against unchanged state and trait tables.
// A 30-card skill valuation needs a few hundred distinct samples, while the shared cache above
// keeps about a hundred ~20 KB keys and silently recomputes evicted ones. Inside a scope samples
// also go to a scope-local cache keyed by short table ids and dropped with the scope; a scope miss
// still consults the shared cache (earlier decisions) with the full key, whose table text is
// serialized once per table and scope. Callers must not change table contents inside a scope;
// values are the same either way, only their reuse differs.
interface ScopeTable { id: string; text: string }
interface PreviewScope { samples: Map<string, SampledMemberPreview>; chars: number; tables: WeakMap<object, ScopeTable>; ids: Map<string, string>; epoch: number;
  parts: Map<string, string>; partChars: number }
const SCOPE_CACHE_ENTRIES = 4096, SCOPE_CACHE_CHARS = 8 * 1024 * 1024;
let previewScope: PreviewScope | undefined, previewScopes = 0;
/** 开始一次只读估值（AI 选择行动）；结束前不得修改状态表或特质表内容。 */
export function beginPreviewScope(): void { previewScope = { samples: new Map(), chars: 0, tables: new WeakMap(), ids: new Map(), epoch: ++previewScopes, parts: new Map(), partChars: 0 }; }
export function endPreviewScope(): void { previewScope = undefined; }
/** 当前估值范围的编号；范围外为 undefined。供其他估值模块在同一范围内复用只读派生表。 */
export function previewScopeEpoch(): number | undefined { return previewScope?.epoch; }
function scopeTable(scope: PreviewScope, table: Map<string, unknown>): ScopeTable {
  let entry = scope.tables.get(table);
  if (!entry) {
    const text = JSON.stringify([...table]);
    let id = scope.ids.get(text);
    if (id === undefined) { id = '#' + scope.ids.size; scope.ids.set(text, id); }
    scope.tables.set(table, entry = { id, text });
  }
  return entry;
}
function sampledPreviewState(opts: Omit<AttackOpts, 'rng'>) {
  // Damage receives terrain, distance, participants and external modifiers explicitly.
  // Coordinates only affect directional brace (whether the pose is still held and whether
  // the opponent stands in its front arc) and V13 works (whether the unit still stands on its
  // anchored spot). The key keeps exactly those brace modifiers (and pose presence, which
  // cancels loose formation) and an on-works flag instead of absolute cells and anchors.
  // HP, barrier power/duration, equipment, traits, fatigue, rules and mutable registry
  // *contents* remain in the key (not just object IDs).
  // The resolution chain reads fatigue only as its penalty step and distance only as
  // <=1 / >1 / >=2. SP, cooldowns, effort, engagement lists, zones and the attacker's own
  // barrier never enter hit or loss, so AI what-if copies differing only there share samples.
  const ranged = opts.ranged ?? isRangedCapable(opts.attacker);
  const unit = (u: Combatant, opponent: Combatant, attacker: boolean) => ({ ...u, pos: undefined, formationPosition: undefined,
    entrenchedAt: u.entrenchedAt === undefined ? undefined : entrenched(u),
    tacticalPose: u.tacticalPose ? defensivePostureMods(u, { defender: opponent, ranged, charge: opts.charge }, opts.conditionDefs, opts.traitRegistry) : undefined,
    fatigue: fatiguePenalty(u), resources: undefined, abilityState: undefined, tacticalEffort: undefined, engagedWith: undefined, battleZones: undefined,
    ...(attacker ? { barrier: undefined } : {}) });
  // V15 巷战专精的“2格内射击”还区分 2 格与更远，只有带巷战专精的攻击方保留到 3 格。
  const closeShots = itemsV15(opts.attacker) && activeTraitIds(opts.attacker).includes('urban-fighter');
  const distance = isArmsV2(opts.rules.armsModel) ? opts.distance : opts.distance === undefined ? undefined : opts.distance <= 1 ? 1 : closeShots ? Math.min(3, opts.distance) : opts.distance >= 2 ? 2 : opts.distance;
  return { ...opts, distance, attacker: unit(opts.attacker, opts.defender, true), defender: unit(opts.defender, opts.attacker, false),
    conditionDefs: undefined, traitRegistry: undefined };
}
/** Store a unit/attack description once instead of copying both full skill inventories
 * into every pair's key. Full JSON equality is retained; no combat fields are omitted.
 * At the memory bound fall back to the full text, with a disjoint prefix from IDs. */
function scopePart(scope: PreviewScope, value: unknown): string {
  const text = JSON.stringify(value), found = scope.parts.get(text);
  if (found !== undefined) return found;
  if (scope.parts.size >= SCOPE_CACHE_ENTRIES || scope.partChars + text.length > SCOPE_CACHE_CHARS) return ':' + text;
  const id = 'p' + scope.parts.size;
  scope.parts.set(text, id); scope.partChars += text.length;
  return id;
}
/** The state and trait tables follow the JSON object; JSON text has no raw newline, so the parts cannot run together. */
function sampledPreviewKeys(opts: Omit<AttackOpts, 'rng'>, scope: PreviewScope | undefined): { key: string; shared: () => string } {
  const state = sampledPreviewState(opts);
  if (!scope) {
    const key = JSON.stringify(state) + '\n' + JSON.stringify([...opts.conditionDefs]) + '\n' + (opts.traitRegistry ? JSON.stringify([...opts.traitRegistry]) : '');
    return { key, shared: () => key };
  }
  const defs = scopeTable(scope, opts.conditionDefs), registry = opts.traitRegistry && scopeTable(scope, opts.traitRegistry);
  const { attacker, defender, ...attack } = state;
  const base = [scopePart(scope, attacker), scopePart(scope, defender), scopePart(scope, attack)].join('\n');
  return { key: base + '\n' + defs.id + '\n' + (registry?.id ?? ''), shared: () => JSON.stringify(state) + '\n' + defs.text + '\n' + (registry?.text ?? '') };
}
function rememberScopedPreview(scope: PreviewScope, key: string, value: SampledMemberPreview): void {
  if (key.length > SCOPE_CACHE_CHARS) return;
  while (scope.samples.size >= SCOPE_CACHE_ENTRIES || scope.chars + key.length > SCOPE_CACHE_CHARS) {
    const oldest = scope.samples.keys().next().value;
    if (oldest === undefined) break;
    scope.chars -= oldest.length; scope.samples.delete(oldest);
  }
  scope.samples.set(key, value); scope.chars += key.length;
}
function rememberSampledPreview(key: string, value: SampledMemberPreview): void {
  if (key.length > SAMPLE_CACHE_CHARS) return;
  while (sampledMemberPreviewCache.size >= SAMPLE_CACHE_ENTRIES || sampledPreviewChars + key.length > SAMPLE_CACHE_CHARS) {
    const oldest = sampledMemberPreviewCache.keys().next().value;
    if (oldest === undefined) break;
    sampledPreviewChars -= oldest.length; sampledMemberPreviewCache.delete(oldest);
  }
  sampledMemberPreviewCache.set(key, value); sampledPreviewChars += key.length;
}

/** 有界骰分布×成员伤损组；不触碰实战对象或随机源。多组攻击的目标耗尽仅作上限裁剪。 */
function previewMemberAttack(opts:Omit<AttackOpts,'rng'>,ctx:ReturnType<typeof attackContext>,source:AttackOpts['abilityDamage']|Weapon|undefined,modifier:number,factor:number,diagnostics:Record<string,unknown>,resolved?:ResolvedWeapon,protection?:ReturnType<typeof penetrationContext>) {
  const critInfo=criticalInfo(opts,ctx.weapon);
  let hit=estimateHitChance(opts.rules,ctx.netAtk,ctx.targetDef),critical=0;
  if(opts.rules.hitMode==='d20'){
    hit=0;for(let n=1;n<=20;n++){const p=opts.advantage==='adv'?(2*n-1)/400:opts.advantage==='dis'?(41-2*n)/400:1/20;hit+=p*d20HitWeight({...opts.rules,critMin:critInfo.minimum},n,ctx.netAtk,ctx.targetDef);if(n>=critInfo.minimum)critical+=p;}
  }
  if(critInfo.forced)critical=hit;
  const samples=cohortSamples(opts,resolved),weight=outcomeScale({...opts,packetShare:1/samples},resolved).multiplier,count=(opts.abilityDamage?1:ctx.weapon?.attacks??1)*samples;
  const rawMultiplier=memberAreaBudget(opts)*modifier*factor*(source?.damageScale??1)*trainingDamage(opts.attacker.level,opts.rules)*unitMultiplier(opts.attacker,'damage',opts.abilityDamage?.channel??ctx.weapon?.channel??'kinetic',combatBonuses(opts.attacker))*wornDamageMultiplier(opts.attacker,opts.abilityDamage?.channel??ctx.weapon?.channel??'kinetic');
  const maxBase=diceDistribution(source?.baseDice,opts.rules.critRule==='doubleDice'?2:1),maxAp=diceDistribution(source?.apDice,opts.rules.critRule==='doubleDice'?2:1);
  const upper=maxBase&&maxAp ? Math.ceil((Math.max(...maxBase.keys())+Math.max(...maxAp.keys()))*rawMultiplier*Math.ceil(weight))*count : Infinity;
  // 连续攻击共用剩余屏障。固定种子的小样本估计只操作副本，不消耗实战随机数。
  if (count > 1 && (hasMemberHealth(opts.defender) || opts.defender.barrier || opts.defender.energyShield || upper>memberHealth(opts.defender)) || !maxBase || !maxAp) {
    const scope = previewScope, { key, shared } = sampledPreviewKeys(opts, scope);
    let stats = (scope?.samples ?? sampledMemberPreviewCache).get(key);
    const sharedKey = scope && !stats ? shared() : key;
    if (scope && !stats && (stats = sampledMemberPreviewCache.get(sharedKey))) rememberScopedPreview(scope, key, stats);
    if (!stats) {
      stats = { sum: 0, squares: 0, positive: 0, casualties: 0, maximum: 0, hits: 0 }; sampledPreviewRuns++;
      // 结算只改守方；攻方副本由全部抽样共用，守方每次从原状态重新复制。
      const attacker = cloneData(opts.attacker), previewMemo: PreviewMemo = { bases: new Map() };
      for (let i = 0; i < SAMPLED_PREVIEW_COUNT; i++) {
        const defender = damageCopy(opts.defender);
        const rng = new SeededRng('barrier-preview:' + i), before = memberHealth(defender), members = defender.hp;
        let hitAny = false;
        for (let n = 0; n < (opts.abilityDamage ? 1 : ctx.weapon?.attacks ?? 1) && defender.hp > 0; n++) {
          hitAny = sampledAttackHit({ ...opts, attacker, defender, rng, previewMemo }) || hitAny;
        }
        stats.hits += Number(hitAny);
        const loss = before - memberHealth(defender);
        stats.sum += loss; stats.squares += loss * loss; stats.positive += Number(loss > 0);
        stats.casualties += members - defender.hp; stats.maximum = Math.max(stats.maximum, loss);
      }
      rememberSampledPreview(sharedKey, stats);
      if (scope) rememberScopedPreview(scope, key, stats);
    }
    const mean = stats.sum / SAMPLED_PREVIEW_COUNT;
    return {...diagnostics,damageModel:'member-health' as const,...(opts.rules.overmatch?{weaponOverflow:hasMemberHealth(opts.defender)&&attackOverflow(opts,protection,resolved)}:{}),hitChance:hit,...(isArmsV2(opts.rules.armsModel)?{critChance:critical}:{}),anyHitChance:1-(1-hit)**count,expectedDamage:mean,damageOnHit:stats.hits?stats.sum/stats.hits:0,
      expectedCasualties:hasMemberHealth(opts.defender)?stats.casualties/SAMPLED_PREVIEW_COUNT:undefined,damageChance:stats.positive/SAMPLED_PREVIEW_COUNT,penetrationFactor:factor,exact:false,
      variance:Math.max(0,stats.squares/SAMPLED_PREVIEW_COUNT-mean*mean),minDamage:0,maxDamage:stats.maximum};
  }
  // 预览不改动单位：溢出判定与穿透在全部骰面组合中保持不变。
  const penetration=opts.rules.overmatch?protection??penetrationContext(opts,resolved):undefined,overflow=attackOverflow(opts,penetration,resolved);
  const ward = resolveStack(ctx.defMods, 'ward', ctx.ctxDef, {sameNameKeepsHighest:opts.rules.sameNameKeepsHighest,maxFlat:opts.rules.maxFlat});
  const moments=(times:number)=>{
    const key=JSON.stringify([opts.rules.artilleryModel,opts.defender.level,opts.defender.armor,ctx.weapon?.recipe?.power??ctx.weapon?.level,source?.baseDice,source?.apDice,rawMultiplier,times,weight,opts.defender.hp,opts.defender.barrier,opts.defender.energyShield,opts.defender.shield?.recipe,opts.defender.armsModel,opts.defender.formation,ctx.weapon?.splashTargets,ctx.weapon?.splashFactor,ward.protection?.exposure,opts.abilityDamage?.weaponBased,!!opts.abilityDamage,overflow,opts.rules.overmatch?penetration:undefined]);
    const cached=memberPreviewCache.get(key);if(cached)return cached;
    const base=diceDistribution(source?.baseDice,times),ap=diceDistribution(source?.apDice,times);
    const result={mean:0,second:0,positive:0,casualties:0,max:0};
    if(!base||!ap)return result;
    const low=Math.floor(weight),fraction=weight-low,targets=[[low,1-fraction],[low+1,fraction]];
    for(const [b,bp] of base)for(const [a,apb] of ap)for(const [n,np] of targets){
      if(!np)continue;const raw=(b+a)*rawMultiplier*n!,floor=Math.floor(raw),frac=raw-floor;
      for(const [amount,p] of [[floor,1-frac],[floor+1,frac]]){
        if(!p)continue;const event=previewMemberPlan(opts.defender,memberPlan(opts,amount!,n!,resolved,penetration,ward)),prob=bp*apb*np!*p!;
        result.mean+=event.damage*prob;result.second+=event.damage**2*prob;result.positive+=Number(event.damage>0)*prob;result.casualties+=event.casualties*prob;result.max=Math.max(result.max,event.damage);
      }
    }
    if(memberPreviewCache.size>1024)memberPreviewCache.clear();memberPreviewCache.set(key,result);return result;
  };
  const normal=moments(1),crit=moments(opts.rules.critRule==='doubleDice'?2:1),mean=(hit-critical)*normal.mean+critical*crit.mean,second=(hit-critical)*normal.second+critical*crit.second;
  return {...diagnostics,damageModel:'member-health' as const,weaponOverflow:hasMemberHealth(opts.defender)&&overflow,hitChance:hit,...(isArmsV2(opts.rules.armsModel)?{critChance:critical}:{}),anyHitChance:1-(1-hit)**count,expectedDamage:Math.min(memberHealth(opts.defender),mean*count),
    ...(count === 1 ? { normalHitDamage: normal.mean, ...(critical > 0 ? { criticalHitDamage: crit.mean } : {}) } : {}),
    expectedCasualties:hasMemberHealth(opts.defender)?Math.min(opts.defender.hp,((hit-critical)*normal.casualties+critical*crit.casualties)*count):undefined,
    damageChance:1-(1-((hit-critical)*normal.positive+critical*crit.positive))**count,penetrationFactor:factor,exact:count===1,variance:Math.max(0,second-mean*mean)*count,minDamage:0,maxDamage:Math.min(memberHealth(opts.defender),Math.max(normal.max,critical?crit.max:0)*count)};
}

/** V3按人数展开并以成员耐久折算减员；V2保留固定展开与10点换算。 */
function outcomeScale(opts: Omit<AttackOpts, 'rng'>, resolved?: ResolvedWeapon): { participants: number; multiplier: number } {
  if (opts.rules.resolutionVersion !== 'v2') return { participants: 1, multiplier: 1 };
  if(opts.rules.combatModel===MEMBER_HEALTH_MODEL){
    const a=opts.attacker,d=opts.defender,ranged=opts.ranged??isRangedCapable(a),weapon=resolved?resolved.weapon:combatWeapon(opts.weaponOverride??a.weapon,a,d,opts.rules.weaponOverflow,opts.rules.damageModel,opts.rules.overmatch,opts.rules.overmatchCurve);
    const weaponAttack=!opts.abilityDamage||opts.abilityDamage.weaponBased;
    const fallbackWidth=engagementWidth(a,d,ranged,undefined,opts.fieldTags)*Math.max(1,personnel(a)/COHORT_REFERENCE);
    const available=a.body==='vehicle'?personnel(a):Math.min(personnel(a),opts.participants??fallbackWidth);
    const count=a.scale==='hero'?1:Math.min(available,weaponAttack?targetWidthLimit(d,ranged,opts.rules.targetWidthModel??null):Infinity);
    const crew=a.scale!=='hero'&&(a.body??'human')==='human'&&(!opts.abilityDamage||opts.abilityDamage.weaponBased)&&!opts.abilityDamage?.delivery?.startsWith('magic')?weaponCrew(weapon,opts.rules.armsModel):1;
    // 疏散的近战代价是编队只展开一半人数；V21 起个体不再按半数出手（个体没有阵形可散，旧战斗保持原结算）。
    const loose=Math.max(0,count/crew)*(!ranged&&looseFormation(a)&&!(a.scale==='hero'&&isArmsV3(opts.rules.armsModel))?0.5:1);
    // V12: a formation throws one demolition charge per three participants instead of one per member.
    const participants=opts.rules.armsModel&&a.scale!=='hero'&&(!opts.abilityDamage||opts.abilityDamage.weaponBased)&&weapon?.tags?.includes('blast')?demolitionPackets(loose):loose;
    const area=hasMemberHealth(d)&&opts.abilityDamage&&!opts.abilityDamage.weaponBased&&opts.abilityDamage.shape==='burst'?Math.min(d.hp,opts.abilityDamage.areaExposure??4):1;
    return {participants,multiplier:participants*area*(opts.packetShare??1)};
  }
  if(opts.rules.combatModel===COHORT_MODEL){
    const a=opts.attacker,d=opts.defender,ranged=opts.ranged??isRangedCapable(a),width=engagementWidth(a,d,ranged,undefined,opts.fieldTags);
    const packets=d.scale==='hero'?1:Math.max(1,personnel(a)/COHORT_REFERENCE);
    let participants=a.scale==='hero'?1:Math.min(personnel(a),opts.participants??width*packets);
    if(!ranged&&looseFormation(a))participants*=.5;
    const blast=(!opts.abilityDamage||opts.abilityDamage.weaponBased)&&(opts.weaponOverride??a.weapon)?.tags?.includes('blast');
    if(blast&&a.scale!=='hero')participants*=2/(ranged?10:8);
    const exposure=d.scale==='hero'?1:blast?Math.min(d.hp,6):opts.abilityDamage?.shape==='burst'?Math.min(d.hp,a.scale==='hero'?opts.abilityDamage.areaExposure??4:2):1;
    return {participants,multiplier:participants*exposure/(d.scale==='hero'?1:memberDurability(d))*(opts.packetShare??1)};
  }
  const blast = (!opts.abilityDamage || opts.abilityDamage.weaponBased) && (opts.weaponOverride ?? opts.attacker.weapon)?.tags?.includes('blast');
  let participants = opts.abilityDamage && !opts.abilityDamage.weaponBased || opts.attacker.scale === 'hero' ? 1
    : Math.max(0, Math.min(opts.attacker.hp, opts.participants ?? engagementWidth(opts.attacker, opts.defender, opts.ranged ?? isRangedCapable(opts.attacker), undefined, opts.fieldTags), 12));
  // 爆破按有限工兵组投送：英雄一份，编队最多两份，并受存活人数/展开限制。
  if (blast) participants = Math.min(participants, 2);
  if (participants > 0 && (!opts.abilityDamage || opts.abilityDamage.weaponBased) && !(opts.ranged ?? isRangedCapable(opts.attacker)) && looseFormation(opts.attacker)) participants = Math.max(1, Math.floor(participants / 2));
  const exposure = opts.defender.scale !== 'hero' && (blast || opts.abilityDamage?.shape === 'burst' && !opts.abilityDamage.weaponBased)
    ? Math.max(1, Math.min(opts.defender.hp, blast ? 6 : Math.min(4, opts.abilityDamage?.areaExposure ?? 1))) : 1;
  return { participants, multiplier: participants * exposure / (opts.defender.scale === 'hero' ? 1 : 10) };
}

function attackContext(opts: Omit<AttackOpts, 'rng'>) {
  const { attacker, defender, rules } = opts;
  const ranged = opts.ranged ?? isRangedCapable(attacker);
  const charge = opts.charge && !(isArmsV2(rules.armsModel) && attacker.chargeInterrupted);
  // 结算用武器：副武器近战切换时覆盖（骰子/等级/惩罚判定同源）
  const original=opts.weaponOverride ?? attacker.weapon;
  const weapon = resolveWeapon(opts).weapon;

  // 远程武器被迫近战（借机攻击/贴身挥击/军团近战阶段）：枪托弓杆终究不是称手兵器
  // 「远近双全」（no-melee-penalty 旗标）豁免——刺刀/弓杆近战有专门训练；
  // 换用近战副武器结算时武器本身不带 ranged 标签，天然免罚
  const extraMods: Modifier[] = [...(opts.extraMods ?? [])];
  const armsAttack = isArmsV2(rules.armsModel) && (!opts.abilityDamage || opts.abilityDamage.weaponBased), actual = original?.recipe?.mechanism;
  if (armsAttack && actual === 'great-weapon' && defender.shield && shieldClass(defender) !== 'energy-shield') extraMods.push({source:'intrinsic',name:'破盾',kind:'atk',type:'flat',value:0});
  if (armsAttack && actual === 'axe' && shieldUsable({...defender,armsModel:rules.armsModel},original)) extraMods.push({source:'intrinsic',name:'斧劈盾',kind:'atk',type:'flat',value:0});
  if (isArmsV2(rules.armsModel) && overloadPenalty(attacker)) extraMods.push({source:'intrinsic',name:'超载',kind:'atk',type:'flat',value:-overloadPenalty(attacker)});
  if (criticalInfo(opts,weapon).forced) extraMods.push({source:'intrinsic',name:'破绽一击',kind:'atk',type:'flat',value:0});
  if (armsAttack && !ranged && actual === 'heavy-polearm' && (defender.mount || ['large','giant'].includes(defender.body ?? 'human'))) extraMods.push({source:'intrinsic',name:'钩拽',kind:'atk',type:'flat',value:HOOK_ACCURACY});
  if (armsAttack && !ranged && actual === 'spear' && (attacker.mount || attacker.body === 'large') && charge && opts.chargeStraight && (opts.chargeDistance ?? attacker.chargeDistance ?? 0) >= 2) extraMods.push({source:'intrinsic',name:'骑乘冲刺',kind:'dmg',type:'mult',value:MOUNTED_SPRINT_DAMAGE});
  if (armsAttack && ranged) {
    const grid = gridAttack(attacker), distance = opts.distance ?? 0;
    if (actual === 'crossbow') extraMods.push({ source:'intrinsic',name:'弩：易学',kind:'atk',type:'flat',value:Math.min(trainingEdge(attacker.level),1)+2 });
    if (actual === 'shotgun') {
      if (distance <= (grid ? 2 : 1)) extraMods.push({source:'intrinsic',name:'霰弹近距',kind:'atk',type:'flat',value:2});
      else extraMods.push({source:'intrinsic',name:'霰弹衰减',kind:'dmg',type:'mult',value:grid ? distance===3 ? .7 : .4 : .6});
    }
    if (actual === 'firearm' && distance > (grid ? 4 : 2)) extraMods.push({source:'intrinsic',name:'火枪失准',kind:'atk',type:'flat',value:-2});
    if (actual === 'heavy-rifle' && !(opts.moved ?? attacker.movedDuringActivation)) extraMods.push({source:'intrinsic',name:'瞄准',kind:'atk',type:'flat',value:2});
  }
  if (opts.actionDamageScale !== undefined && opts.actionDamageScale !== 1) extraMods.push({ source: 'temp', name: '加速攻击预算', kind: 'dmg', type: 'mult', value: opts.actionDamageScale });
  if (rules.combatModel === MEMBER_HEALTH_MODEL && !ranged && (!opts.abilityDamage || opts.abilityDamage.weaponBased)) {
    const melee = meleeProfile(weapon);
    if (melee?.accuracy) extraMods.push({ source: 'intrinsic', name: '近战武器操控', kind: 'atk', type: 'flat', value: melee.accuracy });
    const close = rules.armsModel ? melee?.armsClosePenalty ?? melee?.closePenalty : melee?.closePenalty;
    if (close && opts.distance !== undefined && opts.distance <= 1) {
      extraMods.push({ source: 'intrinsic', name: '长柄贴身受限', kind: 'atk', type: 'flat', value: close });
    }
  }
  if (rules.armsModel && ranged && (!opts.abilityDamage || opts.abilityDamage.weaponBased)) {
    // V12 heavy weapons: guns cannot easily lay on one person; one person cannot serve an autocannon at full rate.
    if (isCannonWeapon(weapon) && humanSizedIndividual(defender)) extraMods.push({ source: 'intrinsic', name: '火炮瞄准单兵', kind: 'atk', type: 'flat', value: ARTILLERY_SMALL_TARGET });
    if (loneHeavyOperator(attacker, weapon)) extraMods.push({ source: 'intrinsic', name: '单人操作机炮', kind: 'dmg', type: 'mult', value: LONE_AUTOCANNON_SHARE });
  }
  // 实际投送距离共用于预览、普通攻击、警戒与武器技能；独立法术不借用武器修正。
  if (rules.resolutionVersion === 'v2' && ranged && (!opts.abilityDamage || opts.abilityDamage.weaponBased)
    && weapon?.tags?.includes('blast') && (opts.distance ?? 0) >= 2) {
    extraMods.push({ source: 'stance', name: '爆破远距攻击', kind: 'atk', type: 'flat', value: -2 });
  }
  if (
    !ranged &&
    rules.rangedMeleePenalty &&
    weapon?.tags?.includes('ranged') &&
    !hasFlag(attacker, 'no-melee-penalty', opts.traitRegistry)
  ) {
    extraMods.push({
      source: 'stance',
      name: '武器不善近战',
      kind: 'atk',
      type: 'flat',
      value: rules.rangedMeleePenalty,
    });
  }

  // ---- 收集双方修正 ----
  // 攻击方视角：条件修正看 defender 的标签
  const moved = opts.moved ?? attacker.movedDuringActivation ?? extraMods.some(m => m.category === 'movement');
  const ctxAtk = { moved, maxRange: weaponRange(weapon), chargeStraight: opts.chargeStraight, skillDelivery: opts.abilityDamage?.delivery, attacker, defender, charge, ranged, weapon, fieldTags: opts.fieldTags, localTerrain: opts.localTerrain,macroEnvironment:opts.macroEnvironment,heightRules:opts.heightRules,heightAdvantage:0, terrain: opts.attackerTerrain, opponentTerrain: opts.defenderTerrain, distance: opts.distance,
    attackerHigher: opts.heightRules ? (opts.attackerHeight ?? 0) > (opts.defenderHeight ?? 0) : opts.attackerTerrain === 'hill' && opts.defenderTerrain !== 'hill' };
  if (!progression(attacker) && phase2Traits(attacker) && effectiveTraitLevel(attacker, 'sharpshooter') >= 10 && ranged && (!opts.abilityDamage || opts.abilityDamage.weaponBased)) {
    let mitigation = 1; for (let i = 0; i < extraMods.length && mitigation > 0; i++) if (extraMods[i]!.category === 'movement' && extraMods[i]!.kind === 'atk' && extraMods[i]!.value < 0) { const n = Math.min(mitigation, -extraMods[i]!.value); extraMods[i] = { ...extraMods[i]!, value: extraMods[i]!.value + n }; mitigation -= n; }
  }
  const atkMods = collectMods(attacker, ctxAtk, opts.conditionDefs, extraMods, opts.traitRegistry);
  if (progression(attacker)) {
    const spotting = atkMods.find(m => m.sourceId === 'recon:spotting');
    if (spotting) {
      let remaining = spotting.value; spotting.value = 0;
      for (const mod of atkMods) if (mod.category === 'spotting' && mod.kind === 'atk' && mod.value < 0) { const n = Math.min(remaining, -mod.value); mod.value += n; remaining -= n; }
    }
  }
  const atkStack = resolveStack(atkMods, 'atk', ctxAtk, { sameNameKeepsHighest: rules.sameNameKeepsHighest, maxFlat: rules.maxFlat });

  // 防御方视角：其条件修正（如「仅对大型目标生效」）看攻击方标签
  // R16 喷射：按范围攻击处理，不计掩护、工事远程减伤、盾牌覆盖和盾墙。
  const spray = armsAttack && actual === 'sprayer';
  const ctxDef = { damageChannel: opts.abilityDamage?.channel ?? weapon?.channel ?? 'kinetic' as const, looseViaTargets: hasMemberHealth(defender) && !!weapon?.splashTargets && (!opts.abilityDamage || !!opts.abilityDamage.weaponBased), spray, area: spray || opts.abilityDamage?.shape === 'burst' || ((!opts.abilityDamage || opts.abilityDamage.weaponBased) && (!!weapon?.tags?.includes('blast') || progression(defender) && !!weapon?.splashTargets)), attacker: defender, defender: attacker, charge, ranged, weapon: defender.weapon, fieldTags: opts.fieldTags, localTerrain: opts.localTerrain,heightRules:opts.heightRules,heightAdvantage:opts.heightAdvantage, terrain: opts.defenderTerrain, opponentTerrain: opts.attackerTerrain, distance: opts.distance, engaged: opts.defenderEngaged };
  const usableShield = !spray && shieldUsable({...defender,armsModel:rules.armsModel},original);
  const shieldDefender = usableShield ? defender : {...defender,shield:undefined};
  const defenderMods = [...(opts.defenderMods ?? [])];
  if (isArmsV2(rules.armsModel) && overloadPenalty(defender)) defenderMods.push({source:'intrinsic',name:'超载',kind:'def',type:'flat',value:-overloadPenalty(defender)});
  if (isArmsV2(rules.armsModel) && usableShield && ranged && shieldClass(defender)==='tower-shield') defenderMods.push({source:'intrinsic',name:'大盾遮蔽',kind:'def',type:'flat',value:1});
  if (isArmsV2(rules.armsModel) && usableShield && !ranged && shieldClass(defender)==='buckler' && (!opts.abilityDamage || opts.abilityDamage.weaponBased)) defenderMods.push({source:'intrinsic',name:'小盾格挡',kind:'def',type:'flat',value:1});
  if (rules.combatModel === MEMBER_HEALTH_MODEL && defender.status === 'ready'
    && !defender.conditions.some(c => c.dur > 0 && (opts.conditionDefs.get(c.id)?.preventAttack || opts.conditionDefs.get(c.id)?.skipTurn))) {
    // 贴身沿用近战换武器规则；备用武器不与当前武器重复叠加。
    const defensiveWeapon = (!ranged ? meleeWeapon(defender) : undefined) ?? defender.weapon ?? defender.sidearm;
    const weaponDefense = equipmentStep(defensiveWeapon?.recipe, 'defense');
    if (weaponDefense) defenderMods.push({ source: 'intrinsic', name: '武器防御修正', kind: 'def', type: 'flat', value: weaponDefense });
    if (!ranged && (!opts.abilityDamage || opts.abilityDamage.weaponBased)) {
      const parry = meleeProfile(meleeWeapon(defender))?.parry;
      if (parry) defenderMods.push({ source: 'intrinsic', name: '剑术格挡', kind: 'def', type: 'flat', value: parry });
    }
  }
  const defMods = collectMods(shieldDefender, ctxDef, opts.conditionDefs, defenderMods, opts.traitRegistry).filter(m => !spray || m.category !== 'cover');
  if (phase2Traits(attacker) && ranged && (!opts.abilityDamage || opts.abilityDamage.weaponBased)) {
    const level = effectiveTraitLevel(attacker, 'sharpshooter'); let remaining = progression(attacker) ? level ? traitParameter('sharpshooterCover', level, attacker.traitLevelModel) : 0 : level >= 8 ? 2 : level >= 6 ? 1 : 0;
    for (let i = 0; i < defMods.length && remaining > 0; i++) if (defMods[i]!.category === 'cover' && defMods[i]!.kind === 'def' && defMods[i]!.value > 0) { const n = Math.min(remaining, defMods[i]!.value); defMods[i] = { ...defMods[i]!, value: defMods[i]!.value - n }; remaining -= n; }
  }
  if (phase2Traits(defender) && opts.opportunity && effectiveTraitLevel(defender, 'agile')) defMods.push({ source: 'intrinsic', sourceId: 'agile:opportunity', wardGroup: 'b', name: '身法减轻借机伤害', kind: 'ward', type: 'mult', value: 1 - phase2Value(defender, 'agile', 'agileReactionReduction', 1) });
  const defStack = resolveStack(defMods, 'def', ctxDef, { sameNameKeepsHighest: rules.sameNameKeepsHighest, maxFlat: rules.maxFlat });

  const modern = rules.combatModel === MEMBER_HEALTH_MODEL;
  const precision = modern ? (armsAttack && ranged && actual === 'crossbow' ? 0 : trainingEdge(attacker.level)) + unitStep({...attacker,bonuses:combatBonuses(attacker)},'accuracy') + (wornEffects(attacker).accuracy ?? 0) + (opts.abilityDamage?.accuracy??0) + (!opts.abilityDamage || opts.abilityDamage.weaponBased ? equipmentStep(weapon?.recipe,'accuracy') : 0) : 0;
  const evasion = modern ? trainingEdge(defender.level) + unitStep({...defender,bonuses:combatBonuses(defender)},'defense') + (wornEffects(defender).defense ?? 0) + equipmentStep(defender.armor?.recipe,'defense') + equipmentStep(usableShield ? defender.shield?.recipe : undefined,'defense') : 0;
  const netAtk = attacker.base.atk + atkStack.flatTotal + precision;
  const targetDef = defender.base.def + defStack.flatTotal + evasion;

  const attackDetail = [describeStack(atkStack), ...extraMods.filter(m => m.kind === 'atk' && m.value === 0 && ['破盾','斧劈盾','破绽一击'].includes(m.name) || m.kind === 'dmg' && ['骑乘冲刺','霰弹衰减','拒止冲锋'].includes(m.name)).map(m => m.name + (m.kind === 'dmg' ? ' ×' + displayNumber(m.value) : ''))].filter(Boolean).join('；');
  return { ranged, weapon, atkMods, defMods, ctxAtk, ctxDef, atkStack, defStack, netAtk, targetDef, attackDetail };
}

/** 会战按阶段准备后统一提交，后提交的攻击仍以目标剩余人数限制逐组实记。 */
export function recordAppliedDamage(result: AttackResolution, loss: number): void {
  result.finalDamage=loss;
  let remaining=loss;
  for(const packet of result.packetRolls??[]){
    const actual=Math.min(remaining,packet.damage);
    if(actual!==packet.damage)packet.potentialDamage??=packet.damage;
    packet.damage=actual;remaining-=actual;
  }
}

/** 会战延后提交仍执行原始命中方案，按此刻各成员的剩余生命裁剪。 */
export function applyResolutionDamage(target:Combatant,result:AttackResolution):number {
  const shieldBefore = barrierAmount(target);
  if(result.damageModel!=='member-health'){
    const stood=target.moraleState?.indomitable;
    result.hpBefore=target.hp;const loss=applyHealthLoss(target,result.unshieldedDamage ?? result.finalDamage);result.hpAfter=target.hp;if(shieldBefore)result.barrierAbsorbed=shieldBefore-barrierAmount(target);else delete result.barrierAbsorbed;
    if(!stood&&target.moraleState?.indomitable&&result.text)result.text+=INDOMITABLE_NOTE(target);
    return loss;
  }
  result.hpBefore=memberHealth(target);result.membersBefore=target.hp;
  let direct=0,splash=0,overflow=0,energy=0,spent=0,converted=false,overloaded=0;
  for(const [i,plan] of (result.damagePlans??[]).entries()){const loss=applyDamagePlan(target,plan);direct+=loss.direct;splash+=loss.splash;overflow+=loss.overflow;energy+=loss.energyAbsorbed??0;spent+=loss.energySpent??loss.energyAbsorbed??0;converted||=loss.energySpent!==undefined;overloaded+=loss.energyOverloaded??0;if(result.packetRolls?.[i])result.packetRolls[i]!.damage=loss.direct+loss.splash;}
  result.directDamage=direct;result.splashDamage=splash;result.overflowDamage=overflow;result.hpAfter=memberHealth(target);result.membersAfter=target.hp;
  if(shieldBefore)result.barrierAbsorbed=shieldBefore-barrierAmount(target);else delete result.barrierAbsorbed;
  if(energy)result.energyAbsorbed=energy;else delete result.energyAbsorbed;
  if(energy&&converted)result.energySpent=spent;else delete result.energySpent;
  if(overloaded)result.energyOverloaded=overloaded;else delete result.energyOverloaded;
  if (result.shieldWear) result.shieldBroken = applyShieldWear(target,result.shieldWear);
  recordAppliedDamage(result,result.hpBefore-result.hpAfter);return result.finalDamage;
}

/** 一段攻击中不含随机数的部分。 */
interface AttackBasis { ward: StackResult; context: ReturnType<typeof attackContext>; resolved: ResolvedWeapon; dmgMult: number; wardMult: number; atkDetail: string; penetration?: ReturnType<typeof penetrationContext>; sizes?: Map<string, { scale: ReturnType<typeof outcomeScale>; sourceScale: number }> }
interface PreviewMemo { bases: Map<string, AttackBasis>; samples?: number; penetration?: ReturnType<typeof penetrationContext>; loose?: boolean }
/** 抽样副本：伤损只改写生命基数、状态、成员分组、屏障、盾耐久、能量盾与士气记录；其余数据与原单位共享且只读。 */
function damageCopy(unit: Combatant): Combatant {
  // Copy once, then replace mutable branches; avoid repeatedly spreading the large unit object.
  const copy = { ...unit };
  copy.base = { ...unit.base };
  copy.conditions = unit.conditions.map((c) => ({ ...c }));
  if (unit.formation) {
    copy.formation = { ...unit.formation };
    if (unit.formation.health) copy.formation.health = unit.formation.health.map((g) => ({ ...g }));
  }
  if (unit.barrier) copy.barrier = cloneData(unit.barrier);
  if (unit.shieldDurability) copy.shieldDurability = { ...unit.shieldDurability };
  if (unit.energyShield) copy.energyShield = { ...unit.energyShield };
  if (unit.moraleState) copy.moraleState = cloneData(unit.moraleState);
  return copy;
}
/** 非火炮的结算武器与目标状态无关；其穿透只看守方装备、等级与状态，在整次预览中不变。 */
function basisPenetration(opts: AttackOpts, basis: AttackBasis): ReturnType<typeof penetrationContext> {
  const stable = !isArmsV2(opts.rules.armsModel) && opts.previewMemo && (opts.attacker.cannonAmmo || !isCannonWeapon(opts.weaponOverride ?? opts.attacker.weapon));
  return basis.penetration ??= stable ? opts.previewMemo!.penetration ??= penetrationContext(opts, basis.resolved) : penetrationContext(opts, basis.resolved);
}
function attackBasis(opts: AttackOpts): AttackBasis {
  // 结算只改守方的生命、成员分组、屏障、士气与伤兵；同一预览的攻方副本与其余输入固定。
  // 非火炮的命中与修正只经“疏散”(现员>1) 受这些改动影响；火炮弹种随目标状态而选，按完整状态复用。
  const memo = opts.previewMemo, d = opts.defender;
  // Ordinary weapons do not select their attack/penetration basis from individual
  // members' wound distribution. Keep headcount, shields and conditions; only cannon
  // ammunition selection needs the complete formation. Damage still uses live wounds.
  const key = !memo ? undefined : isArmsV2(opts.rules.armsModel) ? JSON.stringify([d.hp,d.status,d.shieldDurability,d.conditions,d.barrier,
    isCannonWeapon(opts.weaponOverride ?? opts.attacker.weapon) ? d.formation : undefined]) : opts.attacker.cannonAmmo || !isCannonWeapon(opts.weaponOverride ?? opts.attacker.weapon)
    ? (memo.loose ??= activeTraitIds(d).includes('loose-formation')) ? String(looseFormation(d)) : ''
    : JSON.stringify([d.hp, d.status, d.morale, d.moraleState, d.barrier, d.formation, d.recoverableWounded, d.conditions, d.base]);
  const known = key === undefined ? undefined : memo!.bases.get(key);
  if (known) return known;
  const context = attackContext(opts), stack = { sameNameKeepsHighest: opts.rules.sameNameKeepsHighest, maxFlat: opts.rules.maxFlat };
  const ward = resolveStack(context.defMods, 'ward', context.ctxDef, stack);
  const basis: AttackBasis = { ward, context, resolved: { weapon: context.weapon }, atkDetail: context.attackDetail,
    dmgMult: resolveStack(context.atkMods, 'dmg', context.ctxAtk, stack).multTotal, wardMult: ward.multTotal };
  if (key !== undefined) opts.previewMemo!.bases.set(key, basis);
  return basis;
}
/** Sampling consumes only hit-any and the mutated defender, without building packet reports. */
function sampledAttackHit(opts: AttackOpts & { previewMemo: PreviewMemo }): boolean {
  const samples = opts.packetShare !== undefined ? 1 : opts.previewMemo.samples ??= cohortSamples(opts);
  if (samples <= 1) return resolveAttackPacket(opts, true);
  const packet = { ...opts, packetShare: 1 / samples };
  let hit = false;
  for (let i = 0; i < samples && opts.defender.hp > 0; i++) {
    hit = resolveAttackPacket(packet, true) || hit;
  }
  return hit;
}
export function resolveAttack(opts: AttackOpts): AttackResolution {
  const samples=opts.packetShare!==undefined?1:opts.previewMemo?opts.previewMemo.samples??=cohortSamples(opts):cohortSamples(opts);
  if(samples>1){
    const health=()=>opts.rules.combatModel===MEMBER_HEALTH_MODEL?memberHealth(opts.defender):opts.defender.hp;
    const before=health(),membersBefore=opts.defender.hp,parts:AttackResolution[]=[];
    for(let i=0;i<samples&&opts.defender.hp>0;i++)parts.push(resolveAttack({...opts,packetShare:1/samples}));
    if(parts.length){
      const representative=parts.find(r=>r.hit)??parts.at(-1)!,result:AttackResolution={...representative,attackRoll:undefined,baseRoll:undefined,apRoll:undefined,hpBefore:before,hpAfter:health(),hit:parts.some(r=>r.hit),crit:parts.some(r=>r.crit),finalDamage:before-health(),
        ...(opts.rules.combatModel===MEMBER_HEALTH_MODEL?{membersBefore,membersAfter:opts.defender.hp,damagePlans:parts.flatMap(r=>r.damagePlans??[{direct:0,targets:0}]),directDamage:parts.reduce((n,r)=>n+(r.directDamage??0),0),splashDamage:parts.reduce((n,r)=>n+(r.splashDamage??0),0),overflowDamage:parts.reduce((n,r)=>n+(r.overflowDamage??0),0)}:{}),
        ...(parts.some(r=>r.shieldWear)?{shieldWear:parts.reduce((n,r)=>n+(r.shieldWear??0),0),shieldBroken:parts.some(r=>r.shieldBroken)}:{}),
        ...(parts.some(r=>r.barrierAbsorbed)?{barrierAbsorbed:parts.reduce((n,r)=>n+(r.barrierAbsorbed??0),0)}:{}),
        ...(parts.some(r=>r.energyAbsorbed)?{energyAbsorbed:parts.reduce((n,r)=>n+(r.energyAbsorbed??0),0)}:{}),...(parts.some(r=>r.energySpent!==undefined)?{energySpent:parts.reduce((n,r)=>n+(r.energySpent??r.energyAbsorbed??0),0)}:{}),...(parts.some(r=>r.energyOverloaded)?{energyOverloaded:parts.reduce((n,r)=>n+(r.energyOverloaded??0),0)}:{}),participants:opts.previewMemo?representative.participants:outcomeScale(opts).participants,packetCount:parts.length,packetHits:parts.filter(r=>r.hit).length,
        packetRolls:parts.map(r=>({hit:r.hit,crit:r.crit,damage:r.finalDamage,attack:r.attackRoll?.total,base:r.baseRoll?.total,ap:r.apRoll?.total})),
        onHitConditions:parts.find(r=>r.onHitConditions?.length)?.onHitConditions};
      if(!opts.previewMemo)result.text=formatResolution(result,opts.defender);return result;
    }
  }
  return resolveAttackPacket(opts, false);
}

function resolveAttackPacket(opts: AttackOpts, sampleOnly: true): boolean;
function resolveAttackPacket(opts: AttackOpts, sampleOnly: false): AttackResolution;
/** 实战和抽样共用命中、伤损与随机数顺序；抽样在报告构建前直接提交伤损。 */
function resolveAttackPacket(opts: AttackOpts, sampleOnly: boolean): AttackResolution | boolean {
  const { attacker, defender, rng, rules } = opts;
  const shieldBefore = barrierAmount(defender);
  const basis = attackBasis(opts), { ranged, weapon, netAtk, targetDef } = basis.context;
  // 守方在本段末尾才受损：此前的穿透、展开与成员伤损方案共用同一结算武器。
  const resolved = basis.resolved;

  // ---- 命中判定 ----
  let hit = false;
  let crit = false;
  let attackRoll: DiceRollDetail | undefined;
  let hitChance: number | undefined;

  const critInfo=criticalInfo(opts,weapon);
  if (opts.autoHit) hit = true;
  else if (rules.hitMode === 'd20') {
    let nat: number;
    if (sampleOnly) {
      nat = rng.d(20);
      if (opts.advantage === 'adv') nat = Math.max(nat, rng.d(20));
      else if (opts.advantage === 'dis') nat = Math.min(nat, rng.d(20));
    } else {
      const expr = opts.advantage === 'adv' ? '2d20kh1' : opts.advantage === 'dis' ? '2d20kl1' : '1d20';
      attackRoll = rollDice(expr, rng);
      nat = Math.max(...attackRoll.kept);
    }
    if (nat <= 1) {
      hit = false;
    } else if (nat >= critInfo.minimum) {
      hit = true;
      crit = true;
    } else {
      const weight = d20HitWeight({...rules,critMin:critInfo.minimum}, nat, netAtk, targetDef);
      hit = weight >= 1 || weight > 0 && rng.next() < weight;
    }
  } else {
    const diff = netAtk - (targetDef - rules.tw.defOffset);
    hitChance = Math.max(rules.tw.min, Math.min(rules.tw.max, rules.tw.base + diff * rules.tw.perDiff));
    hit = rng.next() < hitChance;
    crit = false;
  }

  if (hit && critInfo.forced && !opts.autoHit) crit = true;
  const res: AttackResolution | undefined = sampleOnly ? undefined : {
    attackerId: attacker.id,
    defenderId: defender.id,
    attackerName: attacker.name,
    defenderName: defender.name, defenderScale: defender.scale,
    hit,
    crit,
    attackRoll,
    hitChance,
    netAtk,
    targetDef,
    atkDetail: basis.atkDetail,
    drPercent: 0,
    baseAfterDR: 0,
    apTotal: 0,
    dmgMult: 1,
    wardMult: 1,
    finalDamage: 0,
    hpBefore: rules.combatModel===MEMBER_HEALTH_MODEL?memberHealth(defender):defender.hp,
    hpAfter: rules.combatModel===MEMBER_HEALTH_MODEL?memberHealth(defender):defender.hp,
    ...(rules.combatModel===MEMBER_HEALTH_MODEL?{damageModel:'member-health' as const,membersBefore:defender.hp,membersAfter:defender.hp}:{}),
    defenderStatus: defender.status,
    text: '',
    ...(rules.combatModel===MEMBER_HEALTH_MODEL&&isCannonWeapon(weapon)?{ammunition:weapon?.ammunition}:{}),
  };

  if (!hit) {
    if (!res) return false;
    if (!opts.previewMemo) res.text = formatResolution(res, defender);
    return res;
  }

  // ---- 伤害分段 ----
  const src = opts.abilityDamage ?? ((): { baseDice: string; apDice?: string } => {
    if (!weapon) throw new Error(`${attacker.name} 没有武器，无法攻击`);
    return { baseDice: weapon.baseDice, apDice: weapon.apDice };
  })();

  const times = crit && rules.critRule === 'doubleDice' ? 2 : 1;
  const baseRoll = sampleOnly ? undefined : rollDicePortion(src.baseDice, rng, times);
  const baseTotal = baseRoll?.total ?? rollDicePortionTotal(src.baseDice, rng, times);
  const apRoll = !sampleOnly && src.apDice ? rollDicePortion(src.apDice, rng, times) : undefined;
  const apRolledTotal = apRoll?.total ?? (src.apDice ? rollDicePortionTotal(src.apDice, rng, times) : 0);

  // 破甲占比特质：将普通段的一部分移入破甲段（无视 DR）；rangedOnly 仅射击生效
  const v2 = rules.resolutionVersion === 'v2';
  const penetration = v2 ? basisPenetration(opts, basis) : undefined;
  const apSharePct = v2 ? 0 : apShareOf(attacker, opts.ranged ?? false, opts.traitRegistry);
  let baseRaw = baseTotal;
  let apMoved = 0;
  if (apSharePct > 0) {
    apMoved = Math.round((baseRaw * apSharePct) / 100);
    baseRaw -= apMoved;
  }

  // 护甲减伤只作用于普通段（等级差压制叠加在表值+品质乘数之上，总封顶 90%）
  const dr = v2 ? 1 - penetration!.factor : Math.min(0.9, armorDR(defender, rules, opts.traitRegistry) + qualityGapDR(attacker, defender, opts.weaponOverride));
  const baseAfterDR = v2 ? v2DamageAmount(baseRaw, 0, penetration!.factor, 1) : Math.floor(baseRaw * (1 - dr));
  const apTotal = v2 ? v2DamageAmount(0, apRolledTotal, penetration!.factor, 1) : apRolledTotal + apMoved;

  // 攻击方伤害倍率（践踏等）与防御方守护减免
  const { dmgMult, wardMult } = basis;

  // 展开规模与伤害系数另按分段份额与现员复用（范围技能暴露人数随现员变化）。
  const modern=rules.combatModel===MEMBER_HEALTH_MODEL, sizeKey=opts.previewMemo&&modern?opts.packetShare+'|'+defender.hp:undefined;
  const size=(sizeKey===undefined?undefined:basis.sizes?.get(sizeKey))??{scale:outcomeScale(opts, resolved),sourceScale:modern?memberAreaBudget(opts)*(opts.abilityDamage?opts.abilityDamage.damageScale??1:weapon?.damageScale??1)/(penetration?.armorScale??1)*trainingDamage(attacker.level,rules)*unitMultiplier(attacker,'damage',penetration?.channel??'kinetic',combatBonuses(attacker))*wornDamageMultiplier(attacker,penetration?.channel??'kinetic')*(penetration?.overmatchMultiplier??1):1};
  if (sizeKey!==undefined) (basis.sizes??=new Map()).set(sizeKey,size);
  const { scale, sourceScale } = size;
  const targets=modern?roundDamage(scale.multiplier,rng):0;
  let final = Math.round((baseAfterDR + apTotal) * dmgMult * wardMult * scale.multiplier);
  if (v2) final = roundDamage(v2DamageAmount(baseRaw, apRolledTotal, penetration!.factor, dmgMult * wardMult * (modern?targets*sourceScale:scale.multiplier)), rng);
  if (final < 1) final = v2 ? 0 : 1;
  const wear = isArmsV2(rules.armsModel) && !penetration?.area && penetration?.canBlock !== false && (!opts.abilityDamage || opts.abilityDamage.weaponBased)
    ? shieldCoverage({...defender,armsModel:rules.armsModel},weapon) * (baseRaw + apRolledTotal) * (opts.abilityDamage?.damageScale ?? weapon?.damageScale ?? 1) * trainingDamage(attacker.level,rules) * unitMultiplier(attacker,'damage',weapon?.channel,combatBonuses(attacker)) * dmgMult * targets * (weapon?.recipe?.mechanism === 'axe' ? 2 : 1) : 0;
  if (res && wear) res.shieldWear = wear;
  if (!res) {
    if (modern) applyDamagePlan(defender, memberPlan(opts, final, targets, resolved, penetration, basis.ward));
    else applyHealthLoss(defender, final, v2);
    if (wear) applyShieldWear(defender,wear);
    return true;
  }
  if (v2) res.participants = scale.participants;
  if (penetration) {
    res.channel = penetration.channel; res.penetration = penetration.penetration;
    res.resistance = penetration.resistance; res.penetrationFactor = penetration.factor;
    if(modern){res.armorScale=penetration.armorScale;res.armorFactor=penetration.armorFactor;res.shieldFactor=penetration.shieldFactor;}
    if(rules.overmatch){res.overmatchMultiplier=penetration.overmatchMultiplier;res.attackPower=penetration.attackPower;res.protectionPower=penetration.protectionPower;}
  }

  res.baseRoll = { ...baseRoll!, total: baseRaw };
  res.apRoll = apRoll;
  res.drPercent = dr * 100;
  res.baseAfterDR = baseAfterDR;
  res.apTotal = apTotal;
  res.dmgMult = dmgMult*sourceScale;
  res.wardMult = wardMult;
  res.finalDamage = final;
  const stood = defender.moraleState?.indomitable;
  if(modern){res.damagePlans=[memberPlan(opts,final,targets,resolved,penetration,basis.ward)];applyResolutionDamage(defender,res);}
  else {const actualLoss = applyHealthLoss(defender, final, v2);if (rules.combatModel===COHORT_MODEL || shieldBefore) res.finalDamage = actualLoss;res.hpAfter = defender.hp;if(shieldBefore){res.unshieldedDamage=final;res.barrierAbsorbed=shieldBefore-barrierAmount(defender);}}
  if (v2 && !opts.previewMemo && !opts.autoHit && (!opts.abilityDamage || opts.abilityDamage.weaponBased)) { const conditions = weaponConditions(attacker, defender, weapon, res.finalDamage, opts.traitRegistry); if (conditions.length) res.onHitConditions = conditions; }
  if (isArmsV2(rules.armsModel) && !opts.autoHit && penetration && (!opts.abilityDamage || opts.abilityDamage.weaponBased) && weapon?.recipe?.mechanism === 'sprayer') res.spray = weapon.recipe.power;

  if (!opts.previewMemo) res.text = formatResolution(res, defender) + (!stood && defender.moraleState?.indomitable ? INDOMITABLE_NOTE(defender) : '');
  return res;
}
const INDOMITABLE_NOTE = (unit: Combatant) => `｜${unit.name} 不屈，以1点生命坚持`;

function apShareOf(unit: Combatant, ranged: boolean, registry?: Map<string, import('./types.js').Trait>): number {
  let pct = 0;
  for (const id of unit.traits) {
    const t = registry?.get(id);
    if (!t) continue;
    for (const e of t.effects) {
      if (e.kind !== 'apShare') continue;
      if (e.rangedOnly && !ranged) continue;
      pct = Math.max(pct, e.percent);
    }
  }
  return Math.min(100, pct);
}

/** 生成可读结算行（结算卡与审计共用同一文本源） */
/** 能量盾数值：最多两位小数；V21 换算后沿用一位小数。 */
const shieldAmount=(x:number,defender:Combatant)=>isArmsV3(defender.armsModel)?String(Number(x.toFixed(1))):displayNumber(x);
export function formatResolution(r: AttackResolution, defender: Combatant): string {
  if(r.damageModel==='member-health')return `${r.attackerName} → ${r.defenderName}：${r.ammunition?r.ammunition==='he'?'榴弹·':'穿甲弹·':''}${r.hit?(r.crit?'暴击':'命中'):'未中'}${r.packetCount?`（${r.packetHits}/${r.packetCount}组命中）`:''}，生命损失${displayNumber(r.finalDamage)}（${displayNumber(r.hpBefore)}→${displayNumber(r.hpAfter)}）${(r.overmatchMultiplier??1)>1?'，跨代毁伤×'+Number(r.overmatchMultiplier!.toFixed(2)):''}${r.energyAbsorbed?`，能量盾吸收${shieldAmount(r.energyAbsorbed,defender)}${r.energySpent!==undefined?`（耗盾${shieldAmount(r.energySpent,defender)}）`:''}`:''}${r.energyOverloaded?defender.scale==='hero'?'，能量盾过载':`，${r.energyOverloaded}人能量盾过载`:''}${r.barrierAbsorbed?`，屏障吸收${displayNumber(r.barrierAbsorbed)}`:''}${defender.scale!=='hero'?`，减员${displayNumber((r.membersBefore??defender.hp)-(r.membersAfter??defender.hp))}${defender.body==='vehicle'?'辆':'人'}`:''}${r.overflowDamage?`，其中溢出${displayNumber(r.overflowDamage)}`:''}${r.splashDamage?`，其中爆炸${displayNumber(r.splashDamage)}`:''}${r.penetrationFactor===0?'；未穿透':''}${r.shieldBroken?'，'+(defender.shield?.name??'盾牌')+'碎了':''}`;
  if(r.packetCount)return `${r.attackerName} → ${r.defenderName}：聚合${r.packetCount}组/${r.packetHits}组命中${r.crit?'（含暴击）':''}，损失${displayNumber(r.finalDamage)}${defender.scale==='hero'?'生命':'人'}（${displayNumber(r.hpBefore)}→${displayNumber(r.hpAfter)}）${r.penetrationFactor===0?'；未穿透':''}`;
  const parts: string[] = [];
  const head = `${r.attackerName} → ${r.defenderName}`;
  if (!r.hit) {
    parts.push(`${head}：${r.attackRoll ? `d20[${r.attackRoll.kept.join(',')}]` : ''}+${displayNumber(r.netAtk)} vs 防御${displayNumber(r.targetDef)} ✗未命中`);
    return parts.join('\n');
  }
  const rollPart = r.attackRoll
    ? `d20[${r.attackRoll.kept.join(',')}]${r.crit ? ' 暴击!' : ''}+${displayNumber(r.netAtk)}=${displayNumber(r.attackRoll.total + r.netAtk)} vs 防御${displayNumber(r.targetDef)}`
    : `命中率${(r.hitChance! * 100).toFixed(0)}% 命中`;
  parts.push(`${head}：${rollPart} ✦命中`);
  if (r.penetrationFactor !== undefined) parts.push(`${r.channel} 穿透${displayNumber(r.penetration)} vs 防护${displayNumber(r.resistance)} → ${r.penetrationFactor === 0 ? '未穿透，零生命伤害' : Math.round(r.penetrationFactor * 100) + '%通过'}`);
  if (r.onHitConditions?.some((c) => c.id === 'poisoned')) parts.push('造成损伤后附带中毒，已中毒者不叠层或续期');
  const dmgBits: string[] = [];
  if (r.baseRoll) dmgBits.push(`普通${r.baseRoll.rolls.join('+')}${r.baseRoll.flat ? `+${displayNumber(r.baseRoll.flat)}` : ''}${r.drPercent > 0 ? `(减伤${displayNumber(r.drPercent)}%后${displayNumber(r.baseAfterDR)})` : `(${displayNumber(r.baseAfterDR)})`}`);
  if (r.apRoll || r.apTotal > 0) dmgBits.push(`破甲${displayNumber(r.apTotal)}`);
  if (r.dmgMult !== 1) dmgBits.push(`×${displayNumber(r.dmgMult)}`);
  if (r.wardMult !== 1) dmgBits.push(`守护×${displayNumber(r.wardMult)}`);
  parts.push(`伤害 ${dmgBits.join(' ')} = ${displayNumber(r.finalDamage)} → ${defender.name} HP ${displayNumber(r.hpBefore)}→${displayNumber(r.hpAfter)}`);
  if (defender.hp <= 0) parts.push(`${defender.name} 倒下`);
  return parts.join('\n');
}

function cohortSamples(opts: Omit<AttackOpts,'rng'>, resolved?: ResolvedWeapon): number {
  if(opts.rules.combatModel===MEMBER_HEALTH_MODEL&&opts.attacker.scale!=='hero')return Math.min(8,Math.max(1,Math.ceil(outcomeScale({...opts,packetShare:undefined},resolved).participants)));
  return opts.rules.combatModel===COHORT_MODEL&&opts.attacker.scale!=='hero'&&opts.defender.scale!=='hero'?Math.min(8,Math.max(1,Math.ceil(personnel(opts.attacker)/COHORT_REFERENCE))):1;
}

export type { StackResult };
