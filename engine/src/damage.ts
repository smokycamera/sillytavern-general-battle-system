import { bonusMultiplier, bonusSteps, trainingEdge, trainingDamage } from './enhancements.js';
import { weaponConditions, poisonHint, poisonValue } from './afflictions.js';
import { looseFormation } from './tactics.js';
import { effectiveProtection } from './body.js';
import { applyHealthLoss, applyDamagePlan, type MemberDamagePlan } from './recovery.js';
import { MEMBER_HEALTH_MODEL, hasMemberHealth, memberHealth, damageMemberGroups } from './member-health.js';
import { combatWeapon, anchoredProtection,penetrationThrough,armorPowerScale } from './power-anchors.js';
import { meleeProfile } from './melee.js';
import { meleeWeapon } from './loadout.js';
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
import type { Rng } from './rng.js';
import { rollDice, rollDicePortion, type DiceRollDetail } from './dice.js';
import { collectMods, resolveStack, describeStack, hasFlag, type Modifier, type StackResult } from './bonus.js';
import { averageDice, estimateHitChance } from './actions.js';
import { damageMoments, diceDistribution, v2DamageAmount, roundDamage } from './probability.js';
import { engagementWidth } from './exposure.js';
import { traitPenetrationBonus } from './trait-sources.js';
import { COHORT_MODEL, COHORT_REFERENCE, personnel, memberDurability } from './combat-model.js';

export interface AttackResolution {
  armorScale?:number;
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
  packetShare?: number;
  fieldTags?: string[];
  attackerTerrain?: string;
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
  abilityDamage?: { accuracy?: number; damageScale?:number; areaExposure?: number; delivery?: 'melee' | 'ranged' | 'magic'; weaponBased?: boolean; shape?: 'single' | 'burst'; baseDice: string; apDice?: string; channel?: import('./types.js').DamageChannel; penetration?: number };
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

/** 阶梯穿透系数；与骰子和人数分离。同级55%，每差1档降一档，差2档仍有12%保底（甲有缝隙），≥3档差才无生命伤害。 */
export function penetrationFactor(power: number, resistance: number): number {
  return penetrationThrough(power,resistance);
}
export function penetrationContext(opts: Pick<AttackOpts, 'attacker' | 'defender' | 'weaponOverride' | 'abilityDamage' | 'ranged'> & Partial<Pick<AttackOpts,'rules'>>) {
  const modern=opts.rules?.combatModel===MEMBER_HEALTH_MODEL;
  const original=opts.weaponOverride ?? opts.attacker.weapon,weapon=modern?combatWeapon(original,opts.attacker,opts.defender,opts.rules?.weaponOverflow):original;
  const channel = opts.abilityDamage?.channel ?? weapon?.channel ?? 'kinetic';
  const base = opts.abilityDamage?.penetration ?? weapon?.penetration ?? 1 + Math.floor((weapon?.level ?? 5) / 2);
  const penetration = base + (opts.abilityDamage && !opts.abilityDamage.weaponBased ? 0 : traitPenetrationBonus(opts.attacker, weapon, opts.ranged ?? !!weapon?.tags?.includes('ranged'), base));
  const resistance = modern?anchoredProtection(opts.defender,channel):effectiveProtection(opts.defender, channel);
  return { channel, penetration, resistance, factor: penetrationFactor(penetration, resistance),armorScale:modern?armorPowerScale(opts.defender):1 };
}

/** 与执行共用属性栈与穿透。期望值不读取实战 RNG；骰子取整/暴击导致实际结果有波动。 */
export function previewAttack(opts: Omit<AttackOpts, 'rng'>): import('./actions.js').ActionPreview & { hitChance: number; expectedDamage: number; conditionValue?: number } {
  const ctx = attackContext(opts);
  const hitChance = estimateHitChance(opts.rules, ctx.netAtk, ctx.targetDef);
  const source = opts.abilityDamage ?? ctx.weapon;
  const onHit = opts.rules.resolutionVersion === 'v2' && (!opts.abilityDamage || opts.abilityDamage.weaponBased) ? poisonHint(opts.attacker, opts.defender, ctx.weapon) : undefined;
  const dmg = resolveStack(ctx.atkMods, 'dmg', ctx.ctxAtk, { sameNameKeepsHighest: opts.rules.sameNameKeepsHighest, maxFlat: opts.rules.maxFlat });
  const ward = resolveStack(ctx.defMods, 'ward', ctx.ctxDef, { sameNameKeepsHighest: opts.rules.sameNameKeepsHighest, maxFlat: opts.rules.maxFlat });
  const protection = opts.rules.resolutionVersion === 'v2' ? penetrationContext(opts) : undefined;
  const factor = protection?.factor;
  const diagnostics = { ...(opts.rules.combatModel ? {participants:outcomeScale(opts).participants,memberHp:opts.defender.scale!=='hero'?memberDurability(opts.defender):undefined,aggregationSamples:cohortSamples(opts)} : {}), ...(protection ? { channel: protection.channel, penetration: protection.penetration, resistance: protection.resistance,armorScale:protection.armorScale } : {}),
    weaponName: !opts.abilityDamage || opts.abilityDamage.weaponBased ? ctx.weapon?.name : undefined,
    attackScore: ctx.netAtk, defenseScore: ctx.targetDef, attackModifiers: describeStack(ctx.atkStack), defenseModifiers: describeStack(ctx.defStack) };
  const dr = factor === undefined ? Math.min(0.9, armorDR(opts.defender, opts.rules, opts.traitRegistry) + qualityGapDR(opts.attacker, opts.defender, ctx.weapon)) : 1 - factor;
  const total = averageDice(source?.baseDice) * (1 - dr) + averageDice(source?.apDice) * (factor ?? 1);
  const scale = outcomeScale(opts);
  if(opts.rules.combatModel===MEMBER_HEALTH_MODEL)return previewMemberAttack(opts,ctx,source,dmg.multTotal*ward.multTotal/(protection?.armorScale??1),factor??1,diagnostics);
  if (factor !== undefined) {
    let hit = hitChance, critical = 0;
    if (opts.rules.hitMode === 'd20') {
      hit = 0;
      for (let n = 1; n <= 20; n++) {
        const p = opts.advantage === 'adv' ? (2 * n - 1) / 400 : opts.advantage === 'dis' ? (41 - 2 * n) / 400 : 1 / 20;
        if (n > 1 && (n >= opts.rules.critMin || n + ctx.netAtk >= ctx.targetDef)) hit += p;
        if (n > 1 && n >= opts.rules.critMin) critical += p;
      }
    }
    const samples=cohortSamples(opts);
    const multiplier = dmg.multTotal * ward.multTotal * scale.multiplier / samples;
    const normal = damageMoments(source?.baseDice, source?.apDice, 1, factor, multiplier);
    const crit = damageMoments(source?.baseDice, source?.apDice, opts.rules.critRule === 'doubleDice' ? 2 : 1, factor, multiplier);
    if (normal && crit) {
      const count = (opts.abilityDamage ? 1 : ctx.weapon?.attacks ?? 1) * samples;
      const mean = (hit - critical) * normal.mean + critical * crit.mean;
      const second = (hit - critical) * normal.second + critical * crit.second;
      const damageChance = 1 - Math.pow(1 - ((hit - critical) * normal.positive + critical * crit.positive), count);
      return { ...diagnostics, ...(opts.abilityDamage?.weaponBased ? { weaponName: ctx.weapon?.name } : {}), ...(onHit ? { onHit, conditionValue: poisonValue(opts.attacker, opts.defender, ctx.weapon, damageChance) } : {}), hitChance: hit, anyHitChance: 1-Math.pow(1-hit,count), damageChance, expectedDamage: mean * count, penetrationFactor: factor, exact: cohortSamples(opts) === 1,
        variance: Math.max(0, second - mean * mean) * count, minDamage: hit < 1 ? 0 : normal.min * count, maxDamage: Math.max(normal.max, critical > 0 ? crit.max : 0) * count };
    }
  }
  return { ...diagnostics, ...(onHit ? { onHit, conditionValue: poisonValue(opts.attacker, opts.defender, ctx.weapon, total > 0 ? hitChance : 0) } : {}), hitChance, expectedDamage: total * dmg.multTotal * ward.multTotal * hitChance * (opts.abilityDamage ? 1 : ctx.weapon?.attacks ?? 1) * scale.multiplier, penetrationFactor: factor };
}

function memberPlan(opts:Omit<AttackOpts,'rng'>,direct:number,targets:number):MemberDamagePlan {
  const weapon=combatWeapon(opts.weaponOverride??opts.attacker.weapon,opts.attacker,opts.defender,opts.rules.weaponOverflow);
  const extra=hasMemberHealth(opts.defender)&&(!opts.abilityDamage||opts.abilityDamage.weaponBased)?Math.min(opts.defender.hp,weapon?.splashTargets??0):0;
  const members=hasMemberHealth(opts.defender),directTargets=members?Math.min(opts.defender.hp,targets):targets>0?1:0,splashTargets=Math.min(opts.defender.hp,targets*extra),max=members?opts.defender.formation!.memberHp:opts.defender.base.hpMax;
  const overflow=members&&!!opts.rules.weaponOverflow&&(!opts.abilityDamage||!!opts.abilityDamage.weaponBased);
  return {direct:overflow&&directTargets>0?direct:Math.min(direct,max*directTargets),targets:directTargets,...(overflow?{overflow:true}:{}),
    ...(extra&&targets?{splash:Math.min(max*splashTargets,Math.round(direct*extra*(weapon?.splashFactor??0))),splashTargets}:{})};
}
function previewMemberPlan(unit:Combatant,plan:MemberDamagePlan):{damage:number;casualties:number} {
  if(!hasMemberHealth(unit))return {damage:Math.min(unit.hp,plan.direct),casualties:0};
  const copy={...unit,formation:{...unit.formation!,health:unit.formation!.health!.map(g=>({...g}))}};
  const direct=damageMemberGroups(copy,plan.direct,plan.targets,plan.overflow);
  const splash=plan.splash&&plan.splashTargets?damageMemberGroups(copy,plan.splash,plan.splashTargets):{health:0,casualties:0};
  return {damage:direct.health+splash.health,casualties:direct.casualties+splash.casualties};
}
const memberPreviewCache=new Map<string,{mean:number;second:number;positive:number;casualties:number;max:number}>();
/** 有界骰分布×成员伤损组；不触碰实战对象或随机源。多组攻击的目标耗尽仅作上限裁剪。 */
function previewMemberAttack(opts:Omit<AttackOpts,'rng'>,ctx:ReturnType<typeof attackContext>,source:AttackOpts['abilityDamage']|Weapon|undefined,modifier:number,factor:number,diagnostics:Record<string,unknown>) {
  let hit=estimateHitChance(opts.rules,ctx.netAtk,ctx.targetDef),critical=0;
  if(opts.rules.hitMode==='d20'){
    hit=0;for(let n=1;n<=20;n++){const p=opts.advantage==='adv'?(2*n-1)/400:opts.advantage==='dis'?(41-2*n)/400:1/20;if(n>1&&(n>=opts.rules.critMin||n+ctx.netAtk>=ctx.targetDef))hit+=p;if(n>=opts.rules.critMin)critical+=p;}
  }
  const samples=cohortSamples(opts),weight=outcomeScale({...opts,packetShare:1/samples}).multiplier,count=(opts.abilityDamage?1:ctx.weapon?.attacks??1)*samples;
  const rawMultiplier=modifier*factor*(source?.damageScale??1)*trainingDamage(opts.attacker.level)*bonusMultiplier(opts.attacker.bonuses,'damage');
  const moments=(times:number)=>{
    const key=JSON.stringify([source?.baseDice,source?.apDice,rawMultiplier,times,weight,opts.defender.hp,opts.defender.formation,ctx.weapon?.splashTargets,ctx.weapon?.splashFactor,opts.abilityDamage?.weaponBased,!!opts.abilityDamage,opts.rules.weaponOverflow]);
    const cached=memberPreviewCache.get(key);if(cached)return cached;
    const base=diceDistribution(source?.baseDice,times),ap=diceDistribution(source?.apDice,times);
    const result={mean:0,second:0,positive:0,casualties:0,max:0};
    if(!base||!ap)return result;
    const low=Math.floor(weight),fraction=weight-low,targets=[[low,1-fraction],[low+1,fraction]];
    for(const [b,bp] of base)for(const [a,apb] of ap)for(const [n,np] of targets){
      if(!np)continue;const raw=(b+a)*rawMultiplier*n!,floor=Math.floor(raw),frac=raw-floor;
      for(const [amount,p] of [[floor,1-frac],[floor+1,frac]]){
        if(!p)continue;const event=previewMemberPlan(opts.defender,memberPlan(opts,amount!,n!)),prob=bp*apb*np!*p!;
        result.mean+=event.damage*prob;result.second+=event.damage**2*prob;result.positive+=Number(event.damage>0)*prob;result.casualties+=event.casualties*prob;result.max=Math.max(result.max,event.damage);
      }
    }
    if(memberPreviewCache.size>1024)memberPreviewCache.clear();memberPreviewCache.set(key,result);return result;
  };
  const normal=moments(1),crit=moments(opts.rules.critRule==='doubleDice'?2:1),mean=(hit-critical)*normal.mean+critical*crit.mean,second=(hit-critical)*normal.second+critical*crit.second;
  return {...diagnostics,damageModel:'member-health' as const,weaponOverflow:hasMemberHealth(opts.defender)&&!!opts.rules.weaponOverflow&&(!opts.abilityDamage||!!opts.abilityDamage.weaponBased),hitChance:hit,anyHitChance:1-(1-hit)**count,expectedDamage:Math.min(memberHealth(opts.defender),mean*count),
    expectedCasualties:hasMemberHealth(opts.defender)?Math.min(opts.defender.hp,((hit-critical)*normal.casualties+critical*crit.casualties)*count):undefined,
    damageChance:1-(1-((hit-critical)*normal.positive+critical*crit.positive))**count,penetrationFactor:factor,exact:count===1,variance:Math.max(0,second-mean*mean)*count,minDamage:0,maxDamage:Math.min(memberHealth(opts.defender),Math.max(normal.max,critical?crit.max:0)*count)};
}

/** V3按人数展开并以成员耐久折算减员；V2保留固定展开与10点换算。 */
function outcomeScale(opts: Omit<AttackOpts, 'rng'>): { participants: number; multiplier: number } {
  if (opts.rules.resolutionVersion !== 'v2') return { participants: 1, multiplier: 1 };
  if(opts.rules.combatModel===MEMBER_HEALTH_MODEL){
    const a=opts.attacker,d=opts.defender,ranged=opts.ranged??isRangedCapable(a),weapon=combatWeapon(opts.weaponOverride??a.weapon,a,d,opts.rules.weaponOverflow);
    const count=a.scale==='hero'?1:a.body==='vehicle'?personnel(a):Math.min(personnel(a),opts.participants??engagementWidth(a,d,ranged,undefined,opts.fieldTags)*Math.max(1,personnel(a)/COHORT_REFERENCE));
    const crew=a.scale!=='hero'&&(a.body??'human')==='human'&&!opts.abilityDamage?.delivery?.startsWith('magic')?(weapon?.recipe?.mechanism==='cannon'?4:weapon?.recipe?.mechanism==='autocannon'?3:1):1;
    const participants=Math.max(0,count/crew)*(!ranged&&looseFormation(a)?0.5:1);
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
  // 结算用武器：副武器近战切换时覆盖（骰子/等级/惩罚判定同源）
  const original=opts.weaponOverride ?? attacker.weapon;
  const weapon = rules.combatModel===MEMBER_HEALTH_MODEL?combatWeapon(original,attacker,defender,rules.weaponOverflow):original;

  // 远程武器被迫近战（借机攻击/贴身挥击/军团近战阶段）：枪托弓杆终究不是称手兵器
  // 「远近双全」（no-melee-penalty 旗标）豁免——刺刀/弓杆近战有专门训练；
  // 换用近战副武器结算时武器本身不带 ranged 标签，天然免罚
  const extraMods = [...(opts.extraMods ?? [])];
  if (rules.combatModel === MEMBER_HEALTH_MODEL && !ranged && (!opts.abilityDamage || opts.abilityDamage.weaponBased)) {
    const melee = meleeProfile(weapon);
    if (melee?.accuracy) extraMods.push({ source: 'intrinsic', name: '近战武器操控', kind: 'atk', type: 'flat', value: melee.accuracy });
    if (melee?.closePenalty && opts.distance !== undefined && opts.distance <= 1) {
      extraMods.push({ source: 'intrinsic', name: '长柄贴身受限', kind: 'atk', type: 'flat', value: melee.closePenalty });
    }
  }
  // 实际投送距离共用于预览、普通攻击、警戒与武器技能；独立法术不借用武器修正。
  if (rules.resolutionVersion === 'v2' && ranged && (!opts.abilityDamage || opts.abilityDamage.weaponBased)
    && weapon?.tags?.includes('blast') && (opts.distance ?? 0) >= 2) {
    extraMods.push({ source: 'stance', name: '爆破远距投送', kind: 'atk', type: 'flat', value: -2 });
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
  const ctxAtk = { skillDelivery: opts.abilityDamage?.delivery, attacker, defender, charge: opts.charge, ranged, weapon, fieldTags: opts.fieldTags, terrain: opts.attackerTerrain, opponentTerrain: opts.defenderTerrain, distance: opts.distance };
  const atkMods = collectMods(attacker, ctxAtk, opts.conditionDefs, extraMods, opts.traitRegistry);
  const atkStack = resolveStack(atkMods, 'atk', ctxAtk, { sameNameKeepsHighest: rules.sameNameKeepsHighest, maxFlat: rules.maxFlat });

  // 防御方视角：其条件修正（如「仅对大型目标生效」）看攻击方标签
  const ctxDef = { area: opts.abilityDamage?.shape === 'burst' || ((!opts.abilityDamage || opts.abilityDamage.weaponBased) && !!weapon?.tags?.includes('blast')), attacker: defender, defender: attacker, charge: opts.charge, ranged, weapon: defender.weapon, fieldTags: opts.fieldTags, terrain: opts.defenderTerrain, opponentTerrain: opts.attackerTerrain, distance: opts.distance, engaged: opts.defenderEngaged };
  const defenderMods = [...(opts.defenderMods ?? [])];
  if (rules.combatModel === MEMBER_HEALTH_MODEL && !ranged && (!opts.abilityDamage || opts.abilityDamage.weaponBased)
    && defender.status === 'ready' && !defender.conditions.some(c => c.dur > 0 && (opts.conditionDefs.get(c.id)?.preventAttack || opts.conditionDefs.get(c.id)?.skipTurn))) {
    const parry = meleeProfile(meleeWeapon(defender))?.parry;
    if (parry) defenderMods.push({ source: 'intrinsic', name: '剑术格挡', kind: 'def', type: 'flat', value: parry });
  }
  const defMods = collectMods(defender, ctxDef, opts.conditionDefs, defenderMods, opts.traitRegistry);
  const defStack = resolveStack(defMods, 'def', ctxDef, { sameNameKeepsHighest: rules.sameNameKeepsHighest, maxFlat: rules.maxFlat });

  const modern = rules.combatModel === MEMBER_HEALTH_MODEL;
  const precision = modern ? trainingEdge(attacker.level) + bonusSteps(attacker.bonuses,'accuracy') + (opts.abilityDamage?.accuracy??0) + (!opts.abilityDamage || opts.abilityDamage.weaponBased ? bonusSteps(weapon?.recipe?.bonuses,'accuracy') : 0) : 0;
  const evasion = modern ? trainingEdge(defender.level) + bonusSteps(defender.bonuses,'defense') + bonusSteps(defender.armor?.recipe?.bonuses,'defense') + bonusSteps(defender.shield?.recipe?.bonuses,'defense') : 0;
  const netAtk = attacker.base.atk + atkStack.flatTotal + precision;
  const targetDef = defender.base.def + defStack.flatTotal + evasion;

  return { ranged, weapon, atkMods, defMods, ctxAtk, ctxDef, atkStack, defStack, netAtk, targetDef };
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
  if(result.damageModel!=='member-health'){
    result.hpBefore=target.hp;const loss=applyHealthLoss(target,result.finalDamage);result.hpAfter=target.hp;return loss;
  }
  result.hpBefore=memberHealth(target);result.membersBefore=target.hp;
  let direct=0,splash=0,overflow=0;
  for(const [i,plan] of (result.damagePlans??[]).entries()){const loss=applyDamagePlan(target,plan);direct+=loss.direct;splash+=loss.splash;overflow+=loss.overflow;if(result.packetRolls?.[i])result.packetRolls[i]!.damage=loss.direct+loss.splash;}
  result.directDamage=direct;result.splashDamage=splash;result.overflowDamage=overflow;result.hpAfter=memberHealth(target);result.membersAfter=target.hp;
  recordAppliedDamage(result,result.hpBefore-result.hpAfter);return result.finalDamage;
}

export function resolveAttack(opts: AttackOpts): AttackResolution {
  const samples=cohortSamples(opts);
  if(samples>1 && opts.packetShare===undefined){
    const health=()=>opts.rules.combatModel===MEMBER_HEALTH_MODEL?memberHealth(opts.defender):opts.defender.hp;
    const before=health(),membersBefore=opts.defender.hp,parts:AttackResolution[]=[];
    for(let i=0;i<samples&&opts.defender.hp>0;i++)parts.push(resolveAttack({...opts,packetShare:1/samples}));
    if(parts.length){
      const representative=parts.find(r=>r.hit)??parts.at(-1)!,result:AttackResolution={...representative,attackRoll:undefined,baseRoll:undefined,apRoll:undefined,hpBefore:before,hpAfter:health(),hit:parts.some(r=>r.hit),crit:parts.some(r=>r.crit),finalDamage:before-health(),
        ...(opts.rules.combatModel===MEMBER_HEALTH_MODEL?{membersBefore,membersAfter:opts.defender.hp,damagePlans:parts.flatMap(r=>r.damagePlans??[{direct:0,targets:0}]),directDamage:parts.reduce((n,r)=>n+(r.directDamage??0),0),splashDamage:parts.reduce((n,r)=>n+(r.splashDamage??0),0),overflowDamage:parts.reduce((n,r)=>n+(r.overflowDamage??0),0)}:{}),
        participants:outcomeScale(opts).participants,packetCount:parts.length,packetHits:parts.filter(r=>r.hit).length,
        packetRolls:parts.map(r=>({hit:r.hit,crit:r.crit,damage:r.finalDamage,attack:r.attackRoll?.total,base:r.baseRoll?.total,ap:r.apRoll?.total})),
        onHitConditions:parts.find(r=>r.onHitConditions?.length)?.onHitConditions};
      result.text=formatResolution(result,opts.defender);return result;
    }
  }
  const { attacker, defender, rng, rules } = opts;
  const { ranged, weapon, atkMods, defMods, ctxAtk, ctxDef, atkStack, netAtk, targetDef } = attackContext(opts);

  // ---- 命中判定 ----
  let hit = false;
  let crit = false;
  let attackRoll: DiceRollDetail | undefined;
  let hitChance: number | undefined;

  if (rules.hitMode === 'd20') {
    const expr = opts.advantage === 'adv' ? '2d20kh1' : opts.advantage === 'dis' ? '2d20kl1' : '1d20';
    attackRoll = rollDice(expr, rng);
    const nat = Math.max(...attackRoll.kept);
    if (nat <= 1) {
      hit = false;
    } else if (nat >= rules.critMin) {
      hit = true;
      crit = true;
    } else {
      hit = attackRoll.total + netAtk >= targetDef;
    }
  } else {
    const diff = netAtk - (targetDef - rules.tw.defOffset);
    hitChance = Math.max(rules.tw.min, Math.min(rules.tw.max, rules.tw.base + diff * rules.tw.perDiff));
    hit = rng.next() < hitChance;
    crit = false;
  }

  const res: AttackResolution = {
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
    atkDetail: describeStack(atkStack),
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
    ...(rules.combatModel===MEMBER_HEALTH_MODEL&&weapon?.recipe?.mechanism==='cannon'?{ammunition:weapon.ammunition}:{}),
  };

  if (!hit) {
    res.text = formatResolution(res, defender);
    return res;
  }

  // ---- 伤害分段 ----
  const src = opts.abilityDamage ?? ((): { baseDice: string; apDice?: string } => {
    if (!weapon) throw new Error(`${attacker.name} 没有武器，无法攻击`);
    return { baseDice: weapon.baseDice, apDice: weapon.apDice };
  })();

  const times = crit && rules.critRule === 'doubleDice' ? 2 : 1;
  const baseRoll = rollDicePortion(src.baseDice, rng, times);
  const apRoll = src.apDice ? rollDicePortion(src.apDice, rng, times) : undefined;

  // 破甲占比特质：将普通段的一部分移入破甲段（无视 DR）；rangedOnly 仅射击生效
  const v2 = rules.resolutionVersion === 'v2';
  const penetration = v2 ? penetrationContext(opts) : undefined;
  const apSharePct = v2 ? 0 : apShareOf(attacker, opts.ranged ?? false, opts.traitRegistry);
  let baseRaw = baseRoll.total;
  let apMoved = 0;
  if (apSharePct > 0) {
    apMoved = Math.round((baseRaw * apSharePct) / 100);
    baseRaw -= apMoved;
  }

  // 护甲减伤只作用于普通段（等级差压制叠加在表值+品质乘数之上，总封顶 90%）
  const dr = v2 ? 1 - penetration!.factor : Math.min(0.9, armorDR(defender, rules, opts.traitRegistry) + qualityGapDR(attacker, defender, opts.weaponOverride));
  const baseAfterDR = v2 ? v2DamageAmount(baseRaw, 0, penetration!.factor, 1) : Math.floor(baseRaw * (1 - dr));
  const apTotal = v2 ? v2DamageAmount(0, apRoll?.total ?? 0, penetration!.factor, 1) : (apRoll?.total ?? 0) + apMoved;

  // 攻击方伤害倍率（践踏等）与防御方守护减免
  const dmgStack = resolveStack(atkMods, 'dmg', ctxAtk, { sameNameKeepsHighest: rules.sameNameKeepsHighest, maxFlat: rules.maxFlat });
  const wardStack = resolveStack(defMods, 'ward', ctxDef, { sameNameKeepsHighest: rules.sameNameKeepsHighest, maxFlat: rules.maxFlat });
  const dmgMult = dmgStack.multTotal;
  const wardMult = wardStack.multTotal;

  const scale = outcomeScale(opts);
  const modern=rules.combatModel===MEMBER_HEALTH_MODEL;
  const sourceScale=modern?(opts.abilityDamage?opts.abilityDamage.damageScale??1:weapon?.damageScale??1)/(penetration?.armorScale??1)*trainingDamage(attacker.level)*bonusMultiplier(attacker.bonuses,'damage'):1;
  const targets=modern?roundDamage(scale.multiplier,rng):0;
  let final = Math.round((baseAfterDR + apTotal) * dmgMult * wardMult * scale.multiplier);
  if (v2) final = roundDamage(v2DamageAmount(baseRaw, apRoll?.total ?? 0, penetration!.factor, dmgMult * wardMult * (modern?targets*sourceScale:scale.multiplier)), rng);
  if (v2) res.participants = scale.participants;
  if (final < 1) final = v2 ? 0 : 1;
  if (penetration) {
    res.channel = penetration.channel; res.penetration = penetration.penetration;
    res.resistance = penetration.resistance; res.penetrationFactor = penetration.factor;
    if(modern)res.armorScale=penetration.armorScale;
  }

  res.baseRoll = { ...baseRoll, total: baseRaw };
  res.apRoll = apRoll;
  res.drPercent = dr * 100;
  res.baseAfterDR = baseAfterDR;
  res.apTotal = apTotal;
  res.dmgMult = dmgMult*sourceScale;
  res.wardMult = wardMult;
  res.finalDamage = final;
  if(modern){res.damagePlans=[memberPlan(opts,final,targets)];applyResolutionDamage(defender,res);}
  else {const actualLoss = applyHealthLoss(defender, final, v2);if (rules.combatModel===COHORT_MODEL) res.finalDamage = actualLoss;res.hpAfter = defender.hp;}
  if (v2 && (!opts.abilityDamage || opts.abilityDamage.weaponBased)) { const conditions = weaponConditions(attacker, defender, weapon, final, opts.traitRegistry); if (conditions.length) res.onHitConditions = conditions; }

  res.text = formatResolution(res, defender);
  return res;
}

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
export function formatResolution(r: AttackResolution, defender: Combatant): string {
  if(r.damageModel==='member-health')return `${r.attackerName} → ${r.defenderName}：${r.ammunition?r.ammunition==='he'?'榴弹·':'穿甲弹·':''}${r.hit?(r.crit?'暴击':'命中'):'未中'}${r.packetCount?`（${r.packetHits}/${r.packetCount}组命中）`:''}，生命损失${r.finalDamage}（${r.hpBefore}→${r.hpAfter}）${defender.scale!=='hero'?`，减员${(r.membersBefore??defender.hp)-(r.membersAfter??defender.hp)}${defender.body==='vehicle'?'辆':'人'}`:''}${r.overflowDamage?`，其中溢出${r.overflowDamage}`:''}${r.splashDamage?`，其中爆炸${r.splashDamage}`:''}${r.penetrationFactor===0?'；未穿透':''}`;
  if(r.packetCount)return `${r.attackerName} → ${r.defenderName}：聚合${r.packetCount}组/${r.packetHits}组命中${r.crit?'（含暴击）':''}，损失${r.finalDamage}${defender.scale==='hero'?'生命':'人'}（${r.hpBefore}→${r.hpAfter}）${r.penetrationFactor===0?'；未穿透':''}`;
  const parts: string[] = [];
  const head = `${r.attackerName} → ${r.defenderName}`;
  if (!r.hit) {
    parts.push(`${head}：${r.attackRoll ? `d20[${r.attackRoll.kept.join(',')}]` : ''}+${r.netAtk} vs 防御${r.targetDef} ✗未命中`);
    return parts.join('\n');
  }
  const rollPart = r.attackRoll
    ? `d20[${r.attackRoll.kept.join(',')}]${r.crit ? ' 暴击!' : ''}+${r.netAtk}=${r.attackRoll.total + r.netAtk} vs 防御${r.targetDef}`
    : `命中率${(r.hitChance! * 100).toFixed(0)}% 命中`;
  parts.push(`${head}：${rollPart} ✦命中`);
  if (r.penetrationFactor !== undefined) parts.push(`${r.channel} 穿透${r.penetration} vs 防护${r.resistance} → ${r.penetrationFactor === 0 ? '未穿透，零生命伤害' : Math.round(r.penetrationFactor * 100) + '%通过'}`);
  if (r.onHitConditions?.some((c) => c.id === 'poisoned')) parts.push('造成损伤后附带中毒，已中毒者不叠层或续期');
  const dmgBits: string[] = [];
  if (r.baseRoll) dmgBits.push(`普通${r.baseRoll.rolls.join('+')}${r.baseRoll.flat ? `+${r.baseRoll.flat}` : ''}${r.drPercent > 0 ? `(减伤${r.drPercent}%后${r.baseAfterDR})` : `(${r.baseAfterDR})`}`);
  if (r.apRoll || r.apTotal > 0) dmgBits.push(`破甲${r.apTotal}`);
  if (r.dmgMult !== 1) dmgBits.push(`×${r.dmgMult}`);
  if (r.wardMult !== 1) dmgBits.push(`守护×${r.wardMult}`);
  parts.push(`伤害 ${dmgBits.join(' ')} = ${r.finalDamage} → ${defender.name} HP ${r.hpBefore}→${r.hpAfter}`);
  if (defender.hp <= 0) parts.push(`${defender.name} 倒下`);
  return parts.join('\n');
}

function cohortSamples(opts: Omit<AttackOpts,'rng'>): number {
  if(opts.rules.combatModel===MEMBER_HEALTH_MODEL&&opts.attacker.scale!=='hero')return Math.min(8,Math.max(1,Math.ceil(outcomeScale({...opts,packetShare:undefined}).participants)));
  return opts.rules.combatModel===COHORT_MODEL&&opts.attacker.scale!=='hero'&&opts.defender.scale!=='hero'?Math.min(8,Math.max(1,Math.ceil(personnel(opts.attacker)/COHORT_REFERENCE))):1;
}

export type { StackResult };
