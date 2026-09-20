import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { generateUnit, previewAttack, standardConditionMap, traitRegistry, V2_D20, V2_TW, weaponReloadTurns, type Scale } from '../engine/src/index.js';

// 固定距离/健康/品质下的精确伤害期望；不运行随机对局或声称胜率。
const registry = traitRegistry(), conditions = standardConditionMap();
const weapons = ['light-ranged', 'bow', 'firearm', 'rifle', 'cannon', 'demolition'];
const rows: Record<string, string | number | boolean>[] = [];
for (const rules of [V2_D20, V2_TW]) for (const level of [2, 5, 8])
for (const scale of ['hero', 'company'] as Scale[]) for (const targetScale of ['hero', 'company'] as Scale[])
for (const armor of [0, 1, 3] as const) for (const weaponClass of weapons) {
  const make = (target: boolean) => generateUnit({ rulesVersion: 'v2', name: target ? 'target' : 'actor', side: target ? 'enemy' : 'ally',
    scale: target ? targetScale : scale, level, hpMax: 500, quality: 3, weaponClass, weaponLevel: level,
    armorTier: target ? armor : 0, armorLevel: level, traits: [] }, { seed: 'quick', registry, noVariance: true }).unit;
  const attacker = make(false), defender = make(true);
  const preview = previewAttack({ attacker, defender, rules, ranged: true, distance: 2, conditionDefs: conditions, traitRegistry: registry });
  if (!preview.exact || !Number.isFinite(preview.expectedDamage)) throw new Error('Expected exact, finite damage moments');
  rows.push({ mode: rules.id, level, scale, targetScale, armor, weapon: weaponClass, burst: preview.expectedDamage,
    sustained: preview.expectedDamage / (1 + weaponReloadTurns(attacker.weapon)), hit: preview.hitChance, penetration: attacker.weapon!.penetration!, exact: preview.exact });
}
const output = process.argv.find((arg) => arg.startsWith('--output='))?.slice(9) ?? 'engine/sim/out/weapons-quick.json';
const sourceFiles = ['engine/src/data/weapons.ts', 'engine/src/gen/equipment.ts', 'engine/src/damage.ts', 'engine/src/loadout.ts', 'scripts/calibrate-weapons-quick.ts'];
const sources = Object.fromEntries(sourceFiles.map((p) => [p, createHash('sha256').update(readFileSync(p)).digest('hex')]));
mkdirSync(output.slice(0, output.lastIndexOf('/')), { recursive: true });
writeFileSync(output, JSON.stringify({ generatedAt: new Date().toISOString(), method: '432 exact expected-damage evaluations, no random matches; distance 2, Q3, same training/equipment level, healthy units, no traits, sustained = burst/(reload+1); excludes movement, suppression, target depletion and alternate weapons', sources, rows }, null, 2));
console.log(JSON.stringify({ output, count: rows.length, sample: rows.filter((r) => r.mode === V2_TW.id && r.level === 5 && r.scale === 'company' && r.targetScale === 'company').map((r) => ({ weapon: r.weapon, armor: r.armor, burst: Number(Number(r.burst).toFixed(2)), sustained: Number(Number(r.sustained).toFixed(2)) })) }, null, 2));
