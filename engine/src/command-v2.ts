/**
 * 2.3「统帅」（规则 V19 / command-v2）：水平只体现在 AI 的决策质量上，风格只改变打法。
 * 不改单位属性、命中骰、伤害、视野或可用资源。依据 docs/command-v2-spec-20261017.md。
 */
import { combatSide } from './battle-control.js';
import { commandNoise, type CommanderProfile, type CommanderProfiles } from './commander-profile.js';
import type { BattleLogEntry, Combatant, RulePack } from './types.js';

/** §5.1、§5.2 旋钮：全局风格权重 s、新手估值误差、大师比较阈值、大师来袭估值系数。 */
export const COMMAND_KNOBS = { styleWeight: 1.5, noviceError: .18, masterCompare: .10, masterIncoming: 1.5 };
export const isCommandV2 = (rules: Pick<RulePack, 'commandModel'>): boolean => rules.commandModel === 'command-v2';
export const DEFAULT_COMMAND: CommanderProfile = { ability: 'regular', style: 'balanced' };
type Ability = CommanderProfile['ability'];
type Style = CommanderProfile['style'];

/** §1 按单位当前的作战阵营取档案：被魅惑换边的单位用新阵营的档案；没有档案的一方按常规·均衡。 */
export function commandProfile(profiles: CommanderProfiles, unit: Combatant, units: readonly Combatant[]): CommanderProfile {
  return profiles[combatSide(unit, units) === 'ally' ? 'ally' : 'enemy'] ?? DEFAULT_COMMAND;
}

/** §2 水平：估值误差、来袭估值系数、风格执行系数、配合预判系数；方案比较只有大师。 */
export function commandQuality(ability: Ability) {
  return {
    error: { novice: COMMAND_KNOBS.noviceError, regular: .10, skilled: .05, expert: .02, master: 0 }[ability],
    incoming: { novice: .5, regular: 1, skilled: 1, expert: 1.25, master: COMMAND_KNOBS.masterIncoming }[ability],
    style: { novice: 1.5, regular: 1, skilled: 1, expert: .85, master: .7 }[ability],
    cooperation: { novice: 0, regular: 0, skilled: .5, expert: .75, master: 1 }[ability],
    compare: ability === 'master',
  };
}

export interface StyleParameters {
  range: 'any' | 'close' | 'max';
  advance: 'now' | 'together' | 'wait' | 'front';
  target: 'default' | 'kill' | 'flank' | 'works' | 'rear' | 'intercept' | 'counter' | 'core';
  formation: 'loose' | 'tight' | 'layers' | 'core' | 'avoid';
  exposure: 'default' | 'high' | 'mid' | 'low';
  retreat: number;
  reinforce: boolean;
  reserve: number;
}
/** §3.1 风格参数表。 */
export const COMMAND_STYLES: Record<Style, StyleParameters> = {
  balanced: { range: 'any', advance: 'now', target: 'default', formation: 'loose', exposure: 'default', retreat: 0, reinforce: false, reserve: 2 },
  aggressive: { range: 'close', advance: 'now', target: 'kill', formation: 'loose', exposure: 'high', retreat: 0, reinforce: false, reserve: 0 },
  cautious: { range: 'max', advance: 'together', target: 'kill', formation: 'tight', exposure: 'low', retreat: .5, reinforce: false, reserve: 3 },
  flanking: { range: 'close', advance: 'now', target: 'flank', formation: 'loose', exposure: 'mid', retreat: .3, reinforce: false, reserve: 0 },
  firepower: { range: 'max', advance: 'together', target: 'flank', formation: 'tight', exposure: 'mid', retreat: .3, reinforce: false, reserve: 0 },
  ambush: { range: 'any', advance: 'wait', target: 'kill', formation: 'tight', exposure: 'low', retreat: .3, reinforce: false, reserve: 2 },
  siege: { range: 'any', advance: 'together', target: 'works', formation: 'tight', exposure: 'mid', retreat: .3, reinforce: false, reserve: 2 },
  infiltration: { range: 'close', advance: 'now', target: 'rear', formation: 'avoid', exposure: 'mid', retreat: .3, reinforce: false, reserve: 0 },
  skirmish: { range: 'max', advance: 'now', target: 'kill', formation: 'loose', exposure: 'low', retreat: .5, reinforce: false, reserve: 0 },
  forward: { range: 'any', advance: 'front', target: 'intercept', formation: 'tight', exposure: 'mid', retreat: 0, reinforce: false, reserve: 0 },
  depth: { range: 'any', advance: 'together', target: 'kill', formation: 'layers', exposure: 'low', retreat: .5, reinforce: false, reserve: 4 },
  mobile: { range: 'any', advance: 'together', target: 'counter', formation: 'loose', exposure: 'mid', retreat: .3, reinforce: true, reserve: 4 },
  core: { range: 'any', advance: 'wait', target: 'core', formation: 'core', exposure: 'mid', retreat: .3, reinforce: false, reserve: 3 },
};
export const COMMAND_ABILITY_LABELS: Record<Ability, string> = { novice: '新手', regular: '常规', skilled: '熟练', expert: '专家', master: '大师' };
export const COMMAND_STYLE_LABELS: Record<Style, string> = { balanced: '均衡', aggressive: '积极进攻', cautious: '谨慎保全', flanking: '迂回机动', firepower: '集中火力', ambush: '伏击固守', siege: '稳步攻坚', infiltration: '渗透袭扰', skirmish: '游击消耗', forward: '前沿坚守', depth: '纵深防御', mobile: '机动防御', core: '核心固守' };
/** §4.1 打法说明。 */
export const COMMAND_STYLE_DESCRIPTIONS: Record<Style, string> = {
  balanced: '按局势选择进攻、防守和支援', aggressive: '尽快接敌，优先打能击倒的目标，不惧暴露', cautious: '保持射程，结伴推进，避开暴露位置，伤重就撤',
  flanking: '贴近敌人，围攻已被缠住的目标，从侧面加入', firepower: '远程保持射程，集中打同一目标，结伴推进', ambush: '敌人进入范围前按兵不动，避开暴露',
  siege: '结伴推进，优先打工事里的敌人和破障，掩护工兵', infiltration: '绕开敌方近战，直扑远程、火炮和施法单位', skirmish: '保持在敌方近战触及之外射击，伤重就撤',
  forward: '在前沿结成战线，拦截进入前沿的敌人', depth: '分层布置，第二线接应，伤重的单位后撤', mobile: '预备队向被攻击的友军增援，反击来犯之敌', core: '守在核心单位身边，优先打接近它的敌人',
};
export const commandLabel = (profile: CommanderProfile): string => COMMAND_ABILITY_LABELS[profile.ability] + '·' + COMMAND_STYLE_LABELS[profile.style];
/** §4 开战记录：每方一行。 */
export const commandOpening = (profiles: CommanderProfiles): string[] => (['ally', 'enemy'] as const).map(side => {
  const profile = profiles[side] ?? DEFAULT_COMMAND;
  return `指挥：${side === 'ally' ? '我方' : '敌方'} ${commandLabel(profile)}`;
});
/** §3.1 队形决定小战 cohesion 默认值；玩家写了 preferences.cohesion 的以玩家为准。 */
export const commandCohesion = (profile: CommanderProfile): number => profile.preferences?.cohesion ?? { loose: 2, tight: 3, layers: 2, core: 3, avoid: 1 }[COMMAND_STYLES[profile.style].formation];

/** §3.4 候选特征。会战按 §3.3 的换算填同一组字段。 */
export interface StyleFeatures {
  move: boolean; attack: boolean; ranged: boolean; stay: boolean; breach: boolean;
  /** 落点 */
  approach: number; exposure: number; retreat: boolean; closer: boolean; allyNear: boolean;
  frontline: boolean; leavingFront: boolean; secondLine: boolean; nearCore: boolean; safePath: boolean;
  /** 小战：近战单位移到贴近被友军缠住的敌人且不在同一侧；会战：与已接敌友军攻击同一目标且阵位不同。 */
  flankMove: boolean; reinforce: boolean;
  /** 自身 */
  rangedUnit: boolean; safeRange: boolean; inEnemyReach: boolean; idle: boolean; hpRatio: number; engaged: boolean;
  /** 目标 */
  killChance: number; flanked: boolean; focused: boolean; backline: boolean; fortified: boolean; nearEngineer: boolean; targetNearCore: boolean; counter: boolean; intercept: boolean;
}
export const NEUTRAL_FEATURES: Readonly<StyleFeatures> = {
  move: false, attack: false, ranged: false, stay: false, breach: false, approach: 0, exposure: 0, retreat: false, closer: false, allyNear: true,
  frontline: false, leavingFront: false, secondLine: false, nearCore: false, safePath: false, flankMove: false, reinforce: false,
  rangedUnit: false, safeRange: false, inEnemyReach: false, idle: false, hpRatio: 1, engaged: false,
  killChance: 0, flanked: false, focused: false, backline: false, fortified: false, nearEngineer: false, targetNearCore: false, counter: false, intercept: false,
};
type BehaviourParameter = Exclude<keyof StyleParameters, 'reserve'>;
/** §3.2 单个行为参数取某值时的行为项。 */
export function styleTerm(parameter: BehaviourParameter, value: StyleParameters[BehaviourParameter], f: StyleFeatures): number {
  switch (parameter) {
    case 'range':
      if (value === 'close') return (f.move ? .20 * f.approach : 0) + (f.attack && !f.ranged ? .20 : 0);
      return value === 'max' && f.rangedUnit ? (f.safeRange ? .25 : 0) - (f.inEnemyReach ? .15 : 0) : 0;
    case 'advance':
      if (value === 'together') return f.closer && !f.allyNear ? -.20 : 0;
      if (value === 'wait') return f.idle && f.stay ? .30 : 0;
      return value === 'front' ? (f.frontline ? .20 : 0) - (f.leavingFront ? .10 : 0) : 0;
    case 'target':
      if (value === 'kill') return f.attack ? .20 * f.killChance : 0;
      if (value === 'flank') return (f.attack && !f.ranged && f.flanked ? .25 : 0) + (f.attack && f.ranged && f.focused ? .25 : 0) + (f.flankMove ? .15 : 0);
      if (value === 'works') return (f.breach || f.attack && f.fortified ? .25 : 0) + (f.attack && f.nearEngineer ? .15 : 0);
      if (value === 'rear') return f.attack && f.backline ? .25 : 0;
      if (value === 'intercept') return f.attack && f.intercept ? .20 : 0;
      if (value === 'counter') return f.attack && f.counter ? .20 : 0;
      return value === 'core' && f.attack && f.targetNearCore ? .20 : 0;
    case 'formation':
      if (value === 'tight') return f.allyNear ? 0 : -.15;
      if (value === 'layers') return f.secondLine ? .15 : 0;
      if (value === 'core') return f.nearCore ? .25 : 0;
      return value === 'avoid' && f.safePath ? .10 : 0;
    case 'exposure': return value === 'mid' ? -.10 * f.exposure : value === 'low' ? -.25 * f.exposure : 0;
    case 'retreat': return value && f.hpRatio < (value as number) && f.retreat ? .20 : 0;
    case 'reinforce': return value && !f.engaged && f.reinforce ? .20 : 0;
  }
}
const BEHAVIOUR_PARAMETERS: BehaviourParameter[] = ['range', 'advance', 'target', 'formation', 'exposure', 'retreat', 'reinforce'];
/** §3.4 风格的行为项之和（纯函数，与估值误差、配合预判分开）。 */
export function styleTerms(style: Style, features: StyleFeatures): number {
  return BEHAVIOUR_PARAMETERS.reduce((sum, parameter) => sum + styleTerm(parameter, COMMAND_STYLES[style][parameter], features), 0);
}
/** §2.2 配合预判覆盖的控制状态（另有推拉进己方拒止范围）。 */
export const COORDINATED_CONTROLS = new Set(['stunned', 'restrained', 'blinded', 'disarmed', 'confused', 'charmed', 'taunted', 'exposed', 'vulnerable']);
/** 均衡的行为项全为 0，可以跳过特征计算。 */
export const styleActive = (style: Style): boolean => style !== 'balanced';

export interface CommandCandidate { key: string; score: number; attack: boolean; move: boolean; breach?: boolean; features?: StyleFeatures }
/** §3 scale = max(1, 最高分, 最高分 − 中位分)（10-18 修订）：机动时最高分常为负，只取最高分会让风格项和估值误差只值零点几分。 */
export function commandScale(scores: readonly number[]): number {
  const sorted = [...scores].sort((a, b) => b - a), best = sorted[0] ?? 0;
  return Math.max(1, best, best - (sorted[Math.floor(sorted.length / 2)] ?? best));
}
export type CommandScoreTrace = { profile: CommanderProfile; turnKey: string; scale: number; style: number[]; noise: number[]; preference: number[]; scores: number[] };
/** §3 候选分 = 原分 + scale ×（s × 风格执行系数 × Σ行为项 + 估值误差 + 偏好项）；偏好每级 0.05。 */
export function commandScores(choices: CommandCandidate[], profile: CommanderProfile, turnKey: string, trace?: (event: CommandScoreTrace) => void): number[] {
  const quality = commandQuality(profile.ability), scale = commandScale(choices.map(c => c.score)), p = profile.preferences ?? {};
  const style = choices.map(c => c.features ? COMMAND_KNOBS.styleWeight * quality.style * styleTerms(profile.style, c.features) : 0);
  const noise = choices.map(c => commandNoise(turnKey, c.key) * quality.error);
  const preference = choices.map(c => (c.breach ? ((p.breach ?? 2) - 2) * .05 : 0) + (c.attack ? ((p.risk ?? 2) - 2) * .05 : 0) + (c.move && c.attack ? ((p.counterattack ?? 2) - 2) * .05 : 0));
  const scores = choices.map((c, i) => c.score + scale * (style[i]! + noise[i]! + preference[i]!));
  trace?.({ profile, turnKey, scale, style, noise, preference, scores });
  return scores;
}

/** §1 本轮记录：各方攻击过的目标、攻击过各方的单位、本轮开始时的位置。保留本轮和上一轮（见结果文档）。 */
export interface CommandRound {
  round: number;
  attacked: Partial<Record<'ally' | 'enemy', string[]>>;
  attackers: Partial<Record<'ally' | 'enemy', string[]>>;
  starts: Record<string, number | string>;
}
export function beginCommandRound(rounds: readonly CommandRound[], round: number, units: readonly Combatant[], place: (unit: Combatant) => number | string | undefined): CommandRound[] {
  const starts: Record<string, number | string> = {};
  for (const unit of units) { const at = place(unit); if (at !== undefined) starts[unit.id] = at; }
  return [...rounds.slice(-1), { round, attacked: {}, attackers: {}, starts }];
}
/** 武器、反应与技能结算里的敌对双方；增益技能指向己方，不计。 */
export function noteCommandAttack(rounds: CommandRound[], entry: BattleLogEntry, units: readonly Combatant[]): void {
  const current = rounds.at(-1); if (!current) return;
  const pairs = (entry.resolutions?.length ? entry.resolutions : entry.resolution ? [entry.resolution] : []).map(r => [r.attackerId, r.defenderId] as const);
  const [actorId, ...targets] = entry.kind === 'ability' ? entry.participants ?? [] : [];
  const all = [...pairs, ...(actorId ? targets.map(id => [actorId, id] as const) : [])];
  for (const [attackerId, defenderId] of all) {
    const attacker = units.find(u => u.id === attackerId), defender = units.find(u => u.id === defenderId);
    if (!attacker || !defender) continue;
    const from = combatSide(attacker, units), to = combatSide(defender, units);
    if (from === to || from === 'neutral' || to === 'neutral') continue;
    const attacked = current.attacked[from] ??= [], attackers = current.attackers[to] ??= [];
    if (!attacked.includes(defender.id)) attacked.push(defender.id);
    if (!attackers.includes(attacker.id)) attackers.push(attacker.id);
  }
}
/** side 在本轮和上一轮攻击过的目标。 */
export const commandAttacked = (rounds: readonly CommandRound[], side: 'ally' | 'enemy'): Set<string> => new Set(rounds.flatMap(r => r.attacked[side] ?? []));
/** 本轮和上一轮攻击过 side 的单位。 */
export const commandAttackers = (rounds: readonly CommandRound[], side: 'ally' | 'enemy'): Set<string> => new Set(rounds.flatMap(r => r.attackers[side] ?? []));
/** 记录窗口开始时的位置；没有记录时取当前位置。 */
export const commandStart = (rounds: readonly CommandRound[], unit: Combatant, now: number | string | undefined): number | string | undefined => rounds.length ? rounds[0]!.starts[unit.id] : now;
/** 存档读取（信任边界）。 */
export function readCommandRounds(value: unknown): CommandRound[] {
  const ids = (list: unknown) => Array.isArray(list) && list.every(id => typeof id === 'string');
  const sides = (map: unknown) => !!map && typeof map === 'object' && !Array.isArray(map) && Object.entries(map).every(([side, list]) => ['ally', 'enemy'].includes(side) && ids(list));
  if (!Array.isArray(value) || value.length > 2 || !value.every((r: CommandRound) => r && Number.isSafeInteger(r.round) && r.round >= 1 && sides(r.attacked) && sides(r.attackers)
    && !!r.starts && typeof r.starts === 'object' && !Array.isArray(r.starts) && Object.values(r.starts).every(at => typeof at === 'string' || Number.isSafeInteger(at) && (at as number) >= 0))) throw Error('指挥本轮记录损坏');
  return structuredClone(value as CommandRound[]);
}
