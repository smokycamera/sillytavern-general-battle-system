import type { Ability, EffectOp } from '../types.js';
import { curveAt } from '../data/curves.js';
import { diceAvg, rebuildDice } from '../data/weapons.js';
import { skillMechanismFromId, skillMechanismName, SKILL_MODIFIERS } from '../data/skill-mechanisms.js';
import { balanceGenericSkill } from '../skill-balance.js';

/** 由类别、效果原语和独立P生成；不经过命名蓝图，也不从自定义名猜机制。 */
export function compileGenericSkill(id: string, power: number, ownerId: string, name?: string): Ability {
  const mechanism = skillMechanismFromId(id);
  if (!mechanism) throw new Error('未知或矛盾的技能效果');
  if (!Number.isSafeInteger(power) || power < 1 || power > 10) throw new Error('技能等级必须为1–10整数');
  const physical = mechanism.category.startsWith('physical'), magic = mechanism.category.startsWith('magic'), damage = physical || magic;
  const geometry = mechanism.modifiers.find(id => ['cone','line','ring','chain'].includes(id)) as NonNullable<Ability['area']>['shape'] | undefined;
  const zoneKind = mechanism.modifiers.find(id => id.startsWith('zone-'))?.slice(5) as Extract<EffectOp,{op:'zone'}>['kind'] | undefined;
  const area = mechanism.area || !!geometry, curve = curveAt(power), effects: EffectOp[] = [];
  const modifiers = mechanism.modifiers.filter((m) => !['melee', 'ranged', 'shield', 'projectile', 'thermal', 'arcane', 'martial', 'cone', 'line', 'ring', 'chain'].includes(m));
  const selected = modifiers.length ? modifiers : damage ? [] : mechanism.category === 'buff' ? ['attack', 'defense'] : ['weaken'];
  const magnitude = (5 + power) / 10 / Math.max(1, Math.sqrt(selected.length));
  const duration = 1 + Math.floor((power + 1) / 3), saveDC = 8 + power;
  const damagingDebuff = !damage && selected.some((id) => ['burn', 'poison', 'bleed'].includes(id));
  const share = (area ? 0.7 : 1.6) * Math.pow(0.8, selected.length);
  if (damage) effects.push({ op: 'damage', baseDice: rebuildDice((diceAvg(curve.dmgBase) + (curve.dmgAp ? diceAvg(curve.dmgAp) : 0)) * share, 6), shape: area ? 'burst' : 'single' });
  if (damagingDebuff) effects.push({ op: 'damage', baseDice: rebuildDice(diceAvg(curve.dmgBase) * 0.35 / (area ? 2 : 1), 6), shape: area ? 'burst' : 'single' });
  for (const key of selected) {
    const modifier = SKILL_MODIFIERS.find((m) => m.id === key)!;
    if (modifier.condition) effects.push({ op: 'condition', conditionId: modifier.condition, dur: ['stunned', 'restrained', 'disarmed', 'silenced'].includes(modifier.condition) ? 1 : duration,
      magnitude, ...(mechanism.category !== 'buff' ? { saveDC: saveDC - 2 * Math.max(0, selected.length - 1) - (key === 'stun' ? 2 : 0) } : {}), ...(damage || damagingDebuff ? { onHit: true, ...(['poisoned', 'bleeding', 'burning'].includes(modifier.condition) ? { onDamage: true } : {}) } : {}), shape: area ? 'burst' : 'single' });
    else if (modifier.trait) effects.push({ op: 'trait', traitId: modifier.trait, dur: 1 + power, shape: area ? 'burst' : 'single' });
    else if (key === 'heal') effects.push({ op: 'heal', amount: Math.max(1, Math.round(curve.hp * 0.25 / Math.max(1, selected.length) / (area ? 2 : 1))) });
    else if (key === 'barrier') effects.push({ op: 'barrier', amount: Math.max(1, Math.round((8 + power * 5) / Math.max(1, selected.length) / (area ? 2 : 1))), dur: 3 });
    else if (key === 'cleanse' || key === 'dispel') effects.push({ op: 'dispel', polarity: key === 'cleanse' ? 'negative' : 'positive', count: power >= 6 ? 2 : 1 });
    else if (key === 'morale-up' || key === 'morale-down') effects.push({ op: 'morale', amount: (key === 'morale-up' ? 1 : -1) * (3 + power) });
    else if (key === 'restore' || key === 'drain') effects.push({ op: 'resource', resource: 'SP', amount: (key === 'restore' ? 1 : -1) * (1 + Math.ceil(power / 3)), maximum: 'training' });
    else if (key === 'push' || key === 'pull') effects.push({ op: 'push', force: Math.min(4, 1 + Math.floor((power - 1) / 3)), steps: 1, physical,
      direction: key === 'pull' ? 'towards' : 'away', ...(damage ? { onHit: true } : {}) });
    else if (key === 'summon') effects.push({ op: 'summon', templateId: 'conjured:' + power, count: 1 });
  }
  const ability: Ability = { id: `${ownerId}:skill:${encodeURIComponent(name?.trim() || skillMechanismName(mechanism))}`, definitionId: id,
    name: name?.trim() || skillMechanismName(mechanism), sourceId: ownerId, cooldownGroup: 'generic:' + mechanism.category,
    category: mechanism.category, recipe: { ...mechanism, version: 'skill-formula-v2', power }, effectVersion: 'skill-v2.4', power,
    effects, shape: area ? 'burst' : 'single', channel: physical ? 'kinetic' : mechanism.modifiers.includes('thermal') ? 'thermal' : 'arcane', penetration: 1 + Math.floor(power / 2),
    delivery: magic || !damage && !mechanism.modifiers.includes('martial') ? 'magic' : undefined,
    cost: { resource: 'SP', amount: Math.min(6, (area ? 3 : 2) + selected.length) }, cooldown: area || selected.includes('stun') ? 3 : 2,
    target: mechanism.category === 'buff' ? 'ally' : 'enemy',
    range: { min: 0, max: 2 + Math.floor(power / 3), metric: 'grid', allowEngaged: true },
    desc: skillMechanismName(mechanism) + '；强度与装备/目标条件共同决定结果，同类别共享冷却。' };
  if (geometry) ability.area = { shape: geometry, radius: 2, maxTargets: 3 };
  if (zoneKind) { ability.effects = [{ op: 'zone', kind: zoneKind, power, radius: zoneKind === 'trap' ? 0 : 1, dur: 3 }]; ability.target = 'zone'; ability.shape = 'burst'; ability.cost = { resource: 'SP', amount: 3 }; ability.cooldown = 3; ability.customized = true; }
  if (physical) { ability.damageBasis = 'weapon'; ability.requires = 'weapon'; ability.weaponUse = mechanism.modifiers.includes('melee') ? 'melee' : mechanism.modifiers.includes('ranged') ? 'ranged' : 'auto'; ability.weaponDamageMult = share; }
  if (mechanism.modifiers.includes('shield')) { ability.damageBasis = 'shield'; ability.requires = 'shield'; delete ability.weaponUse; ability.delivery = 'melee'; ability.range!.max = 1; }
  if (mechanism.modifiers.includes('projectile')) { delete ability.damageBasis; delete ability.requires; delete ability.weaponUse; delete ability.weaponDamageMult; ability.delivery = 'ranged'; if (area) ability.areaExposure = 4; }
  if (magic && area) ability.areaExposure = 4;
  if (selected.includes('restore')) { ability.cost = { resource: 'SP', amount: (1 + Math.ceil(power / 3)) * (area ? 2 : 1) }; ability.usesPerBattle = 2; }
  if (selected.includes('burn')) ability.channel = 'thermal';
  if (selected.includes('summon')) { ability.cost = { resource: 'SP', amount: 4 }; ability.target = 'self'; ability.range = { min: 0, max: 0, metric: 'self', allowEngaged: true }; ability.usesPerBattle = 1; }
  if (!area && !damage && selected.length === 1 && ['root','disarm','silence'].includes(selected[0]!)) ability.cost!.amount = 2;
  balanceGenericSkill(ability);
  return ability;
}
