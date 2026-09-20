import { describe, expect, it } from 'vitest';
import { generateUnit, SmallBattle, MassBattle, standardField, traitRegistry, V2_D20, V2_TW, grantTraitSource, revokeTraitSource, moraleRisk, moraleProfile, setFormation, FORMATION_NODES, SeededRng, applyHealthLoss, type Combatant } from '../src/index.js';
const registry = traitRegistry();
function unit(id: string, side: 'ally' | 'enemy' = 'ally') {
  const u = generateUnit({ name: id, side, scale: 'company', rulesVersion: 'v2', level: 3, hpMax: 500, traits: [], weaponClass: 'sword' }, { seed: id, registry, noVariance: true }).unit;
  u.id = id; u.base.moraleMax = 100; u.morale = id === 'a' ? 45 : 100; u.tags.push('zone:中军', 'rank:front'); return u;
}
describe('有界惊退与重整', () => {
  it('同样伤亡分成多次小伤害不能绕过士气损失，重开继续同一累计值', () => {
    const burst = unit('burst'), separate = unit('separate'); applyHealthLoss(burst, 20);
    for (let i = 0; i < 10; i++) applyHealthLoss(separate, 1);
    const restored = structuredClone(separate); for (let i = 0; i < 10; i++) applyHealthLoss(restored, 1);
    expect(restored.hp).toBe(burst.hp); expect(restored.morale).toBe(burst.morale);
  });
  it('会战恐怖区别于恐惧，惊退失去下一轮任务，随后重整，同来源不反复触发', () => {
    for (const trait of ['fear', 'terror']) {
      let roll = 1; const a = unit('a'), reserve = unit('reserve'), source = unit('source', 'enemy'); source.traits = [trait];
      const battle = new MassBattle({ combatants: [a, reserve, source], rules: V2_TW, traitRegistry: registry, seed: 'panic', rng: { seed: 'panic', next: () => 0, d: () => roll } }); battle.start();
      const round = () => { for (const u of battle.combatants.filter((u) => u.status === 'ready')) battle.issue({ unitId: u.id, type: 'hold' }); battle.resolveRound(battle.round); };
      round(); expect(a.status).toBe(trait === 'terror' ? 'routing' : 'ready');
      if (trait === 'fear') continue;
      expect(battle.issue({ unitId: a.id, type: 'attack', targetId: source.id }).ok).toBe(false);
      roll = 20; round(); expect(a.status).toBe('ready'); const hp = a.hp;
      roll = 1; for (let n = 0; n < 3; n++) round(); expect(a.status).toBe('ready'); expect(a.hp).toBe(hp);
      const restored = MassBattle.fromSnapshot(battle.toSnapshot()); expect(restored.byId('a')).toEqual(a);
    }
  });
  it('小战在激活时检定惊退，失去该次行动，下轮可重整；刷新不能重置来源记录', () => {
    let roll = 1; const a = unit('a'), backup = unit('backup'), source = unit('source', 'enemy'); source.traits = ['terror'];
    a.pos = 38; a.traits = ['vanguard']; backup.pos = 44; source.pos = 17;
    const field = standardField(); field.tiles.fill('open');
    const battle = new SmallBattle({ combatants: [a, backup, source], rules: V2_D20, battlefield: field, traitRegistry: registry, seed: 'panic', rng: { seed: 'panic', next: () => 0, d: () => roll } }); battle.start();
    expect(a.status).toBe('routing'); expect(battle.active?.id).not.toBe('a');
    const snap = structuredClone(battle.toSnapshot()); expect(SmallBattle.fromSnapshot(snap).byId('a')).toEqual(a);
    roll = 20; for (let n = 0; n < 6 && a.status === 'routing'; n++) battle.endTurn(); expect(a.status).toBe('ready');
    roll = 1; for (let n = 0; n < 9 && !battle.isOver(); n++) battle.endTurn(); expect(a.status).toBe('ready');
  });
  it('三次重整失败后离场，不能无限占用轮次或恢复伤亡', () => {
    const a = unit('a'), backup = unit('backup'), source = unit('source', 'enemy'); a.morale = 10;
    const battle = new MassBattle({ combatants: [a, backup, source], rules: V2_TW, traitRegistry: registry, seed: 'rout', rng: { seed: 'rout', next: () => 0, d: () => 1 } }); battle.start();
    for (let n = 0; n < 4; n++) { for (const u of battle.combatants.filter((u) => u.status === 'ready')) battle.issue({ unitId: u.id, type: 'hold' }); battle.resolveRound(battle.round); }
    expect(a.status).toBe('fled'); expect(a.moraleState!.attempts).toBe(3); expect(a.hp).toBe(500);
  });
  it('永久/祝福同源恐怖去重，不溃免惊退，顽固提高实际抵抗结果，到期或撤销即时失效', () => {
    for (const counter of ['none', 'stubborn', 'steadfast']) {
      const a = unit('a'), reserve = unit('reserve'), source = unit('source', 'enemy'); if (counter !== 'none') a.traits = [counter]; source.traits = ['terror'];
      grantTraitSource(source, { id: 'same', name: '神威', kind: 'blessing', traitIds: ['terror'], duration: { kind: 'rounds', count: 1 } });
      const battle = new MassBattle({ combatants: [a, reserve, source], rules: V2_TW, traitRegistry: registry, seed: 'resist', rng: { seed: 'resist', next: () => 0, d: () => 8 } }); battle.start();
      for (const u of battle.combatants) battle.issue({ unitId: u.id, type: 'hold' }); battle.resolveRound(1);
      expect(a.status).toBe(counter === 'none' ? 'routing' : 'ready'); expect(source.traitSources![0]!.remaining).toBe(0);
      expect(a.moraleState?.terrorSeen ?? []).toHaveLength(counter === 'steadfast' ? 0 : 1);
      source.traits = []; expect(moraleRisk(battle.observationContext(), a, 25).fear).toBe(0);
      grantTraitSource(source, { id: 'new', name: '神威', kind: 'blessing', traitIds: ['terror'], duration: { kind: 'permanent' } }); revokeTraitSource(source, 'new');
      expect(moraleRisk(battle.observationContext(), a, 25).fear).toBe(0);
    }
  });
  it('随队宿主暂时溃退不杀乘员，重整后恢复指挥，飞行惊退不额外坠落', () => {
    let roll = 1; const host = unit('a'), officer = unit('officer'), reserve = unit('reserve'), source = unit('source', 'enemy');
    officer.scale = 'hero'; source.traits = ['terror']; host.traits = ['flying']; host.body = 'vehicle';
    setFormation(reserve, FORMATION_NODES.find((n) => n.id === 'ally:中军:reserve')!);
    const battle = new MassBattle({ combatants: [host, officer, reserve, source], rules: V2_TW, traitRegistry: registry, commanderId: officer.id, seed: 'host-rout', rng: { seed: 'host-rout', next: () => 0, d: () => roll } }); battle.start();
    expect(battle.attached.get(host.id)).toBe(officer.id);
    const next = () => { for (const u of battle.combatants.filter((u) => u.status === 'ready' && !battle.isAttached(u.id))) battle.issue({ unitId: u.id, type: 'hold' }); battle.resolveRound(battle.round); };
    next(); expect(host.status).toBe('routing'); expect(officer.hp).toBe(500); expect(officer.status).toBe('ready'); expect(host.airborne).toBe(true); expect(host.hp).toBe(500); expect(battle.manualCommandAllowed).toBe(false);
    roll = 20; next(); expect(host.status).toBe('ready'); expect(battle.manualCommandAllowed).toBe(true); expect(officer.hp).toBe(500);
  });
  it('已经消耗的重整机会不能因阵位拥挤而刷新，成功检定仍需合法落位', () => {
    let roll = 1; const a = unit('a'), backup = unit('backup'), source = unit('source', 'enemy'); source.traits = ['terror'];
    setFormation(backup, FORMATION_NODES.find((n) => n.id === 'ally:右翼:reserve')!);
    const battle = new MassBattle({ combatants: [a, backup, source], rules: V2_TW, traitRegistry: registry, seed: 'blocked-rally', rng: { seed: 'blocked-rally', next: () => 0, d: () => roll } }); battle.start();
    const next = () => { for (const u of battle.combatants.filter((u) => u.status === 'ready')) battle.issue({ unitId: u.id, type: 'hold' }); battle.resolveRound(battle.round); }; next();
    expect(a.status).toBe('routing');
    for (const node of FORMATION_NODES.filter((n) => ['ally:中军:front', 'ally:中军:rear', 'ally:中军:reserve', 'ally:左翼:rear', 'ally:右翼:rear'].includes(n.id))) for (let i = 0; i < 3; i++) { const u = unit('block-' + node.id + i); setFormation(u, node); battle.combatants.push(u); }
    roll = 20; next(); expect(a.status).toBe('routing'); expect(a.moraleState!.attempts).toBe(1);
    next(); expect(a.status).toBe('routing'); expect(a.moraleState!.attempts).toBe(2);
    next(); expect(a.status).toBe('fled'); expect(a.moraleState!.attempts).toBe(3); expect(a.hp).toBe(500);
  });
  it('同阶段恐怖来源先后溃退不改变另一单位的惊退结果', () => {
    const run = (reverse: boolean) => {
      const a = unit('a'), backup = unit('backup'), source = unit('source', 'enemy'), enemy = unit('enemy', 'enemy'); source.traits = ['terror']; source.morale = 10;
      const units = [a, backup, source, enemy]; const battle = new MassBattle({ combatants: reverse ? units.reverse() : units, rules: V2_TW, traitRegistry: registry, seed: 'simultaneous-rout', rng: { seed: 'simultaneous-rout', next: () => 0, d: () => 1 } }); battle.start();
      for (const u of units) battle.issue({ unitId: u.id, type: 'hold' }); battle.resolveRound(1); return [a.status, source.status, a.moraleState];
    };
    expect(run(false).slice(0, 2)).toEqual(['routing', 'routing']); expect(run(false)).toEqual(run(true));
  });
  it('重开后保持同一重整随机结果和次数，坏触发记录拒绝；第三次溃退彻底退出', () => {
    const a = unit('a'), backup = unit('backup'), source = unit('source', 'enemy'); source.traits = ['terror'];
    const rng = new SeededRng('saved-panic'); rng.setState(0);
    const battle = new MassBattle({ combatants: [a, backup, source], rules: V2_TW, traitRegistry: registry, seed: 'saved-panic', rng }); battle.start();
    const next = (b: MassBattle) => { for (const u of b.combatants.filter((u) => u.status === 'ready')) b.issue({ unitId: u.id, type: 'hold' }); b.resolveRound(b.round); }; next(battle); expect(a.status).toBe('routing');
    const snap = structuredClone(battle.toSnapshot()), restored = MassBattle.fromSnapshot(structuredClone(snap)); next(battle); next(restored); expect(restored.toSnapshot()).toEqual(battle.toSnapshot());
    const bad = structuredClone(snap); (bad.combatants as Combatant[])[0]!.moraleState!.attempts = -1; expect(() => MassBattle.fromSnapshot(bad)).toThrow(/重整/);
    for (let n = 0; n < 3; n++) {
      a.status = 'ready'; a.morale = 10; if (a.moraleState) delete a.moraleState.ralliedRound;
      next(battle); if (a.moraleState!.routs === 3) break;
    }
    expect(a.moraleState!.routs).toBe(3); expect(a.status).toBe('fled');
  });
  it('两模式AI会对溃退友军使用士气支援，真实扣费并改善重整结果', () => {
    for (const mode of ['small', 'mass']) {
      const medic = unit('medic'), a = unit('a'), enemy = unit('enemy', 'enemy'); medic.base.spd = 100;
      delete medic.weapon; medic.abilities = [{ id: 'rally', name: '振作', target: 'ally', range: { min: 0, max: 3, metric: 'grid', allowEngaged: true }, cost: { resource: 'SP', amount: 2 }, effects: [{ op: 'morale', amount: 30 }] }]; medic.preparedAbilityIds = ['rally']; medic.resources.SP = 2;
      const battle = mode === 'small' ? new SmallBattle({ combatants: [medic, a, enemy], rules: V2_D20, battlefield: standardField(), traitRegistry: registry, seed: 'rally-ai', rng: { seed: 'rally-ai', next: () => 0, d: () => 20 } }) : new MassBattle({ combatants: [medic, a, enemy], rules: V2_TW, traitRegistry: registry, seed: 'rally-ai', rng: { seed: 'rally-ai', next: () => 0, d: () => 20 } }); battle.start();
      a.status = 'routing'; a.morale = 10; a.moraleState = { terrorSeen: [], routs: 1, attempts: 0, routedRound: 0, cause: 'morale' };
      if (battle instanceof SmallBattle) {
        medic.pos = 45; a.pos = 44; enemy.pos = 17; battle.turnOrder = ['medic', 'a', 'enemy']; battle.turnIndex = 0;
        const preview = battle.getActionOptions(medic.id).find((o) => o.id === 'rally')!.targets!.find((t) => t.targetId === a.id)!.preview!; expect(preview.moraleAfter).toBe(40); expect(preview.rallyChance).toBeGreaterThan(0);
        battle.autoAction(medic.id);
      } else {
        battle.issue({ unitId: enemy.id, type: 'hold' }); battle.autoOrders('ally'); expect(battle.orders.get(medic.id)).toMatchObject({ type: 'ability', targetId: a.id }); battle.resolveRound(1);
      }
      expect(a.status).toBe('ready'); expect(a.morale).toBeGreaterThanOrEqual(40); expect(medic.resources.SP).toBe(0); expect(a.hp).toBe(500);
    }
  });
  it('同时施加惊惧与士气降低的技能，预览计入完整组合而非只算数值部分', () => {
    for (const mode of ['small', 'mass']) {
      const actor = unit('actor'), target = unit('target', 'enemy'); target.morale = 70; actor.base.spd = 100;
      actor.abilities = [{ id: 'dread', name: '震慑', target: 'enemy', range: { min: 0, max: 3, metric: 'grid', allowEngaged: true }, effects: [{ op: 'condition', conditionId: 'fearful', dur: 2 }, { op: 'morale', amount: -5 }] }]; actor.preparedAbilityIds = ['dread'];
      const battle = mode === 'small' ? new SmallBattle({ combatants: [actor, target], rules: V2_D20, battlefield: standardField(), traitRegistry: registry, seed: 'complete-morale' }) : new MassBattle({ combatants: [actor, target], rules: V2_TW, traitRegistry: registry, seed: 'complete-morale' }); battle.start();
      if (battle instanceof SmallBattle) {
        actor.pos = 45; target.pos = 38;
        const preview = battle.getActionOptions(actor.id).find((o) => o.id === 'dread')!.targets!.find((t) => t.targetId === target.id)!.preview!;
        expect(preview.moraleAfter).toBe(55); expect(battle.useAbility(actor.id, 'dread', target.id).ok).toBe(true);
      } else {
        expect(battle.orderPreview({ unitId: actor.id, type: 'ability', abilityId: 'dread', targetId: target.id }).moraleAfter).toBe(55);
        battle.useAbility(actor.id, 'dread', target.id); battle.issue({ unitId: target.id, type: 'hold' }); battle.resolveRound(1);
      }
      expect(moraleProfile(battle.observationContext(), target).effective).toBe(55);
    }
  });
});
