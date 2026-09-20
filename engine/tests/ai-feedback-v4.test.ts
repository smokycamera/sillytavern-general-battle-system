import { describe, expect, it, vi } from 'vitest';
import { generateUnit, SmallBattle, MassBattle, standardField, traitRegistry, V4_D20, V4_TW,
  compileGenericSkill, applyCombatDamage, recoveryCapacity, type Combatant, type GenerateInput, type Ability } from '../src/index.js';
import { spCapacity } from '../src/resources.js';
import { skillEffectValue } from '../src/skill-effects.js';
import { bracePose } from '../src/tactics.js';

const registry = traitRegistry();
function make(id: string, side: 'ally' | 'enemy', extra: Partial<GenerateInput> = {}) {
  const unit = generateUnit({ rulesVersion: 'v2', name: id, side, scale: 'hero', level: 4, hpMax: 500,
    armorTier: 0, weaponClass: 'sword', weaponLevel: 1, traits: [], ...extra }, { registry, seed: id, noVariance: true }).unit;
  unit.id = id; return unit;
}
function skill(unit: Combatant, mechanism: string, overrides: Partial<Ability> = {}) {
  const ability = { ...compileGenericSkill(mechanism, 1, unit.id), customized: true, ...overrides };
  unit.abilities.push(ability); (unit.preparedAbilityIds ??= []).push(ability.id); return ability;
}
function grid(units: Combatant[], summonUnit?: () => Combatant | null) {
  const field = standardField(); field.tiles.fill('open');
  const battle = new SmallBattle({ combatants: units, battlefield: field, rules: V4_D20, traitRegistry: registry, seed: 'ai-feedback', summonUnit });
  battle.start(); battle.turnOrder = units.map(unit => unit.id); battle.turnIndex = 0; return battle;
}
function mass(units: Combatant[], summonUnit?: () => Combatant | null) {
  const battle = new MassBattle({ combatants: units, rules: V4_TW, traitRegistry: registry, seed: 'ai-feedback', summonUnit });
  battle.start(); return battle;
}
const company = (id: string, side: 'ally' | 'enemy', extra: Partial<GenerateInput> = {}) => make(id, side, { scale: 'company', hpMax: 20, ...extra });

describe('AI反馈：资源、自保、失败改选、搜索与治疗协同', () => {
  it.each([2, 3])('小队不花3SP释放仅回%sSP的纯回能', amount => {
    const actor = make('actor', 'ally'), friend = make('friend', 'ally'), enemy = make('enemy', 'enemy'), battle = grid([actor, enemy, friend]);
    friend.pos = 58; friend.resources.SP = 0;
    actor.pos = 59; enemy.pos = 0; battle.movementSpent.set(actor.id, 99); actor.resources.SP = 6;
    const ability = skill(actor, 'generic:buff:restore', { cost: { resource: 'SP', amount: 3 }, effects: [{ op: 'resource', resource: 'SP', amount, maximum: 'training' }] });
    battle.autoAction(actor.id);
    expect(actor.resources.SP).toBe(6); expect(actor.abilityState.find(state => state.abilityId === ability.cooldownGroup)?.used ?? 0).toBe(0);
    expect(battle.active?.id).toBe(enemy.id);
  });
  it.each([2, 3])('会战不花3SP释放仅回%sSP的纯回能', amount => {
    const actor = company('actor', 'ally'), friend = company('friend', 'ally'), enemy = company('enemy', 'enemy'), battle = mass([actor, enemy, friend]);
    friend.resources.SP = 0;
    actor.resources.SP = 6; delete actor.weapon;
    skill(actor, 'generic:buff:restore', { cost: { resource: 'SP', amount: 3 }, effects: [{ op: 'resource', resource: 'SP', amount, maximum: 'training' }] });
    expect(battle.recommendedOrder(actor.id)?.type).not.toBe('ability');
  });
  it('资源效果区分友方回能、敌方吸能与反向收益，并按支付后的上限结算', () => {
    const actor = company('actor', 'ally'), enemy = company('enemy', 'enemy'), battle = mass([actor, enemy]);
    const ability = skill(actor, 'generic:buff:restore', { target: 'self', cost: { resource: 'SP', amount: 3 }, effects: [{ op: 'resource', resource: 'SP', amount: 2, maximum: 'training' }] });
    actor.resources.SP = spCapacity(actor); enemy.resources.SP = 5;
    const context = battle.observationContext();
    expect(skillEffectValue(context, actor, actor, ability)).toBe(3);
    expect(skillEffectValue(context, actor, enemy, ability)).toBeLessThan(0);
    expect(skillEffectValue(context, actor, enemy, { ...ability, effects: [{ op: 'resource', resource: 'SP', amount: -2 }] })).toBe(3);
    const before = actor.resources.SP;
    ability.effects.push({ op: 'condition', conditionId: 'encouraged', dur: 1 });
    expect(battle.useAbility(actor.id, ability.id, actor.id).ok).toBe(true);
    battle.issue({ unitId: enemy.id, type: 'hold' }); battle.resolveRound();
    expect(actor.resources.SP).toBe(before - 1);
  });
  it('自身一回合防护跨过施放当次结算、实际抵挡敌人攻击，下次自身回合末到期，存档一致', () => {
    const actor = make('actor', 'ally'), enemy = make('enemy', 'enemy', { weaponClass: 'rifle' });
    const original = grid([actor, enemy]); actor.pos = 31; enemy.pos = 17;
    const ability = skill(actor, 'generic:buff:defense', { target: 'self', effects: [{ op: 'condition', conditionId: 'encouraged', dur: 1 }] });
    expect(original.useAbility(actor.id, ability.id).ok).toBe(true);
    const restored = SmallBattle.fromSnapshot(JSON.parse(JSON.stringify(original.toSnapshot())), { traitRegistry: registry });
    for (const battle of [original, restored]) {
      const owner = battle.byId(actor.id); battle.endTurn();
      expect(owner.conditions.find(c => c.id === 'encouraged')?.dur).toBe(1);
      const result = battle.attack(enemy.id, owner.id);
      expect(result.targetDef).toBeGreaterThan(owner.base.def);
      battle.endTurn(); expect(owner.conditions.some(c => c.id === 'encouraged')).toBe(true);
      battle.endTurn(); expect(owner.conditions.some(c => c.id === 'encouraged')).toBe(false);
    }
  });
  it.each(['null', 'throw'])('小队召唤来源%s后同次激活改选攻击，只消耗成功的主行动', failure => {
    const actor = make('actor', 'ally'), enemy = make('enemy', 'enemy');
    const summon = vi.fn(() => { if (failure === 'throw') throw new Error('missing template'); return null; });
    const battle = grid([actor, enemy], summon); actor.pos = 31; enemy.pos = 24; battle.movementSpent.set(actor.id, 99);
    actor.weapon!.baseDice = '1d2'; actor.weapon!.apDice = undefined; actor.resources.SP = 8;
    const ability = skill(actor, 'generic:buff:summon', { cost: { resource: 'SP', amount: 1 }, effects: [{ op: 'summon', templateId: 'missing', count: 1 }] });
    const attack = vi.spyOn(battle, 'attack'); battle.autoAction(actor.id);
    expect(summon).toHaveBeenCalledTimes(1); expect(attack).toHaveBeenCalledTimes(1);
    expect(actor.resources.SP).toBe(8); expect(actor.abilityState.find(state => state.abilityId === ability.cooldownGroup)).toBeUndefined();
    expect(battle.active?.id).toBe(enemy.id);
  });
  it('会战自动召唤失败也改选交战任务，手动失败仍保留原军令回执', () => {
    for (const automatic of [true, false]) {
      const actor = company('actor', 'ally'), enemy = company('enemy', 'enemy');
      const summon = vi.fn(() => null), battle = mass([actor, enemy], summon); actor.resources.SP = 8;
      const ability = skill(actor, 'generic:buff:summon', { cost: { resource: 'SP', amount: 1 }, effects: [{ op: 'summon', templateId: 'missing', count: 1 }] });
      battle.issue({ unitId: actor.id, type: 'ability', abilityId: ability.id, targetId: actor.id, automatic });
      battle.issue({ unitId: enemy.id, type: 'hold' }); battle.resolveRound();
      expect(summon).toHaveBeenCalledTimes(1); expect(actor.resources.SP).toBe(8);
      expect(battle.log.some(entry => entry.resolution?.attackerId === actor.id)).toBe(automatic);
      expect(battle.roundReport()?.orders.find(receipt => receipt.order.unitId === actor.id)?.status).toBe(automatic ? 'executed' : 'blocked');
    }
  });
  it('到达旧搜索点后继续搜查边角潜伏者，并可从搜索中途存档一致恢复', () => {
    const actor = make('actor', 'ally', { weaponClass: 'rifle' }), enemy = make('enemy', 'enemy', { traits: ['stalk'] });
    let battle = grid([actor, enemy]); actor.pos = 10; enemy.pos = 56;
    expect(battle.visibleCombatants('ally')).not.toContain(enemy);
    const visited = new Set<number>();
    for (let turn = 0; turn < 24 && !battle.log.some(entry => entry.resolution?.attackerId === actor.id); turn++) {
      battle.autoAction(actor.id); visited.add(battle.byId(actor.id).pos!);
      if (turn === 2) {
        const restored = SmallBattle.fromSnapshot(JSON.parse(JSON.stringify(battle.toSnapshot())), { traitRegistry: registry });
        battle.endTurn(); restored.endTurn(); battle.autoAction(actor.id); restored.autoAction(actor.id);
        expect(restored.toSnapshot()).toEqual(battle.toSnapshot()); battle = restored;
      }
      if (battle.active?.id === enemy.id) battle.endTurn();
    }
    expect(visited.size).toBeGreaterThan(2);
    expect(battle.log.some(entry => entry.resolution?.attackerId === actor.id && entry.resolution.defenderId === enemy.id)).toBe(true);
  });
  it('不同隐藏敌人位置不会改变首次搜索决策', () => {
    const positions = [0, 56].map(cell => {
      const actor = make('actor', 'ally'), enemy = make('enemy', 'enemy', { traits: ['stalk'] }), battle = grid([actor, enemy]);
      actor.pos = 31; enemy.pos = cell; battle.movementSpent.set(actor.id, 2);
      battle.autoAction(actor.id); return actor.pos;
    });
    expect(positions[0]).toBe(positions[1]);
  });
  it.each([false, true])('会战治疗预留%s：两名治疗者分配伤员，足够治疗后不重复施法', area => {
    const first = company('a-healer', 'ally'), second = company('b-healer', 'ally');
    const left = company('c-wounded', 'ally'), right = company('d-wounded', 'ally'), enemy = company('enemy', 'enemy');
    left.tags.push('zone:左翼'); right.tags.push('zone:右翼');
    const battle = mass([first, second, left, right, enemy]);
    applyCombatDamage(left, 10, 1); applyCombatDamage(right, 8, 1);
    for (const healer of [first, second]) {
      delete healer.weapon;
      skill(healer, 'generic:buff:heal', { shape: area ? 'burst' : 'single', cost: { resource: 'SP', amount: 1 }, range: { min: 0, max: 10, metric: 'grid', allowEngaged: true }, effects: [{ op: 'heal', amount: 1000 }] });
    }
    if (area) { left.formationPosition = 'ally:左翼:front'; right.formationPosition = 'ally:中军:front'; }
    expect(recoveryCapacity(left)).toBeGreaterThan(0); expect(recoveryCapacity(right)).toBeGreaterThan(0);
    const before = JSON.stringify(battle.toSnapshot()); const one = battle.recommendedOrder(first.id)!;
    expect(JSON.stringify(battle.toSnapshot())).toBe(before); expect(one.type).toBe('ability'); battle.issue(one);
    const two = battle.recommendedOrder(second.id)!;
    if (area) expect(two.type).not.toBe('ability');
    else { expect(two.type).toBe('ability'); expect(two.targetId).not.toBe(one.targetId); }
    battle.issue(two); for (const unit of [left, right, enemy]) battle.issue({ unitId: unit.id, type: 'hold' });
    battle.resolveRound(); expect(recoveryCapacity(left)).toBe(0); expect(recoveryCapacity(right)).toBe(0);
  });
  it('伤口仍大于已预留治疗时允许第二名治疗者继续救助，撤销军令立即释放预留', () => {
    const first = company('a', 'ally'), second = company('b', 'ally'), target = company('c', 'ally'), enemy = company('enemy', 'enemy');
    target.tags.push('zone:左翼'); const battle = mass([first, second, target, enemy]);
    target.formation!.health = [{ hp: target.formation!.memberHp - 4, count: target.hp }];
    for (const healer of [first, second]) {
      delete healer.weapon;
      skill(healer, 'generic:buff:heal', { cost: { resource: 'SP', amount: 1 }, effects: [{ op: 'heal', amount: 1 }] });
    }
    battle.issue(battle.recommendedOrder(first.id)!);
    expect(battle.recommendedOrder(second.id)).toMatchObject({ type: 'ability', targetId: target.id });
    first.abilities[0]!.effects = [{ op: 'heal', amount: 1000 }];
    expect(battle.recommendedOrder(second.id)?.type).not.toBe('ability');
    battle.revoke(first.id); expect(battle.recommendedOrder(second.id)).toMatchObject({ type: 'ability', targetId: target.id });
  });
});

describe('常态直射遮挡与多盾协同', () => {
  it.each(['weapon', 'ability'] as const)('小队直射火炮%s受双方前排、盾卫、墙体视线与装填约束', action => {
    const actor = make('actor', 'ally', { body: 'vehicle', weaponClass: 'cannon' }), friendly = make('friendly', 'ally');
    const guard = make('guard', 'enemy', { shield: true }), rear = make('rear', 'enemy');
    const battle = grid([actor, friendly, guard, rear]); actor.pos = 52; friendly.pos = 45; guard.pos = 31; rear.pos = 24;
    guard.tacticalPose = bracePose(guard, actor, 'small', 7);
    const ability = skill(actor, 'generic:physical-single:ranged', { range: { min: 0, max: 10, metric: 'grid', allowEngaged: true } });
    const target = () => battle.getActionOptions(actor.id).find(option => option.id === (action === 'weapon' ? 'weapon' : ability.id))?.targets?.find(target => target.targetId === rear.id);
    expect(target()?.enabled).toBe(false);
    friendly.pos = 46; guard.pos = 32;
    expect(target()?.enabled).toBe(true);
    battle.battlefield!.tiles[38] = 'wall'; expect(target()?.enabled).not.toBe(true);
    battle.battlefield!.tiles[38] = 'open';
    if (action === 'weapon') battle.attack(actor.id, rear.id);
    else expect(battle.useAbility(actor.id, ability.id, rear.id).ok).toBe(true);
    expect(battle.log.some(entry => (entry.resolutions ?? (entry.resolution ? [entry.resolution] : [])).some(result => result.attackerId === actor.id && result.defenderId === rear.id))).toBe(true);
    expect(battle.reloadCd.get(actor.id)).toBeGreaterThan(0);
  });
  it.each(['weapon', 'ability'] as const)('会战预备阵位曲射火炮%s可越过己方前排和敌方盾卫攻击后排', action => {
    const actor = company('actor', 'ally', { body: 'vehicle', weaponClass: 'indirect-cannon' }), friendly = company('friendly', 'ally');
    const guard = company('guard', 'enemy', { shield: true }), rear = company('rear', 'enemy');
    const battle = mass([actor, friendly, guard, rear]);
    actor.formationPosition = 'ally:中军:reserve'; friendly.formationPosition = 'ally:中军:front';
    guard.formationPosition = 'enemy:中军:front'; rear.formationPosition = 'enemy:中军:rear';
    guard.tacticalPose = bracePose(guard, actor, 'mass');
    const ability = skill(actor, 'generic:physical-single:ranged', { range: { min: 0, max: 10, metric: 'grid', allowEngaged: true } });
    const order = { unitId: actor.id, targetId: rear.id, type: action === 'weapon' ? 'volley' as const : 'ability' as const, ...(action === 'ability' ? { abilityId: ability.id } : {}) };
    expect(battle.orderPreview(order).reason).toBeUndefined(); expect(battle.issue(order).ok).toBe(true);
    battle.issue({ unitId: friendly.id, type: 'hold' }); battle.issue({ unitId: guard.id, type: 'brace' }); battle.issue({ unitId: rear.id, type: 'hold' });
    battle.resolveRound();
    expect(battle.log.some(entry => entry.resolution?.attackerId === actor.id && entry.resolution.defenderId === rear.id)).toBe(true);
    expect(battle.reloadCd.get(actor.id)).toBeGreaterThan(0);
  });
  it.each(['ally', 'enemy'] as const)('小队%s前排无需持盾或固守就遮线，同格和空中不遮线', side => {
    const shooter = make('shooter', 'ally', { weaponClass: 'rifle' }), front = make('front', side), rear = make('rear', 'enemy');
    const battle = grid([shooter, front, rear]); shooter.pos = 10; front.pos = 24; rear.pos = 38;
    const shot = () => battle.getActionOptions(shooter.id).find(option => option.id === 'weapon')!.targets!.find(target => target.targetId === rear.id)!;
    expect(shot().enabled).toBe(false); expect(() => battle.attack(shooter.id, rear.id)).toThrow('遮挡');
    front.conditions.push({ id: 'stunned', dur: 2 }); expect(shot().enabled).toBe(false);
    front.traits.push('flying'); front.airborne = true; expect(shot().enabled).toBe(true);
    front.airborne = false; front.pos = rear.pos; expect(shot().enabled).toBe(true);
    front.pos = 24; shooter.weapon!.indirect = true; expect(shot().enabled).toBe(true);
  });
  it('小队已有盾卫掩护同格射手时，第二盾卫优先攻击而不重复固守', () => {
    const first = make('a', 'ally', { shield: true }), second = make('b', 'ally', { shield: true, weaponClass: 'rifle' });
    const rear = make('rear', 'ally', { weaponClass: 'rifle', weaponLevel: 8 }), enemy = make('enemy', 'enemy', { weaponClass: 'rifle' });
    const battle = grid([first, second, enemy, rear]); first.pos = second.pos = rear.pos = 31; enemy.pos = 10;
    battle.brace(first.id); battle.endTurn(); battle.movementSpent.set(second.id, 99);
    battle.autoAction(second.id); expect(second.tacticalPose).toBeUndefined();
    expect(battle.log.some(entry => entry.resolution?.attackerId === second.id)).toBe(true);
  });
  it('会战已安排的己方盾卫提供掩护，第二盾卫不会为同一射手重复固守；预览不消费状态', () => {
    const first = company('a', 'ally', { shield: true }), second = company('b', 'ally', { shield: true, weaponClass: 'rifle' });
    const rear = company('rear', 'ally', { weaponClass: 'rifle', weaponLevel: 8 }), enemy = company('enemy', 'enemy', { weaponClass: 'rifle' });
    enemy.tags.push('rank:front');
    const battle = mass([first, second, rear, enemy]);
    for (const unit of [first, second, rear]) unit.formationPosition = 'ally:中军:front';
    battle.issue({ unitId: first.id, type: 'brace' });
    const snapshot = JSON.stringify(battle.toSnapshot()); const order = battle.recommendedOrder(second.id)!;
    expect(['volley', 'shift-left', 'shift-right']).toContain(order.type);
    expect(JSON.stringify(battle.toSnapshot())).toBe(snapshot);
    expect(first.tacticalPose).toBeUndefined();
    first.tacticalPose = bracePose(first, enemy, 'mass');
    expect(battle.orderPreview({ unitId: enemy.id, type: 'volley', targetId: rear.id }).reason).toContain('遮挡');
  });
});
