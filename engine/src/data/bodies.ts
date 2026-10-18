import type { BodyKind, Combatant, DamageChannel } from '../types.js';

/**
 * 实际身体统一决定结构与装备容量；体量特质只是这些事实的投影。
 * 放在不依赖其他模块的叶子文件里：health-limits 在模块初始化时就要读这张表，若经 body.ts 读取会形成循环引用。
 */
export const BODY: Record<BodyKind, { hp: number; strength: number; capacity: number; movement: number; protection: Record<DamageChannel, number> }> = {
  human: { hp: 1, strength: 1, capacity: 14, movement: 3, protection: { kinetic: 0, thermal: 0, arcane: 0 } },
  large: { hp: 2, strength: 1.4, capacity: 18, movement: 3, protection: { kinetic: 1, thermal: 0, arcane: 0 } },
  vehicle: { hp: 6, strength: 1, capacity: 24, movement: 3, protection: { kinetic: 0, thermal: 0, arcane: 0 } },
  giant: { hp: 10, strength: 1.8, capacity: 24, movement: 2, protection: { kinetic: 2, thermal: 1, arcane: 0 } },
};
export function bodyProfile(body: BodyKind = 'human', model?: Combatant['damageModel']) {
  return model === 'wounds-v2' && body === 'giant' ? { ...BODY.giant, hp: 6, strength: 3 } : BODY[body];
}
