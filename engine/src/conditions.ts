/**
 * 标准状态效果注册表。状态 = 修正包 + 可选行为旗标（跳回合/禁攻击/回合掉血）。
 * 自定义状态用 registerCondition 以同一格式注入。
 */

import type { ConditionDef } from './types.js';

export const STANDARD_CONDITIONS: ConditionDef[] = [
  { id: 'empowered', name: '强击', desc: '提高已能造成的伤害，不绕过防护', mods: [{ source: 'condition', name: '强击', kind: 'dmg', type: 'mult', value: 1.2 }] },
  { id: 'inaccurate', name: '失准', desc: '攻击命中下降', mods: [{ source: 'condition', name: '失准', kind: 'atk', type: 'flat', value: -2 }] },
  { id: 'exposed', name: '破绽', desc: '防御下降，不更改实物护甲', mods: [{ source: 'condition', name: '破绽', kind: 'def', type: 'flat', value: -2 }] },
  { id: 'silenced', name: '沉默', desc: '不能使用魔法技能；普通武器动作仍可使用', preventMagic: true },
  { id: 'burning', name: '燃烧', desc: '受到持续灼伤；技能需先穿透并造成实际损伤才能点燃', dot: { dice: '1d4', label: '灼伤' } },
  { id: 'restrained', name: '定身', desc: '不能移动、起飞或冲锋，防御降低1；仍可使用合法攻击和技能', preventMove: true, mods: [{ source: 'condition', name: '定身', kind: 'def', type: 'flat', value: -1 }] },
  {
    id: 'poisoned',
    name: '中毒',
    desc: '受到持续毒伤，攻击降低1；伤害时机与体型抗性由当前战斗规则结算',
    mods: [{ source: 'condition', name: '中毒', kind: 'atk', type: 'flat', value: -1 }],
    dot: { dice: '1d4', label: '毒伤' },
  },
  {
    id: 'bleeding',
    name: '流血',
    desc: '每回合开始受到 1d4 伤害',
    dot: { dice: '1d4', label: '流血' },
  },
  {
    id: 'stunned',
    name: '眩晕',
    desc: '跳过下一回合',
    skipTurn: true,
  },
  {
    id: 'disarmed',
    name: '缴械',
    desc: '不能使用手持武器攻击；拳脚和爪牙等天生武器仍可用',
    preventAttack: true,
  },
  {
    id: 'inspired',
    v2SourceReady: true,
    name: '鼓舞',
    desc: '攻击 +2',
    mods: [{ source: 'condition', name: '鼓舞', kind: 'atk', type: 'flat', value: 2 }],
  },
  {
    id: 'blessed',
    v2SourceReady: true,
    name: '祝福',
    desc: '受到的全伤害降低 20%（守护）',
    mods: [{ source: 'condition', name: '祝福', kind: 'ward', type: 'mult', value: 0.8 }],
  },
  {
    id: 'fearful',
    name: '惊惧',
    v2SourceReady: true,
    desc: '攻击 -2、士气 -10',
    mods: [
      { source: 'condition', name: '恐惧', kind: 'atk', type: 'flat', value: -2 },
      { source: 'condition', name: '恐惧', kind: 'morale', type: 'flat', value: -10 },
    ],
  },
  {
    id: 'hasted',
    v2SourceReady: true,
    name: '加速',
    desc: '先攻速度提高2、移动点提高1；会战可提升纵深调动距离',
    mods: [{ source: 'condition', name: '加速', kind: 'spd', type: 'flat', value: 2 }],
  },
  {
    id: 'slowed',
    v2SourceReady: true,
    name: '减速',
    desc: '先攻速度降低2、移动点降低1，会战不能冲锋',
    mods: [{ source: 'condition', name: '减速', kind: 'spd', type: 'flat', value: -2 }],
  },
  {
    id: 'encouraged',
    v2SourceReady: true,
    name: '坚守',
    desc: '防御 +2',
    mods: [{ source: 'condition', name: '坚守', kind: 'def', type: 'flat', value: 2 }],
  },
  {
    id: 'cursed', name: '诅咒', v2SourceReady: true,
    desc: '攻击和防御各降低2；不会改变装备、身体或生命上限',
    mods: [
      { source: 'condition', name: '诅咒', kind: 'atk', type: 'flat', value: -2 },
      { source: 'condition', name: '诅咒', kind: 'def', type: 'flat', value: -2 },
    ],
  },
  {
    id: 'demoralized', name: '士气低下', v2SourceReady: true,
    desc: '攻击降低1，编队有效士气降低15；会战重整时可能溃逃，不永久扣除基础士气',
    mods: [
      { source: 'condition', name: '士气低下', kind: 'atk', type: 'flat', value: -1 },
      { source: 'condition', name: '士气低下', kind: 'morale', type: 'flat', value: -15 },
    ],
  },
  {
    id: 'confident', name: '振奋', v2SourceReady: true,
    desc: '攻击提高1，编队有效士气提高10；可抵消士气低下的部分影响',
    mods: [
      { source: 'condition', name: '振奋', kind: 'atk', type: 'flat', value: 1 },
      { source: 'condition', name: '振奋', kind: 'morale', type: 'flat', value: 10 },
    ],
  },
  {
    id: 'weakened', name: '虚弱', v2SourceReady: true,
    desc: '造成的合法生命伤害降低20%，不削减治疗或士气效果',
    mods: [{ source: 'condition', name: '虚弱', kind: 'dmg', type: 'mult', value: 0.8 }],
  },
  {
    id: 'vulnerable', name: '易伤', v2SourceReady: true,
    desc: '受到的合法生命伤害提高25%；与守护分别结算，不会让无法穿透的攻击强行造成伤害',
    mods: [{ source: 'condition', name: '易伤', kind: 'ward', type: 'mult', value: 1.25 }],
  },
  {
    id: 'wounded',
    name: '重伤',
    desc: '单次重击所致创伤：攻击 -2、速度 -1',
    mods: [
      { source: 'condition', name: '重伤', kind: 'atk', type: 'flat', value: -2 },
      { source: 'condition', name: '重伤', kind: 'spd', type: 'flat', value: -1 },
    ],
  },
];

export function standardConditionMap(): Map<string, ConditionDef> {
  return new Map(STANDARD_CONDITIONS.map((c) => [c.id, c]));
}

/** 战斗实例可扩展的自定义状态注册表 */
export class ConditionRegistry {
  private defs: Map<string, ConditionDef>;

  constructor(extra: ConditionDef[] = []) {
    this.defs = standardConditionMap();
    for (const c of extra) this.defs.set(c.id, c);
  }

  get(id: string): ConditionDef | undefined {
    return this.defs.get(id);
  }

  register(def: ConditionDef): void {
    this.defs.set(def.id, def);
  }

  all(): ConditionDef[] {
    return [...this.defs.values()];
  }
}
