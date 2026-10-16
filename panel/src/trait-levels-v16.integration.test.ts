// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest';
import { traitRegistry, traitLevel, traitLadderSummary } from '../../engine/src/index.js';
import { buildUnit, newUnitDraft, unitDraftFromRecord, editUnitBuild } from './unit-builder.js';
import { unitForm, captureUnitDraft } from './unit-form.js';
import { unitRecordFromCombatant, materializeUnitRecord, unitRecordToGenerateInput } from './unit-state.js';
import { parseProtocol } from './protocol.js';

const registry = traitRegistry();
afterEach(() => { document.body.innerHTML = ''; });
it('表单仅开放已完成分级的特质，选级→建档→导出/恢复→编辑保留等级和永久属性', () => {
  const d = newUnitDraft(); d.name = '顽固守卫'; d.scale = 'company'; d.traits = ['guardian', 'stubborn', 'regen']; d.traitLevels = { guardian: 3, stubborn: 3 };
  document.body.innerHTML = unitForm('test', d, registry);
  expect(document.querySelector('[data-trait="regen"]')).not.toBeNull();
  const selector = document.querySelector<HTMLInputElement>('[data-trait="guardian"]')!; selector.value = '8';
  const captured = captureUnitDraft('test', d), u = buildUnit(captured, registry, 'form-level');
  expect(captured.traitLevels).toEqual({ guardian: 8, regen: 1, stubborn: 3 });
  expect(traitLevel(u, 'guardian')).toBe(8); expect(traitLevel(u, 'stubborn')).toBe(3);
  const r = unitRecordFromCombatant(u), restored = materializeUnitRecord(JSON.parse(JSON.stringify(r)), registry);
  expect(traitLevel(restored, 'guardian')).toBe(8); expect(unitRecordToGenerateInput(r).traitLevels).toEqual({ guardian: 8, regen: 1, stubborn: 3 });
  const draft = unitDraftFromRecord(r); draft.name = '改名'; const edited = editUnitBuild(r, draft, registry);
  expect(edited.snapshot!.traitLevels).toEqual({ guardian: 8, regen: 1, stubborn: 3 }); expect(edited.base.moraleMax).toBe(r.base.moraleMax);
  expect(traitLadderSummary('guardian', 8)).toContain('40%');
});
it('正文bless别名/默认L1/重复项共用最高值且只生成一个来源特质', () => {
  const parsed = parseProtocol('<tb><bless id="u" traits="守护L3,守护,大守护" rounds="2"/></tb>');
  expect(parsed.events[0]).toMatchObject({ kind: 'bless', traitIds: ['guardian'], traitLevels: { guardian: 8 } });
  const low = parseProtocol('<tb><bless id="u" traits="守护L3,守护" rounds="2"/></tb>');
  expect(low.events[0]).toMatchObject({ traitIds: ['guardian'] });
  expect(low.events[0]).toHaveProperty('traitLevels.guardian', 3);
  expect(parseProtocol('<tb><bless id="u" traits="守护" rounds="2"/></tb>').events[0]).toHaveProperty('traitLevels.guardian', 1);
  expect(parseProtocol('<tb><bless id="u" traits="守护L5" rounds="2"/></tb>').events[0]).toHaveProperty('traitLevels.guardian', 5);
});
it('历史缺省L5档案在表单和再生成入口显式保留L5，新表单缺省为L1', () => {
  const d = newUnitDraft(); d.name = '历史单位'; d.traits = ['guardian'];
  const fresh = buildUnit(d, registry, 'legacy-default'); expect(traitLevel(fresh, 'guardian')).toBe(1);
  delete fresh.traitLevels;
  const record = unitRecordFromCombatant(fresh), draft = unitDraftFromRecord(record);
  expect(draft.traitLevels).toEqual({ guardian: 5 }); expect(unitRecordToGenerateInput(record).traitLevels).toEqual({ guardian: 5 });
  document.body.innerHTML = unitForm('old', draft, registry);
  const captured = captureUnitDraft('old', draft);
  expect(captured.traitLevels).toEqual({ guardian: 5 }); expect(traitLevel(editUnitBuild(record, captured, registry).snapshot!, 'guardian')).toBe(5);
});
