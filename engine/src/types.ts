/**
 * 战阵引擎 · 数据模型
 *
 * 核心原则：
 * - V2只有个体(hero)和编队(company)两种结算刻度；mook仅保留旧数据兼容。
 *   hp 槽位在个体刻度是生命、编队刻度是兵员数，不由叙事地位决定强弱。
 * - 数值权威在引擎；AI 叙述层只消费注入投影。
 */
import type { Enhancements } from './enhancements.js';
import type { AttackResolution } from './damage.js';

// ---------- 刻度与阵营 ----------

/** 个体 / 编队；mook是legacy规则值，V2写入规范为company。 */
export type Scale = 'hero' | 'mook' | 'company';
/** 阵营 */
export type Side = 'ally' | 'enemy' | 'neutral';
/** 兵种原型：近战步兵 / 远程 / 机动（时代皮肤换术语，机制中立） */
export type Archetype = 'infantry' | 'ranged' | 'mobile';

// ---------- 基础属性 ----------

export interface Stats {
  /** 攻击加值 */
  atk: number;
  /** 防御值（被攻击时的目标数值） */
  def: number;
  /** 速度：先攻与行动顺序 */
  spd: number;
  /** 血量上限；company 刻度 = 兵员数 */
  hpMax: number;
  /** 士气上限（company 刻度核心；英雄刻度可缺省） */
  moraleMax?: number;
}

// ---------- 装备（hero 刻度） ----------

/** 武器：伤害分普通段与破甲段（战锤全面战争制） */
export interface Weapon {
  /** 正文明确设定的V4冻结数值，不参与旧装备自动校正。 */
  customized?: boolean;
  /** V4运行时规格投影；库存仍保存原始冻结配方。 */
  powerModel?: 'anchors-v1' | 'wounds-v1' | 'wounds-v2';
  damageScale?: number;
  ammunition?: 'he' | 'ap';
  splashTargets?: number;
  splashFactor?: number;
  recipe?: ItemRecipe;
  channel?: DamageChannel;
  penetration?: number;
  hands?: 0 | 1 | 2;
  load?: number;
  id: string;
  name: string;
  /** 普通段伤害骰，受目标护甲减伤比例作用，如 "1d8+3" */
  baseDice: string;
  /** 破甲段伤害骰，无视护甲减伤，如 "1d6"，可为空 */
  apDice?: string;
  /** 武器标签：双手 / 灵巧 / 骑枪 / 齐射 / ranged…… 供特质与规则引用 */
  tags?: string[];
  /** 射程（小规模战斗）：可攻击的最大距离带；近战0、长柄1、弓弩3+；缺省按 tags 推断 */
  range?: number;
  /** 最小射程；远程旧数据缺省为 1，近战缺省为 0。 */
  minRange?: number;
  /** 贴身（距离0）策略：允许、带命中惩罚、禁止。 */
  pointBlankPolicy?: 'allow' | 'penalty' | 'forbid';
  /** pointBlankPolicy=penalty 时的命中修正，缺省 -2。 */
  pointBlankPenalty?: number;
  /** 间接火力可由军团预备队提供支援；小规模仍受 minRange/maxRange 限制。 */
  indirect?: boolean;
  /** 每回合攻击结算次数（速射武器 >1）；缺省 1 */
  attacks?: number;
  /** 发射后装填回合数（重炮=1 即隔回合一发）；缺省 0 = 无需装填 */
  reload?: number;
  /** 武器品质等级 L1~L10（= weaponLevel ?? 佩戴者生成时等级）：等级差护甲压制的依据 */
  level?: number;
}

/** 护甲：等级映射减伤比例（具体比例由规则包定义） */
export interface Armor {
  /** 仅显式数值编辑时覆盖；未设置的普通装备仍使用原公式。 */
  protectionOverride?: boolean;
  powerScale?: number;
  recipe?: ItemRecipe;
  protection?: Record<DamageChannel, number>;
  load?: number;
  id: string;
  name: string;
  /** 0无甲 1轻甲 2中甲 3重甲 4超重 */
  tier: 0 | 1 | 2 | 3 | 4;
  /** 减伤效率乘数（护甲原型参数，公式生成）：实际减伤 = 规则包表值 × drScale，缺省 1 */
  drScale?: number;
  /** 护甲品质等级 L1~L10（= armorLevel ?? 佩戴者生成时等级）：等级差护甲压制的依据 */
  level?: number;
}

// ---------- 技能（通用资源模型，无法术位） ----------

export type AbilityTarget = 'enemy' | 'ally' | 'self' | 'zone';

export interface RangeSpec {
  min: number;
  max: number;
  metric: 'grid' | 'zone' | 'global' | 'self';
  requiresLineOfSight?: boolean;
  allowEngaged?: boolean;
}

export type EffectOp =
  | { op: 'barrier'; amount: number; dur: number; defensePower?: number }
  | { op: 'zone'; itemEffectModel?: import('./progression.js').ItemProgressionModel; kind: 'fire' | 'poison' | 'smoke' | 'healing' | 'trap'; power: number; healingModel?: import('./healing.js').HealingModel; dur: number; radius: number; amount?: number; penetration?: number; effects?: ZonePayload[] }
  | { op: 'damage'; baseDice: string; apDice?: string; tag?: string; shape?: 'single' | 'burst' }
  | ({ op: 'heal'; power?: number } & ({ dice: string; amount?: never } | { amount: number; dice?: never }))
  | { op: 'condition'; damageChannel?: DamageChannel; conditionId: string; dur: number; potency?: number; magnitude?: number; defensePower?: number; saveDC?: number; onHit?: boolean; onDamage?: boolean; shape?: 'single' | 'burst' }
  | { op: 'trait'; traitId: string; level?: number; dur: number; shape?: 'single' | 'burst' }
  | { op: 'push'; force: number; steps: 1; physical?: boolean; onHit?: boolean; direction?: 'away' | 'towards' }
  | { op: 'dispel'; polarity: 'positive' | 'negative'; count: number }
  | { op: 'resource'; resource: string; amount: number; maximum?: 'training' }
  | { op: 'morale'; amount: number }
  | { op: 'summon'; templateId: string; count: number }
  /** 施术者自身位移：dash 沿可走路线突进、blink 闪现到可见落点（两者在效果之前），withdraw 出手后后撤；reach 为格数。 */
  | { op: 'move'; mode: 'dash' | 'blink' | 'withdraw'; reach: number; massReach?: number };

/** 区域携带实际效果；不递归生成区域或每轮无限召唤。召唤与施术者位移仍在施放时执行。 */
export type ZonePayload = Exclude<EffectOp, { op: 'zone' | 'damage' | 'summon' | 'move' }>;

export interface Ability {
  area?: { shape: 'cone' | 'line' | 'ring' | 'chain' | 'circle'; radius: number; maxTargets: number };
  equipmentSourceId?: string;
  targetBody?: 'vehicle';
  /** 显式编辑的效果与数值不被入场公式重建。 */
  customized?: boolean;
  bonuses?: Enhancements;
    effectVersion?: 'skill-v2.1' | 'skill-v2.2' | 'skill-v2.3' | 'skill-v2.4' | 'skill-v3.0' | 'skill-v4.0' | 'skill-v4.1' | 'skill-v4.2' | 'skill-v4.3' | 'skill-v5.0' | 'skill-v6.0' | 'skill-v6.1' | 'skill-v7.0' | 'skill-v2.5' | 'skill-v8.0' | 'skill-v9.0' | 'skill-v10.0' | 'skill-zone-v5' | 'skill-zone-v6' | 'skill-zone-v7' | 'skill-zone-v1' | 'skill-zone-v2' | 'skill-zone-v3' | 'skill-zone-v4';
    damageScale?: number;
  recipe?: import('./data/skill-mechanisms.js').SkillRecipe;
  weaponUse?: 'auto' | 'melee' | 'ranged';
  /** 独立范围投送最多暴露的编队成员；个体与旧技能仍只按一份。 */
  areaExposure?: number;
  damageBasis?: 'weapon' | 'shield';
  delivery?: 'melee' | 'ranged' | 'magic';
  weaponDamageMult?: number;
  shape?: 'single' | 'burst';
  power?: number;
  fixedPower?: boolean;
  /** 战斗携行实物产生的临时行动；不属于已学/准备技能。 */
  itemSourceId?: string;
  /** V15 一次性道具：喝、敷、注射的单体增益与治疗可用加速动作。 */
  itemQuick?: boolean;
  /** 新编译主动道具的冻结预算版本。 */
  itemEffectModel?: import('./progression.js').ItemProgressionModel;
  /** V15 一次性道具对编队的件数口径：member 每人一份，object 一件一个效果。 */
  itemScaling?: 'member' | 'object';
  /** 编队本次齐用实际消耗的件数；只存在于单次使用的派生行动，不写入存档。 */
  itemDoses?: number;
  definitionId?: string;
  sourceId?: string;
  cooldownGroup?: string;
  requires?: 'shield' | 'melee' | 'weapon' | 'reserve' | 'corpse';
  unavailableReason?: string;
  channel?: DamageChannel;
  penetration?: number;
  id: string;
  name: string;
  desc?: string;
  /** 技能类别（9 类精简语义）：由蓝图推导，供面板/储存器分类展示 */
  category?: string;
  /** 三种计量任意组合：资源消耗 / 冷却回合 / 每战次数 */
  cost?: { resource: string; amount: number };
  cooldown?: number;
  usesPerBattle?: number;
  /** 技能自身射程；执行器、目标列表与自动行动共用，禁止再从主武器猜测。 */
  range?: RangeSpec;
  target: AbilityTarget;
  effects: EffectOp[];
}

/** 技能的战斗态运行数据 */
export interface AbilityState {
  abilityId: string;
  /** 剩余冷却回合 */
  cdLeft: number;
  /** 本战已用次数 */
  used: number;
}

// ---------- 特质（全面战争启发的效果包） ----------

export type TraitEffect =
  /** 内在属性修正 */
  | { kind: 'stat'; stat: 'atk' | 'def' | 'spd' | 'hpMax' | 'morale'; value: number }
  /** 护甲等级修正（重甲+1档等） */
  | { kind: 'armorTier'; value: number }
  /** 守护：全伤害百分比减免，乘法叠加，不可绕过 */
  | { kind: 'ward'; percent: number }
  /** 克制目标类型的攻击加值 */
  | { kind: 'conditionalAtk'; vsTag: string; value: number }
  /** 对带某标签目标的伤害倍率（践踏 vs mook 等） */
  | { kind: 'conditionalDmgMult'; vsTag: string; mult: number }
  /** 破甲强化：将普通段伤害的 percent% 转入破甲段；rangedOnly=仅射击攻击生效 */
  | { kind: 'apShare'; percent: number; rangedOnly?: boolean }
  /** 士气免疫（不溃） */
  | { kind: 'immuneMorale' }
  /** 士气光环：己方全员（正）或使敌方全员（负）士气变化 */
  | { kind: 'moraleAura'; value: number; scope: 'side' | 'enemySide' }
  /** 每回合回复 */
  | { kind: 'regen'; perRound: number }
  /** 命中时给目标上状态（毒击等） */
  | { kind: 'onHitCondition'; conditionId: string; dur: number }
  /** 冲锋攻击加值 */
  | { kind: 'chargeBonus'; value: number }
  /** 攻击方式特化：近战特化（style=melee）/ 射击专家（style=ranged），仅该方式攻击时生效 */
  | { kind: 'attackStyle'; style: 'melee' | 'ranged'; atk?: number; dmgMult?: number }
  /** 战场环境修正：战斗带此环境标签（urban/siege/night/plains…）时生效 */
  | { kind: 'fieldMod'; field: string; atk?: number; def?: number; morale?: number }
  /** 拒马：受到冲锋攻击时伤害减免 */
  | { kind: 'counterChargeDR'; percent: number }
  /** 盾墙：受到远程攻击时伤害减免 */
  | { kind: 'rangedGuardDR'; percent: number }
  /** 通用旗标：飞行 / 潜伏 / 先锋部署 / 散兵…… 由上层解读 */
  | { kind: 'flag'; flag: string; value?: number };

export interface Trait {
  /** 外部来源的执行链已接通；未完成项仍保留在全特质矩阵中继续实施。 */
  v2SourceReady?: boolean;
  v2Desc?: string;
  /** V12 及以前战斗的说明；V13 改了效果的特质才有。 */
  v12Desc?: string;
  /** 停用：已有单位继续生效，正文与配装不再提供；replacement 是正文旧写法的新去处。 */
  legacy?: { note: string; replacement?: string };
  /** 由身体或装备自动产生，不能手写或授予。 */
  derived?: string;
  id: string;
  name: string;
  desc: string;
  /** 授予单位的标签（大型 / 飞行 / 步兵……），供克制与规则判定 */
  grantsTags?: string[];
  effects: TraitEffect[];
}

// ---------- 状态效果 ----------

export interface ConditionDef {
  /** 已贯通来源、时效与两种战斗模式的状态，才允许正文授予。 */
  v2SourceReady?: boolean;
  id: string;
  name: string;
  desc?: string;
  /** 持续期间赋予的修正 */
  mods?: import('./bonus.js').Modifier[];
  /** 特殊行为旗标：跳过回合 / 禁止攻击 / 回合开始掉血 */
  skipTurn?: boolean;
  /** 定身同时阻止地面移动和维持飞行；具体状态/技能通过同一行为字段声明。 */
  preventMove?: boolean;
  preventAttack?: boolean;
  preventMagic?: boolean;
  dot?: { dice: string; label?: string; channel?: DamageChannel };
}

export interface ActiveCondition {
  damageChannel?: DamageChannel;
  controlPending?: boolean;
  controlActive?: boolean;
  controlSide?: Side;
  /** 施放守护的技能规格；只参与跨代毁伤，不增加抗穿。 */
  defensePower?: number;
  /** 小队自身激活中施加的增益，跳过当次回合末递减；随战斗快照保存。 */
  skipNextDecay?: boolean;
  /** V3本地记录状态实际波及成员，单次点燃不会感染整支军团。 */
  affectedMembers?: number;
  magnitude?: number;
  sourceId?: string;
  potency?: number;
  id: string;
  /** 剩余回合 */
  dur: number;
}

// ---------- 战斗单位 ----------

export type UnitStatus = 'ready' | 'dying' | 'dead' | 'routing' | 'fled';

export interface Combatant {
  /** Fractional normal movement only; whole unused steps never stockpile. Battle-local. */
  movementRemainder?: number;
  marchRemainder?: number;
  numericModel?: import('./numeric-model.js').NumericModel;
  /** V25：只在新战斗启用，次数随战斗快照保存，战后剥离。 */
  revivalModel?: 'revival-v1';
  revivalState?: { members: number; used: number };
  /** V23 入场冻结生命、全局轮及实际吸血恢复账本；预览只读。 */
  lifestealState?: { baseline: number; round: number; spent: number; remainder: number };
  controlActivation?: { sequence: number; targetId?: string };
  /** 固定万分之一恢复单位；只在合法再生周期兑现，满血/离场/失去全部来源清零。 */
  regenerationRemainder?: number;
  movedDuringActivation?: boolean;
  looseFormationChoice?: 'loose' | 'closed';
  looseChoiceLocked?: boolean;
  /** P2百分比伤兵余量；首次转换封存旧2/4组余量，不重算已有永久伤亡。 */
  woundedPercentRemainder?: number;
  /** 由战斗规则投影；旧快照缺省使用旧伤害模型。 */
  damageModel?: 'wounds-v1' | 'wounds-v2';
  /** Versioned reserve: V9–V10 endurance-v1; V11 endurance-v2. Costs/fatigue/recovery are shared. */
  resourceModel?: 'endurance-v1' | 'endurance-v2';
  /** V12 weapon/armor calibration, projected from the battle rules; absent keeps the frozen V11 behaviour. */
  armsModel?: import('./arms.js').ArmsModel;
  barrierModel?: 'barrier-grades-v1';
  /** V13 trait overhaul, projected from the battle rules; absent keeps the frozen V12 trait rules. */
  traitModel?: 'traits-v1';
  /** V14 skill pricing (composite states priced per stat), projected from the battle rules; absent keeps V13 skill numbers. V20 skills-v3 lowers combined-control save DCs by 1 per extra effect instead of 2. V21 skills-v4 anchors barrier, condition magnitude and morale amounts to the wound budget. */
  skillModel?: 'skills-v1' | 'skills-v2' | 'skills-v3' | 'skills-v4';
  /** V15 item system (graded specialisations, item action economy and per-piece formation use), projected from the battle rules. V20 items-v2 scales worn modifiers by item L. */
  itemModel?: 'items-v1' | 'items-v2';
  /** V16 特质分级独立门控；旧战斗缺省保持原效果。 */
  traitLevelModel?: 'traits-levels-v1' | 'traits-levels-v2' | 'traits-items-v1' | 'traits-items-v2';
  commandRangeModel?: 'graded-v1';
  healingModel?: import('./healing.js').HealingModel;
  controlModel?: 'activation-controls-v1';
  battleZones?: import('./area-effects.js').BattleZone[];
  barrier?: { remaining: number; duration: number; sourceId?: string; defenses?: { power: number; duration: number }[] };
  /** 旧版两格配件；只出现在 V15 之前开始、尚未结束的战斗快照里，新档一律用 gear。 */
  accessories?: Partial<Record<'accessory1' | 'accessory2', import('./items.js').LegacyAccessory>>;
  /** 已装备的佩戴、充能道具；与武器护甲一样是库存实物的投影，件数不限。 */
  gear?: import('./items.js').GearItem[];
  /** 已完成分级执行器的特质等级（L1–10），缺省 L5；规则门控决定是否生效。 */
  traitLevels?: Record<string, number>;
  /** 战外明确设置的初始状态；战果归档后恢复通常的出场重置规则。 */
  storyState?: { resources?: boolean; abilityState?: boolean; fatigue?: boolean };
  bonuses?: Enhancements;
  /** 当前战斗的非致命规则，由战场传入；不作为永久单位属性。 */
  nonLethal?: boolean;
  combatModel?: 'cohort-v1' | 'cohort-v2';
  /** R2 本次冲锋被拒止打断，冲锋加成全部取消；R7 本次冲锋的实际移动格数。激活结束清除。 */
  chargeInterrupted?: true;
  chargeDistance?: number;
  /** R2 本轮已触发拒止的移动者；随快照保存。 */
  denialTriggered?: { round: number; targets: string[] };
  /** R20 实体盾剩余耐久，战后清除。 */
  shieldDurability?: { remaining: number };
  /** R15 能量盾：剩余总量与本次回充前已过载的份数（英雄只有0或1）。 */
  energyShield?: { remaining: number; overloaded: number };
  /** R16 喷射武器剩余燃料（按武器 id，缺省为满）与本轮已破裂的油箱。 */
  sprayerFuel?: Record<string, number>;
  tankRupturedRound?: number;
  /** R24 能量武器连续开火计数，按武器 id。 */
  weaponHeat?: Record<string, { streak: number; fired?: boolean; cooling?: boolean }>;
  /** 本场火炮弹种，默认榴弹；不改变库存实物。 */
  cannonAmmo?: 'he' | 'ap';
  formation?: import('./combat-model.js').FormationStrength;
  /** 本场惊退来源与重整机会；归档后剥离，不刷新进行中快照。 */
  moraleState?: import('./morale.js').MoraleState;
  /** 持久可救伤兵，独立于可战人数hp；旧档缺省零，不推测历史伤亡。 */
  recoverableWounded?: number;
  /** 本场空地状态；缺省按地面读取，新的飞行单位由开战部署初始化。 */
  airborne?: boolean;
  /** Ground platform in a layered tactical field; not flight and not a permanent trait. */
  elevation?: 1;
  /** 会战中的实际阵位，供飞行越线及落地后使用；不覆盖长期部署偏好。 */
  formationPosition?: string;
  /** 仅存在于战斗快照的姿态，归档/下次部署不继承。 */
  tacticalPose?: import('./tactics.js').TacticalPose;
  /** 当前小战主行动的待结疲劳；只在战斗快照保留。 */
  tacticalEffort?: number;
  /** 本场潜伏已暴露；只有满足掩护/未接敌条件的完整休整才能清除。 */
  tacticalRevealed?: boolean;
  /** 先锋前出前的会战部署偏好，仅本场保存，归档还原。 */
  vanguardOrigin?: string;
  /** V13 工事据守的位置（小战格子或会战阵位）；离开即失效，原地完整休整后改为新位置。只在战斗快照里。 */
  entrenchedAt?: number | string;
  legacyScale?: 'mook';
  /** base已包含的永久特质属性，用于撤销/改学后的净修正；不包含装备或祝福。 */
  bakedTraitStats?: Partial<Record<'atk' | 'def' | 'spd' | 'morale', number>>;
  traitSources?: import('./trait-sources.js').TraitSource[];
  carriedItems?: import('./items.js').CarriedItem[];
  summonerId?: string;
  bornRound?: number;
  suppression?: number;
  rulesVersion?: 'v2';
  body?: BodyKind;
  /** 基础移动速度档位1–5；省略时按身体决定，实际移动仍受装备与状态影响。 */
  speedTier?: number;
  /** 明确骑乘平台；专长本身不会创建坐骑或增加人员/生命。 */
  mount?: boolean;
  shield?: { id: string; name?: string; load: number; recipe?: ItemRecipe; powerScale?: number };
  preparedAbilityIds?: string[];
  generationWarnings?: string[];
  /** 参战时持久档案版本；战后提交必须仍匹配，战内不自行递增。 */
  recordRevision?: number;
  id: string;
  name: string;
  side: Side;
  scale: Scale;
  archetype?: Archetype;
  level: number;
  /** 标签池：原型、特质授予、临时（大型/飞行/精英…） */
  tags: string[];
  /** 基础属性（造怪器产出或装备派生后的静态值） */
  base: Stats;
  hp: number;
  morale?: number;
  /** 本场由主控绑定赋予满士气锁定；不写入单位永久档案。 */
  moraleLocked?: true;
  conditions: ActiveCondition[];
  /** hero 刻度装备 */
  weapon?: Weapon;
  /** 副武器（spawn weapon2 显式声明）：支持全部武器种类，共用主行动，独立装填 */
  sidearm?: Weapon;
  armor?: Armor;
  abilities: Ability[];
  abilityState: AbilityState[];
  /** 资源池：体力/怒气/充能，键自定义 */
  resources: Record<string, number>;
  /** 拥有的特质 id 列表 */
  traits: string[];
  /** 接敌对象 id 列表（军团接敌模型） */
  engagedWith: string[];
  status: UnitStatus;
  /**
   * 一维战场坐标 0~5（小规模战斗距离模型）：两点距离 = |posA − posB|。
   * 距离带：0=接战、1=近距、2~3=中距、4+=远距；开战时按原型初始化。
   */
  pos?: number;
  /** 疲劳等级 0~4：无/轻度/中度/重度/力竭（军团管线用） */
  fatigue: number;
  /** 击败该单位可获得的经验值（造怪器按曲线填） */
  xpValue?: number;
  /** 累计成长经验；编队战功折为人均后入账，保留小数，applyXp 消费。 */
  xp?: number;
  /** 本级进度使用独立起点，累计经验不因曲线调整而改写。 */
  xpCurve?: 'effort-v1';
  xpLevelStart?: number;
  /** 造怪审计：种子与浮动记录 */
  genAudit?: GenAudit;
}

export interface GenAudit {
  variance?: import('./instance-variance.js').InstanceVariance;
  formulaVersion?: string;
  seed: string;
  /** 各属性相对基准的浮动量 */
  deltas: Record<string, number>;
  /** 武器公式生成审计：原型参数与重建后的骰子均值 */
  weapon?: {
    profileId: string;
    dmgMult: number;
    apShare: number;
    baseAvg: number;
    apAvg: number | null;
  };
  /** 人设技能生成审计：蓝图与实际威力 */
  abilities?: { blueprintId: string; power: number }[];
  /** 生成参数快照 */
  input: GenerateInput;
}

// ---------- 造怪器 ----------

export interface GenerateInput {
  numericModel?: import('./numeric-model.js').NumericModel;
  /** Omitted for historical API compatibility; the current panel explicitly selects V6. */
  damageModel?: Combatant['damageModel'];
  bonuses?: Enhancements;
  weaponStabilized?: boolean;
  sidearmStabilized?: boolean;
  armorProfile?: 'balanced' | DamageChannel;
  weaponEnchantment?: 'thermal' | 'arcane';
  sidearmEnchantment?: 'thermal' | 'arcane';
  reserves?: number;
  rulesVersion?: 'v2';
  body?: BodyKind;
  /** 基础移动速度档位1–5；省略时按身体决定，实际移动仍受装备与状态影响。 */
  speedTier?: number;
  /** 明确骑乘平台；专长本身不会创建坐骑或增加人员/生命。 */
  mount?: boolean;
  quality?: number;
  hp?: number;
  hpMax?: number;
  shield?: boolean;
  /** 盾牌名称、独立规格与修正；仅旧布尔写法省略规格时保留原默认盾。 */
  shieldName?: string;
  shieldLevel?: number;
  shieldClass?: import('./data/weapons.js').ShieldClass;
  shieldBonuses?: Enhancements;
  preparedAbilityIds?: string[];
  name: string;
  scale: Scale;
  archetype?: Archetype;
  /** 威胁等级 1~10 */
  level: number;
  traits: string[];
  /** 已完成分级的特质等级 L1–10，缺省 L5。 */
  traitLevels?: Record<string, number>;
  side: Side;
  /** 时代皮肤 id，纯术语层 */
  era?: string;
  /** 冲突方/从属，仅展示用 */
  note?: string;
  /** 武器风格：近战 / 远程（独立于原型——机动+远程=骑射手）；缺省按原型 */
  loadout?: 'melee' | 'ranged';
  /** 指定武器原型 id（data/weapons.ts），缺省按皮肤默认位；术语与数值同源 */
  weaponId?: string;
  /** 自由文本武器名（正文对应用）：覆盖显示名，数值按默认位公式生成 */
  weaponName?: string;
  /** AI 武器分类（剑/斧/长兵器/弓弩/火枪/步枪/直射火炮/曲射火炮/能量武器/法杖/钝器）：决定武器性质（破甲/射程/速射） */
  weaponClass?: string;
  /** AI 武器等级 L1~L10：决定该武器自身的强度曲线（与单位等级解耦） */
  weaponBonuses?: Enhancements;
  sidearmBonuses?: Enhancements;
  armorBonuses?: Enhancements;
  weaponLevel?: number;
  /** 副武器（spawn weapon2 驱动）：种类与主武器相同，遵守通用平台和负载规则 */
  sidearmId?: string;
  /** 副武器自由文本名（weapon2="名字:种类L等级" 的名字段） */
  sidearmName?: string;
  /** 副武器分类（决定性质，公式与主武器同源） */
  sidearmClass?: string;
  /** 副武器等级 L1~L10（缺省=单位等级） */
  sidearmLevel?: number;
  /** 指定护甲原型 id（data/armors.ts），缺省按皮肤默认位；覆盖 armorTier */
  armorId?: string;
  /** 自由文本护甲名（正文对应用）：覆盖显示名，数值按档位公式生成 */
  armorName?: string;
  /** AI 护甲等级 L1~L10：定防护品质（乘进减伤效率，L5=标准 1.0），与档位双轴正交 */
  armorLevel?: number;
  /** 附加技能模板 id（data/abilities.ts）：轨道打击/舰炮齐射/火球术……跨刻度通用 */
  abilityIds?: string[];
  /** 技能蓝图（data/ability-blueprints.ts）：字符串 id 或对象（带威力等级与自定义名），按公式生成技能。
   *  由 skills="名字:蓝图L等级" 驱动；不再做 persona 关键词自动匹配。 */
  abilityBlueprints?: Array<string | { id: string; level?: number; name?: string; instanceId?: string }>;
  /** 护甲档位覆盖（0~4）；缺省=原型基准+加权浮动 */
  armorTier?: 0 | 1 | 2 | 3 | 4;
}

export type DamageChannel = 'kinetic' | 'thermal' | 'arcane';
export type BodyKind = 'human' | 'large' | 'vehicle' | 'giant';
/** 规范化且冻结的 T/P/S/Q/F 中装备职责；训练 T 不在装备配方中。 */
export interface ItemRecipe {
  numericModel?: import('./numeric-model.js').NumericModel;
  variance?: import('./instance-variance.js').InstanceVariance;
  /** Identifies the body-strength formula baked into this physical instance. */
  balanceVersion?: 'unified-v1';
  noVariance?: boolean;
  bonuses?: Enhancements;
  /** 真实车辆武器稳定装置；不由骑射或机械化专长授予。 */
  stabilized?: boolean;
  protectionProfile?: 'balanced' | DamageChannel;
  enchantment?: 'thermal' | 'arcane';
  version: 'mechanism-v2.1' | 'mechanism-v2.2' | 'mechanism-v2.3' | 'mechanism-v2.3+autocannon-v2';
  mechanism: string;
  power: number;
  size: BodyKind;
  quality: number;
  seed: string;
}

// ---------- 战斗日志与注入 ----------

export type LogKind =
  | 'initiative'
  | 'attack'
  | 'ability'
  | 'condition'
  | 'death'
  | 'morale'
  | 'routing'
  | 'move'
  | 'round'
  | 'rule'
  | 'objective'
  | 'battle-end';

export interface BattleLogEntry {
  /** 消息与交涉须保留原话，不按战斗效果精简。 */
  communication?: boolean;
  /** 破障的实际结构变化；旧日志仍可按原有的结构耐久文本展示。 */
  structure?: { cell: number; kind: import('./small/layers.js').StructureKind; level: number; hpBefore: number; hpAfter: number; hpMax: number; destroyed: boolean };
  /** 占点状态与进度，只在实际变化时记录。 */
  objective?: { cell: number; side?: Side; contested: boolean; progress: number; required: number };
  gate?: { cell: number; state: 'open' | 'closed' };
  /** 已实际执行的道具使用；效果只记本次结算，不从道具说明或战后状态反推。 */
  itemUse?: { actorId: string; actorName: string; itemId: string; itemName: string; form: 'single' | 'charged'; consumed: number; effects: string[] };
  /** 持续伤害/坠落的实际损失与来源；普通攻击由resolution记录，不能重复累计。members是成员生命编队这次的减员数。 */
  damage?: { sourceId?: string; targetId: string; amount: number; cause: string; unit?:'life'; members?: number };
  /** 同一技能的全部伤害结算；resolution保留首条供旧展示兼容。 */
  resolutions?: AttackResolution[];
  /** 事件发生时的位置，用于本地演出；观测裁剪后不可见的事件不公开这些坐标。 */
  locations?: Record<string, number>;
  /** 逐格移动的起止格；有高低差的实际高度地图另记两端站立高度（空中不记）。战报据此合并连续移动。
   *  skill 标记技能自带的位移：before 是出手前的突进/闪现与单纯位移技能（战报并入其后的技能行，技能名先写），after 是出手后的后撤。 */
  move?: { from: number; to: number; fromHeight?: number; toHeight?: number; skill?: 'before' | 'after' };
  /** 事件涉及的单位与当时可观察阵营；旧无观测元数据日志不用于V2战内泄露事实。 */
  participants?: string[];
  observedBy?: Side[];
  observedText?: Partial<Record<Side, string>>;
  round: number;
  kind: LogKind;
  text: string;
  /** kind=rule：战中改致命规则后的新规则，此后的倒地与减员按它结算。 */
  rule?: { nonLethal: boolean };
  /** 完整结算明细（伤害管线产物），供面板悬浮与审计 */
  resolution?: AttackResolution;
  ts?: number;
}

// ---------- 规则包 ----------

export interface RulePack {
  numericModel?: import('./numeric-model.js').NumericModel;
  /** V8：训练输出每级增幅；缺省保留旧战斗的 12%。 */
  trainingDamagePerLevel?: number;
  /** V8：自动生成的单体武器/盾牌技法基础倍率；不改写技能实例。 */
  singleWeaponSkillMultiplier?: number;
  /** V7：跨代充分穿透追加毁伤；旧快照缺省关闭。 */
  overmatch?: boolean;
  /** V10 continuous; V11 soft40 attenuates low-grade extra damage. Absent keeps the V7–V9 safe band. */
  overmatchCurve?: 'continuous-v1' | 'continuous-soft40-v1';
  /** V5 单体毁伤与通道防护；缺省沿用旧战斗的规格耐久。 */
  damageModel?: 'wounds-v1' | 'wounds-v2';
  /** Versioned reserve: V9–V10 endurance-v1; V11 endurance-v2. Costs/fatigue/recovery are shared. */
  resourceModel?: 'endurance-v1' | 'endurance-v2';
  /** V12 weapon/armor calibration (crew, demolition, light armor, reach, grid ranges); absent keeps V11. */
  armsModel?: import('./arms.js').ArmsModel;
  barrierModel?: 'barrier-grades-v1';
  /** V19 统帅：指挥水平与风格只改变 AI 决策（command-v2.ts）；缺省保留 V18 及以前的指挥评分。 */
  commandModel?: 'command-v2';
  /** V24 统率范围按有效特质等级成长；旧战斗保留固定范围。 */
  commandRangeModel?: 'graded-v1';
  revivalModel?: 'revival-v1';
  /** V13 trait overhaul (工事据守、工兵、拒马、散兵单体与步枪编队自动散兵); absent keeps V12. */
  traitModel?: 'traits-v1';
  /** V14 skill pricing: 同时改两项属性的状态按两项附加效果计价; absent keeps V13. V20 skills-v3：组合控制每多一项抵抗难度 −1（原 −2）。V21 skills-v4：屏障、状态效力与士气量按单体创伤预算比例。 */
  skillModel?: 'skills-v1' | 'skills-v2' | 'skills-v3' | 'skills-v4';
  /** V15 道具系统：专精十级、道具行动与编队件数、AI 保留价值、冲锋与远程看实际配装; absent keeps V14. V20 items-v2：佩戴修正按道具 L 换算。 */
  itemModel?: 'items-v1' | 'items-v2';
  /** V16 新增特质分级；独立于 V15 五项专精。 */
  traitLevelModel?: 'traits-levels-v1' | 'traits-levels-v2' | 'traits-items-v1' | 'traits-items-v2';
  healingModel?: import('./healing.js').HealingModel;
  controlModel?: 'activation-controls-v1';
  combatModel?: 'cohort-v1' | 'cohort-v2';
  /** 武器直击余伤100%在目标编队内传递；旧规则缺省关闭。 */
  weaponOverflow?: boolean;
  resolutionVersion?: 'v2';
  id: string;
  name: string;
  /** 命中模式：d20 掷骰 vs 固定概率公式（全面战争式） */
  hitMode: 'd20' | 'tw';
  /** d20 模式：>= 防御值命中；天然暴击下限 */
  critMin: number;
  /** tw 模式参数：命中率 = clamp(base + (攻-(防-defOffset))*perDiff, min, max) */
  tw: { base: number; perDiff: number; min: number; max: number; defOffset: number };
  /** 护甲等级 → 减伤比例 */
  armorDR: [number, number, number, number, number];
  /** 同名修正是否取最高（true）或叠加（false） */
  sameNameKeepsHighest: boolean;
  /** 加成栈平加值上限（防失控） */
  maxFlat: number;
  /** 暴击规则：骰面翻倍 */
  critRule: 'doubleDice';
  /** 兵种克制矩阵：attacker原型 → 对 defender原型的攻击加值 */
  counterMatrix: Record<Archetype, Partial<Record<Archetype, number>>>;
  /** 士气检定公式参数（军团） */
  morale: { dieMax: number; baseDC: number; breakAt: number };
  /** 重伤阈值：单击伤害 ≥ maxHP×该比例 → 挂「重伤」状态（小规模）；缺省 0.4 */
  injuryThreshold?: number;
  /** 远程武器用于近身攻击（借机/被贴身挥击/军团近战阶段）的攻击惩罚；缺省 0=无 */
  rangedMeleePenalty?: number;
}
