import { expect, it } from 'vitest';
import { generateUnit, traitRegistry, SmallBattle, MassBattle, standardField, V2_D20, V2_TW, weaponReloadKey, weaponReloadTurns, previewAttack, resolveAttack, standardConditionMap, type Combatant } from '../src/index.js';
import { parseWeaponSpec } from '../../panel/src/tags.js';
const registry = traitRegistry();
function unit(id: string, weaponClass = 'sword', sidearmClass = 'firearm') {
  const u = generateUnit({ name: id, side: id === 'a' ? 'ally' : 'enemy', rulesVersion: 'v2', scale: 'company', level: 3, hpMax: 500, weaponClass, weaponLevel: 3, sidearmClass, armorTier: 0, traits: [] }, { seed: id, registry, noVariance: true }).unit;
  u.id = id; u.morale = u.base.moraleMax = 100; u.base.atk = 100; u.tags.push('zone:中军', 'rank:front'); return u;
}
function battle(mode: string, a: Combatant, b: Combatant) {
  const rng = { seed: 'hit', next: () => 0, d: (n: number) => Math.min(10, n) };
  if (mode === 'mass') { const x = new MassBattle({ combatants: [a, b], rules: V2_TW, rng, traitRegistry: registry }); x.start(); return x; }
  const field = standardField(); field.tiles.fill('open'); field.objective = { kind: 'control', cell: 3, rounds: 10, limit: 20 };
  const x = new SmallBattle({ combatants: [a, b], rules: V2_D20, battlefield: field, rng, traitRegistry: registry });
  x.start(); x.turnOrder = ['a', 'b']; x.turnIndex = 0; a.pos = 45; b.pos = 31; return x;
}
function idleRound(x: SmallBattle | MassBattle) {
  if (x instanceof SmallBattle) { x.endTurn(); x.endTurn(); }
  else { x.issue({ unitId: 'a', type: 'hold' }); x.issue({ unitId: 'b', type: 'hold' }); x.resolveRound(); }
}
it('两模式副火枪独立装填、旧档缺省、恢复与自然倒计时一致，共用主行动', () => {
  for (const mode of ['small', 'mass']) {
    const a = unit('a', 'cannon'), b = unit('b'), x = battle(mode, a, b);
    delete a.sidearm!.reload; // 已有的火枪档案也需要装填。
    expect(weaponReloadTurns(a.sidearm)).toBe(1);
    const key = weaponReloadKey(a, a.sidearm); x.reloadCd.set(a.id, 3);
    if (x instanceof SmallBattle) {
      x.attack(a.id, b.id, { weaponMode: 'sidearm' });
      expect(x.reloadCd.get(a.id)).toBe(3); expect(x.reloadCd.get(key)).toBe(2);
      expect(() => x.attack(a.id, b.id, { weaponMode: 'sidearm' })).toThrow(/主行动/);
      idleRound(x);
    } else {
      expect(x.issue({ unitId: a.id, type: 'volley', targetId: b.id }).ok).toBe(true);
      x.issue({ unitId: b.id, type: 'hold' }); x.resolveRound();
      expect(x.reloadCd.get(a.id)).toBe(2);
    }
    expect(x.reloadCd.get(key)).toBe(1);
    const snapshot = structuredClone(x.toSnapshot());
    const restored = x instanceof SmallBattle ? SmallBattle.fromSnapshot(snapshot, { traitRegistry: registry }) : MassBattle.fromSnapshot(snapshot, { traitRegistry: registry });
    expect([...restored.reloadCd]).toEqual([...x.reloadCd]);
    if (restored instanceof SmallBattle) expect(restored.getActionOptions(a.id).find((o) => o.id === 'weapon:sidearm')!.targets![0]!.reason).toMatch(/装填/);
    else expect(restored.orderPreview({ unitId: a.id, type: 'volley', targetId: b.id }).reason).toMatch(/装填/);
    idleRound(restored); expect(restored.reloadCd.has(key), mode).toBe(false);
    if (restored instanceof SmallBattle) expect(restored.getActionOptions(a.id).find((o) => o.id === 'weapon:sidearm')!.enabled).toBe(true);
    else expect(restored.orderPreview({ unitId: a.id, type: 'volley', targetId: b.id }).reason).toBeUndefined();
  }
});
it('两模式射击技法使用副枪也触发并遵守副槽装填', () => {
  for (const mode of ['small', 'mass']) {
    const a = unit('a'), b = unit('b');
    a.preparedAbilityIds = ['shot']; a.abilities = [{ id: 'shot', name: '副枪射击', target: 'enemy', damageBasis: 'weapon', weaponUse: 'ranged', delivery: 'ranged', range: { min: 0, max: 3, metric: mode === 'mass' ? 'zone' : 'grid' }, effects: [{ op: 'damage', baseDice: '1d6' }] }];
    const x = battle(mode, a, b), key = weaponReloadKey(a, a.sidearm);
    x.reloadCd.set(key, 1); expect(x.useAbility(a.id, 'shot', b.id).ok).toBe(false);
    x.reloadCd.delete(key); const cast = x.useAbility(a.id, 'shot', b.id); expect(cast.ok, mode + cast.reason).toBe(true);
    if (x instanceof MassBattle) { x.issue({ unitId: b.id, type: 'hold' }); x.resolveRound(); }
    expect(x.reloadCd.get(key)).toBe(x instanceof SmallBattle ? 2 : 1); expect(x.reloadCd.has(a.id)).toBe(false);
  }
});
it('爆破分类可解析，编队内暴露实际生效且不随投送人数无限放大', () => {
  expect(parseWeaponSpec('矿用火药桶:爆破装置L2')).toMatchObject({ classKey: 'demolition', level: 2 });
  expect(parseWeaponSpec('矿用火药桶L2')).toMatchObject({ classKey: 'demolition', level: 2 });
  const a = unit('a', 'demolition'), b = unit('b');
  expect(a.weapon).toMatchObject({ tags: ['ranged', 'blast', 'mechanism:demolition'], range: 2, reload: 1, penetration: 4 });
  const opts = { attacker: a, defender: b, rules: V2_TW, ranged: true, conditionDefs: standardConditionMap(), traitRegistry: registry };
  const before = structuredClone([a, b]), preview = previewAttack(opts);
  expect([a, b]).toEqual(before);
  const single = previewAttack({ ...opts, participants: 1, weaponOverride: { ...a.weapon!, tags: ['ranged'] } });
  expect(preview.expectedDamage).toBeGreaterThan(single.expectedDamage * 3);
  const result = resolveAttack({ ...opts, rng: { seed: 'hit', next: () => 0, d: (n) => n } });
  expect(result.participants).toBe(2); expect(result.finalDamage).toBeGreaterThan(0);
  a.hp = 4; b.hp = 500; expect(previewAttack(opts).expectedDamage).toBe(preview.expectedDamage);
  a.hp = 1; expect(previewAttack(opts).expectedDamage).toBeLessThan(preview.expectedDamage * 0.6);
  a.scale = 'hero'; a.hp = 500; expect(resolveAttack({ ...opts, rng: { seed: 'hit', next: () => 0, d: (n) => n } }).participants).toBe(1);
});
it('两模式旧爆破近距不再受罚、远距减2，预览与实际命中修正一致且仍装填', () => {
  for (const mode of ['small', 'mass']) {
    const a = unit('a', 'demolition'), b = unit('b'); a.base.atk = 5;
    // 使用旧实例字段，确认无需重建装备即可应用距离规则。
    a.weapon!.pointBlankPolicy = 'penalty'; a.weapon!.pointBlankPenalty = -3;
    const x = battle(mode, a, b);
    const at = (far: boolean) => {
      if (x instanceof SmallBattle) b.pos = far ? 31 : 38;
      else { a.formationPosition = far ? 'ally:中军:rear' : 'ally:中军:front'; b.formationPosition = 'enemy:中军:front'; }
      return x instanceof SmallBattle ? x.getActionOptions(a.id).find((o) => o.id === 'weapon')!.targets![0]!.preview!
        : x.orderPreview({ unitId: a.id, type: 'volley', targetId: b.id }).preview!;
    };
    const near = at(false), far = at(true);
    expect(near.attackModifiers ?? '').not.toContain('抵近射击');
    expect(far.attackScore).toBe(near.attackScore! - 2);
    expect(far.attackModifiers).toContain('爆破远距攻击');
    expect(far.hitChance).toBeLessThan(near.hitChance!);
    if (x instanceof SmallBattle) expect(x.attack(a.id, b.id).netAtk).toBe(far.attackScore);
    else {
      expect(x.issue({ unitId: a.id, type: 'volley', targetId: b.id }).ok).toBe(true);
      x.issue({ unitId: b.id, type: 'hold' }); x.resolveRound();
      expect(x.log.find((l) => l.resolution?.attackerId === a.id)!.resolution!.netAtk).toBe(far.attackScore);
    }
    expect(x.reloadCd.get(a.id)).toBe(x instanceof SmallBattle ? 2 : 1);
  }
});
