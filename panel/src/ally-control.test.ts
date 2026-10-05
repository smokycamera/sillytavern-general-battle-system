import { describe, expect, it } from 'vitest';
import { SmallBattle } from '../../engine/src/index.js';
import { tacticalFixture } from '../../scripts/p4-tactical-fixture.js';
import { aiActsFor, aiControlledAllyIds, resetNonProtagonistAi, setUnitAi } from './ally-control.js';
import { renderTacticalBattle } from './tactical-view.js';

describe('AI托管', () => {
  // 夹具：我方 a（主控）、c；敌方 b、d、e。
  const manual = { nonProtagonist: false, protagonistId: 'a' }, nonProtagonist = { nonProtagonist: true, protagonistId: 'a' };

  it('单位单独设置优先于「非主控」，与默认相同时不留记录；敌方始终由AI', () => {
    const { b } = tacticalFixture();
    expect(aiActsFor(b, b.byId('b'), manual)).toBe(true);
    expect(aiActsFor(b, b.byId('c'), manual)).toBe(false);
    expect(aiActsFor(b, b.byId('c'), nonProtagonist)).toBe(true);
    expect(aiActsFor(b, b.byId('a'), nonProtagonist)).toBe(false);
    expect(aiActsFor(b, b.byId('a'), { nonProtagonist: true })).toBe(true); // 未设主控时「非主控」即全部我方

    setUnitAi(b, 'a', true, nonProtagonist); setUnitAi(b, 'c', false, nonProtagonist);
    expect([...aiControlledAllyIds(b, nonProtagonist)]).toEqual(['a']);
    setUnitAi(b, 'c', true, nonProtagonist);
    expect([...b.allyAiControl]).toEqual([['a', true]]);

    b.allyAiControl.set('c', false);
    resetNonProtagonistAi(b, manual);
    expect([...b.allyAiControl]).toEqual([['a', true]]); // 主控的单独设置保留
    b.byId('a').status = 'dead';
    expect(aiControlledAllyIds(b, manual).size).toBe(0);
  });

  it('托管设置随战斗快照保存；没有设置时快照不变', () => {
    const { b } = tacticalFixture();
    expect(b.toSnapshot()).not.toHaveProperty('allyAiControl');
    b.allyAiControl.set('c', true).set('a', false);
    const snap = structuredClone(b.toSnapshot());
    expect([...SmallBattle.fromSnapshot(snap).allyAiControl]).toEqual([['c', true], ['a', false]]);
    expect([...SmallBattle.fromSnapshot({ ...snap, allyAiControl: [['c', 'yes'], 3, ['a', true]] }).allyAiControl]).toEqual([['a', true]]);
  });

  it('战术面板只有一组AI控件，托管单位在地图上标AI', () => {
    const { b } = tacticalFixture();
    const html = renderTacticalBattle(b, { mode: 'weapon', selectedId: 'c' }, { aiUnitIds: new Set(['c']), nonProtagonist: false, fullAuto: false });
    const count = (pattern: RegExp) => html.match(pattern)?.length ?? 0;
    expect(count(/data-action="grid-auto"/g)).toBe(1);
    expect(count(/data-role="ally-ai"/g)).toBe(1);
    expect(count(/data-role="auto-turn"/g)).toBe(1);
    expect(count(/data-role="full-auto-battle"/g)).toBe(2); // 指挥栏一处，手机底栏快捷一处
    expect(html).not.toContain('移交当前单位');
    const group = /<div class="command-finish">[\s\S]*?<div class="ai-takeover"[\s\S]*?<\/div><\/div>/.exec(html)?.[0] ?? '';
    for (const role of ['ally-ai', 'auto-turn', 'full-auto-battle']) expect(group).toContain(`data-role="${role}"`);
    expect(group).toMatch(/data-role="ally-ai" data-id="c" checked/);
    expect(html).toContain('我方单位 · AI托管中');
    const cell = (pos: number) => new RegExp(`data-cell="${pos}"[^>]*>[\\s\\S]*?</button>`).exec(html)?.[0] ?? '';
    expect(cell(b.byId('c').pos!)).toContain('<i>AI</i>');
    expect(cell(b.byId('a').pos!)).not.toContain('<i>AI</i>');
  });
});
