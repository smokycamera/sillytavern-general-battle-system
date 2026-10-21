import { SmallBattle, intentPlace, intactStructure, gridDistance, gridWeapon, MEMBER_HEALTH_MODEL, isRangedCapable, weaponRangeSpec, type Combatant, type Side, type UnitIntent } from '../../engine/src/index.js';
import { CommandCancelled, commandObservation, compactCommandMap, unitSummary, updateCommandMemory, type CommanderState, type LlmCommandController } from './llm-command.js';
import type { LlmSettings } from './llm-settings.js';
import type { CommandMessage } from './jev-connection.js';
import { battleAbilities } from './battle-skills.js';
import { incomingDiplomacy, playerLetters, latestLetter } from '../../engine/src/diplomacy.js';
import { commandDiplomacy, commandLetters } from './llm-diplomacy.js';

const present = (u: Combatant) => ['ready', 'routing'].includes(u.status);
/** Stable short names within this commander's view; actual save/engine identities stay intact. */
class IntentIds {
  private short = new Map<string, string>();
  private full = new Map<string, string>();
  constructor(own: Combatant[], opponents: string[]) {
    const groups: [string, string[]][] = [['u', own.map(u => u.id)], ['e', opponents], ['a', own.flatMap(u => u.abilities.map(a => a.id))]];
    const reserved = new Set(groups.flatMap(([, ids]) => ids));
    for (const [prefix, ids] of groups) {
      let next = 1;
      for (const id of new Set(ids)) {
        if (this.short.has(id)) continue;
        let alias = id;
        if (!/^[uea]\d+$/.test(id)) {
          while (reserved.has(prefix + next) || this.full.has(prefix + next)) next++;
          alias = prefix + next++;
        }
        this.short.set(id, alias); this.full.set(alias, id);
      }
    }
  }
  private translate(value: unknown, ids: Map<string, string>): unknown {
    if (typeof value === 'string') return ids.get(value) ?? value;
    if (Array.isArray(value)) return value.map(v => this.translate(v, ids));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [ids.get(k) ?? k, k === 'text' || k === 'letters' ? v : this.translate(v, ids)]));
    return value;
  }
  encode = (value: unknown): unknown => this.translate(value, this.short);
  decode = (value: Record<string, unknown>): Record<string, unknown> => this.translate(value, this.full) as Record<string, unknown>;
}
export function intentForces(b: SmallBattle, side: Side): { heroes: Combatant[]; forces: Combatant[] } {
  const own = b.combatants.filter(u => u.side === side && present(u));
  const heroes = b.battlefield ? [] : own;
  return { heroes, forces: own.filter(u => !heroes.includes(u)) };
}

export class LlmIntentPlanner {
  private pending?: Promise<void>;
  private lastSeen?: Set<string>;
  private basisSeed?: string;
  constructor(readonly commander: LlmCommandController, private prompts: { intents: string }, private changed: () => void = () => {}) {}
  prefetch(b: SmallBattle, state: CommanderState, settings: LlmSettings, valid: () => boolean): void {
    if (state.decision && state.decision.round !== b.round) delete state.decision;
    const incoming = incomingDiplomacy(b, state.side).length > 0;
    const letters = playerLetters(b, state.side, state.memory.letterId).length > 0;
    if (letters && b.active?.side !== state.side) return;
    if (letters) { delete state.memory.intents; delete state.decision; delete state.memory.diplomacyRound; }
    if (incoming && state.memory.diplomacyRevision !== b.diplomacy.revision) delete state.memory.intents;
    if (!b.battlefield || b.isOver() || this.pending || this.commander.busy || !this.commander.available(b, settings, state)
      || state.decision || state.memory.diplomacyRound === b.round && !incoming && !letters
      || state.memory.intents?.round === b.round || !intentForces(b, state.side).forces.length) return;
    this.start(b, state, settings, valid);
  }
  async beforeHero(): Promise<void> { await this.pending; }
  async forUnit(b: SmallBattle, state: CommanderState, settings: LlmSettings, valid: () => boolean): Promise<UnitIntent | undefined> {
    this.prefetch(b, state, settings, valid);
    await this.pending;
    if (!valid()) throw new CommandCancelled();
    if (!this.commander.available(b, settings, state)) return;
    this.prefetch(b, state, settings, valid);
    await this.pending;
    if (!valid()) throw new CommandCancelled();
    const intents = state.memory.intents;
    if (!this.lastSeen || this.basisSeed !== b.seed) { this.lastSeen = new Set(state.memory.contacts?.map(u => u.id)); this.basisSeed = b.seed; }
    if (settings.commandInterval === 'situation' && intents?.round === b.round && !intents.replanned) {
      const visible = b.visibleCombatants(state.side).filter(u => u.side !== state.side);
      const reason = visible.some(u => !intents.basis.visible.includes(u.id) && !this.lastSeen!.has(u.id)) ? '首次发现新对手'
        : Object.values(intents.units).some(i => ['attack', 'use_ability'].includes(i.mode) && !b.combatants.some(u => u.id === i.targetId && (present(u) || i.mode === 'use_ability' && u.status === 'dying'))) ? '意图目标已退场'
        : intents.basis.friends.some(id => !b.combatants.some(u => u.id === id && present(u))) ? '己方单位已退场' : undefined;
      if (reason) { this.start(b, state, settings, valid, reason); await this.pending; }
    }
    if (!valid()) throw new CommandCancelled();
    const current = state.memory.intents;
    return this.commander.available(b, settings, state) && current?.round === b.round ? current.units[b.active!.id] : undefined;
  }
  private start(b: SmallBattle, state: CommanderState, settings: LlmSettings, valid: () => boolean, reason?: string): void {
    const pending = this.plan(b, state, settings, valid, reason).catch(error => { if (!(error instanceof CommandCancelled)) throw error; });
    this.pending = pending;
    void pending.finally(() => { if (this.pending === pending) this.pending = undefined; });
  }
  private async plan(b: SmallBattle, state: CommanderState, settings: LlmSettings, valid: () => boolean, reason?: string): Promise<void> {
    const round = b.round, letter = latestLetter(b, state.side);
    const current = () => valid() && b.round === round && !b.isOver() && latestLetter(b, state.side) === letter;
    const result = await this.commander.run(b, settings, current, `指挥官 ${state.brief.name} 正在部署第${round}轮意图…`, async signal => {
      const candidate = SmallBattle.fromSnapshot(structuredClone(b.toSnapshot()), { traitRegistry: b.traitRegistry, summonUnit: b.summonUnit });
      Object.assign(candidate, { rules: b.rules }); b.conditions.all().forEach(c => candidate.conditions.register(c));
      const command = structuredClone(state), previous = command.memory.intents?.units;
      const { forces } = intentForces(candidate, state.side), field = candidate.battlefield!;
      const seen = new Set(command.memory.contacts?.map(u => u.id));
      for (const trace of candidate.enemyIntel(state.side).traces) seen.add(trace.id);
      command.memory = updateCommandMemory(candidate, command.memory, state.side);
      const { map, ...observation } = commandObservation(candidate, undefined, state.side);
      const known = new Set([...command.memory.contacts!.map(u => u.id), ...candidate.enemyIntel(state.side).traces.map(t => t.id)]);
      const explored = new Set(command.memory.terrain.map(t => t.cell));
      const own = candidate.combatants.filter(u => u.side === state.side && present(u));
      const ownTargets = candidate.combatants.filter(u => u.side === state.side && (present(u) || u.status === 'dying'));
      const ids = new IntentIds(candidate.combatants.filter(u => u.side === state.side), [...known]);
      const units: Record<string, UnitIntent> = {};
      let submissions = 0;
      const apply = (args: Record<string, unknown>) => {
        submissions++;
        const errors: { unitId?: string; error: string }[] = [];
        if (!Array.isArray(args.intents)) errors.push({ error: 'intents须为数组' });
        else for (const raw of args.intents) {
          const item = raw as Record<string, unknown> | null;
          const unit = forces.find(u => u.id === (item?.unit ?? item?.unitId));
          if (!unit) { errors.push({ error: 'unitId须为forces中的部队' }); continue; }
          const mode = ({ open: 'open_gate', close: 'close_gate', use: 'use_ability' } as Record<string, string>)[String(item!.mode)] ?? item!.mode;
          const cell = item!.cell, targetId = mode === 'support' ? item!.targetId : item!.target ?? item!.targetId;
          const supportId = mode === 'support' ? item!.target ?? item!.supportId : item!.supportId;
          const abilityId = item!.skill ?? item!.abilityId;
          const ability = unit.abilities.find(a => a.id === abilityId);
          let error: string | undefined;
          if (typeof mode !== 'string' || !['attack', 'advance', 'hold', 'withdraw', 'support', 'open_gate', 'close_gate', 'use_ability'].includes(mode)) error = 'mode须为支持的意图';
          else if (mode === 'use_ability' && (typeof targetId !== 'string' || !known.has(targetId) && !ownTargets.some(u => u.id === targetId))) error = 'target须为本阵营单位或已知对手';
          else if (mode !== 'use_ability' && (mode === 'attack' || targetId !== undefined) && (typeof targetId !== 'string' || !known.has(targetId))) error = 'target须为已知对手';
          else if (mode === 'use_ability' && (typeof abilityId !== 'string' || !ability)) error = 'skill须为本单位的技能或道具动作编号';
          else if (mode === 'use_ability' && ability!.target === 'self' && targetId !== unit.id) error = '该动作只能对自己使用';
          else if (mode === 'use_ability' && ability!.target === 'ally' && !ownTargets.some(u => u.id === targetId)) error = '该动作须对己方单位使用';
          else if (mode === 'use_ability' && ability!.target === 'enemy' && ownTargets.some(u => u.id === targetId)) error = '该动作须对对手使用';
          else if (['advance', 'hold', 'withdraw'].includes(mode) && (!Number.isSafeInteger(cell) || (cell as number) < 0 || (cell as number) >= field.tiles.length || explored.has(cell as number) && !intentPlace(field, unit, cell as number))) error = 'cell须在地图内；已知地点须可站立';
          else if (['open_gate', 'close_gate'].includes(mode) && (!Number.isSafeInteger(cell) || !explored.has(cell as number) || intactStructure(field, cell as number)?.kind !== 'gate')) error = 'cell须为已探索的门格';
          else if ((mode === 'support' || supportId !== undefined) && !own.some(u => u.id === supportId)) error = 'target须为在场的己方单位';
          else if (cell !== undefined && (!Number.isSafeInteger(cell) || (cell as number) < 0 || (cell as number) >= field.tiles.length)) error = 'cell须在地图内';
          if (error) { errors.push({ unitId: unit.id, error }); continue; }
          units[unit.id] = { mode: mode as UnitIntent['mode'], ...(typeof targetId === 'string' ? { targetId } : {}),
            ...(Number.isSafeInteger(cell) ? { cell: cell as number } : {}), ...(typeof supportId === 'string' ? { supportId } : {}), ...(typeof abilityId === 'string' ? { abilityId } : {}) };
        }
        const missing = forces.filter(u => !units[u.id]).map(u => u.id);
        return { ...(submissions >= 2 || !errors.length && !missing.length ? { done: true } : {}), result: { accepted: Object.keys(units), errors, missing } };
      };
      const conversation: CommandMessage[] = [{ role: 'system', content: this.prompts.intents }, { role: 'user', content: JSON.stringify(ids.encode({
        brief: command.brief, plan: command.memory.plan, map: compactCommandMap(map!.width, map!.height, command.memory.terrain), notes: command.memory.notes,
        lastSightings: command.memory.contacts?.filter(u => !observation.units.some(v => v.id === u.id)), round, ...(reason ? { reason } : {}),
        forces: forces.map(u => ({ ...unitSummary(observation.units.find(v => v.id === u.id)!), weapon: { name: u.weapon?.name, ranged: isRangedCapable(u), range: weaponRangeSpec(gridWeapon(u.weapon, candidate.rules.combatModel === MEMBER_HEALTH_MODEL, candidate.rules.armsModel), isRangedCapable(u)) },
          ...(battleAbilities(u).length ? { skills: battleAbilities(u).map(a => ({ id: a.id, name: a.name, target: a.target })) } : {}) })),
        letters: commandLetters(candidate, state.side, command.memory.letterId), diplomacy: commandDiplomacy(candidate, state.side), observation: { ...observation, units: observation.units.map(unitSummary) }, previous })) }];
      await this.commander.decide(candidate, undefined, command, 'intents', conversation, settings, current, signal, { left: 4 }, { check: () => {}, apply, encode: ids.encode, decode: ids.decode });
      const used = new Set<number>();
      for (const [id, intent] of Object.entries(units).sort(([a], [z]) => a.localeCompare(z))) {
        if (!['advance', 'hold', 'withdraw'].includes(intent.mode)) continue;
        const origin = intent.cell!, unit = candidate.byId(id);
        const place = intentPlace(field, unit, origin);
        if (!explored.has(origin)) {
          intent.cell = field.tiles.map((_, c) => c).filter(c => !used.has(c) && (!explored.has(c) || !!intentPlace(field, unit, c)))
            .sort((a, z) => gridDistance(field, origin, a) - gridDistance(field, origin, z) || a - z)[0] ?? origin;
          used.add(intent.cell); continue;
        }
        const cell = [...explored].filter(c => !used.has(c) && intentPlace(field, unit, c)?.layer === place!.layer)
          .sort((a, z) => gridDistance(field, origin, a) - gridDistance(field, origin, z) || a - z)[0] ?? origin;
        intent.cell = cell; used.add(cell);
      }
      command.memory.diplomacyRevision = candidate.diplomacy.revision;
      command.memory.letterId = latestLetter(candidate, state.side);
      if (!command.decision) command.memory.intents = { round, replanned: !!reason, basis: { visible: observation.units.filter(u => u.side !== 'friendly').map(u => u.id), friends: own.map(u => u.id) }, units };
      return { command, seen };
    });
    if (result && current()) { state.memory = result.command.memory; state.decision = result.command.decision; this.lastSeen = result.seen; this.basisSeed = b.seed; this.changed(); }
  }
}
