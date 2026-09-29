/** Reproducible structural budgets plus actual preview/execution consistency, not a PvP balance claim. */
import { writeFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { SmallBattle, V11_OVERFLOW_D20, generateUnit, standardField, createStructure, type Combatant } from '../engine/src/index.js';
import { compileWeapon } from '../engine/src/gen/equipment.js';
import { BREACH_COEFFICIENTS, weaponBreachBudget, structureDurability, type StructureKind } from '../engine/src/small/layers.js';
import { WEAPON_CLASSES } from '../engine/src/data/weapons.js';
import { weaponReloadTurns } from '../engine/src/loadout.js';
const kinds: StructureKind[] = ['wall', 'gate', 'fortification', 'cover', 'building', 'tower', 'bridge'];
const unit = (id: string, side: Combatant['side']) => { const u = generateUnit({ name: id, side, level: 3, scale: 'hero', rulesVersion: 'v2', weaponClass: 'blunt', weaponLevel: 3, armorTier: 1, traits: [] }, { seed: id, noVariance: true }).unit; u.id = id; return u; };
const a = unit('attacker', 'ally'), b = unit('defender', 'enemy');
let matrixChecks = 0, executionChecks = 0;
const rows: Record<string, unknown>[] = [];
for (const mechanism of Object.keys(WEAPON_CLASSES)) {
  assert.ok(Object.hasOwn(BREACH_COEFFICIENTS, mechanism), 'Unclassified weapon: ' + mechanism);
  for (let grade = 1; grade <= 10; grade++) {
    const weapon = compileWeapon({ mechanism, power: grade }, { id: mechanism, seed: mechanism, noVariance: true, damageModel: 'wounds-v2' });
    const actor = { ...a, weapon };
    const budget = weaponBreachBudget(actor, weapon);
    assert.ok(Number.isFinite(budget.damage) && budget.damage > 0);
    for (const kind of kinds) for (let structureGrade = 1; structureGrade <= 10; structureGrade++) {
      const hp = structureDurability(kind, structureGrade), hits = Math.ceil(hp / budget.damage);
      assert.ok(Number.isSafeInteger(hits) && hits >= 1); matrixChecks++;
      if (structureGrade === grade) {
        const field = standardField(); field.layerVersion = 1; field.tiles.fill('open'); field.structures = field.tiles.map(() => null); field.overlays = {};
        const attacker = structuredClone(actor), enemy = structuredClone(b);
        const battle = new SmallBattle({ battlefield: field, combatants: [attacker, enemy], rules: V11_OVERFLOW_D20, seed: 'audit' });
        battle.start(); battle.turnOrder = [a.id, b.id]; battle.turnIndex = 0; attacker.pos = 59; enemy.pos = 0; attacker.weapon = structuredClone(weapon);
        let checked = false;
        for (const cell of [52, 45, 38, 31, 24, 17, 10]) {
          battle.battlefield!.structures![cell] = createStructure(kind, grade);
          const snapshot = JSON.stringify(battle.toSnapshot()), preview = battle.structurePreview(a.id, cell);
          assert.equal(JSON.stringify(battle.toSnapshot()), snapshot, 'preview mutated state');
          if (preview.reason) { battle.battlefield!.structures![cell] = null; continue; }
          const before = battle.battlefield!.structures![cell]!.hp;
          battle.attackStructure(a.id, cell);
          assert.equal(before - battle.battlefield!.structures![cell]!.hp, preview.damage);
          assert.equal(preview.actions, Math.ceil(before / budget.damage));
          assert.equal(battle.xpGained, 0);
          checked = true; executionChecks++; break;
        }
        assert.ok(checked, 'No legal structural action: ' + mechanism + ':' + grade + ':' + kind);
      }
    }
    if (grade === 3) rows.push({ mechanism, name: WEAPON_CLASSES[mechanism]!.name, grade, coefficient: budget.coefficient, damagePerEffectiveAttack: budget.damage,
      wallHp: structureDurability('wall', grade), wallAttacks: Math.ceil(structureDurability('wall', grade) / budget.damage),
      gateAttacks: Math.ceil(structureDurability('gate', grade) / budget.damage), fortificationAttacks: Math.ceil(structureDurability('fortification', grade) / budget.damage),
      reloadTurns: weaponReloadTurns(weapon) });
  }
}
const report = { source: 'PR62 review candidate', version: '1.6.1-rc.1', weaponClasses: Object.keys(WEAPON_CLASSES).length, matrixChecks, executionChecks,
  baseline: 'single human hero, same L3 equipment/structure, no enhancements/variance/engineering traits; attacks exclude reload and travel; no real-world engineering claim', rows };
mkdirSync('docs', { recursive: true }); writeFileSync('docs/breach-review-audit.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
