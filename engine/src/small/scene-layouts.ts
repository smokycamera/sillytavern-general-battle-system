import type { SeededRng } from '../rng.js';
import { BattlefieldPlanError, type BattlefieldPlan, type GatePlan } from './battlefield-plan.js';
import type { BattlefieldScene } from './map-design.js';
import { createStructure, groundBlocked } from './layers.js';
import { gridDistance, neighbors, type BattlefieldSpec } from './spatial.js';

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
    for (const n of neighbors(field,p)) if (field.structures![n]?.kind === 'building') field.structures![n] = null;
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
    // A continuous hall with coherent side rooms. Open doorways remain when gatePlan is empty.
    const spine = Math.max(2, Math.min(w-3, Math.floor(w/2) + int(-1,1)));
    const corridorWidth = plan?.breadth === 'broad' && w >= 9 ? 2 : 1;
    const walls = [spine-1, Math.min(w-2, spine+corridorWidth)];
    const step = plan?.layout === 'strongpoint' ? 5 : int(3,4), doorways: number[] = [];
    for (let d=2; d<h-2; d++) for (const x of walls) field.structures![at(x,d)] = createStructure('building',level);
    for (const [side,xWall] of walls.entries()) {
      for (let start=1; start<h-2; start+=step) {
        const end = Math.min(h-2,start+step), doorD = Math.min(h-3,start+1);
        const door = at(xWall,doorD); field.structures![door] = null; doorways.push(door);
        if (end<h-2) for (let x=side ? xWall+1 : 0; x<(side ? w : xWall); x++) field.structures![at(x,end)] = createStructure('building',level);
      }
    }
    for (let d=0;d<h;d++) for (let x=spine;x<spine+corridorWidth;x++) field.overlays[at(x,d)] = ['road'];
    // The primary hall and objective are never sealed by a door.
    field.objective.cell = at(spine,Math.floor(h/2));
    placePlannedGates(field,doorways,legacyGatePlan(plan,[{sector:'left',state:'open'},{sector:'right',state:'open'}]),defender,level,[],false);
    // Furnishings stay on room edges and away from entrances/deployment rows.
    const density = {sparse:.18,balanced:.35,dense:.55}[plan?.cover ?? plan?.density ?? 'balanced'];
    for (let d=3; d<h-3; d++) for (const x of [0,w-1]) {
      const p=at(x,d); if (!field.structures![p] && rng.next()<density) field.structures![p]=createStructure('cover',level);
    }
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
