import { expect, it } from 'vitest';
import { MEMBER_HEALTH_MODEL, strengthDescription, traitRegistry } from '../../engine/src/index.js';
import { compactEvents, reportStrengthLabel, smallStateSummary } from '../../engine/src/inject/format.js';
import { formatResolution, type AttackResolution } from '../../engine/src/damage.js';
import { tacticalFixture } from '../../scripts/p4-tactical-fixture.js';
import { battleEpilogue } from './battle-reports.js';
import { memberHealthPanel } from './combat-model-view.js';
import { renderTacticalBattle } from './tactical-view.js';
import { buildPreview, unitForm } from './unit-form.js';
import { newUnitDraft } from './unit-builder.js';

it('limits unit and battlefield displays without rounding saved health, member groups or editable inputs', () => {
  const { b } = tacticalFixture(), unit = b.byId('a'), company = b.byId('d');
  unit.name = '角色1.2345'; unit.hp = 12.34567; unit.base.hpMax = 100.12345; unit.morale = 66.66667;
  company.combatModel = MEMBER_HEALTH_MODEL; company.hp = 2; company.base.hpMax = 3;
  company.formation = { members: 2, capacity: 3, memberHp: 100.12345, health: [{ hp: 12.34567, count: 2 }] };
  const before = JSON.stringify(b.toSnapshot());
  const text = [strengthDescription(unit), reportStrengthLabel(unit), smallStateSummary(b),
    buildPreview(unit), memberHealthPanel(company), renderTacticalBattle(b, { mode: 'weapon', selectedId: unit.id })].join('\n');
  expect(text).toContain('12.35/100.12');
  expect(text).toContain('66.67');
  expect(text).toContain('总生命 24.69/300.37');
  expect(text).toContain(unit.name);
  expect(text.replaceAll(unit.name, '')).not.toMatch(/\d+\.\d{3,}/);
  expect(JSON.stringify(b.toSnapshot())).toBe(before);
  const draft = { ...newUnitDraft(), hp: '12.34567', hpMax: '100.12345' };
  const form = unitForm('edit', draft, traitRegistry());
  expect(form).toContain('data-role="edit-hp" value="12.34567"');
  expect(form).toContain('data-role="edit-hpMax" value="100.12345"');
});

it('rounds damage details, round reports and accumulated epilogue totals only when formatting', () => {
  const { b } = tacticalFixture(), unit = b.byId('a');
  const r: AttackResolution = { attackerId: 'c', defenderId: unit.id, attackerName: '来源1.2345', defenderName: unit.name,
    hit: true, hitChance: 1, crit: false, finalDamage: 1.23456, hpBefore: 80.12345, hpAfter: 78.88889,
    netAtk: 2.34567, targetDef: 10.12345, atkDetail: '', defenderStatus: 'ready', text: '', drPercent: 5.67891, baseAfterDR: 1.23456,
    baseRoll: { expr: '1d6', rolls: [2], kept: [2], flat: .12345, total: 2.12345 }, apTotal: .12345, dmgMult: 1.23456, wardMult: .98765 };
  r.text = formatResolution(r, unit);
  b.log.push({ round: 1, kind: 'attack', text: r.text, resolution: r, observedBy: ['ally'] });
  b.log.push({ round: 1, kind: 'attack', text: r.text, resolution: r, observedBy: ['ally'] });
  const before = JSON.stringify(b.toSnapshot());
  const text = [r.text, ...compactEvents(b.log), battleEpilogue(b)].join('\n');
  expect(text).toContain('1.23');
  expect(text).toContain('80.12→78.89');
  expect(text).toContain('累计造成2.47生命损失');
  expect(text.replaceAll(r.attackerName, '')).not.toMatch(/\d+\.\d{3,}/);
  expect(JSON.stringify(b.toSnapshot())).toBe(before);
});
