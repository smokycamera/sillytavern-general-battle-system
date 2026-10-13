import { describe, expect, it } from 'vitest';
import { generateUnit, SmallBattle, standardField, traitRegistry, V8_OVERFLOW_D20 } from '../src/index.js';
const registry = traitRegistry();
describe('骑兵 AI 路径复用', () => {
  it('骑兵连续激活的路径缓存不跨行动保留，与每次从快照恢复的战斗一致', () => {
    const field = standardField(7, 13); field.tiles.fill('open');
    field.layerVersion = 1; field.structures = field.tiles.map(() => null);
    field.tiles[44] = 'shallow_water'; field.tiles[45] = 'rough'; field.tiles[46] = 'wall';
    const units = Array.from({ length: 4 }, (_, i) => {
      const u = generateUnit({ name: `骑兵${i}`, side: i < 2 ? 'ally' : 'enemy', scale: 'company', hpMax: 20,
        rulesVersion: 'v2', damageModel: 'wounds-v2', level: 4, weaponClass: 'spear', weaponLevel: 4, armorTier: 1,
        traits: [], archetype: 'mobile' }, { registry, seed: `cavalry-cache:${i}`, noVariance: true }).unit;
      u.id = `cavalry${i}`; u.mount = true; return u;
    });
    const b = new SmallBattle({ combatants: units, battlefield: field, rules: V8_OVERFLOW_D20, seed: 'cavalry-cache', traitRegistry: registry });
    b.start(); b.turnOrder = units.map(u => u.id); b.turnIndex = 0;
    units.forEach((u, i) => u.pos = (i < 2 ? 8 : 5) * field.width + 2 + i % 2);
    for (let i = 0; i < 4 && !b.isOver(); i++) {
      const restored = SmallBattle.fromSnapshot(structuredClone(b.toSnapshot()), { traitRegistry: registry });
      if (b.active!.status === 'ready') { b.autoAction(b.active!.id); restored.autoAction(restored.active!.id); }
      else { b.endTurn(); restored.endTurn(); }
      expect(b.toSnapshot()).toEqual(restored.toSnapshot());
    }
    expect(b.log.some(e => e.kind === 'move')).toBe(true);
    expect(b.log.some(e => e.kind === 'attack')).toBe(true);
  });
});
