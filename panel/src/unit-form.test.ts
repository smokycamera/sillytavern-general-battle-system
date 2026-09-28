// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { traitRegistry, type Combatant } from '../../engine/src/index.js';
import { buildUnit, editUnitBuild, newUnitDraft, unitDraftFromRecord } from './unit-builder.js';
import { unitRecordFromCombatant } from './unit-state.js';
import { captureUnitDraft, unitForm } from './unit-form.js';

const registry = traitRegistry();
const slots = ['primary', 'sidearm', 'armor', 'shieldGear'] as const;
const gear = (u: Combatant) => ({ weapon: u.weapon, sidearm: u.sidearm, armor: u.armor, shield: u.shield });
afterEach(() => { document.body.innerHTML = ''; });

function fixture() {
  const d = newUnitDraft(); d.name = '原档案'; d.armor.tier = '1'; d.sidearmEnabled = d.shield = true;
  const unit = buildUnit(d, registry, 'managed-form');
  for (const item of Object.values(gear(unit))) if (item?.recipe) item.recipe.bonuses = {};
  const record = unitRecordFromCombatant(unit); record.equipmentManaged = true;
  return record;
}
function input(role: string, value: string) {
  const el = document.querySelector<HTMLInputElement>(`[data-role="edit-${role}"]`)!;
  expect(el, role).not.toBeNull(); el.value = value;
}

describe('managed unit form round trip', () => {
  for (const slot of slots) {
    it.each(['missing', 'empty', 'zero', 'signed'] as const)(`${slot}: %s bonuses survive render/capture/preview unchanged`, kind => {
      const record = fixture(), u = record.snapshot!;
      const item = slot === 'primary' ? u.weapon! : slot === 'sidearm' ? u.sidearm! : slot === 'armor' ? u.armor! : u.shield!;
      if (kind === 'missing') delete item.recipe!.bonuses;
      else item.recipe!.bonuses = kind === 'empty' ? {} : kind === 'zero' ? { defense: 0 } : { defense: -2, power: 3 };
      const before = structuredClone(record), d = unitDraftFromRecord(record);
      document.body.innerHTML = unitForm('edit', d, registry, { editing: true, managed: true });
      // No controls are changed, and all equipment details are still collapsed.
      const captured = captureUnitDraft('edit', d, { managed: true });
      expect(JSON.stringify(captured)).toBe(JSON.stringify(d));
      const result = editUnitBuild(record, captured, registry);
      expect(gear(result.snapshot!)).toEqual(gear(before.snapshot!));
      expect(record).toEqual(before); expect(d).toEqual(unitDraftFromRecord(before));
    });
  }

  it('captures identity, life and body without reading locked gear or flags', () => {
    const record = fixture(), before = structuredClone(record), d = unitDraftFromRecord(record);
    document.body.innerHTML = unitForm('edit', d, registry, { editing: true, managed: true });
    input('name', '修改人物'); input('hp', '7'); input('hpMax', '100'); input('note', '只改人物资料');
    input('body', 'large'); input('speedTier', '4');
    document.querySelector<HTMLInputElement>('[data-role="edit-mount"]')!.checked = true;
    document.querySelector<HTMLInputElement>('[data-role="edit-autoPrepare"]')!.checked = true;
    // Even an unsupported old select value / malformed locked display must not be parsed.
    for (const slot of slots) { input(`${slot}-bonuses`, '只读展示不是配方'); input(`${slot}-power`, '10'); }
    document.querySelector<HTMLInputElement>('[data-role="edit-sidearmEnabled"]')!.checked = false;
    document.querySelector<HTMLInputElement>('[data-role="edit-shield"]')!.checked = false;
    const captured = captureUnitDraft('edit', d, { managed: true });
    expect(captured).toMatchObject({ name: '修改人物', hp: '7', hpMax: '100', note: '只改人物资料', body: 'large', speedTier: '4', mount: true, autoPrepare: true, sidearmEnabled: true, shield: true });
    for (const slot of slots) expect(captured[slot]).toEqual(d[slot]);
    const result = editUnitBuild(record, captured, registry);
    expect(result).toMatchObject({ name: '修改人物', hp: 7, base: { hpMax: 100 }, note: '只改人物资料' });
    expect(gear(result.snapshot!)).toEqual(gear(before.snapshot!)); expect(record).toEqual(before);
  });

  it('preserves unsupported legacy indirect-cannon selects without converting the weapon', () => {
    const d = newUnitDraft(); d.name = '旧曲射炮'; d.body = d.primary.body = d.armor.body = 'vehicle'; d.primary.mechanism = 'cannon';
    const u = buildUnit(d, registry, 'legacy-managed'); u.weapon!.indirect = true;
    const record = unitRecordFromCombatant(u); record.equipmentManaged = true;
    const edit = unitDraftFromRecord(record); expect(edit.primary.mechanism).toBe('indirect-cannon');
    document.body.innerHTML = unitForm('edit', edit, registry, { editing: true, managed: true });
    input('name', '仍是曲射炮');
    const result = editUnitBuild(record, captureUnitDraft('edit', edit, { managed: true }), registry);
    expect(result.name).toBe('仍是曲射炮'); expect(gear(result.snapshot!)).toEqual(gear(u));
  });

  it('keeps empty equipment slots empty through repeated capture, preview and reopening', () => {
    let record = fixture(); delete record.snapshot!.weapon; delete record.snapshot!.armor; delete record.snapshot!.sidearm; delete record.snapshot!.shield;
    for (let i = 0; i < 3; i++) {
      const d = unitDraftFromRecord(record);
      document.body.innerHTML = unitForm('edit', d, registry, { editing: true, managed: true }); input('note', '重复修改' + i);
      const captured = captureUnitDraft('edit', d, { managed: true });
      expect(captureUnitDraft('edit', captured, { managed: true })).toEqual(captured);
      record = editUnitBuild(record, captured, registry);
      expect(Object.values(gear(record.snapshot!))).toEqual([undefined, undefined, undefined, undefined]);
    }
  });

  it.each([...slots, 'sidearmEnabled', 'shield'] as const)('still rejects an actual managed equipment change: %s', key => {
    const record = fixture(), before = structuredClone(record), d = unitDraftFromRecord(record);
    if (key === 'sidearmEnabled' || key === 'shield') d[key] = !d[key]; else d[key].power = '10';
    expect(() => editUnitBuild(record, d, registry)).toThrow('实物装备请在配装工作区更换或改造');
    expect(record).toEqual(before);
  });
});

it('unmanaged creation and legacy editing still capture equipment, clear bonuses, and toggle gear', () => {
  const record = fixture(); record.equipmentManaged = false;
  const d = unitDraftFromRecord(record); d.primary.bonuses = { damage: 3 };
  document.body.innerHTML = unitForm('edit', d, registry, { editing: true });
  input('primary-power', '4'); input('primary-bonuses', '');
  document.querySelector<HTMLInputElement>('[data-role="edit-shield"]')!.checked = false;
  const captured = captureUnitDraft('edit', d);
  expect(captured.primary.power).toBe('4'); expect(captured.primary.bonuses).toEqual({}); expect(captured.shield).toBe(false);
  const result = editUnitBuild(record, captured, registry);
  expect(result.snapshot!.weapon!.level).toBe(4); expect(result.snapshot!.shield).toBeUndefined();
  const fresh = newUnitDraft(); fresh.name = '新单位';
  document.body.innerHTML = unitForm('gen', fresh, registry);
  document.querySelector<HTMLInputElement>('[data-role="gen-primary-power"]')!.value = '6';
  const next = captureUnitDraft('gen', fresh);
  expect(buildUnit(next, registry, 'unmanaged-new').weapon!.level).toBe(6);
});
