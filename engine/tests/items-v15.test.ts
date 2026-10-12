import { describe, expect, it } from 'vitest';
import { generateUnit, SmallBattle, standardField, traitRegistry, V14_OVERFLOW_D20, V15_OVERFLOW_D20, compileItem, gearItem, syncGearAbilities, attachCarriedItems,
  itemUseAbility, quickItemAction, itemReserveCost, itemEmergency, combatBonuses, gearBonuses, activeTraitIds, traitLevel, tileCost, movementPoints, formationMarchSteps,
  canSpot, collectMods, resolveStack, standardConditionMap, migrateLegacyItem, chargeCapable, rangedArchetype, inferArchetype, prepareItemModel, nightSight, terrainStalks,
  traitLadderSummary, parseSkillMechanism, skillMechanismId, equipmentReason, type Combatant, type GenerateInput, type ItemSpecification, type LegacyItemMechanics } from '../src/index.js';
import { prepareCombatModel } from '../src/combat-model.js';
import { V6_D20 } from '../src/rules.js';
import legacy from './fixtures/legacy-items-v14.json';

const registry = traitRegistry(), conditions = standardConditionMap();
const active = (text: string) => skillMechanismId(parseSkillMechanism(text)!);
type ItemSpec = Omit<Extract<ItemSpecification, { kind: 'item' }>, 'kind'>;
function item(spec: ItemSpec, id = 'x') {
  const mechanics = compileItem({ kind: 'item', ...spec }, { id, seed: id });
  if (mechanics.kind !== 'item') throw Error('fixture'); return mechanics.value;
}
function unit(id: string, side: Combatant['side'] = 'ally', extra: Partial<GenerateInput> = {}, v15 = true): Combatant {
  const u = generateUnit({ name: id, side, scale: 'hero', rulesVersion: 'v2', damageModel: 'wounds-v2', level: 4, traits: [], weaponClass: 'sword', armorTier: 1, ...extra },
    { registry, seed: id, noVariance: true }).unit;
  u.id = id; prepareCombatModel(u, V6_D20); if (v15) prepareItemModel(u, V15_OVERFLOW_D20); return u;
}
const carry = (u: Combatant, id: string, spec: ItemSpec, quantity: number) => attachCarriedItems(u, [...(u.carriedItems ?? []).map((c) => ({ ...c, action: undefined })),
  { id, name: id, quantity, revision: 1, mechanics: { kind: 'item', value: item(spec, id) } }]);
function grid(units: Combatant[], rules = V15_OVERFLOW_D20, tags: string[] = []) {
  const field = standardField(); field.tiles.fill('open');
  const battle = new SmallBattle({ combatants: units, battlefield: field, rules, seed: 'items-v15', traitRegistry: registry, field: { tags } });
  battle.start(); battle.turnOrder = units.map((u) => u.id); battle.turnIndex = 0;
  return battle;
}

describe('V15 道具编译与形态', () => {
  it('一次性道具按同级技能编译后冻结：不耗精力、无冷却，喝敷类触及距离；充能按效果每战2或1次；区域与召唤一件一个效果', () => {
    const dose = item({ form: 'single', power: 3, active: active('buff治疗') });
    expect(dose.ability).toMatchObject({ customized: true, itemQuick: true, itemScaling: 'member', range: { min: 0, max: 1 } });
    for (const key of ['cost', 'cooldown', 'usesPerBattle'] as const) expect(dose.ability![key]).toBeUndefined();
    expect(dose.ability!.delivery).not.toBe('magic');
    const grenade = item({ form: 'single', power: 4, active: active('物理范围投射') });
    expect(grenade.ability!.itemQuick).toBeUndefined(); expect(grenade.ability!.range!.max).toBeGreaterThan(1); expect(grenade.ability!.itemScaling).toBe('member');
    expect(item({ form: 'single', power: 3, active: active('烟幕') }).ability!.itemScaling).toBe('object');
    expect(item({ form: 'single', power: 4, active: active('单体召唤') }).ability!.itemScaling).toBe('object');
    expect(item({ form: 'charged', power: 5, active: active('魔法范围热能') }).ability).toMatchObject({ usesPerBattle: 1, delivery: 'magic' });
    expect(item({ form: 'charged', power: 5, active: active('buff屏障') }).ability!.usesPerBattle).toBe(2);
    expect(item({ form: 'charged', power: 5, active: active('debuff眩晕') }).ability!.usesPerBattle).toBe(1);
    // 开战的入场升级跳过已冻结的道具行动。
    const a = carry(unit('a'), 'dose', { form: 'single', power: 3, active: active('buff治疗') }, 2), action = structuredClone(a.abilities.find((x) => x.itemSourceId)!);
    const battle = grid([a, unit('e', 'enemy')]);
    expect(battle.byId('a').abilities.find((x) => x.itemSourceId)).toEqual(action);
    expect(compileItem({ kind: 'item', form: 'single', power: 3, active: active('buff治疗') }, { id: 'y', seed: 'y' })).toEqual(compileItem({ kind: 'item', form: 'single', power: 3, active: active('buff治疗') }, { id: 'y', seed: 'y' }));
  });
  it('佩戴预算：普通特质3点、强力6点、专精占等级一半、正向修正每点1点，负面修正不返还', () => {
    expect(() => item({ form: 'worn', power: 5, traits: [{ id: 'night-fighter', level: 5 }], bonuses: { defense: 2 } })).not.toThrow();
    expect(() => item({ form: 'worn', power: 5, traits: [{ id: 'night-fighter', level: 5 }], bonuses: { defense: 3 } })).toThrow(/需要6点/);
    expect(() => item({ form: 'worn', power: 5, traits: [{ id: 'flying' }] })).toThrow(/需要6点/);
    expect(() => item({ form: 'worn', power: 6, traits: [{ id: 'flying' }] })).not.toThrow();
    expect(() => item({ form: 'worn', power: 4, traits: [{ id: 'berserk' }], bonuses: { damage: 1, defense: -3 } })).not.toThrow();
    expect(() => item({ form: 'worn', power: 5, traits: [{ id: 'stalk' }, { id: 'forest-lore', level: 6 }] })).toThrow(/需要6点/);
    expect(() => item({ form: 'worn', power: 6, traits: [{ id: 'stalk' }, { id: 'forest-lore', level: 6 }] })).not.toThrow();
    expect(() => item({ form: 'worn', power: 9, bonuses: { health: 1 } })).toThrow();
    expect(() => item({ form: 'worn', power: 9, traits: [{ id: 'natural-armor' }] })).toThrow(/不能授予/);
    expect(() => item({ form: 'worn', power: 5, traits: [{ id: 'guardian', level: 5 }] })).toThrow(/只有五项专精/);
  });
  it('佩戴、充能道具件数不限、不计负重；同一特质只算一次，专精取最高一级；同方向修正取最高一件，与训练修正合计限±10', () => {
    const u = unit('a'); u.bonuses = { defense: 7 };
    u.gear = [gearItem('g1', '戒指', item({ form: 'worn', power: 4, bonuses: { defense: 4 } })), gearItem('g2', '护符', item({ form: 'worn', power: 2, bonuses: { defense: 2 } })),
      gearItem('g3', '面具', item({ form: 'worn', power: 4, traits: [{ id: 'berserk' }], bonuses: { damage: 1, defense: -3 } })),
      gearItem('g4', '夜视镜', item({ form: 'worn', power: 5, traits: [{ id: 'night-fighter', level: 5 }] })), gearItem('g5', '猫眼', item({ form: 'worn', power: 8, traits: [{ id: 'night-fighter', level: 8 }] })),
      ...[1, 2, 3].map((n) => gearItem('wand' + n, '魔杖', item({ form: 'charged', power: 5, active: active('魔法范围热能') })))];
    syncGearAbilities(u);
    expect(equipmentReason(u)).toBeUndefined(); expect(u.abilities.filter((a) => a.equipmentSourceId)).toHaveLength(3);
    expect(gearBonuses(u)).toEqual({ defense: 1, damage: 1 });
    expect(combatBonuses(u)).toEqual({ defense: 8, damage: 1 });
    u.bonuses = { defense: 9 }; expect(combatBonuses(u)!.defense).toBe(10);
    expect(activeTraitIds(u).filter((id) => id === 'night-fighter')).toHaveLength(1);
    expect(traitLevel(u, 'night-fighter')).toBe(8);
    u.traits.push('night-fighter'); u.traitLevels = { 'night-fighter': 3 }; expect(traitLevel(u, 'night-fighter')).toBe(8);
    delete u.itemModel; expect(traitLevel(u, 'night-fighter')).toBe(5);
  });
});

describe('旧版药剂与护符的转换', () => {
  const expected: Record<string, [string, string | undefined, string[]?]> = {
    heal: ['single', active('增益治疗')], repair: ['single', active('增益治疗')], restore: ['single', active('增益回能')], cleanse: ['single', active('增益净化')],
    empower: ['single', active('增益伤害')], barrier: ['single', active('增益屏障')], grenade: ['single', active('物理范围投射')],
    guardian: ['worn', undefined, ['guardian']], night: ['worn', undefined, ['night-fighter']], woodland: ['worn', undefined, ['forest-lore']], endurance: ['worn', undefined, ['fatigue-trained']],
    healing: ['charged', active('增益治疗')], barrier_: ['charged', active('增益屏障')], cleansing: ['charged', active('增益净化')],
  };
  it('14种旧道具逐件按对照表转换，名称、等级与修正保留；专精护符按L5，旧物品不受预算限制', () => {
    expect(legacy.items).toHaveLength(21);
    for (const old of legacy.items) {
      const kind = String((old.mechanics as { kind: string }).kind), mechanism = String((old.mechanics as { recipe?: { mechanism: string }; value?: { recipe: { mechanism: string } } }).recipe?.mechanism ?? (old.mechanics as { value: { recipe: { mechanism: string } } }).value.recipe.mechanism).replace(/^accessory:/, '');
      const migrated = migrateLegacyItem(old.mechanics as unknown as LegacyItemMechanics, old.name, old.id);
      const [form, mechanismId, traits] = expected[kind === 'accessory' && mechanism === 'barrier' ? 'barrier_' : mechanism]!;
      const recipe = migrated.value.recipe;
      expect(recipe).toMatchObject({ form, power: (old.mechanics as { recipe?: { power: number }; value?: { recipe: { power: number } } }).recipe?.power ?? (old.mechanics as { value: { recipe: { power: number } } }).value.recipe.power, legacy: kind + ':' + mechanism });
      if (mechanismId) expect(recipe.active).toBe(mechanismId);
      if (traits) expect(migrated.value.passive!.traits.map((t) => t.id)).toEqual(traits);
      if (mechanism === 'night' || mechanism === 'woodland') expect(migrated.value.passive!.traits[0]!.level).toBe(5);
      if (form === 'charged') expect(migrated.value.ability!.usesPerBattle).toBe(2);
      if (form !== 'worn') expect(migrated.value.ability!.cost).toBeUndefined();
    }
  });
});

describe('V15 编队件数、加速动作与 AI 保留价值', () => {
  const company = (id: string, side: Combatant['side'], members: number) => unit(id, side, { scale: 'company', hpMax: members, weaponClass: 'rifle' });
  it('编队齐用每人一份的道具最多消耗本次参与人数的件数，效果按件数折算；区域道具一次一件；V14 编队照旧一份', () => {
    const a = carry(carry(company('a', 'ally', 40), 'bomb', { form: 'single', power: 4, active: active('物理范围投射') }, 10), 'smoke', { form: 'single', power: 3, active: active('烟幕') }, 5);
    const target = company('e', 'enemy', 40), friend = company('f', 'ally', 40);
    const bomb = a.abilities.find((x) => x.itemSourceId === 'bomb')!;
    expect(itemUseAbility(a, bomb, target).ability).toMatchObject({ cost: { amount: 10 }, itemDoses: 10 });
    const smoke = a.abilities.find((x) => x.itemSourceId === 'smoke')!;
    expect(itemUseAbility(a, smoke).ability).toBe(smoke);
    const healer = carry(company('h', 'ally', 40), 'dose', { form: 'single', power: 3, active: active('buff治疗') }, 8), dose = healer.abilities.find((x) => x.itemSourceId)!;
    const heal = (dose.effects.find((e) => e.op === 'heal') as { amount: number }).amount;
    expect(itemUseAbility(healer, dose, friend).ability.effects.find((e) => e.op === 'heal')).toEqual({ op: 'heal', amount: heal * 8 });
    const cloak = carry(company('c', 'ally', 40), 'cloak', { form: 'single', power: 5, active: active('buff潜伏') }, 8), stealth = cloak.abilities.find((x) => x.itemSourceId)!;
    expect(itemUseAbility(cloak, stealth, friend).reason).toMatch(/需要40件/);
    delete a.itemModel; expect(itemUseAbility(a, bomb, target).ability).toBe(bomb);
    // 实战：一次投掷扣掉 10 件，而不是一件。
    const battle = grid([prepareItemModelled(a), target]);
    a.pos = 40; target.pos = 26;
    expect(battle.useAbility(a.id, 'item:bomb', target.id).ok).toBe(true);
    expect(battle.byId('a').resources['item:bomb']).toBe(0);
  });
  it('V15 只有喝、敷类道具可用加速动作，投掷与施放占主行动；V14 所有携行物品照旧', () => {
    let a = carry(unit('a'), 'dose', { form: 'single', power: 3, active: active('buff治疗') }, 2);
    a = carry(a, 'bomb', { form: 'single', power: 4, active: active('物理范围投射') }, 2);
    const dose = a.abilities.find((x) => x.itemSourceId === 'dose')!, bomb = a.abilities.find((x) => x.itemSourceId === 'bomb')!;
    expect(quickItemAction(a, dose)).toBe(true); expect(quickItemAction(a, bomb)).toBe(false);
    expect(quickItemAction({}, bomb)).toBe(true);
    const e = unit('e', 'enemy'), battle = grid([a, e]);
    a.pos = 40; e.pos = 33; a.hp -= 30; a.conditions.push({ id: 'hasted', dur: 2 });
    battle.attack(a.id, e.id); expect(battle.actedThisTurn.has(a.id)).toBe(true);
    expect(battle.useAbility(a.id, 'item:bomb', e.id).ok).toBe(false);
    expect(battle.useAbility(a.id, 'item:dose', a.id).ok).toBe(true);
  });
  it('AI 给治疗品计保留价值：满额恢复量的一半，最后一件×1.5；伤重或濒死目标打折，轻伤时留着药', () => {
    const a = carry(unit('a'), 'dose', { form: 'single', power: 3, active: active('buff治疗') }, 3), dose = a.abilities.find((x) => x.itemSourceId)!;
    const heal = (dose.effects.find((e) => e.op === 'heal') as { amount: number }).amount;
    expect(itemReserveCost(a, dose)).toBe(heal * 0.5);
    a.resources['item:dose'] = 1; expect(itemReserveCost(a, dose)).toBe(heal * 0.75);
    delete a.itemModel; expect(itemReserveCost(a, dose)).toBeUndefined(); prepareItemModel(a, V15_OVERFLOW_D20); a.resources['item:dose'] = 3;
    const max = a.base.hpMax;
    a.hp = Math.ceil(max * 0.9); expect(itemEmergency(a)).toBe(false);
    a.hp = Math.floor(max * 0.3); expect(itemEmergency(a)).toBe(true);
    a.hp = 0; a.status = 'dying'; expect(itemEmergency(a)).toBe(true); a.status = 'ready';
    const fight = (hp: number) => {
      const actor = carry(unit('a'), 'dose', { form: 'single', power: 3, active: active('buff治疗') }, 3), foe = unit('e', 'enemy');
      const battle = grid([actor, foe]); actor.pos = 40; foe.pos = 33; actor.hp = hp;
      battle.autoAction(actor.id); return battle.byId('a').resources['item:dose'];
    };
    expect(fight(max - 2)).toBe(3);
    expect(fight(Math.max(1, Math.floor(max * 0.2)))).toBe(2);
  });
});

function prepareItemModelled(u: Combatant): Combatant { prepareItemModel(u, V15_OVERFLOW_D20); return u; }

describe('五项专精十级', () => {
  const foe = unit('foe', 'enemy');
  const mods = (u: Combatant, kind: 'atk' | 'def' | 'spd', ctx: Record<string, unknown>) => resolveStack(collectMods(u, { attacker: u, defender: foe, ...ctx } as never, conditions, [], registry), kind, { attacker: u, defender: foe, ...ctx } as never).flatTotal;
  const field = standardField(); field.tiles.fill('open'); field.tiles[10] = 'forest'; field.tiles[11] = 'hill';
  function signature(id: string, level: number | undefined, v15 = true): unknown[] {
    const u = unit('s', 'ally', { traits: level === undefined ? [] : [id], ...(level ? { traitLevels: { [id]: level } } : {}) }, v15);
    if (id === 'forest-lore') return [tileCost(field, 10, u), mods(u, 'atk', { terrain: 'forest' }), mods(u, 'def', { terrain: 'forest' }), formationMarchSteps(u, ['forest']), terrainStalks(u, 'forest')];
    if (id === 'mountain-born') return [tileCost(field, 11, u), mods(u, 'atk', { terrain: 'hill', opponentTerrain: 'hill' }), mods(u, 'def', { terrain: 'hill', opponentTerrain: 'open' }),
      mods(u, 'atk', { terrain: 'hill', opponentTerrain: 'open', attackerHigher: true }), formationMarchSteps(u, ['mountain']), terrainStalks(u, 'hill')];
    if (id === 'night-fighter') return [mods(u, 'atk', { fieldTags: ['night'] }), mods(u, 'def', { fieldTags: ['night'] }), movementPoints(u, ['night']), nightSight(traitLevel(u, id), 'small'), nightSight(traitLevel(u, id), 'mass')];
    if (id === 'plains-runner') return [mods(u, 'atk', { fieldTags: ['plains'] }), mods(u, 'atk', { fieldTags: ['plains'], charge: true }), mods(u, 'def', { fieldTags: ['plains'] }),
      mods(u, 'spd', { fieldTags: ['plains'] }), movementPoints(u, ['plains'])];
    return [mods(u, 'atk', { fieldTags: ['urban'], ranged: false, distance: 1 }), mods(u, 'atk', { fieldTags: ['urban'], ranged: true, distance: 2 }), mods(u, 'atk', { fieldTags: ['urban'], ranged: true, distance: 4 }),
      mods(u, 'def', { fieldTags: ['urban'] }), mods(u, 'spd', { fieldTags: ['urban'] }), terrainStalks(u, 'street')];
  }
  for (const id of ['forest-lore', 'mountain-born', 'night-fighter', 'plains-runner', 'urban-fighter']) it(`${id}：L1–10 每级都比上一级多一项，省略等级即 L5 且与 V14 相同`, () => {
    const ladder = [signature(id, undefined), ...Array.from({ length: 10 }, (_, i) => signature(id, i + 1))];
    for (let level = 1; level <= 10; level++) expect(ladder[level], `L${level}`).not.toEqual(ladder[level - 1]);
    expect(signature(id, 0 as never)).toEqual(ladder[5]); // traits 写了专精但没写等级
    expect(signature(id, 0 as never, false)).toEqual(ladder[5]);
    expect(signature(id, 9, false)).toEqual(ladder[5]); // V14 记录了等级也按 L5
    expect(traitLadderSummary(id, 5)).toMatch(/^L5：/);
  });
  it('林地、山地 L8 与巷战 L9 在对应地形中视同潜伏：远处看不到，贴近或旧规则照常可见', () => {
    const terrainField = standardField(); terrainField.tiles.fill('open'); terrainField.tiles[16] = 'forest';
    const watcher = unit('w', 'enemy');
    for (const [level, hidden, v15] of [[8, true, true], [7, false, true], [8, false, false]] as const) {
      const ranger = unit('r', 'ally', { traits: ['forest-lore'], traitLevels: { 'forest-lore': level } }, v15);
      ranger.pos = 16; watcher.pos = 16 + 3 * terrainField.width;
      const context = { units: [ranger, watcher], mode: 'small' as const, fieldTags: ['plains'], battlefield: terrainField };
      expect(canSpot(context, watcher, ranger), `L${level} V${v15 ? 15 : 14}`).toBe(!hidden);
      watcher.pos = 16 + terrainField.width;
      expect(canSpot(context, watcher, ranger)).toBe(true);
    }
  });
});

describe('V15 冲锋资格与原型', () => {
  it('冲锋看真实坐骑、快速载具或冲锋强化；远程判定只看武器；新单位原型按配装推断', () => {
    const footman = unit('f', 'ally', { archetype: 'mobile' }), rider = unit('r', 'ally', { mount: true }), car = unit('c', 'ally', { body: 'vehicle', speedTier: 4 });
    expect(chargeCapable(footman, [])).toBe(false); expect(chargeCapable(rider, [])).toBe(true); expect(chargeCapable(car, [])).toBe(true);
    expect(chargeCapable(footman, ['charge-strong'])).toBe(true);
    delete footman.itemModel; expect(chargeCapable(footman, [])).toBe(true);
    const archer = unit('a', 'ally', { archetype: 'ranged' }); expect(rangedArchetype(archer)).toBe(false); delete archer.itemModel; expect(rangedArchetype(archer)).toBe(true);
    expect(inferArchetype({ mount: true, weaponClass: 'bow' })).toBe('mobile');
    expect(inferArchetype({ body: 'vehicle', speedTier: 4, weaponClass: 'cannon' })).toBe('mobile');
    expect(inferArchetype({ body: 'vehicle', speedTier: 3, weaponClass: 'cannon' })).toBe('ranged');
    expect(inferArchetype({ weaponClass: 'spear' })).toBe('infantry'); expect(inferArchetype({})).toBe('infantry');
    expect(V14_OVERFLOW_D20.itemModel).toBeUndefined(); expect(V15_OVERFLOW_D20.itemModel).toBe('items-v1');
  });
});
