import { expect, it } from 'vitest';
import { generateUnit, SmallBattle, MassBattle, traitRegistry, standardField, applyXp, type Combatant } from '../../engine/src/index.js';
import { changeMorale, decideMorale, moraleProfile, setMoraleLock } from '../../engine/src/morale.js';
import { applyHealthLoss } from '../../engine/src/recovery.js';
import { SeededRng } from '../../engine/src/rng.js';
import { buildEncounter } from './game-encounter.js';
import { unitRecordFromCombatant, materializeUnitRecord } from './unit-state.js';
import { prepareBattleObjective } from './battle-setup.js';
import { narrativeProjection } from './narrative-controller.js';

const registry = traitRegistry();
function unit(id: string, side: 'ally' | 'enemy', scale: 'hero' | 'company'): Combatant {
  const u = generateUnit({ name: id, side, scale, level: 3, rulesVersion: 'v2', damageModel: 'wounds-v2', hpMax: scale === 'hero' ? 100 : 50, weaponClass: 'sword', traits: [] }, { seed: id, registry, noVariance: true }).unit;
  u.id = id;
  if (u.base.moraleMax !== undefined) u.morale = 10;
  return u;
}

it.each([['small', 'hero'], ['small', 'company'], ['mass', 'hero'], ['mass', 'company']] as const)('%s中%s主控锁满士气，受伤、恐惧、增减益及快照恢复不能降低士气', (mode, scale) => {
  const roster = [unit('first', 'ally', 'company'), unit('lead', 'ally', scale), unit('foe', 'enemy', 'company')];
  const before = JSON.stringify(roster);
  const battle = buildEncounter({ roster, protagonistId: 'lead', commanderId: 'first', setup: { mode, field: 'plains', lighting: 'day', mapLayout: 'standard', objectiveMode: 'annihilation', siegeAttacker: 'ally' }, nonLethal: false, seed: 'locked', registry, summonUnit: () => { throw Error('unused'); } });
  expect(JSON.stringify(roster)).toBe(before);
  const lead = battle.byId('lead'), maximum = lead.base.moraleMax ?? 100;
  expect(lead.morale).toBe(maximum);
  const context = () => battle.observationContext();
  changeMorale(lead, -1000); changeMorale(lead, 1000);
  lead.conditions.push({ id: 'demoralized', dur: 5 });
  battle.byId('foe').traits = ['fear', 'terror'];
  const hp = lead.hp;
  applyHealthLoss(lead, Math.max(1, Math.floor(hp / 2)));
  expect(lead.hp).toBeLessThan(hp);
  expect(lead.morale).toBe(maximum);
  expect(moraleProfile(context(), lead, registry)).toMatchObject({ effective: Math.min(100, maximum), immune: true, attackPenalty: 0 });
  expect(decideMorale(context(), lead, 2, new SeededRng('rout'), 25, registry).kind).toBe('none');
  const snap = structuredClone(battle.toSnapshot());
  const restored = battle instanceof SmallBattle ? SmallBattle.fromSnapshot(snap, { traitRegistry: registry }) : MassBattle.fromSnapshot(snap, { traitRegistry: registry });
  changeMorale(restored.byId('lead'), -1000);
  expect(restored.byId('lead').morale).toBe(maximum);
  const record = unitRecordFromCombatant(lead);
  expect(record.snapshot).not.toHaveProperty('moraleLocked');
  expect(materializeUnitRecord(record, registry).moraleLocked).toBeUndefined();
  setMoraleLock(restored.byId('lead'), false);
  expect(changeMorale(restored.byId('lead'), -10)).toBe(-10);
  expect(moraleProfile(restored.observationContext(), restored.byId('lead'), registry).effective).toBeLessThan(Math.min(100, maximum));
});

it('护送默认对象不依赖主控，明确选择仍优先；战外资料提供当前士气与锁定状态', () => {
  const roster = [unit('first', 'ally', 'company'), unit('lead', 'ally', 'hero'), unit('foe', 'enemy', 'company')];
  expect(prepareBattleObjective(standardField(), roster, 'escort', 'lead').objective).toMatchObject({ unitId: 'first' });
  expect(prepareBattleObjective(standardField(), roster, 'escort', 'lead', 'ally', 'lead').objective).toMatchObject({ unitId: 'lead' });
  const text = narrativeProjection({ storage: roster.map(u => unitRecordFromCombatant(u)), rosterIds: roster.map(u => u.id), protagonistId: 'lead' });
  expect(text).toContain('"morale":10');
  expect(text).toContain('"morale":100');
  expect(text).toContain('"moraleLocked":true');
});

it('主控升级改变士气上限后仍保持满值，解除锁定不永久增加免疫特质', () => {
  const lead = unit('lead', 'ally', 'company');
  setMoraleLock(lead, true);
  const previousMax = lead.base.moraleMax!;
  applyXp(lead, 1000000, registry);
  expect(lead.base.moraleMax).toBeGreaterThan(previousMax);
  expect(lead.morale).toBe(lead.base.moraleMax);
  setMoraleLock(lead, false);
  changeMorale(lead, -1000000);
  expect(lead.morale).toBe(0);
  expect(lead.traits).not.toContain('steadfast');
});
