import { describe, expect, it } from 'vitest';
import { SmallBattle, prepareTraitLevelModel, V17_OVERFLOW_D20 } from '../../engine/src/index.js';
import { tacticalFixture } from '../../scripts/p4-tactical-fixture.js';
import { aiActsFor, aiControlledAllyIds, resetAllyAi, setUnitAi } from './ally-control.js';
import { renderTacticalBattle } from './tactical-view.js';

describe('AI托管', () => {
  // 夹具：我方 a（主控）、c；敌方 b、d、e。
  const manual = { allAllies: false, protagonistId: 'a' }, allAllies = { allAllies: true, protagonistId: 'a' };

  it('魅惑与混乱在本次激活强制使用受约束AI，到期恢复原托管设置',()=>{
    const {b}=tacticalFixture(),a=b.byId('a');prepareTraitLevelModel(a,V17_OVERFLOW_D20);
    b.allyAiControl.set(a.id,false);
    for(const id of ['charmed','confused']) {
      a.conditions=[{id,dur:1,sourceId:'b',controlPending:true}];expect(aiActsFor(b,a,manual)).toBe(false);
      delete a.conditions[0]!.controlPending;expect(aiActsFor(b,a,manual)).toBe(true);
    }
    a.conditions=[];expect(aiActsFor(b,a,manual)).toBe(false);expect(b.allyAiControl.get(a.id)).toBe(false);
  });

  it('「除主控」保留绑定主控手动，单位单独设置可覆盖，敌方始终由AI', () => {
    const { b } = tacticalFixture();
    expect(aiActsFor(b, b.byId('b'), manual)).toBe(true);
    expect(aiActsFor(b, b.byId('c'), manual)).toBe(false);
    b.byId('a').moraleLocked = true;
    expect(aiActsFor(b, b.byId('c'), allAllies)).toBe(true);
    expect(aiActsFor(b, b.byId('a'), allAllies)).toBe(false);
    expect([...aiControlledAllyIds(b, allAllies)]).toEqual(['c']);

    setUnitAi(b, 'a', true, allAllies); setUnitAi(b, 'c', false, allAllies);
    expect([...aiControlledAllyIds(b, allAllies)]).toEqual(['a']);
    setUnitAi(b, 'c', true, allAllies);
    expect([...b.allyAiControl]).toEqual([['a', true]]);
    setUnitAi(b, 'a', false, allAllies);
    expect([...b.allyAiControl]).toEqual([]);

    b.allyAiControl.set('c', false);
    b.allyAiControl.set('a', true);
    resetAllyAi(b);
    expect([...b.allyAiControl]).toEqual([]);
    expect(aiActsFor(b, b.byId('a'), allAllies)).toBe(false);
    // 依赖绑定 ID，士气锁不是主控标识；未绑定主控则托管全部我方。
    expect(aiActsFor(b, b.byId('a'), { allAllies: true })).toBe(true);
    expect(aiActsFor(b, b.byId('a'), { allAllies: true, protagonistId: 'c' })).toBe(true);
    expect(aiActsFor(b, b.byId('c'), { allAllies: true, protagonistId: 'c' })).toBe(false);
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
    const html = renderTacticalBattle(b, { mode: 'weapon', selectedId: 'c' }, { aiUnitIds: new Set(['c']), allAllies: false, fullAuto: false });
    const count = (pattern: RegExp) => html.match(pattern)?.length ?? 0;
    expect(count(/data-action="grid-auto"/g)).toBe(1);
    expect(count(/data-role="ally-ai"/g)).toBe(1);
    expect(count(/data-role="auto-turn"/g)).toBe(1);
    expect(count(/data-role="full-auto-battle"/g)).toBe(2); // 指挥栏一处，手机底栏快捷一处
    expect(html).not.toContain('移交当前单位');
    expect(html).toContain('>除主控</label>');
    expect(html).not.toContain('>我方</label>');
    const group = /<div class="command-finish">[\s\S]*?<div class="ai-takeover"[\s\S]*?<\/div><\/div>/.exec(html)?.[0] ?? '';
    for (const role of ['ally-ai', 'auto-turn', 'full-auto-battle']) expect(group).toContain(`data-role="${role}"`);
    expect(group).toMatch(/data-role="ally-ai" data-id="c" checked/);
    expect(html).toContain('我方单位 · AI托管中');
    const cell = (pos: number) => new RegExp(`data-cell="${pos}"[^>]*>[\\s\\S]*?</button>`).exec(html)?.[0] ?? '';
    expect(cell(b.byId('c').pos!)).toContain('<i>AI</i>');
    expect(cell(b.byId('a').pos!)).not.toContain('<i>AI</i>');
  });
});
