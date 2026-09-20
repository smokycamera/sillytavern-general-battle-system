/**
 * 技能蓝图库：按「类别」驱动的技能公式生成——与单位/武器生成同构。
 *
 * 类别 = 9 种精简语义：召唤 / 治疗 / 单体物理 / 范围物理 / 单体魔法 / 范围魔法 / 防御 / 士气伤害 / 士气鼓舞。
 * 威力 = 等级曲线基准 × 蓝图 power × 标签浮动（±5%），公式重建骰子表达式。
 * 匹配路径：显式 abilityBlueprints（skills="名字:蓝图L等级"）；无 persona 关键词匹配。
 *
 * 生成结果跨刻度：挂英雄 = 小规模战斗技能；挂连队 = 军团支援阶段自动释放（damage 类）。
 */

import type { Ability, EffectOp, RangeSpec } from '../types.js';
import { curveAt, type CurveRow } from './curves.js';
import { diceAvg, rebuildDice } from './weapons.js';

/** 技能类别：9 种精简语义（面板与世界书统一用词） */
export type Category =
  | 'summon'       // 召唤
  | 'heal'         // 治疗
  | 'phys-single'  // 单体物理
  | 'phys-burst'   // 范围物理
  | 'magic-single' // 单体魔法
  | 'magic-burst'  // 范围魔法
  | 'defense'      // 防御
  | 'morale-dmg'   // 士气伤害
  | 'morale-buff'; // 士气鼓舞

/** 类别 → 显示名（面板与世界书共用的精简词） */
export const CATEGORY_LABELS: Record<Category, string> = {
  'summon': '召唤',
  'heal': '治疗',
  'phys-single': '单体物理',
  'phys-burst': '范围物理',
  'magic-single': '单体魔法',
  'magic-burst': '范围魔法',
  'defense': '防御',
  'morale-dmg': '士气伤害',
  'morale-buff': '士气鼓舞',
};

/** 类别简称的固定默认值；扩充目录不改变既有正文的含义。 */
export const DEFAULT_BLUEPRINTS: Record<Category, string> = {
  summon: 'bp-call-reinforce', heal: 'bp-mending',
  'phys-single': 'bp-crushing-blow', 'phys-burst': 'bp-whirlwind',
  'magic-single': 'bp-arcane-bolt', 'magic-burst': 'bp-firestorm',
  defense: 'bp-iron-guard', 'morale-dmg': 'bp-demoralize', 'morale-buff': 'bp-battle-hymn',
};

export type BlueprintKind =
  | 'damage'      // 攻击（范围/单体由 shape 决定）
  | 'heal'        // 治疗
  | 'buff-def'    // 防御增益
  | 'buff-atk'    // 攻击增益（士气鼓舞：附士气恢复）
  | 'buff-morale' // 士气鼓舞
  | 'debuff-morale' // 降士气
  | 'control' | 'cleanse' | 'dispel'
  | 'summon';     // 召唤

export type BlueprintStyle = 'physical' | 'magic' | 'ranged';

export interface AbilityBlueprint {
  v2Only?: boolean;
  fixedPower?: boolean;
  id: string;
  name: string;
  /** 9 类精简语义（主键，面板/世界书用词） */
  category: Category;
  /** 内部行为 kind（由 category 推导；保留供引擎 switch 兼容） */
  kind: BlueprintKind;
  /** 伤害性质：magic 全段无视护甲（入破甲段）；ranged 带 ranged 标签 */
  style?: BlueprintStyle;
  /** 单体 / 覆盖（burst：小规模对同目标两段结算，军团打两个目标） */
  shape: 'single' | 'burst';
  /** 威力乘数（单体≈1.2-1.4，覆盖≈0.8 两段） */
  power: number;
  cooldown?: number;
  range: RangeSpec;
  desc?: string;
}

/** 从 9 类语义推导内部 kind（供 switch），未命中走 damage */
export function categoryToKind(cat: Category): BlueprintKind {
  switch (cat) {
    case 'summon': return 'summon';
    case 'heal': return 'heal';
    case 'defense': return 'buff-def';
    case 'morale-dmg': return 'debuff-morale';
    case 'morale-buff': return 'buff-morale';
    // 物理/魔法攻击皆由 category 区分；但都落到 damage（shape 决定单体/范围）
    default: return 'damage';
  }
}

export const ABILITY_BLUEPRINTS: Record<string, AbilityBlueprint> = {
  'bp-binding': { id: 'bp-binding', name: '束缚术', category: 'magic-single', kind: 'control', style: 'magic', shape: 'single', power: 0, cooldown: 3, range: { min: 0, max: 3, metric: 'grid', allowEngaged: true }, v2Only: true, desc: '限制目标移动，强壮或训练有素的目标可以抵抗' },
  'bp-shield-bash': { id: 'bp-shield-bash', name: '盾击', category: 'phys-single', kind: 'damage', style: 'physical', shape: 'single', power: 0.7, cooldown: 2, range: { min: 0, max: 1, metric: 'grid', allowEngaged: true }, v2Only: true, desc: '用实际盾牌打击并尝试推开目标' },
  'bp-force-wave': { id: 'bp-force-wave', name: '冲击波', category: 'magic-single', kind: 'damage', style: 'magic', shape: 'single', power: 1.0, cooldown: 3, range: { min: 0, max: 2, metric: 'grid', allowEngaged: true }, v2Only: true, desc: '法术冲击并尝试推动目标一格' },
  'bp-purify': { id: 'bp-purify', name: '净化', category: 'defense', kind: 'cleanse', style: 'magic', shape: 'single', power: 0, cooldown: 3, range: { min: 0, max: 3, metric: 'grid', allowEngaged: true }, v2Only: true, desc: '解除友方负面状态或外部负面来源，不恢复已损失生命' },
  'bp-unravel': { id: 'bp-unravel', name: '驱散', category: 'magic-single', kind: 'dispel', style: 'magic', shape: 'single', power: 0, cooldown: 3, range: { min: 0, max: 3, metric: 'grid', allowEngaged: true }, v2Only: true, desc: '解除敌方有益状态或外部赐福，不拆除实物装备或永久知识' },
  // ---- 召唤 ----
  'bp-call-reinforce': { id: 'bp-call-reinforce', fixedPower: true, name: '呼叫援军', category: 'summon', kind: 'summon', shape: 'single', power: 1, cooldown: 4, range: { min: 0, max: 0, metric: 'self', allowEngaged: true }, desc: '传令兵奔向后方' },
  'bp-raise-dead': { id: 'bp-raise-dead', fixedPower: true, name: '亡者苏生', category: 'summon', kind: 'summon', shape: 'single', power: 1, cooldown: 4, range: { min: 0, max: 0, metric: 'self', allowEngaged: true }, desc: '大地交还它的士兵' },
  // ---- 治疗 ----
  'bp-mending': { id: 'bp-mending', name: '治愈之光', category: 'heal', kind: 'heal', shape: 'single', power: 1, cooldown: 2, range: { min: 0, max: 2, metric: 'grid', allowEngaged: true }, desc: '缝合伤口的温柔力量' },
  'bp-field-triage': { id: 'bp-field-triage', name: '战场急救', category: 'heal', kind: 'heal', shape: 'single', power: 0.8, cooldown: 2, range: { min: 0, max: 1, metric: 'grid', allowEngaged: true }, desc: '止血带与兴奋剂' },
  // ---- 单体物理 ----
  'bp-crushing-blow': { id: 'bp-crushing-blow', name: '重击', category: 'phys-single', kind: 'damage', style: 'physical', shape: 'single', power: 1.6, cooldown: 2, range: { min: 0, max: 0, metric: 'grid', allowEngaged: true }, desc: '灌注全力的一击' },
  'bp-assassinate': { id: 'bp-assassinate', name: '致命刺杀', category: 'phys-single', kind: 'damage', style: 'physical', shape: 'single', power: 1.85, cooldown: 3, range: { min: 0, max: 0, metric: 'grid', allowEngaged: true }, desc: '从死角送出的绝杀' },
  // ---- 范围物理 ----
  'bp-whirlwind': { id: 'bp-whirlwind', name: '旋风斩', category: 'phys-burst', kind: 'damage', style: 'physical', shape: 'burst', power: 0.95, cooldown: 3, range: { min: 0, max: 0, metric: 'grid', allowEngaged: true }, desc: '横扫周身所有敌人' },
  'bp-grenade': { id: 'bp-grenade', name: '破片手雷', category: 'phys-burst', kind: 'damage', style: 'ranged', shape: 'burst', power: 1.05, cooldown: 3, range: { min: 1, max: 3, metric: 'grid', allowEngaged: false }, desc: '抛入敌群的高爆物' },
  // ---- 单体魔法 ----
  'bp-arcane-bolt': { id: 'bp-arcane-bolt', name: '奥术箭', category: 'magic-single', kind: 'damage', style: 'magic', shape: 'single', power: 1.5, cooldown: 2, range: { min: 0, max: 3, metric: 'grid', allowEngaged: true }, desc: '凝聚魔力的追踪弹' },
  'bp-smite': { id: 'bp-smite', name: '圣光惩击', category: 'magic-single', kind: 'damage', style: 'magic', shape: 'single', power: 1.55, cooldown: 2, range: { min: 0, max: 2, metric: 'grid', allowEngaged: true }, desc: '圣光灼烧不洁者' },
  'bp-hex-bolt': { id: 'bp-hex-bolt', name: '诅咒之箭', category: 'magic-single', kind: 'damage', style: 'magic', shape: 'single', power: 1.5, cooldown: 2, range: { min: 0, max: 3, metric: 'grid', allowEngaged: true }, desc: '汲取生命的邪术' },
  // ---- 范围魔法 ----
  'bp-firestorm': { id: 'bp-firestorm', name: '烈焰风暴', category: 'magic-burst', kind: 'damage', style: 'magic', shape: 'burst', power: 1.0, cooldown: 3, range: { min: 0, max: 3, metric: 'grid', allowEngaged: true }, desc: '吞没阵地的火海' },
  'bp-frost-nova': { id: 'bp-frost-nova', name: '冰霜新星', category: 'magic-burst', kind: 'damage', style: 'magic', shape: 'burst', power: 0.95, cooldown: 3, range: { min: 0, max: 2, metric: 'grid', allowEngaged: true }, desc: '炸裂的凛冬' },
  // ---- 防御 ----
  'bp-iron-guard': { id: 'bp-iron-guard', name: '铁壁', category: 'defense', kind: 'buff-def', shape: 'single', power: 1, cooldown: 3, range: { min: 0, max: 1, metric: 'grid', allowEngaged: true }, desc: '架起不可撼动的守势' },
  'bp-aegis-shield': { id: 'bp-aegis-shield', name: '圣盾', category: 'defense', kind: 'buff-def', style: 'magic', shape: 'single', power: 1, cooldown: 3, range: { min: 0, max: 3, metric: 'grid', allowEngaged: true }, desc: '神圣力场庇护盟友' },
  // ---- 士气伤害 ----
  'bp-dread-howl': { id: 'bp-dread-howl', name: '恐怖嚎叫', category: 'morale-dmg', kind: 'debuff-morale', shape: 'burst', power: 1, cooldown: 3, range: { min: 0, max: 1, metric: 'grid', allowEngaged: true }, desc: '令敌胆寒的咆哮' },
  'bp-demoralize': { id: 'bp-demoralize', name: '攻心之计', category: 'morale-dmg', kind: 'debuff-morale', shape: 'burst', power: 1, cooldown: 3, range: { min: 0, max: 3, metric: 'grid', allowEngaged: true }, desc: '瓦解敌军战意的言行' },
  // ---- 士气鼓舞 ----
  'bp-battle-hymn': { id: 'bp-battle-hymn', name: '战歌', category: 'morale-buff', kind: 'buff-morale', shape: 'single', power: 1, cooldown: 3, range: { min: 0, max: 3, metric: 'grid', allowEngaged: true }, desc: '唤起同伴斗志的战歌' },
  'bp-courage-horn': { id: 'bp-courage-horn', name: '勇气号角', category: 'morale-buff', kind: 'buff-morale', shape: 'single', power: 1, cooldown: 3, range: { min: 0, max: 3, metric: 'grid', allowEngaged: true }, desc: '响彻战场的鼓舞号角' },
};

/** 类别显示名：id 用回退（兼容未归类） */
export function categoryLabel(cat: Category | string): string {
  const generic: Record<string, string> = { 'physical-single': '物理单体', 'physical-area': '物理范围', 'magic-single': '魔法单体', 'magic-area': '魔法范围', buff: '增益', debuff: '减益' };
  if (generic[cat]) return generic[cat]!;
  return CATEGORY_LABELS[cat as Category] ?? cat;
}

export interface BlueprintGenResult {
  abilities: Ability[];
  /** 审计：每个生成技能的蓝图与实际威力 */
  audit: { blueprintId: string; power: number }[];
}

export interface BlueprintGenOpts {
  curve: CurveRow;
  level: number;
  /** 威力浮动幅度（0.05 = ±5%）；0 = 关闭 */
  jitter?: number;
  /** 生成数量上限（默认 2） */
  max?: number;
  /** 伪随机源：next() ∈ [0,1) */
  rand: () => number;
}

/** 技能蓝图条目：裸 id 或对象（带威力等级与自定义名——「名字:蓝图L等级」解析产物） */
export type BlueprintSpec = string | { id: string; level?: number; name?: string; instanceId?: string; bonuses?: import('../enhancements.js').Enhancements };

/** 按蓝图与等级曲线公式生成技能；level 覆盖威力曲线、name 覆盖显示名 */
export function abilityFromBlueprint(
  bp: AbilityBlueprint,
  opts: BlueprintGenOpts & { name?: string },
): { ability: Ability; power: number } {
  const jitter = opts.jitter ?? 0.05;
  const power = bp.power * (1 + (jitter > 0 ? opts.rand() * jitter * 2 - jitter : 0));
  const effects: EffectOp[] = [];

  switch (bp.kind) {
    case 'damage': {
      const avg = diceAvg(opts.curve.dmgBase) * power;
      const dice = rebuildDice(avg, 6);
      if (bp.style === 'magic') {
        // 魔法全段无视护甲：普通段与破甲段对调
        effects.push({ op: 'damage', baseDice: '1d2', apDice: dice, shape: bp.shape });
      } else {
        effects.push({
          op: 'damage', baseDice: dice,
          apDice: opts.curve.dmgAp || undefined,
          tag: bp.style === 'ranged' ? 'ranged' : undefined,
          shape: bp.shape,
        });
      }
      break;
    }
    case 'heal': {
      const avg = opts.curve.hp * 0.25 * power;
      effects.push({ op: 'heal', dice: rebuildDice(avg, 6) });
      break;
    }
    case 'buff-def':
      effects.push({ op: 'condition', conditionId: 'encouraged', dur: 2 });
      break;
    case 'buff-atk':
      effects.push({ op: 'condition', conditionId: 'inspired', dur: 2 });
      break;
    case 'buff-morale':
      // 士气鼓舞：短暂激励 × 士气恢复
      effects.push({ op: 'condition', conditionId: 'inspired', dur: 2 });
      effects.push({ op: 'morale', amount: Math.round(6 * power) });
      break;
    case 'debuff-morale':
      effects.push({ op: 'condition', conditionId: 'fearful', dur: 2 });
      effects.push({ op: 'morale', amount: -Math.round(5 * power) });
      break;
    case 'summon':
      effects.push({ op: 'summon', templateId: 'reinforcement', count: 1 });
      break;
  }

  // 友方目标：治疗 / 防御 / 士气鼓舞 / 召唤；其余（攻击/士气伤害）默认敌营
  const ally = bp.kind === 'heal' || bp.kind === 'buff-def' || bp.kind === 'buff-atk' || bp.kind === 'buff-morale' || bp.kind === 'summon';

  return {
    ability: {
      id: bp.id,
      ...(bp.v2Only ? { unavailableReason: '该技能机制需要V2规则' } : {}),
      name: opts.name?.trim() || bp.name,
      desc: bp.desc,
      category: bp.category,
      cooldown: bp.cooldown ?? 2,
      range: { ...bp.range },
      target: ally ? 'ally' : 'enemy',
      effects,
    },
    power,
  };
}

/**
 * 技能组合（去掉 persona，只认显式蓝图条目）：
 * ① skills="名字:蓝图L等级" 显式条目（可带威力等级与自定义名）；② 都没有则空。
 */
export function abilitiesFromBlueprints(
  explicit: BlueprintSpec[] | undefined,
  opts: BlueprintGenOpts,
): BlueprintGenResult {
  const picked: { bp: AbilityBlueprint; level?: number; name?: string }[] = (explicit ?? [])
    .map((item) => {
      const id = typeof item === 'string' ? item : item.id;
      const bp = ABILITY_BLUEPRINTS[id];
      return bp ? { bp, ...(typeof item === 'string' ? {} : { level: item.level, name: item.name }) } : null;
    })
    .filter((x): x is { bp: AbilityBlueprint; level?: number; name?: string } => !!x);

  const abilities: Ability[] = [];
  const audit: { blueprintId: string; power: number }[] = [];
  for (const { bp, level, name } of picked) {
    const { ability, power } = abilityFromBlueprint(bp, {
      ...opts,
      ...(level ? { curve: curveAt(level), level } : {}),
      ...(name ? { name } : {}),
    });
    if (!abilities.some((x) => x.id === ability.id)) {
      abilities.push(ability);
      audit.push({ blueprintId: bp.id, power });
    }
  }
  return { abilities, audit };
}
