import { describe, expect, it } from 'vitest';
import { generateUnit, prepareCombatModel, previewAttack, resolveAttack, standardConditionMap, traitRegistry,
  V8_OVERFLOW_D20, V8_OVERFLOW_TW, V29_OVERFLOW_D20, V32_OVERFLOW_D20, V34_OVERFLOW_D20, V34_OVERFLOW_TW, V39_OVERFLOW_D20, V39_OVERFLOW_TW, prepareArmsModel, compileItem, grantBarrier, SeededRng, sampledPreviewComputations, beginPreviewScope, endPreviewScope, previewScopeEpoch, type AttackOpts } from '../src/index.js';
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
/** 统计一次查询实际执行的96种子抽样次数：命中缓存为0，重新计算为1。 */
function computed(query: () => unknown): number { const before = sampledPreviewComputations(); query(); return sampledPreviewComputations() - before; }
describe('屏障多段预览的有界值缓存', () => {
  const scenarios: [string, 'hero' | 'company', (o: Omit<AttackOpts, 'rng'>) => void][] = [
    ...(['dagger', 'cannon', 'sprayer'] as const).flatMap(mechanism => [V34_OVERFLOW_D20, V34_OVERFLOW_TW, V39_OVERFLOW_D20, V39_OVERFLOW_TW].map<[string, 'company', (o: Omit<AttackOpts, 'rng'>) => void]>(rules => [
      `${rules.id} ${mechanism} 分段抽样`, 'company', o => {
        o.rules = rules;
        const weapon = compileItem({ kind: 'weapon', mechanism, power: 4 }, { id: mechanism, seed: mechanism });
        if (weapon.kind !== 'weapon') throw Error('weapon fixture');
        o.attacker.weapon = weapon.value; o.attacker.weapon.attacks = 2;
        o.ranged = mechanism !== 'dagger'; o.distance = o.ranged ? 4 : 1;
        for (const u of [o.attacker, o.defender]) prepareArmsModel(u, rules);
        o.defender.conditions = [{ id: 'stunned', dur: 2 }];
        o.defender.formation!.health = [{ count: 10, hp: 3 }, { count: 10, hp: o.defender.formation!.memberHp }];
      },
    ])),
    ['个体连击', 'hero', () => {}],
    ['编队连击', 'company', () => {}],
    ['优势与扩大暴击', 'company', o => { o.advantage = 'adv'; o.rules.critMin = 15; }],
    ['劣势与伤害保留骰', 'company', o => { o.advantage = 'dis'; o.attacker.weapon!.baseDice = '4d6kl3+2'; }],
    ['概率命中与溅射', 'company', o => { o.rules = V8_OVERFLOW_TW; o.attacker.weapon!.splashTargets = 3; o.attacker.weapon!.splashFactor = .5; }],
    ['范围法术与屏障', 'company', o => { o.abilityDamage = { baseDice: '2d6kh1+5', apDice: '2d4-1', shape: 'burst', areaExposure: 4, channel: 'arcane', penetration: 10 }; }],
    ['目标耗尽', 'hero', o => { o.defender.hp = 1; o.defender.barrier = undefined; }],
    ['V29编队伤口与屏障', 'company', o => {
      o.rules = V29_OVERFLOW_D20;
      for (const u of [o.attacker, o.defender]) prepareArmsModel(u, o.rules);
      o.defender.formation!.health = [{ count: 10, hp: 3 }, { count: 10, hp: o.defender.formation!.memberHp }];
    }],
    ['V29实体盾耐久与编队减员', 'company', o => {
      o.rules = V29_OVERFLOW_D20;
      const shield = compileItem({ kind: 'shield', mechanism: 'shield', power: 4 }, { id: 'shield', seed: 'shield' });
      if (shield.kind !== 'shield') throw Error('shield fixture');
      o.defender.shield = shield.value;
      for (const u of [o.attacker, o.defender]) prepareArmsModel(u, o.rules);
      o.defender.shieldDurability = { remaining: 2 };
    }],
    ...[false, true].map<[string, 'company', (o: Omit<AttackOpts, 'rng'>) => void]>(staleModel => [
      'V32能量盾耗尽及规则覆盖' + staleModel, 'company', o => {
        o.rules = V32_OVERFLOW_D20;
        const shield = compileItem({ kind: 'shield', mechanism: 'energy-shield', power: 4 }, { id: 'energy', seed: 'energy' });
        if (shield.kind !== 'shield') throw Error('energy shield fixture');
        o.defender.shield = shield.value;
        for (const u of [o.attacker, o.defender]) prepareArmsModel(u, o.rules);
        o.defender.energyShield!.remaining = 7;
        o.defender.conditions = [{ id: 'blessed', dur: 2, defensePower: 4 }, { id: 'exposed', dur: 2 }];
        if (staleModel) delete o.defender.armsModel;
      },
    ]),
    ['V32无盾、多种状态与伤口', 'company', o => {
      o.rules = V32_OVERFLOW_D20; delete o.defender.barrier;
      for (const u of [o.attacker, o.defender]) prepareArmsModel(u, o.rules);
      o.defender.conditions = [{ id: 'blessed', dur: 2, defensePower: 3 }, { id: 'exposed', dur: 3, magnitude: .7 }];
      o.defender.formation!.health = [{ count: 10, hp: 3 }, { count: 10, hp: o.defender.formation!.memberHp }];
    }],
    ...(['hero', 'company'] as const).map<[string, 'hero' | 'company', (o: Omit<AttackOpts, 'rng'>) => void]>(scale => [
      `V39 ${scale} 分层屏障、能量盾与伤兵/不屈逐种子恢复`, scale, o => {
        o.rules = V39_OVERFLOW_D20;
        const shield = compileItem({ kind: 'shield', mechanism: 'energy-shield', power: 4 }, { id: 'energy-v39', seed: 'energy-v39' });
        if (shield.kind !== 'shield') throw Error('shield fixture');
        o.defender.shield = shield.value;
        o.defender.traits.push(scale === 'hero' ? 'indomitable' : 'medic');
        for (const u of [o.attacker, o.defender]) prepareArmsModel(u, o.rules);
        o.defender.energyShield!.remaining = 7;
        o.defender.barrier = undefined;
        grantBarrier(o.defender, 5, 3, 'layer-a', 2); grantBarrier(o.defender, 9, 4, 'layer-b', 4);
        if (scale === 'hero') o.defender.hp = 3;
        else o.defender.woundedPercentRemainder = 50;
      },
    ]),
  ];
  it.each(scenarios)('%s 保持原96种子模拟的每项统计与战斗对象不变', (_name, scale, configure) => {
    const o = options(scale); configure(o);
    const before = JSON.stringify(o), preview = previewAttack(o);
    let sum = 0, squares = 0, positive = 0, casualties = 0, maximum = 0, hits = 0;
    for (let i = 0; i < 96; i++) {
      const attacker = structuredClone(o.attacker), defender = structuredClone(o.defender), hp = memberHealth(defender), count = defender.hp;
      const rng = new SeededRng('barrier-preview:' + i); let hit = false;
      for (let j = 0; j < (o.abilityDamage ? 1 : o.attacker.weapon!.attacks!) && defender.hp > 0; j++) hit = resolveAttack({ ...o, attacker, defender, rng }).hit || hit;
      const loss = hp - memberHealth(defender); sum += loss; squares += loss * loss; positive += Number(loss > 0);
      casualties += count - defender.hp; maximum = Math.max(maximum, loss); hits += Number(hit);
    }
    expect(preview.expectedDamage).toBe(sum / 96); expect(preview.damageOnHit).toBe(hits ? sum / hits : 0);
    expect(preview.variance).toBe(Math.max(0, squares / 96 - (sum / 96) ** 2));
    expect(preview.damageChance).toBe(positive / 96); expect(preview.maxDamage).toBe(maximum);
    if (scale === 'company') expect(preview.expectedCasualties).toBe(casualties / 96);
    expect(JSON.stringify(o)).toBe(before); expect(previewAttack(o)).toEqual(preview);
    beginPreviewScope(true);
    try { expect(previewAttack(o)).toEqual(preview); expect(previewAttack(structuredClone(o))).toEqual(preview); }
    finally { endPreviewScope(); }
  });
  it('重复查询与无姿态的等价走位不再重新抽样，返回值修改不污染缓存', () => {
    const o = options(); let first!: ReturnType<typeof previewAttack>;
    expect(computed(() => { first = previewAttack(o); })).toBe(1);
    o.attacker.pos = 7; o.defender.pos = 35;
    let again!: ReturnType<typeof previewAttack>;
    expect(computed(() => { again = previewAttack(o); })).toBe(0); expect(again).toEqual(first);
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
    expect(computed(() => previewAttack(o))).toBe(1);
  });
  it('有方向性固守时只合并固守效果相同的位置', () => {
    const o = options(); o.attacker.pos = 3; o.defender.pos = 24;
    o.defender.tacticalPose = bracePose(o.defender, o.attacker, 'small', 7); previewAttack(o);
    o.attacker.pos = 10; expect(computed(() => previewAttack(o))).toBe(0); // 仍在正面
    o.attacker.pos = 45; expect(computed(() => previewAttack(o))).toBe(1); // 绕到背后，失去固守加成
    // 离开锚点后固守失效，与背后同样没有固守加成，可以复用。
    o.attacker.pos = 10; o.defender.pos = 25; expect(computed(() => previewAttack(o))).toBe(0);
  });
  it('疲劳只按惩罚档、距离只按≤1/≥2区分，精力、冷却与攻方屏障不影响样本', () => {
    const o = options(); previewAttack(o);
    o.attacker.fatigue = 1; o.distance = 6; o.attacker.resources = { ...o.attacker.resources, SP: 0 }; o.attacker.abilityState = [];
    o.attacker.barrier = { remaining: 50, duration: 3 };
    expect(computed(() => previewAttack(o))).toBe(0);
  });
  it('编队伤损分布改变不能复用旧样本', () => {
    const o = options('company'); previewAttack(o);
    o.defender.formation = structuredClone(o.defender.formation);
    // 该字段属于伤损模型的一部分，即使当前同人数也必须重新计算。
    o.defender.formation!.health![0]!.hp--;
    expect(computed(() => previewAttack(o))).toBe(1);
  });
  it('跨过条目上限会淘汰旧结果，不无限积累整个存档历史', () => {
    const o = options(); previewAttack(o);
    for (let i = 0; i < 130; i++) previewAttack({ ...o, actionDamageScale: .01 + i / 1000 });
    expect(computed(() => previewAttack(o))).toBe(1);
  });
});
describe('AI 单次估值范围内的样本复用', () => {
  it('complete read-only previews return independent results and end with the decision', () => {
    const o = options('company'), expected = previewAttack(o);
    beginPreviewScope(true);
    try {
      const first = previewAttack(o); first.expectedDamage = -1; first.attackModifiers = 'edited by caller';
      expect(previewAttack(o)).toEqual(expected);
      const moved = { ...o, actionDamageScale: 0, defender: { ...o.defender, pos: 8, conditions: [{ id: 'stunned', dur: 1 }] } };
      expect(previewAttack(moved)).not.toEqual(expected);
    } finally { endPreviewScope(); }
    o.attacker.weapon!.baseDice = '1d6+1';
    const changed = previewAttack(o);
    beginPreviewScope(true);
    try { expect(previewAttack(o)).toEqual(changed); }
    finally { endPreviewScope(); }
  });
  it('read-only AI keys distinguish new candidate branches and reset before the next decision', () => {
    const o = options('company');
    const variants = [o, { ...o, defender: { ...o.defender, barrier: { ...o.defender.barrier!, remaining: 50 } } },
      { ...o, defender: { ...o.defender, conditions: [{ id: 'stunned', dur: 2 }] } },
      { ...o, attacker: { ...o.attacker, weapon: { ...o.attacker.weapon!, baseDice: '2d6+2' } } }];
    const expected = variants.map(v => previewAttack(v));
    beginPreviewScope(true);
    try { variants.forEach((v, i) => expect(previewAttack(v)).toEqual(expected[i])); }
    finally { endPreviewScope(); }
    o.attacker.weapon!.baseDice = '1d6+1';
    const changed = previewAttack(o);
    beginPreviewScope(true);
    try { expect(previewAttack(o)).toEqual(changed); }
    finally { endPreviewScope(); }
  });
  it('large skill inventories do not evict the same pairwise samples, and changed states stay distinct', () => {
    const o = options();
    for (const unit of [o.attacker, o.defender]) unit.abilities = Array.from({ length: 40 }, (_, i) => ({
      id: 'learned-' + i, name: 'learned-' + i, desc: 'saved skill description '.repeat(180),
      target: 'self' as const, effects: [{ op: 'heal' as const, amount: i + 1 }],
    }));
    const variants = Array.from({ length: 32 }, (_, i) => ({ ...o, actionDamageScale: .01 + i / 1000 }));
    const outside = previewAttack(variants[0]!);
    beginPreviewScope();
    try {
      const expected = variants.map(v => previewAttack(v));
      expect(expected[0]).toEqual(outside);
      expect(computed(() => variants.forEach((v, i) => expect(previewAttack(v)).toEqual(expected[i])))).toBe(0);
      const changed = { ...o, defender: { ...o.defender, barrier: { ...o.defender.barrier!, remaining: 60 } } };
      expect(computed(() => previewAttack(changed))).toBe(1);
      expect(computed(() => previewAttack(structuredClone(changed)))).toBe(0);
      o.attacker.abilities[0]!.effects = [{ op: 'heal', amount: 999 }];
      expect(computed(() => previewAttack(variants[0]!))).toBe(1);
    } finally { endPreviewScope(); }
  });
  it('范围内超过共享上限的样本仍复用，数值与范围外逐项相同，结束后释放', () => {
    const o = options(), variants = Array.from({ length: 140 }, (_, i) => ({ ...o, actionDamageScale: .01 + i / 1000 }));
    const outside = variants.map(v => previewAttack(v));
    beginPreviewScope();
    try {
      expect(previewScopeEpoch()).toBeTypeOf('number');
      // 每张新建但内容相同的状态表都与原表等价，不因对象身份不同而重算。
      expect(computed(() => variants.forEach((v, i) => expect(previewAttack({ ...v, conditionDefs: standardConditionMap() })).toEqual(outside[i])))).toBe(140);
      expect(computed(() => variants.forEach((v, i) => expect(previewAttack({ ...v, conditionDefs: standardConditionMap() })).toEqual(outside[i])))).toBe(0);
    } finally { endPreviewScope(); }
    expect(previewScopeEpoch()).toBeUndefined();
    // 范围外仍是原有界缓存：前面的条目已被淘汰。
    expect(computed(() => previewAttack(variants[0]!))).toBe(1);
  });
  it('范围内仍复用之前决策留在共享缓存里的样本', () => {
    const o = options(); previewAttack(o); beginPreviewScope();
    try { expect(computed(() => previewAttack({ ...o, conditionDefs: standardConditionMap() }))).toBe(0); }
    finally { endPreviewScope(); }
  });
  it('范围内状态与特质内容不同的表不共用样本', () => {
    const o = options(); beginPreviewScope();
    try {
      previewAttack(o);
      const conditions = standardConditionMap(); const d = conditions.get('stunned')!; conditions.set('stunned', { ...d, name: 'changed' });
      expect(computed(() => previewAttack({ ...o, conditionDefs: conditions }))).toBe(1);
      const registry = new Map(o.traitRegistry!); const [id, t] = [...registry][0]!; registry.set(id, { ...t, name: 'changed' });
      expect(computed(() => previewAttack({ ...o, traitRegistry: registry }))).toBe(1);
      expect(computed(() => previewAttack({ ...o, conditionDefs: standardConditionMap(), traitRegistry: new Map(o.traitRegistry!) }))).toBe(0);
    } finally { endPreviewScope(); }
  });
});
