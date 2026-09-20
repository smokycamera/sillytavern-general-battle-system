import { describe, expect, it } from 'vitest';
import { SmallBattle, SeededRng, traitRegistry } from '../../engine/src/index.js';
import { tacticalFixture } from '../../scripts/p4-tactical-fixture.js';
import { renderRoundFeedback } from './round-feedback.js';
const registry = traitRegistry();
function fresh(configure: (b: SmallBattle) => void = () => {}) {
  const { b } = tacticalFixture(); configure(b);
  const snap = structuredClone(b.toSnapshot()); delete snap.feedback;
  return SmallBattle.fromSnapshot(snap, { traitRegistry: registry });
}

describe('真实回合变化摘要', () => {
  it('范围副目标损失进入摘要，跨轮与重开保留；查询不改事实，旧快照不虚构历史', () => {
    const b = fresh(), a = b.byId('a'), target = b.byId('d'), beforeHp = target.hp;
    (b.rng as SeededRng).setState(1);
    const fire = a.abilities.find((a) => a.definitionId === 'bp-firestorm')!;
    const result = b.useAbility('a', fire.id, 'b');
    expect(result.ok).toBe(true); expect(target.hp).toBeLessThan(beforeHp);
    expect(b.log.at(-1)?.resolution?.defenderId).toBe('b');
    expect(b.roundFeedback()[0]?.changes.find((c) => c.id === 'd')?.lost).toBe(beforeHp - target.hp);
    b.endTurn();
    expect(b.activationFeedback()?.actorName).toBe('前锋术士');
    expect(b.activationFeedback()?.changes.find((c) => c.id === 'a')?.resources.SP?.delta).toBe(-fire.cost!.amount);
    for (let i = 0; i < 4; i++) b.endTurn();
    expect(b.round).toBe(2);
    const previous = b.roundFeedback().find((r) => r.round === 1)!;
    expect(b.controlRounds.enemy).toBe(0); // 首次占领当轮不累计，尚无进度变化摘要。
    expect(previous.changes.find((c) => c.id === 'd')?.lost).toBe(beforeHp - target.hp);
    const snapshot = JSON.stringify(b.toSnapshot());
    expect(renderRoundFeedback(b)).toContain('守点步兵');
    renderRoundFeedback(b); expect(JSON.stringify(b.toSnapshot())).toBe(snapshot);
    const restored = SmallBattle.fromSnapshot(JSON.parse(snapshot), { traitRegistry: registry });
    expect(restored.roundFeedback()).toEqual(b.roundFeedback());
    expect(restored.toSnapshot().rngState).toBe(b.toSnapshot().rngState);
    const old = JSON.parse(snapshot); delete old.feedback;
    expect(SmallBattle.fromSnapshot(old, { traitRegistry: registry }).roundFeedback()[0]?.changes).toEqual([]);
  });

  it('实际再生、状态和祝福到期被记录，敌军失去观测期间的战损不泄露', () => {
    const b = fresh((b) => {
      b.byId('a').traits.push('regen');
      b.byId('b').suppression = 1;
      b.byId('c').traitSources = [{ id: 'gift', name: '短暂行军祝福', kind: 'blessing', traitIds: ['fast'], duration: { kind: 'rounds', count: 1 }, remaining: 1 }];
    });
    const hp = b.byId('a').hp;
    b.byId('e').hp = 1;
    b.endTurn();
    expect(b.byId('a').hp).toBeGreaterThan(hp);
    expect(b.roundFeedback()[0]?.changes.find((c) => c.id === 'a')?.recovered).toBe(b.byId('a').hp - hp);
    expect(JSON.stringify(b.roundFeedback())).not.toContain('未发现的伏兵');
    b.byId('e').pos = 46;
    b.endTurn();
    expect(b.roundFeedback()[0]?.changes.find((c) => c.id === 'e')).toMatchObject({ sight: 'found', lost: 0 });
    expect(b.roundFeedback()[0]?.changes.find((c) => c.id === 'b')?.ended).toContain('受压制');
    for (let i = 0; i < 3; i++) b.endTurn();
    expect(b.roundFeedback().find((r) => r.round === 1)?.changes.find((c) => c.id === 'c')?.ended).toContain('短暂行军祝福');
    const corrupted = structuredClone(b.toSnapshot()); corrupted.feedback = { version: 2, current: { round: 2, changes: [null] } };
    const restored = SmallBattle.fromSnapshot(corrupted, { traitRegistry: registry });
    expect(restored.byId('a').hp).toBe(b.byId('a').hp);
    expect(restored.roundFeedback()[0]?.changes).toEqual([]);
  });
});
