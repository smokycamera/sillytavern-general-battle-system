import { describe, expect, it } from 'vitest';
import { generateUnit, SmallBattle, MassBattle, standardField, traitRegistry, V2_D20, V2_TW, type Combatant } from '../src/index.js';
const registry = traitRegistry();
function unit(id: string, traits: string[] = [], scale: Combatant['scale'] = 'hero') {
  const u = generateUnit({ name: id, side: id === 'a' ? 'ally' : 'enemy', scale, rulesVersion: 'v2', level: 3, hpMax: 500, weaponClass: 'bow', weaponLevel: 5, armorTier: 1, traits }, { registry, seed: id, noVariance: true }).unit; u.id = id; return u;
}
function grid(traits: string[] = [], tags: string[] = []) {
  const a = unit('a', traits), b = unit('b'); const field = standardField(); field.tiles.fill('open');
  const battle = new SmallBattle({ rules: V2_D20, combatants: [a, b], battlefield: field, field: { tags }, traitRegistry: registry, seed: 'environment', rng: { seed: 'hit', next: () => 0, d: (n) => n } });
  battle.start(); battle.turnOrder = ['a', 'b']; battle.turnIndex = 0; a.pos = 31; b.pos = 10; return { a, b, field: battle.battlefield!, battle };
}
describe('真实地形与环境适应', () => {
  it('游击的投射防护受真实接敌限制，两种模式都不能被远处射手绕过判定', () => {
    for (const mode of ['small', 'mass']) for (const engaged of [false, true]) {
      const a = unit('a', ['skirmisher']), b = unit('b'), c = unit('c'); c.id = 'c';
      if (mode === 'small') {
        const field = standardField(); field.tiles.fill('open');
        const battle = new SmallBattle({ rules: V2_D20, combatants: [a, b, ...(engaged ? [c] : [])], battlefield: field, seed: 'skirmish', rng: { seed: 'hit', next: () => 0, d: (n) => n } }); battle.start();
        battle.turnOrder = ['b', 'a', ...(engaged ? ['c'] : [])]; battle.turnIndex = 0; a.pos = 31; b.pos = 10; c.pos = 32;
        expect(battle.attack('b', 'a').wardMult).toBe(engaged ? 1 : 0.75);
      } else {
        for (const u of [a, b, c]) u.scale = 'company'; b.tags.push('rank:rear');
        const battle = new MassBattle({ rules: V2_TW, combatants: [a, b, ...(engaged ? [c] : [])], seed: 'skirmish', rng: { seed: 'hit', next: () => 0, d: (n) => n } }); battle.start();
        expect(battle.traitRegistry.has('skirmisher')).toBe(true);
        battle.issue({ unitId: 'b', type: 'volley', targetId: 'a' }); battle.issue({ unitId: 'a', type: 'hold' }); if (engaged) battle.issue({ unitId: 'c', type: 'hold' }); battle.resolveRound(1);
        expect(battle.log.find((l) => l.resolution?.attackerId === 'b')?.resolution?.wardMult).toBe(engaged ? 1 : 0.75);
      }
    }
  });
  it('森林和山地有真实路径成本，适应只免对应代价，墙与容量照常', () => {
    for (const [terrain, trait] of [['forest', 'forest-lore'], ['hill', 'mountain-born']] as const) {
      for (const adapted of [false, true]) {
        const { battle, field, a } = grid(adapted ? [trait] : []);
        field.tiles[24] = terrain; field.tiles[17] = terrain;
        expect(battle.pathPreview('a', 24).path?.cost).toBe(adapted ? 1 : 2);
        battle.moveTo('a', 24); expect(battle.movementLeft('a')).toBe(adapted ? 2 : 1);
        field.tiles[23] = 'wall'; expect(battle.pathPreview('a', 23).path).toBeUndefined(); expect(a.pos).toBe(24);
      }
    }
  });
  it('夜间实际攻击和移动受限，夜战适应撤销惩罚，白天不白赚', () => {
    for (const mode of ['small', 'mass']) for (const night of [false, true]) for (const adapted of [false, true]) {
      const traits = adapted ? ['night-fighter'] : [], tags = night ? ['night'] : ['plains'];
      if (mode === 'small') {
        const { a, battle } = grid(traits, tags); expect(battle.movementLeft('a')).toBe(night && !adapted ? 2 : 3);
        expect(battle.attack('a', 'b').netAtk).toBe(a.base.atk - (night && !adapted ? 2 : 0));
      } else {
        const a = unit('a', traits, 'company'), b = unit('b', [], 'company');
        a.tags = [...a.tags.filter((t) => !t.startsWith('rank:')), 'rank:rear'];
        const battle = new MassBattle({ rules: V2_TW, combatants: [a, b], field: { tags }, traitRegistry: registry, seed: 'night', rng: { seed: 'hit', next: () => 0, d: (n) => n } }); battle.start();
        battle.issue({ unitId: 'a', type: 'volley', targetId: 'b' }); battle.issue({ unitId: 'b', type: 'hold' }); battle.resolveRound(1);
        expect(battle.log.find((l) => l.resolution?.attackerId === a.id)?.resolution?.netAtk).toBe(a.base.atk - (night && !adapted ? 2 : 0));
      }
    }
  });
  it('会战环境适应改变真实纵深调动，未适应的快速部队在林山环境不能跨两层', () => {
    for (const [env, trait] of [['forest', 'forest-lore'], ['mountain', 'mountain-born']]) for (const adapted of [false, true]) {
      const a = unit('a', ['fast', ...(adapted ? [trait!] : [])], 'company'), b = unit('b', [], 'company'); a.tags.push('rank:reserve');
      const battle = new MassBattle({ rules: V2_TW, combatants: [a, b], field: { tags: [env!] }, traitRegistry: registry, seed: 'terrain-march' }); battle.start();
      battle.issue({ unitId: 'a', type: 'rank-forward' }); battle.issue({ unitId: 'b', type: 'hold' }); battle.resolveRound(1);
      expect(battle.rankOf(a)).toBe(adapted ? 'front' : 'rear');
    }
  });
  it('守城工事仅在攻城场景固守正面生效，野战与离开姿态不能被动减伤', () => {
    for (const siege of [false, true]) for (const braced of [false, true]) {
      const { a, battle } = grid(['fortification'], [siege ? 'siege' : 'plains']);
      if (braced) battle.brace('a'); battle.endTurn();
      const result = battle.attack('b', 'a'); expect(result.wardMult).toBe(siege && braced ? 0.7 : 1);
      expect(result.targetDef).toBe(a.base.def + (braced ? siege ? 3 : 2 : 0));
    }
  });
  it('系统生成林山地形，快照保留环境，原野专长的移动收益只在野战生效', () => {
    for (const env of ['forest', 'mountain']) {
      const field = standardField(7, 9, [env]);
      expect(field.tiles).toContain(env === 'forest' ? 'forest' : 'hill');
      const battle = new SmallBattle({ rules: V2_D20, combatants: [unit('a'), unit('b')], battlefield: field, traitRegistry: registry, seed: env }); battle.start();
      expect(SmallBattle.fromSnapshot(JSON.parse(JSON.stringify(battle.toSnapshot())), { traitRegistry: registry }).fieldTags).toContain(env);
    }
    expect(grid(['plains-runner'], ['plains']).battle.movementLeft('a')).toBe(4);
    expect(grid(['plains-runner'], ['urban']).battle.movementLeft('a')).toBe(3);
  });
  it('环境攻防同时用于技能预览与实际伤害，默认恢复不丢内置特质', () => {
    const { a, b, battle } = grid(['urban-fighter'], ['urban']);
    a.abilities = [{ id: 'spell', name: '术式', target: 'enemy', range: { min: 1, max: 4, metric: 'grid' }, effects: [{ op: 'damage', baseDice: '1d6' }] }];
    a.preparedAbilityIds = ['spell'];
    expect(battle.getActionOptions('a').find((o) => o.id === 'spell')!.targets!.find((o) => o.targetId === b.id)!.preview?.expectedDamage).toBeGreaterThan(0);
    const restored = SmallBattle.fromSnapshot(JSON.parse(JSON.stringify(battle.toSnapshot())));
    restored.useAbility('a', 'spell', 'b'); expect([...restored.log].reverse().find((l) => l.resolution)?.resolution?.netAtk).toBe(a.base.atk + 1);
  });
});
