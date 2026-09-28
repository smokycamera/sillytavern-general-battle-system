import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateUnit, prepareCombatModel, previewAttack, resolveAttack, standardConditionMap, traitRegistry,
  V8_OVERFLOW_D20, grantBarrier, SeededRng, type AttackOpts } from '../src/index.js';
import { memberHealth } from '../src/member-health.js';
import { bracePose } from '../src/tactics.js';
let serial = 0;
function options(scale: 'hero' | 'company' = 'hero'): Omit<AttackOpts, 'rng'> {
  const registry = traitRegistry(), id = 'cache-' + serial++;
  const units = ['a', 'd'].map(side => {
    const u = generateUnit({ name: id + side, side: side === 'a' ? 'ally' : 'enemy', scale, level: 4,
      ...(scale === 'company' ? { hpMax: 20 } : {}), rulesVersion: 'v2', damageModel: 'wounds-v2',
      weaponClass: 'bow', weaponLevel: 4, armorTier: 0, traits: [] }, { seed: id + side, registry, noVariance: true }).unit;
    u.id = id + side; prepareCombatModel(u, V8_OVERFLOW_D20); return u;
  });
  units[0]!.weapon!.attacks = 2; grantBarrier(units[1]!, 10, 4);
  return { attacker: units[0]!, defender: units[1]!, rules: structuredClone(V8_OVERFLOW_D20),
    conditionDefs: standardConditionMap(), traitRegistry: registry, ranged: true, distance: 4 };
}
afterEach(() => vi.restoreAllMocks());
describe('屏障多段预览的有界值缓存', () => {
  it.each(['hero', 'company'] as const)('%s 保持原96种子模拟的每项统计与战斗对象不变', scale => {
    const o = options(scale), before = JSON.stringify(o), preview = previewAttack(o);
    let sum = 0, squares = 0, positive = 0, casualties = 0, maximum = 0, hits = 0;
    for (let i = 0; i < 96; i++) {
      const attacker = structuredClone(o.attacker), defender = structuredClone(o.defender), hp = memberHealth(defender), count = defender.hp;
      const rng = new SeededRng('barrier-preview:' + i); let hit = false;
      for (let j = 0; j < o.attacker.weapon!.attacks! && defender.hp > 0; j++) hit = resolveAttack({ ...o, attacker, defender, rng }).hit || hit;
      const loss = hp - memberHealth(defender); sum += loss; squares += loss * loss; positive += Number(loss > 0);
      casualties += count - defender.hp; maximum = Math.max(maximum, loss); hits += Number(hit);
    }
    expect(preview.expectedDamage).toBe(sum / 96); expect(preview.damageOnHit).toBe(hits ? sum / hits : 0);
    expect(preview.variance).toBe(Math.max(0, squares / 96 - (sum / 96) ** 2));
    expect(preview.damageChance).toBe(positive / 96); expect(preview.maxDamage).toBe(maximum);
    if (scale === 'company') expect(preview.expectedCasualties).toBe(casualties / 96);
    expect(JSON.stringify(o)).toBe(before); expect(previewAttack(o)).toEqual(preview);
  });
  it('重复查询与无姿态的等价走位不再克隆96次，返回值修改不污染缓存', () => {
    const o = options(), spy = vi.spyOn(globalThis, 'structuredClone'), first = previewAttack(o);
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(192); spy.mockClear();
    o.attacker.pos = 7; o.defender.pos = 35;
    const again = previewAttack(o); expect(again).toEqual(first); expect(spy.mock.calls.filter(([value]) => (value as { id?: string } | undefined)?.id === o.attacker.id || (value as { id?: string } | undefined)?.id === o.defender.id)).toHaveLength(0);
    again.expectedDamage = -999; expect(previewAttack(o)).toEqual(first);
  });
  const changes: [string, (o: Omit<AttackOpts, 'rng'>) => void][] = [
    ['目标生命', o => { o.defender.hp--; }],
    ['屏障容量', o => { o.defender.barrier!.remaining++; }],
    ['屏障持续', o => { o.defender.barrier!.duration++; }],
    ['屏障防御规格', o => { o.defender.barrier!.defenses = [{ power: 8, duration: 4 }]; }],
    ['攻击者等级', o => { o.attacker.level++; }],
    ['武器属性', o => { o.attacker.weapon!.attacks = 3; }],
    ['防守者装备', o => { o.defender.weapon!.recipe!.bonuses = { defense: 6 }; }],
    ['控制状态', o => { o.defender.conditions.push({ id: 'stunned', dur: 2 }); }],
    ['疲劳', o => { o.attacker.fatigue = 4; }],
    ['地形', o => { o.defenderTerrain = 'forest'; }],
    ['距离', o => { o.distance = 1; }],
    ['参战份数', o => { o.participants = 1; }],
    ['行动系数', o => { o.actionDamageScale = .5; }],
    ['优势骰', o => { o.advantage = 'adv'; }],
    ['规则', o => { o.rules.critMin = 18; }],
    ['状态表内容', o => { const d = o.conditionDefs.get('stunned')!; o.conditionDefs.set('stunned', { ...d, name: 'changed' }); }],
    ['特质表内容', o => { const [id, t] = [...o.traitRegistry!][0]!; o.traitRegistry!.set(id, { ...t, name: 'changed' }); }],
  ];
  it.each(changes)('%s变化立即重新计算', (_name, change) => {
    const o = options(); previewAttack(o); change(o);
    const spy = vi.spyOn(globalThis, 'structuredClone'); previewAttack(o);
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(192);
  });
  it('有方向性固守时位置不能合并', () => {
    const o = options(); o.attacker.pos = 3; o.defender.pos = 24;
    o.defender.tacticalPose = bracePose(o.defender, o.attacker, 'small', 7); previewAttack(o);
    o.attacker.pos = 45; const spy = vi.spyOn(globalThis, 'structuredClone'); previewAttack(o);
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(192);
  });
  it('编队伤损分布改变不能复用旧样本', () => {
    const o = options('company'); previewAttack(o);
    o.defender.formation = structuredClone(o.defender.formation);
    // 该字段属于伤损模型的一部分，即使当前同人数也必须重新计算。
    o.defender.formation!.health![0]!.hp--;
    const spy = vi.spyOn(globalThis, 'structuredClone'); previewAttack(o);
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(192);
  });
  it('跨过条目上限会淘汰旧结果，不无限积累整个存档历史', () => {
    const o = options(); previewAttack(o);
    for (let i = 0; i < 130; i++) previewAttack({ ...o, actionDamageScale: .01 + i / 1000 });
    const spy = vi.spyOn(globalThis, 'structuredClone'); previewAttack(o);
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(192);
  });
});
