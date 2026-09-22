import { SmallBattle, MassBattle, type Combatant, type Order } from '../../engine/src/index.js';
import { cellLabel, neighbors, gridDistance } from '../../engine/src/small/spatial.js';
import { FORMATION_NODES, FORMATION_EDGES, formationNode } from '../../engine/src/mass/formation.js';
import { gridWeaponRange } from '../../engine/src/small/weapon-range.js';
import { diceAvg } from '../../engine/src/data/weapons.js';
import type { ActionPreview } from '../../engine/src/actions.js';
import type { ActionEnvelope, ActionReceipt, BattleAction, BattleAdapter, Goal, Observation, Commander } from '../../vendor/jev-core/src/index.js';
import { stable } from '../../vendor/jev-core/src/index.js';

type Battle = SmallBattle | MassBattle;
type Command = { action: BattleAction; run(): void };
const living = (u: Combatant) => !['dead', 'fled'].includes(u.status) && u.hp > 0;

/** Operates on a PRIVATE battle candidate. The panel commits battle + plan together. */
export class TavernJevAdapter implements BattleAdapter {
  readonly id = 'tavern-battle-v1';
  private receipts = new Map<string, ActionReceipt>();
  constructor(readonly battle: Battle, readonly side: 'ally' | 'enemy', readonly sessionId: string,
    private version: number, private signal: AbortSignal) {}
  private check(): void { if (this.signal.aborted) throw Error('JEV 指挥已取消'); }
  commanders(ability = 'skilled', style: Record<string, number> = {}): Commander[] {
    return [{ id: this.side, name: this.side === 'ally' ? '我方指挥官' : '敌方指挥官', side: this.side,
      unitIds: this.battle.combatants.filter(u => u.side === this.side && living(u)).map(u => u.id), ability, style }];
  }
  private location(u: Combatant): string {
    return this.battle instanceof SmallBattle ? String(u.pos ?? 0) : formationNode(this.battle.effectiveUnit(u)).id;
  }
  async observe(): Promise<Observation> {
    this.check();
    const b = this.battle, small = b instanceof SmallBattle, field = small ? b.battlefield : undefined;
    const locations = field ? field.tiles.map((terrain, cell) => ({ id: String(cell), label: cellLabel(field, cell),
      x: cell % field.width, y: Math.floor(cell / field.width), cover: ['cover', 'forest'].includes(terrain) ? 0.6 : 0,
      blocked: terrain === 'wall', neighbors: neighbors(field, cell).map(String) }))
      : small ? Array.from({length: 6}, (_, n) => ({ id: String(n), label: String(n), x: n, y: 0, cover: 0, blocked: false, neighbors: [n - 1, n + 1].filter(i => i >= 0 && i < 6).map(String) }))
      : FORMATION_NODES.map(n => ({ id: n.id, label: n.wing + '/' + n.rank, x: n.x, y: n.y, cover: 0, blocked: false, neighbors: FORMATION_EDGES.get(n.id) ?? [] }));
    // The model only receives this side's observation, never a union of both sides' vision.
    const visible = b.visibleCombatants(this.side).filter(u => u.side !== 'neutral' && living(u));
    const units = visible.map(u => ({ id: u.id, name: u.name, side: u.side, location: this.location(u), hp: u.hp, maxHp: u.base.hpMax,
      attack: u.weapon ? diceAvg(u.weapon.baseDice) : 1,
      range: small && field ? gridWeaponRange(u.weapon) : Math.max(1, u.weapon?.range ?? 1),
      ap: u.side === this.side && u.status === 'ready' && (small ? b.active?.id === u.id : !b.orders.has(u.id) && !b.isAttached(u.id)) ? 1 : 0,
      // Core uses ammo as availability only. Actual reload/resource rules stay in the engine.
      ammo: 1, tags: [...u.tags, ...(u.status === 'routing' ? ['evacuated'] : [])], speed: u.base.spd }));
    const goals: Goal[] = [{ id: 'battle-objective', title: '击败敌军并完成战场目标', kind: 'eliminate', side: this.side, source: 'host', version: 1, priority: 80 }];
    if (field?.objective.kind === 'control') {
      goals[0] = { ...goals[0]!, kind: field.objective.attackingSide && field.objective.attackingSide !== this.side ? 'defend' : 'capture', target: String(field.objective.cell), title: '控制战场目标' };
    } else if (field?.objective.kind === 'escape') {
      const escortId = field.objective.unitId;
      const escort = b.combatants.find(u => u.id === escortId);
      goals[0] = { ...goals[0]!, kind: escort?.side === this.side ? 'withdraw' : 'defend', target: String(field.objective.cell), title: escort?.side === this.side ? '护送目标到达出口' : '阻止目标离场' };
    }
    return { sessionId: this.sessionId, version: this.version, turn: b.round, activeSide: this.side, units, map: { kind: small ? 'grid' : 'formation', locations }, goals,
      events: [], ended: b.isOver(), winner: b.winner(),
      capabilities: { fullyObservable: false, mechanisms: { movement: true, 'ranged-fire': units.some(u => u.range > 1), ammo: false, morale: true, suppression: false, smoke: false },
        actionKinds: { move: ['move'], attack: ['attack'], wait: ['wait'], defend: ['defend'], support: ['support'] } },
    };
  }
  private features(unit: Combatant, preview?: ActionPreview, targetId?: string, destination?: string): BattleAction['features'] {
    const b = this.battle;
    const target = b.combatants.find(u => u.id === targetId);
    const known = b.visibleCombatants(this.side).filter(u => u.side !== this.side && u.side !== 'neutral' && living(u));
    const distance = (u: Combatant, at = this.location(unit)) => {
      if (b instanceof SmallBattle) return b.battlefield ? gridDistance(b.battlefield, Number(at), u.pos ?? 0) : Math.abs(Number(at) - (u.pos ?? 0));
      const from = FORMATION_NODES.find(n => n.id === at)!, to = formationNode(b.effectiveUnit(u));
      return Math.abs(from.x - to.x) + Math.abs(from.y - to.y);
    };
    const before = Math.min(30, ...known.map(u => distance(u)));
    const after = destination ? Math.min(30, ...known.map(u => distance(u, destination))) : before;
    return { damage: (preview?.expectedDamage ?? 0) / Math.max(1, target?.hp ?? 1),
      support: (preview?.healing ?? 0) / Math.max(1, target?.base.hpMax ?? unit.base.hpMax),
      initiative: Math.max(0, before - after) / 3, retreat: Math.max(0, after - before) / 3,
      objective: destination ? Math.max(0, before - after) / 6 : 0,
      risk: (preview?.fallChance ?? 0) + (preview?.fallDamage ?? 0) / Math.max(1, unit.hp),
      fire: preview?.expectedDamage ? 1 : 0, hold: 0 };
  }
  private smallCommands(b: SmallBattle): Command[] {
    const actor = b.active;
    if (!actor || actor.side !== this.side || b.isOver()) return [];
    const commands: Command[] = [];
    const add = (id: string, kind: string, run: () => void, targetId?: string, preview?: ActionPreview, destination?: string) => {
      commands.push({ action: { id: JSON.stringify([actor.id, id, targetId, destination]), unitId: actor.id, kind, cost: 1,
        ...(targetId ? {targetId} : {}), ...(destination ? {destination} : {}), features: this.features(actor, preview, targetId, destination) }, run });
    };
    if (actor.status !== 'ready') { add('end-turn', 'wait', () => b.endTurn()); return commands; }
    for (const option of b.getActionOptions(actor.id).filter(o => o.enabled)) {
      if (option.kind === 'move') {
        if (!b.battlefield) add(option.id, 'move', () => b.move(actor.id, option.id as 'advance' | 'withdraw'));
        continue;
      }
      const targets = option.targets?.filter(t => t.enabled) ?? [{ targetId: undefined, preview: option.preview }];
      for (const target of targets) {
        if (target.targetId && b.byId(target.targetId).side === 'neutral') continue;
        const done = (operation: () => void) => () => { operation(); if (!b.isOver() && b.active?.id === actor.id) b.endTurn(); };
        if (option.kind === 'weapon' || option.kind === 'charge') add(option.id, 'attack', done(() => b.attack(actor.id, target.targetId!, { weaponMode: option.id === 'weapon:sidearm' ? 'sidearm' : 'primary', charge: option.kind === 'charge' })), target.targetId, target.preview);
        else if (option.kind === 'ability') {
          const ability = actor.abilities.find(a => a.id === option.id)!;
          const kind = ability.target === 'enemy' ? 'attack' : 'support';
          add(option.id, kind, done(() => { const r = b.useAbility(actor.id, option.id, target.targetId); if (!r.ok) throw Error(r.reason); }), target.targetId, target.preview);
        } else if (option.kind === 'brace') add('brace', 'defend', done(() => b.brace(actor.id)));
        else if (option.kind === 'end-turn') add('end-turn', 'wait', () => b.endTurn());
        // Voluntary retreat needs an explicit withdraw plan; never infer surrender from low HP.
      }
    }
    if (b.battlefield) for (const path of b.reachableCells(actor.id)) {
      const cell = path.cells.at(-1)!;
      if (cell === actor.pos) continue;
      add('move', 'move', () => b.moveTo(actor.id, cell), undefined, undefined, String(cell));
    }
    return commands;
  }
  private massCommands(b: MassBattle): Command[] {
    const commands: Command[] = [];
    const known = b.visibleCombatants(this.side).filter(u => u.side !== 'neutral' && living(u));
    for (const actor of b.readyUnits(this.side).filter(u => !b.orders.has(u.id) && !b.isAttached(u.id))) {
      const candidates: Order[] = (['hold', 'brace', 'shift-left', 'shift-right', 'rank-forward', 'rank-back', 'takeoff', 'land'] as const).map(type => ({ unitId: actor.id, type, automatic: true }));
      for (const target of known.filter(u => u.side !== this.side)) for (const type of ['attack', 'charge', 'volley'] as const) candidates.push({ unitId: actor.id, type, targetId: target.id, automatic: true });
      for (const ability of actor.abilities) for (const target of ability.target === 'self' ? [actor] : ability.target === 'enemy' ? known.filter(u => u.side !== this.side) : ability.target === 'ally' ? known.filter(u => u.side === this.side) : [undefined])
        candidates.push({ unitId: actor.id, type: 'ability', abilityId: ability.id, ...(target ? {targetId: target.id} : {}), automatic: true });
      // Includes attached support heroes and engine-specific combinations.
      const recommended = b.recommendedOrder(actor.id); if (recommended) candidates.push({ ...recommended, automatic: true });
      const seen = new Set<string>();
      for (const order of candidates) {
        const id = stable(order); if (seen.has(id)) continue; seen.add(id);
        const preview = b.orderPreview(order); if (preview.reason) continue;
        const moving = ['shift-left', 'shift-right', 'rank-forward', 'rank-back'].includes(order.type);
        const abilityActor = b.combatants.find(u => u.id === (order.abilityActorId ?? order.unitId));
        const ability = abilityActor?.abilities.find(a => a.id === order.abilityId);
        const kind = moving ? 'move' : ['attack', 'charge', 'volley'].includes(order.type) || order.type === 'ability' && ability?.target === 'enemy' ? 'attack' : order.type === 'ability' ? 'support' : order.type === 'hold' ? 'wait' : 'defend';
        const destination = moving ? preview.destination?.id : undefined;
        commands.push({ action: { id, unitId: actor.id, kind, cost: 1, ...(order.targetId ? {targetId: order.targetId} : {}), ...(destination ? {destination} : {}),
          features: this.features(actor, {...preview.preview, healing: preview.healing, effects: preview.effects}, order.targetId, destination) },
          run: () => { const receipt = b.issue(order); if (!receipt.ok) throw Error(receipt.reason); } });
      }
    }
    return commands;
  }
  private commands(): Command[] { return this.battle instanceof SmallBattle ? this.smallCommands(this.battle) : this.massCommands(this.battle); }
  async legalActions(observation: Observation, unitIds: readonly string[]): Promise<BattleAction[]> {
    this.check(); if (observation.version !== this.version || observation.sessionId !== this.sessionId) return [];
    return this.commands().filter(c => unitIds.includes(c.action.unitId)).map(c => c.action);
  }
  async execute(envelope: ActionEnvelope): Promise<ActionReceipt> {
    this.check();
    const existing = this.receipts.get(envelope.key); if (existing) return structuredClone(existing);
    if (envelope.sessionId !== this.sessionId || envelope.stateVersion !== this.version) throw Error('JEV 战场版本已变化');
    const command = this.commands().find(c => stable(c.action) === stable(envelope.action));
    if (!command) throw Error('JEV 动作已不合法');
    command.run(); this.version++;
    const receipt: ActionReceipt = { key: envelope.key, actionId: envelope.action.id, stateVersion: this.version, applied: true, detail: '酒馆引擎已结算', execution: 'succeeded' };
    this.receipts.set(envelope.key, receipt); return structuredClone(receipt);
  }
  async receipt(key: string): Promise<ActionReceipt | null> { return structuredClone(this.receipts.get(key) ?? null); }
  async snapshot(): Promise<null> { return null; } // Host snapshot is saved once alongside the checkpoint.
  get stateVersion(): number { return this.version; }
}
