import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { generateUnit, SmallBattle, MassBattle, standardField, V4_OVERFLOW_D20, V4_OVERFLOW_TW, V5_OVERFLOW_D20, V5_OVERFLOW_TW, traitRegistry, prepareCombatModel, compileGenericSkill, previewAttack, standardConditionMap } from '../engine/src/index.js';
import { armorPowerScale, anchoredProtection, anchoredWeapon, POWER_ANCHORS } from '../engine/src/power-anchors.js';
import { compileArmor } from '../engine/src/gen/equipment.js';
import { diceAvg } from '../engine/src/data/weapons.js';
import { memberHealth, memberHealthMax } from '../engine/src/member-health.js';
import { upgradeCombatSkills } from '../engine/src/skill-upgrade.js';
import type { Combatant, DamageChannel } from '../engine/src/types.js';
import type { Enhancements } from '../engine/src/enhancements.js';

// Sensitivity experiment only. Override existing fixture fields; never patch the engine.
type Variant = 'current' | 'removed' | 'cap2' | 'v5';
type Mode = 'small' | 'mass';
type Spec = { weapon?: string; power: number; armor?: number; armorPower?: number; profile?: DamageChannel; shield?: number; skill?: string; skillPower?:number; skillBonuses?:Enhancements; weaponBonuses?:Enhancements; training?:number; body?: 'vehicle' };
type Scenario = { id: string; name: string; a: Spec; b: Spec; mirror?: boolean };
const rifle = (power: number, extra: Partial<Spec> = {}): Spec => ({ power, weapon: 'rifle', armor: 3, ...extra });
const mirror = (id: string, name: string, a: Spec): Scenario => ({ id, name, a, b: { ...a }, mirror: true });
const settingsAudit=process.argv.includes('--setting-skills');
const allScenarios: Scenario[] = settingsAudit ? [
  ...[[3,5],[5,8],[8,10]].map(([low,high])=>({id:`generation-${low}-${high}`,name:`L${low} / L${high} 步枪重甲跨代`,a:rifle(low!),b:rifle(high!)})),
  {id:'training-gap',name:'T10/L5 / T1/L8，训练不能替代技术',a:rifle(5,{training:10}),b:rifle(8,{training:1})},
  {id:'enhancement-gap',name:'L5 满伤害/强度/穿透修正 / L8 无修正',a:rifle(5,{weaponBonuses:{power:10,damage:10,penetration:10,accuracy:10}}),b:rifle(8)},
  {id:'strategic-area',name:'L10 火炮载具 / L3 步枪重甲',a:rifle(10,{weapon:'cannon',body:'vehicle'}),b:rifle(3)},
  {id:'spell-5',name:'L5 热能单体法术+步枪 / L5 步枪',a:rifle(5,{skill:'generic:magic-single:thermal'}),b:rifle(5)},
  {id:'spell-8',name:'L8 奥术范围法术+步枪 / L8 步枪盾牌',a:rifle(8,{skill:'generic:magic-area:arcane'}),b:rifle(8,{shield:8})},
  {id:'weapon-skill-gap',name:'L3 剑+L10 武技、L5重甲 / L5 步枪重甲',a:rifle(3,{weapon:'sword',armorPower:5,skill:'generic:physical-single:melee',skillPower:10}),b:rifle(5)},
  {id:'summon-forms',name:'L5 单体召唤 / L5 群体召唤，均持步枪重甲',a:rifle(5,{skill:'generic:buff:summon-single',skillBonuses:{damage:5,range:5}}),b:rifle(5,{skill:'generic:buff:summon-group',skillBonuses:{damage:5,range:5}})},
  {id:'mixed-support',name:'L5 治疗+屏障及强度/持续修正 / 单纯治疗',a:rifle(5,{skill:'generic:buff:barrier+heal',skillBonuses:{power:10,duration:5}}),b:rifle(5,{skill:'heal'})},
  {id:'fire-zone',name:'L5 火墙及热能伤害修正+步枪 / L5 步枪',a:rifle(5,{skill:'generic:magic-area:zone-fire',skillBonuses:{thermalDamage:5}}),b:rifle(5)},
] : [
  ...[3, 5, 8, 10].map(power => mirror('mirror-' + power, `L${power} 步枪重甲镜像`, rifle(power))),
  ...[5, 8].map(power => ({ id: 'light-none-' + power, name: `L${power} 轻甲 / 无甲`, a: rifle(power, { armor: 1 }), b: rifle(power, { armor: 0 }) })),
  ...[5, 8].map(power => ({ id: 'light-heavy-' + power, name: `L${power} 轻甲 / 重甲`, a: rifle(power, { armor: 1 }), b: rifle(power) })),
  { id: 'overpenetration', name: 'L5 重步枪：轻甲 / 重甲（均完全穿透）', a: rifle(5, { weapon: 'heavy-rifle', armor: 1 }), b: rifle(5, { weapon: 'heavy-rifle' }) },
  ...(['kinetic', 'thermal'] as const).map(profile => ({ id: 'channel-' + profile, name: `L5 能量 / 步枪（${profile} 特化重甲）`, a: rifle(5, { weapon: 'energy', profile }), b: rifle(5, { profile }) })),
  { id: 'shield', name: 'L8 无甲剑盾 / 无甲持剑', a: rifle(8, { weapon: 'sword', armor: 0, shield: 8 }), b: rifle(8, { weapon: 'sword', armor: 0 }) },
  { id: 'armor-gap', name: 'L6 步枪：L6 重甲 / L5 重甲', a: rifle(6), b: rifle(6, { armorPower: 5 }) },
  mirror('heal', 'L5 步枪重甲，双方各有 L5 治疗', rifle(5, { skill: 'heal' })),
  mirror('barrier', 'L5 步枪重甲，双方各有 L5 屏障', rifle(5, { skill: 'barrier' })),
  mirror('vehicle', 'L5 火炮重甲载具镜像', rifle(5, { weapon: 'cannon', body: 'vehicle' })),
];
const registry = traitRegistry(), conditionDefs = standardConditionMap();
const arg = (name: string, fallback: string) => process.argv.find(x => x.startsWith('--' + name + '='))?.slice(name.length + 3) ?? fallback;
const selectedScenario=arg('scenario','');
const scenarios=allScenarios.filter(s=>!selectedScenario||s.id===selectedScenario);
assert(scenarios.length,'unknown scenario');
// Use the production mass-battle deadline; extending it would test different rules.
const seeds = Number(arg('seeds', '10')), roundLimit = 40 as const;
const output = arg('output', 'docs/armor-durability-audit-20260927.json');
assert(Number.isSafeInteger(seeds) && seeds >= 1 && seeds <= 100);
const variants: Variant[] = process.argv.includes('--compare-v5') ? ['current','v5'] : ['current','removed','cap2'];
const rulesFor=(mode:Mode,variant:Variant)=>variant==='v5'?(mode==='small'?V5_OVERFLOW_D20:V5_OVERFLOW_TW):(mode==='small'?V4_OVERFLOW_D20:V4_OVERFLOW_TW);
const modes: Mode[] = ['small', 'mass'];
function make(spec: Spec, side: 'ally' | 'enemy', mode: Mode, variant: Variant): Combatant {
  const u = generateUnit({ name: side, side, rulesVersion: 'v2', scale: mode === 'small' ? 'hero' : 'company', level: spec.training??5,
    body: spec.body ?? 'human', hpMax: mode === 'small' ? (spec.body ? 252 : 42) : 100,
    weaponClass: spec.weapon ?? 'rifle', weaponLevel: spec.power,weaponBonuses:spec.weaponBonuses,
    armorTier: (spec.armor ?? 3) as 0 | 1 | 2 | 3 | 4, armorLevel: spec.armorPower ?? spec.power, traits: [],
  }, { registry, seed: 'armor-audit-gear', noVariance: true }).unit;
  u.id = side;
  if (spec.profile) u.armor = compileArmor({ tier: u.armor!.tier, power: spec.armorPower ?? spec.power, profile: spec.profile }, { id: side + ':armor', seed: 'armor-audit-gear', body: spec.body ?? 'human', noVariance: true });
  if (spec.shield) u.shield = { id: side + ':shield', load: 2, recipe: { version: 'mechanism-v2.3', mechanism: 'shield', power: spec.shield, quality: 3, size: 'human', seed: 'armor-audit-gear' } };
  u.abilities = spec.skill ? [compileGenericSkill(spec.skill.startsWith('generic:')?spec.skill:'generic:buff:' + spec.skill, spec.skillPower??spec.power, u.id)] : [];
  if(u.abilities[0])u.abilities[0].bonuses=spec.skillBonuses;
  u.preparedAbilityIds = u.abilities.map(a => a.id);
  u.tags.push('zone:中军', 'rank:front');
  prepareCombatModel(u, rulesFor(mode,variant), spec.body ? 252 : 42);
  upgradeCombatSkills(u);
  const original = armorPowerScale(u), wanted = variant === 'removed' ? 1 : variant === 'cap2' ? Math.min(2, original) : original;
  if (variant === 'removed' || variant === 'cap2') {
    u.armor!.powerScale = wanted;
    if (u.shield) u.shield.powerScale = wanted;
  }
  assert.equal(armorPowerScale(u), wanted);
  return u;
}
type Game = { scenario: string; mode: Mode; variant: Variant; seed: number; swap: boolean; winner: 'a' | 'b' | 'draw' | 'limit'; rounds: number; attacks: number; hits: number; zeroDamageHits: number; firstActionSide?: string; firstActorWon?: boolean; skills: number; firstDownRound?: number; healthRemaining: number[]; healthInitial: number[] };
const games: Game[] = [], rows: Record<string, unknown>[] = [];
const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / (values.length || 1);
const median = (values: number[]) => { const sorted = [...values].sort((a,b) => a-b); return sorted.length ? (sorted[Math.floor((sorted.length-1)/2)]! + sorted[Math.ceil((sorted.length-1)/2)]!) / 2 : null; };
const summarize = (values: Game[]) => ({ games: values.length, aWins: values.filter(g => g.winner === 'a').length, bWins: values.filter(g => g.winner === 'b').length,
  draws: values.filter(g => g.winner === 'draw').length, limits: values.filter(g => g.winner === 'limit').length,
  oneRoundDecisions: values.filter(g => g.winner !== 'limit' && g.rounds <= 1).length,
  meanObservedRounds: mean(values.map(g => g.rounds)), medianObservedRounds: median(values.map(g => g.rounds)),
  meanDecidedRounds: values.some(g => ['a','b'].includes(g.winner)) ? mean(values.filter(g => ['a','b'].includes(g.winner)).map(g => g.rounds)) : null,
  firstActorWins: values.filter(g => g.firstActorWon).length, firstActorEligibleGames: values.filter(g => g.firstActorWon !== undefined).length,
  skillUses: values.reduce((sum, g) => sum + g.skills, 0), attacks: values.reduce((sum, g) => sum + g.attacks, 0),
  hits: values.reduce((sum, g) => sum + g.hits, 0), zeroDamageHits: values.reduce((sum, g) => sum + g.zeroDamageHits, 0) });
const probes = scenarios.map(s => ({ scenario: s.id, variants: variants.map(variant => {
  const a = make(s.a, 'ally', 'small', variant), b = make(s.b, 'enemy', 'small', variant);
  const preview = (attacker: Combatant, defender: Combatant) => {
    const w = anchoredWeapon(attacker.weapon,undefined,attacker.damageModel)!;
    const p = previewAttack({ attacker, defender, rules: rulesFor('small',variant), traitRegistry: registry, conditionDefs, ranged: !!w.tags?.includes('ranged'), distance: w.tags?.includes('ranged') ? 2 : 1 });
    return { armorScale: armorPowerScale(defender), rawMeanPerHit: diceAvg(w.baseDice) * (w.damageScale ?? 1), penetration: p.penetration, protection: p.resistance, through: p.penetrationFactor, hitChance: p.hitChance, expectedDamage: p.expectedDamage, skills: attacker.abilities.map(a => a.effects) };
  };
  return { variant, aToB: preview(a,b), bToA: preview(b,a) };
}) }));
const anchorTable = POWER_ANCHORS.map(anchor => { const u = make(rifle(anchor.level, { armor: 1 }), 'ally', 'small', 'current'); return { power: anchor.level, budget: anchor.budget, armorScale: armorPowerScale(u), protection: anchoredProtection(u, 'kinetic'), fullPenetrationDamageShare: 1 / armorPowerScale(u) }; });
const started = Date.now();
for (const scenario of scenarios) for (const mode of modes) for (const variant of variants) {
  const cell: Game[] = [];
  for (let seed = 0; seed < seeds; seed++) for (const swap of [false, true]) {
    const a = make(scenario.a, swap ? 'enemy' : 'ally', mode, variant), b = make(scenario.b, swap ? 'ally' : 'enemy', mode, variant);
    const units = swap ? [b,a] : [a,b], field = standardField(); field.tiles.fill('open');
    const opts = { combatants: units, seed: 'armor-audit:' + seed, traitRegistry: registry };
    const battle = mode === 'small' ? new SmallBattle({ ...opts, battlefield: field, rules: rulesFor(mode,variant) }) : new MassBattle({ ...opts, rules: rulesFor(mode,variant), roundLimit });
    const initial = [memberHealthMax(a), memberHealthMax(b)];
    battle.start();
    if (battle instanceof SmallBattle) { units[0]!.pos = 38; units[1]!.pos = 24; }
    let lastRound = 0, steps = 0, firstActionSide: string | undefined, firstDownRound: number | undefined;
    while (!battle.isOver() && battle.round <= roundLimit && steps < roundLimit * 12) {
      lastRound = battle.round; steps++;
      if (battle instanceof SmallBattle) {
        assert(battle.active, 'unfinished battle must have an active unit');
        firstActionSide ??= battle.active.side;
        battle.autoAction(battle.active.id);
      } else { battle.autoOrders('ally'); battle.autoOrders('enemy'); battle.resolveRound(); }
      if (firstDownRound === undefined && units.some(u => u.hp <= 0 || ['dead','downed'].includes(u.status))) firstDownRound = lastRound;
    }
    assert(steps < roundLimit * 12, 'battle failed to progress');
    const liveBoth = ['ally','enemy'].every(side=>battle.combatants.some(u=>u.side===side&&(u.status==='ready'||u.status==='routing')));
    const limited = liveBoth && (battle.round > roundLimit || !battle.isOver());
    const winner = limited ? 'limit' : battle.winner() === a.side ? 'a' : battle.winner() === b.side ? 'b' : 'draw';
    const resolutions = battle.log.flatMap(entry => entry.resolutions?.length ? entry.resolutions : entry.resolution ? [entry.resolution] : []);
    const row: Game = { scenario: scenario.id, mode, variant, seed, swap, winner, rounds: lastRound,
      attacks: resolutions.length, hits: resolutions.filter(r => r.hit).length, zeroDamageHits: resolutions.filter(r => r.hit && r.finalDamage === 0).length,
      firstActionSide, firstActorWon: firstActionSide && ['a','b'].includes(winner) ? firstActionSide === (winner === 'a' ? a.side : b.side) : undefined,
      skills: battle.log.filter(e => e.kind === 'ability').length, firstDownRound, healthRemaining: [memberHealth(a),memberHealth(b)], healthInitial: initial };
    cell.push(row); games.push(row);
  }
  const row = { scenario: scenario.id, name: scenario.name, mode, variant, ...summarize(cell) }; rows.push(row);
  console.log(JSON.stringify({ completed: games.length, elapsedSeconds: Math.round((Date.now()-started)/1000), ...row }));
}
assert.equal(games.length, scenarios.length * modes.length * variants.length * seeds * 2);
const totals = variants.flatMap(variant => modes.map(mode => ({ variant, mode, ...summarize(games.filter(g => g.variant === variant && g.mode === mode)) })));
const paired = modes.map(mode => ({ mode, comparisons: variants.slice(1).map(variant => {
  const current = games.filter(g => g.variant === 'current' && g.mode === mode), altered = games.filter(g => g.variant === variant && g.mode === mode);
  assert.equal(current.length, altered.length);
  for(let i=0;i<current.length;i++)assert.deepEqual([current[i]!.scenario,current[i]!.seed,current[i]!.swap],[altered[i]!.scenario,altered[i]!.seed,altered[i]!.swap]);
  return { variant, pairs: current.length, meanRoundDifference: mean(current.map((g,i) => altered[i]!.rounds-g.rounds)), outcomeChanges: current.filter((g,i) => g.winner !== altered[i]!.winner).length };
}) }));
mkdirSync(output.slice(0, output.lastIndexOf('/')), { recursive: true });
writeFileSync(output, JSON.stringify({ source: variants.includes('v5') ? 'V5 candidate against main 3b276d8d46d8549e283aae38511735a5878e3d01' : 'main 3b276d8d46d8549e283aae38511735a5878e3d01 / v1.0.6', date: '2026-09-27', method: { games: games.length, scenarios: scenarios.length, modes, variants, seeds, sideSwaps: 2, roundLimit,
  training: settingsAudit?'5 unless scenario overrides; HP held fixed to isolate training':5, heroHP: 42, vehicleHP: 252, companyMembers: 100, memberHP: '42 human / 252 vehicle', morale: 'generator default; damage and routing enabled',
  field: 'open; small mode starts at cells 38/24, two cells apart; mass starts in central front rank',
  limitations: [`${seeds} seed pairs per scenario/mode/variant; side swaps are paired, not independent samples`, 'Local AI decisions, no external LLM', 'Small=d20, mass=TW; overflow enabled', 'Unweighted scenario matrix, not a population estimate of player battles', 'cap2 is an arbitrary sensitivity bound, not a proposed calibrated production rule', 'removed/cap2 do not recalibrate other curves; v5 recalibrates single-target damage/healing and channel/shield protection', 'round-limit results are censored and counted separately from natural draws', 'First actor statistic applies only to small battles and includes movement before attacks', settingsAudit?'Selected cross-generation and skill cases only; no terrain/cover/flanking, not exhaustive skill-combination balance':'No terrain/cover/flanking scenarios; no poison/bleeding/zone-damage battles'] },
  scenarios, anchorTable, probes, totals, paired, rows, games }, null, 2) + '\n');
console.log(JSON.stringify({ output, games: games.length, elapsedSeconds: Math.round((Date.now()-started)/1000), totals }));
