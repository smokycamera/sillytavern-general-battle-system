import type { Ability, EffectOp, ZonePayload } from '../types.js';
import { curveAt } from '../data/curves.js';
import { diceAvg, rebuildDice } from '../data/weapons.js';
import { skillMechanismFromId, skillMechanismName, SKILL_MODIFIERS, MOVEMENT_MODIFIERS } from '../data/skill-mechanisms.js';
import { skillMoveReach } from '../skill-movement.js';
import { conditionEffectWeight, controlSavePenalty, skillsPhase2, anchoredSkills, type SkillModel } from '../skill-model.js';
import { UNIFIED_WOUNDS } from '../balance.js';
import { TRAIT_PARAMETERS } from '../trait-parameters.js';
import { balanceGenericSkill, BUFF_CONDITIONS } from '../skill-balance.js';
import { attachDefensePower } from '../barrier.js';
import { canonicalTraitId, gradedTraitCost } from '../trait-parameters.js';
import { isGradedTrait } from '../data/traits.js';

/** 由类别、效果原语和独立P生成；不经过命名蓝图，也不从自定义名猜机制。 */
export function compileGenericSkill(id: string, power: number, ownerId: string, name?: string, model?: import('../types.js').Combatant['damageModel'], formula?: SkillModel): Ability {
  const mechanism = skillMechanismFromId(id);
  if (!mechanism) throw new Error('未知或矛盾的技能效果');
  if (!Number.isSafeInteger(power) || power < 1 || power > 10) throw new Error('技能等级必须为1–10整数');
  const phase2 = skillsPhase2(formula);
  if (mechanism.modifiers.some(id => ['taunt','blind','confuse','charm'].includes(id)) && !phase2) throw Error('新控制需要V17技能规则');
  const physical = mechanism.category.startsWith('physical'), magic = mechanism.category.startsWith('magic'), damage = physical || magic;
  const geometry = mechanism.modifiers.find(id => ['cone','line','ring','chain'].includes(id)) as NonNullable<Ability['area']>['shape'] | undefined;
  const zoneKinds = mechanism.modifiers.filter(id => id.startsWith('zone-')).map(id => id.slice(5)) as Extract<EffectOp,{op:'zone'}>['kind'][];
  const area = mechanism.area || !!geometry, curve = curveAt(power, model), effects: EffectOp[] = [];
  const modifiers = mechanism.modifiers.filter((m) => !['melee', 'ranged', 'shield', 'projectile', 'thermal', 'arcane', 'martial', 'cone', 'line', 'ring', 'chain'].includes(m));
  const selected = [...new Set((modifiers.length ? modifiers : damage ? [] : mechanism.category === 'buff' ? ['attack', 'defense'] : ['weaken'])
    .map(key => phase2 && key === 'ward' ? 'trait-guardian' : phase2 && key.startsWith('trait-') ? 'trait-' + canonicalTraitId(key.slice(6)) : key))];
  // skills-v1：同时改两项属性的状态按两项效果分摊效力、抵抗难度、伤害与消耗。
  const weight = selected.reduce((sum, key) => {
    const modifier = SKILL_MODIFIERS.find(m => m.id === key)!;
    return sum + (phase2 && modifier.trait && isGradedTrait(modifier.trait) ? Math.max(1, Math.ceil(gradedTraitCost(modifier.trait, power) / 3)) : conditionEffectWeight(modifier.condition, formula));
  }, 0);
  // V21（skills-v4）按等级锚定：状态效力与士气量乘同级单体创伤预算比例（L5=1），屏障基础量即同级预算；旧公式只在旧规则下保留。
  const anchored = anchoredSkills(formula), budgetRatio = TRAIT_PARAMETERS.woundRatio[power - 1]!;
  const magnitude = Math.max(.25, (anchored ? budgetRatio : (5 + power) / 10) / Math.max(1, Math.sqrt(weight)));
  const duration = 1 + Math.floor((power + 1) / 3), saveDC = 8 + power;
  const damagingDebuff = !damage && selected.some((id) => ['burn', 'poison', 'bleed'].includes(id));
  const share = (area ? 0.7 : 1.6) * Math.pow(0.8, weight);
  if (damage) effects.push({ op: 'damage', baseDice: rebuildDice((diceAvg(curve.dmgBase) + (curve.dmgAp ? diceAvg(curve.dmgAp) : 0)) * share, 6), shape: area ? 'burst' : 'single' });
  if (damagingDebuff) effects.push({ op: 'damage', baseDice: rebuildDice(diceAvg(curve.dmgBase) * 0.35 / (area ? 2 : 1), 6), shape: area ? 'burst' : 'single' });
  for (const key of selected) {
    const modifier = SKILL_MODIFIERS.find((m) => m.id === key)!;
    if (modifier.condition) effects.push({ op: 'condition', conditionId: modifier.condition, dur: ['taunted','charmed','confused'].includes(modifier.condition) ? 1 : modifier.condition === 'blinded' ? 2 : ['stunned', 'restrained', 'disarmed', 'silenced'].includes(modifier.condition) ? 1 : model === 'wounds-v2' && BUFF_CONDITIONS.has(modifier.condition) ? power : duration,
      magnitude: ['taunted','charmed','confused','blinded'].includes(modifier.condition) ? 1 : magnitude, ...(modifier.allowed === 'hostile' ? { saveDC: ['taunted','charmed','confused','blinded'].includes(modifier.condition) ? saveDC : Math.max(1, saveDC - controlSavePenalty(formula) * Math.max(0, weight - 1) - (key === 'stun' ? 2 : 0)) } : {}), ...(damage || damagingDebuff ? { onHit: true, ...(['poisoned', 'bleeding', 'burning'].includes(modifier.condition) ? { onDamage: true } : {}) } : {}), shape: area ? 'burst' : 'single' });
    else if (modifier.trait) effects.push({ op: 'trait', traitId: modifier.trait, ...(phase2 && isGradedTrait(modifier.trait) ? { level: power } : {}), dur: phase2 ? 1 + Math.floor((power - 1) / 4) : model === 'wounds-v2' ? power : 1 + power, shape: area ? 'burst' : 'single' });
    else if (key === 'heal') effects.push({ op: 'heal', ...(phase2 ? { power } : {}), amount: Math.max(1, Math.round(curve.hp * 0.25 / Math.max(1, weight) / (area ? 2 : 1))) });
    else if (key === 'barrier') effects.push({ op: 'barrier', amount: Math.max(1, Math.round((anchored ? UNIFIED_WOUNDS[power - 1]! : 8 + power * 5) / Math.max(1, weight) / (area ? 2 : 1))), dur: model === 'wounds-v2' ? power : 3 });
    else if (key === 'cleanse' || key === 'dispel') effects.push({ op: 'dispel', polarity: key === 'cleanse' ? 'negative' : 'positive', count: power >= 6 ? 2 : 1 });
    else if (key === 'morale-up' || key === 'morale-down') effects.push({ op: 'morale', amount: (key === 'morale-up' ? 1 : -1) * (anchored ? Math.round(8 * budgetRatio) : 3 + power) });
    else if (key === 'restore' || key === 'drain') effects.push({ op: 'resource', resource: 'SP', amount: (key === 'restore' ? 1 : -1) * (1 + Math.ceil(power / 3)), maximum: 'training' });
    else if (key === 'push' || key === 'pull') effects.push({ op: 'push', force: Math.min(4, 1 + Math.floor((power - 1) / 3)), steps: 1, physical,
      direction: key === 'pull' ? 'towards' : 'away', ...(damage ? { onHit: true } : {}) });
    else if (key === 'summon') effects.push({ op: 'summon', templateId: 'conjured:' + power, count: 1 });
    else if (key === 'summon-single' || key === 'summon-group') effects.push({ op: 'summon', templateId: `conjured:${key.slice(7)}:${power}`, count: 1 });
    else if (MOVEMENT_MODIFIERS.includes(key)) effects.push({ op: 'move', mode: key as 'dash' | 'blink' | 'withdraw', reach: skillMoveReach(key as 'dash' | 'blink' | 'withdraw', power) });
  }
  // 只有位移的技能以落点为目标；与其他效果组合时位移服务于该效果，目标照类别选择。
  const movementOnly = effects.length > 0 && effects.every(e => e.op === 'move');
  const ability: Ability = { id: `${ownerId}:skill:${encodeURIComponent(name?.trim() || skillMechanismName(mechanism))}`, definitionId: id,
    name: name?.trim() || skillMechanismName(mechanism), sourceId: ownerId, cooldownGroup: 'generic:' + mechanism.category,
    category: mechanism.category, recipe: { ...mechanism, version: phase2 ? 'skill-formula-v3' : 'skill-formula-v2', power }, effectVersion: phase2 ? 'skill-v2.5' : 'skill-v2.4', power,
    effects, shape: area ? 'burst' : 'single', channel: physical ? 'kinetic' : mechanism.modifiers.includes('thermal') ? 'thermal' : 'arcane', penetration: 1 + Math.floor(power / 2),
    delivery: magic || !damage && !mechanism.modifiers.includes('martial') ? 'magic' : undefined,
    cost: { resource: 'SP', amount: phase2 ? (area ? 3 : 2) + weight : Math.min(6, (area ? 3 : 2) + weight) }, cooldown: area || selected.includes('stun') ? 3 : 2,
    target: mechanism.category === 'buff' ? 'ally' : 'enemy',
    range: { min: 0, max: 2 + Math.floor(power / 3), metric: 'grid', allowEngaged: true },
    desc: skillMechanismName(mechanism) + '；强度与装备/目标条件共同决定结果，同类别共享冷却。' };
  if (geometry) ability.area = { shape: geometry, radius: 2, maxTargets: 3 };
  if (phase2 && area && !geometry) ability.area = { shape: 'circle', radius: 1, maxTargets: 3 };
  if (zoneKinds.length) {
    const payload = effects.filter((e): e is ZonePayload => !['damage','summon','move'].includes(e.op)).map(e => {
      // 区域接触即触发；流血/燃烧/中毒仍须造成损伤，不能穿过免疫白送状态。
      const copy = { ...e }; if ('onHit' in copy) delete copy.onHit; return copy;
    });
    ability.effects = zoneKinds.map(kind => ({ op: 'zone', kind, power, ...(phase2 ? { healingModel: 'healing-grades-v1' as const } : {}), radius: kind === 'trap' ? 0 : 1, dur: 3,
      ...(payload.length ? { effects: structuredClone(payload) } : {}) }));
    ability.effects.push(...effects.filter(e => e.op === 'summon' || e.op === 'move'));
    ability.target = 'zone'; ability.shape = 'burst'; ability.cost = { resource: 'SP', amount: phase2 ? 3 + weight : Math.min(6,2+weight) }; ability.cooldown = 3; ability.customized = true;
  }
  if (physical && !zoneKinds.length) { ability.damageBasis = 'weapon'; ability.requires = 'weapon'; ability.weaponUse = mechanism.modifiers.includes('melee') ? 'melee' : mechanism.modifiers.includes('ranged') ? 'ranged' : 'auto'; ability.weaponDamageMult = share; }
  if (!zoneKinds.length && mechanism.modifiers.includes('shield')) { ability.damageBasis = 'shield'; ability.requires = 'shield'; delete ability.weaponUse; ability.delivery = 'melee'; ability.range!.max = 1; }
  if (!zoneKinds.length && mechanism.modifiers.includes('projectile')) { delete ability.damageBasis; delete ability.requires; delete ability.weaponUse; delete ability.weaponDamageMult; ability.delivery = 'ranged'; if (area) ability.areaExposure = 4; }
  if (magic && area && !ability.damageBasis) ability.areaExposure = 4;
  if (selected.includes('restore')) { ability.cost = { resource: 'SP', amount: (1 + Math.ceil(power / 3)) * (area ? 2 : 1) }; ability.usesPerBattle = 2; }
  if (selected.includes('burn')) ability.channel = 'thermal';
  if (effects.some(e => e.op === 'summon')) {
    ability.cost = { resource: 'SP', amount: Math.max(4,ability.cost!.amount) }; ability.usesPerBattle = 1;
    if (selected.length === 1 && !damage && !zoneKinds.length) { ability.target = 'self'; ability.range = { min: 0, max: 0, metric: 'self', allowEngaged: true }; }
  }
  if (!area && !damage && selected.length === 1 && ['root','disarm','silence'].includes(selected[0]!)) ability.cost!.amount = 2;
  if (movementOnly) {
    // 单纯位移：选落点；突进/后撤是身体动作，闪现默认是法术，加战技可写成非魔法的瞬步。
    ability.target = 'zone'; ability.shape = 'single'; ability.cost = { resource: 'SP', amount: 1 + weight };
    ability.range = { min: 0, max: Math.max(...effects.map(e => e.op === 'move' ? e.reach : 0)), metric: 'grid', allowEngaged: true };
    if (!effects.some(e => e.op === 'move' && e.mode === 'blink') || mechanism.modifiers.includes('martial')) delete ability.delivery;
  }
  if (phase2 && effects.some(e => e.op === 'trait') && ability.cost?.resource === 'SP') ability.cost.amount = Math.max(ability.cost.amount, (area ? 3 : 2) + weight);
  const controlCosts: Record<string, [number, number]> = { taunt: [3,2], blind: [4,3], confuse: [5,3], charm: [6,4] };
  const special = selected.filter(key => controlCosts[key]);
  if (special.length) { ability.cost = { resource: 'SP', amount: special.reduce((n,key) => n + controlCosts[key]![0], 0) + (area ? 2 : 0) + selected.filter(key => !controlCosts[key]).length }; ability.cooldown = Math.max(...special.map(key => controlCosts[key]![1])); }
  balanceGenericSkill(ability, formula);
  attachDefensePower(ability);
  return ability;
}
