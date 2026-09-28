/** Reproducible V9 AI audit: all legal single-modifier mechanisms at L1-L10,
 * plus complete battles across levels/loadouts and the user's exact mythology fixture.
 * Usage: npx vite-node scripts/audit-ai-economy.ts -- --shard=0/4
 * Use --myth-only for just the 40 supplied-fixture battles.
 * This is an invariant/decision audit, not a claim of game balance or live LLM testing.
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { generateUnit, traitRegistry, resolveTraitId, SmallBattle, MassBattle, standardField,
  V9_OVERFLOW_D20, V9_OVERFLOW_TW, memberHealth, type Combatant, type GenerateInput } from '../engine/src/index.js';
import { SKILL_CATEGORIES, allowedSkillModifiers, skillMechanismId } from '../engine/src/data/skill-mechanisms.js';
import { generatedField } from '../engine/src/small/field-generator.js';
import { spCapacity, fatigueLimit } from '../engine/src/resources.js';
import { parseProtocol } from '../panel/src/protocol.js';
const shardArg = process.argv.find(a => a.startsWith('--shard='))?.slice(8) ?? '0/1';
const [shard, shards] = shardArg.split('/').map(Number) as [number, number];
assert(Number.isInteger(shard) && Number.isInteger(shards) && shard >= 0 && shard < shards);
const registry = traitRegistry(), started = performance.now();
const outdir = 'artifacts/ai-review'; mkdirSync(outdir, { recursive: true });
const modes = ['small', 'mass'] as const;
const mythOnly = process.argv.includes('--myth-only');
const outcomes: unknown[] = [], failures: { id: string; error: string }[] = [];
const decisions: Record<string, number> = {}, skillUses: Record<string, number> = {};
let checked = 0;
let ordinal = 0, decisionCases = 0, battles = 0, actions = 0, restores = 0;
const picked = () => ordinal++ % shards === shard;
function unit(id: string, side: 'ally' | 'enemy', mode: 'small' | 'mass', level: number, extra: Partial<GenerateInput> = {}): Combatant {
  const result = generateUnit({ rulesVersion: 'v2', damageModel: 'wounds-v2', name: id, side,
    scale: mode === 'small' ? 'hero' : 'company', ...(mode === 'mass' ? { hpMax: 12 } : {}),
    level, weaponClass: 'sword', weaponLevel: level, armorTier: 1, armorLevel: level,
    traits: [], ...extra }, { registry, seed: id, noVariance: true }).unit;
  result.id = id; return result;
}
function arena(units: Combatant[], mode: 'small' | 'mass', seed: string, sweep = false, tags: string[] = ['plains']) {
  const field = sweep ? standardField() : generatedField(seed, 7, 13, tags, { roster: units });
  if (sweep) field.tiles.fill('open');
  const b = mode === 'small'
    ? new SmallBattle({ combatants: units, rules: V9_OVERFLOW_D20, traitRegistry: registry, battlefield: field, fieldTags: tags, seed })
    : new MassBattle({ combatants: units, rules: V9_OVERFLOW_TW, traitRegistry: registry, fieldTags: tags, seed });
  b.start();
  if (sweep) {
    units.forEach((u, i) => { u.pos = i === 0 ? 31 : i === 1 ? 24 : 38;
      u.formationPosition = u.side === 'enemy' ? 'enemy:中军:front' : i === 0 ? 'ally:中军:front' : 'ally:中军:rear'; });
    if (b instanceof SmallBattle) { b.turnOrder = units.map(u => u.id); b.turnIndex = 0; b.movementSpent.set(units[0]!.id, 99); }
  }
  return b;
}
function invariants(b: SmallBattle | MassBattle) {
  assert.equal(new Set(b.combatants.map(u => u.id)).size, b.combatants.length, 'duplicate unit ids');
  for (const u of b.combatants) {
    assert(Number.isFinite(u.hp) && u.hp >= 0 && u.hp <= u.base.hpMax, `${u.name}: HP out of bounds`);
    assert(Number.isFinite(memberHealth(u)) && memberHealth(u) >= 0, `${u.name}: invalid member life`);
    assert(Number.isFinite(u.resources.SP) && u.resources.SP! >= -1e-8 && u.resources.SP! <= spCapacity(u) + 1e-8, `${u.name}: SP out of bounds`);
    assert(Number.isFinite(u.fatigue) && u.fatigue >= 0 && u.fatigue <= fatigueLimit(u), `${u.name}: fatigue out of bounds`);
    for (const s of u.abilityState) assert(Number.isInteger(s.cdLeft) && s.cdLeft >= 0 && Number.isInteger(s.used) && s.used >= 0, 'invalid skill state');
    if (u.status === 'dead') assert.equal(u.hp, 0, 'dead unit with HP');
    if (u.formation?.health) assert.equal(u.formation.health.reduce((n, g) => n + g.count, 0), u.hp, 'member count mismatch');
  }
}
function recordUses(b: SmallBattle | MassBattle) {
  for (const u of b.combatants) for (const a of u.abilities) {
    const n = u.abilityState.find(s => s.abilityId === (a.cooldownGroup ?? a.id))?.used ?? 0;
    if (n) skillUses[a.definitionId ?? a.name] = (skillUses[a.definitionId ?? a.name] ?? 0) + n;
  }
}
function check(id: string, fn: () => void) {
  try { fn(); } catch (error) { failures.push({ id, error: String(error) }); console.error('FAIL', id, String(error)); }
  finally { if (++checked % 100 === 0) console.error(`Checked ${checked} cases; ${failures.length} failures`); }
}
const mechanisms = SKILL_CATEGORIES.flatMap(c => [[], ...allowedSkillModifiers(c.id).map(m => [m.id])]
  .map(modifiers => skillMechanismId({ category: c.id, area: c.id.endsWith('area'), modifiers })));
if (!mythOnly) for (const mode of modes) for (let level = 1; level <= 10; level++) for (const mechanism of mechanisms) {
  if (!picked()) continue;
  const id = `decision/${mode}/L${level}/${mechanism}`;
  check(id, () => {
    const ranged = /ranged|projectile/.test(mechanism), magical = /magic/.test(mechanism);
    const actor = unit('actor', 'ally', mode, level, { shield: true,
      weaponClass: ranged ? 'rifle' : magical ? 'magic' : 'sword',
      abilityBlueprints: [{ id: mechanism, level }] });
    const foe = unit('foe', 'enemy', mode, level), friend = unit('friend', 'ally', mode, level);
    const b = arena([actor, foe, friend], mode, id, true);
    if (level % 3 === 0) actor.resources.SP = Math.min(3, spCapacity(actor));
    if (level % 3 === 1) actor.fatigue = 4;
    if (level % 2 === 0) friend.conditions.push({ id: 'stunned', dur: 2 });
    const before = JSON.stringify(b.toSnapshot());
    if (b instanceof MassBattle) {
      const first = b.recommendedOrder(actor.id), second = b.recommendedOrder(actor.id);
      assert.deepEqual(first, second, 'decision changes without state change');
      assert.equal(JSON.stringify(b.toSnapshot()), before, 'AI preview mutated state or RNG');
      assert(first, 'missing AI order'); assert(b.issue(first).ok, 'AI selected illegal order');
      decisions[first.type] = (decisions[first.type] ?? 0) + 1;
      b.issue({ unitId: foe.id, type: 'hold' }); b.issue({ unitId: friend.id, type: 'hold' }); b.resolveRound();
    } else {
      b.getActionOptions(actor.id); assert.equal(JSON.stringify(b.toSnapshot()), before, 'preview mutated state or RNG');
      const startRound = b.round;
      b.autoAction(actor.id);
      const skill = actor.abilityState.some(s => s.used > 0); decisions[skill ? 'ability' : 'other'] = (decisions[skill ? 'ability' : 'other'] ?? 0) + 1;
      assert(b.round > startRound || b.active?.id !== actor.id || b.isOver(), 'AI did not finish activation');
    }
    invariants(b); recordUses(b); decisionCases++;
  });
}
const kits: { name: string; weapon: string; skills: string[]; body?: GenerateInput['body']; traits?: string[] }[] = [
  { name: 'melee', weapon: 'sword', skills: ['physical-single:melee', 'physical-area:melee', 'buff:ward', 'debuff:root', 'buff:haste'] },
  { name: 'ranged', weapon: 'rifle', skills: ['physical-single:ranged', 'physical-area:ranged', 'debuff:slow', 'buff:empower', 'buff:haste'] },
  { name: 'mage', weapon: 'magic', skills: ['magic-single:arcane', 'magic-area:thermal', 'buff:barrier', 'debuff:stun', 'buff:restore'] },
  { name: 'controller', weapon: 'sword', skills: ['debuff:stun', 'debuff:disarm', 'debuff:silence', 'debuff:vulnerable', 'magic-single:arcane'] },
  { name: 'support', weapon: 'magic', skills: ['buff:heal', 'buff:ward', 'buff:cleanse', 'buff:haste', 'magic-single:arcane'] },
  { name: 'summoner', weapon: 'magic', skills: ['buff:summon-single', 'buff:summon-group', 'buff:ward', 'debuff:fear', 'magic-single:arcane'] },
  { name: 'giant', weapon: 'spear', body: 'giant', skills: ['physical-single:melee', 'physical-area:melee', 'buff:haste', 'buff:barrier'] },
  { name: 'vehicle', weapon: 'cannon', body: 'vehicle', skills: ['physical-single:ranged', 'physical-area:ranged', 'buff:barrier', 'buff:restore'] },
];
function finish(b: SmallBattle | MassBattle, id: string, checkpoint: boolean) {
  let steps = 0, stalled = 0;
  while (!b.isOver()) {
    assert(++steps <= 1500, 'action limit exceeded');
    const key = `${b.round}:${b instanceof SmallBattle ? b.turnIndex : ''}:${b.log.length}`;
    if (checkpoint && steps === 3) {
      const snap = structuredClone(b.toSnapshot());
      b = b instanceof SmallBattle ? SmallBattle.fromSnapshot(snap, { traitRegistry: registry }) : MassBattle.fromSnapshot(snap, { traitRegistry: registry });
      restores++;
    }
    if (b instanceof SmallBattle) { assert(b.active, 'missing active unit'); if (b.active.status === 'ready') b.autoAction(b.active.id); else b.endTurn(); }
    else { b.autoOrders('ally'); b.autoOrders('enemy'); b.resolveRound(); }
    const next = `${b.round}:${b instanceof SmallBattle ? b.turnIndex : ''}:${b.log.length}`;
    stalled = next === key ? stalled + 1 : 0; assert(stalled < 3, 'AI no-progress loop'); invariants(b); actions++;
  }
  const uses = b.combatants.filter(u => !u.summonerId).map(u => ({ name: u.name, hp: u.hp, sp: u.resources.SP,
    skills: u.abilities.map(a => ({ name: a.name, used: u.abilityState.find(s => s.abilityId === (a.cooldownGroup ?? a.id))?.used ?? 0 })) }));
  const rounds = b.round, roundLimit = b instanceof MassBattle ? rounds > b.roundLimit : rounds > b.battlefield!.objective.limit;
  outcomes.push({ id, rounds, steps, winner: b.winner(), roundLimit, uses }); battles++; recordUses(b);
  if (id.startsWith('myth/')) writeFileSync(`${outdir}/${id.replaceAll('/', '-')}.json`, JSON.stringify({ id, outcomes: uses, rounds, log: b.log }, null, 2));
}
if (!mythOnly) for (const mode of modes) for (const level of [1, 3, 5, 7, 10]) for (let seed = 0; seed < 3; seed++) for (const [index, kit] of kits.entries()) {
  if (!picked()) continue;
  const id = `battle/${mode}/L${level}/${kit.name}/${seed}`;
  check(id, () => {
    const build = (side: 'ally' | 'enemy', k: typeof kit) => unit(side, side, mode, level, { weaponClass: k.weapon, body: k.body, traits: k.traits ?? [],
      abilityBlueprints: k.skills.map(s => ({ id: 'generic:' + s, level })) });
    const other = kits[(index + 1 + seed) % kits.length]!;
    const units = [build('ally', kit), build('enemy', other)];
    if (kit.name === 'support' || other.name === 'support') units.push(unit('ally-friend', 'ally', mode, level), unit('enemy-friend', 'enemy', mode, level));
    finish(arena(units, mode, id, false, [['plains'], ['forest', 'night'], ['urban']][seed]!), id, seed === 0);
  });
}
const fixture = readFileSync('engine/tests/fixtures/wukong-erlang.tb.txt', 'utf8');
const parsed = parseProtocol(fixture); assert.deepEqual(parsed.errors, []);
function mythology(seed: string): Combatant[] {
  return parsed.events.filter(e => e.kind === 'spawn').map((e, i) => {
    const input: GenerateInput = { rulesVersion: 'v2', damageModel: 'wounds-v2', name: e.name, side: e.side ?? 'enemy', scale: e.scale!, level: e.level,
      body: e.body, speedTier: e.speedTier, hp: e.hp, hpMax: e.hpMax,
      traits: (e.traits ?? []).map(n => resolveTraitId(n, registry)!).filter(Boolean),
      weaponName: e.weaponName, weaponClass: e.weaponClass, weaponLevel: e.weaponLevel, weaponBonuses: e.weaponBonuses,
      armorName: e.armorName, armorTier: e.armorTier, armorLevel: e.armorLevel, armorBonuses: e.armorBonuses,
      abilityBlueprints: e.skills?.map(s => ({ id: s.blueprintId, name: s.name, level: s.level, bonuses: s.bonuses })) };
    const u = generateUnit(input, { registry, seed: seed + ':' + i, noVariance: true }).unit; u.id = i ? 'erlang' : 'wukong'; return u;
  });
}
for (const mode of modes) for (let seed = 0; seed < 20; seed++) {
  if (!picked()) continue;
  const id = `myth/${mode}/${seed}`; check(id, () => finish(arena(mythology(id), mode, id, false, ['mountain']), id, seed % 4 === 0));
}
const report = { shard, shards, mechanisms: mechanisms.length, attempted: ordinal, decisionCases, battles, actions, restores,
  decisions, skillUses, failures, elapsedMs: performance.now() - started, outcomes };
writeFileSync(`${outdir}/matrix-${shard}-of-${shards}.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, outcomes: undefined, skillUses: undefined }));
if (failures.length) process.exitCode = 1;
