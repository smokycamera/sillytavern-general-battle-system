import type { Combatant, Trait } from '../../engine/src/types.js';
import { displayNumber as n } from '../../engine/src/display-number.js';
import { progression, stackingRevision } from '../../engine/src/progression.js';
import { traitParameter, type TraitParameter } from '../../engine/src/trait-parameters.js';
import {
  commandRangeAtLevel, roughGroundCost, climbFactor, forestDefense, forestAttack, highGroundDefense, highGroundAttack, terrainStalk,
  nightAttack, nightMovePenalty, nightDefense, nightSight, plainsInitiative, plainsMobility, plainsAttack,
  plainsChargeAttack, plainsDefense, urbanDefense, urbanAttack, urbanMeleeAttack, urbanCloseShotAttack, urbanInitiative, urbanStalk,
} from '../../engine/src/trait-levels.js';

/** 玩家说明只列用途与数值；参数仍读取当前单位使用的规则。 */
export function playerTraitLevelDescription(id: string, level: number, model?: unknown, commandRangeModel?: Combatant['commandRangeModel']): string {
  const L = Math.max(1, Math.min(10, Math.round(level)));
  const modern = progression({ traitLevelModel: model }), revised = stackingRevision({ traitLevelModel: model });
  const p = (key: TraitParameter) => traitParameter(key, L, model);
  const value = (key: TraitParameter) => n(p(key));
  const pct = (key: TraitParameter) => n(p(key) * 100);
  const parts: string[] = [];
  const add = (when: boolean, text: string) => { if (when) parts.push(text); };
  const environment = ({ 'forest-lore': '森林', 'mountain-born': '山地', 'night-fighter': '夜间', 'plains-runner': '平原', 'urban-fighter': '巷战' } as Record<string, string>)[id];
  add(modern && !!environment, `${environment}武器与物理伤害×${value('meleeDamage')}`);
  switch (id) {
    case 'forest-lore':
      parts.push('无森林攻击惩罚');
      add(L >= 2, `森林移动每格${n(roughGroundCost(L))}点`);
      add(L >= 5, '会战林地自由行军');
      add(forestDefense(L) > 0, `森林防御+${forestDefense(L)}`); add(forestAttack(L) > 0, `森林攻击+${forestAttack(L)}`);
      add(terrainStalk(L), '森林中潜伏'); break;
    case 'mountain-born':
      parts.push('无丘陵攻击惩罚');
      add(L >= 2 && L < 5, `丘陵移动每格${n(roughGroundCost(L))}点，爬坡消耗×${n(climbFactor(L))}`);
      add(L >= 5, '无丘陵、爬坡额外消耗，会战山地自由行军');
      add(highGroundDefense(L) > 0, `居高防御+${highGroundDefense(L)}`); add(highGroundAttack(L) > 0, `居高攻击+${highGroundAttack(L)}`);
      add(terrainStalk(L), '山地、丘陵中潜伏'); break;
    case 'night-fighter':
      if (nightAttack(L) === 0 && !nightMovePenalty(L)) parts.push('无夜间攻击、移动惩罚');
      else { parts.push(`夜间攻击${nightAttack(L) >= 0 ? '+' : '−'}${Math.abs(nightAttack(L))}`); parts.push(nightMovePenalty(L) ? '夜间移动−1' : '无夜间移动惩罚'); }
      parts.push(`${nightSight(L, 'small')}格夜间视野（会战${nightSight(L, 'mass')}阵位）`);
      add(nightDefense(L) > 0, `夜间防御+${nightDefense(L)}`); break;
    case 'plains-runner':
      parts.push(`平原先攻+${plainsInitiative(L)}`); add(plainsMobility(L) > 0, `机动+${plainsMobility(L)}`);
      add(plainsAttack(L) > 0, `攻击+${plainsAttack(L)}`); add(plainsChargeAttack(L) > plainsAttack(L), `冲锋攻击+${plainsChargeAttack(L)}`);
      add(plainsDefense(L) > 0, `防御+${plainsDefense(L)}`); break;
    case 'urban-fighter':
      parts.push(`巷战防御+${urbanDefense(L)}`); add(urbanAttack(L) > 0, `攻击+${urbanAttack(L)}`);
      add(urbanMeleeAttack(L) > urbanAttack(L), `近战攻击+${urbanMeleeAttack(L)}`); add(urbanCloseShotAttack(L) > urbanAttack(L), `2格内射击攻击+${urbanCloseShotAttack(L)}`);
      add(urbanInitiative(L) > 0, `先攻+${urbanInitiative(L)}`); add(urbanStalk(L), '街道、建筑中潜伏'); break;
    case 'berserk':
      parts.push(`${modern || L >= 3 && L !== 4 ? '攻击' : L === 1 ? '近战攻击' : '武器攻击'}+${value('berserkAttack')}`);
      add(!modern && L === 4, '独立魔法攻击+1'); add(p('berserkDamage') !== 1, `伤害×${value('berserkDamage')}`); parts.push('防御−1'); break;
    case 'melee-master': return `近战攻击+${value('meleeAttack')}，近战武器与物理伤害×${value('meleeDamage')}`;
    case 'sharpshooter':
      if (modern) return `射击攻击+${value('meleeAttack')}，射击伤害×${value('meleeDamage')}` + (p('sharpshooterCover') ? `，忽略${value('sharpshooterCover')}点掩护` : '');
      return L === 1 ? '静止且半射程内射击攻击+1' : L === 2 ? '半射程内射击攻击+1' : L === 3 ? '射击攻击+1' : L === 4 ? '静止射击攻击+2，移动后+1' : `射击攻击+${L >= 9 ? 4 : L >= 7 ? 3 : 2}${L >= 6 ? `，忽略${L >= 8 ? 2 : 1}点掩护` : ''}${L === 10 ? '，移动射击惩罚减轻1' : ''}`;
    case 'charge-strong': return `${!modern && L === 1 ? '直线冲锋攻击+1' : !modern && L === 3 ? '直线冲锋攻击+2，其他冲锋攻击+1' : `冲锋攻击+${value('chargeAttack')}`}，冲锋伤害×${value('chargeDamage')}`;
    case 'sneak-attack': return `潜伏出手或夹击时，武器与物理伤害×${value('sneakMultiplier')}`;
    case 'trample': return `近战冲锋较小体型目标时，伤害×${value('trampleMultiplier')}`;
    case 'anti-infantry': return `对未骑乘人形攻击+${value('counterAttack')}，伤害×${value('counterMultiplier')}`;
    case 'anti-large': return `对大型、巨型、载具及骑乘目标攻击+${value('counterAttack')}，伤害×${value('counterMultiplier')}`;
    case 'anti-air': return `对空攻击+${value('counterAttack')}，伤害×${value('counterMultiplier')}，对空额外射程消耗${value('antiAirRangeSmall')}格（会战${value('antiAirRangeMass')}阵位）`;
    case 'ap-weapon': return `动能穿透+${value('penetrationBudget')}`;
    case 'guardian': return `全伤害减免${pct('guardianReduction')}%，防御规格L${L}`;
    case 'kinetic-resist': case 'thermal-resist': case 'arcane-resist': {
      const channel = id === 'kinetic-resist' ? '动能' : id === 'thermal-resist' ? '热能' : '奥术';
      return revised ? `${channel}伤害减免${pct('channelResistance')}%` : modern ? `${channel}抗穿+${value('channelResistance')}` : `${channel}防护+${n(2 * p('woundRatio'))}`;
    }
    case 'lifesteal': return `造成生命伤害后，恢复${pct('lifestealRatio')}%伤害量的生命或伤兵` + (revised ? `，每轮最多恢复${pct('lifestealRoundCap')}%生命` : '');
    case 'regen': return `每轮基础恢复${n(modern ? p('regenAmount') : 3 * p('woundRatio'))}生命或伤兵`;
    case 'medic': return `治疗量×${value('medicHealing')}，编队伤亡中${value('medicRescue')}%可救治`;
    case 'poison-strike': return `动能攻击造成伤害后附毒3轮，毒伤×${value(modern ? 'poisonMultiplier' : 'woundRatio')}，中毒者攻击−1`;
    case 'fatigue-trained': return `疲劳获得×${value('fatigueMultiplier')}`;
    case 'shield-wall': return `持盾固守时，正面远程伤害减免${pct('shieldReduction')}%`;
    case 'fortification': return `据守时防御+${value('worksDefense')}，远程伤害减免${pct('worksReduction')}%`;
    case 'pike-wall': return `对骑乘及机动目标攻击+${value('counterAttack')}，伤害×${value('counterMultiplier')}，固守时正面冲锋伤害减免${pct(modern ? 'pikeReduction' : 'formationReduction')}%`;
    case 'loose-formation': return `疏散且未被近敌牵制时，范围伤害减免${pct('formationReduction')}%，编队近战展开减半、防御−1`;
    case 'skirmisher': return `轻中装先攻+${value('skirmishInitiative')}，机动+${value('skirmishMobility')}，脱离近敌时远程伤害减免${pct('skirmishReduction')}%`;
    case 'tenacity': return `控制抵抗+${value('controlResistance')}，${L >= 5 ? '免疫击退、拉拽' : `抵挡强度${value('pushLimit')}以内的击退、拉拽`}`;
    case 'agile': return `困难地形额外移动消耗减少${n(100 - p('agileTerrain') * 100)}%，${L >= 5 ? '脱离近战免借机攻击' : `借机伤害减免${pct('agileReactionReduction')}%`}` + (p('agileInitiative') ? `，先攻+${value('agileInitiative')}` : '') + (p('agileMobility') ? `，机动+${value('agileMobility')}` : '');
    case 'siege-breaker': return `对建筑、城墙等结构伤害×${value('engineerDamage')}，削弱目标工事防御与远程减伤${pct('engineerSuppression')}%`;
    case 'stubborn': return `士气韧性+${value('resilience')}`;
    case 'commander': return `${commandRangeAtLevel(L, 'small', commandRangeModel)}格内友军士气支援+${value('command')}（会战${commandRangeAtLevel(L, 'mass', commandRangeModel)}阵位）`;
    case 'fear': return `3格内敌军承受${value('fearPressure')}点恐惧压力，攻击最多−2（会战1阵位）` + (L >= 8 ? `，士气≤50时可惊退敌人，难度${12 + 2 * (L - 8)}` : '');
    case 'stalk': return '潜伏行动，在掩护或夜间休整可重新潜伏';
    case 'recon': return `识破潜伏，为曲射火力校射+${value('reconSpotting')}`;
  }
  return parts.join('，');
}

const EFFECTS: Record<string, string> = {
  versatile: '贴身射击无命中惩罚', 'natural-armor': '免除护甲负重与机动惩罚',
  indomitable: '个体每战一次以1生命挺过致命伤；编队每战一次溃逃时重整',
  inorganic: '免疫中毒、流血、惊惧和士气崩溃', steadfast: '免疫恐惧、惊惧的心理惩罚和士气崩溃',
  'mounted-archer': '骑乘时移动射击无命中惩罚，向后脱离免借机攻击，会战可后撤射击',
  vanguard: '开局向前部署1排或1阵位', flying: '升空飞行，越过地面障碍；落地后可近战扑击',
  mechanized: '先攻+2，机动+1，穿着护甲时防御+1', 'water-crossing': '可进入深水，降低涉水移动消耗',
  'siege-assault': '消耗主行动及最多2移动点，攀登相邻墙顶并接战',
  veteran: '攻击+1，防御+1，士气+10', elite: '攻击+2，防御+2', fast: '先攻+3，机动+1',
  'heavy-armor': '先攻−1', 'super-heavy': '先攻−2', large: '大型身体，占格2，动能防护至少1', titan: '巨型身体，独占1格，基础移动2，动能防护至少2、热能防护至少1',
  'guardian-greater': '全伤害减免40%', 'ap-master': '动能穿透最多+2', 'monster-hunter': '对大型目标攻击+3，伤害×1.4',
  terror: '附近敌军承受15点恐惧压力，攻击最多−2，士气≤50时可惊退',
  'armor-piercing-shot': '动能射击穿透最多+1', 'anti-mobile': '对骑乘、载具及机动目标攻击+2，伤害×1.25',
};
export function playerTraitDescription(trait: Trait): string {
  return EFFECTS[trait.id] ?? trait.desc;
}
