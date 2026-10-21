import type { SeededRng } from '../rng.js';
import { BattlefieldPlanError, type BattlefieldPlan, type GatePlan } from './battlefield-plan.js';
import type { BattlefieldScene } from './map-design.js';
import { createStructure, groundBlocked } from './layers.js';
import { neighbors, findGridPath, type BattlefieldSpec } from './spatial.js';
import { buildIndoorLayout } from './indoor-layout.js';
import { buildCompoundLayout } from './compound-layout.js';
import { buildTrenchLayout } from './trench-layout.js';

export function resolveBattlefieldScene(plan: BattlefieldPlan | undefined, tags: readonly string[], width: number): BattlefieldScene {
  return plan?.scene ?? (width === 5 ? 'interior' : tags.includes('siege') ? 'city_siege' : tags.includes('urban') ? 'city_streets' : 'field');
}

/** Exact gate count, independent states. Positional adjustments are reported, never silently collapsed. */
export function placePlannedGates(field: BattlefieldSpec, candidates: number[], specs: GatePlan[], defender: 'ally' | 'enemy',
  level: number, inner: number[] = [], top = true): number[] {
  const depth = (p: number) => defender === 'enemy' ? Math.floor(p / field.width) : field.height - 1 - Math.floor(p / field.width);
  const cells = [...new Set(candidates)], available = new Set(cells), gates: number[] = [];
  if (cells.length < specs.length) throw new BattlefieldPlanError('门部署容量不足，无法保留请求的门数');
  if (!cells.length) return gates;
  const front = Math.max(...cells.map(depth)), rear = Math.min(...cells.map(depth));
  const left = Math.min(...cells.map(p => p % field.width)), right = Math.max(...cells.map(p => p % field.width));
  const mid = (left + right) / 2;
  for (const spec of specs) {
    if (['north','south','east','west'].includes(spec.sector)) {
      const axis = (p: number) => spec.sector === 'north' || spec.sector === 'south' ? Math.floor(p / field.width) : p % field.width;
      const extreme = (spec.sector === 'north' || spec.sector === 'west' ? Math.min : Math.max)(...cells.map(axis));
      const edge = [...available].filter(p=>axis(p)===extreme).sort((a,b)=>Math.abs(a%field.width-mid)-Math.abs(b%field.width-mid)||a-b);
      if (!edge.length) throw new BattlefieldPlanError('指定绝对方位的城门没有可用墙段');
      const p = edge[0]!; available.delete(p); gates.push(p);
      const gate = createStructure('gate',level,{top,gateState:spec.state,...(spec.id?{entityId:spec.id}:{}),...(inner.length?{owner:defender}:{}),...(top?{access:neighbors(field,p).filter(n=>inner.includes(n)&&!groundBlocked(field,n))}:{})});
      if (spec.state==='destroyed') {gate.hp=0;field.overlays![p]=['rubble'];}
      field.structures![p]=gate;field.tiles[p]='street';
      if (field.generation?.scene !== 'interior') for (const n of neighbors(field,p)) if (field.structures![n]?.kind==='building') field.structures![n]=null;
      continue;
    }
    const desiredX = spec.sector === 'left' || spec.sector === 'front_left' ? left : spec.sector === 'right' || spec.sector === 'front_right' ? right : mid;
    const desiredD = spec.sector === 'rear' ? rear : spec.sector === 'left' || spec.sector === 'right' ? (front + rear) / 2 : front;
    const matches = (p: number) => spec.sector === 'auto' || spec.sector.startsWith('front') && depth(p) === front
      || spec.sector === 'rear' && rear !== front && depth(p) === rear
      || spec.sector === 'left' && p % field.width === left && depth(p) !== front
      || spec.sector === 'right' && p % field.width === right && depth(p) !== front;
    const p = [...available].sort((a,b) => Number(matches(b)) - Number(matches(a))
      || (Math.abs(a % field.width - desiredX) + Math.abs(depth(a) - desiredD)) - (Math.abs(b % field.width - desiredX) + Math.abs(depth(b) - desiredD))
      || a-b)[0]!;
    if (!matches(p)) field.generation!.notes = [...(field.generation!.notes ?? []), `门方位${spec.sector}无可用墙段，采用最近合法入口`];
    available.delete(p); gates.push(p);
    const gate = createStructure('gate', level, { top, ...(inner.length ? { owner: defender } : {}), gateState: spec.state,...(spec.id?{entityId:spec.id}:{}),
      ...(top ? { access: neighbors(field, p).filter(n => inner.includes(n) && !groundBlocked(field,n)) } : {}) });
    if (spec.state === 'destroyed') { gate.hp = 0; field.overlays![p] = ['rubble']; }
    field.structures![p] = gate; field.tiles[p] = 'street';
    // Ordinary houses may not wall off a planned doorway. City walls and water stay untouched.
    if (field.generation?.scene !== 'interior') for (const n of neighbors(field,p)) if (field.structures![n]?.kind === 'building') field.structures![n] = null;
  }
  return gates;
}

export function legacyGatePlan(plan: BattlefieldPlan | undefined, fallback: GatePlan[]): GatePlan[] {
  if (plan?.gatePlan) return plan.gatePlan;
  if (!plan?.gates) return fallback;
  const state = plan.gateState ?? 'closed';
  return plan.gates === 'none' ? [] : plan.gates === 'single' ? [{ sector: 'front_center', state }]
    : [{ sector: 'front_left', state }, { sector: plan.gates === 'side' ? 'right' : 'front_right', state }];
}

/** Rooms/corridors, one target compound, or connected trench systems; no random outdoor feature stamps. */
export function buildSpecialScene(field: BattlefieldSpec, scene: BattlefieldScene, plan: BattlefieldPlan | undefined,
  rng: SeededRng, attackingSide: 'ally' | 'enemy'): void {
  const { width: w, height: h } = field, defender = attackingSide === 'ally' ? 'enemy' : 'ally';
  const at = (x: number,d: number) => (defender === 'enemy' ? d : h-1-d) * w + x;
  const level = plan?.fortLevel ?? (scene === 'interior' ? 2 : 3);
  field.tiles.fill(scene === 'interior' ? 'street' : 'open'); field.structures!.fill(null); field.overlays = {};
  delete field.city; delete field.generation!.routes;
  const center = at(Math.floor(w/2), Math.floor(h/2));
  field.objective = { kind: 'annihilation', cell: center, limit: field.objective.limit };
  if (scene === 'interior') {
    if (plan?.water && plan.water !== 'none') field.generation!.notes = [...(field.generation!.notes??[]),'室内布局不铺设室外水系'];
    const { doorways } = buildIndoorLayout(field, plan, rng);
    placePlannedGates(field,doorways,legacyGatePlan(plan,[{sector:'left',state:'open'},{sector:'right',state:'open'}]),defender,level,[],false);
  } else if (scene === 'building_siege') {
    const candidates = buildCompoundLayout(field, plan, rng, attackingSide);
    const specs = legacyGatePlan(plan, [{ sector: 'front_center', state: plan?.gateState ?? 'closed' }]);
    field.city!.gates = placePlannedGates(field, candidates,
      specs.filter(s => !s.internal),
      defender, level, field.city!.inside, false);
    placePlannedGates(field, field.generation!.compound!.internalDoors, specs.filter(s => s.internal), defender, level, field.city!.inside, false);
    const inside = new Set(field.city!.inside), passages = new Set<number>();
    for (const gate of field.city!.gates) for (const start of neighbors(field, gate).filter(p => inside.has(p) && !groundBlocked(field, p))) {
      const route = findGridPath(field, start, field.city!.core[0]!,
        p => inside.has(p) && (!groundBlocked(field, p) || field.structures![p]?.kind === 'gate'), () => 1);
      for (const p of route?.cells ?? []) passages.add(p);
    }
    field.generation!.compound!.passages = [...passages];
    if (passages.size) field.generation!.compound!.areas.push({ kind: 'passage', label: '联络通道', cells: [...passages] });
  } else if (scene === 'trenches') {
    buildTrenchLayout(field, plan, rng);
  }
}
