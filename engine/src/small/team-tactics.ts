/** Deterministic regional orders. Only friendly units, public terrain and observed enemies enter here. */
import type { Combatant } from '../types.js';
import type { CommanderProfile } from '../commander-profile.js';
import { activeTraitIds } from '../trait-sources.js';
import { isAirborne } from '../aerial.js';
import { isRangedWeapon } from '../loadout.js';
import { gridDistance, neighbors, gridCostsToGoals,movementStepCost, type BattlefieldSpec } from './spatial.js';
import { groundBlocked, isElevated, intactStructure } from './layers.js';
export interface RegionalOrder {
  role: 'front' | 'fire' | 'reserve' | 'core' | 'breach' | 'flank' | 'advance';
  goals: number[];
  breach?: number;
  phase: 'intact' | 'breached' | 'core-threat' | 'advance';
}
function hash(s: string): number { let n = 2166136261; for (const c of s) n = Math.imul(n ^ c.charCodeAt(0), 16777619); return n >>> 0; }
export function regionalOrder(field: BattlefieldSpec, unit: Combatant, known: Combatant[], profile?: CommanderProfile): RegionalOrder | undefined {
  const assigned=field.deploymentZones?.filter(z=>(z.unitId===unit.id||!z.unitId&&z.side===unit.side)&&['guards','occupies'].includes(z.relation??''))??[];
  if(assigned.length&&unit.pos!==undefined&&(!field.city?.core.some(p=>known.some(u=>u.side!==unit.side&&u.status==='ready'&&gridDistance(field,p,u.pos!)<=2)))) {
    const goals=[...new Set(assigned.flatMap(z=>z.cells))].filter(p=>!groundBlocked(field,p,unit));
    if(goals.length)return {role:isRangedWeapon(unit.weapon)?'fire':'front',goals,phase:'intact'};
  }
  if (!field.layerVersion || !field.city?.defender || field.objective.kind !== 'control' || unit.pos === undefined) return;
  const city = field.city;
  const friends = known.filter(u => u.side === unit.side && u.hp > 0 && u.status === 'ready').sort((a, b) => hash(a.id) - hash(b.id));
  const foes = known.filter(u => u.side !== unit.side && u.hp > 0 && ['ready', 'routing'].includes(u.status));
  const breached = city.frontline.filter(p => !intactStructure(field, p) || intactStructure(field, p)?.gateState === 'open');
  const danger = foes.filter(u => city.core.some(p => gridDistance(field, p, u.pos!) <= 2));
  const phase = danger.length || field.objective.kind==='control' && field.objective.attackingSide !== unit.side && known.some(u=>u.side!==unit.side&&u.status==='ready'&&(field.objective.kind==='control'&&(field.objective.cells??[field.objective.cell]).includes(u.pos!))) ? 'core-threat' : breached.length || foes.some(u => city.inside.includes(u.pos!)) ? 'breached' : 'intact';
  const slot = Math.max(0, friends.findIndex(u => u.id === unit.id));
  const ranged = isRangedWeapon(unit.weapon);
  const style = profile?.style ?? 'depth';
  const legal = (cells: number[]) => [...new Set(cells)].filter(p => !groundBlocked(field, p, unit));
  if (unit.side === city.defender) {
    const coreSlots = friends.length >= 5 ? Math.max(1, Math.round(friends.length * (style === 'core' ? .3 : .15))) : 0;
    const reserveDefault = style === 'forward' ? 0 : ['depth', 'mobile'].includes(style) ? 3 : 2;
    const reserveFraction = (profile?.preferences?.reserve ?? reserveDefault) * .06 + .04;
    const reserves = friends.length >= 5 ? Math.min(friends.length - coreSlots - 1, Math.round(friends.length * reserveFraction)) : 0;
    const role = slot < coreSlots ? 'core' : slot < coreSlots + reserves ? 'reserve' : ranged ? 'fire' : 'front';
    let goals: number[];
    if (phase === 'core-threat') goals = [...city.core, ...danger.flatMap(u => neighbors(field, u.pos!))];
    else if (role === 'core') goals = city.core;
    else if (phase === 'breached' && role === 'reserve') goals = [...breached.flatMap(p => neighbors(field, p)), ...foes.filter(u => city.inside.includes(u.pos!)).flatMap(u => neighbors(field, u.pos!))];
    else if (role === 'reserve') {
      const contacts = foes.filter(u => city.frontline.some(p => gridDistance(field, p, u.pos!) <= 2));
      const support = friends.filter(u => contacts.some(f => gridDistance(field, u.pos!, f.pos!) <= 4));
      const counter = (profile?.preferences?.counterattack ?? (style === 'mobile' ? 3 : 2)) >= 3;
      goals = counter && contacts.length && support.length >= contacts.length * 2
        ? contacts.flatMap(u => neighbors(field, u.pos!)).filter(p => city.inside.includes(p) || city.frontline.some(f => gridDistance(field, f, p) <= 1)) : city.reserve;
    }
    else {
      const rows = city.frontline.map(p => Math.floor(p / field.width));
      const forwardRow = city.defender === 'enemy' ? Math.max(...rows) : Math.min(...rows);
      const forwardLine = city.frontage?.filter(p=>city.frontline.includes(p))??city.frontline.filter(p => Math.floor(p / field.width) === forwardRow);
      const lateral=(p:number)=>city.facing==='east'||city.facing==='west'?Math.floor(p/field.width):p%field.width;
      const extent=city.facing==='east'||city.facing==='west'?field.height:field.width;
      const sectors = Math.min(3, Math.max(1, friends.length));
      const sector = forwardLine.filter(p => Math.min(sectors - 1, Math.floor(lateral(p) * sectors / extent)) === slot % sectors);
      const line = sector.length ? sector : forwardLine.length ? forwardLine : city.frontline;
      goals = isElevated(unit) ? line : line.flatMap(p => neighbors(field, p)).filter(p => city.inside.includes(p));
      if (phase === 'breached' && !isElevated(unit)) goals.push(...breached.filter(p => Math.abs(p % field.width - unit.pos! % field.width) <= 3));
    }
    if (isElevated(unit)) goals = legal(goals).length ? legal(goals) : city.frontline.filter(p => intactStructure(field, p)?.top);
    else goals = legal(goals);
    return { role, goals: goals.length ? goals : [unit.pos], phase };
  }
  // A gap behind water/cliffs is not a usable breach for this unit. Public terrain only.
  const coreReachable = breached.length > 0 && gridCostsToGoals(field, legal(city.core), p => !groundBlocked(field, p, unit), (p,from)=>movementStepCost(field,p,unit,field.environment,from)).has(unit.pos);
  if (isAirborne(unit) || isElevated(unit) || city.inside.includes(unit.pos) || coreReachable) {
    return { role: ranged ? 'fire' : 'advance', goals: legal(city.core).length ? legal(city.core) : city.core, phase: 'advance' };
  }
  const flanking = style === 'flanking' || style === 'infiltration' || slot % 4 === 3;
  // Gate/side-wall assignments persist while that opening is intact; no per-round random switching.
  const candidates = city.frontline.filter(p => intactStructure(field, p) && (!ranged || !isElevated(unit)));
  candidates.sort((a, b) => {
    const score = (p: number) => gridDistance(field, unit.pos!, p) * .6 + (intactStructure(field, p)?.kind === 'gate' ? -3 : 0)
      + (flanking ? Math.min(p % field.width, field.width - 1 - p % field.width) : Math.abs(p % field.width - field.width / 2)) * .5;
    return score(a) - score(b) || a - b;
  });
  const breach = candidates[0];
  if (breach === undefined) return { role: 'advance', goals: city.core, phase: 'advance' };
  const goals = legal(neighbors(field, breach).filter(p => !city.inside.includes(p)));
  const engineers = activeTraitIds(unit).includes('siege-breaker') || activeTraitIds(unit).includes('siege-assault');
  return { role: flanking ? 'flank' : ranged && !engineers ? 'fire' : 'breach', goals: goals.length ? goals : [unit.pos], breach, phase: 'intact' };
}
