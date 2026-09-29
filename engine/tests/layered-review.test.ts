import { compileWeapon } from '../src/gen/equipment.js';
import { describe, it, expect } from 'vitest';
import { SmallBattle, MassBattle, V11_OVERFLOW_D20, generateUnit, standardField, createStructure, damageStructure, tileCost, movementStepCost, canOccupy, traitRegistry, type Combatant, type Ability, type Terrain } from '../src/index.js';
import { weaponBreachBudget, weaponStructureDamage, BREACH_COEFFICIENTS, structureDurability } from '../src/small/layers.js';
import { commanderScores, newBattleCommanderProfiles, normalizeCommanderProfiles } from '../src/commander-profile.js';
import { regionalOrder } from '../src/small/team-tactics.js';
import { weaponReloadKey } from '../src/loadout.js';
import { conjureSkillUnit } from '../src/skill-runtime.js';
function fixture(speed = 3) {
  const field = standardField(); field.tiles.fill('open'); field.layerVersion = 1; field.structures = field.tiles.map(() => null); field.overlays = {}; field.landmarks = [];
  const unit = (id: string, side: Combatant['side']) => {
    const u = generateUnit({ name: id, side, scale: 'hero', level: 3, rulesVersion: 'v2', weaponClass: 'blunt', weaponLevel: 3, armorTier: 1, traits: [] }, { registry: traitRegistry(), seed: id, noVariance: true }).unit;
    u.id = id; u.morale = u.base.moraleMax = 100; return u;
  };
  const a = unit('a', 'ally'), b = unit('b', 'enemy');
  const battle = new SmallBattle({ combatants: [a, b], battlefield: field, rules: V11_OVERFLOW_D20, seed: 'review' });
  battle.start(); battle.turnOrder = ['a', 'b']; battle.turnIndex = 0; a.pos = 31; b.pos = 3; a.speedTier = speed; a.fatigue = 0;
  return { a, b, battle, field: battle.battlefield! };
}
function equip(a: Combatant, mechanism: string, power = 3, bonuses?: { damage?: number; power?: number; kineticDamage?: number }) {
  a.weapon = compileWeapon({ mechanism, power, bonuses }, { id: 'test-' + mechanism, seed: 'w', noVariance: true, damageModel: 'wounds-v2' });
}
function magic(a: Combatant, extra: Partial<Ability> = {}) {
  const ability: Ability = { id: 'spell', name: '破障术', target: 'enemy', delivery: 'magic', power: 3, range: { min: 0, max: 7, metric: 'grid' }, cost: { resource: 'SP', amount: 1 }, effects: [{ op: 'damage', baseDice: '2d6' }], ...extra };
  a.abilities = [ability]; a.preparedAbilityIds = [ability.id]; a.resources.SP = 20;
  return ability;
}
describe('review: layered movement and structural action contracts', () => {
  it.each(['rough', 'forest', 'hill', 'shallow_water', 'swamp'] as Terrain[])('one-point units enter difficult %s using their full normal allowance', terrain => {
    const { a, field, battle } = fixture(1); field.tiles[24] = terrain;
    expect(battle.movementBudget('a')).toBe(1); expect(tileCost(field, 24, a)).toBeGreaterThan(1);
    expect(battle.pathPreview('a', 24).path?.cost).toBe(1);
    battle.moveTo('a', 24); expect(a.pos).toBe(24); expect(battle.movementLeft('a')).toBe(0);
  });
  it('one-point units cross a destroyed wall, and preview/occupancy/execution/save agree', () => {
    const { a, field, battle } = fixture(1); field.structures![24] = createStructure('wall', 1);
    expect(battle.pathPreview('a', 24).path).toBeUndefined(); damageStructure(field, 24, 999);
    expect(field.overlays![24]).toContain('rubble'); expect(movementStepCost(field, 24, a)).toBe(1);
    expect(canOccupy(field, [a], a, 24)).toBe(true); battle.moveTo('a', 24);
    expect(a.pos).toBe(24); expect(battle.movementLeft('a')).toBe(0);
    const restored = SmallBattle.fromSnapshot(structuredClone(battle.toSnapshot()));
    expect(restored.byId('a').pos).toBe(24); expect(restored.movementLeft('a')).toBe(0);
  });
  it('minimum progress is not a free last-step discount, nor deep-water access, nor immunity to root', () => {
    const { a, field, battle } = fixture(2); field.structures![24] = createStructure('fortification', 1);
    expect(movementStepCost(field, 24, a)).toBe(2); battle.movementSpent.set('a', 1);
    expect(battle.pathPreview('a', 24).path).toBeUndefined(); battle.movementSpent.clear();
    field.structures![24] = null; field.tiles[24] = 'deep_water'; expect(movementStepCost(field, 24, a)).toBe(Infinity);
    a.traits.push('water-crossing'); a.speedTier = 1; expect(movementStepCost(field, 24, a)).toBe(1);
    a.conditions.push({ id: 'restrained', dur: 2 }); expect(battle.movementLeft('a')).toBe(0); expect(battle.pathPreview('a', 24).path).toBeUndefined();
  });
  it('low movement can climb with a main action, but not through a defender or while stunned', () => {
    const { a, b, field, battle } = fixture(1); field.structures![24] = createStructure('wall', 3, { top: true }); a.traits.push('siege-assault');
    b.pos = 24; b.elevation = 1; expect(battle.climbReason('a', 24)).toBeTruthy(); b.pos = 3; b.elevation = undefined;
    a.conditions.push({ id: 'stunned', dur: 1 }); expect(battle.climbReason('a', 24)).toBeTruthy(); a.conditions = [];
    battle.climb('a', 24); expect(a.pos).toBe(24); expect(a.elevation).toBe(1); expect(battle.actedThisTurn.has('a')).toBe(true); expect(battle.movementLeft('a')).toBe(0);
  });
  it('bridge rescue cannot teleport to the far side of a closed wall', () => {
    const { a, b, field, battle } = fixture(); b.pos = 24; field.tiles[24] = 'deep_water';
    for (const p of [17, 23, 25, 31]) field.structures![p] = createStructure('wall', 3);
    a.pos = 52; (battle as unknown as { resolveGroundStates(): void }).resolveGroundStates();
    expect(b.status).toBe('fled'); expect(b.pos).toBe(24);
  });
  it('AI does not demolish an irrelevant city building while an enemy is already reachable', () => {
    const { b, field, battle } = fixture(); b.pos = 24; field.structures![32] = createStructure('building', 1);
    const hp = field.structures![32]!.hp; battle.autoAction('a'); expect(field.structures![32]!.hp).toBe(hp);
    expect(battle.log.some(e => e.text.includes('结构耐久'))).toBe(false);
  });
  it('legacy unlayered terrain retains its old movement rule', () => {
    const { a, field } = fixture(1); delete field.layerVersion; field.tiles[24] = 'rough';
    expect(movementStepCost(field, 24, a)).toBe(tileCost(field, 24, a)); expect(tileCost(field, 24, a)).toBe(2);
  });
  it('rejects unknown modes and airborne melee; expired disarm does not block', () => {
    const { a, battle, field } = fixture(); field.structures![24] = createStructure('wall', 3);
    expect(battle.structurePreview('a', 24, 'typo').reason).toContain('未知');
    a.airborne = true; expect(battle.structurePreview('a', 24).reason).toContain('地面'); a.airborne = false;
    a.conditions.push({ id: 'disarmed', dur: 0 }); expect(battle.structurePreview('a', 24).reason).toBeUndefined();
  });
  it('disarm blocks hand weapons but not natural weapons or independent magic', () => {
    const { a, battle, field } = fixture(); field.structures![24] = createStructure('wall', 3); a.conditions.push({ id: 'disarmed', dur: 1 });
    expect(battle.structurePreview('a', 24).reason).toBeTruthy(); equip(a, 'natural'); expect(battle.structurePreview('a', 24).reason).toBeUndefined();
    equip(a, 'rifle'); magic(a); expect(battle.structurePreview('a', 24, 'ability:spell').reason).toBeUndefined();
  });
  it('direct rifles cannot shoot through troops, while a clear angle works', () => {
    const { a, b, battle, field } = fixture(); equip(a, 'rifle'); field.structures![10] = createStructure('wall', 3); b.pos = 17;
    expect(battle.structurePreview('a', 10).reason).toContain('遮挡'); b.pos = 0;
    expect(battle.structurePreview('a', 10).reason).toBeUndefined();
  });
  it('prepared ranged techniques obey reload and pinned-heavy-fire rules', () => {
    const { a, b, battle, field } = fixture(); equip(a, 'cannon'); a.weapon!.pointBlankPolicy = 'forbid'; field.structures![10] = createStructure('wall', 3);
    magic(a, { damageBasis: 'weapon', delivery: 'ranged', weaponUse: 'ranged', weaponDamageMult: 1.2 });
    battle.reloadCd.set(weaponReloadKey(a, a.weapon), 2); expect(battle.structurePreview('a', 10, 'ability:spell').reason).toContain('装填'); battle.reloadCd.clear();
    b.pos = 32; expect(battle.structurePreview('a', 10, 'ability:spell').reason).toContain('牵制'); b.pos = 0;
    expect(battle.structurePreview('a', 10, 'ability:spell').reason).toBeUndefined();
    battle.attackStructure('a', 10, 'ability:spell'); expect(battle.reloadCd.get(weaponReloadKey(a, a.weapon))).toBeGreaterThan(0); expect(a.resources.SP).toBeLessThan(20);
  });
  it('independent magic cannot borrow indirect LOS from a carried mortar', () => {
    const { a, battle, field } = fixture(); equip(a, 'indirect-cannon'); field.structures![10] = createStructure('wall', 3); field.tiles[17] = 'cliff';
    const ally = structuredClone(a); ally.id = 'observer'; ally.pos = 11; battle.combatants.push(ally); magic(a);
    expect(battle.structurePreview('a', 10).reason).toBeUndefined();
    expect(battle.structurePreview('a', 10, 'ability:spell').reason).toContain('射线');
  });
  it('weapon skill tier caps its budget, enhancements are not applied twice, preview is pure', () => {
    const { a, battle, field } = fixture(); equip(a, 'blunt', 10); field.structures![24] = createStructure('wall', 10);
    const spell = magic(a, { damageBasis: 'weapon', weaponUse: 'melee', delivery: 'melee', power: 1, weaponDamageMult: 1, bonuses: { damage: 10 } });
    const before = JSON.stringify(battle.toSnapshot()); const low = battle.structurePreview('a', 24, 'ability:spell');
    expect(low.damage).toBeLessThanOrEqual(17); expect(JSON.stringify(battle.toSnapshot())).toBe(before);
    spell.power = 10; expect(battle.structurePreview('a', 24, 'ability:spell').damage).toBe(weaponStructureDamage(a, a.weapon));
    const p = battle.structurePreview('a', 24, 'ability:spell'); const hp = field.structures![24]!.hp;
    battle.attackStructure('a', 24, 'ability:spell'); expect(field.structures![24]!.hp).toBe(hp - p.damage);
  });
  it('independent magic uses signed and channel enhancements exactly once', () => {
    const { a, battle, field } = fixture(); field.structures![24] = createStructure('wall', 3);
    const spell = magic(a, { channel: 'arcane', bonuses: { power: 5, arcaneDamage: 5 } });
    expect(battle.structurePreview('a', 24, 'ability:spell').damage).toBe(Math.round(structureDurability('wall', 3) / 5 * 1.5));
    spell.bonuses = { damage: -10 }; expect(battle.structurePreview('a', 24, 'ability:spell').damage).toBe(Math.round(structureDurability('wall', 3) / 10));
  });
});
describe('review: explicit weapon engineering budgets', () => {
  it.each(Object.entries(BREACH_COEFFICIENTS))('%s has an explicit finite coefficient %s at every grade', (mechanism, coefficient) => {
    const { a } = fixture();
    for (let level = 1; level <= 10; level++) { equip(a, mechanism, level); const value = weaponBreachBudget(a, a.weapon); expect(value.coefficient).toBe(coefficient); expect(value.damage).toBeGreaterThan(0); expect(value.damage).toBe(Math.round(structureDurability('wall', level) / 5 * coefficient)); }
  });
  it('weapon enhancements and saved variance count, training does not rewrite structural grade', () => {
    const { a } = fixture(); equip(a, 'blunt', 3, { damage: 10, kineticDamage: 10 });
    const budget = weaponBreachBudget(a, a.weapon); expect(budget.enhancement).toBe(2); a.level = 10; expect(weaponBreachBudget(a, a.weapon)).toEqual(budget);
    equip(a, 'blunt', 3); a.weapon!.recipe!.variance = { version: 'enhancement-bands-v1', rolls: { damage: 2 } };
    expect(weaponBreachBudget(a, a.weapon).enhancement).toBe(1.02);
  });
  it('large bodies strengthen physical contact, not the shell launched from the same cannon', () => {
    const { a } = fixture(); equip(a, 'cannon'); const human = weaponStructureDamage(a, a.weapon); a.body = 'giant'; expect(weaponStructureDamage(a, a.weapon)).toBe(human);
    equip(a, 'blunt'); const giant = weaponStructureDamage(a, a.weapon); a.body = 'human'; expect(giant).toBeGreaterThan(weaponStructureDamage(a, a.weapon));
  });
  it('squad frontage is bounded and summons preserve their shared damage budget', () => {
    const { a } = fixture(); a.scale = 'company'; a.hp = a.base.hpMax = 10000;
    expect(weaponBreachBudget(a, a.weapon).frontage).toBe(3);
    const group = conjureSkillUnit('conjured:group:5', 'ally', 'summons', 'small', undefined, 'wounds-v2')!;
    const one = conjureSkillUnit('conjured:single:5', 'ally', 'one', 'small', undefined, 'wounds-v2')!;
    expect(weaponStructureDamage(group, group.weapon)).toBeLessThan(weaponStructureDamage(one, one.weapon));
  });
});
describe('review: commander weights and real breach connectivity', () => {
  const choices = [
    { key: 'melee', score: 100, attack: true, ranged: false, move: false, defend: false },
    { key: 'fire', score: 100, attack: true, ranged: true, move: false, defend: false },
    { key: 'move', score: 100, attack: false, ranged: false, move: true, defend: false },
    { key: 'hold', score: 100, attack: false, ranged: false, move: false, defend: true },
    { key: 'breach', score: 100, attack: true, breach: true, ranged: true, move: false, defend: false },
  ];
  it('normal new field battles use stronger firepower/aggression, old snapshots keep original weights', () => {
    const profile = { ability: 'master' as const, style: 'firepower' as const };
    expect(commanderScores(choices, profile, 'x')[1]).toBe(106);
    expect(commanderScores(choices, profile, 'x', true)[1]).toBe(115);
    const modern = newBattleCommanderProfiles({ ally: profile }).ally!;
    expect(commanderScores(choices, modern, 'x')[1]).toBe(115);
    expect(normalizeCommanderProfiles({ ally: modern }).ally).toEqual(modern);
    expect(normalizeCommanderProfiles({ ally: profile }).ally?.scoring).toBeUndefined();
  });
  it('new mass battles retain the scoring model through save/load; no extra model response fields', () => {
    const { a, b } = fixture(); const battle = new MassBattle({ combatants: [a, b], rules: V11_OVERFLOW_D20, seed: 'mass' });
    battle.commanderProfiles = newBattleCommanderProfiles({ ally: { ability: 'master', style: 'siege', preferences: { breach: 4 } } });
    const restored = MassBattle.fromSnapshot(structuredClone(battle.toSnapshot())); expect(restored.commanderProfiles).toEqual(battle.commanderProfiles);
    const score = commanderScores(choices, restored.commanderProfiles.ally, 'x'); expect(score[4]).toBeGreaterThan(score[1]!);
  });
  it('one inaccessible gap does not make the entire assault stop breaking accessible walls', () => {
    const { a, field } = fixture(); a.pos = 59;
    const wall = Array.from({ length: field.width }, (_, x) => 5 * field.width + x);
    for (const p of wall) field.structures![p] = createStructure('wall', 3);
    damageStructure(field, wall[0]!, 9999); field.tiles[wall[0]!] = 'deep_water';
    field.objective = { kind: 'control', cell: 17, cells: [17], rounds: 5, limit: 60, attackingSide: 'ally' };
    field.city = { shape: 'front', inside: Array.from({ length: 35 }, (_, p) => p), frontline: wall, core: [17], reserve: [24], gates: [], defender: 'enemy' };
    expect(regionalOrder(field, a, [a])?.breach).toBeDefined(); a.traits.push('water-crossing'); expect(regionalOrder(field, a, [a])?.phase).toBe('advance');
  });
});
