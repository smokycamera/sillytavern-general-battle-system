import { describe, expect, it } from 'vitest';
import { generateUnit, SmallBattle, V32_OVERFLOW_D20, standardField, entrench, grantTraitSource, expireTraitSources,
  compileSkill, compileItem, attachCarriedItems, parseSkillMechanism, skillMechanismId, MassBattle, V32_OVERFLOW_TW, type Combatant } from '../../engine/src/index.js';
import { placeZone } from '../../engine/src/area-effects.js';
import { renderTacticalBattle } from './tactical-view.js';
import { renderFormationBattle } from './formation-view.js';

function fixture(prepare: (u: Combatant) => Combatant = u => u) {
  const units = (['ally', 'enemy'] as const).map((side, i) => {
    const u = generateUnit({ name: side, side, scale: 'hero', level: 3, hpMax: 300, rulesVersion: 'v2',
      weaponClass: 'bow', weaponLevel: 3, traits: [] }, { seed: side, noVariance: true }).unit;
    u.id = side; u.pos = i ? 10 : 45; return u;
  });
  units[0] = prepare(units[0]!);
  const f = standardField(); f.tiles.fill('open');
  const b = new SmallBattle({ combatants: units, battlefield: f, rules: V32_OVERFLOW_D20, seed: 'field-effects' }); b.start();
  return { b, a: b.byId('ally'), e: b.byId('enemy') };
}
describe('持续区域与技能工事地图显示', () => {
  it('会战阵位也显示区域图案、期限和据守工事', () => {
    const units = (['ally', 'enemy'] as const).map(side => {
      const u = generateUnit({ name: side, side, scale: 'company', level: 3, hpMax: 10, rulesVersion: 'v2',
        weaponClass: 'rifle', traits: ['fortification'] }, { seed: side, noVariance: true }).unit;
      u.id = side; u.tags = ['zone:中军', 'rank:front']; return u;
    });
    const b = new MassBattle({ combatants: units, rules: V32_OVERFLOW_TW, seed: 'mass-field-effects' }); b.start();
    const a = b.byId('ally'); entrench(a, 'mass');
    placeZone(b.observationContext(), a, a, { op: 'zone', kind: 'trap', power: 3, dur: 4, radius: 0 }, 1, 'trap');
    const html = renderFormationBattle(b, {}, {}, false, () => '', () => '');
    expect(html).toContain('field-effect effect-trap'); expect(html).toContain('陷阱 4轮');
    expect(html).toContain('field-effect effect-works'); expect(html).toContain('工事·据守');
  });
  it.each(['skill', 'item'] as const)('%s实际施放的陷阱与工事直接出现在地图，读档后仍可见', via => {
    for (const text of ['陷阱', 'buff工事']) {
      const mechanism = skillMechanismId(parseSkillMechanism(text)!);
      const { b, a } = fixture(u => {
        if (via === 'item') return attachCarriedItems(u, [{ id: 'tool', name: text, quantity: 1, revision: 1,
          mechanics: compileItem({ kind: 'item', form: 'single', power: 3, active: mechanism }, { id: 'tool', name: text, seed: 'tool' }) }]);
        const ability = compileSkill({ id: mechanism }, 3, u.id); u.abilities = [ability]; u.preparedAbilityIds = [ability.id]; return u;
      });
      b.turnOrder = ['ally', 'enemy']; b.turnIndex = 0; a.resources.SP = 100;
      const ability = a.abilities.find(s => via === 'item' ? !!s.itemSourceId : !s.itemSourceId)!;
      expect(b.useAbility(a.id, ability.id, text === '陷阱' ? 'cell:44' : a.id).ok).toBe(true);
      const marker = 'field-effect effect-' + (text === '陷阱' ? 'trap' : 'works');
      expect(renderTacticalBattle(b, { mode: 'inspect' })).toContain(marker);
      const restored = SmallBattle.fromSnapshot(JSON.parse(JSON.stringify(b.toSnapshot())));
      expect(renderTacticalBattle(restored, { mode: 'inspect' })).toContain(marker);
      if (via === 'item') expect(a.resources['item:tool']).toBe(0);
    }
  });
  it('实际放置的五类区域都有独立图案、覆盖格和期限，失效后移除', () => {
    const { b, a } = fixture();
    for (const kind of ['trap', 'fire', 'poison', 'smoke', 'healing'] as const) {
      placeZone(b.observationContext(), a, a, { op: 'zone', kind, power: 3, dur: 4, radius: 1 }, 1, 'effect-' + kind);
    }
    const html = renderTacticalBattle(b, { mode: 'inspect', inspectedCell: 45 });
    for (const kind of ['trap', 'fire', 'poison', 'smoke', 'healing']) expect(html).toContain('field-effect effect-' + kind);
    expect(html).toContain('陷阱 4轮'); expect(html).toContain('陷阱 L3 · 剩余4轮');
    for (const z of a.battleZones!) z.remaining = 0;
    expect(renderTacticalBattle(b, { mode: 'inspect' })).not.toContain('field-effect effect-');
  });
  it('自己的远处陷阱可见，敌方隐藏陷阱不泄露', () => {
    const { b, a, e } = fixture();
    a.pos = 59; e.pos = 3;
    placeZone(b.observationContext(), a, e, { op: 'zone', kind: 'trap', power: 3, dur: 4, radius: 0 }, 1, 'ours');
    placeZone(b.observationContext(), e, a, { op: 'zone', kind: 'trap', power: 3, dur: 9, radius: 0 }, 1, 'hidden');
    const html = renderTacticalBattle(b, { mode: 'inspect', inspectedCell: e.pos });
    expect(html).toContain('陷阱 4轮'); expect(html).not.toContain('陷阱 9轮'); expect(html).not.toContain('剩余9轮');
  });
  it('外部来源构筑的工事显示在实际据守格；移动后标为空置，到期后移除', () => {
    const { b, a } = fixture();
    grantTraitSource(a, { id: 'works-skill', name: '构筑阵地', kind: 'blessing', battleOnly: true,
      traitIds: ['fortification'], traitLevels: { fortification: 3 }, duration: { kind: 'rounds', count: 2 } });
    expect(entrench(a, 'small')).toBe(true);
    let html = renderTacticalBattle(b, { mode: 'inspect', inspectedCell: 45 });
    expect(html).toContain('field-effect effect-works'); expect(html).toContain('工事·据守');
    a.pos = 44; html = renderTacticalBattle(b, { mode: 'inspect', inspectedCell: 45 });
    expect(html).toContain('工事·空置'); expect(html).toContain('原单位回到此处可据守');
    expireTraitSources(a, 'rounds'); expireTraitSources(a, 'rounds');
    expect(renderTacticalBattle(b, { mode: 'inspect' })).not.toContain('field-effect effect-works');
  });
});
