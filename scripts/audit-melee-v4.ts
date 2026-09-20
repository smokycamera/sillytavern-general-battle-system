import { writeFileSync } from 'node:fs';
import { generateUnit, traitRegistry, prepareCombatModel, V4_D20, V4_TW, previewAttack, standardConditionMap, anchoredWeapon, type Combatant } from '../engine/src/index.js';
import { compileWeapon, compileArmor } from '../engine/src/gen/equipment.js';
import { diceAvg } from '../engine/src/data/weapons.js';
import { gridWeaponRange } from '../engine/src/small/weapon-range.js';
import { formationWeaponRange } from '../engine/src/melee.js';
const registry = traitRegistry(), conditionDefs = standardConditionMap();
const unit = (side: 'ally' | 'enemy') => generateUnit({ name: side, side, scale: 'hero', rulesVersion: 'v2', level: 4, weaponClass: 'sword', armorTier: 0, traits: [], hpMax: 1000 }, { registry, seed: side, noVariance: true }).unit;
const attacker = unit('ally'), defender = unit('enemy'); delete defender.weapon;
const rows = [];
for (const rules of [V4_D20, V4_TW]) {
  prepareCombatModel(attacker, rules); prepareCombatModel(defender, rules);
  for (const power of [1,2,3,4,5,6,7,8,9,10]) for (const tier of [0,1,2,3,4] as const) for (const mechanism of ['sword', 'axe', 'spear', 'blunt']) {
    attacker.weapon = compileWeapon({ mechanism, power }, { id: 'audit', seed: 'audit', quality: 3, noVariance: true });
    defender.armor = compileArmor({ tier, power }, { id: 'armor', seed: 'armor', quality: 3, noVariance: true });
    const weapon = anchoredWeapon(attacker.weapon)!;
    const preview = previewAttack({ attacker, defender, rules, ranged: false, distance: 1, traitRegistry: registry, conditionDefs });
    rows.push({ mode: rules.id, power, tier, mechanism, gridReach: gridWeaponRange(attacker.weapon), formationReach: formationWeaponRange(attacker.weapon),
      baseMean: Number((diceAvg(weapon.baseDice) * weapon.damageScale!).toFixed(3)), penetration: preview.penetration, resistance: preview.resistance,
      penetrationFactor: preview.penetrationFactor, hitChance: preview.hitChance, expectedDamage: Number(preview.expectedDamage.toFixed(3)) });
  }
}
const result = { basis: 'T4、Q3、无人身特质、同规格护甲、1000生命、贴身距离1；纯公式预览，不运行随机胜率矩阵。剑格挡不纳入此攻击者对照，目标无武器。', rows };
writeFileSync('engine/sim/out/melee-v4-audit.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ count: rows.length, L4: rows.filter(r => r.power === 4 && [0,3].includes(r.tier)) }, null, 2));
