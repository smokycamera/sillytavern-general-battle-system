import type { SeededRng } from '../rng.js';
import { BattlefieldPlanError, type BattlefieldPlan, type GatePlan } from './battlefield-plan.js';
import type { BattlefieldScene } from './map-design.js';
import { createStructure, groundBlocked } from './layers.js';
import { gridDistance, neighbors, type BattlefieldSpec } from './spatial.js';
import { buildIndoorLayout } from './indoor-layout.js';

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
  const int = (a: number,b: number) => a + Math.floor(rng.next() * (b-a+1));
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
    const left = 1, right = w-2, back = 2, front = Math.max(6,Math.floor(h*.60));
    const inside: number[]=[], perimeter: number[]=[];
    for (let d=back;d<=front;d++) for (let x=left;x<=right;x++) {
      const p=at(x,d); field.tiles[p]='street';
      if (x===left || x===right || d===back || d===front) {
        perimeter.push(p); field.structures![p]=createStructure('wall',level,{owner:defender,top:false});
      } else inside.push(p);
    }
    // Corner walls cannot be doors: both the inside and outside need a usable adjacent cell.
    const candidates=perimeter.filter(p => neighbors(field,p).some(n=>inside.includes(n))
      && neighbors(field,p).some(n=>!inside.includes(n)&&!perimeter.includes(n)));
    const gates=placePlannedGates(field,candidates,legacyGatePlan(plan,[{sector:'front_center',state:plan?.gateState??'closed'}]),defender,level,inside,false);
    const core=inside.sort((a,b)=>gridDistance(field,a,at(Math.floor(w/2),back+2))-gridDistance(field,b,at(Math.floor(w/2),back+2))||a-b).slice(0,3);
    const reserve=inside.filter(p=>!core.includes(p)&&(defender === 'enemy' ? Math.floor(p/w) : h-1-Math.floor(p/w))!==front-1).slice(0,w-3);
    field.city={shape:'enclosure',inside,frontline:perimeter,gates,core,reserve,defender};
    field.objective={kind:'control',cell:core[0]!,cells:core,attackingSide,rounds:2,limit:field.objective.limit};
    for (const p of inside) if (!core.includes(p) && rng.next()<.06) field.structures![p]=createStructure('cover',level);
  } else if (scene === 'trenches') {
    for (const base of [Math.floor(h*.3),Math.floor(h*.7)]) {
      const turn=int(2,Math.max(2,w-3)), offset=int(0,1);
      // Connected dog-leg fighting line, not repeated isolated single-cell stamps.
      for (let x=1;x<w-1;x++) {
        const d=base+(x>=turn?offset:0); field.structures![at(x,d)]=createStructure('fortification',level);
        if (x===turn && offset) field.structures![at(x,base)]=createStructure('fortification',level);
      }
      const rearward=base<h/2?-1:1;
      for (const startX of [int(1,Math.floor(w/2)),int(Math.floor(w/2)+1,w-2)]) {
        let x=startX, d=base+(x>=turn?offset:0);
        while (d+rearward>=1 && d+rearward<h-1) {
          d+=rearward; field.structures![at(x,d)]=createStructure('fortification',level);
          if (Math.abs(d-base)%3===2) { x=Math.max(1,Math.min(w-2,x+(rng.next()<.5?-1:1))); field.structures![at(x,d)]=createStructure('fortification',level); }
        }
      }
    }
    // Crater patches in no-man's-land, with a clear crossing strip.
    for (let n=0;n<int(2,4);n++) {
      const p=at(int(0,w-2),int(Math.floor(h*.42),Math.floor(h*.57)));
      for (const q of [p,...neighbors(field,p).slice(0,2)]) if (!field.structures![q]&&q!==center&&q%w!==Math.floor(w/2)) {
        field.tiles[q]='rough';field.overlays[q]=['rubble'];
      }
    }
  }
}
