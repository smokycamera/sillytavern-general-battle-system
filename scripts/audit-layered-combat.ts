/** Scenario smoke/performance audit: actual local AI, no model calls and no outcome claims from mocks. */
import { writeFileSync, mkdirSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { isDeepStrictEqual } from 'node:util';
import { generatedLayeredField, generateUnit, SmallBattle, V11_OVERFLOW_D20, groundBlocked, type Combatant, type BattlefieldPlan } from '../engine/src/index.js';
const samples: number[] = [], cases: unknown[] = [], failures: unknown[] = [], count = Number(process.env.TB_CASES ?? 24);
const began = performance.now();
const artifactDir = process.env.TB_LAYERED_AUDIT_DIR ?? 'artifacts/layered-review'; mkdirSync(artifactDir, { recursive: true });
for (let n = 0; n < count; n++) {
  const tag = n % 3 === 0 ? 'urban' : 'siege', attack = n % 2 ? 'enemy' as const : 'ally' as const;
  const units = (['ally', 'enemy'] as const).flatMap(side => Array.from({ length: 6 }, (_, i) => {
    const u = generateUnit({ name: side + '-' + i, side, scale: i === 0 ? 'hero' : 'company', hpMax: 20, level: 3, rulesVersion: 'v2',
      weaponClass: i === 5 ? 'cannon' : i === 4 ? 'rifle' : i === 3 ? 'bow' : 'blunt', weaponLevel: 3, armorTier: 2, armorLevel: 3,
      traits: i === 1 ? ['siege-assault', 'water-crossing'] : i === 2 ? ['siege-breaker'] : [],
    }, { seed: `${n}:${side}:${i}`, noVariance: true }).unit;
    u.id = side + i; u.morale = u.base.moraleMax = 100; return u;
  }));
  const seed = 'layer-play-' + n, plan: BattlefieldPlan = { shape: (['front', 'enclosure', 'broken', 'riverside', 'hillside'] as const)[n % 5], water: n % 4 === 0 ? 'river' : 'none', fortLevel: 3, size: n % 3 === 1 ? 'large' : 'standard' };
  const start = performance.now();
  try {
    const field = generatedLayeredField(seed, 7, 13, [tag], { roster: units, attackingSide: attack, plan });
    const battle = new SmallBattle({ battlefield: field, combatants: units, rules: V11_OVERFLOW_D20, seed });
    battle.commanderProfiles = { [attack]: { ability: 'expert', style: 'siege' }, [attack === 'ally' ? 'enemy' : 'ally']: { ability: 'expert', style: 'depth', preferences: { reserve: 3, counterattack: 3 } } };
    battle.start(); let actions = 0;
    const first = structuredClone(battle.toSnapshot());
    while (!battle.isOver() && actions < 720) {
      const id = battle.active?.id; if (!id) throw Error('no active unit before end');
      const tick = performance.now(); battle.autoAction(id); samples.push(performance.now() - tick); actions++;
      if (battle.combatants.some(u => u.status === 'ready' && groundBlocked(battle.battlefield!, u.pos!, u))) throw Error('unit in impossible terrain');
      if (actions === 12) {
        const snap = structuredClone(battle.toSnapshot()), restored = SmallBattle.fromSnapshot(structuredClone(snap));
        if (!isDeepStrictEqual(JSON.parse(JSON.stringify(restored.toSnapshot())), JSON.parse(JSON.stringify(snap)))) { writeFileSync(artifactDir + '/snapshot-diff.json', JSON.stringify({ before: snap, after: restored.toSnapshot() })); throw Error('live snapshot changes on restore'); }
        const left = SmallBattle.fromSnapshot(structuredClone(snap));
        if (!left.isOver()) { left.autoAction(left.active!.id); restored.autoAction(restored.active!.id); }
        if (!isDeepStrictEqual(restored.toSnapshot(), left.toSnapshot())) throw Error('restored AI diverges');
      }
    }
    const row = { seed, tag, shape: field.city?.shape, dimensions: `${field.width}x${field.height}`, actions, rounds: battle.round, ended: battle.isOver(), winner: battle.winner(),
      elapsedMs: performance.now() - start, broken: battle.battlefield!.structures?.filter(s => s?.hp === 0).length ?? 0,
      structureActions: battle.log.filter(e => e.text.includes('结构耐久')).length, climbs: battle.log.filter(e => /登上城防平台|下至地面/.test(e.text)).length,
      gates: battle.log.filter(e => /打开|关闭/.test(e.text) && e.text.includes('城门')).length };
    cases.push(row); console.log(JSON.stringify(row));
    if (n < 2) writeFileSync(`${artifactDir}/layered-case-${n}.json`, JSON.stringify({ initial: first, final: battle.toSnapshot() }));
  } catch (error) { const row = { seed, error: String(error), stack: error instanceof Error ? error.stack : '' }; failures.push(row); console.log(JSON.stringify(row)); }
}
samples.sort((a, b) => a - b);
const percentile = (p: number) => samples[Math.min(samples.length - 1, Math.floor(samples.length * p))];
const report = { count, completed: cases.length, elapsedMs: performance.now() - began, actionSamples: samples.length, p50Ms: percentile(.5), p95Ms: percentile(.95), maxMs: samples.at(-1), cases, failures };
writeFileSync('docs/layered-combat-audit-20260929.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, cases: undefined, failures: failures.slice(0, 10) }, null, 2));
if (failures.length) process.exitCode = 1;
