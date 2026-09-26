import { bonusSteps } from './enhancements.js';
import { isCohort } from './combat-model.js';
import { skillWeapon } from './skill-runtime.js';
import { isRangedWeapon } from './loadout.js';
import { gridDistance } from './small/spatial.js';
import { formationDistance } from './mass/formation.js';
import type { Ability, Combatant, EffectOp, Weapon } from './types.js';
import type { AttackOpts } from './damage.js';
import type { ObservationContext } from './observation.js';
import { meleeWeapon } from './loadout.js';
import { BODY } from './body.js';
import { curveAt } from './data/curves.js';
import { diceAvg, rebuildDice } from './data/weapons.js';
import {combatWeapon,scaledPowerDice,powerBudget} from './power-anchors.js';
import { sharedParticipants, engagementWidth } from './exposure.js';
import { formationNode } from './mass/formation.js';
import { sameLayer, isAirborne } from './aerial.js';

type DamageEffect = Pick<Extract<EffectOp, { op: 'damage' }>, 'baseDice' | 'apDice' | 'shape' | 'tag'>;
/** 技法与合法基础攻击共用实际武器、通道、穿透和展开，技能P只限制其可发挥预算。 */
export function skillAttack(context: ObservationContext, actor: Combatant, target: Combatant, ability: Ability, effect: DamageEffect, rules?:AttackOpts['rules']): Pick<AttackOpts, 'abilityDamage' | 'weaponOverride' | 'participants' | 'ranged'> {
  if(isCohort(actor)&&!ability.damageBasis){
    const width=engagementWidth(actor,target,ability.delivery!=='melee',context.battlefield,context.fieldTags);
    const attached=new Set(context.attached?.values()??[]);
    const cohort=context.units.filter(u=>!attached.has(u.id)&&sameLayer(actor,u)&&(context.mode==='mass'?formationNode(actor).id===formationNode(u).id:u.pos===actor.pos));
    return {participants:sharedParticipants(actor,cohort,width,target),abilityDamage:{accuracy:bonusSteps(ability.bonuses,'accuracy'),...effect,damageScale:ability.damageScale,channel:ability.channel,penetration:ability.penetration,delivery:ability.delivery,areaExposure:ability.areaExposure},ranged:ability.delivery!=='melee'};
  }
  if (actor.rulesVersion !== 'v2' || !ability.damageBasis) return { abilityDamage: { accuracy:bonusSteps(ability.bonuses,'accuracy'),...effect, damageScale:ability.damageScale,channel: ability.channel, penetration: ability.penetration, delivery: ability.delivery, areaExposure: ability.areaExposure }, ranged: ability.delivery ? ability.delivery !== 'melee' : effect.tag === 'ranged' ? true : undefined };
  let weapon: Weapon | undefined;
  if (ability.damageBasis === 'weapon') weapon = skillWeapon(actor, ability, context.mode === 'mass' ? formationDistance(actor, target) : context.battlefield ? gridDistance(context.battlefield, actor.pos!, target.pos!) : Math.abs((actor.pos ?? 0) - (target.pos ?? 0)));
  else if (actor.shield) {
    const power = actor.shield.recipe?.power ?? 3, size = actor.shield.recipe?.size ?? actor.body ?? 'human';
    weapon = { id: actor.shield.id, name: '盾牌打击', baseDice: rebuildDice(diceAvg(curveAt(power).dmgBase) * BODY[size].strength, 6), channel: 'kinetic', penetration: 1 + Math.floor(power / 4), range: 1, tags: [],
      ...(actor.combatModel==='cohort-v2'?{level:power,recipe:actor.shield.recipe??{version:'mechanism-v2.3',mechanism:'shield',power,quality:3,size,seed:actor.shield.id}}:{}) };
  }
  if (!weapon) return { abilityDamage: { accuracy:bonusSteps(ability.bonuses,'accuracy'),...effect, baseDice: '1d2-2', apDice: undefined, penetration: 0, channel: 'kinetic', weaponBased: true }, ranged: false, participants: 0 };
  if(actor.combatModel==='cohort-v2')weapon=combatWeapon(weapon,actor,target,rules?.weaponOverflow)!;
  const skillBudget = diceAvg(effect.baseDice) + (effect.apDice ? diceAvg(effect.apDice) : 0);
  const equipmentBudget = (diceAvg(weapon.baseDice) + (weapon.apDice ? diceAvg(weapon.apDice) : 0)) * (weapon.damageScale??1) * Math.min(3, weapon.attacks ?? 1) * (ability.weaponDamageMult ?? 1);
  const field = context.battlefield;
  const width = engagementWidth(actor, target, isRangedWeapon(weapon), field, context.fieldTags);
  const attached = new Set(context.attached?.values() ?? []);
  const cohort = context.units.filter((u) => !attached.has(u.id) && sameLayer(actor, u) && (context.mode === 'mass' ? formationNode(actor).id === formationNode(u).id : u.pos === actor.pos));
  const budget=isCohort(actor)?equipmentBudget*Math.min(1,powerBudget(ability.power??5)/powerBudget(weapon.level??5)):Math.min(skillBudget,equipmentBudget),scaled=scaledPowerDice(budget);
  return { weaponOverride: weapon, ranged: isRangedWeapon(weapon), participants: sharedParticipants(actor, cohort, width, target),
    abilityDamage: { accuracy:bonusSteps(ability.bonuses,'accuracy'),...effect, baseDice:actor.combatModel==='cohort-v2'?scaled.dice:cappedDice(budget),damageScale:actor.combatModel==='cohort-v2'?scaled.scale:undefined,apDice: undefined, channel: weapon.channel ?? 'kinetic', penetration: (weapon.penetration ?? 1 + Math.floor((weapon.level ?? 5) / 2)) + bonusSteps(ability.bonuses,'penetration',5), weaponBased: true } };
}
/** 低预算不能被最少一枚d6抬高；向下选取可表达且不超过预算的均值。 */
function cappedDice(budget: number): string {
  if (budget < 0.5) return '1d2-2';
  if (budget < 1.5) return '1d2-1';
  const sides = budget < 3.5 ? 2 : 6, average = (sides + 1) / 2, count = Math.max(1, Math.floor(budget / average));
  const flat = Math.max(0, Math.floor(budget - count * average));
  return count + 'd' + sides + (flat ? '+' + flat : '');
}
