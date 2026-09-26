import type { Ability, Combatant, EffectOp } from './types.js';
import type { ObservationContext } from './observation.js';
import { formationNode, FORMATION_NODES } from './mass/formation.js';
import { applyCombatDamage, applyRecovery, recoveryCapacity } from './recovery.js';
import { anchoredProtection, penetrationThrough } from './power-anchors.js';
import { poisonFactor } from './afflictions.js';
import { unitLineOfSight } from './small/spatial.js';
import { activeTraitIds } from './trait-sources.js';

type Point = { x: number; y: number };
type ZoneEffect = Extract<EffectOp, { op: 'zone' }>;
export interface BattleZone extends Point { id: string; ownerId: string; side: Combatant['side']; kind: ZoneEffect['kind']; power: number; radius: number; remaining: number; createdRound: number; lastRound: number; affected: string[]; mode: 'small' | 'mass' }
export const ZONE_NAMES = { fire: '燃烧区域', poison: '毒雾', smoke: '烟幕', healing: '治疗区域', trap: '陷阱' } as const;
export const AREA_NAMES = { cone: '扇形', line: '直线', ring: '环形', chain: '连锁', circle: '圆形' } as const;
export function areaPosition(context: ObservationContext, unit: Combatant): Point {
  const hostId = [...(context.attached ?? [])].find(([, id]) => id === unit.id)?.[0];
  const located = context.units.find(u => u.id === hostId) ?? unit;
  return context.mode === 'mass' ? formationNode(located) : { x: (located.pos ?? 0) % (context.battlefield?.width ?? 99), y: Math.floor((located.pos ?? 0) / (context.battlefield?.width ?? 99)) };
}
const distance = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
/** 看见区域不代表发现施法者；敌方陷阱不显示，烟幕不遮住自身外观。 */
export function visibleBattleZones(context: ObservationContext, side: Combatant['side']): BattleZone[] {
  return context.units.flatMap(u=>u.battleZones??[]).filter(zone=>zone.mode===context.mode&&zone.remaining>0&&(zone.side===side || zone.kind!=='trap'&&context.units.some(observer=>{
    if(observer.side!==side||observer.status!=='ready')return false;
    const range=activeTraitIds(observer).includes('night-fighter')?(context.mode==='small'?6:4):(context.mode==='small'?3:2);
    if(context.fieldTags.includes('night')&&distance(areaPosition(context,observer),zone)>range)return false;
    return !context.battlefield||unitLineOfSight(context.battlefield,observer,{...observer,airborne:false,pos:zone.y*context.battlefield.width+zone.x});
  })));
}
export function areaTargets(context: ObservationContext, actor: Combatant, primary: Combatant, ability: Ability, valid: (unit: Combatant) => boolean): Combatant[] {
  const area = ability.area; if (!area) return [primary];
  const origin = areaPosition(context, actor), pivot = areaPosition(context, primary);
  const eligible = context.units.filter(u => u.side === primary.side && u.hp > 0 && !['dead','fled'].includes(u.status) && valid(u)).sort((a,b) => a.id.localeCompare(b.id));
  if (area.shape === 'chain') {
    const result: Combatant[] = eligible.some(u => u.id === primary.id) ? [primary] : [];
    while (result.length && result.length < area.maxTargets) {
      const last = areaPosition(context, result.at(-1)!);
      const next = eligible.filter(u => !result.some(r => r.id === u.id) && distance(last, areaPosition(context,u)) <= area.radius)
        .sort((a,b) => distance(last,areaPosition(context,a))-distance(last,areaPosition(context,b)) || a.id.localeCompare(b.id))[0];
      if (!next) break; result.push(next);
    }
    return result;
  }
  const dx = pivot.x-origin.x, dy = pivot.y-origin.y, length = Math.hypot(dx,dy);
  return eligible.filter(unit => {
    const at = areaPosition(context,unit), d = distance(at,pivot);
    if (area.shape === 'circle') return d <= area.radius;
    if (area.shape === 'ring') return d > 0 && d <= area.radius;
    if (!length) return unit.id === primary.id;
    const ux=at.x-origin.x, uy=at.y-origin.y, dot=(ux*dx+uy*dy)/length, cross=Math.abs(ux*dy-uy*dx)/length;
    return dot > 0 && dot <= length + .5 && cross <= (area.shape === 'line' ? .5 : dot * .6 + .25);
  }).sort((a,b) => distance(areaPosition(context,a),pivot)-distance(areaPosition(context,b),pivot) || a.id.localeCompare(b.id)).slice(0,area.maxTargets);
}
export function zoneTarget(context: ObservationContext, actor: Combatant, id?: string): Combatant | undefined {
  if (!id) return undefined;
  const unit = context.units.find(u => u.id === id); if (unit) return unit;
  if (context.mode === 'small' && /^cell:\d+$/.test(id) && context.battlefield) {
    const cell=Number(id.slice(5)); if (cell<0 || cell>=context.battlefield.tiles.length || context.battlefield.tiles[cell]==='wall') return undefined;
    return {...actor,id,name:'选定位置',pos:cell,airborne:false};
  }
  if (context.mode === 'mass' && id.startsWith('zone:')) {
    const node=FORMATION_NODES.find(n=>n.id===id.slice(5));
    if (node) return {...actor,id,name:node.wing+'·'+({front:'前线',rear:'后方',reserve:'预备'}[node.rank]),formationPosition:node.id,airborne:false};
  }
  return undefined;
}
export function placeZone(context: ObservationContext, actor: Combatant, target: Combatant, effect: ZoneEffect, round: number, abilityId: string): BattleZone {
  const point=areaPosition(context,target), id=actor.id+':'+abilityId+':'+effect.kind;
  const zone:BattleZone={...point,id,ownerId:actor.id,side:actor.side,kind:effect.kind,power:effect.power,radius:effect.radius,remaining:effect.dur,createdRound:round,lastRound:round,affected:[],mode:context.mode};
  actor.battleZones=(actor.battleZones??[]).filter(old=>old.id!==id);
  actor.battleZones.push(zone); return zone;
}
export function smokeBlocks(context: ObservationContext, from: Combatant, to: Combatant): boolean {
  if (from.airborne || to.airborne) return false;
  const a=areaPosition(context,from),b=areaPosition(context,to); if(distance(a,b)<=1)return false;
  const dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;
  return context.units.flatMap(u=>u.battleZones??[]).some(z=>{
    if(z.mode!==context.mode || z.kind!=='smoke' || z.remaining<=0)return false;
    const t=Math.max(0,Math.min(1,((z.x-a.x)*dx+(z.y-a.y)*dy)/length));
    return Math.hypot(z.x-a.x-t*dx,z.y-a.y-t*dy)<=z.radius+.35;
  });
}
export interface ZoneOutcome { target: Combatant; source?: Combatant; damage: number; text: string }
/** 同一区域每个单位每轮至多触发一次；离开再进入或读档不会重复触发。 */
export function settleZones(context: ObservationContext, round: number, boundary=false): ZoneOutcome[] {
  const results:ZoneOutcome[]=[];
  for(const owner of context.units) {
    for(const zone of owner.battleZones??[]) {
      if(zone.mode!==context.mode || zone.remaining<=0)continue;
      if(zone.lastRound!==round){zone.lastRound=round;zone.affected=[];}
      if(zone.kind!=='smoke')for(const target of context.units) {
        if(target.hp<=0 || ['dead','fled'].includes(target.status) || target.airborne || zone.affected.includes(target.id) || distance(zone,areaPosition(context,target))>zone.radius)continue;
        if(zone.kind==='healing' ? target.side!==zone.side : zone.kind==='trap' && target.side===zone.side)continue;
        if(context.battlefield) {
          const anchor={...target,pos:zone.y*context.battlefield.width+zone.x,airborne:false};
          if(!unitLineOfSight(context.battlefield,anchor,target))continue;
        }
        zone.affected.push(target.id);
        const amount=4+zone.power*3;
        if(zone.kind==='healing') {
          const healed=applyRecovery(target,Math.min(recoveryCapacity(target),amount));
          if(healed)results.push({target,source:owner,damage:0,text:target.name+'在治疗区域恢复'+healed+'点生命'});
        } else {
          const count=target.scale==='hero'?1:Math.min(target.hp,4);
          const factor=zone.kind==='poison'?poisonFactor(target):penetrationThrough(2*zone.power,anchoredProtection(target,zone.kind==='fire'?'thermal':'kinetic'));
          const damage=applyCombatDamage(target,Math.round(amount*factor*count),count);
          results.push({target,source:owner,damage,text:target.name+'受到'+ZONE_NAMES[zone.kind]+'影响，损失'+damage+'点生命'});
          if(zone.kind==='trap'){zone.remaining=0;break;}
        }
      }
      if(boundary && zone.createdRound<round)zone.remaining--;
    }
    owner.battleZones=(owner.battleZones??[]).filter(z=>z.remaining>0);
    if(!owner.battleZones.length)delete owner.battleZones;
  }
  return results;
}
export function validateAreas(unit: Combatant): void {
  if(unit.battleZones!==undefined&&!Array.isArray(unit.battleZones))throw Error('持续区域的存档不完整');
  const ids=new Set<string>();
  for(const zone of unit.battleZones??[]) {
    if(!zone || typeof zone.id!=='string' || !zone.id || ids.has(zone.id) || zone.side!==unit.side || zone.ownerId!==unit.id || !Object.hasOwn(ZONE_NAMES,zone.kind) || !['small','mass'].includes(zone.mode) || !Number.isSafeInteger(zone.x) || zone.x<0 || !Number.isSafeInteger(zone.y) || zone.y<0 || !Number.isInteger(zone.radius) || zone.radius<0 || zone.radius>3 || !Number.isInteger(zone.power) || zone.power<1 || zone.power>10 || !Number.isInteger(zone.remaining) || zone.remaining<1 || zone.remaining>99 || !Number.isSafeInteger(zone.createdRound) || zone.createdRound<1 || !Number.isSafeInteger(zone.lastRound) || zone.lastRound<zone.createdRound || !Array.isArray(zone.affected) || zone.affected.some(id=>typeof id!=='string') || new Set(zone.affected).size!==zone.affected.length)throw Error('持续区域的存档不完整');
    ids.add(zone.id);
  }
}
