import { describe, expect, it } from 'vitest';
import { generateUnit, SmallBattle, standardField, traitRegistry, V2_D20, smallStateSummary, battleIntroSummary } from '../../engine/src/index.js';
import { renderTacticalBattle } from './tactical-view.js';
import { narrativeProjection } from './narrative-controller.js';
import { unitRecordFromCombatant } from './unit-state.js';
function fixture() {
  const units = (['ally', 'enemy'] as const).map((side) => generateUnit({ name: side === 'ally' ? '观察者' : '秘密敌军', side, scale: 'hero', level: 3, rulesVersion: 'v2', traits: [] }, { registry: traitRegistry(), seed: side }).unit);
  const field = standardField(); field.tiles.fill('open');
  const battle = new SmallBattle({ rules: V2_D20, combatants: units, battlefield: field, field: { tags: ['night'] }, seed: 'view' }); battle.start();
  units[0]!.pos = 56; units[1]!.pos = 0; battle.turnOrder = [units[1]!.id, units[0]!.id]; battle.turnIndex = 0;
  return { battle, units };
}
describe('真实观测的全部文本出口', () => {
  it('敌方激活也不通过地图、候选、当前行动、先攻或部署日志泄漏隐藏单位', () => {
    const { battle } = fixture(); const before = JSON.stringify(battle.toSnapshot());
    const html = renderTacticalBattle(battle, { mode: 'weapon', selectedId: battle.active!.id });
    expect(html).not.toContain('秘密敌军'); expect(html).toContain('尚未发现的敌方单位'); expect(html).toContain('unobserved');
    expect(smallStateSummary(battle)).not.toContain('秘密敌军'); expect(battleIntroSummary(battle)).not.toContain('秘密敌军');
    expect(JSON.stringify(battle.toSnapshot())).toBe(before);
  });
  it('常驻投影不从永久档案兜底泄漏隐藏敌军，移动发现后出现真实坐标', () => {
    const { battle, units } = fixture();
    const save = { schemaVersion: 2 as const, storage: units.map((u) => unitRecordFromCombatant(u)), battle: { kind: 'small' as const, snap: battle.toSnapshot() } };
    expect(narrativeProjection(save)).not.toContain('秘密敌军');
    units[1]!.pos = 35; save.battle.snap = battle.toSnapshot();
    const text = narrativeProjection(save); expect(text).toContain('秘密敌军'); expect(text).toContain('A6');
  });
});
