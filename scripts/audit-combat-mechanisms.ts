import {prepareCombatModel} from '../engine/src/combat-model.js';
import {upgradeCombatSkills} from '../engine/src/skill-upgrade.js';
const v3=process.argv.includes('--v3');
const smallRules=v3?V3_D20:V2_D20,massRules=v3?V3_TW:V2_TW;
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { prepareMassRoster } from '../panel/src/battle-setup.js';
import { generateUnit, SmallBattle, MassBattle, generatedField, previewAttack, standardConditionMap, traitRegistry,
  WEAPON_CLASSES, V2_D20, V2_TW, V3_D20, V3_TW, weaponReloadTurns, equipmentReason, gridDistance, spCapacity,
  type GenerateInput, type Combatant } from '../engine/src/index.js';

// 一次有限审计：无随机浮动，固定种子并交换阵营；20轮观察窗不冒充完整胜率。
const registry = traitRegistry(), conditions = standardConditionMap(), output = process.argv.find((arg) => arg.startsWith('--output='))?.slice(9) ?? 'engine/sim/out/combat-mechanisms-20260908.json';
const only = process.argv.find((arg) => arg.startsWith('--only='))?.slice(7);
const selectedCases = process.argv.find((arg) => arg.startsWith('--scenarios='))?.slice(12).split(',');
function make(id: string, side: 'ally' | 'enemy', extra: Partial<GenerateInput> = {}): Combatant {
  const u = generateUnit({ name: id, side, scale: 'hero', rulesVersion: 'v2', level: 5, quality: 3,
    weaponClass: 'sword', weaponLevel: 5, armorTier: 1, armorLevel: 5, traits: [], ...extra }, { seed: id, registry, noVariance: true }).unit;
  u.id = id; if(v3){prepareCombatModel(u,smallRules);upgradeCombatSkills(u);} const reason = equipmentReason(u); if (reason) throw Error(id + ': ' + reason); return u;
}
const exact: Record<string, string | number>[] = [];
if (!only) for (const rules of [smallRules, massRules]) for (const power of [1, 5, 10]) for (const weapon of Object.keys(WEAPON_CLASSES)) {
  let previous = Infinity;
  for (const armor of [0, 2, 4] as const) {
    const a = make('source', 'ally', { scale: 'company', hpMax: 50, weaponClass: weapon, weaponLevel: power, armorTier: 0 });
    const d = make('target', 'enemy', { scale: 'company', hpMax: 50, weaponClass: 'sword', armorTier: armor, armorLevel: power });
    const p = previewAttack({ attacker: a, defender: d, rules, ranged: !!a.weapon?.tags?.includes('ranged'), distance: weapon === 'demolition' ? 1 : a.weapon!.range! > 1 ? 3 : 1,
      traitRegistry: registry, conditionDefs: conditions });
    if (!p.exact || !Number.isFinite(p.expectedDamage) || p.expectedDamage < 0 || p.expectedDamage > previous + 1e-8) throw Error('护甲单调性或预览异常: ' + weapon);
    previous = p.expectedDamage;
    exact.push({ mode: rules.id, power, weapon, armor, burst: +p.expectedDamage.toFixed(3), sustained: +(p.expectedDamage / (1 + weaponReloadTurns(a.weapon))).toFixed(3), penetration: a.weapon!.penetration!, hit: +p.hitChance.toFixed(3) });
  }
}
type Case = { id: string; label: string; mode?: 'mass'; layout?: 'indoor'; tags?: string[]; a: Partial<GenerateInput>[]; b: Partial<GenerateInput>[] };
const bow = { weaponClass: 'bow' }, rifle = { weaponClass: 'rifle' }, sword = { weaponClass: 'sword' };
const mage = { weaponClass: 'magic', abilityBlueprints: ['bp-arcane-bolt', 'bp-mending'] };
const group = (weaponClass: string, extra: Partial<GenerateInput> = {}): Partial<GenerateInput> => ({ scale: 'company', hpMax: 50, weaponClass, ...extra });
const cases: Case[] = [
  { id: 'bow-infantry', label: '弓手对普通步兵·野战', a: [bow], b: [sword] },
  { id: 'bow-fast', label: '弓手对速度5步兵·野战', a: [bow], b: [{ ...sword, speedTier: 5 }] },
  { id: 'rifle-shield-forest', label: '步枪对重甲盾兵·森林', tags: ['forest'], a: [rifle], b: [{ ...sword, armorTier: 3, shield: true, traits: ['shield-wall'] }] },
  { id: 'rifle-indoor', label: '步枪对步兵·室内', layout: 'indoor', tags: ['urban'], a: [rifle], b: [sword] },
  { id: 'rifle-night', label: '步枪对步兵·夜战', tags: ['night'], a: [rifle], b: [sword] },
  { id: 'mage-rifle', label: '法师对步枪·野战', a: [mage], b: [rifle] },
  { id: 'flight-rifle', label: '飞行近战对步枪·野战', a: [{ weaponClass: 'spear', traits: ['flying'] }], b: [rifle] },
  { id: 'mixed', label: '剑士与法师对双步枪·野战', a: [sword, mage], b: [rifle, rifle] },
  { id: 'mass-mirror', label: '50步枪对50步枪·会战', mode: 'mass', a: [group('rifle')], b: [group('rifle')] },
  { id: 'mass-autocannon-rifle', label: '50机炮组对50步枪·会战', mode: 'mass', a: [group('autocannon')], b: [group('rifle')] },
  { id: 'mass-autocannon-cannon', label: '50机炮组对50火炮组·会战', mode: 'mass', a: [group('autocannon')], b: [group('cannon')] },
  { id: 'mass-pike-cavalry', label: '50长枪兵对50骑兵·会战', mode: 'mass', a: [group('spear', { armorTier: 2, traits: ['pike-wall'] })], b: [group('sword', { armorTier: 2, mount: true, traits: ['charge-strong'] })] },
];
const matches: object[] = [], anomalies: string[] = [];
const hashFiles = ['engine/src/small/battle.ts', 'engine/src/mass/battle.ts', 'engine/src/damage.ts', 'engine/src/gen/equipment.ts', 'engine/src/resources.ts', 'engine/src/tactics.ts',
  'engine/src/exposure.ts', 'engine/src/skill-attack.ts', 'engine/src/skill-effects.ts', 'engine/src/recovery.ts', 'engine/src/morale.ts', 'panel/src/battle-setup.ts'];
const save = () => {
  mkdirSync('engine/sim/out', { recursive: true });
  writeFileSync(only ? output.replace('.json', '-' + only + '.json') : output, JSON.stringify({ generatedAt: new Date().toISOString(),
    method: (v3?'V3; ':'V2; ')+' T5/Q3, P5 matches, generation variance disabled, fixed encounter seed, two mirrored sides per case, 20-round observation window; no win-rate claim. Exact table covers all weapon classes at P1/P5/P10 versus same-P armor tiers 0/2/4, full salvo included once.',
    sources: Object.fromEntries(hashFiles.map((p) => [p, createHash('sha256').update(readFileSync(p)).digest('hex')])), exact, matches, anomalies }, null, 2));
};
for (const c of cases.filter((c) => (!only || c.id.startsWith(only)) && (!selectedCases || selectedCases.includes(c.id)))) for (const swap of [false, true]) {
  const aSide = swap ? 'enemy' : 'ally', bSide = swap ? 'ally' : 'enemy';
  const generated = [...c.a.map((s, i) => make('A' + i, aSide, s)), ...c.b.map((s, i) => make('B' + i, bSide, s))].sort((a, b) => a.side.localeCompare(b.side));
  const units = c.mode === 'mass' ? prepareMassRoster(generated) : generated;
  const field = generatedField('audit-layout', c.layout ? 5 : 7, c.layout ? 7 : 13, c.tags ?? ['plains']);
  const battle = c.mode === 'mass' ? new MassBattle({ combatants: units, seed: 'audit-20260908', rules: massRules, traitRegistry: registry, field: { tags: c.tags ?? ['plains'] } })
    : new SmallBattle({ combatants: units, seed: 'audit-20260908', rules: smallRules, traitRegistry: registry, battlefield: field, field: { tags: c.tags ?? ['plains'] } });
  battle.start();
  const start = units.map((u) => ({ id: u.id, hp: u.hp, SP: u.resources.SP, position: u.pos ?? u.formationPosition }));
  let steps = 0, minContact = Infinity, firstContact: number | undefined;
  while (!battle.isOver() && battle.round <= 20 && steps++ < 160) {
    if (battle instanceof SmallBattle) battle.autoAction(battle.active!.id);
    else { battle.autoOrders('ally'); battle.autoOrders('enemy'); battle.resolveRound(); }
    for (const u of battle.combatants) {
      if (!Number.isFinite(u.hp) || u.hp < 0 || u.hp > u.base.hpMax || Object.values(u.resources).some((n) => !Number.isFinite(n) || n < 0)) anomalies.push(`${c.id}/${swap}: 非法数值 ${u.id}`);
      if ((u.resources.SP ?? 0) > spCapacity(u)) anomalies.push(`${c.id}/${swap}: SP超过上限 ${u.id}`);
    }
    if (battle instanceof SmallBattle) for (const a of units.filter((u) => u.side === aSide && u.status === 'ready')) for (const b of units.filter((u) => u.side === bSide && u.status === 'ready')) {
      const d = gridDistance(field, a.pos!, b.pos!); minContact = Math.min(minContact, d); if (d <= 1) firstContact ??= battle.round;
    }
  }
  const attacks = battle.log.filter((e) => e.resolution), skills = battle.log.filter((e) => e.kind === 'ability');
  const result = { id: c.id, label: c.label, aSide, mode: c.mode ?? 'small', outcome: battle.isOver() ? battle.winner() === aSide ? 'A胜' : battle.winner() === bSide ? 'B胜' : '平局' : '20轮未决',
    rounds: Math.min(battle.round, 20), firstAttack: attacks[0]?.round, firstContact, minContact: Number.isFinite(minContact) ? minContact : undefined,
    start, end: units.map((u) => ({ id: u.id, hp: u.hp, status: u.status, morale: u.morale, fatigue: u.fatigue, SP: u.resources.SP })),
    shots: attacks.length, skills: skills.map((e) => ({ round: e.round, action: e.text.split('\n')[0] })),
    defeats: battle.log.filter((e) => ['death', 'routing', 'battle-end'].includes(e.kind)).map((e) => ({ round: e.round, text: e.text })) };
  matches.push(result); save(); console.log(JSON.stringify({ case: c.id, aSide, outcome: result.outcome, rounds: result.rounds, firstAttack: result.firstAttack, firstContact, shots: result.shots, skills: result.skills.length }));
}
save(); console.log(JSON.stringify({ exact: exact.length, matches: matches.length, anomalies, output }));
