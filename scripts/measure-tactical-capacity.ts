import { mkdirSync, writeFileSync } from 'node:fs';
import { generatedField, generateUnit, SmallBattle, traitRegistry, V2_D20 } from '../engine/src/index.js';
import { renderTacticalBattle } from '../panel/src/tactical-view.js';
import { recommendBattleMode } from '../panel/src/battle-setup.js';
const registry = traitRegistry(), rows: Record<string, unknown>[] = [];
for (const count of [8, 16, 18]) {
  const units = Array.from({ length: count }, (_, n) => {
    const u = generateUnit({ name: '编队' + n, side: n < count / 2 ? 'ally' : 'enemy', scale: 'company', hpMax: 100,
      rulesVersion: 'v2', level: 4, weaponClass: n % 3 === 0 ? 'sword' : 'rifle', armorTier: 1, traits: [] },
      { registry, seed: 'capacity:' + n, noVariance: true }).unit;
    u.id = 'unit-' + String(n).padStart(2, '0'); return u;
  });
  const b = new SmallBattle({ combatants: units, rules: V2_D20, traitRegistry: registry, seed: 'capacity',
    battlefield: generatedField('capacity', 7, 9, ['forest']) });
  b.start();
  const renderTimes: number[] = [], actionTimes: number[] = [];
  for (let n = 0; n < count && !b.isOver(); n++) {
    const actor = b.active!;
    if (actor.side === 'ally') {
      const before = JSON.stringify(b.toSnapshot()), started = performance.now();
      renderTacticalBattle(b, { selectedId: actor.id, mode: 'weapon' });
      renderTimes.push(performance.now() - started);
      if (JSON.stringify(b.toSnapshot()) !== before) throw Error('渲染改变战斗');
    }
    const started = performance.now(); b.autoAction(actor.id); actionTimes.push(performance.now() - started);
  }
  const summarize = (values: number[]) => ({ samples: values.length, meanMs: values.reduce((a, b) => a + b, 0) / values.length, maxMs: Math.max(...values) });
  rows.push({ count, recommendation: recommendBattleMode(units).mode, render: summarize(renderTimes), aiActivation: summarize(actionTimes), ended: b.isOver(), round: b.round });
  console.log(JSON.stringify(rows.at(-1)));
}
mkdirSync('engine/sim/out', { recursive: true });
writeFileSync('engine/sim/out/p6-capacity.json', JSON.stringify({ date: new Date().toISOString(),
  scope: '本机单进程Node真实引擎与纯HTML渲染，一轮操作容量诊断；不是浏览器布局或500对平衡统计', rows }, null, 2));
