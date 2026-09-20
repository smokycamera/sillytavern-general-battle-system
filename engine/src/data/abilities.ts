/**
 * 技能模板库：跨刻度技能（同一 Ability 挂在英雄身上=小规模战斗技能，
 * 挂在连队身上=军团支援阶段自动释放的支援火力/战场魔法）。
 *
 * 约定：无 cost（军团单位没有资源池）+ 带 damage 的模板会被军团支援阶段自动释放；
 * 士气/治疗类留给面板手动指定目标。
 */

import type { Ability } from '../types.js';

export const ABILITY_TEMPLATES: Record<string, Ability> = {
  'orbital-strike': {
    id: 'orbital-strike', name: '轨道打击', target: 'enemy', cooldown: 2,
    range: { min: 0, max: 99, metric: 'global', allowEngaged: true },
    desc: '舰载轨道炮对地支援：重伤目标连队并震撼其士气',
    effects: [
      { op: 'damage', baseDice: '3d6+8', apDice: '2d6', tag: 'ranged' },
      { op: 'morale', amount: -6 },
    ],
  },
  'naval-broadside': {
    id: 'naval-broadside', name: '舰炮齐射', target: 'enemy', cooldown: 3,
    range: { min: 0, max: 99, metric: 'global', allowEngaged: true },
    desc: '一次完整的舷侧齐射覆盖目标区域',
    effects: [
      { op: 'damage', baseDice: '4d6+6', apDice: '3d6', tag: 'ranged' },
      { op: 'morale', amount: -8 },
    ],
  },
  'artillery-barrage': {
    id: 'artillery-barrage', name: '炮火准备', target: 'enemy', cooldown: 2,
    range: { min: 0, max: 99, metric: 'global', allowEngaged: true },
    desc: '压制性炮火覆盖，为进攻铺路',
    effects: [
      { op: 'damage', baseDice: '3d6+6', apDice: '1d6', tag: 'ranged' },
      { op: 'morale', amount: -5 },
    ],
  },
  'fireball': {
    id: 'fireball', name: '火球术', target: 'enemy', cooldown: 2,
    range: { min: 0, max: 3, metric: 'grid', allowEngaged: true },
    desc: '经典塑能法术：一团烈焰砸进敌阵',
    effects: [
      { op: 'damage', baseDice: '3d6+4', apDice: '1d6' },
      { op: 'morale', amount: -4 },
    ],
  },
  'battle-hymn': {
    id: 'battle-hymn', name: '战歌', target: 'ally', cooldown: 3,
    range: { min: 0, max: 3, metric: 'grid', allowEngaged: true },
    desc: '吟唱先祖战歌，己方连队士气大振',
    effects: [{ op: 'morale', amount: 8 }],
  },
  'field-medic': {
    id: 'field-medic', name: '战场救护', target: 'ally', cooldown: 2,
    range: { min: 0, max: 2, metric: 'grid', allowEngaged: true },
    desc: '收拢溃兵与伤员，补充兵员',
    effects: [{ op: 'heal', dice: '2d6+4' }],
  },
};

export function getAbilityTemplate(id: string): Ability | undefined {
  return ABILITY_TEMPLATES[id];
}
