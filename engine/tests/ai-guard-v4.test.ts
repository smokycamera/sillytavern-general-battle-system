import { describe, expect, it, vi } from 'vitest';
import { generateUnit, SmallBattle, MassBattle, standardField, traitRegistry, V2_D20, V4_D20, V4_TW, memberHealth, type Combatant, type GenerateInput, type RulePack } from '../src/index.js';
import { bracePose } from '../src/tactics.js';
import { weaponReloadKey } from '../src/loadout.js';

const registry = traitRegistry();
function make(id: string, side: 'ally' | 'enemy', extra: Partial<GenerateInput> = {}) {
  const unit = generateUnit({ rulesVersion: 'v2', name: id, side, scale: 'hero', level: 4, hpMax: 500,
    armorTier: 0, weaponClass: 'sword', weaponLevel: 1, traits: [], ...extra }, { registry, seed: id, noVariance: true }).unit;
  unit.id = id; return unit;
}
function grid(units: Combatant[], night = false, rules: RulePack = V4_D20) {
  const field = standardField(); field.tiles.fill('open');
  const battle = new SmallBattle({ combatants: units, rules, traitRegistry: registry, seed: 'ai-audit', battlefield: field, field: { tags: night ? ['night'] : [] } });
  battle.start(); battle.turnOrder = units.map(unit => unit.id); battle.turnIndex = 0; return battle;
}
function shieldGrid(rules = V4_D20, rearWeaponLevel = 1) {
  const guard = make('guard', 'ally', { shield: true, traits: ['shield-wall'], armorTier: 3 });
  const rear = make('rear', 'ally', { weaponClass: 'bow', weaponLevel: rearWeaponLevel });
  const shooter = make('shooter', 'enemy', { weaponClass: 'rifle', abilityBlueprints: [
    { id: 'generic:physical-single:ranged', level: 3, name: '瞄准射击' },
    { id: 'generic:magic-single:arcane', level: 3, name: '奥术箭' },
  ] });
  const battle = grid([guard, shooter, rear], false, rules); guard.pos = 31; rear.pos = 38; shooter.pos = 10;
  return { battle, guard, rear, shooter };
}
const shotAt = (battle: SmallBattle, actorId: string, targetId: string) => battle.getActionOptions(actorId).find(option => option.id === 'weapon')!.targets!.find(target => target.targetId === targetId)!;

describe('V4移动、选目标与盾卫保护', () => {
  it.each(['sword', 'rifle'])('敌方%s有合法进攻机会时，不因更强火力的自保估值而持续固守', (weaponClass) => {
    const enemy = make('enemy', 'enemy', { weaponClass, shield: true, traits: ['shield-wall'] });
    const ally = make('ally', 'ally', { weaponClass: 'rifle', weaponLevel: 5 });
    const battle = grid([enemy, ally]); enemy.pos = 31; ally.pos = 52;
    battle.allyTactic = 'defensive';
    battle.autoAction(enemy.id);
    expect(battle.log.some(entry => entry.resolution?.attackerId === enemy.id)).toBe(true);
    expect(enemy.tacticalPose).toBeUndefined();
  });
  it('会战持盾射手不会全队固守或反复聚拢换位，展开后持续攻击', () => {
    const units = (['ally', 'enemy'] as const).flatMap(side => [0, 1].map(index => make(side + index, side,
      { scale: 'company', hpMax: 20, weaponClass: 'rifle', shield: true, traits: ['shield-wall'] })));
    for (const unit of units) unit.tags.push('rank:rear');
    const battle = new MassBattle({ combatants: units, rules: V4_TW, traitRegistry: registry, seed: 'shield-offense' }); battle.start();
    for (let round = 0; round < 3; round++) {
      const previousAttacks = battle.log.filter(entry => entry.resolution?.attackerId.startsWith('enemy')).length;
      battle.autoOrders('ally'); battle.autoOrders('enemy');
      expect(units.filter(unit => unit.side === 'enemy').every(unit => battle.orders.get(unit.id)?.type === 'brace')).toBe(false);
      battle.resolveRound();
      if (round > 0) expect(battle.log.filter(entry => entry.resolution?.attackerId.startsWith('enemy')).length).toBeGreaterThan(previousAttacks);
    }
  });
  it('可绕行墙体前不再反复警戒，沿合法道路抵达任务格', () => {
    const actor = make('a', 'ally'), enemy = make('e', 'enemy'), battle = grid([actor, enemy]); actor.pos = 30; enemy.pos = 6;
    battle.battlefield!.objective = { kind: 'control', cell: 32, rounds: 2, limit: 60 };
    for (let row = 1; row < 9; row++) battle.battlefield!.tiles[row * 7 + 3] = 'wall';
    for (let round = 0; round < 4; round++) { battle.autoAction(actor.id); expect(battle.battlefield!.tiles[actor.pos!]).not.toBe('wall'); battle.endTurn(); }
    expect(actor.pos).toBe(32);
  });
  it('移动后发现新敌人，在同次激活内重新选择合法攻击并只用一次主行动', () => {
    const actor = make('a', 'ally', { weaponClass: 'rifle' }), enemy = make('e', 'enemy', { weaponClass: 'rifle' });
    const battle = grid([actor, enemy], true); actor.pos = 59; enemy.pos = 31;
    expect(battle.visibleCombatants('ally')).not.toContain(enemy);
    const attack = vi.spyOn(battle, 'attack');
    battle.autoAction(actor.id);
    expect(battle.visibleCombatants('ally')).toContain(enemy);
    expect(attack).toHaveBeenCalledTimes(1);
    expect(battle.log.filter(entry => entry.resolution?.attackerId === actor.id)).toHaveLength(actor.weapon!.attacks!);
    expect(battle.log.find(entry => entry.resolution?.attackerId === actor.id)?.resolution?.defenderId).toBe(enemy.id);
    expect(battle.active?.id).toBe(enemy.id);
  });
  it('200生命的两人编队不被当成2生命，优先选择确有更高伤害收益的目标', () => {
    const actor = make('a', 'ally', { weaponClass: 'rifle' }), soft = make('h-soft', 'enemy', { hpMax: 200 });
    const company = make('z-cohort', 'enemy', { scale: 'company', hpMax: 2 }), battle = grid([actor, soft, company]);
    actor.pos = 59; soft.pos = 31; company.pos = 33; company.base = { ...soft.base, hpMax: 2 };
    company.formation!.memberHp = 100; company.formation!.health = [{ hp: 100, count: 2 }];
    soft.conditions.push({ id: 'vulnerable', dur: 9 }); battle.movementSpent.set(actor.id, 99);
    expect(memberHealth(soft)).toBe(memberHealth(company));
    expect(shotAt(battle, actor.id, soft.id).preview!.expectedDamage).toBeGreaterThan(shotAt(battle, actor.id, company.id).preview!.expectedDamage!);
    battle.autoAction(actor.id);
    expect(battle.log.find(entry => entry.resolution?.attackerId === actor.id)?.resolution?.defenderId).toBe(soft.id);
  });
  it('实际跨线阵位的会战单位能接战，不再前进/后退循环', () => {
    const actor = make('a', 'ally', { scale: 'company', hpMax: 10 }), enemy = make('e', 'enemy', { scale: 'company', hpMax: 10 });
    actor.tags.push('zone:左翼'); enemy.tags.push('zone:中军');
    const battle = new MassBattle({ combatants: [actor, enemy], rules: V4_TW, traitRegistry: registry, seed: 'mass-meeting' }); battle.start();
    actor.formationPosition = 'ally:左翼:front'; enemy.formationPosition = 'enemy:中军:front';
    for (let round = 0; round < 3; round++) { battle.autoOrders('ally'); battle.autoOrders('enemy'); battle.resolveRound(); }
    expect(battle.log.some(entry => entry.resolution?.attackerId === actor.id)).toBe(true);
    expect(battle.log.some(entry => entry.resolution?.attackerId === enemy.id)).toBe(true);
  });
  it('持盾固守真正阻断后排直射及武器射击技能，预览与实际一致且拒绝时不扣资源', () => {
    const { battle, guard, rear, shooter } = shieldGrid(); shooter.pos = 17; battle.brace(guard.id); battle.endTurn();
    expect(shotAt(battle, shooter.id, rear.id)).toMatchObject({ enabled: false, reason: expect.stringContaining('遮挡') });
    expect(shotAt(battle, shooter.id, guard.id).enabled).toBe(true);
    const before = JSON.stringify(battle.toSnapshot());
    expect(() => battle.attack(shooter.id, rear.id)).toThrow('遮挡');
    expect(battle.useAbility(shooter.id, shooter.abilities[0]!.id, rear.id)).toMatchObject({ ok: false, reason: expect.stringContaining('遮挡') });
    expect(JSON.stringify(battle.toSnapshot())).toBe(before);
    const restored = SmallBattle.fromSnapshot(JSON.parse(before), { traitRegistry: registry });
    expect(shotAt(restored, shooter.id, rear.id).enabled).toBe(false);
    expect(battle.useAbility(shooter.id, shooter.abilities[1]!.id, rear.id).ok).toBe(true);
  });
  it('常态遮挡可被火炮、侧射、间接火力和空中绕过；卸盾、失能不移除地面占位，旧V2规则保留', () => {
    for (const change of ['flank', 'indirect', 'cannon', 'magic', 'unshield', 'stun', 'move', 'air']) {
      const { battle, guard, rear, shooter } = shieldGrid(); battle.brace(guard.id);
      if (change === 'move') battle.moveTo(guard.id, 32);
      if (change === 'flank') shooter.pos = 14;
      if (change === 'indirect') shooter.weapon!.indirect = true;
      if (change === 'cannon' || change === 'magic') shooter.weapon = make('bypass', 'enemy', { weaponClass: change }).weapon;
      if (change === 'unshield') delete guard.shield;
      if (change === 'stun') guard.conditions.push({ id: 'stunned', dur: 2 });
      if (change === 'air') { shooter.traits.push('flying'); shooter.airborne = true; }
      battle.endTurn(); expect(shotAt(battle, shooter.id, rear.id).enabled, change).toBe(['flank', 'indirect', 'cannon', 'move', 'air'].includes(change));
    }
    const { battle, guard, rear, shooter } = shieldGrid(); battle.brace(guard.id); rear.pos = guard.pos; rear.shield = guard.shield;
    rear.tacticalPose = bracePose(rear, shooter, 'small', 7); battle.endTurn();
    expect(shotAt(battle, shooter.id, guard.id).enabled).toBe(true); expect(shotAt(battle, shooter.id, rear.id).enabled).toBe(true);
    const old = shieldGrid(V2_D20); old.battle.brace(old.guard.id); old.battle.endTurn(); expect(shotAt(old.battle, old.shooter.id, old.rear.id).enabled).toBe(true);
  });
  it('前排无需固守即可保护后排，敌方射手会移动找侧射再攻击', () => {
    const { battle, guard, rear, shooter } = shieldGrid(V4_D20, 5); shooter.abilities = []; shooter.preparedAbilityIds = [];
    battle.endTurn();
    expect(guard.tacticalPose).toBeUndefined(); expect(shotAt(battle, shooter.id, rear.id).enabled).toBe(false);
    const previous = shooter.pos; battle.autoAction(shooter.id);
    expect(shooter.pos).not.toBe(previous);
    expect(battle.log.find(entry => entry.resolution?.attackerId === shooter.id)?.resolution?.defenderId).toBe(rear.id);
  });
  it('会战前排常态遮挡，架盾不重复计收益；后排射击预览不泄露尚未执行军令', () => {
    const guard = make('guard', 'ally', { scale: 'company', hpMax: 20, shield: true, traits: ['shield-wall'], armorTier: 3 });
    const rear = make('rear', 'ally', { scale: 'company', hpMax: 20, weaponClass: 'bow' });
    const shooter = make('shooter', 'enemy', { scale: 'company', hpMax: 20, weaponClass: 'rifle' }); rear.tags.push('rank:rear'); shooter.tags.push('rank:front');
    const battle = new MassBattle({ combatants: [guard, rear, shooter], rules: V4_TW, traitRegistry: registry, seed: 'mass-shield' }); battle.start();
    const shot = { unitId: shooter.id, type: 'volley' as const, targetId: rear.id };
    const preview = battle.orderPreview(shot); expect(preview.reason).toContain('遮挡');
    expect(battle.recommendedOrder(guard.id)?.type).not.toBe('brace'); battle.issue({ unitId: guard.id, type: 'brace' });
    expect(battle.orderPreview(shot)).toEqual(preview);
    expect(battle.issue(shot).ok).toBe(false); battle.issue({ unitId: shooter.id, type: 'hold' }); const hp = memberHealth(rear); battle.resolveRound();
    expect(memberHealth(rear)).toBe(hp); expect(battle.orderPreview(shot).reason).toContain('遮挡');
  });
  it('会战自动单位协调已下达的己方落点，不把两队同时塞进只剩一个位置的阵位', () => {
    const movers = ['a1', 'a2'].map(id => make(id, 'ally', { body: 'vehicle', scale: 'company', hpMax: 2, weaponClass: 'rifle' }));
    const guards = ['g1', 'g2'].map(id => make(id, 'ally', { scale: 'company', hpMax: 10 }));
    const enemy = make('enemy', 'enemy', { scale: 'company', hpMax: 10 }); enemy.tags.push('zone:右翼', 'rank:rear');
    for (const mover of movers) mover.tags.push('zone:左翼', 'rank:rear');
    for (const guard of guards) guard.tags.push('zone:左翼', 'rank:front');
    const battle = new MassBattle({ combatants: [...movers, ...guards, enemy], rules: V4_TW, traitRegistry: registry, seed: 'reservations' }); battle.start();
    for (const guard of guards) battle.issue({ unitId: guard.id, type: 'hold' });
    battle.issue({ unitId: enemy.id, type: 'hold' }); battle.autoOrders('ally');
    const moves = movers.map(unit => battle.orderPreview(battle.orders.get(unit.id)!).destination?.id);
    expect(moves.filter(id => id === 'ally:左翼:front')).toHaveLength(1);
    expect(moves[0]).not.toBe(moves[1]);
    battle.resolveRound();
    expect(battle.log.some(entry => entry.text.includes('同层冲突'))).toBe(false);
  });
  it('会战按有效火力选择主副武器，重炮副槽不被低阶弓弩主槽抢占', () => {
    const actor = make('a', 'ally', { body: 'vehicle', scale: 'company', hpMax: 2, weaponClass: 'bow', weaponLevel: 1, sidearmClass: 'cannon', sidearmLevel: 6 });
    const enemy = make('e', 'enemy', { scale: 'company', hpMax: 100 }); actor.tags.push('rank:rear'); enemy.tags.push('rank:rear');
    const battle = new MassBattle({ combatants: [actor, enemy], rules: V4_TW, traitRegistry: registry, seed: 'choose-weapon' }); battle.start();
    const before = JSON.stringify(battle.toSnapshot());
    const order = battle.recommendedOrder(actor.id)!; expect(order.type).toBe('volley');
    expect(battle.orderPreview(order).weaponName).toBe(actor.sidearm!.name);
    expect(JSON.stringify(battle.toSnapshot())).toBe(before);
    battle.issue(order); battle.issue({ unitId: enemy.id, type: 'hold' }); battle.resolveRound();
    expect(battle.log.some(entry => entry.resolution?.attackerId === actor.id)).toBe(true);
    expect(battle.reloadCd.get(weaponReloadKey(actor, actor.sidearm)) ?? 0).toBeGreaterThan(0);
    expect(battle.reloadCd.get(actor.id) ?? 0).toBe(0);
  });
});
