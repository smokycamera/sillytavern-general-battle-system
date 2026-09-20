import { describe, expect, it, vi } from 'vitest';
import { generateUnit, SmallBattle, MassBattle, standardField, traitRegistry, V2_D20, V2_TW, type Combatant, type GenerateInput } from '../src/index.js';
const registry = traitRegistry();
function make(id: string, side: 'ally' | 'enemy', extra: Partial<GenerateInput> = {}): Combatant {
  const u = generateUnit({ name: id, side, scale: 'hero', rulesVersion: 'v2', level: 4, hpMax: 500, armorTier: 1, weaponClass: 'rifle', traits: [], ...extra }, { registry, seed: id, noVariance: true }).unit;
  u.id = id; return u;
}
function grid(a: Combatant, enemy = make('enemy', 'enemy')) {
  const field = standardField(); field.tiles.fill('open');
  const b = new SmallBattle({ combatants: [a, enemy], battlefield: field, rules: V2_D20, traitRegistry: registry, seed: 'ai-options', rng: { seed: 'fixed', next: () => 0.1, d: (n) => n } });
  b.start(); b.turnOrder = [a.id, enemy.id]; b.turnIndex = 0; a.pos = 31; enemy.pos = 24; return b;
}
describe('V2 AI与手动动作一致', () => {
  it('自动治疗把可救的濒死队友纳入候选，与手动治疗一致', () => {
    const healer = make('healer', 'ally', { weaponClass: 'sword', abilityBlueprints: [{ id: 'generic:buff:heal', level: 7, name: '复苏' }] });
    const battle = grid(healer), fallen = make('fallen', 'ally');
    fallen.hp = 0; fallen.status = 'dying'; fallen.pos = 32; battle.combatants.push(fallen);
    battle.byId('enemy').pos = 0; battle.movementSpent.set(healer.id, 5);
    const ability = healer.abilities[0]!;
    expect(battle.getActionOptions(healer.id).find((o) => o.id === ability.id)?.targets?.find((t) => t.targetId === fallen.id)?.enabled).toBe(true);
    battle.autoAction(healer.id);
    expect(fallen.hp).toBeGreaterThan(0);
    expect(fallen.status).toBe('ready');
    expect(healer.abilityState.find((s) => s.abilityId === ability.cooldownGroup)?.used).toBe(1);
  });
  it('会战自动治疗也能救助濒死的随队人物，消耗所属编队一次任务', () => {
    const healer = make('healer', 'ally', { scale: 'company', weaponClass: 'sword', abilityBlueprints: [{ id: 'generic:buff:heal', level: 7, name: '复苏' }] });
    const fallen = make('fallen', 'ally'), enemy = make('enemy', 'enemy', { scale: 'company', weaponClass: 'sword' });
    for (const u of [healer, fallen, enemy]) u.tags.push('rank:reserve', 'zone:中军');
    const battle = new MassBattle({ combatants: [healer, fallen, enemy], rules: V2_TW, traitRegistry: registry, seed: 'ai-recovery' }); battle.start();
    const target = battle.byId(fallen.id); target.hp = 0; target.status = 'dying';
    const ability = battle.byId(healer.id).abilities[0]!;
    expect(battle.orderPreview({ unitId: healer.id, type: 'ability', abilityId: ability.id, targetId: target.id }).reason).toBeUndefined();
    const order = battle.recommendedOrder(healer.id);
    expect(order).toMatchObject({ type: 'ability', targetId: target.id, abilityId: ability.id });
    expect(battle.issue(order!).ok).toBe(true); battle.issue({ unitId: enemy.id, type: 'hold' }); battle.resolveRound();
    expect(target.hp).toBeGreaterThan(0); expect(target.status).toBe('ready');
    expect(battle.byId(healer.id).abilityState.find((s) => s.abilityId === ability.cooldownGroup)?.used).toBe(1);
  });
  it('协同载具主动让出己方护送出口，护送对象能实际抵达；敌方仍可守出口', () => {
    function escortCase(friendly: boolean, mirrored = false) {
      const side = mirrored ? 'enemy' : 'ally', opponent = mirrored ? 'ally' : 'enemy';
      const escorted = make('escorted', friendly ? side : opponent, { weaponClass: 'sword' });
      const guard = make('guard', side, { body: 'vehicle' }), enemy = make('enemy', opponent);
      const field = standardField(); field.tiles.fill('open');
      field.objective = { kind: 'escape', unitId: escorted.id, cell: mirrored ? 59 : 3, limit: 12, defenderWins: true };
      const b = new SmallBattle({ combatants: [escorted, guard, enemy], rules: V2_D20, battlefield: field, seed: 'escort-clear', traitRegistry: registry });
      b.start(); escorted.pos = mirrored ? 45 : 17; guard.pos = mirrored ? 59 : 3; enemy.pos = mirrored ? 0 : 62; enemy.conditions.push({ id: 'stunned', dur: 99 });
      b.turnOrder = [guard.id, escorted.id, enemy.id]; b.turnIndex = 0; return b;
    }
    const own = escortCase(true);
    own.autoAction('guard'); expect(own.byId('guard').pos).not.toBe(3);
    own.autoAction('escorted'); expect(own.objectiveWinner).toBe('ally');
    expect(own.byId('escorted').pos).toBe(3);
    const hostile = escortCase(false);
    hostile.autoAction('guard'); expect(hostile.byId('guard').pos).toBe(3);
    const mirrored = escortCase(true, true);
    mirrored.autoAction('guard'); expect(mirrored.byId('guard').pos).not.toBe(59);
    mirrored.autoAction('escorted'); expect(mirrored.objectiveWinner).toBe('enemy');
    expect(mirrored.byId('escorted').pos).toBe(59);
  });

  it('未发现侧翼伏兵时主动巡视，接敌后真实攻击，不能因双方互等耗尽期限', () => {
    const a = make('a', 'ally', { scale: 'company', weaponClass: 'sword', traits: ['stalk', 'fast'] });
    const e = make('enemy', 'enemy', { scale: 'company', weaponClass: 'sword', traits: ['charge-strong'] });
    a.tags.push('zone:左翼', 'rank:rear'); e.tags.push('zone:中军', 'rank:front');
    const b = new MassBattle({ combatants: [a, e], rules: V2_TW, seed: 'search', traitRegistry: registry, field: { tags: ['night', 'forest'] } });
    b.start();
    expect(b.visibleCombatants('enemy').map((u) => u.id)).not.toContain('a');
    expect(b.recommendedOrder('enemy')?.type).toBe('shift-left');
    for (let i = 0; i < 4 && !b.isOver(); i++) { b.autoOrders('ally'); b.autoOrders('enemy'); b.resolveRound(); }
    expect(b.log.some((e) => e.resolution)).toBe(true);
  });

  it('被牵制的普通弓手会先退到合法射界，后排守军也能迎击已落地的入侵者', () => {
    const a = make('a', 'ally', { scale: 'company', weaponClass: 'bow' }), enemy = make('enemy', 'enemy', { scale: 'company' });
    const b = new MassBattle({ combatants: [a, enemy], rules: V2_TW, seed: 'ranged-reposition', traitRegistry: registry }); b.start();
    b.autoOrders('ally'); expect(b.orders.get(a.id)?.type).toBe('rank-back'); b.issue({ unitId: enemy.id, type: 'hold' }); b.resolveRound(); b.autoOrders('ally'); expect(b.orders.get(a.id)?.type).toBe('volley');
    const guard = make('guard', 'ally', { scale: 'company', weaponClass: 'sword' }), invader = make('invader', 'enemy', { scale: 'company' }); guard.tags.push('rank:reserve');
    const rear = new MassBattle({ combatants: [guard, invader], rules: V2_TW, seed: 'rear-defense', traitRegistry: registry }); rear.start(); invader.formationPosition = 'ally:中军:rear';
    expect(rear.issue({ unitId: guard.id, type: 'attack', targetId: invader.id }).ok).toBe(true); rear.issue({ unitId: invader.id, type: 'hold' }); rear.resolveRound(); expect(rear.log.some((l) => l.resolution?.attackerId === guard.id)).toBe(true);
  });

  it('会战自动等待装填只是临时决策，装填完成重新评估；玩家固守仍继承', () => {
    const a = make('a', 'ally', { scale: 'company' }), e = make('enemy', 'enemy', { scale: 'company' });
    const b = new MassBattle({ combatants: [a, e], rules: V2_TW, seed: 'reload', traitRegistry: registry }); b.start(); b.reloadCd.set('a', 1);
    b.autoOrders('ally'); expect(b.orders.get('a')?.type).toBe('brace'); b.resolveRound(); b.autoOrders('ally');
    expect(b.orders.get('a')?.type).toBe('volley');
    b.revoke('a'); b.issue({ unitId: 'a', type: 'brace' }); b.resolveRound(); b.autoOrders('ally'); expect(b.orders.get('a')?.type).toBe('brace');
  });
  it('相邻翼近战AI能汇合接战，不会同时互换翼位无限追逐', () => {
    const a = make('a', 'ally', { scale: 'company', weaponClass: 'sword' }), e = make('enemy', 'enemy', { scale: 'company', weaponClass: 'sword' });
    a.tags.push('zone:左翼'); e.tags.push('zone:中军');
    const b = new MassBattle({ combatants: [a, e], rules: V2_TW, seed: 'meeting', traitRegistry: registry }); b.start();
    for (let i = 0; i < 3; i++) { b.autoOrders('ally'); b.autoOrders('enemy'); b.resolveRound(); }
    expect(b.log.some((l) => l.kind === 'attack')).toBe(true);
  });
  it('主武器装填/无法抵近时，AI用合法副武器，仍只占一个主行动', () => {
    const a = make('a', 'ally', { sidearmClass: 'sword', sidearmLevel: 8 }); const b = grid(a);
    a.weapon!.minRange = 2; a.weapon!.pointBlankPolicy = 'forbid'; b.reloadCd.set('a', 2); b.movementSpent.set('a', 3);
    const target = b.byId('enemy'), hp = target.hp;
    expect(b.getActionOptions('a').find((o) => o.id === 'weapon:sidearm')?.enabled).toBe(true);
    b.autoAction('a'); expect(target.hp).toBeLessThan(hp);
    expect(b.log.filter((l) => l.resolution?.attackerId === 'a')).toHaveLength(1);
    expect(b.log.find((l) => l.resolution?.attackerId === 'a')?.resolution?.baseRoll?.expr).toBe(a.sidearm!.baseDice + '×2');
  });
  it('有明确冲锋收益时，AI沿合法路径冲锋并使用相同加值', () => {
    const a = make('a', 'ally', { weaponClass: 'sword', traits: ['charge-strong'] }); const b = grid(a);
    a.pos = 42; b.byId('enemy').pos = 21;
    const attack = vi.spyOn(b, 'attack'); b.autoAction('a');
    expect(attack.mock.calls.some((call) => call[2]?.charge === true)).toBe(true);
    expect(b.dist(a, b.byId('enemy'))).toBe(1);
  });
  it('枪械没有副武器时不能把射击包装成近战冲锋', () => {
    const a = make('a', 'ally', { archetype: 'mobile' }); const b = grid(a);
    a.pos = 42; b.byId('enemy').pos = 21; const before = JSON.stringify(b.toSnapshot());
    expect(() => b.attack('a', 'enemy', { charge: true })).toThrow('近战武器');
    expect(JSON.stringify(b.toSnapshot())).toBe(before);
  });
  it('缴械后AI仍能结束激活，不会选中手动禁止的武器动作而抛错', () => {
    const a = make('a', 'ally'); const b = grid(a); a.conditions.push({ id: 'disarmed', dur: 2 }); b.movementSpent.set('a', 3);
    expect(() => b.autoAction('a')).not.toThrow();
    expect(b.log.some((l) => l.resolution?.attackerId === 'a')).toBe(false);
    expect(b.active?.id).toBe('enemy');
  });
  it('无合法武器目标时，AI会使用有装备前提和资源成本的防御支援', () => {
    const a = make('a', 'ally', { weaponClass: 'sword', shield: true, abilityBlueprints: ['bp-iron-guard'] }); const b = grid(a);
    b.byId('enemy').pos = 17; b.movementSpent.set('a', 3); const sp = a.resources.SP!;
    b.autoAction('a'); expect(a.resources.SP).toBe(sp - a.abilities[0]!.cost!.amount);
    expect(a.abilityState[0]?.used).toBe(1);
  });
  it('会战AI可选择副武器近战与冲锋任务，不受主武器种类的一刀切影响', () => {
    const a = make('a', 'ally', { scale: 'company', sidearmClass: 'sword', sidearmLevel: 8 }); const enemy = make('enemy', 'enemy', { scale: 'company' });
    const b = new MassBattle({ combatants: [a, enemy], rules: V2_TW, seed: 'sidearm', traitRegistry: registry }); b.start(); b.reloadCd.set('a', 2);
    b.autoOrders('ally'); expect(b.orders.get('a')?.type).toBe('attack');
    const charger = make('charger', 'ally', { scale: 'company', weaponClass: 'sword', traits: ['charge-strong'] });
    const flank = make('flank', 'enemy', { scale: 'company' }); flank.tags.push('zone:左翼');
    const c = new MassBattle({ combatants: [charger, flank], rules: V2_TW, seed: 'charge', traitRegistry: registry }); c.start(); c.autoOrders('ally');
    expect(c.orders.get('charger')?.type).toBe('charge');
    c.resolveRound();
    expect(c.issue({ unitId: 'charger', type: 'charge', targetId: 'flank' })).toMatchObject({ ok: false, reason: '已经接敌，没有冲锋助跑距离' });
  });
});

