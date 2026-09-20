/**
 * 异常对局诊断：复现并解剖矩阵模拟中发现的两个病理样本。
 * ① 战锤40K 3v3 超长磨血局（n=400 中最大 420 回合）——定位伤害涓流来源。
 * ② DND 1v10 法师全败 / 1v3 平均 17.5 回合——定位风筝与边界行为。
 */
import { it } from 'vitest';
import { SmallBattle } from '../src/small/battle';
import { generateUnit } from '../src/gen/generator';
import { traitRegistry } from '../src/data/traits';
import { SYSTEM_PACKS } from '../src/rules';
import type { Combatant, GenerateInput, Side } from '../src/types';

const reg = traitRegistry();

function gen(name: string, side: Side, scale: 'hero' | 'mook', over: Partial<GenerateInput>): Combatant {
  return generateUnit(
    { name, side, scale, level: 3, traits: [], era: 'medieval', ...over } as GenerateInput,
    { seed: `${name}:${side}`, registry: reg },
  ).unit;
}

function drive(b: SmallBattle, cap = 900): void {
  b.start();
  let guard = 0;
  let stall = 0;
  let lastKey = '';
  while (!b.isOver() && guard++ < cap) {
    const u = b.active;
    if (!u || u.status !== 'ready') break;
    const k = `${b.round}:${b.turnIndex}`;
    if (k === lastKey && ++stall > 60) break;
    lastKey = k;
    b.autoAction(u.id);
  }
}

it('① 战锤40K 3v3：找最长局并解剖伤害涓流', () => {
  // 与 matrix.sim.ts 相同的 40K 配方
  const mk40k = (name: string, side: Side, scale: 'hero' | 'mook', lv: number) =>
    gen(name, side, scale, {
      era: 'scifi', archetype: 'infantry', level: lv,
      ...(scale === 'hero'
        ? { loadout: 'melee' as const, weaponId: 'wpn-chainsword', armorId: 'arm-terminator', armorTier: 4 as const, traits: ['elite'] }
        : { loadout: 'ranged' as const, weaponId: 'wpn-lasgun', armorTier: 1 as const }),
    });

  let worst = { seed: '', rounds: 0 };
  for (let i = 0; i < 400; i++) {
    const seed = `w40k-3v3-r${i}`;
    const units = [
      mk40k('我方队长', 'ally', 'hero', 5), mk40k('我方兵1', 'ally', 'mook', 1), mk40k('我方兵2', 'ally', 'mook', 1),
      mk40k('敌方队长', 'enemy', 'hero', 5), mk40k('敌兵1', 'enemy', 'mook', 1), mk40k('敌兵2', 'enemy', 'mook', 1),
    ];
    const b = new SmallBattle({ combatants: units, seed, rules: SYSTEM_PACKS.w40k!.small, traitRegistry: reg });
    drive(b);
    if (b.round > worst.rounds) worst = { seed, rounds: b.round };
  }
  console.log(`最长局：${worst.seed}，${worst.rounds} 回合`);

  // 复现该局，统计逐回合伤害
  const units = [
    mk40k('我方队长', 'ally', 'hero', 5), mk40k('我方兵1', 'ally', 'mook', 1), mk40k('我方兵2', 'ally', 'mook', 1),
    mk40k('敌方队长', 'enemy', 'hero', 5), mk40k('敌兵1', 'enemy', 'mook', 1), mk40k('敌兵2', 'enemy', 'mook', 1),
  ];
  const b = new SmallBattle({ combatants: units, seed: worst.seed, rules: SYSTEM_PACKS.w40k!.small, traitRegistry: reg });
  drive(b);
  const dmgByRound = new Map<number, { dmg: number; hits: number; misses: number }>();
  for (const e of b.log) {
    if (e.kind !== 'attack' || !e.resolution) continue;
    const s = dmgByRound.get(e.round) ?? { dmg: 0, hits: 0, misses: 0 };
    if (e.resolution.hit) { s.dmg += e.resolution.finalDamage; s.hits++; } else s.misses++;
    dmgByRound.set(e.round, s);
  }
  const heroes = units.filter((u) => u.scale === 'hero');
  for (const h of heroes) {
    console.log(`${h.name}: HP ${h.hp}/${h.base.hpMax}，武器 ${h.weapon!.name} ${h.weapon!.baseDice}${h.weapon!.apDice ? ` 破甲${h.weapon!.apDice}` : ''}，护甲 ${h.armor!.name}(T${h.armor!.tier})`);
  }
  const rounds = [...dmgByRound.keys()].sort((a, z) => a - z);
  const sample = rounds.length > 20 ? rounds.filter((_, i) => i % Math.ceil(rounds.length / 20) === 0) : rounds;
  for (const r of sample) {
    const s = dmgByRound.get(r)!;
    console.log(`  R${r}: 命中${s.hits} 未中${s.misses} 伤害${s.dmg}`);
  }
  const attacks = b.log.filter((e) => e.kind === 'attack');
  const zeroDmgHits = attacks.filter((e) => e.resolution?.hit && e.resolution.finalDamage === 0).length;
  console.log(`总攻击 ${attacks.length} 次；命中但 0 伤害 ${zeroDmgHits} 次；对局 ${b.round} 回合`);
  // 命中统计与典型结算行
  const heroAttacks = attacks.filter((e) => e.resolution?.attackerId.includes('队长'));
  const hits = heroAttacks.filter((e) => e.resolution?.hit).length;
  console.log(`队长攻击 ${heroAttacks.length} 次，命中 ${hits} 次（${((hits / Math.max(1, heroAttacks.length)) * 100).toFixed(1)}%）`);
  for (const e of heroAttacks.slice(0, 6)) {
    const r = e.resolution!;
    console.log(`  R${e.round} ${r.attackerName}: +${r.netAtk} vs 防御${r.targetDef} → ${r.hit ? `命中 ${r.finalDamage}（DR${r.drPercent}% 普段${r.baseAfterDR}+破甲${r.apTotal}）` : '未中'}`);
  }
  // 稳态解剖：R100-R112 原始日志 + 终态
  console.log('--- R100-R112 原始日志 ---');
  for (const e of b.log.filter((e) => e.round >= 100 && e.round <= 112)) console.log(`  R${e.round}[${e.kind}] ${e.text.split('\n')[0]}`);
  console.log('--- 终态 ---');
  for (const u of units) console.log(`  ${u.name}: ${u.status} HP${u.hp}/${u.base.hpMax} pos${u.pos} SP${u.resources.SP ?? '-'} 装填${b.reloadCd.get(u.id) ?? 0} 状态${u.conditions.map((c) => c.id).join(',') || '无'}`);
  const kinds = new Map<string, number>();
  for (const e of b.log) kinds.set(e.kind, (kinds.get(e.kind) ?? 0) + 1);
  console.log(`日志分布：${[...kinds.entries()].map(([k, v]) => `${k}:${v}`).join(' ')}`);
});

it('② DND 1v10：法师败因解剖', () => {
  const mkMage = (name: string, side: Side, lv: number) =>
    gen(name, side, 'hero', {
      era: 'medieval', archetype: 'ranged', level: lv, loadout: 'ranged',
      weaponId: 'wpn-staff', armorTier: 0, traits: ['veteran'],
      abilityIds: ['fireball'], persona: ['火焰', '法师'],
    });
  const mkMook = (name: string, side: Side) =>
    gen(name, side, 'mook', { era: 'medieval', archetype: 'infantry', level: 2, loadout: 'melee' });

  // 典型败局 r0
  const units = [mkMage('我方传奇', 'ally', 8)];
  for (let i = 1; i <= 10; i++) units.push(mkMook(`敌兵${i}`, 'enemy'));
  const b = new SmallBattle({ combatants: units, seed: 'dnd-1v10-r0', rules: SYSTEM_PACKS.dnd!.small, traitRegistry: reg });
  drive(b);
  console.log(`r0 局：${b.round} 回合，胜者 ${b.winner()}，法师 HP ${units[0]!.hp}/${units[0]!.base.hpMax} 状态 ${units[0]!.status}`);
  console.log(`法师技能：${units[0]!.abilities.map((a) => `${a.name}(cd${a.cooldown ?? 0})`).join('、')}`);
  const killsByAbility = b.log.filter((e) => e.kind === 'ability').length;
  console.log(`技能释放 ${killsByAbility} 次；攻击 ${b.log.filter((e) => e.kind === 'attack').length} 次；敌亡 ${units.filter((u) => u.side === 'enemy' && (u.status === 'dead' || u.status === 'dying')).length}/10`);
  // 法师武器骰
  const w = units[0]!.weapon!;
  console.log(`法杖：${w.baseDice}${w.apDice ? ` 破甲 ${w.apDice}` : ''} 射程 ${w.range}；法师护甲 T${units[0]!.armor!.tier}`);
  for (const e of b.log.filter((e) => e.kind === 'attack' && e.text.includes('我方传奇')).slice(0, 8)) console.log(`  ${e.text}`);
});
