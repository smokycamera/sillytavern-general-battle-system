/**
 * 特质库（全面战争机制转译，机制中立、全时代通用）。
 * 每个特质 = 数据包：内在修正 / 条件克制 / 行为旗标 / 授予标签。
 * 新执行机制须补齐执行器与验证，不能只添加名字或数据项。
 */

import type { Trait } from '../types.js';

export const TRAITS: Trait[] = [
  // ---------- 反制类 ----------
  {
    id: 'ap-weapon', name: '破甲', desc: '普通段伤害的 50% 转为破甲段，无视护甲减伤',
    v2SourceReady: true,
    v2Desc: '动能武器利用弱点提高穿透，最多+1且不超过原穿透的三分之一；穿透不足仍可零伤害',
    effects: [{ kind: 'apShare', percent: 50 }],
  },
  {
    id: 'ap-master', name: '破甲大师', desc: '普通段伤害的 80% 转为破甲段',
    v2SourceReady: true,
    v2Desc: '动能弱点利用最多提高穿透2，受原武器三分之一上限；与破甲/穿甲箭取较强项',
    effects: [{ kind: 'apShare', percent: 80 }],
  },
  {
    id: 'anti-infantry', name: '克制步兵', desc: '对步兵目标攻击 +2、伤害 ×1.25',
    v2SourceReady: true,
    v2Desc: '对地面未骑乘的人形目标攻击+2、伤害×1.25；远程步兵仍按实际身体识别，车辆、骑乘、空中和大型身体不算步兵，不按默认原型误判',
    effects: [
      { kind: 'conditionalAtk', vsTag: 'infantry', value: 2 },
      { kind: 'conditionalDmgMult', vsTag: 'infantry', mult: 1.25 },
    ],
  },
  {
    id: 'anti-large', name: '克制大型', desc: '对大型目标攻击 +2、伤害 ×1.25',
    v2SourceReady: true,
    v2Desc: '针对实际大型/巨型/载具或骑乘目标：攻击+2、伤害×1.25；与屠兽者取较强项',
    effects: [
      { kind: 'conditionalAtk', vsTag: 'large', value: 2 },
      { kind: 'conditionalDmgMult', vsTag: 'large', mult: 1.25 },
    ],
  },
  {
    id: 'anti-mobile', name: '克制机动', desc: '对机动目标攻击 +2、伤害 ×1.25（枪阵类）',
    v2SourceReady: true,
    v2Desc: '实际长柄近战武器对明确骑乘、车辆或机动原型攻击+2、伤害×1.25；仍须穿透实际防护，不自动授予武器',
    grantsTags: ['spear'],
    effects: [
      { kind: 'conditionalAtk', vsTag: 'mobile', value: 2 },
      { kind: 'conditionalDmgMult', vsTag: 'mobile', mult: 1.25 },
    ],
  },
  {
    id: 'pike-wall', name: '拒马', desc: '受到冲锋攻击时伤害减半',
    v2SourceReady: true,
    v2Desc: '实际长柄武器配合固守姿态，对正面近战冲锋伤害减半；移动、侧后袭或失能使其失效',
    grantsTags: ['spear'],
    effects: [{ kind: 'counterChargeDR', percent: 50 }],
  },
  // ---------- 防御类 ----------
  {
    id: 'heavy-armor', name: '重甲', desc: '护甲等级 +1，速度 -1',
    v2SourceReady: true,
    v2Desc: '装备重甲自动体现负担：先攻降低1，不提供额外防御。与手动或外部来源不重复计入，与超重装甲取较重代价；换成轻中甲或卸甲即撤销。实际护甲仍提供通道防护、等效耐久及既有机动代价',
    effects: [{ kind: 'armorTier', value: 1 }, { kind: 'stat', stat: 'spd', value: -1 }],
  },
  {
    id: 'super-heavy', name: '超重装甲', desc: '护甲等级 +2，速度 -2',
    v2SourceReady: true,
    v2Desc: '装备超重甲自动体现负担：先攻降低2，不提供额外防御。与手动或外部来源不重复计入，与重甲取较重代价；卸下或更换构型即撤销。实际护甲仍提供通道防护、等效耐久及既有机动代价',
    effects: [{ kind: 'armorTier', value: 2 }, { kind: 'stat', stat: 'spd', value: -2 }],
  },
  {
    id: 'shield-wall', name: '盾墙', desc: '受到远程攻击时伤害 -40%',
    v2SourceReady: true,
    v2Desc: '实际盾牌配合固守姿态，对正面远程生命伤害降低40%；移动、侧后袭、卸盾或失能使其失效',
    effects: [{ kind: 'rangedGuardDR', percent: 40 }],
  },
  {
    id: 'guardian', name: '守护', desc: '受到的全伤害 -25%（不可被破甲绕过）',
    v2SourceReady: true,
    v2Desc: '合法生命伤害降低25%；同源/同组守护取强，不重复相乘；不减免士气或控制',
    effects: [{ kind: 'ward', percent: 25 }],
  },
  {
    id: 'guardian-greater', name: '大守护', desc: '受到的全伤害 -40%',
    v2SourceReady: true,
    v2Desc: '合法生命伤害降低40%；与守护及同组重复来源取强，不无限叠加',
    effects: [{ kind: 'ward', percent: 40 }],
  },
  {
    id: 'regen', name: '再生', desc: '每回合结束回复 3 点 HP',
    v2SourceReady: true,
    v2Desc: '小战激活末或会战重整末最多恢复3生命或3名可救伤兵；失能、濒死和离场暂停，编队只消耗已记账伤兵，不能补回永久伤亡，多来源取强',
    effects: [{ kind: 'regen', perRound: 3 }],
  },
  // ---------- 攻击与士气类 ----------
  {
    id: 'berserk', name: '狂暴', desc: '攻击 +2，防御 -1',
    v2SourceReady: true,
    effects: [{ kind: 'stat', stat: 'atk', value: 2 }, { kind: 'stat', stat: 'def', value: -1 }],
  },
  {
    id: 'poison-strike', name: '毒击', desc: '命中时使目标中毒 3 回合',
    v2SourceReady: true,
    v2Desc: '适用动能接触武器或轻型投射/弓弩造成实际损伤后中毒3轮；每种毒性一份且重复命中不续期。中毒攻击降低1，生物体型降低毒伤，封闭车辆免疫；热能、奥术与重炮不能借此涂毒，持续伤亡由引擎记账',
    effects: [{ kind: 'onHitCondition', conditionId: 'poisoned', dur: 3 }],
  },
  {
    id: 'trample', name: '践踏', desc: '旧规则对指定轻型编队伤害 ×2',
    v2SourceReady: true,
    v2Desc: '以实际较大身体完成合法近战冲锋时，冲击伤害×1.25；普通攻击、同等或更大体型不受此影响，展开与行动上限照常',
    effects: [{ kind: 'conditionalDmgMult', vsTag: 'mook', mult: 2 }],
  },
  {
    id: 'fear', name: '恐惧', desc: '在场时敌方全员士气 -8',
    v2SourceReady: true,
    v2Desc: '小战3格或会战1阵位内、可见且未失能的来源对敌方施加8点士气压力及至多1点攻击惩罚；同类恐惧取强，附近统率和个人士气韧性可抵消，隐藏或离场立即失效',
    grantsTags: ['fear'],
    effects: [{ kind: 'moraleAura', value: -8, scope: 'enemySide' }],
  },
  {
    id: 'terror', name: '恐怖', desc: '在场时敌方全员士气 -15',
    v2SourceReady: true,
    v2Desc: '近域可见恐怖施加15点士气压力及至多2点攻击惩罚，同恐惧取强；有效士气不高于50时检定惊退，每个本体来源每战最多触发一次；下次激活或整轮才可重整，每次溃退最多三次机会，第三次溃退彻底离场',
    grantsTags: ['fear'],
    effects: [{ kind: 'moraleAura', value: -15, scope: 'enemySide' }],
  },
  {
    id: 'steadfast', name: '不溃', desc: '士气免疫，永不溃逃',
    v2SourceReady: true,
    v2Desc: '抵抗恐惧光环及惊惧状态的心理惩罚，免士气崩溃；仍可受伤、阵亡、主动撤离及眩晕等非士气控制',
    effects: [{ kind: 'immuneMorale' }],
  },
  {
    id: 'stubborn', name: '顽固', desc: '士气 +15',
    v2SourceReady: true,
    v2Desc: '编队士气提高15且只计入一次；个体以同等韧性参与心理对抗与重整检定，个人士气专长抵消近域恐惧的攻击惩罚，不给全队复制能力',
    effects: [{ kind: 'stat', stat: 'morale', value: 15 }],
  },
  {
    id: 'commander', name: '统率', desc: '在场时己方全员士气 +10',
    v2SourceReady: true,
    v2Desc: '小战3格或会战1阵位内友军获得10点士气支援并抵消恐惧压力，多位指挥同组取强；需要通畅视线和可行动来源，随队使用宿主位置，离场失效；提高附近友军的重整机会，成功重整后恢复指挥资格',
    effects: [{ kind: 'moraleAura', value: 10, scope: 'side' }],
  },
  // ---------- 机动与部署类 ----------
  {
    id: 'charge-strong', name: '冲锋强化', desc: '冲锋攻击 +3',
    v2SourceReady: true,
    v2Desc: '沿合法路径接近后冲锋攻击提高3；小战支付移动和主行动，会战真实前出一阵位并用本轮主任务；相邻、受阻、疲劳、定身或压制时不能冲锋',
    effects: [{ kind: 'chargeBonus', value: 3 }],
  },
  {
    id: 'skirmisher', name: '游击', desc: '速度 +2，受到远程攻击伤害 -25%',
    v2SourceReady: true,
    v2Desc: '轻中装人形/大型单位先攻提高2、机动提高1；未受相邻敌人牵制时，远程伤害降低25%；不免借机反应',
    effects: [{ kind: 'stat', stat: 'spd', value: 2 }, { kind: 'rangedGuardDR', percent: 25 }],
  },
  {
    id: 'mounted-archer', name: '骑射', desc: '马背射击：移动后射击不受惩罚，后撤不引发借机攻击',
    v2SourceReady: true,
    v2Desc: '需要明确坐骑和轻便射击武器，车辆不能套用骑射；小战移动射击不减命中，向己方后方脱离不触发近战借机，仍受警戒；会战在合法后方空位自动后撤射击，共用一个主任务。压制、减速、定身与空中状态不能借此脱离，不凭特质生成坐骑',
    grantsTags: ['mounted', 'ranged-capable'],
    effects: [{ kind: 'flag', flag: 'mounted-archer' }],
  },
  {
    id: 'armor-piercing-shot', name: '穿甲箭', desc: '射击类攻击普通段伤害的 35% 转为破甲段（无视护甲）',
    v2SourceReady: true,
    v2Desc: '真实动能投射最多提高穿透1，受原穿透三分之一上限；与破甲专长取强，近战不生效',
    grantsTags: ['ranged-capable'],
    effects: [{ kind: 'apShare', percent: 35 }],
  },
  {
    id: 'vanguard', name: '先锋部署', desc: '开战时可部署于侧翼',
    v2SourceReady: true,
    v2Desc: '小战可前出1排，狭窄地图只占己方先遣侧翼；会战在己方前移1层，已在中军前线则先遣至空闲侧翼。系统选择合法空位，不消耗首轮行动；不越过敌方部署区，随队个人不带宿主免费前出',
    effects: [{ kind: 'flag', flag: 'vanguard' }],
  },
  {
    id: 'stalk', name: '潜伏', desc: '部署时隐匿，接敌前不被发现',
    v2SourceReady: true,
    v2Desc: '小战2格内或会战相邻阵位可被侦察；贴身接敌、攻击或施法暴露，失败命中也暴露。在掩护或夜间且脱离近敌后完整休整，可自动重新潜伏；随队不能把专长复制给宿主',
    effects: [{ kind: 'flag', flag: 'stalk' }],
  },
  {
    id: 'fast', name: '快速', desc: '速度 +3',
    v2SourceReady: true,
    v2Desc: '先攻速度提高3、实际移动点提高1；轻装会战编队可一次纵深调动两阵位，受疲劳和路径容量限制',
    effects: [{ kind: 'stat', stat: 'spd', value: 3 }],
  },
  // ---------- 环境与规模类 ----------
  {
    id: 'forest-lore', name: '林间行者', desc: '森林地形无惩罚',
    v2SourceReady: true,
    v2Desc: '免除森林的额外移动代价和行动惩罚；会战保留正常纵深机动，不绕过墙体、人数展开或阵位容量',
    effects: [{ kind: 'flag', flag: 'terrain-forest' }],
  },
  {
    id: 'mountain-born', name: '山地子民', desc: '山地地形无惩罚',
    v2SourceReady: true,
    v2Desc: '免除山地的额外移动代价和行动惩罚；会战保留正常纵深机动，不绕过硬障碍或阵位容量',
    effects: [{ kind: 'flag', flag: 'terrain-mountain' }],
  },
  {
    id: 'night-fighter', name: '夜战', desc: '夜战无惩罚',
    v2SourceReady: true,
    v2Desc: '夜间观测由小战3格延至6格、会战2阵位延至4阵位，免夜间攻击和移动惩罚；不能穿墙，随队者按宿主位置观察',
    effects: [{ kind: 'flag', flag: 'night' }],
  },
  {
    id: 'large', name: '大型', desc: '体格庞大：HP +10，被克制大型针对',
    v2Desc: '由实际大型身体自动提供：默认个体生命与负载/近战规格按身体生成，动能结构防护至少1，二维占格2并被反大型针对；巨型身体包含大型性质，结构与护甲同通道取强，不重复加生命或扩编',
    grantsTags: ['large'],
    effects: [{ kind: 'stat', stat: 'hpMax', value: 10 }],
  },
  {
    id: 'flying', name: '飞行', desc: '可越过战线接敌，仅受远程与飞行单位攻击',
    v2SourceReady: true,
    v2Desc: '开局升空，越过地面障碍与战线，但不控制地面目标；近战扑击须先落地，起落按战场支付移动或主任务及疲劳。失能或来源失效会迫降；大型飞行平台可承载随队人物，个人飞行不授予宿主',
    grantsTags: ['flying'],
    effects: [{ kind: 'flag', flag: 'flying' }],
  },
  {
    id: 'loose-formation', name: '散兵', desc: '受到范围伤害减半',
    v2SourceReady: true,
    v2Desc: '轻中装地面多人编队自动疏散，未被近敌牵制时范围伤害减半；代价是近战展开减半且近战防御降低1。固守收拢、重装、骑乘、空中、重型平台、失能或被压制时不能疏散；同来源不叠加',
    grantsTags: ['loose'],
    effects: [{ kind: 'flag', flag: 'aoeResist', value: 0.5 }],
  },
  // ---------- 精英类 ----------
  {
    id: 'veteran', name: '老练', desc: '攻击/防御 +1，士气 +10',
    v2SourceReady: true,
    effects: [
      { kind: 'stat', stat: 'atk', value: 1 },
      { kind: 'stat', stat: 'def', value: 1 },
      { kind: 'stat', stat: 'morale', value: 10 },
    ],
  },
  {
    id: 'elite', name: '精锐', desc: '攻击/防御 +2，HP +8',
    v2SourceReady: true,
    v2Desc: '攻击和防御提高2，来源不重复叠加；初建个体使用自动生命时含8点精锐体能，显式生命上限为最终值。编队人数与任何已建档生命不因授予、撤销或重开改变，训练升级只应用既定成长差值',
    grantsTags: ['elite'],
    effects: [
      { kind: 'stat', stat: 'atk', value: 2 },
      { kind: 'stat', stat: 'def', value: 2 },
      { kind: 'stat', stat: 'hpMax', value: 8 },
    ],
  },
  {
    id: 'fatigue-trained', name: '耐力训练', desc: '疲劳积累减半',
    v2SourceReady: true,
    v2Desc: '进攻、施法、长距离移动等实际疲劳积累减半，休整仍正常恢复；不免疫疲劳惩罚',
    effects: [{ kind: 'flag', flag: 'fatigue-resist', value: 0.5 }],
  },
  // ---------- 战场环境类 ----------
  {
    id: 'urban-fighter', name: '巷战大师', desc: '巷战（urban）：攻击 +1、防御 +2——废墟与街垒是他们的主场',
    v2SourceReady: true,
    effects: [{ kind: 'fieldMod', field: 'urban', atk: 1, def: 2 }],
  },
  {
    id: 'siege-breaker', name: '攻城工兵', desc: '攻城战（siege）：攻击 +2——破门锤与坑道作业的行家',
    v2SourceReady: true,
    effects: [{ kind: 'fieldMod', field: 'siege', atk: 2 }],
  },
  {
    id: 'fortification', name: '守城工事', desc: '攻城战（siege）：防御 +3，受到射击伤害 -30%——城墙与箭塔掩护',
    v2SourceReady: true,
    v2Desc: '攻城环境下固守正面时，防御提高到3且远程伤害降低30%；移动、侧后袭、失能或野战不生效，与普通固守取强',
    effects: [
      { kind: 'fieldMod', field: 'siege', def: 3 },
      { kind: 'rangedGuardDR', percent: 30 },
    ],
  },
  {
    id: 'plains-runner', name: '原野游骑', desc: '野战（plains）：速度 +2、攻击 +1——开阔地机动为王',
    v2SourceReady: true,
    v2Desc: '野战环境下攻击提高1、先攻速度提高2、机动预算提高1；非野战不生效，困难地形成本照常',
    effects: [
      { kind: 'fieldMod', field: 'plains', atk: 1 },
      { kind: 'flag', flag: 'plains-spd', value: 2 },
    ],
  },
  // ---------- 角色风格类 ----------
  {
    id: 'melee-master', name: '近战特化', desc: '近身攻击 +2、近战伤害 ×1.15——贴脸即是处刑',
    v2SourceReady: true,
    effects: [
      { kind: 'attackStyle', style: 'melee', atk: 2 },
      { kind: 'attackStyle', style: 'melee', dmgMult: 1.15 },
    ],
  },
  {
    id: 'sharpshooter', name: '射击专家', desc: '射击攻击 +2——八百米外一枪一个',
    v2SourceReady: true,
    effects: [{ kind: 'attackStyle', style: 'ranged', atk: 2 }],
  },
  {
    id: 'versatile', name: '远近双全', desc: '远程武器近身挥击不受「武器不善近战」惩罚——枪上刺刀，弓抡弓杆',
    v2SourceReady: true,
    v2Desc: '减免实际武器允许的抵近射击惩罚；不能绕过长弓贴身禁射、最小射程、装填或行动预算，近战与冲锋仍需要真实近战武器',
    effects: [{ kind: 'flag', flag: 'no-melee-penalty' }],
  },
  {
    id: 'mechanized', name: '机械化', desc: '载具输送：速度 +2、护甲 +1 档——步兵战车里的步兵',
    v2SourceReady: true,
    v2Desc: '实际车辆的操作/机动专长：先攻提高2、机动提高1，装有护甲的车体防御提高1；没有车辆不生效，不能凭特质创造车体或装甲。重型火力/装甲降低基础机动，行进稳定仍由真实武器装置决定；随队人物不向宿主复制专长',
    effects: [
      { kind: 'stat', stat: 'spd', value: 2 },
      { kind: 'armorTier', value: 1 },
    ],
  },
  // ---------- 巨兽类（large=巨兽本体，anti-large/monster-hunter=反巨兽） ----------
  {
    id: 'titan', name: '泰坦巨兽', desc: '如山移动：HP +25、护甲 +1 档，被克制大型针对',
    v2Desc: '由实际巨型身体自动提供：默认个体生命按巨型结构、近战规格和负载生成，结构防护至少动能2/热能1，基础移动2、二维独占一格并被反大型针对；与护甲取强，不再额外叠生命或护甲档，无法凭名称免伤',
    grantsTags: ['large', 'titan'],
    effects: [
      { kind: 'stat', stat: 'hpMax', value: 25 },
      { kind: 'armorTier', value: 1 },
    ],
  },
  {
    id: 'monster-hunter', name: '屠兽者', desc: '对大型目标攻击 +3、伤害 ×1.4——巨兽猎人的传承',
    v2SourceReady: true,
    v2Desc: '针对实际大型/巨型/载具或骑乘目标：攻击+3、伤害×1.4；与克制大型取强',
    effects: [
      { kind: 'conditionalAtk', vsTag: 'large', value: 3 },
      { kind: 'conditionalDmgMult', vsTag: 'large', mult: 1.4 },
    ],
  },
];

export function traitRegistry(): Map<string, Trait> {
  return new Map(TRAITS.map((t) => [t.id, t]));
}

/** 只读兼容旧称；目录与对正文输出统一使用无标点名称。 */
export function resolveTraitId(value: string, registry = traitRegistry()): string | undefined {
  const name = value.trim();
  const aliases: Record<string, string> = { '狂战士': 'berserk', '狂怒': 'berserk', '克制·步兵': 'anti-infantry', '克制·大型': 'anti-large', '克制·机动': 'anti-mobile' };
  return registry.has(name) ? name : [...registry.values()].find((t) => t.name === name)?.id ?? (registry.has(aliases[name] ?? '') ? aliases[name] : undefined);
}
