import { boardingReason, unitCount, type Ride } from '../platforms.js';
import type { Combatant } from '../types.js';
import { canOccupy, neighbors } from './spatial.js';
import type { SmallBattle } from './battle.js';

export interface RideAction { kind: 'board'|'leave'|'select'; id: string; label: string }

export class SmallPlatforms {
  constructor(private battle: SmallBattle) {}
  private get units() { return this.battle.combatants; }
  carrier(u: Combatant): Combatant | undefined {
    return u.ride && this.units.find(p => p.id === u.ride!.platformId);
  }
  mover(u: Combatant): Combatant {
    return u.ride?.mode === 'mount' ? this.carrier(u) ?? u : u;
  }
  private passengers(carrier: Combatant) { return this.units.filter(u => u.ride?.platformId === carrier.id); }
  sheltered(u: Combatant): boolean { return !!u.ride && this.carrier(u)?.platform?.kind === 'transport'; }
  bind(u: Combatant, carrier: Combatant, mode: Ride['mode']): void {
    u.ride = {platformId:carrier.id,mode};
    u.mount = mode === 'mount' && carrier.platform?.kind === 'animal';
    // All movement paths, including forced movement and snapshots, read the same cell.
    Object.defineProperty(u,'pos',{configurable:true,enumerable:true,get:() => carrier.pos,
      set:(pos: number | undefined) => { if (u.ride?.mode === 'mount') carrier.pos = pos; }});
    u.airborne = carrier.airborne; u.elevation = carrier.elevation;
  }
  restore(): void {
    for (const u of this.units) if (u.ride) {
      const carrier = this.carrier(u);
      if (!carrier?.platform || carrier.ride || carrier.side !== u.side) throw Error(u.name + '的平台档案无效');
      this.bind(u,carrier,u.ride.mode);
    }
  }
  syncLayers(): void {
    for (const u of this.units) if (u.ride) {
      const carrier = this.carrier(u)!;
      u.airborne = carrier.airborne; u.elevation = carrier.elevation;
    }
  }
  private landing(u: Combatant, carrier: Combatant): number | undefined {
    const field = this.battle.battlefield, origin = carrier.pos;
    if (!field || origin === undefined) return origin;
    const foot = {...u,ride:undefined,mount:false,airborne:false,elevation:undefined};
    return [origin,...neighbors(field,origin)].find(cell => canOccupy(field,this.units,foot,cell));
  }
  private release(u: Combatant, cell: number): void {
    delete u.ride; u.mount = false; delete u.airborne; delete u.elevation;
    Object.defineProperty(u,'pos',{configurable:true,enumerable:true,writable:true,value:cell});
  }
  reconcile(carrier: Combatant): void {
    if (!carrier.platform) return;
    let capacity = (carrier.seats ?? 1) * unitCount(carrier);
    for (const u of this.passengers(carrier)) {
      if (carrier.status === 'fled') u.status = 'fled';
      if (carrier.hp > 0 && capacity >= unitCount(u)) { capacity -= unitCount(u); continue; }
      const cell = this.landing(u, carrier);
      if (cell !== undefined) this.release(u,cell);
    }
  }
  options(actor: Combatant): RideAction[] {
    const b = this.battle, slot = b.turnOrder[b.turnIndex];
    if (!b.isTurnOf(actor.id) || actor.status !== 'ready' || b.isOver()) return [];
    const owner = this.units.find(u => u.id === slot)!;
    const ownCarrier = this.carrier(owner);
    const options: RideAction[] = [];
    if (owner.ride?.mode === 'mount' && ownCarrier) {
      const next = actor.id === owner.id ? ownCarrier : owner;
      if (!this.sheltered(next) && next.status === 'ready' && !b.actedThisTurn.has(actor.id))
        options.push({kind:'select',id:next.id,label:'使用'+next.name+'的行动'});
    }
    if (owner.ride && ownCarrier && !ownCarrier.airborne && b.transportMovementAvailable(actor.id,owner) && this.landing(owner,ownCarrier) !== undefined) {
      options.push({kind:'leave',id:owner.id,label:ownCarrier.platform!.kind === 'animal' ? '下马' : '下车'});
    } else if (!owner.ride && !owner.platform && !owner.airborne && b.transportMovementAvailable(actor.id)) {
      for (const p of this.units) if (p.platform && p.status === 'ready' && !p.airborne && p.elevation === actor.elevation
        && b.dist(actor,p) <= (b.battlefield ? 1 : 0) && !boardingReason(this.units,actor,p,'aboard'))
        options.push({kind:'board',id:p.id,label:'搭乘'+p.name});
    }
    return options;
  }
  act(actor: Combatant, kind: RideAction['kind'], id: string): void {
    const choice = this.options(actor).find(a => a.kind === kind && a.id === id);
    if (!choice) throw Error('当前不能执行该骑乘操作');
    const b = this.battle, target = b.byId(id);
    if (kind === 'select') b.selectPlatformActor(actor.id,id);
    else if (kind === 'leave') {
      const carrier = this.carrier(target)!;
      if (actor !== target) b.selectPlatformActor(actor.id,target.id);
      this.release(target,this.landing(target,carrier)!);
      b.spendTransportMovement(target.id);
    } else {
      this.bind(actor,target,'aboard');
      b.spendTransportMovement(actor.id);
    }
    b.logTransport(actor,choice.label);
  }
}
