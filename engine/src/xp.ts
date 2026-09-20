import { bonusMultiplier, bonusSteps } from './enhancements.js';
import { capSingleLife } from './health-limits.js';
import { setMemberMaximum } from './member-health.js';
import { BODY } from './body.js';
/**
 * 经验与成长：击杀记名 + 参战份额 + 指挥加成 → XP 账本 → 升级按曲线重算属性。
 * 面板在战斗结束后调用 battleXpAwards 展示明细，玩家确认后 applyXp 写回 roster。
 */

import type { Combatant, Trait } from './types.js';
import { curveAt, ARCHETYPE_MODS, SCALE_MODS, MAX_TRAINING_LEVEL, XP_LEVEL_COSTS, LEGACY_XP_THRESHOLDS } from './data/curves.js';
import { normalizeBakedTraitStats, traitStatContributions } from './trait-sources.js';
import { v2Scale } from './unit-scale.js';

export interface XpAward {
  unitId: string;
  name: string;
  /** 击杀记名经验（战斗内 xpByUnit） */
  kills: number;
  /** 参战份额（胜利方瓜分敌方被歼总价值的 participationRate，默认 15%） */
  participation: number;
  /** 指挥加成（主指挥且胜利：基础额 +25%） */
  command: number;
  /** 原始战功与成长经验分开；编队以开战实到人数折算，并支付存活比例损耗。 */
  side?: 'ally' | 'enemy';
  rawTotal?: number;
  startMembers?: number;
  survivingMembers?: number;
  survivalRatio?: number;
  populationBasis?: 'start' | 'capacity';
  total: number;
}

export interface XpAwardOpts {
  /** 我方是否获胜（败方参战份额降为安慰比例，指挥加成仅胜方） */
  won: boolean;
  /** 我方主指挥单位 id */
  commanderId?: string;
  /** 胜方参战份额比例，默认 0.15 */
  participationRate?: number;
  /** 败方参战安慰份额比例，默认 0.05（败仗也打出了经验） */
  defeatParticipationRate?: number;
  /** 指挥加成比例，默认 0.25 */
  commandRate?: number;
  side?: 'ally' | 'enemy';
  initialStrength?: ReadonlyMap<string, number>;
}

/**
 * 战后经验分配：按指定阵营计算。V2编队把全队战功折成人均成长，再乘存活比例。
 * 原始击杀记名保留；编队全灭时存活比例为0，成长经验也为0。
 * 参战份额按幸存单位的开战人数分配：胜方全额比例、败方按安慰比例；
 * 主指挥仅在胜利时额外 +25%。
 */
export function battleXpAwards(combatants: Combatant[], xpByUnit: Map<string, number>, opts: XpAwardOpts): XpAward[] {
  const partRate = opts.won ? (opts.participationRate ?? 0.15) : (opts.defeatParticipationRate ?? 0.05);
  const cmdRate = opts.commandRate ?? 0.25;
  const side = opts.side ?? 'ally';
  const eligible = combatants.filter((c) => c.side === side && (c.rulesVersion === 'v2' || c.scale !== 'mook') && !c.summonerId);
  const survivorIds = new Set(
    eligible.filter((c) => c.hp > 0 && (c.status === 'ready' || c.status === 'fled')).map((c) => c.id),
  );
  const destroyedEnemyXp = eligible.reduce((sum, unit) => sum + (xpByUnit.get(unit.id) ?? 0), 0);
  const pool = Math.round(destroyedEnemyXp * partRate);
  const population = (u: Combatant) => u.rulesVersion === 'v2' && u.scale !== 'hero'
    ? Math.max(1, opts.initialStrength?.get(u.id) ?? u.formation?.capacity ?? u.base.hpMax) : 1;
  const survivorWeight = eligible.reduce((sum, u) => sum + (survivorIds.has(u.id) ? population(u) : 0), 0);

  return eligible
    .map((u): XpAward | null => {
      const kills = xpByUnit.get(u.id) ?? 0;
      const isSurvivor = survivorIds.has(u.id);
      // 无击杀又非幸存者（阵亡/濒死/溃逃）不入账；幸存者哪怕零击杀也拿参战份额
      if (kills <= 0 && !isSurvivor) return null;
      // 参战份额与指挥加成只归幸存者；阵亡者的击杀收益保留
      const part = isSurvivor && survivorWeight > 0 ? Math.floor(pool * population(u) / survivorWeight) : 0;
      const base = kills + part;
      const command = opts.won && isSurvivor && opts.commanderId === u.id ? Math.round(base * cmdRate) : 0;
      const rawTotal = base + command;
      if (u.rulesVersion === 'v2' && u.scale !== 'hero') {
        const recorded = opts.initialStrength?.get(u.id);
        // 旧战斗未记录实到人数时，用固定编制上限；不能以战后残员作为分母。
        const startMembers = population(u);
        const survivingMembers = u.status === 'dead' ? 0 : Math.max(0, Math.min(startMembers, u.formation?.members ?? u.hp));
        const survivalRatio = survivingMembers / startMembers;
        return { unitId: u.id, name: u.name, side, kills, participation: part, command, rawTotal,
          startMembers, survivingMembers, survivalRatio, populationBasis: recorded === undefined ? 'capacity' as const : 'start' as const,
          total: preciseXp(rawTotal / startMembers * survivalRatio) };
      }
      return { unitId: u.id, name: u.name, side, kills, participation: part, command, rawTotal, total: rawTotal };
    })
    .filter((a): a is XpAward => !!a);
}

/** 两军分别计算自己的击杀池和胜负份额，不把敌军战功分给我方。 */
export function battleXpAwardsForBothSides(combatants: Combatant[], xpByUnit: Map<string, number>, opts: Omit<XpAwardOpts, 'won' | 'side'> & { winner: 'ally' | 'enemy' | 'draw' | undefined }): XpAward[] {
  return (['ally', 'enemy'] as const).flatMap(side => battleXpAwards(combatants, xpByUnit, { ...opts, side, won: opts.winner === side }));
}

/** 保留小数经验，采用有效位数消除浮点尾差，不按每场四舍五入到整数。 */
export function preciseXp(value: number): number {
  return Number(Math.max(0, value).toPrecision(12));
}
export function xpLabel(value: number): string {
  return value > 0 && value < 0.0001 ? value.toExponential(2) : String(Number(value.toFixed(4)));
}

export interface LevelUpResult {
  levelsGained: number;
  fromLevel: number;
  toLevel: number;
}

/** 纯读取：旧档按本级完成比例投影到新曲线，既不降级，也不改累计XP。
 *  直接建档的高训练单位可能从0XP开始，此时旧门槛的起点按0处理。 */
function levelXpStart(unit: Combatant): number {
  const total = unit.xp ?? 0;
  if (unit.xpCurve === 'effort-v1') return unit.xpLevelStart ?? total;
  if (unit.level >= MAX_TRAINING_LEVEL) return total;
  const oldFloor = LEGACY_XP_THRESHOLDS[unit.level - 1] ?? 0;
  const oldStart = total >= oldFloor ? oldFloor : 0;
  const oldCost = LEGACY_XP_THRESHOLDS[unit.level]! - oldStart;
  const fraction = Math.max(0, total - oldStart) / oldCost;
  return Number((total - fraction * XP_LEVEL_COSTS[unit.level - 1]!).toPrecision(12));
}

/** 累计XP保持原账本；每级达到自己的成本后升级，溢出经验带入下一级。 */
export function applyXp(unit: Combatant, amount: number, registry?: Map<string, Trait>): LevelUpResult {
  if (!Number.isFinite(amount)) throw new Error('经验必须为有限数值');
  const from = unit.level;
  unit.xpLevelStart = levelXpStart(unit);
  unit.xpCurve = 'effort-v1';
  unit.xp = preciseXp((unit.xp ?? 0) + Math.max(0, amount));
  let levels = 0;
  while (unit.level < MAX_TRAINING_LEVEL && unit.xp >= unit.xpLevelStart + XP_LEVEL_COSTS[unit.level - 1]!) {
    unit.xpLevelStart = Number((unit.xpLevelStart + XP_LEVEL_COSTS[unit.level - 1]!).toPrecision(12));
    unit.level += 1;
    levels += 1;
  }
  if (levels > 0) recomputeFromCurve(unit, from, registry);
  return { levelsGained: levels, fromLevel: from, toLevel: unit.level };
}

/** 本级已完成经验/本级所需经验；进度条从每级起点开始，满级返回null。 */
export function xpProgress(unit: Combatant): { current: number; next: number } | null {
  if (unit.level >= MAX_TRAINING_LEVEL) return null;
  return { current: preciseXp((unit.xp ?? 0) - levelXpStart(unit)), next: XP_LEVEL_COSTS[unit.level - 1]! };
}

/**
 * 训练只更新人物属性；装备与能力实例不参与成长重算。
 * 群体编制不增长。英雄生命上限只增加前后曲线的差值，保留自定义偏移且不治疗。
 */
function recomputeFromCurve(unit: Combatant, fromLevel: number, registry?: Map<string, Trait>): void {
  const curve = curveAt(unit.level);
  const arch = unit.archetype ?? 'infantry';
  const archMod = ARCHETYPE_MODS[arch];
  const scaleMod = SCALE_MODS[unit.rulesVersion === 'v2' ? v2Scale(unit.scale) : unit.scale];
  const deltas = unit.genAudit?.deltas ?? {};

  const traitStats: Partial<Record<'atk' | 'def' | 'spd' | 'hpMax' | 'morale', number>> = {};
  for (const id of new Set(unit.traits)) {
    const t = registry?.get(id);
    if (!t) continue;
    for (const e of t.effects) {
      if (e.kind === 'stat') traitStats[e.stat] = (traitStats[e.stat] ?? 0) + e.value;
    }
  }

  const atk = curve.atk + archMod.atk + scaleMod.atkAdj + (traitStats.atk ?? 0) + (deltas.atk ?? 0);
  const def = curve.def + archMod.def + scaleMod.defAdj + (traitStats.def ?? 0) + (deltas.def ?? 0);
  const spd = bonusSteps(unit.bonuses,'speed',5) + curve.spd + archMod.spd + (traitStats.spd ?? 0) + (deltas.spd ?? 0);
  const bodyHp = unit.rulesVersion === 'v2' ? BODY[unit.body ?? 'human'].hp : scaleMod.hpMult;
  const hpMax = unit.scale === 'hero'
    ? unit.base.hpMax + Math.round(curve.hp * bodyHp * bonusMultiplier(unit.bonuses,'health')) - Math.round(curveAt(fromLevel).hp * bodyHp * bonusMultiplier(unit.bonuses,'health'))
    : unit.base.hpMax;

  unit.base = { ...unit.base, atk, def, spd, hpMax: unit.scale === 'hero' ? capSingleLife(hpMax) : hpMax };
  if(unit.formation) {
    const growth=Math.round((curve.hp-curveAt(fromLevel).hp)*bodyHp*bonusMultiplier(unit.bonuses,'health'));
    setMemberMaximum(unit,unit.formation.memberHp+growth);
  }
  if (unit.base.moraleMax !== undefined) {
    const moraleMax = curve.morale + bonusSteps(unit.bonuses,'morale') + (traitStats.morale ?? 0);
    unit.base.moraleMax = moraleMax;
    unit.morale = Math.min(unit.morale ?? moraleMax, moraleMax);
  }
  unit.xpValue = Math.round(curve.xp * scaleMod.xpMult);
  if (unit.rulesVersion === 'v2') {
    unit.bakedTraitStats = traitStatContributions(unit, unit.traits, registry, false);
    normalizeBakedTraitStats(unit, registry);
  }

}
