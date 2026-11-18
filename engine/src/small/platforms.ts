import { boardingReason, platformKinds, unitCount, validatePlatform, type Ride } from '../platforms.js';
import type { Combatant } from '../types.js';
import { weaponReloadKey } from '../loadout.js';
import { controlPolicy, combatHostile } from '../battle-control.js';
import { availableSeats, takeSeats, detachMembers, type SeatRange } from './transport-groups.js';
import { canOccupy, neighbors } from './spatial.js';
import type { SmallBattle } from './battle.js';

export interface RideAction { kind: 'board'|'leave'|'select'; id: string; label: string; maxCount?: number }

export class SmallPlatforms {
  constructor(private battle: SmallBattle) {}
  private get units() { return this.battle.combatants; }
  carrier(u: Combatant): Combatant | undefined {
    return u.ride && this.units.find(p => p.id === u.ride!.platformId);
  }
  role(u: Combatant): string {
    if (u.platform) return platformKinds[u.platform.kind];
    const carrier = this.carrier(u);
    if (carrier?.platform) return carrier.platform.kind === 'animal' ? '骑手' : '乘员';
    return '';
  }
  canDrive(rider: Combatant, carrier: Combatant): boolean {
    return !['charmed','confused'].includes(controlPolicy(rider) ?? '') && !controlPolicy(carrier) && !combatHostile(rider,carrier,this.units);
  }
  canMoveIndependently(unit: Combatant): boolean {
    const carrier = this.carrier(unit);
    return !carrier || unit.ride?.mode === 'mount' && this.canDrive(unit,carrier);
  }
  mover(u: Combatant): Combatant {
    return u.ride?.mode === 'mount' ? this.carrier(u) ?? u : u;
  }
  private passengers(carrier: Combatant) { return this.units.filter(u => u.ride?.platformId === carrier.id); }
  sheltered(u: Combatant): boolean { return !!u.ride && (u.ride.stranded === true || this.carrier(u)?.platform?.kind === 'transport'); }
  private free(carrier: Combatant, except: Combatant): SeatRange[] {
    const occupied = this.passengers(carrier).filter(u => u !== except && u.hp > 0).flatMap(u => takeSeats(u.ride?.seats ?? [],unitCount(u)));
    return availableSeats(occupied,(carrier.seats ?? 1)*unitCount(carrier));
  }
  private split(u: Combatant,count: number): Combatant {
    let n = 1;
    const root = u.transportOrigin ?? u.id;
    while (this.units.some(c => c.id === root + ':part:' + n)) n++;
    const minimum = this.battle.xpMinimum.get(u.id) ?? u.hp;
    const part = detachMembers(u,count,root + ':part:' + n);
    part.transportReadyRound = this.battle.round + 1;
    this.units.push(part);
    if (this.battle.allyAiControl.has(u.id)) this.battle.allyAiControl.set(part.id,this.battle.allyAiControl.get(u.id)!);
    this.battle.logTransport(u,'分出'+part.name+' '+count+'人，原队余'+unitCount(u)+'人',part);
    this.battle.reactionSpent.add(part.id);
    for (const weapon of [u.weapon,u.sidearm]) {
      const cooldown = this.battle.reloadCd.get(weaponReloadKey(u,weapon));
      if (cooldown) this.battle.reloadCd.set(weaponReloadKey(part,weapon),cooldown);
    }
    const transferred = Math.max(0,minimum-u.hp);
    this.battle.xpMinimum.set(part.id,transferred); this.battle.xpMinimum.set(u.id,minimum-transferred);
    return part;
  }
  bind(u: Combatant, carrier: Combatant, mode: Ride['mode'], previous?: Ride): void {
    u.ride = {platformId:carrier.id,mode,seats:previous?.seats ?? takeSeats(this.free(carrier,u),unitCount(u)),...(previous?.stranded && {stranded:true})};
    u.mount = carrier.platform?.kind === 'animal';
    // All movement paths, including forced movement and snapshots, read the same cell.
    Object.defineProperty(u,'pos',{configurable:true,enumerable:true,get:() => carrier.pos,
      set:(pos: number | undefined) => { if (u.ride?.mode === 'mount') carrier.pos = pos; }});
    u.airborne = carrier.airborne; u.elevation = carrier.elevation;
  }
  restore(): void {
    for (const u of this.units) if (u.ride) {
      validatePlatform(u);
      const carrier = this.carrier(u);
      if (!carrier?.platform || carrier.ride || carrier.side !== u.side) throw Error(u.name + '的平台档案无效');
      // Trim seats freed by casualties since the most recent action.
      if (u.ride.seats) u.ride.seats = takeSeats(u.ride.seats,unitCount(u));
      this.bind(u,carrier,u.ride.mode,u.ride);
    }
    for (const carrier of this.units.filter(u => u.platform)) {
      const used = this.passengers(carrier).flatMap(u => u.ride!.seats ?? []).sort((a,b) => a[0]-b[0]);
      let next = 0;
      for (const [start,count] of used) {
        if (start < next || start+count > (carrier.seats ?? 1)*unitCount(carrier)) throw Error(carrier.name+'的座位重叠或超出容量');
        next = start+count;
      }
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
  reconcile(carrier: Combatant, blast = false, source?: Combatant): void {
    const b = this.battle;
    if (carrier.ride && (carrier.hp <= 0 || carrier.status === 'dead')) {
      const platform = this.carrier(carrier)!;
      this.release(carrier,platform.pos!);
      b.logTransport(carrier,'失能，解除与'+platform.name+'的骑乘关系',platform);
    }
    if (!carrier.platform) return;
    const capacity = (carrier.seats ?? 1)*unitCount(carrier);
    for (const u of this.passengers(carrier)) {
      if (u.hp <= 0 || u.status === 'dead') { this.release(u,carrier.pos!); continue; }
      if (carrier.status === 'fled') {
        if (u.status !== 'fled') { u.status = 'fled'; b.logTransport(u,'随'+carrier.name+'撤离战场，人数'+unitCount(u),carrier); }
        continue;
      }
      const ride = u.ride!, before = takeSeats(ride.seats ?? [],unitCount(u));
      const retained: SeatRange[] = before.flatMap(([start,n]) => start < capacity ? [[start,Math.min(n,capacity-start)] as SeatRange] : []);
      const stillAboard = retained.reduce((sum,[,n]) => sum+n,0);
      ride.seats = retained;
      if (stillAboard === unitCount(u)) continue;
      const expelled = stillAboard ? this.split(u,unitCount(u)-stillAboard) : u;
      if (expelled !== u) this.bind(expelled,carrier,'aboard',{...ride,seats:[]});
      const first = !expelled.ride!.stranded;
      expelled.ride!.stranded = true;
      if (first && blast && carrier.platform.kind === 'transport') b.transportBlast(expelled,carrier,source);
      if (!expelled.hp || !expelled.ride) continue;
      const cell = this.landing(expelled,carrier);
      if (cell !== undefined) {
        this.release(expelled,cell);
        b.logTransport(expelled,'因'+carrier.name+'损失座位撤离，现员'+unitCount(expelled),carrier);
      } else if (first) b.logTransport(expelled,'受困于'+carrier.name+'，等待合法落点',carrier);
    }
  }
  private boardingMode(carrier: Combatant): Ride['mode'] {
    return carrier.platform?.kind === 'animal' && !this.passengers(carrier).some(u => u.hp > 0 && u.ride?.mode === 'mount') ? 'mount' : 'aboard';
  }
  options(actor: Combatant): RideAction[] {
    const b = this.battle, slot = b.turnOrder[b.turnIndex];
    if (!b.isTurnOf(actor.id) || actor.status !== 'ready' || b.isOver()) return [];
    const owner = this.units.find(u => u.id === slot)!;
    const ownCarrier = this.carrier(owner);
    const options: RideAction[] = [];
    if (owner.ride?.mode === 'mount' && ownCarrier && b.canSwitchPlatform(owner.id, ownCarrier.id) && !owner.ride.stranded && !controlPolicy(owner) && !controlPolicy(ownCarrier) && !combatHostile(owner,ownCarrier,this.units)) {
      const next = actor.id === owner.id ? ownCarrier : owner;
      if (!this.sheltered(next) && next.status === 'ready' && !b.actedThisTurn.has(actor.id))
        options.push({kind:'select',id:next.id,label:'使用'+next.name+'的行动'});
    }
    if (controlPolicy(actor) === 'charmed' || controlPolicy(actor) === 'confused' || owner !== actor && (controlPolicy(owner) || controlPolicy(actor))) return options;
    if (owner.ride && ownCarrier && !ownCarrier.airborne && b.transportMovementAvailable(actor.id,owner) && this.landing(owner,ownCarrier) !== undefined) {
      options.push({kind:'leave',id:owner.id,maxCount:unitCount(owner),label:ownCarrier.platform!.kind === 'animal' ? '下马' : '下车'});
    } else if (!owner.ride && !owner.platform && !owner.airborne && b.transportMovementAvailable(actor.id)) {
      for (const p of this.units) if (p.platform && p.status === 'ready' && !p.airborne && p.elevation === actor.elevation
        && !combatHostile(actor,p,this.units) && b.dist(actor,p) <= (b.battlefield ? 1 : 0)) {
        const maxCount = Math.min(unitCount(actor),this.free(p,actor).reduce((n,[,count]) => n+count,0));
        const mode = this.boardingMode(p);
        if (maxCount > 0 && !boardingReason(this.units,{...actor,hp:actor.scale === 'hero' ? actor.hp : maxCount},p,mode))
          options.push({kind:'board',id:p.id,maxCount,label:(p.platform.kind === 'animal' ? '骑乘' : '搭乘')+p.name});
      }
    }
    return options;
  }
  act(actor: Combatant, kind: RideAction['kind'], id: string, requested?: number): void {
    const choice = this.options(actor).find(a => a.kind === kind && a.id === id);
    if (!choice) throw Error('当前不能执行该骑乘操作');
    const b = this.battle, target = b.byId(id);
    const count = requested ?? choice.maxCount ?? 1;
    if (!Number.isSafeInteger(count) || count < 1 || count > (choice.maxCount ?? 1)) throw Error('乘降人数超出可用人数或座位');
    if (kind === 'select') {
      b.selectPlatformActor(actor.id,id); b.logTransport(actor,'交由'+target.name+'行动',target);
    } else if (kind === 'leave') {
      const carrier = this.carrier(target)!;
      const cell = this.landing(target,carrier)!;
      if (actor !== target) b.selectPlatformActor(actor.id,target.id);
      const leaving = count < unitCount(target) ? this.split(target,count) : target;
      if (leaving !== target) target.ride!.seats = takeSeats(target.ride!.seats ?? [],unitCount(target));
      this.release(leaving,cell);
      b.spendTransportMovement(target.id);
      b.logTransport(leaving,choice.label+'，离开'+carrier.name+'，人数'+count,carrier);
    } else {
      if (count < unitCount(actor)) this.split(actor,unitCount(actor)-count);
      const mode = this.boardingMode(target);
      this.bind(actor,target,mode);
      if (mode === 'mount') b.attachDuringTurn(target.id);
      b.spendTransportMovement(actor.id);
      b.logTransport(actor,choice.label+'，人数'+count,target);
    }
  }
}
