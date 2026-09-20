import type { Ability, EffectOp } from '../types.js';
import { abilityFromBlueprint, type AbilityBlueprint } from '../data/ability-blueprints.js';
import { curveAt } from '../data/curves.js';
import { diceAvg, rebuildDice } from '../data/weapons.js';

/** 新技能冻结执行配方；名称不生成机制，T不重写已学技能的P。 */
export function compileAbility(bp: AbilityBlueprint, power: number, ownerId: string, name?: string): Ability {
  const strength = bp.fixedPower ? 1 : power, curve = curveAt(strength);
  const built = abilityFromBlueprint(bp, { curve, level: strength, jitter: 0, rand: () => 0, name }).ability;
  const ability: Ability = { ...built, id: `${ownerId}:${bp.id}`, definitionId: bp.id, sourceId: ownerId, cooldownGroup: bp.id,
    effectVersion: 'skill-v2.3', delivery: bp.style === 'physical' ? 'melee' : bp.style, shape: bp.shape, power: strength, fixedPower: !!bp.fixedPower, unavailableReason: undefined,
    ...(bp.kind === 'damage' && bp.shape === 'burst' && bp.style !== 'physical' ? { areaExposure: 4 } : {}),
    cost: { resource: 'SP', amount: bp.shape === 'burst' ? 3 : 2 },
    channel: ['bp-firestorm', 'bp-frost-nova'].includes(bp.id) ? 'thermal' : bp.style === 'magic' ? 'arcane' : 'kinetic',
    penetration: 1 + Math.floor(strength / 2) };
  const potency = 1 + Math.floor((strength - 1) / 4), saveDC = 9 + Math.floor(strength / 2);
  const control: EffectOp[] = [];
  if (bp.id === 'bp-frost-nova') control.push({ op: 'condition', conditionId: 'slowed', dur: 1, saveDC, onHit: true, shape: 'burst' });
  if (bp.id === 'bp-hex-bolt') control.push({ op: 'condition', conditionId: 'cursed', dur: 1, saveDC, onHit: true });
  if (['bp-shield-bash', 'bp-force-wave'].includes(bp.id)) control.push({ op: 'push', force: Math.min(4, 1 + Math.floor((strength - 1) / 3)), steps: 1, physical: bp.style === 'physical', onHit: true });
  ability.effects = ability.effects.map((effect): EffectOp => {
    if (effect.op === 'damage') return { ...effect, baseDice: rebuildDice((diceAvg(curve.dmgBase) + (curve.dmgAp ? diceAvg(curve.dmgAp) : 0)) * bp.power * (control.length ? 0.75 : 1) / (bp.shape === 'burst' ? 2 : 1), 6), apDice: undefined };
    if (effect.op === 'condition') return { ...effect, shape: bp.shape, ...(['inspired', 'encouraged'].includes(effect.conditionId) ? { potency } : {}) };
    if (effect.op === 'morale') return { ...effect, amount: Math.sign(effect.amount) * (4 + strength) };
    return effect;
  });
  ability.effects.push(...control);
  if (bp.style === 'physical' && bp.kind === 'damage') { ability.damageBasis = bp.id === 'bp-shield-bash' ? 'shield' : 'weapon'; ability.weaponDamageMult = bp.power * (control.length ? 0.75 : 1) / (bp.shape === 'burst' ? 2 : 1); }
  if (bp.kind === 'control') ability.effects = [{ op: 'condition', conditionId: 'restrained', dur: 1, saveDC }];
  if (bp.kind === 'cleanse' || bp.kind === 'dispel') {
    ability.target = bp.kind === 'cleanse' ? 'ally' : 'enemy';
    ability.effects = [{ op: 'dispel', polarity: bp.kind === 'cleanse' ? 'negative' : 'positive', count: strength >= 6 ? 2 : 1 }];
  }
  if (control.length || bp.kind === 'control' || strength >= 6 && ['cleanse', 'dispel'].includes(bp.kind)) ability.cost!.amount++;
  if (bp.style === 'physical' && bp.kind === 'damage') ability.requires = 'melee';
  if (bp.id === 'bp-iron-guard' || bp.id === 'bp-shield-bash') ability.requires = 'shield';
  if (bp.kind === 'summon') {
    ability.requires = bp.id === 'bp-raise-dead' ? 'corpse' : 'reserve';
    ability.cost = { resource: ability.requires, amount: 1 }; ability.usesPerBattle = 1; ability.target = 'self';
    ability.desc = '固定调来1份预备单位，数量与装备来自预备来源，不使用技能强度等级';
    if (ability.requires === 'corpse') ability.unavailableReason = '尸体苏生不在当前本地目标范围';
  }
  if (bp.id === 'bp-hex-bolt') ability.desc = '奥术损伤并尝试施加诅咒；目标可抵抗，不附带吸血';
  if (bp.id === 'bp-frost-nova') ability.desc = '至多两名合法可见目标受到热能变化伤害，并分别尝试施加减速';
  if (bp.id === 'bp-whirlwind') ability.desc = '至多两名近身合法目标分担范围攻击预算';
  return ability;
}
