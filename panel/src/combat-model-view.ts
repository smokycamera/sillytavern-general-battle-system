import { isCannonWeapon } from '../../engine/src/loadout.js';
import type { ActionPreview } from '../../engine/src/actions.js';
import type {Combatant} from '../../engine/src/types.js';
import {hasMemberHealth,memberHealth,memberHealthMax,memberNoun} from '../../engine/src/member-health.js';
import {htmlText as esc} from './equipment-form.js';
export function participationText(preview?: ActionPreview): string {
  if(preview?.participants===undefined)return '';
  return `有效投送 ${Number(preview.participants.toFixed(1))} 份${preview.memberHp!==undefined?' · 目标单位最大生命 '+preview.memberHp:''}${preview.expectedCasualties!==undefined?' · 预计减员 '+preview.expectedCasualties.toFixed(1):''}${preview.weaponOverflow?' · 武器余伤在目标编队内传递':''}${(preview.aggregationSamples??1)>1?' · 分 '+preview.aggregationSamples+' 组判定，命中率为每组概率':''}`;
}
export function memberHealthPanel(unit:Combatant):string {
  if(!hasMemberHealth(unit))return '';
  const groups=[...(unit.formation?.health??[])].reverse(),label=unit.body==='vehicle'?'载具':'成员',noun=memberNoun(unit);
  const rows=groups.map(g=>`<span class="member-health-group"><b>${g.count}${noun}</b> ${g.hp}/${unit.formation!.memberHp}生命</span>`);
  return `<div class="member-health-panel" data-member-health="${esc(unit.id)}"><b>${label}生命 · ${unit.hp}/${unit.base.hpMax}${noun}</b><span>总生命 ${memberHealth(unit)}/${memberHealthMax(unit)}</span><div>${rows.slice(0,8).join('')||'<span>全部失能</span>'}</div>${rows.length>8?`<details><summary>另${rows.length-8}组伤损</summary>${rows.slice(8).join('')}</details>`:''}${unit.recoverableWounded?`<small>可救回 ${unit.recoverableWounded}${noun}</small>`:''}</div>`;
}
export function cannonAmmoControl(unit:Combatant|undefined,disabled=false):string {
  if(!unit||unit.combatModel!=='cohort-v2'||![unit.weapon,unit.sidearm].some(isCannonWeapon))return '';
  return `<label class="cannon-ammo">${esc(unit.name)} · 火炮弹种<select data-role="cannon-ammo" data-unit="${esc(unit.id)}" ${disabled?'disabled':''}><option value="auto" ${!unit.cannonAmmo?'selected':''}>自动按目标选弹</option><option value="he" ${unit.cannonAmmo==='he'?'selected':''}>榴弹 · 直击与爆炸</option><option value="ap" ${unit.cannonAmmo==='ap'?'selected':''}>穿甲弹 · 穿透+2，无爆炸</option></select></label>`;
}
