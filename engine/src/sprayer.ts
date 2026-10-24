import type { Combatant, Weapon } from './types.js';
import type { Rng } from './rng.js';
import { isArmsV2, isSprayer, sprayerFuel } from './arms.js';
import { conditionImmunity } from './skill-effects.js';
import { moraleProfile } from './morale.js';
import type { ObservationContext } from './observation.js';

/** R16 惊惧：受到实际损失的目标做士气检定，DC 10+⌊L/2⌋，与恐惧同一入口（d20+有效士气/10）；非生物、不溃、载具除外。 */
export function sprayerFear(context: ObservationContext, target: Combatant, power: number, sourceId: string, rng: Rng): string | undefined {
  if (target.hp <= 0 || target.body === 'vehicle' || conditionImmunity(target, 'fearful') || target.conditions.some(c => c.id === 'fearful' && c.dur > 0)) return undefined;
  const effective = moraleProfile(context, target).effective;
  const dc = 10 + Math.floor(power / 2), bonus = target.numericModel ? effective / 10 : Math.floor(effective / 10), roll = rng.d(20);
  const weight = Math.max(0, Math.min(1, 1 + roll + bonus - dc));
  const success = target.numericModel ? weight >= 1 || weight > 0 && rng.next() < weight : roll + bonus >= dc;
  if (success) return `${target.name} 顶住火焰（${roll}+${bonus}对抗${dc}）`;
  target.conditions.push({ id: 'fearful', dur: 1, sourceId });
  return `${target.name} 被火焰惊退，惊惧1次激活（${roll}+${bonus}对抗${dc}）`;
}
/** R16 油箱：持有者被暴击命中时，仍有燃料的喷射武器破裂，每轮最多一次。 */
export function sprayerTank(holder: Combatant, round: number): Weapon | undefined {
  if (!isArmsV2(holder.armsModel) || holder.hp <= 0 || holder.tankRupturedRound === round) return undefined;
  return [holder.weapon, holder.sidearm].find((w): w is Weapon => isSprayer(w) && sprayerFuel(holder, w!) > 0);
}
