import { describe, expect, it } from 'vitest';
import { generateUnit, traitRegistry, applyXp, xpProgress, curveAt, XP_LEVEL_COSTS, XP_THRESHOLDS, MAX_TRAINING_LEVEL } from '../src/index.js';
import { unitRecordFromCombatant, materializeUnitRecord } from '../../panel/src/unit-state.js';
const registry = traitRegistry();
const unit = (level = 1) => generateUnit({ name: '经验曲线', side: 'ally', rulesVersion: 'v2', scale: 'hero', level, traits: [], hpMax: 500, hp: 200, armorTier: 0 }, { seed: 'xp-curve', registry, noVariance: true }).unit;

describe('升级曲线与旧档进度', () => {
  it('中后期同级击杀成本不再倒挂；达到每级边界恰好升级，满级无幽灵门槛', () => {
    const u = unit(), equipment = structuredClone(u.weapon); let previousEffort = 0;
    for (let level = 1; level < MAX_TRAINING_LEVEL; level++) {
      const progress = xpProgress(u)!, effort = progress.next / curveAt(level).xp;
      expect(effort).toBeGreaterThan(previousEffort); previousEffort = effort;
      expect(applyXp(u, progress.next - .25, registry).levelsGained).toBe(0);
      expect(applyXp(u, .25, registry)).toMatchObject({ levelsGained: 1, fromLevel: level, toLevel: level + 1 });
    }
    expect(XP_LEVEL_COSTS[8]! / curveAt(9).xp).toBe(28);
    expect(u.xp).toBe(XP_THRESHOLDS.at(-1)); expect(u.level).toBe(10); expect(xpProgress(u)).toBeNull();
    expect(u.weapon).toEqual(equipment); expect(u.hp).toBe(200);
    applyXp(u, 10, registry); expect(u.level).toBe(10);
  });
  it('旧训练5/9的半级进度及累计XP保留，读取不改状态，档案往返不重复换算', () => {
    for (const [level, xp] of [[5, 10250], [9, 56000]]) {
      const old = unit(level!); old.xp = xp;
      const original = JSON.stringify(old), expected = XP_LEVEL_COSTS[level! - 1]!;
      expect(xpProgress(old)).toEqual({ current: expected / 2, next: expected }); expect(JSON.stringify(old)).toBe(original);
      expect(applyXp(old, 0, registry).levelsGained).toBe(0); expect(old.xp).toBe(xp);
      let restored = old;
      for (let i = 0; i < 3; i++) restored = materializeUnitRecord(JSON.parse(JSON.stringify(unitRecordFromCombatant(restored))), registry);
      expect(restored.xp).toBe(xp); expect(restored.level).toBe(level);
      expect(xpProgress(restored)).toEqual({ current: expected / 2, next: expected });
      expect(applyXp(restored, expected / 2 - .1, registry).levelsGained).toBe(0);
      expect(applyXp(restored, .1, registry).toLevel).toBe(level! + 1);
    }
  });
  it('直接建档高训练单位只支付本级成本；连续多级升级保留溢出和小数', () => {
    const veteran = unit(7);
    expect(xpProgress(veteran)).toEqual({ current: 0, next: 21600 });
    expect(applyXp(veteran, 21600, registry).toLevel).toBe(8);
    const recruit = unit();
    expect(applyXp(recruit, 1000.125, registry).toLevel).toBe(3);
    expect(xpProgress(recruit)).toEqual({ current: .125, next: 1600 }); expect(recruit.xp).toBe(1000.125);
    const restored = materializeUnitRecord(unitRecordFromCombatant(recruit), registry, { forceRegenerate: true });
    expect(xpProgress(restored)).toEqual(xpProgress(recruit));
  });
});
