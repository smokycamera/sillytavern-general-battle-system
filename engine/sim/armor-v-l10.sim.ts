/**
 * 装甲对标诊断：L1~L10 各武器类（刀剑/长矛/锤/火枪/步枪/火炮/法杖）对 L10 护甲的伤害曲线。
 * 问题：数值是否拟真合理——低级武器打神甲是否涓流、高级破甲武器是否够狠、护甲的品质乘数是否过/不及。
 * 运行：npx vitest run --config vitest.sim.config.ts engine/sim/armor-v-l10.sim.ts
 */
import { it } from 'vitest';
import { generateUnit } from '../src/gen/generator';
import { traitRegistry } from '../src/data/traits';
import { resolveAttack, armorDR } from '../src/damage';
import { LITE_D20 } from '../src/rules';
import { SeededRng } from '../src/rng';
import type { Combatant, GenerateInput } from '../src/types';

const reg = traitRegistry();
const N = 4000;

const CLASSES: { key: string; label: string; loadout: 'melee' | 'ranged' }[] = [
  { key: 'sword', label: '刀剑', loadout: 'melee' },
  { key: 'spear', label: '长矛', loadout: 'melee' },
  { key: 'blunt', label: '锤钝', loadout: 'melee' },
  { key: 'firearm', label: '火枪', loadout: 'ranged' },
  { key: 'rifle', label: '步枪', loadout: 'ranged' },
  { key: 'cannon', label: '火炮', loadout: 'ranged' },
  { key: 'magic', label: '魔法', loadout: 'ranged' },
];

function attacker(cls: string, level: number, loadout: 'melee' | 'ranged'): Combatant {
  const input: GenerateInput = {
    name: `攻${cls}L${level}`, side: 'ally', scale: 'hero', level, traits: [], era: 'medieval',
    archetype: loadout === 'ranged' ? 'ranged' : 'infantry',
    loadout, weaponClass: cls, weaponLevel: level,
  };
  return generateUnit(input, { registry: reg, noVariance: true }).unit;
}

function defender(tier: 3 | 4, armorLevel: number): Combatant {
  const input: GenerateInput = {
    name: '重甲靶', side: 'enemy', scale: 'hero', level: 10, traits: [], era: 'medieval',
    archetype: 'infantry', armorTier: tier, armorLevel,
  };
  return generateUnit(input, { registry: reg, noVariance: true }).unit;
}

interface Row {
  label: string; lv: number; atk: number; hit: string; dmgHit: number; dmgSwing: number;
  naked: number; mitigation: string; hitsToKill: number; swingsToKill: number; roundsToKill: string;
}

function runMatrix(target: Combatant, nakedTarget: Combatant): Row[] {
  const rows: Row[] = [];
  const hp = target.base.hpMax;
  const dr = Math.round(armorDR(target, LITE_D20, reg) * 100);
  console.log(`  靶子：Lv10 步兵 HP=${hp} 防=${target.base.def} 护甲=${target.armor!.name}（档${target.armor!.tier}·drScale=${target.armor!.drScale}）→ 实际减伤 ${dr}%`);
  for (const c of CLASSES) {
    for (let lv = 1; lv <= 10; lv++) {
      const a = attacker(c.key, lv, c.loadout);
      const rng = new SeededRng(`armor-sim:${c.key}:${lv}`);
      const condDefs = new Map();
      let hits = 0, dmgSum = 0, crits = 0, nakedSum = 0, nakedHits = 0;
      for (let i = 0; i < N; i++) {
        target.hp = hp;
        const r = resolveAttack({ attacker: a, defender: target, rng, rules: LITE_D20, conditionDefs: condDefs, traitRegistry: reg });
        if (r.hit) { hits++; dmgSum += r.finalDamage; if (r.crit) crits++; }
        nakedTarget.hp = hp;
        const rn = resolveAttack({ attacker: a, defender: nakedTarget, rng, rules: LITE_D20, conditionDefs: condDefs, traitRegistry: reg });
        if (rn.hit) { nakedHits++; nakedSum += rn.finalDamage; }
      }
      const hitRate = hits / N;
      const dmgHit = dmgSum / Math.max(1, hits);
      const dmgSwing = dmgSum / N;
      const naked = nakedSum / Math.max(1, nakedHits);
      const mitigation = naked > 0 ? Math.round((1 - dmgHit / naked) * 100) : 0;
      const attacksPerRound = (a.weapon!.attacks ?? 1) / (1 + (a.weapon!.reload ?? 0));
      const hitsToKill = Math.ceil(hp / Math.max(0.5, dmgHit));
      const swingsToKill = Math.ceil(hitsToKill / Math.max(0.02, hitRate));
      const rounds = swingsToKill / attacksPerRound;
      rows.push({
        label: c.label, lv, atk: a.base.atk,
        hit: `${Math.round(hitRate * 100)}%`, dmgHit: Math.round(dmgHit * 10) / 10,
        dmgSwing: Math.round(dmgSwing * 10) / 10, naked: Math.round(naked * 10) / 10,
        mitigation: `${mitigation}%`, hitsToKill,
        swingsToKill, roundsToKill: Math.round(rounds * 10) / 10 + '',
      });
    }
  }
  return rows;
}

function printTable(title: string, rows: Row[]): void {
  console.log(`\n${title}`);
  console.log('武器  Lv  攻  命中  每击伤害(有甲)  每击伤害(裸)  甲实际抵消  击杀所需击数  击杀所需挥击  击杀所需回合');
  for (const r of rows) {
    console.log(
      `${r.label.padEnd(4)} ${String(r.lv).padStart(2)} ${String(r.atk).padStart(3)} ${r.hit.padStart(4)} `
      + `${String(r.dmgHit).padStart(10)} ${String(r.naked).padStart(10)} ${r.mitigation.padStart(8)} `
      + `${String(r.hitsToKill).padStart(8)} ${String(r.swingsToKill).padStart(8)} ${r.roundsToKill.padStart(8)}`,
    );
  }
}

it('L1~L10 武器 × L10 护甲 伤害矩阵', () => {
  // 主靶：重甲L10（tier3 表值 0.5 × 品质 1.2 = 60% DR）
  const heavy = defender(3, 10);
  const heavyNaked = defender(3, 10); heavyNaked.armor = { id: 'none', name: '无甲', tier: 0 };
  printTable('== 重甲 L10（60% 实际减伤）==', runMatrix(heavy, heavyNaked));

  // 对照靶：超重甲 L10（tier4 表值 0.6 × 1.2 = 72% DR）
  const ultra = defender(4, 10);
  const ultraNaked = defender(4, 10); ultraNaked.armor = { id: 'none', name: '无甲', tier: 0 };
  printTable('== 超重甲 L10（72% 实际减伤）==', runMatrix(ultra, ultraNaked));
});
