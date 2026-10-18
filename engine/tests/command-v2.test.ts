import { describe, expect, it } from 'vitest';
import { generateUnit, SmallBattle, MassBattle, standardField, traitRegistry, V19_OVERFLOW_D20, V19_OVERFLOW_TW, styleTerm, styleTerms, NEUTRAL_FEATURES,
  type Combatant, type GenerateInput, type StyleFeatures, type StyleParameters } from '../src/index.js';
import type { CommanderProfile, CommanderProfiles } from '../src/commander-profile.js';

const registry = traitRegistry();
function make(id: string, side: 'ally' | 'enemy', extra: Partial<GenerateInput> = {}): Combatant {
  const unit = generateUnit({ rulesVersion: 'v2', damageModel: 'wounds-v2', name: id, side, scale: 'hero', level: 5, armorTier: 0, weaponClass: 'sword', weaponLevel: 5, traits: [], ...extra },
    { registry, seed: id, noVariance: true }).unit;
  unit.id = id; return unit;
}
const at = (x: number, y: number) => y * 7 + x;
function grid(units: Combatant[], commanders: CommanderProfiles, walls: number[] = []) {
  const field = standardField(); field.tiles.fill('open'); for (const cell of walls) field.tiles[cell] = 'wall';
  const battle = new SmallBattle({ combatants: units, rules: V19_OVERFLOW_D20, traitRegistry: registry, seed: 'command-v2', battlefield: field });
  battle.commanderProfiles = commanders; battle.start(); battle.turnOrder = units.map(unit => unit.id); battle.turnIndex = 0;
  return battle;
}

describe('V19 §3.2 风格行为项', () => {
  const rows: [Exclude<keyof StyleParameters, 'reserve'>, StyleParameters[keyof StyleParameters], Partial<StyleFeatures>, number][] = [
    ['range', 'close', { move: true, approach: 1 }, .20], ['range', 'close', { attack: true }, .20],
    ['range', 'max', { rangedUnit: true, safeRange: true }, .25], ['range', 'max', { rangedUnit: true, inEnemyReach: true }, -.15],
    ['advance', 'together', { closer: true, allyNear: false }, -.20], ['advance', 'wait', { idle: true, stay: true }, .30],
    ['advance', 'front', { frontline: true }, .20], ['advance', 'front', { leavingFront: true }, -.10],
    ['target', 'kill', { attack: true, killChance: 1 }, .20], ['target', 'flank', { attack: true, flanked: true }, .25],
    ['target', 'flank', { attack: true, ranged: true, focused: true }, .25], ['target', 'flank', { flankMove: true }, .15],
    ['target', 'works', { attack: true, fortified: true }, .25], ['target', 'works', { breach: true }, .25], ['target', 'works', { attack: true, nearEngineer: true }, .15],
    ['target', 'rear', { attack: true, backline: true }, .25], ['target', 'intercept', { attack: true, intercept: true }, .20],
    ['target', 'counter', { attack: true, counter: true }, .20], ['target', 'core', { attack: true, targetNearCore: true }, .20],
    ['formation', 'tight', { allyNear: false }, -.15], ['formation', 'layers', { secondLine: true }, .15],
    ['formation', 'core', { nearCore: true }, .25], ['formation', 'avoid', { safePath: true }, .10],
    ['exposure', 'mid', { exposure: 1 }, -.10], ['exposure', 'low', { exposure: 1 }, -.25],
    ['retreat', .3, { retreat: true, hpRatio: .2 }, .20], ['retreat', .5, { retreat: true, hpRatio: .4 }, .20],
    ['reinforce', true, { reinforce: true }, .20],
  ];
  it.each(rows)('%s=%s 在对应特征下得到表中数值，其他特征下为 0', (parameter, value, features, expected) => {
    expect(styleTerm(parameter, value, { ...NEUTRAL_FEATURES, ...features })).toBeCloseTo(expected, 10);
    expect(Math.abs(styleTerm(parameter, value, NEUTRAL_FEATURES))).toBe(0);
  });
  it('风格的行为项是各参数之和，均衡为 0', () => {
    expect(styleTerms('aggressive', { ...NEUTRAL_FEATURES, attack: true, killChance: .5 })).toBeCloseTo(.30, 10);
    expect(styleTerms('balanced', { ...NEUTRAL_FEATURES, attack: true, killChance: 1, move: true, approach: 1, allyNear: false, exposure: 1 })).toBe(0);
  });
});

describe('V19 §2.5 决策质量', () => {
  it.each(['skilled', 'expert', 'master'] as const)('P1 控制后击杀：%s 让 A 眩晕 E1，B 随后攻击 E1', (ability) => {
    const a = make('a', 'ally', { weaponLevel: 1, abilityBlueprints: [{ id: 'generic:debuff:stun', level: 5, name: '眩晕' }] });
    const b = make('b', 'ally', { weaponClass: 'dagger' }), e1 = make('e1', 'enemy'), e2 = make('e2', 'enemy');
    const battle = grid([a, b, e1, e2], { ally: { ability, style: 'balanced' } });
    a.pos = at(3, 5); b.pos = at(6, 4); e1.pos = at(6, 3); e2.pos = at(0, 3);
    const budgets: { previews: number; budget: number }[] = [];
    battle.aiTrace = event => { if (event.stage === 'command-previews') budgets.push(event as never); };
    battle.autoAction(a.id);
    expect(battle.log.find(entry => entry.kind === 'ability' && entry.participants?.[0] === a.id)?.participants?.[1]).toBe(e1.id);
    battle.autoAction(b.id);
    expect(battle.log.filter(entry => entry.resolution?.attackerId === b.id).every(entry => entry.resolution!.defenderId === e1.id)).toBe(true);
    expect(budgets.every(row => row.previews <= row.budget)).toBe(true);
  });
  it('P2 双目标分配：大师 S1→T2、S2→T1，第一轮清场', () => {
    const shooter = (id: string) => make(id, 'ally', { scale: 'company', hpMax: 30, level: 10, weaponClass: 'rifle', weaponLevel: 10 });
    const target = (id: string, members: number) => make(id, 'enemy', { scale: 'company', hpMax: members, level: 1, weaponLevel: 1 });
    const s1 = shooter('a1'), s2 = shooter('a2'), t1 = target('t1', 3), t2 = target('t2', 10); t2.hp = 1;
    const battle = new MassBattle({ combatants: [s1, s2, t1, t2], rules: V19_OVERFLOW_TW, traitRegistry: registry, seed: 'command-v2-p2' });
    battle.commanderProfiles = { ally: { ability: 'master', style: 'balanced' } }; battle.start();
    s1.formationPosition = 'ally:左翼:front'; s2.formationPosition = 'ally:右翼:rear'; t1.formationPosition = 'enemy:右翼:front'; t2.formationPosition = 'enemy:左翼:reserve';
    battle.autoOrders('ally');
    expect([battle.orders.get(s1.id)?.targetId, battle.orders.get(s2.id)?.targetId]).toEqual([t2.id, t1.id]);
    battle.autoOrders('enemy'); battle.resolveRound();
    expect([t1.status, t2.status].every(status => status !== 'ready')).toBe(true);
  });
  it.each(['expert', 'master'] as const)('P3 暴露代价：%s 选不在两名已知敌人触及内的落点', (ability) => {
    // 目标两侧各一个落点（上下是墙），左侧落点在两名长兵器的触及内；右边的友军负责看见目标。
    const actor = make('a', 'ally'), mark = make('t', 'enemy', { level: 1, weaponLevel: 1, hpMax: 8 }), watcher = make('w', 'ally');
    const spear1 = make('s1', 'enemy', { weaponClass: 'spear' }), spear2 = make('s2', 'enemy', { weaponClass: 'spear' });
    const battle = grid([actor, mark, spear1, spear2, watcher], { ally: { ability, style: 'balanced' } as CommanderProfile }, [at(3, 1), at(3, 3)]);
    actor.pos = at(3, 4); mark.pos = at(3, 2); spear1.pos = at(0, 2); spear2.pos = at(1, 1); watcher.pos = at(6, 2);
    battle.autoAction(actor.id);
    expect(actor.pos).not.toBe(at(2, 2));
    expect(battle.log.some(entry => entry.resolution?.attackerId === actor.id && entry.resolution.defenderId === mark.id)).toBe(true);
  });
});

describe('V19 §5.4 读档', () => {
  it('读档后本轮记录一致，继续战斗逐步相同', () => {
    const units = [make('a', 'ally', { weaponClass: 'bow' }), make('b', 'ally'), make('e', 'enemy'), make('f', 'enemy', { weaponClass: 'bow' })];
    const battle = grid(units, { ally: { ability: 'expert', style: 'mobile' }, enemy: { ability: 'novice', style: 'aggressive' } });
    units[0]!.pos = at(1, 7); units[1]!.pos = at(3, 6); units[2]!.pos = at(3, 2); units[3]!.pos = at(5, 1);
    const step = (b: SmallBattle) => { if (b.active?.status === 'ready') b.autoAction(b.active.id); else b.endTurn(); };
    for (let i = 0; i < 9 && !battle.isOver(); i++) step(battle);
    const saved = JSON.parse(JSON.stringify(battle.toSnapshot()));
    expect(saved.commandRounds.flatMap((r: { attacked: Record<string, string[]> }) => Object.values(r.attacked).flat()).length).toBeGreaterThan(0);
    const restored = SmallBattle.fromSnapshot(structuredClone(saved), { traitRegistry: registry });
    expect(JSON.parse(JSON.stringify(restored.toSnapshot())).commandRounds).toEqual(saved.commandRounds);
    for (let i = 0; i < 12; i++) { step(battle); step(restored); }
    expect(JSON.stringify(restored.toSnapshot())).toBe(JSON.stringify(battle.toSnapshot()));
  });
});
