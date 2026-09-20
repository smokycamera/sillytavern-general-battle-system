import { writeFileSync } from 'node:fs';
import { generateUnit, MassBattle, traitRegistry, V2_TW } from '../engine/src/index.js';
const registry = traitRegistry();
const roster = Array.from({ length: 18 }, (_, n) => {
  const u = generateUnit({ name: '编队' + n, side: n < 9 ? 'ally' : 'enemy', rulesVersion: 'v2',
    scale: 'company', hpMax: 100, level: 4, weaponClass: n % 3 === 0 ? 'sword' : 'rifle', traits: [], armorTier: 1 },
    { seed: 'mass-capacity:' + n, registry, noVariance: true }).unit;
  u.id = 'unit-' + String(n).padStart(2, '0');
  u.tags.push('zone:' + ['左翼', '中军', '右翼'][Math.floor(n % 9 / 3)], 'rank:front'); return u;
});
function run(reverse: boolean) {
  const b = new MassBattle({ combatants: structuredClone(reverse ? [...roster].reverse() : roster), rules: V2_TW, traitRegistry: registry, seed: 'mass-capacity' });
  b.start(); const times: number[] = [];
  while (!b.isOver() && times.length < 60) {
    const start = performance.now(); b.autoOrders('ally'); b.autoOrders('enemy'); b.resolveRound(); times.push(performance.now() - start);
  }
  if (!b.isOver()) throw Error('多编队会战未按规则结束');
  return { winner: b.winner(), rounds: times.length, limit: b.endingReason(), meanRoundMs: times.reduce((a, b) => a + b, 0) / times.length, maxRoundMs: Math.max(...times),
    units: b.combatants.map((u) => ({ id: u.id, hp: u.hp, status: u.status, morale: u.morale, fatigue: u.fatigue })).sort((a, b) => a.id.localeCompare(b.id)) };
}
const forward = run(false), reversed = run(true);
if (forward.winner !== reversed.winner || forward.rounds !== reversed.rounds || JSON.stringify(forward.units) !== JSON.stringify(reversed.units)) throw Error('输入数组顺序改变会战结果');
const report = { date: new Date().toISOString(), scope: '18个单位的完整对局与输入排列不变性诊断，不作500对胜率结论', forward, reversed };
writeFileSync('engine/sim/out/p6-mass-capacity.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({ winner: forward.winner, rounds: forward.rounds, reason: forward.limit, meanRoundMs: forward.meanRoundMs, maxRoundMs: forward.maxRoundMs, permutationIdentical: true }));
