import { describe, expect, it } from 'vitest';
import { FORMATION_NODES, formationDistance, formationNode, generateUnit, MassBattle, traitRegistry, V2_TW, type Combatant, type GenerateInput } from '../src/index.js';
const registry = traitRegistry();
function company(id: string, side: 'ally' | 'enemy', rank = 'front', extra: Partial<GenerateInput> = {}): Combatant {
  const u = generateUnit({ name: id, side, scale: 'company', rulesVersion: 'v2', level: 4, hpMax: 50, weaponClass: 'rifle', weaponLevel: 5, armorTier: 1, traits: [], ...extra }, { seed: id, registry, noVariance: true }).unit;
  u.id = id; u.tags.push('zone:中军', 'rank:' + rank); return u;
}
function battle(units: Combatant[], fixed = false) {
  const b = new MassBattle({ combatants: units, rules: V2_TW, zones: ['左翼', '中军', '右翼'], seed: 'formation', traitRegistry: registry,
    ...(fixed ? { rng: { seed: 'always-hit', next: () => 0, d: (n: number) => n } } : {}) });
  b.start(); return b;
}
describe('V2 会战阵位与阶段', () => {
  it('自动军令选择合法预备召唤，随队人物使用宿主任务且新生不立刻行动', () => {
    const host = company('host', 'ally');
    const hero = company('hero', 'ally', 'front', { scale: 'hero', abilityBlueprints: ['bp-call-reinforce'], reserves: 1 });
    const b = new MassBattle({ combatants: [host, hero, company('enemy', 'enemy')], rules: V2_TW, seed: 'support', traitRegistry: registry,
      summonUnit: (_template, side) => company('birth', side as 'ally' | 'enemy', 'reserve') });
    b.start(); b.autoOrders('ally');
    expect(b.orders.get('host')).toMatchObject({ type: 'ability', abilityActorId: 'hero' });
    b.resolveRound();
    const birth = b.combatants.find((u) => u.summonerId === hero.id)!;
    expect(birth).toBeDefined(); expect(hero.resources.reserve).toBe(0);
    expect(b.log.some((l) => l.resolution?.attackerId === birth.id)).toBe(false);
  });
  it('拥挤机动取消会传播到来源阵位，连锁退回后没有超容量', () => {
    const units = ['left', 'mid', 'right'].flatMap((wing) => [0, 1, 2].map((i) => {
      const u = company(wing + i, 'ally'); u.tags = ['zone:' + ({ left: '左翼', mid: '中军', right: '右翼' }[wing]), 'rank:front']; return u;
    }));
    const b = battle([...units, company('enemy', 'enemy')]);
    // mid -> right 被满位拒绝；left -> mid 也必须随之退回，不能把中军挤成4支。
    b.issue({ unitId: 'mid0', type: 'shift-right' }); b.issue({ unitId: 'left0', type: 'shift-right' }); b.resolveRound();
    for (const node of FORMATION_NODES) expect(units.filter((u) => formationNode(u).id === node.id).length).toBeLessThanOrEqual(3);
    expect(formationNode(b.byId('left0')).wing).toBe('左翼');
  });
  it('18个阵位，距离包括双方纵深，不以翼位差冒充射程', () => {
    expect(FORMATION_NODES).toHaveLength(18);
    expect(formationDistance(company('a', 'ally', 'reserve'), company('b', 'enemy', 'reserve'))).toBe(5);
    expect(formationDistance(company('a', 'ally'), company('b', 'enemy'))).toBe(1);
  });
  it('同时互射保留双方火力，交换数组顺序结果相同', () => {
    const a = company('a', 'ally', 'front', { hpMax: 3, weaponLevel: 10 });
    const b = company('b', 'enemy', 'front', { hpMax: 3, weaponLevel: 10 });
    const run = (units: Combatant[]) => {
      const combat = battle(units, true);
      combat.issue({ unitId: 'a', type: 'volley', targetId: 'b' }); combat.issue({ unitId: 'b', type: 'volley', targetId: 'a' });
      combat.resolveRound(1);
      return { hp: combat.combatants.map((u) => [u.id, u.hp]).sort(), log: combat.log, phases: combat.lastPhases };
    };
    const result = run(structuredClone([a, b]));
    expect(result.hp).toEqual([['a', 0], ['b', 0]]);
    expect(result).toEqual(run(structuredClone([b, a])));
    expect(result.phases).toEqual(['计划锁定', '支援', '机动', '交战', '重整']);
  });
  it('主任务和技能互斥，排令不扣资源，执行仅扣一次，旧round拒绝', () => {
    const a = company('a', 'ally', 'front', { abilityBlueprints: ['bp-battle-hymn'] });
    const b = battle([a, company('b', 'enemy')]); const ability = a.abilities[0]!; const sp = a.resources.SP!;
    expect(b.issue({ unitId: a.id, type: 'volley', targetId: 'b' }).ok).toBe(true);
    expect(b.useAbility(a.id, ability.id, a.id).ok).toBe(false);
    b.revoke(a.id); expect(b.useAbility(a.id, ability.id, a.id).ok).toBe(true); expect(a.resources.SP).toBe(sp);
    expect(b.issue({ unitId: a.id, type: 'volley', targetId: 'b' }).ok).toBe(false);
    b.resolveRound(1); expect(a.resources.SP).toBe(sp - ability.cost!.amount);
    expect(b.log.filter((l) => l.kind === 'attack' && l.resolution?.attackerId === 'a')).toHaveLength(0);
    const before = JSON.stringify(b.toSnapshot()); expect(() => b.resolveRound(1)).toThrow('过期'); expect(JSON.stringify(b.toSnapshot())).toBe(before);
  });
  it('自动军令只补空缺，保留已改与有效上轮军令', () => {
    const b = battle([company('a', 'ally'), company('b', 'enemy')]);
    b.previousOrders.set('a', { unitId: 'a', type: 'hold' });
    b.issue({ unitId: 'a', type: 'brace' }); b.autoOrders('ally'); expect(b.orders.get('a')?.type).toBe('brace');
    b.resolveRound(); b.autoOrders('ally'); expect(b.orders.get('a')?.type).toBe('brace');
  });
  it('预备队按射程/遮挡判断，间接火力有观察者可用', () => {
    const reserve = company('reserve', 'ally', 'reserve');
    const front = company('front', 'ally'); const enemy = company('enemy', 'enemy');
    const b = battle([reserve, front, enemy]);
    expect(b.issue({ unitId: reserve.id, type: 'volley', targetId: enemy.id })).toMatchObject({ ok: false, reason: '前线遮挡预备队直射' });
    reserve.weapon!.indirect = true;
    expect(b.issue({ unitId: reserve.id, type: 'volley', targetId: enemy.id }).ok).toBe(true);
    b.revoke(reserve.id); reserve.weapon!.indirect = false; front.status = 'fled';
    expect(b.issue({ unitId: reserve.id, type: 'volley', targetId: enemy.id }).ok).toBe(true);
  });
  it('普通人物随队，没有独立任务/火力；宿主覆没时只处理一次暴露', () => {
    const host = company('host', 'ally', 'front', { hpMax: 1 });
    const hero = company('hero', 'ally', 'front', { scale: 'hero', hpMax: 40 });
    const reserve = company('reserve', 'ally', 'reserve');
    const enemy = company('enemy', 'enemy', 'front', { weaponLevel: 10 });
    const b = battle([host, hero, reserve, enemy], true);
    expect(b.isAttached(hero.id)).toBe(true); expect(b.issue({ unitId: hero.id, type: 'volley', targetId: enemy.id }).ok).toBe(false);
    b.issue({ unitId: host.id, type: 'hold' }); b.issue({ unitId: enemy.id, type: 'volley', targetId: host.id });
    b.resolveRound(); expect(host.hp).toBe(0); expect(hero.status).toBe('fled'); expect(hero.hp).toBe(30);
    b.resolveRound(); expect(hero.hp).toBe(30);
    expect(b.log.filter((l) => l.text.includes('随队暴露'))).toHaveLength(1);
    expect(() => battle([company('alone', 'ally', 'front', { scale: 'hero' }), company('enemy2', 'enemy')])).toThrow('普通人物需要随队');
  });
  it('变阵不进入敌方所有阵位，规则/已执行轮次/命令记忆随快照恢复', () => {
    const a = company('a', 'ally', 'reserve'); const b = battle([a, company('b', 'enemy')]);
    b.issue({ unitId: 'a', type: 'rank-forward' }); b.resolveRound(1);
    expect(formationNode(a)).toMatchObject({ side: 'ally', rank: 'rear' });
    const restored = MassBattle.fromSnapshot(JSON.parse(JSON.stringify(b.toSnapshot())), { traitRegistry: registry });
    expect(restored.lastPhases).toEqual(b.lastPhases); expect(restored.resolvedRounds.has(1)).toBe(true);
    expect(() => restored.resolveRound(1)).toThrow();
  });
});
