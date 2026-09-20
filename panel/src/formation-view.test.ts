import { describe, expect, it } from 'vitest';
import { formationNode, generateUnit, MassBattle, traitRegistry, V2_TW, type GenerateInput } from '../../engine/src/index.js';
import { formationSelection, selectFormationUnit, setFormationChoice, type FormationView, type OrderDrafts } from './formation-orders.js';
import { renderFormationBattle } from './formation-view.js';
const registry = traitRegistry();
function fixture(hidden = false) {
  const units = ['a', 'hero', 'reserve', 'enemy', ...(hidden ? ['hidden'] : [])].map((id) => {
    const u = generateUnit({ rulesVersion: 'v2', name: id === 'hidden' ? '未发现的守卫' : id, side: ['enemy', 'hidden'].includes(id) ? 'enemy' : 'ally',
      scale: id === 'hero' ? 'hero' : 'company', hpMax: id === 'hero' ? 40 : 100, hp: id === 'hero' ? 10 : 100,
      level: 4, weaponClass: 'rifle', weaponLevel: 4, armorTier: 1, traits: id === 'hidden' ? ['stalk'] : [],
      abilityBlueprints: id === 'hero' ? ['bp-mending'] : [] }, { registry, seed: id, noVariance: true }).unit;
    u.id = id; u.tags = [id === 'hidden' ? 'zone:左翼' : 'zone:中军', ['reserve', 'hidden'].includes(id) ? 'rank:reserve' : 'rank:front']; return u;
  });
  const b = new MassBattle({ combatants: units, rules: V2_TW, seed: 'p5-commands', traitRegistry: registry, commanderId: 'hero' });
  b.start(); return b;
}
describe('军团地图与任务闭环', () => {
  it('未发现占位不改变机动预览和建议，执行遇敌才停步并发现；已知占位立即反映', () => {
    function ambush(near: boolean) {
      const units = ['scout', 'hidden'].map((id) => {
        const u = generateUnit({ rulesVersion: 'v2', name: id, side: id === 'scout' ? 'ally' : 'enemy',
          scale: 'company', level: 4, hpMax: 100, weaponClass: 'sword', armorTier: 0,
          traits: [id === 'scout' ? 'fast' : 'stalk'] }, { registry, seed: id, noVariance: true }).unit;
        u.id = id; u.tags = ['zone:中军', 'rank:reserve']; return u;
      });
      const b = new MassBattle({ combatants: units, rules: V2_TW, seed: 'hidden-route', traitRegistry: registry });
      b.start(); b.byId('hidden').formationPosition = near ? 'ally:中军:front' : 'enemy:左翼:reserve'; return b;
    }
    const near = ambush(true), far = ambush(false), order = { unitId: 'scout', type: 'rank-forward' as const };
    expect(near.visibleCombatants('ally').map((u) => u.id)).toEqual(['scout']);
    const before = JSON.stringify(near.toSnapshot());
    expect(near.orderPreview(order)).toEqual(far.orderPreview(order));
    expect(near.orderPreview(order).destination?.id).toBe('ally:中军:front');
    expect(near.recommendedOrder('scout')).toEqual(far.recommendedOrder('scout'));
    expect(JSON.stringify(near.toSnapshot())).toBe(before);
    near.byId('hidden').tacticalRevealed = true;
    expect(near.orderPreview(order).destination?.id).toBe('ally:中军:rear');
    near.byId('hidden').tacticalRevealed = false;
    expect(near.replaceOrders([order]).ok).toBe(true);
    expect(near.issue({ unitId: 'hidden', type: 'hold' }).ok).toBe(true);
    near.resolveRound();
    expect(formationNode(near.byId('scout')).id).toBe('ally:中军:rear');
    expect(near.visibleCombatants('ally').map((u) => u.id)).toContain('hidden');
  });

  it('范围逐目标预览与实际名单一致，同名单位仍分别高亮且隐藏目标不入列', () => {
    const make = (id: string, extra: Partial<GenerateInput>) => {
      const u = generateUnit({ rulesVersion: 'v2', name: '守军', side: 'enemy', scale: 'company',
        hpMax: 100, level: 4, weaponClass: 'rifle', armorTier: 0, traits: [], ...extra },
        { registry, seed: id, noVariance: true }).unit;
      u.id = id; u.tags = ['zone:中军', 'rank:front']; return u;
    };
    const a = make('a', { side: 'ally', abilityBlueprints: [{ id: 'bp-firestorm', level: 6 }] });
    a.tags = ['zone:中军', 'rank:rear'];
    const armored = make('b', { body: 'vehicle', armorTier: 4, armorLevel: 10 }), other = make('c', {}),
      hidden = make('hidden', { name: '未发现的守卫', traits: ['stalk'] });
    hidden.tags = ['zone:中军', 'rank:rear'];
    // 明确构造穿透差≥3的目标；高等级车甲本身仍可能只差2档（12%通过）。
    armored.armor!.protection = { kinetic: 9, thermal: 9, arcane: 9 };
    const b = new MassBattle({ combatants: [a, armored, other, hidden], rules: V2_TW, seed: 'area', traitRegistry: registry });
    b.start();
    const ability = b.byId('a').abilities[0]!, order = { unitId: 'a', type: 'ability' as const, abilityActorId: 'a', abilityId: ability.id, targetId: 'b' };
    const preview = b.orderPreview(order), before = JSON.stringify(b.toSnapshot());
    expect(preview.reason).toBeUndefined();
    expect(preview.areaTargetIds).toEqual(['b', 'c']);
    expect(preview.areaPreviews?.[0]?.expectedDamage).toBe(0);
    expect(preview.areaPreviews?.[1]?.expectedDamage).toBeGreaterThan(0);
    const html = renderFormationBattle(b, { selectedId: 'a' }, { a: order }, false, (u) => u.name, (_b, o) => o.type);
    expect(html.match(/class="formation-piece [^"]*area-hit/g)).toHaveLength(2);
    expect(html).not.toContain('未发现的守卫');
    expect(JSON.stringify(b.toSnapshot())).toBe(before);
    expect(b.issue(order).ok).toBe(true);
    for (const u of b.combatants.filter((u) => u.side === 'enemy')) b.issue({ unitId: u.id, type: 'hold' });
    b.resolveRound();
    expect(b.log.flatMap((e) => e.resolution?.attackerId === 'a' ? [e.resolution.defenderId] : [])).toEqual(preview.areaTargetIds);
  });

  it('随队人物不能替已溃主力保平；新战40轮、旧快照20轮，重开不改变期限', () => {
    const broken = fixture();
    broken.byId('a').status = 'routing'; broken.byId('reserve').status = 'routing';
    expect(broken.byId('hero').status).toBe('ready');
    expect(broken.isOver()).toBe(false); // 溃兵仍在场，可以重整或遭到追击。
    broken.byId('a').status = 'fled'; broken.byId('reserve').status = 'fled';
    expect(broken.isOver()).toBe(true); expect(broken.winner()).toBe('enemy');
    expect(broken.endingReason()).toBe('forces-broken');
    const held = fixture();
    const legacy = structuredClone(held.toSnapshot()); delete legacy.roundLimit;
    expect(MassBattle.fromSnapshot(legacy, { traitRegistry: registry }).roundLimit).toBe(20);
    expect(MassBattle.fromSnapshot(structuredClone(held.toSnapshot()), { traitRegistry: registry }).roundLimit).toBe(40);
    expect(() => MassBattle.fromSnapshot({ ...legacy, roundLimit: -1 }, { traitRegistry: registry })).toThrow();
    for (let round = 1; round <= 40; round++) {
      expect(held.isOver()).toBe(false);
      for (const u of held.combatants.filter((u) => !held.isAttached(u.id))) held.issue({ unitId: u.id, type: 'hold' });
      held.resolveRound(round);
    }
    expect(held.isOver()).toBe(true); expect(held.winner()).toBe('draw');
    expect(held.endingReason()).toBe('round-limit');
  });

  it('改令整批原子化，自动补齐不碰草案；推荐和地图查看不改事实或泄露隐藏敌军', () => {
    const b = fixture(true);
    b.issue({ unitId: 'a', type: 'hold' }); b.issue({ unitId: 'reserve', type: 'hold' });
    const before = JSON.stringify(b.toSnapshot());
    expect(b.replaceOrders([{ unitId: 'a', type: 'volley', targetId: 'enemy' }, { unitId: 'reserve', type: 'charge', targetId: 'enemy' }]).ok).toBe(false);
    expect(JSON.stringify(b.toSnapshot())).toBe(before);
    const view: FormationView = { selectedId: 'a' }, drafts: OrderDrafts = { reserve: { type: 'rank-forward' } };
    selectFormationUnit(b, view, drafts, 'enemy', false);
    expect(view.selectedId).toBe('a');
    const recommendation = b.recommendedOrder('reserve');
    expect(recommendation).toBeDefined();
    expect(renderFormationBattle(b, view, drafts, false, (u) => u.name, (_b, order) => order.type)).not.toContain('未发现的守卫');
    expect(JSON.stringify(b.toSnapshot())).toBe(before);
    b.revoke('reserve'); b.autoOrders('ally', Object.keys(drafts));
    expect(b.orders.has('reserve')).toBe(false); expect(b.orders.get('a')?.type).toBe('hold');
    expect(drafts.reserve?.type).toBe('rank-forward');
  });
  it('随队治疗替换宿主任务，只支付一次；阶段反馈与任务回执重开保持，旧轮不可再执行', () => {
    const b = fixture(), view: FormationView = { selectedId: 'a' }, drafts: OrderDrafts = {};
    expect(b.attached.get('a')).toBe('hero');
    b.issue({ unitId: 'a', type: 'volley', targetId: 'enemy' });
    const choice = formationSelection(b, view, drafts).choices.find((c) => c.order.abilityActorId === 'hero')!;
    setFormationChoice(b, view, drafts, choice.key);
    selectFormationUnit(b, view, drafts, 'hero', true);
    expect(drafts.a).toMatchObject({ type: 'ability', abilityActorId: 'hero', targetId: 'hero' });
    const hp = b.byId('hero').hp, points = b.byId('hero').resources.SP!, cost = b.byId('hero').abilities[0]!.cost!.amount;
    expect(b.replaceOrders([{ unitId: 'a', ...drafts.a! }]).ok).toBe(true);
    expect(b.byId('hero').resources.SP).toBe(points);
    b.issue({ unitId: 'reserve', type: 'hold' }); b.issue({ unitId: 'enemy', type: 'hold' });
    b.resolveRound(1);
    expect(b.byId('hero').hp).toBeGreaterThan(hp); expect(b.byId('hero').resources.SP).toBe(points - cost);
    expect(b.log.filter((e) => e.resolution?.attackerId === 'a')).toHaveLength(0);
    const report = b.roundReport()!;
    expect(report.phases.map((p) => p.phase)).toEqual(['计划锁定', '支援', '机动', '交战', '重整']);
    expect(report.orders.find((r) => r.order.unitId === 'a')).toMatchObject({ phase: '支援', status: 'executed' });
    expect(report.phases.find((p) => p.phase === '支援')?.changes.find((u) => u.id === 'hero')?.resources.SP?.delta).toBe(-cost);
    const snapshot = JSON.stringify(b.toSnapshot());
    expect(MassBattle.fromSnapshot(JSON.parse(snapshot), { traitRegistry: registry }).roundReport()).toEqual(report);
    expect(() => b.resolveRound(1)).toThrow(); expect(JSON.stringify(b.toSnapshot())).toBe(snapshot);
  });
});
