import { describe, expect, it } from 'vitest';
import {
  generateUnit, traitRegistry, narrativeTrait, traitCatalog, collectMods, resolveStack, standardConditionMap, prepareTraitModel,
  V12_OVERFLOW_D20, V13_OVERFLOW_D20, V13_OVERFLOW_TW, SmallBattle, MassBattle, standardField, activeTraitIds, equipmentTraitIds,
  groundToAirRangePenalty, canSpot, healingYield, effectiveProtection, traitPrerequisiteReason, applyHealthLoss, applyCombatDamage, conditionChance, pushPreview, tileCost, movementPoints,
  equipmentLoad, decideMorale, lifestealRecovery, entrench, entrenched, worksLabel, situationalTraitMods, agileDisengage, poisonFactor, conditionImmunity, prepareCombatModel, previewAttack,
  type Combatant, type GenerateInput, type ObservationContext,
} from '../src/index.js';

const registry = traitRegistry();
const defs = standardConditionMap();
function make(id: string, extra: Partial<GenerateInput> = {}, rules: { traitModel?: 'traits-v1' } = V13_OVERFLOW_D20): Combatant {
  const unit = generateUnit({ name: id, side: id.startsWith('a') ? 'ally' : 'enemy', rulesVersion: 'v2', damageModel: 'wounds-v2', scale: 'hero', level: 3,
    weaponClass: 'sword', weaponLevel: 4, armorTier: 0, traits: [], ...extra }, { seed: id, registry, noVariance: true }).unit;
  unit.id = id; prepareTraitModel(unit, rules); return unit;
}
const def = (unit: Combatant, ctx: Parameters<typeof collectMods>[1]) => resolveStack(collectMods(unit, ctx, defs, [], registry), 'def', ctx).flatTotal;
const ward = (unit: Combatant, ctx: Parameters<typeof collectMods>[1]) => resolveStack(collectMods(unit, ctx, defs, [], registry), 'ward', ctx).multTotal;
const atk = (unit: Combatant, ctx: Parameters<typeof collectMods>[1]) => resolveStack(collectMods(unit, ctx, defs, [], registry), 'atk', ctx).flatTotal;
const dmg = (unit: Combatant, ctx: Parameters<typeof collectMods>[1]) => resolveStack(collectMods(unit, ctx, defs, [], registry), 'dmg', ctx).multTotal;

describe('正文特质名', () => {
  it('停用项不再建档并给出代写：老练/精锐按训练等级，快速按speed，重甲与体型由装备和身体决定', () => {
    expect(narrativeTrait('老练')).toMatchObject({ kind: 'ignored', level: 3 });
    expect(narrativeTrait('精锐')).toMatchObject({ kind: 'ignored', level: 4 });
    expect(narrativeTrait('快速')).toMatchObject({ kind: 'ignored', speed: 4 });
    expect(narrativeTrait('重甲')).toMatchObject({ kind: 'ignored', reason: '由护甲决定' });
    expect(narrativeTrait('泰坦巨兽')).toMatchObject({ kind: 'ignored', reason: '由body决定' });
  });
  it('并入项、旧称与各题材说法映射到规范特质', () => {
    const id = (name: string) => { const parsed = narrativeTrait(name); return parsed.kind === 'trait' ? parsed.id : parsed.kind; };
    expect(['穿甲箭', '克制机动', '守城工事', '攻城工兵', '林间行者', '山地子民', '原野游骑', '巷战大师', '夜战', '远近双全', '毒击'].map(id))
      .toEqual(['ap-weapon', 'pike-wall', 'fortification', 'siege-breaker', 'forest-lore', 'mountain-born', 'plains-runner', 'urban-fighter', 'night-fighter', 'versatile', 'poison-strike']);
    expect(['御剑', '侦查', '神识', '炼体', '鳞片', '道心', '韧性', '轻功', '噬血', '傀儡', '反坦克', '防空', '军医', '黑暗视觉', '威压'].map(id))
      .toEqual(['flying', 'recon', 'recon', 'natural-armor', 'natural-armor', 'tenacity', 'tenacity', 'agile', 'lifesteal', 'inorganic', 'anti-large', 'anti-air', 'medic', 'night-fighter', 'fear']);
    expect(narrativeTrait('宇宙无敌矿工')).toEqual({ kind: 'unknown', name: '宇宙无敌矿工' });
  });
  it('配装与世界书同一分组和名称，停用项与自动项不出现', () => {
    expect(traitCatalog().map((g) => `${g.group}：${g.traits.map((t) => t.name).join('、')}`)).toEqual([
      '攻击：破甲、克制步兵、克制大型、对空、狂暴、淬毒、偷袭、吸血、近战特化、射击专家、抵近射击',
      '防护：守护、再生、坚韧、身法、天生护甲、动能抵抗、热能抵抗、奥术抵抗、不屈、工事、盾墙、拒马、散兵、非生物',
      '士气：恐惧、不溃、顽固、统率',
      '机动：冲锋强化、践踏、游击、骑射、先锋部署、潜伏、侦察、飞行、机械化、耐力训练',
      '地形与工程：林地专精、山地专精、平原专精、巷战专精、夜战专精、航渡、登城、工兵',
      '后勤：医护',
    ]);
  });
});

describe('V13 行为与 V12 冻结规则', () => {
  it('工事只在据守位置生效，离开失效、回到原位恢复，在别处休整后改在新位置；V12 仍处处生效', () => {
    const v13 = make('e-fort', { traits: ['fortification'] }), v12 = make('e-old', { traits: ['fortification'] }, V12_OVERFLOW_D20), foe = make('a-foe');
    v13.pos = 10; v12.pos = 10; foe.pos = 30;
    const ctx = { ranged: true, defender: foe, attacker: v13 };
    expect(def(v13, ctx)).toBe(0); expect(entrench(v13, 'small')).toBe(true); expect(entrenched(v13)).toBe(true);
    expect(def(v13, ctx)).toBe(3); expect(ward(v13, ctx)).toBeCloseTo(0.7);
    v13.pos = 11; expect(def(v13, ctx)).toBe(0);
    v13.pos = 10; expect(def(v13, ctx)).toBe(3);
    v13.pos = 11; expect(entrench(v13, 'small')).toBe(true); expect(v13.entrenchedAt).toBe(11); expect(def(v13, ctx)).toBe(3);
    v12.pos = 99; expect(def(v12, { ...ctx, attacker: v12 })).toBe(3);
  });
  it('伤害预览分得清是否站在阵地上：抽样缓存不把阵地里的结果借给移出阵地的同一单位', () => {
    const fort = make('e-cache', { traits: ['fortification'] }), foe = make('a-cache', { weaponClass: 'rifle' });
    for (const unit of [fort, foe]) prepareCombatModel(unit, V13_OVERFLOW_D20);
    fort.pos = 10; foe.pos = 40; entrench(fort, 'small');
    const opts = { attacker: foe, defender: fort, rules: V13_OVERFLOW_D20, conditionDefs: defs, traitRegistry: registry, ranged: true, distance: 4 };
    const inside = previewAttack(opts).expectedDamage;
    fort.pos = 11; const outside = previewAttack(opts).expectedDamage;
    expect(outside).toBeGreaterThan(inside);
    fort.pos = 10; expect(previewAttack(opts).expectedDamage).toBe(inside);
  });
  it('工事状态说明：尚未构筑、据守、离开；没有工事或 V12 战斗不显示', () => {
    const unit = make('e-w', { traits: ['fortification'] }); unit.pos = 5;
    expect(worksLabel(unit)).toMatch(/^尚未构筑工事/);
    entrench(unit, 'small'); expect(worksLabel(unit)).toMatch(/^据守工事/);
    unit.pos = 6; expect(worksLabel(unit)).toMatch(/^已离开工事/);
    expect(worksLabel(make('e-n'))).toBeUndefined();
    const old = make('e-o', { traits: ['fortification'] }, V12_OVERFLOW_D20); old.pos = 5; expect(worksLabel(old)).toBeUndefined();
  });
  it('工兵攻击无视工事，V13 不再有攻城环境攻击+2', () => {
    const fort = make('e-fort', { traits: ['fortification'] }), sapper = make('a-sap', { traits: ['siege-breaker'] }), old = make('a-old', { traits: ['siege-breaker'] }, V12_OVERFLOW_D20);
    fort.pos = 3; entrench(fort, 'small');
    expect(def(fort, { defender: sapper, attacker: fort })).toBe(0);
    expect(def(fort, { defender: make('a-plain'), attacker: fort })).toBe(3);
    expect(atk(sapper, { fieldTags: ['siege'], defender: fort })).toBe(0);
    expect(atk(old, { fieldTags: ['siege'], defender: fort })).toBe(2);
  });
  it('拒马不再需要长兵器，对骑乘与载具攻击+2、伤害×1.25；V12 仍需长兵器', () => {
    const pike = make('a-pike', { traits: ['pike-wall'], weaponClass: 'rifle' }), rider = make('e-rider', { mount: true }), old = make('a-old', { traits: ['pike-wall'], weaponClass: 'rifle' }, V12_OVERFLOW_D20);
    expect(atk(pike, { defender: rider })).toBe(2); expect(dmg(pike, { defender: rider })).toBeCloseTo(1.25);
    expect(atk(pike, { defender: make('e-foot') })).toBe(0);
    expect(atk(old, { defender: rider })).toBe(0);
  });
  it('散兵：个体范围伤害减半且没有近战代价；编队另有近战防御−1；步枪类编队自动获得，火枪线列不会', () => {
    const hero = make('a-hero', { traits: ['loose-formation'] }), oldHero = make('a-oh', { traits: ['loose-formation'] }, V12_OVERFLOW_D20);
    expect(ward(hero, { area: true })).toBeCloseTo(0.5); expect(def(hero, { distance: 1 })).toBe(0);
    expect(ward(oldHero, { area: true })).toBe(1);
    const company = (weaponClass: string, rules = V13_OVERFLOW_D20) => make('a-co-' + weaponClass, { scale: 'company', hpMax: 100, weaponClass, armorTier: 1 }, rules);
    expect(equipmentTraitIds(company('rifle'))).toContain('loose-formation');
    expect(activeTraitIds(company('energy'))).toContain('loose-formation');
    expect(activeTraitIds(company('firearm'))).not.toContain('loose-formation');
    expect(activeTraitIds(company('rifle', V12_OVERFLOW_D20))).not.toContain('loose-formation');
    const rifles = company('rifle');
    expect(ward(rifles, { area: true })).toBeCloseTo(0.5); expect(def(rifles, { distance: 1 })).toBe(-1);
  });
});

describe('新增特质', () => {
  it('对空：打空中目标攻击+2、伤害×1.25，地对空不额外损耗射程；与克制大型同组取强', () => {
    const aa = make('a-aa', { traits: ['anti-air', 'anti-large'], weaponClass: 'autocannon' }), flyer = make('e-fly', { traits: ['flying'] }); flyer.airborne = true;
    expect(atk(aa, { defender: flyer, ranged: true })).toBe(2); expect(dmg(aa, { defender: flyer, ranged: true })).toBeCloseTo(1.25);
    expect(groundToAirRangePenalty(aa, flyer)).toBe(0); expect(groundToAirRangePenalty(make('a-plain'), flyer)).toBe(2);
    const big = make('e-dragon', { traits: ['flying'], body: 'giant' }); big.airborne = true;
    expect(atk(aa, { defender: big, ranged: true })).toBe(2);
  });
  it('侦察：识破潜伏距离翻倍，并为己方曲射火力校射+2', () => {
    const field = standardField(); field.tiles.fill('open');
    const stalker = make('e-stalk', { traits: ['stalk'] }), scout = make('a-scout', { traits: ['recon'] }), plain = make('a-plain');
    stalker.pos = 3 * 7 + 3; scout.pos = 6 * 7 + 3; plain.pos = 6 * 7 + 2;
    const context: ObservationContext = { units: [stalker, scout, plain], mode: 'small', fieldTags: [], battlefield: field };
    expect(canSpot(context, scout, stalker)).toBe(true); expect(canSpot(context, plain, stalker)).toBe(false);
    const mortar = make('a-mortar', { weaponClass: 'indirect-cannon' }); mortar.pos = 8 * 7 + 3;
    const mods = situationalTraitMods({ ...context, units: [stalker, scout, mortar] }, mortar, stalker, { ambush: false, flanked: () => false, magic: false, ranged: true, weapon: mortar.weapon });
    expect(mods.map((m) => [m.name, m.value])).toEqual([['侦察校射', 2]]);
  });
  it('医护：施放治疗×1.25；编队伤亡每4名救3名，余量跨次累计', () => {
    const medic = make('a-med', { traits: ['medic'] }), plain = make('a-plain'), hero = make('a-hurt');
    expect(healingYield(medic, hero, 20)).toBe(25); expect(healingYield(plain, hero, 20)).toBe(20);
    const company = (traits: string[]) => { const u = make('a-co', { scale: 'company', hpMax: 100, traits }); prepareCombatModel(u, V13_OVERFLOW_D20); u.recoverableWounded = 0; return u; };
    const withMedic = company(['medic']), without = company([]);
    for (const unit of [withMedic, without]) for (let i = 0; i < 4; i++) applyCombatDamage(unit, unit.formation!.memberHp * 3, 3);
    expect(withMedic.hp).toBe(88); expect(without.hp).toBe(88);
    expect(withMedic.recoverableWounded).toBe(9); expect(without.recoverableWounded).toBe(6);
  });
  it('非生物：免疫中毒、流血与惊惧，不会士气崩溃', () => {
    const golem = make('e-golem', { traits: ['inorganic'] });
    expect(poisonFactor(golem)).toBe(0);
    for (const id of ['poisoned', 'bleeding', 'fearful']) expect(conditionImmunity(golem, id)).toBeTruthy();
    expect(conditionChance(golem, { op: 'condition', conditionId: 'bleeding', dur: 2, saveDC: 30 })).toBe(0);
  });
  it('坚韧：控制效果抵抗+4，不影响中毒；不被击退或拉拽', () => {
    const tough = make('e-tough', { traits: ['tenacity'] }), plain = make('e-plain');
    const stun = { op: 'condition' as const, conditionId: 'stunned', dur: 1, saveDC: 15 }, poison = { ...stun, conditionId: 'poisoned' };
    expect(conditionChance(plain, stun) - conditionChance(tough, stun)).toBeCloseTo(0.2);
    expect(conditionChance(tough, poison)).toBe(conditionChance(plain, poison));
    const field = standardField(); field.tiles.fill('open'); const pusher = make('a-push'); pusher.pos = 10; tough.pos = 17;
    expect(pushPreview({ units: [pusher, tough], mode: 'small', fieldTags: [], battlefield: field }, pusher, tough, { op: 'push', force: 5, distance: 1, direction: 'away' } as never).reason).toBe('坚韧，不受击退或拉拽');
  });
  it('身法：困难地形按平地走，脱离近战不吃借机；重装不能用', () => {
    const field = standardField(); field.tiles.fill('forest');
    const agile = make('a-agile', { traits: ['agile'] }), heavy = make('a-heavy', { traits: ['agile'], armorTier: 3 });
    expect(tileCost(field, 0, agile)).toBe(1); expect(tileCost(field, 0, make('a-plain'))).toBe(2); expect(tileCost(field, 0, heavy)).toBe(2);
    expect(agileDisengage(agile)).toBe(true); expect(agileDisengage(heavy)).toBe(false);
  });
  it('天生护甲只让护甲的减益无效：不计负重、没有重甲先攻与移动惩罚；防护和轻装前提仍按所写护甲', () => {
    const plated = make('a-plate', { armorTier: 3 }), natural = make('a-scale', { armorTier: 3, traits: ['natural-armor'] });
    expect(activeTraitIds(plated)).toContain('heavy-armor'); expect(activeTraitIds(natural)).not.toContain('heavy-armor');
    expect(equipmentLoad(natural)).toBe(equipmentLoad(plated) - (plated.armor?.load ?? 0));
    expect(movementPoints(natural)).toBe(movementPoints(plated) + 1);
    expect(effectiveProtection(natural, 'kinetic')).toBe(effectiveProtection(plated, 'kinetic'));
    for (const id of ['skirmisher', 'agile', 'loose-formation']) expect(traitPrerequisiteReason(make('a-heavy-' + id, { armorTier: 3, traits: ['natural-armor', id] }), id)).toBeTruthy();
    expect(traitPrerequisiteReason(make('a-light-scale', { armorTier: 2, traits: ['natural-armor', 'agile'] }), 'agile')).toBeUndefined();
  });
  it('不屈：个体每战一次以1点生命挺过致命伤；编队第一次本该溃逃时当场重整', () => {
    const hero = make('a-hero', { traits: ['indomitable'] });
    applyHealthLoss(hero, hero.hp + 50); expect(hero.hp).toBe(1); expect(hero.moraleState?.indomitable).toBe(true);
    applyHealthLoss(hero, 5); expect(hero.hp).toBe(0);
    const company = make('a-co', { scale: 'company', hpMax: 100, traits: ['indomitable'] }); company.morale = 0;
    const context: ObservationContext = { units: [company], mode: 'small', fieldTags: [] };
    const rng = { seed: 'm', next: () => 0.5, d: () => 10 } as never;
    const first = decideMorale(context, company, 2, rng, 20, registry);
    expect(first.kind).toBe('rallied'); expect(first.state?.indomitable).toBe(true); expect(first.state?.routs).toBe(0);
    company.moraleState = first.state;
    expect(decideMorale(context, company, 3, rng, 20, registry).kind).toBe('routed');
  });
  it('偷袭：潜伏中出手或趁敌与友军缠斗时伤害×1.5，独立魔法不受影响', () => {
    const rogue = make('a-rogue', { traits: ['sneak-attack'] }), target = make('e-target');
    const context: ObservationContext = { units: [rogue, target], mode: 'small', fieldTags: [] };
    const mods = (input: Partial<Parameters<typeof situationalTraitMods>[3]>) => situationalTraitMods(context, rogue, target, { ambush: false, flanked: () => false, magic: false, ranged: false, ...input });
    expect(mods({ ambush: true }).map((m) => m.value)).toEqual([1.5]);
    expect(mods({ flanked: () => true }).map((m) => m.value)).toEqual([1.5]);
    expect(mods({ ambush: true, magic: true })).toEqual([]);
    expect(mods({})).toEqual([]);
  });
  it('吸血：回复实际生命伤害的25%，打非生物或载具无效', () => {
    const vampire = make('a-vamp', { traits: ['lifesteal'] }); vampire.hp = Math.max(1, vampire.hp - 20);
    const before = vampire.hp;
    expect(lifestealRecovery(vampire, make('e-golem', { traits: ['inorganic'] }), 40)).toBe(0);
    expect(lifestealRecovery(vampire, make('e-man'), 40)).toBe(10); expect(vampire.hp).toBe(before + 10);
  });
});

describe('战斗接入', () => {
  it('小战开战即在开战格构筑工事；离开后原地完整休整一轮重新构筑', () => {
    const field = standardField(); field.tiles.fill('open');
    const defender = make('e-fort', { traits: ['fortification'] }), attacker = make('a-att');
    const battle = new SmallBattle({ combatants: [attacker, defender], rules: V13_OVERFLOW_D20, rng: { seed: 'f', next: () => 0.5, d: (n: number) => Math.ceil(n / 2) }, traitRegistry: registry, battlefield: field, field: { tags: ['plains'] } });
    battle.start();
    const unit = battle.combatants.find((u) => u.id === 'e-fort')!;
    expect(unit.entrenchedAt).toBe(unit.pos); expect(entrenched(unit)).toBe(true);
    const restored = SmallBattle.fromSnapshot(JSON.parse(JSON.stringify(battle.toSnapshot())), { traitRegistry: registry });
    expect(restored.combatants.find((u) => u.id === 'e-fort')!.entrenchedAt).toBe(unit.pos);
  });
  // AI：据守。开战后把对手挪到指定格子，只看据守方这一次行动。
  function holdBattle(defenderWeapon: string, works: boolean, archerAt: number, tags: string[]) {
    const field = standardField(7, 13); field.tiles.fill('open');
    const defender = make('e-hold', { traits: works ? ['fortification'] : [], weaponClass: defenderWeapon, archetype: defenderWeapon === 'sword' ? 'infantry' : 'ranged' });
    const archer = make('a-bow', { weaponClass: 'bow', archetype: 'ranged' }), second = make('a-bow2', { weaponClass: 'bow', archetype: 'ranged' });
    defender.pos = 3; archer.pos = 87; second.pos = 89;
    const battle = new SmallBattle({ combatants: [archer, second, defender], rules: V13_OVERFLOW_D20, battlefield: field, field: { tags }, seed: 'hold', traitRegistry: registry });
    battle.start(); battle.byId('a-bow').pos = archerAt;
    for (let i = 0; i < 4 && battle.active?.id !== 'e-hold'; i++) battle.endTurn();
    battle.autoAction('e-hold');
    return battle.byId('e-hold');
  }
  it('F1 AI：据守单位看不见敌人时照常搜索，离开后失去工事', () => {
    const unit = holdBattle('rifle', true, 87, ['plains', 'night']);
    expect(unit.pos).not.toBe(3);
    expect(entrenched(unit)).toBe(false);
  });
  it('AI：据守弓手与射程内的弓手对射时留在工事里；近战据守单位被打不到的弓手压制时出击', () => {
    const archer = holdBattle('bow', true, 38, ['plains']);
    expect(archer.pos).toBe(3); expect(entrenched(archer)).toBe(true);
    const swordsman = holdBattle('sword', true, 38, ['plains']);
    expect(swordsman.pos).not.toBe(3); expect(entrenched(swordsman)).toBe(false);
  });
  it('开战时没能构筑工事的单位，原地完整休整一轮后构筑', () => {
    const field = standardField(); field.tiles.fill('open');
    const battle = new SmallBattle({ combatants: [make('a-att'), make('e-late', { traits: ['fortification'] })], rules: V13_OVERFLOW_D20, rng: { seed: 'w', next: () => 0.5, d: (n: number) => Math.ceil(n / 2) }, traitRegistry: registry, battlefield: field, field: { tags: ['plains'] } });
    battle.start();
    const unit = battle.byId('e-late'); delete unit.entrenchedAt;
    for (let i = 0; i < 4 && battle.active?.id !== 'e-late'; i++) battle.endTurn();
    battle.endTurn();
    expect(unit.entrenchedAt).toBe(unit.pos);
    expect(battle.log.some((e) => e.text.includes('原地休整，构筑工事'))).toBe(true);
  });
  it('会战开战即在开战阵位构筑工事，V12 会战不记录', () => {
    for (const rules of [V13_OVERFLOW_TW, { ...V13_OVERFLOW_TW, traitModel: undefined, id: 'v12-overflow-tw' }]) {
      const defender = make('e-fort', { scale: 'company', hpMax: 50, traits: ['fortification'] }), attacker = make('a-att', { scale: 'company', hpMax: 50 });
      const battle = new MassBattle({ combatants: [attacker, defender], rules: rules as typeof V13_OVERFLOW_TW, traitRegistry: registry, seed: 'mass-fort' });
      battle.start();
      const unit = battle.combatants.find((u) => u.id === 'e-fort')!;
      expect(unit.entrenchedAt !== undefined).toBe(rules.traitModel === 'traits-v1');
    }
  });
});
