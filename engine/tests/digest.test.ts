/**
 * 回合纪要（roundDigest，中等详细摘要）单元测试：
 * 命中/未中压缩、无骰面明细、士气/溃退事件保留、lastRounds 截取。
 */
import { describe, it, expect } from 'vitest';
import { MassBattle } from '../src/mass/battle';
import { SmallBattle } from '../src/small/battle';
import { generateUnit } from '../src/gen/generator';
import { traitRegistry } from '../src/data/traits';
import { roundDigest } from '../src/inject/format';

const reg = traitRegistry();

const gen = (over: Partial<Parameters<typeof generateUnit>[0]> & Pick<Parameters<typeof generateUnit>[0], 'name' | 'side' | 'scale'>) =>
  generateUnit({ level: 3, traits: [], era: 'medieval', ...over } as Parameters<typeof generateUnit>[0], { seed: 'dig-t', noVariance: true, registry: reg }).unit;

function fightRounds(rounds: number): MassBattle {
  const a = gen({ name: '步一', scale: 'company', archetype: 'infantry', side: 'ally' });
  const b = gen({ name: '敌一', scale: 'company', archetype: 'infantry', side: 'enemy' });
  const mb = new MassBattle({ combatants: [a, b], seed: 'digest', traitRegistry: reg });
  mb.start();
  for (let i = 0; i < rounds; i++) {
    mb.autoOrders('ally');
    mb.autoOrders('enemy');
    mb.resolveRound();
  }
  return mb;
}

describe('回合纪要（roundDigest）', () => {
  it('按回合分组：命中/未中压缩成一行，不带骰面与伤害构成', () => {
    const mb = fightRounds(2);
    const d = roundDigest(mb, 'medieval', reg, { wholeBattle: true });
    expect(d).toContain('【战阵·回合纪要·共');
    expect(d).toContain('【第1回合】');
    const atkLines = d.split('\n').filter((l) => /→.*(命中|未中)/.test(l));
    expect(atkLines.length).toBeGreaterThan(0);
    for (const l of atkLines) {
      expect(l).not.toContain('d20['); // 骰面留给结算卡
      expect(l).not.toContain('伤害 '); // 伤害构成明细不进纪要
    }
    // 叙述约束与其他摘要同源
    expect(d).toContain('【叙述任务】');
    expect(d).not.toContain('第二人称');
  });

  it('lastRounds 只取最近回合；装填等无 resolution 的 attack 条目不进纪要', () => {
    const mb = fightRounds(3);
    const all = roundDigest(mb, 'medieval', reg, { wholeBattle: true });
    expect(all).toContain('【第3回合】');
    const last = roundDigest(mb, 'medieval', reg, { lastRounds: 1 });
    expect(last).toContain('【第3回合】');
    expect(last).not.toContain('【第1回合】');
    expect(last).toContain('【战阵·回合纪要·最近1回合】');
  });

  it('无交战事件返回空串（面板按钮据此提示）', () => {
    const a = gen({ name: '步一', scale: 'company', archetype: 'infantry', side: 'ally' });
    const b = gen({ name: '敌一', scale: 'company', archetype: 'infantry', side: 'enemy' });
    const mb = new MassBattle({ combatants: [a, b], seed: 'digest-empty', traitRegistry: reg });
    mb.start(); // 只布阵不打：纪要应为空
    expect(roundDigest(mb, 'medieval', reg, { wholeBattle: true })).toBe('');
  });

  it('小规模纪要保留移动与技能动作', () => {
    const ally = gen({ name: '游侠', scale: 'hero', archetype: 'infantry', side: 'ally' });
    const enemy = gen({ name: '敌兵', scale: 'hero', archetype: 'infantry', side: 'enemy' });
    ally.pos = 0;
    enemy.pos = 3;
    const ability = {
      id: 'digest-guard', name: '架盾', target: 'self' as const,
      effects: [{ op: 'condition' as const, conditionId: 'encouraged', dur: 1 }],
    };
    ally.abilities.push(ability);
    ally.abilityState.push({ abilityId: ability.id, cdLeft: 0, used: 0 });
    const battle = new SmallBattle({ combatants: [ally, enemy], seed: 'small-digest', traitRegistry: reg });
    battle.start();
    battle.move(ally.id, 'advance', { bypassTurn: true });
    battle.useAbility(ally.id, ability.id, undefined, { bypassTurn: true });

    const digest = roundDigest(battle, 'medieval', reg, { wholeBattle: true });
    expect(digest).toContain('逼近');
    expect(digest).toContain('架盾');
    expect(digest).not.toContain('第二人称');
  });
});
