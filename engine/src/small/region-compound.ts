import type { SeededRng } from '../rng.js';
import type { BattlefieldPlan } from './battlefield-plan.js';
import { BattlefieldPlanError } from './battlefield-error.js';
import { connectedCitySectors, regionCells } from './region-layout.js';
import { createStructure, groundBlocked } from './layers.js';
import { neighbors, gridDistance, type BattlefieldSpec } from './spatial.js';
import { gridPosition, inGridSector, type GridAnchor } from './grid-anchor.js';
import { worldAnchorCell } from './landmark-placement.js';
import type { PositionArea } from './position-plan.js';

/** Explicit numbered outlines are authoritative; room partitions vary inside that outline. */
export function buildRegionCompound(field: BattlefieldSpec, plan: BattlefieldPlan, rng: SeededRng, attackingSide: 'ally' | 'enemy'): number[] {
  const {width:w,height:h}=field,defender=attackingSide==='ally'?'enemy':'ally';
  const sectors=connectedCitySectors(plan.citySectors!,plan.waterSectors);
  const footprint=new Set(regionCells(field,sectors).filter(p=>p%w>0&&p%w<w-1&&p>=w&&p<w*(h-1)));
  const perimeter=[...footprint].filter(p=>neighbors(field,p).some(n=>!footprint.has(n))),rim=new Set(perimeter);
  const inside=[...footprint].filter(p=>!rim.has(p)),floor=new Set(inside),level=plan.fortLevel??3;
  const connected=(cells:readonly number[])=>{
    if(!cells.length)return false;
    const available=new Set(cells),queue=[cells[0]!];available.delete(queue[0]!);
    for(let i=0;i<queue.length;i++)for(const n of neighbors(field,queue[i]!))if(available.delete(n))queue.push(n);
    return !available.size;
  };
  if(!connected(inside)||sectors.some(a=>!inside.some(p=>inGridSector(a,w,h,p%w,Math.floor(p/w)))))
    throw new BattlefieldPlanError('院落分区内部连通容量不足，需要扩大地图');
  for(const p of footprint){field.tiles[p]='street';field.structures![p]=rim.has(p)?createStructure('wall',level,{owner:defender,top:false}):null;}
  const passages:number[]=[],parts:number[][]=[inside],pattern=plan.compound?.pattern??'courtyard';
  const marks=(plan.landmarks??[]).filter(m=>gridPosition(m.anchor)&&['room','building','square'].includes(m.kind)
    &&inside.some(p=>inGridSector(m.anchor,w,h,p%w,Math.floor(p/w))));
  const requested=Math.max(2,marks.length,2+Math.floor(rng.next()*5));
  // Recursive cuts use actual connected floor components, rather than a fixed house/courtyard floor plan.
  while(parts.length<requested){
    const ranked=parts.map((cells,i)=>({cells,i,rank:cells.length*(.8+rng.next()*.4)})).sort((a,b)=>b.rank-a.rank);
    let divided=false;
    for(const part of ranked){
      const choices:{lo:number[];hi:number[];wall:number[];doors:number[];rank:number}[]=[];
      for(const axis of [0,1]){
        const value=(p:number)=>axis===0?p%w:Math.floor(p/w),values=[...new Set(part.cells.map(value))];
        for(const cut of values){
          const lo=part.cells.filter(p=>value(p)<cut),hi=part.cells.filter(p=>value(p)>cut),wall=part.cells.filter(p=>value(p)===cut);
          if(lo.length<2||hi.length<2||!connected(lo)||!connected(hi))continue;
          const left=new Set(lo),right=new Set(hi),doors=wall.filter(p=>neighbors(field,p).some(n=>left.has(n))&&neighbors(field,p).some(n=>right.has(n)));
          if(!doors.length)continue;
          const preferred=pattern==='wings'?axis===0:pattern==='forecourt'?axis===1:false;
          choices.push({lo,hi,wall,doors,rank:rng.next()+Number(preferred)*.3});
        }
      }
      const cut=choices.sort((a,b)=>b.rank-a.rank)[0];if(!cut)continue;
      for(const p of cut.wall)field.structures![p]=createStructure('wall',level,{owner:defender,top:false});
      const doors=[cut.doors[Math.floor(rng.next()*cut.doors.length)]!];
      if(cut.doors.length>=5&&rng.next()<.4){const other=cut.doors.filter(p=>gridDistance(field,p,doors[0]!)>=3);if(other.length)doors.push(other[Math.floor(rng.next()*other.length)]!);}
      for(const p of doors){field.structures![p]=createStructure('gate',level,{owner:defender,top:false,gateState:'open'});passages.push(p);}
      parts.splice(part.i,1,cut.lo,cut.hi);divided=true;break;
    }
    if(!divided)break;
  }
  if(parts.length<Math.max(2,marks.length))throw new BattlefieldPlanError('院落房间分区容量不足，需要扩大地图');
  const depth=(p:number)=>defender==='enemy'?Math.floor(p/w):h-1-Math.floor(p/w);
  parts.sort((a,b)=>Math.min(...a.map(depth))-Math.min(...b.map(depth))||a[0]!-b[0]!);
  const courts=pattern==='forecourt'||pattern==='bailey'?2:1;
  const areas:PositionArea[]=parts.map((cells,i)=>({kind:i>=Math.max(1,parts.length-courts)?'court':'room',label:i===0?'主屋':i>=Math.max(1,parts.length-courts)?'院落':`房间${i}`,cells}));
  const used=new Set<number>();
  for(const mark of marks){
    const anchor=worldAnchorCell(field,mark.anchor as GridAnchor);
    const choices=areas.map((area,i)=>({area,i,overlap:area.cells.filter(p=>inGridSector(mark.anchor,w,h,p%w,Math.floor(p/w))).length,
      distance:Math.min(...area.cells.map(p=>gridDistance(field,p,anchor)))})).filter(v=>!used.has(v.i)&&v.overlap>0).sort((a,b)=>b.overlap-a.overlap||a.distance-b.distance||a.i-b.i);
    const chosen=choices[0];if(!chosen)throw new BattlefieldPlanError(`地点${mark.label??mark.kind}的院落分区容量不足`);
    chosen.area.kind=mark.kind==='square'?'court':'room';chosen.area.label=mark.label??chosen.area.label;used.add(chosen.i);
  }
  // Every legal exterior entrance keeps a walkable apron; partitions may not silently plug the wall's gates.
  const candidates=perimeter.filter(p=>neighbors(field,p).some(n=>floor.has(n)&&!groundBlocked(field,n))&&neighbors(field,p).some(n=>!footprint.has(n)));
  if(!candidates.length)throw new BattlefieldPlanError('院落外门部署容量不足');
  const core=areas.find(a=>a.kind==='room')?.cells.slice(0,3)??areas[0]!.cells.slice(0,3);
  const protectedFloor=new Set([...core,...passages,...passages.flatMap(p=>neighbors(field,p)),...candidates.flatMap(p=>neighbors(field,p))]);
  for(const p of inside)if(!protectedFloor.has(p)){
    if(pattern==='ruined'&&field.structures![p]?.kind==='wall'&&rng.next()<.25){field.structures![p]=null;field.overlays![p]=['rubble'];}
    else if(!field.structures![p]&&rng.next()<(plan.density==='dense'?.12:plan.density==='sparse'?.025:.06))field.structures![p]=createStructure('cover',level);
  }
  field.city={shape:'enclosure',inside,frontline:perimeter,gates:[],core,reserve:inside.filter(p=>!core.includes(p)&&!groundBlocked(field,p)),defender};
  field.objective={kind:'control',cell:core[0]!,cells:core,attackingSide,rounds:2,limit:field.objective.limit};
  field.generation!.version=12;
  field.generation!.compound={pattern,areas,passages:[...passages],internalDoors:[...passages]};
  return candidates;
}
