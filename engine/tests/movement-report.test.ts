import { expect, it } from 'vitest';
import { generateUnit, SmallBattle, standardField, V2_D20, type Terrain } from '../src/index.js';
import { compactEvents } from '../src/inject/format.js';

function movementBattle() {
  const units = (['ally', 'enemy'] as const).map(side => {
    const u = generateUnit({ name: side === 'ally' ? '步枪兵' : '守军', side, scale: 'hero', rulesVersion: 'v2',
      level: 4, weaponClass: 'sword', weaponLevel: 5, armorTier: 0, hpMax: 500, traits: [] }, { seed: side, noVariance: true }).unit;
    u.id = side; return u;
  });
  const field = standardField(); field.tiles.fill('open');
  const b = new SmallBattle({ combatants: units, battlefield: field, rules: V2_D20, seed: 'terrain-report' });
  b.start(); b.turnOrder = ['ally', 'enemy']; b.turnIndex = 0;
  b.byId('ally').pos = 42; b.byId('enemy').pos = 7;
  return b;
}

it.each<[Terrain, string]>([['cover', '掩体'], ['rough', '崎岖地'], ['forest', '森林'], ['hill', '山地'], ['open', '']])(
  '移动战报记录实际进入的%s，归档与摘要保留地形', (terrain, label) => {
    const b = movementBattle(); b.battlefield!.tiles[43] = terrain;
    b.moveTo('ally', 43);
    const text = '步枪兵 A7→B7' + (label ? '(' + label + ')' : '');
    expect(b.log.at(-1)?.text).toBe(text);
    expect(compactEvents(b.log)).toContain(text);
    expect(SmallBattle.fromSnapshot(structuredClone(b.toSnapshot())).log.at(-1)?.text).toBe(text);
  },
);

it('飞越墙体注明上空；移动反应致死时不虚构后续落点', () => {
  const flying = movementBattle(), flyer = flying.byId('ally');
  flyer.traits.push('flying'); flyer.airborne = true; flying.battlefield!.tiles[43] = 'wall';
  flying.moveTo('ally', 43);
  expect(flying.log.at(-1)?.text).toBe('步枪兵 A7→B7(墙体上空)');

  const b = movementBattle(); b.byId('ally').hp = 1; b.byId('enemy').pos = 35; b.byId('enemy').base.atk = 100;
  b.battlefield!.tiles[43] = b.battlefield!.tiles[45] = 'cover';
  b.moveTo('ally', 45);
  expect(b.byId('ally').pos).toBe(43); expect(b.byId('ally').status).not.toBe('ready');
  expect(compactEvents(b.log)).toContain('步枪兵 A7→B7(掩体)');
  expect(b.log.some(e => e.text.includes('D7(掩体)'))).toBe(false);
});
