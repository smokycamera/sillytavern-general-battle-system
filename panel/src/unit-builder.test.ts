import { expect, it } from 'vitest';
import { traitRegistry } from '../../engine/src/index.js';
import { buildUnit, editUnitBuild, newUnitDraft, unitDraftFromRecord } from './unit-builder.js';
import { unitRecordFromCombatant } from './unit-state.js';
const registry = traitRegistry();
it('统一新建预览采用真实稳定/专项甲/副武器并自动准备合法技能，冲突不偷偷卸装', () => {
  const d = newUnitDraft(); d.name = '车载炮组'; d.scale = 'company'; d.hpMax = '560'; d.body = 'vehicle'; d.primary.body = d.armor.body = d.sidearm.body = 'vehicle';
  d.primary.mechanism = 'cannon'; d.primary.stabilized = true; d.armor.profile = 'thermal'; d.sidearmEnabled = true; d.sidearm.mechanism = 'light-ranged';
  d.skills = [{ id: 'bp-crushing-blow', name: '', power: '5', prepared: false }, { id: 'bp-mending', name: '', power: '5', prepared: false }];
  const a = buildUnit(d, registry, 'preview'); expect(buildUnit(d, registry, 'preview')).toEqual(a);
  expect(a.weapon!.recipe!.stabilized).toBe(true); expect(a.sidearm!.recipe!.mechanism).toBe('light-ranged'); expect(a.armor!.recipe!.protectionProfile).toBe('thermal');
  expect(a.preparedAbilityIds).toEqual([a.abilities[1]!.id]); expect(a.hp).toBe(560);
  const unrestricted = structuredClone(d); unrestricted.shield = true; expect(buildUnit(unrestricted, registry, 'preview').shield).toBeDefined();
  unrestricted.sidearm.mechanism = 'bow'; expect(buildUnit(unrestricted, registry, 'preview').sidearm?.recipe?.mechanism).toBe('bow');
});
it('统一编辑保留冻结装备与技能账本，只有指定槽重编译，改身体不放大原枪或回满人员', () => {
  const d = newUnitDraft(); d.name = '原队伍'; d.scale = 'company'; d.hpMax = '560'; d.hp = '70'; d.primary.mechanism = 'rifle'; d.sidearmEnabled = true;
  d.skills = [{ id: 'bp-crushing-blow', name: '旧技法', power: '5', prepared: true }];
  const unit = buildUnit(d, registry, 'old'); unit.resources.SP = 1; unit.abilityState = [{ abilityId: unit.abilities[0]!.cooldownGroup!, used: 1, cdLeft: 2 }];
  unit.abilities[0]!.effects = [{ op: 'damage', baseDice: '2d6+9' }];
  const record = unitRecordFromCombatant(unit), saved = structuredClone(record), edit = unitDraftFromRecord(record);
  edit.name = '改名队伍'; edit.body = 'large'; edit.skills[0]!.name = '新称呼';
  const named = editUnitBuild(record, edit, registry); expect(record).toEqual(saved); expect(named.snapshot!.weapon).toEqual(unit.weapon); expect(named.snapshot!.sidearm).toEqual(unit.sidearm);
  expect(named.snapshot!.abilities[0]!.effects).toEqual(unit.abilities[0]!.effects); expect(named.snapshot!.resources.SP).toBe(1); expect(named.snapshot!.abilityState).toEqual(unit.abilityState); expect([named.hp, named.base.hpMax]).toEqual([70, 560]);
  const gear = unitDraftFromRecord(named); gear.sidearm.power = '8'; const upgraded = editUnitBuild(named, gear, registry);
  expect(upgraded.snapshot!.weapon).toEqual(unit.weapon); expect(upgraded.snapshot!.armor).toEqual(unit.armor); expect(upgraded.snapshot!.sidearm!.id).toBe(unit.sidearm!.id); expect(upgraded.snapshot!.sidearm!.level).toBe(8); expect(upgraded.snapshot!.abilities).toEqual(named.snapshot!.abilities);
  const managed = { ...named, equipmentManaged: true }; expect(() => editUnitBuild(managed, gear, registry)).toThrow(/配装工作区/);
  const empty = structuredClone(record); delete empty.snapshot!.weapon; const noGear = editUnitBuild(empty, unitDraftFromRecord(empty), registry); expect(noGear.snapshot!.weapon).toBeUndefined();
});
