import { bonusMultiplier, bonusSteps, bonusRating } from './enhancements.js';
import type { Combatant } from './types.js';
import { curveAt } from './data/curves.js';
import { diceAvg, rebuildDice } from './data/weapons.js';
import {powerBudget,scaledPowerDice} from './power-anchors.js';
import { compileSkill, skillDefinitionKnown } from './skill-catalog.js';
import { balanceGenericSkill, genericEffectCount } from './skill-balance.js';
import { upgradeZoneSkill } from './zone-skills.js';
/** V3只在新规则入场时升级；原技能身份、P与已支付的账本都保留。 */
export function upgradeCombatSkills(unit: Combatant): void {
  const modern=unit.combatModel==='cohort-v2';
  for(const a of unit.abilities){
    if (upgradeZoneSkill(a)) continue;
    const generic=a.definitionId?.startsWith('generic:')??false;
    const version=modern?'skill-v4.3':'skill-v3.0';
    if(a.customized||a.itemSourceId||a.fixedPower||a.effectVersion===version)continue;
    const previousGroup=a.cooldownGroup??a.id;
    if(modern&&a.definitionId&&skillDefinitionKnown(a.definitionId)) {
      const rebuilt=compileSkill({id:a.definitionId!,name:a.name,bonuses:a.bonuses,instanceId:a.id},a.power??5,unit.id);
      // 从原始配方重建一次，避免旧战斗倍率/强化再次相乘；身份和支付账本不重置。
      const sourceId=a.sourceId,id=a.id;
      Object.assign(a,rebuilt,{sourceId,id});
      delete a.damageScale;
    }
    const power=a.power??5, curve=curveAt(power), base=modern?powerBudget(power):diceAvg(curve.dmgBase)+(curve.dmgAp?diceAvg(curve.dmgAp):0);
    const damaging=a.effects.some(e=>e.op==='damage'), area=a.shape==='burst';
    if(modern&&area&&!a.damageBasis&&damaging)a.areaExposure=power>=10?1e9:power>=9?128:power>=8?16:power>=7?8:4;
    const controls=a.effects.filter(e=>!['damage'].includes(e.op)).length;
    if(damaging){
      const share=(area?1.05:2.2)*Math.pow(.9,Math.min(3,controls));
      const scaled=scaledPowerDice(base*share*bonusMultiplier(a.bonuses,'damage',a.damageBasis?undefined:a.channel??'kinetic'));
      a.effects=a.effects.map(e=>e.op==='damage'?{...e,baseDice:modern?scaled.dice:rebuildDice(base*share,6),apDice:undefined}:e);
      if(modern)a.damageScale=scaled.scale;
      if(a.damageBasis)a.weaponDamageMult=share*bonusMultiplier(a.bonuses,'damage');
      a.penetration=modern?2*power+(area?0:2):(a.penetration??1+Math.floor(power/2))+(area?0:1);
      a.cooldown=area?2:1;
      if(a.cost?.resource==='SP')a.cost.amount=Math.min(5,(area?3:2)+Math.ceil(controls/2));
    }
    if(modern) {
      a.penetration=Math.max(0,(a.penetration??0)+bonusRating(a.bonuses,'penetration',a.channel??'kinetic'));
      if(a.range && a.range.max>1) a.range.max=Math.max(a.range.min,1,a.range.max+bonusSteps(a.bonuses,'range',5));
      a.effects=a.effects.map(e=>{
        if(e.op==='condition')return {...e,...(e.saveDC!==undefined?{saveDC:Math.max(1,Math.min(30,e.saveDC+bonusSteps(a.bonuses,'accuracy')))}:{}),dur:Math.max(1,e.dur+(['stunned','restrained','disarmed','silenced'].includes(e.conditionId)?Math.min(0,bonusSteps(a.bonuses,'duration',5)):bonusSteps(a.bonuses,'duration',5))),magnitude:Math.min(1.5,(e.magnitude??1)*bonusMultiplier(a.bonuses,'power'))};
        if(e.op==='trait')return {...e,dur:Math.max(1,e.dur+bonusSteps(a.bonuses,'duration',5))};
        if(e.op==='resource')return {...e,amount:Math.sign(e.amount)*Math.max(0,Math.abs(e.amount)+bonusSteps(a.bonuses,'resource',5))};
        if(e.op==='morale')return {...e,amount:Math.round(e.amount*bonusMultiplier(a.bonuses,'morale'))};
        return e;
      });
      const restored=a.effects.find(e=>e.op==='resource'&&e.resource==='SP'&&e.amount>0);
      if(restored?.op==='resource'&&a.cost?.resource==='SP')a.cost.amount=Math.max(a.cost.amount,restored.amount*(area?2:1));
    }
    if(modern)a.effects=a.effects.map(e=>e.op==='heal'?{op:'heal',amount:Math.max(1,Math.round(base*(area?0.8:1.5)*bonusMultiplier(a.bonuses,'healing')/(generic?genericEffectCount(a):1)))}:e);
    if(modern)balanceGenericSkill(a);
    const oldGroup=previousGroup;
    a.cooldownGroup='skill-mechanism:'+(a.definitionId??a.id);
    const old=unit.abilityState.find(s=>s.abilityId===oldGroup);
    if (old) {
      const current = unit.abilityState.find(s => s.abilityId === a.cooldownGroup);
      if (current) { current.cdLeft = Math.max(current.cdLeft, old.cdLeft); current.used = Math.max(current.used, old.used); }
      else unit.abilityState.push({ ...old, abilityId: a.cooldownGroup });
    }
    a.effectVersion=version;
    a.desc=(a.desc??'').replace('同类别共享冷却','不同种效果独立冷却，同种效果改名不刷新').replace('至多两名近身合法目标分担范围攻击可用上限','至多两名近身合法目标分别承受范围攻击');
  }
}
