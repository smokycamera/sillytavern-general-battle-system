import type { Ability, BarrierGrant, Combatant, EffectOp, RulePack } from './types.js';
import { healingGradeMultiplier, HEALING_MODEL } from './healing.js';
import { skillEffectPower } from './data/skill-mechanisms.js';

export const BARRIER_MODEL = 'barrier-grades-v1' as const;
export const LAYERED_BARRIER_MODEL = 'barrier-layers-v2' as const;
export function validateBarrierModel(value: unknown): void {
  if (value !== undefined && value !== BARRIER_MODEL && value !== LAYERED_BARRIER_MODEL) throw Error('屏障模型版本损坏');
}
export function prepareBarrierModel(unit: Combatant, rules: Pick<RulePack, 'barrierModel'>): void {
  validateBarrierModel(rules.barrierModel);
  if (rules.barrierModel) unit.barrierModel = rules.barrierModel; else delete unit.barrierModel;
  if (rules.barrierModel === LAYERED_BARRIER_MODEL && unit.barrier && !unit.barrier.stacking) enableBarrierLayers(unit);
}
/** R19 护盾术跨等级：规格高于受术者训练+1时与治疗同一倍率；是否生效只看 barrierModel。 */
export function barrierGradeMultiplier(unit: Pick<Combatant, 'barrierModel' | 'level'>, power?: number): number {
  return unit.barrierModel ? healingGradeMultiplier(power, unit.level, HEALING_MODEL) : 1;
}

export function validDefensePower(power: unknown): power is number { return Number.isSafeInteger(power) && Number(power) >= 1 && Number(power) <= 10; }
/** 只使用技能自身的L；不根据人物训练、名称或攻击技能推断。 */
export function attachDefensePower(ability: Ability): void {
  // 装备能力与实物逐项校验；其规格在施放时读取，不能改写校验用的实例。
  if (ability.equipmentSourceId || ability.itemSourceId) return;
  const power = ability.power ?? ability.recipe?.power;
  if (!validDefensePower(power)) return;
  const attach = (effect: EffectOp): void => {
    if (effect.op === 'barrier' || effect.op === 'condition' && effect.conditionId === 'blessed') effect.defensePower = skillEffectPower(ability,effect);
    if (effect.op === 'zone') effect.effects?.forEach(attach);
  };
  ability.effects.forEach(attach);
}
export function barrierDefensePower(unit: Pick<Combatant, 'barrier'>): number {
  if (unit.barrier?.stacking === 'layers-v1') return unit.barrier.defenses?.[0]?.power ?? 0;
  return unit.barrier && unit.barrier.remaining > 0 && unit.barrier.duration > 0
    ? Math.max(0, ...(unit.barrier.defenses ?? []).filter(d => d.duration > 0).map(d => d.power)) : 0;
}

/** 屏障在护甲和减伤结算后吸收生命伤害；全队共用一个有限护盾，不增加人数或生命上限。 */
export function barrierAmount(unit: Pick<Combatant, 'barrier'>): number { return unit.barrier?.remaining ?? 0; }

/** 来源屏障与普通技能共用现有吸收逻辑，只分别保存期限与已消耗容量。 */
export function refreshBarrier(unit: Combatant): void {
  if (unit.barrier?.stacking === 'layers-v1') { refreshLayers(unit, true, true); return; }
  if (!unit.barrier?.grants) return;
  const grants = unit.barrier.grants.filter(grant => {
    if (grant.remaining <= 0 || grant.duration <= 0) return false;
    if (!grant.effectSourceId) return true;
    const source = unit.traitSources?.find(s => s.id === grant.effectSourceId && s.barrier && !s.revoked && (s.duration.kind === 'permanent' || s.remaining! > 0));
    if (!source) return false;
    grant.duration = source.duration.kind === 'rounds' ? source.remaining! : 99;
    for (const defense of grant.defenses ?? []) defense.duration = grant.duration;
    return true;
  });
  if (!grants.length) { delete unit.barrier; return; }
  const strongest = grants.reduce((a, b) => a.remaining >= b.remaining ? a : b), defenses = new Map<number, number>();
  for (const grant of grants) for (const defense of grant.defenses ?? []) if (defense.duration > 0) defenses.set(defense.power, Math.max(defenses.get(defense.power) ?? 0, defense.duration));
  unit.barrier = { remaining: strongest.remaining, duration: Math.max(...grants.map(g => g.duration)), sourceId: strongest.sourceId, grants,
    ...(defenses.size ? { defenses: [...defenses].map(([power, duration]) => ({ power, duration })) } : {}) };
}

function layerPower(grant: BarrierGrant): number { return grant.defenses?.[0]?.power ?? 0; }
function layerExpiry(grant: BarrierGrant): number { return grant.battleLong ? 100 : grant.duration; }
function enableBarrierLayers(unit: Combatant): void {
  const previous = unit.barrier;
  if (!previous || previous.stacking) return;
  const grants = previous.grants ?? [{ remaining: previous.remaining, duration: previous.duration, sourceId: previous.sourceId, defenses: previous.defenses }];
  for (const grant of grants) grant.legacy = true;
  previous.grants = grants; previous.stacking = 'layers-v1'; refreshLayers(unit, true, true);
}
/** 授予/到期时排序；命中只就地压缩与求和，不排序、不复制整份单位。 */
function refreshLayers(unit: Combatant, sort: boolean, validateSources: boolean): void {
  const barrier = unit.barrier!, grants = barrier.grants!;
  let write = 0, total = 0, legacy = 0, duration = 0, power = 0, defenseDuration = 0;
  for (const grant of grants) {
    if (grant.remaining <= 0 || grant.duration <= 0) continue;
    if (validateSources && grant.effectSourceId) {
      const source = unit.traitSources?.find(s => s.id === grant.effectSourceId && s.barrier && !s.revoked && (s.duration.kind === 'permanent' || s.remaining! > 0));
      if (!source) continue;
      grant.duration = source.duration.kind === 'rounds' ? source.remaining! : 99;
      for (const defense of grant.defenses ?? []) defense.duration = grant.duration;
    }
    grants[write++] = grant;
    if (grant.legacy) legacy = Math.max(legacy, grant.remaining); else total += grant.remaining;
    duration = Math.max(duration, grant.duration);
    for (const defense of grant.defenses ?? []) if (defense.duration > 0 && defense.power >= power) {
      defenseDuration = defense.power > power ? defense.duration : Math.max(defenseDuration, defense.duration); power = defense.power;
    }
  }
  grants.length = write;
  if (!write) { delete unit.barrier; return; }
  if (sort) grants.sort((a,b) => Number(!!a.legacy) - Number(!!b.legacy) || layerPower(b) - layerPower(a) || layerExpiry(a) - layerExpiry(b) || (a.key ?? '').localeCompare(b.key ?? ''));
  barrier.remaining = total + legacy; barrier.duration = duration; barrier.sourceId = grants[0]!.sourceId;
  if (power) barrier.defenses = [{ power, duration: defenseDuration }]; else delete barrier.defenses;
}

/** 相同施术者的同机制/实物共用来源；改名不复制一份屏障。 */
export function barrierSourceKey(actorId: string, ability: Pick<Ability, 'id' | 'definitionId' | 'itemSourceId' | 'equipmentSourceId'>): string {
  return JSON.stringify([actorId, ability.itemSourceId ?? ability.equipmentSourceId ?? ability.definitionId ?? ability.id]);
}
function barrierLayerKey(source: string, power?: number): string { return JSON.stringify([source, power ?? 0]); }
/** 合法性只比较这次施放自己的层，不能因其他人的屏障足够大就拒绝叠加。 */
export function barrierSufficient(unit: Combatant, amount: number, duration: number, power: number | undefined, actorId: string, ability: Ability): boolean {
  if (unit.barrierModel === LAYERED_BARRIER_MODEL || unit.barrier?.stacking === 'layers-v1') {
    const key = barrierLayerKey(barrierSourceKey(actorId, ability), power), layer = unit.barrier?.grants?.find(g => !g.legacy && g.key === key);
    return !!layer && layer.remaining >= Math.max(1, Math.round(amount * barrierGradeMultiplier(unit, power))) && layer.duration >= duration;
  }
  return (unit.barrier?.remaining ?? 0) >= amount && (unit.barrier?.duration ?? 0) >= duration
    && (!power || !!unit.barrier?.defenses?.some(d => d.power >= power && d.duration >= duration));
}

function mergedBarrier(previous: BarrierGrant | undefined, amount: number, duration: number, sourceId?: string, defensePower?: number): BarrierGrant {
  const defenses = (previous?.defenses ?? []).map(d => ({ ...d }));
  if (defensePower !== undefined) {
    const same = defenses.find(d => d.power === defensePower);
    if (same) same.duration = Math.max(same.duration, duration);
    else defenses.push({ power: defensePower, duration });
  }
  return { remaining: Math.max(previous?.remaining ?? 0, amount), duration: Math.max(previous?.duration ?? 0, duration), sourceId,
    ...(defenses.length ? { defenses } : {}) };
}
export function grantBarrier(unit: Combatant, amount: number, duration: number, sourceId?: string, defensePower?: number, sourceKey?: string): number {
  if (!Number.isSafeInteger(amount) || amount < 1 || !Number.isSafeInteger(duration) || duration < 1 || duration > 99) throw Error('屏障强度或持续回合不正确');
  if (defensePower !== undefined && !validDefensePower(defensePower)) throw Error('屏障防御规格须为1–10整数');
  if (unit.hp <= 0 || ['dead', 'fled'].includes(unit.status)) return 0;
  // R19 只在授予时换算一次；取较强时比较的是换算后的数值，防御规格不变。
  amount = Math.max(1, Math.round(amount * barrierGradeMultiplier(unit, defensePower)));
  const before = barrierAmount(unit);
  if (unit.barrierModel === LAYERED_BARRIER_MODEL || unit.barrier?.stacking === 'layers-v1') {
    enableBarrierLayers(unit);
    unit.barrier ??= { remaining: 0, duration, stacking: 'layers-v1', grants: [] };
    const grants = unit.barrier.grants!, effectSource = unit.traitSources?.find(s => s.id === sourceId && s.conditions !== undefined && s.barrier);
    const key = barrierLayerKey(sourceKey ?? sourceId ?? '@anonymous', defensePower);
    const previous = grants.find(g => !g.legacy && g.key === key);
    if (previous) { previous.remaining = Math.max(previous.remaining, amount); previous.duration = Math.max(previous.duration, duration); if (previous.defenses) previous.defenses[0]!.duration = previous.duration; }
    else grants.push({ remaining: amount, duration, key, sourceId, ...(effectSource ? { effectSourceId: effectSource.id } : {}), ...(defensePower ? { defenses: [{ power: defensePower, duration }] } : {}) });
    refreshLayers(unit, true, true); return barrierAmount(unit) - before;
  }
  // 重复施放取较强保护，不把多件护符或同一技能无限相加。
  const effectSource = unit.traitSources?.find(s => s.id === sourceId && s.conditions !== undefined && s.barrier);
  if (effectSource || unit.barrier?.grants) {
    const grants = structuredClone(unit.barrier?.grants ?? (unit.barrier ? [unit.barrier] : []));
    if (effectSource) grants.push({ ...mergedBarrier(undefined, amount, duration, sourceId, defensePower), effectSourceId: effectSource.id });
    else {
      const index = grants.findIndex(g => !g.effectSourceId), normal = mergedBarrier(index < 0 ? undefined : grants[index], amount, duration, sourceId, defensePower);
      if (index < 0) grants.push(normal); else grants[index] = normal;
    }
    unit.barrier = { remaining: Math.max(before, amount), duration, grants }; refreshBarrier(unit);
  } else unit.barrier = mergedBarrier(unit.barrier, amount, duration, sourceId, defensePower);
  return barrierAmount(unit) - before;
}
export function absorbBarrier(unit: Combatant, amount: number, protectedRatio = 1, ratioForPower?: (power: number) => number): number {
  const incoming = Math.max(0, Math.round(amount));
  if (!incoming || !unit.barrier) return incoming;
  if (unit.barrier?.stacking === 'layers-v1') {
    let left = incoming, legacy = 0, legacyPower = 0, legacyDuration = 99, legacyDone = false, lastPower = -1, ratio = protectedRatio;
    const grants = unit.barrier.grants!;
    for (const grant of grants) if (grant.legacy) {
      legacy = Math.max(legacy, grant.remaining); legacyDuration = Math.min(legacyDuration, grant.duration);
      for (const defense of grant.defenses ?? []) if (defense.duration > 0) legacyPower = Math.max(legacyPower, defense.power);
    }
    let index = 0;
    while (left) {
      while (index < grants.length && grants[index]!.legacy) index++;
      const grant = grants[index];
      const useLegacy = !!legacy && !legacyDone && (!grant || legacyPower > layerPower(grant) || legacyPower === layerPower(grant) && legacyDuration <= grant.duration);
      if (!grant && !useLegacy) break;
      const power = useLegacy ? legacyPower : layerPower(grant!);
      if (power !== lastPower) { ratio = ratioForPower?.(power) ?? protectedRatio; lastPower = power; }
      const needed = Math.max(0, Math.round(left * ratio)), spent = Math.min(useLegacy ? legacy : grant!.remaining, needed);
      // 换算余量跨层保留，最后才取整；拆成很多薄层不能反复取整多挡伤害。
      left = spent === needed ? 0 : Math.max(0, left - spent / ratio);
      if (useLegacy) { for (const old of grants) if (old.legacy) old.remaining = Math.max(0, old.remaining - spent); legacyDone = true; }
      else { grant!.remaining -= spent; index++; }
    }
    refreshLayers(unit, false, false); return Math.max(0, Math.round(left));
  }
  // 容量扣除采用屏障规格；只有尚未吸收的攻击份额恢复为肉身规格。
  const protectedDamage = Math.max(0, Math.round(incoming * protectedRatio));
  const absorbed = Math.min(protectedDamage, barrierAmount(unit));
  if (unit.barrier?.grants) {
    for (const grant of unit.barrier.grants) grant.remaining = Math.max(0, grant.remaining - absorbed);
    refreshBarrier(unit);
  } else if (unit.barrier) { unit.barrier.remaining -= absorbed; if (!unit.barrier.remaining) delete unit.barrier; }
  return absorbed === protectedDamage ? 0 : Math.max(0, Math.round(incoming - absorbed / protectedRatio));
}
export function decayBarrier(unit: Combatant): void {
  if (!unit.barrier) return;
  if (unit.barrier.grants) {
    for (const grant of unit.barrier.grants) if (!grant.effectSourceId && !grant.battleLong) {
      grant.duration--;
      if (grant.defenses) grant.defenses = grant.defenses.filter(d => --d.duration > 0);
    }
    refreshBarrier(unit); return;
  }
  if (--unit.barrier.duration <= 0) { delete unit.barrier; return; }
  if (unit.barrier.defenses) {
    unit.barrier.defenses = unit.barrier.defenses.filter(d => --d.duration > 0);
    if (!unit.barrier.defenses.length) delete unit.barrier.defenses;
  }
}
export function validateBarrier(value: Combatant['barrier']): void {
  if (value !== undefined && (!value || !Number.isSafeInteger(value.remaining) || value.remaining < 1 || !Number.isSafeInteger(value.duration) || value.duration < 1 || value.duration > 99 || value.sourceId !== undefined && typeof value.sourceId !== 'string')) throw Error('屏障剩余强度或时间不正确');
  if (value?.defenses !== undefined && (!Array.isArray(value.defenses) || value.defenses.length > 10
    || value.defenses.some(d => !d || !validDefensePower(d.power) || !Number.isSafeInteger(d.duration) || d.duration < 1 || d.duration > value.duration)
    || new Set(value.defenses.map(d => d.power)).size !== value.defenses.length)) throw Error('屏障防御规格或时间不正确');
  if (value?.grants !== undefined) {
    if (value.stacking !== undefined && value.stacking !== 'layers-v1') throw Error('屏障叠加模型损坏');
    if (!Array.isArray(value.grants) || !value.grants.length || !value.stacking && value.grants.filter(g => !g.effectSourceId).length > 1) throw Error('屏障来源结构不正确');
    if (value.stacking) {
      const keys = value.grants.filter(g => !g.legacy).map(g => g.key);
      if (keys.some(key => typeof key !== 'string' || !key) || new Set(keys).size !== keys.length || value.grants.some(g => g.legacy !== undefined && g.legacy !== true
        || !g.legacy && (g.defenses?.length ?? 0) > 1)) throw Error('分层屏障来源损坏');
      const total = value.grants.reduce((n,g) => n + (g.legacy ? 0 : g.remaining), 0) + Math.max(0, ...value.grants.filter(g => g.legacy).map(g => g.remaining));
      if (value.remaining !== total) throw Error('分层屏障容量不一致');
      const power = Math.max(0, ...value.grants.flatMap(g => (g.defenses ?? []).filter(d => d.duration > 0).map(d => d.power)));
      if ((value.defenses?.[0]?.power ?? 0) !== power || (value.defenses?.length ?? 0) > 1 || value.duration !== Math.max(...value.grants.map(g => g.duration))) throw Error('分层屏障汇总不一致');
      const normal = value.grants.filter(g => !g.legacy);
      if (normal.some((g,i) => i > 0 && (layerPower(normal[i-1]!) < layerPower(g) || layerPower(normal[i-1]!) === layerPower(g) && layerExpiry(normal[i-1]!) > layerExpiry(g)))) throw Error('分层屏障消耗顺序损坏');
    }
    const ids = value.grants.map(g => g.effectSourceId).filter(Boolean);
    if (new Set(ids).size !== ids.length) throw Error('屏障来源重复');
    for (const grant of value.grants) {
      if (grant.battleLong !== undefined && (grant.battleLong !== true || grant.duration !== 99 || value.stacking !== 'layers-v1' || grant.legacy || grant.effectSourceId || !grant.sourceId || !grant.defenses?.length)) throw Error('佩戴屏障期限记录损坏');
      if (grant.effectSourceId !== undefined && (typeof grant.effectSourceId !== 'string' || !grant.effectSourceId)) throw Error('屏障来源编号不正确');
      validateBarrier({ remaining: grant.remaining, duration: grant.duration, sourceId: grant.sourceId, defenses: grant.defenses });
    }
  }
  if (value?.stacking && !value.grants) throw Error('分层屏障缺少来源');
}
