import { describe, it, expect } from 'vitest';
import { generatedLayeredField, groundBlocked, findGridPath, structureDefense, structureDurability, createStructure, damageStructure, canClimbFrom, canOccupy, unitLineOfSight, tileCost, standardField, validateField, SmallBattle, V11_OVERFLOW_D20, generateUnit, collectMods, traitRegistry, standardConditionMap, memberHealth, memberHealthMax, activeTraitIds, normalizeBattlefieldPlan, ROUTE_TOPOLOGIES, type Combatant, type BattlefieldSpec } from '../src/index.js';
import { regionalOrder } from '../src/small/team-tactics.js';
import { normalizeCommanderProfiles, commanderScores } from '../src/commander-profile.js';
import { prepareBattleObjective } from '../../panel/src/battle-setup.js';
import { GridQueue } from '../src/small/grid-queue.js';
import { unitRecordFromCombatant, materializeUnitRecord } from '../../panel/src/unit-state.js';
function unit(id = 'a', side: Combatant['side'] = 'ally', traits: string[] = [], scale: 'hero' | 'company' = 'hero') {
  const u = generateUnit({ name: id, side, scale, level: 3, hpMax: scale === 'hero' ? 200 : 20, rulesVersion: 'v2', weaponClass: 'blunt', weaponLevel: 3, armorTier: 1, traits }, { registry: traitRegistry(), seed: id, noVariance: true }).unit;
  u.id = id; u.morale = u.base.moraleMax = 100; return u;
}
export function layeredFixture(scale: 'hero' | 'company' = 'hero') {
  const f = standardField(); f.tiles.fill('open'); f.layerVersion = 1; f.structures = f.tiles.map(() => null); f.overlays = {}; f.landmarks = [];
  const a = unit('a', 'ally', [], scale), b = unit('b', 'enemy', [], scale);
  const battle = new SmallBattle({ combatants: [a, b], battlefield: f, rules: V11_OVERFLOW_D20, seed: 'layer-fixture' });
  battle.start(); battle.turnOrder = ['a', 'b']; battle.turnIndex = 0; a.pos = 31; b.pos = 10;
  return { a, b, battle, field: battle.battlefield! };
}
const resetAction = (b: SmallBattle, id = 'a') => { b.actedThisTurn.delete(id); b.movementSpent.delete(id); };
describe('layered city and siege maps', () => {
  it('river bridges preserve real approach paths instead of ending behind natural cliffs', () => {
    for (const env of ['plains', 'forest', 'mountain']) for (let i = 0; i < 160; i++) {
      const f = generatedLayeredField('conn-' + i, 7, 13, [env], { plan: { water: 'river' } });
      for (const row of [1, f.height - 2]) {
        const origin = row * f.width + Math.floor(f.width / 2);
        expect(findGridPath(f, origin, f.objective.cell, p => !groundBlocked(f, p)), env + ':' + i + ':' + row).toBeDefined();
      }
    }
  });
  it('uses independent compact choices, strips untrusted coordinates/HP and bounds landmarks', () => {
    const value = normalizeBattlefieldPlan({ fortLevel: 11, size: 'large', hp: 999, tiles: ['open'], landmarks: Array.from({ length: 9 }, () => ({ kind: 'tower', anchor: 'rear', label: '<script>' })) });
    expect(value.plan).toEqual({ size: 'large', landmarks: Array.from({ length: 5 }, () => ({ kind: 'tower', anchor: 'rear' })) });
    expect(value.notes.length).toBeGreaterThan(0);
  });
  it('city generation is deterministic, diverse and driven by real inner route topology', () => {
    const variants = new Set<string>();
    for (const topology of Object.keys(ROUTE_TOPOLOGIES) as (keyof typeof ROUTE_TOPOLOGIES)[]) for (let i = 0; i < 6; i++) {
      const options = { plan: { topology, shape: 'enclosure' as const, landmarks: [] }, attackingSide: i % 2 ? 'enemy' as const : 'ally' as const };
      const field = generatedLayeredField('city-' + i, 7, 13, ['siege'], options);
      expect(field).toEqual(generatedLayeredField('city-' + i, 7, 13, ['siege'], options));
      expect(field.generation?.routes?.kind).toBe(topology); expect(field.landmarks).toHaveLength(0);
      expect(field.city?.inside.filter(p => !groundBlocked(field, p)).every(p => field.tiles[p] === 'street')).toBe(true);
      expect(field.city!.gates.every(p => field.structures![p]?.gateState === 'closed')).toBe(true);
      variants.add(JSON.stringify([field.structures, field.overlays]));
    }
    expect(variants.size).toBe(54);
  });
  it('urban shares districts, not automatic siege goals; five landmarks do not cap ordinary walls', () => {
    const urban = generatedLayeredField('urban', 7, 13, ['urban']); expect(urban.city?.shape).toBe('district'); expect(urban.objective.kind).toBe('annihilation');
    const siege = generatedLayeredField('five', 7, 13, ['siege'], { plan: { landmarks: ['inside_left', 'inside_right', 'rear', 'front_left', 'front_right'].map(anchor => ({ kind: 'fortification' as const, anchor: anchor as 'inside_left' })) } });
    expect(siege.landmarks).toHaveLength(5); expect(siege.structures!.filter(s => s?.kind === 'wall').length).toBeGreaterThan(5);
  });
  it('roads never bypass closed doors or water and bridges really change traversal', () => {
    const { a, field } = layeredFixture(); field.structures![24] = createStructure('gate', 3); field.overlays![24] = ['road'];
    expect(canOccupy(field, [], a, 24)).toBe(false); field.structures![24]!.gateState = 'open'; expect(canOccupy(field, [], a, 24)).toBe(true);
    field.tiles[23] = 'deep_water'; field.overlays![23] = ['road']; expect(canOccupy(field, [], a, 23)).toBe(false);
    a.traits.push('water-crossing'); expect(canOccupy(field, [], a, 23)).toBe(true); expect(tileCost(field, 23, a)).toBe(3);
    field.structures![23] = createStructure('bridge', 3); expect(tileCost(field, 23, a)).toBe(1); a.traits = [];
    damageStructure(field, 23, 1e8); expect(canOccupy(field, [], a, 23)).toBe(false);
  });
  it('fortification has omnidirectional protection, integrity and capture without side-only passage', () => {
    const { a, b, field } = layeredFixture(); a.pos = 31; b.pos = 24; field.structures![24] = createStructure('fortification', 3, { facing: 'south' });
    expect(structureDefense(field, b, a, false)).toBe(3); a.pos = 17; expect(structureDefense(field, b, a, false)).toBe(3);
    a.pos = 31; field.structures![24]!.hp = 1; expect(structureDefense(field, b, a, false)).toBe(1);
    expect(tileCost(field, 24, a)).toBe(3); expect(tileCost(field, 24, b)).toBe(3);
  });
  it('street grants urban-fighter locally in siege, but not on surrounding plains or in the air', () => {
    const a = unit('a', 'ally', ['urban-fighter']);
    const resolve = (terrain: string, local = true) => collectMods(a, { localTerrain: local, terrain, fieldTags: ['siege', 'urban'] }, standardConditionMap(), [], traitRegistry()).filter(m => m.name.includes('巷战'));
    expect(resolve('street').map(m => m.value)).toEqual([1, 2]); expect(resolve('open')).toEqual([]);
    expect(resolve('open', false).length).toBe(2);
  });
  it('wall-height LOS and melee are distinct; exterior assault requires the trait', () => {
    const { a, b, battle, field } = layeredFixture(); field.structures![24] = createStructure('wall', 3, { top: true, access: [17] }); b.pos = 24; b.elevation = 1;
    expect(unitLineOfSight(field, a, b)).toBe(true); expect(() => battle.attack(a.id, b.id)).toThrow(/高差/);
    a.traits.push('siege-assault'); expect(canClimbFrom(field, a, 24)).toBe(true); expect(battle.climbReason('a', 24)).toContain('占据');
    expect(() => battle.attack(a.id, b.id)).not.toThrow();
  });
  it('climbing pays an action and movement; inside stairs need no trait; height persists only in battle', () => {
    const { a, battle, field } = layeredFixture(); a.pos = 17; field.structures![24] = createStructure('wall', 3, { top: true, access: [17] });
    const before = JSON.stringify(battle.toSnapshot()), movement = battle.movementLeft('a');
    expect(battle.climbReason('a', 24)).toBeUndefined(); expect(JSON.stringify(battle.toSnapshot())).toBe(before);
    battle.climb('a', 24); expect(a.elevation).toBe(1); expect(battle.actedThisTurn.has('a')).toBe(true); expect(battle.movementLeft('a')).toBe(movement - 2);
    const snap = structuredClone(battle.toSnapshot()); expect(SmallBattle.fromSnapshot(snap).byId('a').elevation).toBe(1);
    const restored = materializeUnitRecord(unitRecordFromCombatant(a), traitRegistry()); expect(restored.elevation).toBeUndefined();
  });
  it('structure preview is pure, execution has identical damage and no structure XP', () => {
    const { battle, field } = layeredFixture(); field.structures![24] = createStructure('wall', 3);
    const before = JSON.stringify(battle.toSnapshot()), preview = battle.structurePreview('a', 24), hp = field.structures![24]!.hp;
    expect(preview.reason).toBeUndefined(); expect(preview.damage).toBeGreaterThan(0); expect(JSON.stringify(battle.toSnapshot())).toBe(before);
    battle.attackStructure('a', 24); expect(field.structures![24]!.hp).toBe(hp - preview.damage); expect(battle.xpGained).toBe(0);
    expect(battle.structurePreview('a', 24).reason).toBeTruthy();
  });
  it('breakable grade budget follows equipment, not the unit training grade', () => {
    const { a, battle, field } = layeredFixture(); field.structures![24] = createStructure('wall', 3); const first = battle.structurePreview('a', 24).damage;
    a.level = 10; expect(battle.structurePreview('a', 24).damage).toBe(first);
    expect(structureDurability('wall', 10)).toBeGreaterThan(structureDurability('wall', 1) * 100);
    expect(Math.ceil(field.structures![24]!.hp / first)).toBeGreaterThanOrEqual(4); expect(Math.ceil(field.structures![24]!.hp / first)).toBeLessThanOrEqual(6);
  });
  it('gate opening is physical for both sides, cannot close on units, and outside enemies cannot unlock it', () => {
    const { a, b, battle, field } = layeredFixture(); field.structures![24] = createStructure('gate', 3, { owner: 'enemy' });
    expect(battle.gateReason('a', 24)).toContain('内部'); field.structures![24]!.owner = 'ally'; battle.toggleGate('a', 24);
    expect(canOccupy(field, [], b, 24)).toBe(true); resetAction(battle); a.pos = 24;
    expect(battle.gateReason('a', 24)).toContain('有人'); a.pos = 31; battle.toggleGate('a', 24); expect(field.structures![24]!.gateState).toBe('closed');
  });
  it.each(['hero', 'company'] as const)('wall collapse displaces %s safely and never confuses member health with headcount', scale => {
    const { a, b, battle, field } = layeredFixture(scale); field.structures![24] = createStructure('wall', 1, { top: true }); field.structures![24]!.hp = 1;
    b.pos = 24; b.elevation = 1; const oldHealth = memberHealth(b), oldHp = b.hp;
    battle.attackStructure('a', 24); expect(b.elevation).toBeUndefined(); expect(b.hp).toBeGreaterThan(0); expect(memberHealth(b)).toBeLessThan(oldHealth);
    if (scale === 'company') expect(b.hp).toBe(oldHp); expect(field.overlays![24]).toContain('rubble'); expect(groundBlocked(field, b.pos!, b)).toBe(false);
    const restored = SmallBattle.fromSnapshot(structuredClone(battle.toSnapshot())); expect(memberHealth(restored.byId('b'))).toBe(memberHealth(b));
  });
  it('deep-water bridge collapse sends non-swimmers to nearby banks exactly once', () => {
    const { b, battle, field } = layeredFixture(); field.tiles[24] = 'deep_water'; field.structures![24] = createStructure('bridge', 1); field.structures![24]!.hp = 1; b.pos = 24;
    battle.attackStructure('a', 24); expect(field.tiles[b.pos!]).not.toBe('deep_water'); const hp = b.hp;
    const restored = SmallBattle.fromSnapshot(structuredClone(battle.toSnapshot())); expect(restored.byId('b').hp).toBe(hp);
  });
  it('prepared direct magic can break structures using the same SP/cooldown/action ledger; buffs cannot', () => {
    const { a, battle, field } = layeredFixture(); field.structures![24] = createStructure('wall', 3);
    a.abilities = [{ id: 'bolt', name: '破城术', target: 'enemy', delivery: 'magic', power: 3, range: { min: 0, max: 5, metric: 'grid' }, cost: { resource: 'SP', amount: 2 }, cooldown: 2, effects: [{ op: 'damage', baseDice: '2d6' }] }, { id: 'fear', name: '恐惧', target: 'enemy', effects: [{ op: 'morale', amount: -5 }] }];
    a.preparedAbilityIds = ['bolt', 'fear']; a.resources.SP = 10;
    expect(battle.structurePreview('a', 24, 'ability:fear').reason).toContain('直接伤害'); const preview = battle.structurePreview('a', 24, 'ability:bolt');
    expect(preview.reason).toBeUndefined(); battle.attackStructure('a', 24, 'ability:bolt'); expect(a.resources.SP).toBeLessThan(10); expect(a.abilityState[0]).toMatchObject({ abilityId: 'bolt', used: 1, cdLeft: 2 });
  });
  it('city control is a region: moving within it preserves progress and contest pauses instead of erasing', () => {
    const { a, b, battle, field } = layeredFixture(); field.objective = { kind: 'control', cell: 31, cells: [31, 32], attackingSide: 'ally', rounds: 5, limit: 60 };
    const check = (round: number) => { battle.round = round; (battle as any).checkGridObjective(true); };
    check(1); check(2); expect(battle.controlRounds.ally).toBe(1); a.pos = 32; check(3); expect(battle.controlRounds.ally).toBe(2);
    b.pos = 31; check(4); expect(battle.controlRounds.ally).toBe(2); b.pos = 10; check(5); expect(battle.controlRounds.ally).toBe(3);
    a.pos = 33; check(6); expect(battle.controlRounds.ally).toBe(0);
  });
  it('defenders have front/fire/reserve/core duties and reinforcements react to breaches without omniscience', () => {
    const defenders = Array.from({ length: 10 }, (_, n) => unit('d' + n, 'enemy'));
    const field = generatedLayeredField('duties', 7, 13, ['siege'], { roster: defenders, plan: { shape: 'front' } });
    defenders.forEach((u, n) => { u.pos = field.city!.reserve[n % field.city!.reserve.length]; });
    const orders = defenders.map(u => regionalOrder(field, u, defenders, { ability: 'expert', style: 'depth' })!);
    expect(orders.filter(o => o.role === 'core').length).toBeLessThan(4); expect(orders.some(o => o.role === 'reserve')).toBe(true); expect(orders.some(o => o.role === 'front')).toBe(true);
    const gate = field.city!.gates[0]!; damageStructure(field, gate, 1e8);
    const reservist = defenders.find((u, i) => orders[i]!.role === 'reserve')!;
    const changed = regionalOrder(field, reservist, defenders, { ability: 'expert', style: 'depth' })!;
    expect(changed.phase).toBe('breached'); expect(changed.goals.some(p => Math.abs(p - gate) === field.width || Math.abs(p - gate) === 1)).toBe(true);
  });
  it('preparing an urban annihilation objective does not put it back inside a building', () => {
    for (let n = 0; n < 80; n++) {
      const f = generatedLayeredField('prepare-' + n, 7, 13, ['urban'], { plan: { density: 'dense' } });
      const prepared = prepareBattleObjective(f, [unit(), unit('b', 'enemy')], 'annihilation');
      expect(() => validateField(prepared)).not.toThrow();
      expect(prepared.objective.cell).toBe(f.city!.core[0]);
    }
  });
  it('auto AI uses a legal assault instead of chipping an outmatched wall forever', () => {
    const { a, b, battle, field } = layeredFixture(); a.traits.push('siege-assault');
    for (let p = 21; p < 28; p++) field.structures![p] = createStructure('wall', 10, { top: true, owner: 'enemy', access: [p - 7] });
    field.city = { shape: 'front', inside: Array.from({length:21}, (_, p) => p), frontline: [21,22,23,24,25,26,27], gates: [], core: [10], reserve: [17], defender: 'enemy' };
    field.objective = { kind: 'control', cell: 10, cells: [10], rounds: 5, limit: 60, attackingSide: 'ally' };
    battle.autoAction(a.id);
    expect(a.elevation).toBe(1); expect(a.pos).toBe(24);
    expect(battle.log.some(e => e.text.includes('登上城防平台'))).toBe(true);
  });
  it('climbing does not bypass a ground melee reaction, and consumes one reaction at most', () => {
    const { a, b, battle, field } = layeredFixture(); a.traits.push('siege-assault'); b.pos = 30;
    field.structures![24] = createStructure('wall', 3, { top: true });
    battle.climb(a.id, 24);
    expect(battle.reactionSpent.has(b.id)).toBe(true);
    expect(battle.log.filter(e => e.text.startsWith('借机反应'))).toHaveLength(1);
  });
  it.each(Array.from({length:10}, (_, n) => n + 1))('uses one independent durability scale for structure grade L%s', level => {
    const u = generateUnit({ name:'builder', side:'ally', scale:'hero', rulesVersion:'v2', level:1, weaponClass:'blunt', weaponLevel:level, traits:[] }, {seed:'grade',noVariance:true}).unit;
    const { battle, a, field } = layeredFixture(); a.weapon = u.weapon;
    field.structures![24] = createStructure('wall', level);
    const hit = battle.structurePreview(a.id,24).damage;
    expect(field.structures![24]!.hpMax / hit).toBeGreaterThanOrEqual(4.9);
    expect(field.structures![24]!.hpMax / hit).toBeLessThanOrEqual(5.1);
  });
  it('heap order matches the former stable cost/cell sort, including duplicate entries', () => {
    const entries = Array.from({length:3000}, (_, i) => ({cell:(i*313)%247,cost:(i*37)%13}));
    const queue = new GridQueue(); entries.forEach(e => queue.push(e.cell,e.cost));
    const ordered = []; while(queue.size) ordered.push(queue.pop());
    expect(ordered).toEqual(entries.sort((a,b)=>a.cost-b.cost || a.cell-b.cell)); expect(queue.pop()).toBeUndefined();
  });
  it('rejects corrupt layer/structure/platform data and keeps legacy maps unlayered', () => {
    const { field } = layeredFixture(); field.structures![24] = createStructure('gate'); field.structures![24]!.hp = 0;
    expect(() => validateField(field)).toThrow('结构'); expect(standardField().layerVersion).toBeUndefined();
    const profile = normalizeCommanderProfiles({ ally: { ability: 'expert', style: 'depth', preferences: { reserve: 4, risk: Infinity, breach: 1, cohesion: 2, counterattack: 0 } } });
    expect(profile.ally!.preferences).toEqual({ reserve: 4, breach: 1, cohesion: 2 });
  });
});
