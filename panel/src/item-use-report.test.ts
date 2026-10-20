import { describe, expect, it } from 'vitest';
import { applyCombatDamage, attachCarriedItems, compileItem, gearItem, generateUnit, MassBattle, memberHealth,
  parseSkillMechanism, skillMechanismId, SmallBattle, standardField, syncGearAbilities, traitRegistry,
  V15_OVERFLOW_D20, V15_OVERFLOW_TW, type Combatant } from '../../engine/src/index.js';
import { battleEpilogue, battleIdOf, makeNarrativeBatch, type BattleReport } from './battle-reports.js';

const registry = traitRegistry();
type Mode = 'small' | 'mass';
type Effect = 'buff治疗' | 'buff屏障' | 'buff回能' | '魔法单体';
function fixture(mode: Mode, effect: Effect = 'buff治疗') {
  const single = effect === 'buff治疗' || effect === 'buff屏障';
  const make = (id: string, side: Combatant['side'], hero = false) => {
    const u = generateUnit({ name: id, side, scale: hero ? 'hero' : 'company', body: hero ? 'large' : 'human',
      rulesVersion: 'v2', damageModel: 'wounds-v2', level: 4, hpMax: hero ? 100 : 100, weaponClass: 'rifle', traits: [], armorTier: 0 },
    { registry, seed: id, noVariance: true }).unit;
    u.id = id; u.tags.push('zone:中军', 'rank:front'); return u;
  };
  const mechanics = compileItem({ kind: 'item', form: single ? 'single' : 'charged', power: 3,
    active: skillMechanismId(parseSkillMechanism(effect)!) }, { id: 'dose', name: '测试道具', seed: 'dose' });
  if (mechanics.kind !== 'item') throw Error('fixture');
  let actor = make('使用者', 'ally', !single);
  if (single) actor = attachCarriedItems(actor, [{ id: 'dose', name: '测试道具', quantity: effect === 'buff屏障' ? 3 : 100, revision: 1, mechanics }]);
  else { actor.gear = [gearItem('dose', '测试道具', mechanics.value)]; syncGearAbilities(actor); }
  const enemy = make('敌人', 'enemy');
  const field = standardField(); field.tiles.fill('open');
  const options = { combatants: [actor, enemy], seed: 'item-epilogue', traitRegistry: registry };
  const b = mode === 'small' ? new SmallBattle({ ...options, battlefield: field, rules: V15_OVERFLOW_D20 })
    : new MassBattle({ ...options, rules: V15_OVERFLOW_TW });
  b.start();
  if (b instanceof SmallBattle) { b.turnOrder = [actor.id, enemy.id]; b.turnIndex = 0; actor.pos = 40; enemy.pos = 33; }
  return { b, actor, ability: actor.abilities.find(a => a.itemSourceId || a.equipmentSourceId)! };
}
function use(f: ReturnType<typeof fixture>, target = f.actor.id) {
  const result = f.b.useAbility(f.actor.id, f.ability.id, target);
  expect(result.ok, result.reason).toBe(true);
  if (f.b instanceof MassBattle) { f.b.issue({ unitId: '敌人', type: 'hold' }); f.b.resolveRound(); }
  if (!f.b.isOver()) f.b.finishBattle('ceasefire');
  return f.b.log.find(entry => entry.itemUse)!.itemUse!;
}

describe('终章道具使用与实际效果', () => {
  it.each(['small', 'mass'] as const)('%s按编队实际用药件数与实际治疗量记录，并随读档、归档保留', mode => {
    const f = fixture(mode); applyCombatDamage(f.actor, 49, 3);
    const before = memberHealth(f.actor), item = use(f);
    expect(item).toMatchObject({ actorId: f.actor.id, itemId: 'dose', itemName: '测试道具', form: 'single', consumed: 3 });
    expect(item.effects.join('\n')).toContain('治疗 49');
    expect(memberHealth(f.actor)).toBe(before + 49);
    const text = battleEpilogue(f.b), tail = text.split('【道具使用和效果】')[1]!;
    expect(tail).toContain('使用者 使用【测试道具】：共1次，消耗3件');
    expect(text.indexOf('【道具使用和效果】')).toBeGreaterThan(text.indexOf('【伤害来源】'));
    expect(text.indexOf('【道具使用和效果】')).toBeLessThan(text.indexOf('【叙述任务】'));
    const restored = f.b instanceof SmallBattle ? SmallBattle.fromSnapshot(structuredClone(f.b.toSnapshot())) : MassBattle.fromSnapshot(structuredClone(f.b.toSnapshot()));
    expect(restored.visibleLog('ally').some(entry => entry.itemUse)).toBe(false);
    expect(battleEpilogue(restored)).toBe(text);
    const report: BattleReport = { id: battleIdOf(f.b), card: '', summary: '', digest: '', deliveries: {}, epilogue: text };
    expect(makeNarrativeBatch(undefined, structuredClone(report), {}, 'epilogue').text).toBe(text);
  });
  it.each(['small', 'mass'] as const)('%s屏障记本次三件的总保护量，不把单件规格当成实际效果', mode => {
    const f = fixture(mode, 'buff屏障'), item = use(f);
    expect(item.consumed).toBe(3); expect(item.effects.join('\n')).toContain('可吸收78点伤害');
    expect(battleEpilogue(f.b)).toContain('消耗3件');
    expect(battleEpilogue(f.b).split('【道具使用和效果】')[1]).not.toMatch(/持续\d|剩余\d+件/);
  });
  it.each(['small', 'mass'] as const)('%s充能道具记使用次数和实际回能，保留道具本体', mode => {
    const f = fixture(mode, 'buff回能'); f.actor.resources.SP = 1;
    const item = use(f);
    expect(item).toMatchObject({ form: 'charged', consumed: 0 });
    expect(item.effects.join('\n')).toMatch(/(?:SP|精力)\+/);
    expect(battleEpilogue(f.b)).toContain('共1次，使用充能，不消耗道具本体');
  });
  it.each(['small', 'mass'] as const)('%s攻击道具保留本次命中或未命中的结算', mode => {
    const f = fixture(mode, '魔法单体'), item = use(f, '敌人');
    expect(item.effects.join('\n')).toContain('敌人');
    expect(battleEpilogue(f.b).split('【道具使用和效果】')[1]).toContain('敌人');
  });
  it('未使用和未成功的道具不会被列为已使用；旧档保留可核实的用药与效果', () => {
    const unused = fixture('small');
    expect(unused.b.useAbility(unused.actor.id, unused.ability.id, unused.actor.id).ok).toBe(false);
    unused.b.finishBattle('ceasefire');
    expect(battleEpilogue(unused.b)).toContain('【道具使用和效果】\n本场没有记录到道具使用。');
    const old = fixture('small'); applyCombatDamage(old.actor, 1, 1); use(old);
    for (const entry of old.b.log) delete entry.itemUse;
    const tail = battleEpilogue(old.b).split('【道具使用和效果】')[1]!;
    expect(tail).toContain('共1次，消耗1件'); expect(tail).toContain('治疗 1');
    old.b.log.length = 0;
    expect(battleEpilogue(old.b)).toContain('实际结算详情未记录');
  });
});
