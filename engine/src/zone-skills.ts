import { compileGenericSkill } from './gen/generic-skills.js';
import type { Ability, EffectOp, Combatant } from './types.js';
import { bonusMultiplier, bonusRating, bonusSteps, bonusPoints } from './enhancements.js';
import { standardConditionMap } from './conditions.js';
import { traitRegistry } from './data/traits.js';
import { parseDice } from './dice.js';
import { validDefensePower } from './barrier.js';

type ZoneEffect = Extract<EffectOp, { op: 'zone' }>;
type ZoneStrength = Pick<ZoneEffect, 'power' | 'amount' | 'penetration'>;
export const zoneAmount = (zone: ZoneStrength): number => zone.amount ?? 4 + zone.power * 3;
export const zonePenetration = (zone: ZoneStrength): number => zone.penetration ?? 2 * zone.power;
export function validateZoneStrength(zone: { amount?: unknown; penetration?: unknown; effects?: unknown }): void {
  if (zone.amount !== undefined && (!Number.isSafeInteger(zone.amount) || Number(zone.amount) < 1 || Number(zone.amount) > 1e6)
    || zone.penetration !== undefined && (typeof zone.penetration !== 'number' || !Number.isFinite(zone.penetration) || zone.penetration < 0)) throw Error('持续区域的强度参数损坏');
  if (zone.effects !== undefined && (!Array.isArray(zone.effects) || zone.effects.some(e => !e || typeof e !== 'object'
    || !['condition','trait','heal','barrier','dispel','resource','morale','push'].includes(e.op)))) throw Error('持续区域的附加效果损坏');
  const integer=(v:unknown,min:number,max:number)=>Number.isSafeInteger(v)&&Number(v)>=min&&Number(v)<=max;
  for(const e of (zone.effects??[]) as Exclude<EffectOp,{op:'zone'|'damage'|'summon'}>[]) {
    if ('defensePower' in e && e.defensePower !== undefined && (!validDefensePower(e.defensePower) || e.op === 'condition' && e.conditionId !== 'blessed')) throw Error('持续区域的防御规格损坏');
    if ('dur' in e && !integer(e.dur,1,99) || 'onHit' in e && e.onHit!==undefined && typeof e.onHit!=='boolean'
      || 'onDamage' in e && e.onDamage!==undefined && typeof e.onDamage!=='boolean') throw Error('持续区域的附加效果时间或前提损坏');
    if(e.op==='condition' && (!standardConditionMap().has(e.conditionId) || e.saveDC!==undefined&&!integer(e.saveDC,1,30)
      || e.potency!==undefined&&!integer(e.potency,1,3) || e.magnitude!==undefined&&(!Number.isFinite(e.magnitude)||e.magnitude<.25||e.magnitude>1.5))) throw Error('持续区域的附加状态损坏');
    if(e.op==='trait'&&!traitRegistry().get(e.traitId)?.v2SourceReady)throw Error('持续区域的特质损坏');
    if(e.op==='barrier'&&!integer(e.amount,1,1e6))throw Error('持续区域的屏障损坏');
    if(e.op==='heal') { if(e.amount!==undefined) { if(!integer(e.amount,1,1e6)||e.dice!==undefined)throw Error('持续区域的治疗量损坏'); } else parseDice(e.dice); }
    if(e.op==='resource'&&(!e.resource||typeof e.resource!=='string'||!Number.isFinite(e.amount)||e.maximum!==undefined&&e.maximum!=='training'))throw Error('持续区域的资源效果损坏');
    if(e.op==='morale'&&!Number.isFinite(e.amount))throw Error('持续区域的士气效果损坏');
    if(e.op==='dispel'&&(!['positive','negative'].includes(e.polarity)||![1,2].includes(e.count)))throw Error('持续区域的驱散效果损坏');
    if(e.op==='push'&&(!integer(e.force,1,4)||e.steps!==1||e.direction!==undefined&&!['away','towards'].includes(e.direction)))throw Error('持续区域的位移效果损坏');
  }
}

/** 区域不经过普通伤害技能公式；从原配方升级一次，保留身份、冷却与已布置区域。 */
export function upgradeZoneSkill(ability: Ability, model?: Combatant['damageModel']): boolean {
  const version = model === 'wounds-v2' ? 'skill-zone-v3' : 'skill-zone-v1';
  let zones = ability.effects.filter((e): e is ZoneEffect => e.op === 'zone');
  if (!zones.length) return false;
  if (!ability.recipe || zones.some(effect => !ability.recipe!.modifiers.includes('zone-' + effect.kind))
    || ability.itemSourceId || ability.fixedPower || ability.effectVersion === version) return true;
  // 旧编译器把所有区域都标成 customized；只接管仍与旧模板一致的实例。
  if (ability.customized && !(ability.effectVersion === 'skill-v2.4' && zones.every(effect => effect.power === ability.recipe!.power
    && effect.dur === 3 && effect.radius === (effect.kind === 'trap' ? 0 : 1) && effect.amount === undefined && effect.penetration === undefined)
    && ability.range?.metric === 'grid' && ability.range.min === 0 && ability.range.max === 2 + Math.floor(ability.recipe.power / 3))) return true;
  if (model === 'wounds-v2' && ability.definitionId) {
    // Rebuild the pristine recipe before applying modifiers, including nested healing payloads.
    const rebuilt = compileGenericSkill(ability.definitionId, ability.power ?? ability.recipe.power, ability.sourceId ?? '', ability.name, model);
    ability.effects = rebuilt.effects; ability.range = rebuilt.range;
    zones = ability.effects.filter((e): e is ZoneEffect => e.op === 'zone');
  }
  const bonuses = ability.bonuses;
  for (const effect of zones) {
    const channel = effect.kind === 'fire' ? 'thermal' : effect.kind === 'trap' ? 'kinetic' : undefined;
    if (effect.kind !== 'smoke') {
      const amount = Math.max(1, Math.round(zoneAmount(effect) * bonusMultiplier(bonuses, effect.kind === 'healing' ? 'healing' : 'damage', channel)));
      if (amount !== zoneAmount(effect)) effect.amount = amount;
    }
    if (channel) {
      const penetration = Math.max(0, zonePenetration(effect) + bonusRating(bonuses, 'penetration', channel));
      if (penetration !== zonePenetration(effect)) effect.penetration = penetration;
      ability.channel = channel;
    }
    // 烟幕遮蔽是开关效果，强度改为延长存在时间；与持续词条合并且有界。
    const duration = effect.kind === 'smoke'
      ? bonusSteps({ duration: Math.max(-10, Math.min(20, bonusPoints(bonuses, 'power') + bonusPoints(bonuses, 'duration'))) }, 'duration', 5)
      : bonusSteps(bonuses, 'duration', 5);
    effect.dur = Math.max(1, Math.min(99, effect.dur + duration));
    effect.effects = effect.effects?.map(e => {
      if (e.op === 'condition') return { ...e, dur: Math.max(1,Math.min(99,e.dur + (['stunned','restrained','disarmed','silenced'].includes(e.conditionId) ? Math.min(0,bonusSteps(bonuses,'duration',5)) : bonusSteps(bonuses,'duration',5)))),
        magnitude: Math.max(.25,Math.min(1.5,(e.magnitude ?? 1)*bonusMultiplier(bonuses,'power'))),
        ...(e.saveDC === undefined ? {} : {saveDC:Math.max(1,Math.min(30,e.saveDC+bonusSteps(bonuses,'accuracy')))}) };
      if (e.op === 'heal' && e.amount !== undefined) return { ...e, amount:Math.max(1,Math.round(e.amount*bonusMultiplier(bonuses,'healing'))) };
      if (e.op === 'barrier') return { ...e, amount:Math.max(1,Math.round(e.amount*bonusMultiplier(bonuses,'power'))),dur:Math.max(1,Math.min(99,e.dur+bonusSteps(bonuses,'duration',5))) };
      if (e.op === 'trait') return { ...e, dur:Math.max(1,Math.min(99,e.dur+bonusSteps(bonuses,'duration',5))) };
      if (e.op === 'resource') return { ...e, amount:Math.sign(e.amount)*Math.max(0,Math.abs(e.amount)+bonusSteps(bonuses,'resource',5)) };
      if (e.op === 'morale') return { ...e, amount:Math.round(e.amount*bonusMultiplier(bonuses,'morale')) };
      return e;
    });
  }
  if (ability.range && !ability.effects.some(e=>e.op==='summon')) ability.range.max = Math.max(1, ability.range.min, ability.range.max + bonusSteps(bonuses, 'range', 5));
  delete ability.customized;
  ability.effectVersion = version;
  return true;
}

/** 单位详情与战斗预览共用，数值就是区域保存与结算所用的数值。 */
export function zoneEffectDescription(effect: ZoneEffect): string {
  const names: Record<string,string> = {heal:'治疗',trait:'授予特质',barrier:'屏障',dispel:'驱散/净化',resource:'精力变化',morale:'士气变化',push:'位移'};
  const additions = effect.effects?.map(e => e.op === 'condition' ? (standardConditionMap().get(e.conditionId)?.name ?? e.conditionId) : names[e.op]).join('、');
  const area = `半径${effect.radius}格，持续${effect.dur}轮${additions ? '；接触时附加'+additions+'（状态需抵抗，持续伤害需先受损）' : ''}`;
  if (effect.kind === 'smoke') return `烟幕：${area}，遮挡穿过区域的非贴身地面视线；强度和持续修正影响持续时间`;
  const amount = zoneAmount(effect);
  if (effect.kind === 'healing') return `治疗区域：${area}，每个友方单位每轮最多恢复${amount}点生命，受可恢复量限制`;
  const protection = effect.kind === 'poison' ? '受毒素抗性限制，封闭车体免疫' : `${effect.kind === 'fire' ? '热能' : '动能'}穿透${Number(zonePenetration(effect).toFixed(2))}，受对应防护限制`;
  return `${effect.kind === 'fire' ? '火墙' : effect.kind === 'poison' ? '毒雾' : '陷阱'}：${area}，每名受影响成员基础伤害${amount}；${protection}；`
    + (effect.kind === 'trap' ? '只由敌方触发，触发一次后消失' : '每个单位每轮最多触发一次，也会伤害友军');
}
