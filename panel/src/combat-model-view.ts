import { ui } from './ui-language.js';
import { isVehicleBody } from '../../engine/src/vehicle-size.js';
import { displayNumber } from '../../engine/src/display-number.js';
import { isCannonWeapon } from '../../engine/src/loadout.js';
import type { ActionPreview } from '../../engine/src/actions.js';
import type {Combatant} from '../../engine/src/types.js';
import {hasMemberHealth,memberHealth,memberHealthMax,memberNoun} from '../../engine/src/member-health.js';
import {htmlText as esc} from './equipment-form.js';
export function participationText(preview?: ActionPreview, detailed = false): string {
  if(preview?.participants===undefined)return '';
  // 单人出手不写参战人数；编队写有效攻击数，能估出减员时一并写。
  const attackers = preview.participants > 1 ? `有效攻击 ${Number(preview.participants.toFixed(1))} 份` : '';
  if (!detailed) return [attackers, preview.expectedCasualties!==undefined ? '预计减员 '+preview.expectedCasualties.toFixed(1) : ''].filter(Boolean).join(' · ');
  return [attackers, (preview.overmatchMultiplier??1)>1 ? '跨代毁伤×'+Number(preview.overmatchMultiplier!.toFixed(2)) : ''].filter(Boolean).join(' · ');
}
export function memberHealthPanel(unit:Combatant):string {
  if(!hasMemberHealth(unit))return '';
  const groups = [...(unit.formation?.health ?? [])].reverse();
  const label = ui(isVehicleBody(unit.body) ? '载具生命' : '成员生命');
  const noun = ui(memberNoun(unit));
  const count = (value: string | number) => ui('{value}{noun}', {value, noun});
  const hp = (value: string) => ui('{value}生命', {value});
  const rows = groups.map(g => `<span class="member-health-group"><b>${count(g.count)}</b> ${hp(displayNumber(g.hp)+'/'+displayNumber(unit.formation!.memberHp))}</span>`);
  return `<div class="member-health-panel" data-member-health="${esc(unit.id)}"><b>${label} · ${count(displayNumber(unit.hp)+'/'+displayNumber(unit.base.hpMax))}</b><span>${ui("总生命")} ${displayNumber(memberHealth(unit))}/${displayNumber(memberHealthMax(unit))}</span><div>${rows.slice(0,8).join('')||`<span>${ui("全部失能")}</span>`}</div>${rows.length>8?`<details><summary>${ui('另{count}组伤损', {count:rows.length-8})}</summary>${rows.slice(8).join('')}</details>`:''}${unit.recoverableWounded?`<small>${ui('可救回 {amount}', {amount:count(unit.recoverableWounded)})}</small>`:''}</div>`;
}
export function cannonAmmoControl(unit:Combatant|undefined,disabled=false):string {
  if(!unit||unit.artilleryModel||unit.combatModel!=='cohort-v2'||![unit.weapon,unit.sidearm].some(isCannonWeapon))return '';
  const cannons = [unit.weapon,unit.sidearm].filter(isCannonWeapon), rocket = cannons.some(w => w!.recipe?.mechanism === 'rocket'), regular = cannons.some(w => w!.recipe?.mechanism !== 'rocket');
  const label = rocket && !regular ? '火箭筒弹种' : '火炮弹种', penetration = rocket ? regular ? '+2（火箭筒+3）' : '+3' : '+2';
  return `<label class="cannon-ammo">${esc(unit.name)} · ${label}<select data-role="cannon-ammo" data-unit="${esc(unit.id)}" ${disabled?'disabled':''}><option value="auto" ${!unit.cannonAmmo?'selected':''}>${ui("自动按目标选弹")}</option><option value="he" ${unit.cannonAmmo==='he'?'selected':''}>${ui("榴弹 · 直击与爆炸")}</option><option value="ap" ${unit.cannonAmmo==='ap'?'selected':''}>${ui("穿甲弹 · 穿透")}${penetration}，无爆炸</option></select></label>`;
}
