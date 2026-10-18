import { SmallBattle, MassBattle, generateUnit, type Combatant, type Side, type Trait, type ConditionDef, type RulePack } from '../../engine/src/index.js';
import { SeededRng } from '../../engine/src/rng.js';
import { executeMassPlan } from './battle-execution.js';
import type { OrderDrafts } from './formation-orders.js';

export type BattleStepRequest = {
  kind: 'small' | 'mass'; snap: Record<string, unknown>; rules: RulePack;
  traits: Map<string, Trait>; conditions: ConditionDef[]; summons: boolean;
  actorId?: string; drafts?: OrderDrafts; automatic?: boolean; expectedRound?: number;
};
export interface BattleStepResult { snap: Record<string, unknown>; conditions: ConditionDef[]; damageTaken?: [string, number][] }

/** V2's fallback reinforcement is seeded by the engine, including its identity. */
export function seededReinforcement(templateId: string, side: Side, seed: string, registry: Map<string, Trait>): Combatant | null {
  if (templateId !== 'reinforcement') return null;
  return generateUnit({ name: '随队预备', side, scale: seed.startsWith('mass:') ? 'company' : 'hero', hpMax: seed.startsWith('mass:') ? 10 : undefined,
    level: 3, rulesVersion: 'v2', traits: [], weaponClass: 'sword', weaponLevel: 4, armorTier: 2 }, { registry, seed }).unit;
}

/** Runs on a detached candidate. No host writes or main-thread state are accessed. */
export function computeBattleStep(request: BattleStepRequest): BattleStepResult {
  const summonUnit = request.summons ? (templateId: string, side: Side, seed?: string) => seed ? seededReinforcement(templateId, side, seed, request.traits) : null : undefined;
  const options = { traitRegistry: request.traits, summonUnit };
  const battle = request.kind === 'small' ? SmallBattle.fromSnapshot(request.snap, options) : MassBattle.fromSnapshot(request.snap, options);
  Object.assign(battle, { rules: request.rules });
  for (const condition of request.conditions) battle.conditions.register(condition);
  if (battle instanceof SmallBattle) {
    if (battle.active?.id !== request.actorId) throw Error('行动者已变化，请重新预览');
    battle.autoAction(request.actorId!);
  } else executeMassPlan(battle, request.drafts ?? {}, !!request.automatic, request.expectedRound);
  return { snap: battle.toSnapshot(), conditions: battle.conditions.all(), ...(battle instanceof MassBattle ? { damageTaken: [...battle.damageTaken] } : {}) };
}

/** Keep existing battle/unit/RNG references; UI-only control changes may arrive during computation. */
export function applyBattleStep(battle: SmallBattle | MassBattle, result: BattleStepResult): void {
  const options = { traitRegistry: battle.traitRegistry, summonUnit: battle.summonUnit };
  const restored = battle instanceof SmallBattle ? SmallBattle.fromSnapshot(result.snap, options) : MassBattle.fromSnapshot(result.snap, options);
  const originalUnits = battle.combatants, byId = new Map(originalUnits.map(unit => [unit.id, unit]));
  const units = restored.combatants.map(unit => {
    const original = byId.get(unit.id);
    if (!original) return unit;
    for (const key of Object.keys(original)) if (!(key in unit)) delete (original as unknown as Record<string, unknown>)[key];
    return Object.assign(original, unit);
  });
  originalUnits.splice(0, originalUnits.length, ...units);
  const rng = battle.rng, conditions = battle.conditions, rules = battle.rules;
  const controls = battle instanceof SmallBattle ? battle.allyAiControl : undefined;
  if (rng instanceof SeededRng && typeof result.snap.rngState === 'number') rng.setState(result.snap.rngState);
  for (const condition of result.conditions) conditions.register(condition);
  Object.assign(battle, restored, { combatants: originalUnits, rng, conditions, rules });
  if (battle instanceof SmallBattle) battle.allyAiControl = controls!;
  else battle.damageTaken = new Map(result.damageTaken);
}
