import type { Combatant, DamageChannel } from './types.js';

/** 通道增益使用独立状态身份，保留各自的等级、到期与驱散。 */
export const CHANNEL_BUFFS = (['kinetic', 'thermal', 'arcane'] as const).flatMap(channel => {
  const name = { kinetic: '动能', thermal: '热能', arcane: '奥术' }[channel];
  return (['damage', 'defense'] as const).map(stat => ({ channel, stat, name: name + (stat === 'damage' ? '伤害' : '防御'),
    id: `${channel}-${stat}`, condition: `${channel}-${stat}-up` }));
});
export const CHANNEL_BUFF_CONDITIONS = new Set(CHANNEL_BUFFS.map(buff => buff.condition));

/** 同通道取最强的有效伤害增益；失效、待激活状态不参与。与普通强击分别结算。 */
export function channelBuffDamage(unit: Combatant, channel: DamageChannel): number {
  return unit.conditions.reduce((best, condition) => condition.id === `${channel}-damage-up` && condition.dur > 0 && !condition.controlPending
    ? Math.max(best, .2 * (condition.magnitude ?? 1)) : best, 0);
}
