import { tbWeaponShortName } from '../weapon-name.js';
import { spCapacity } from '../resources.js';
import { NARRATIVE_TASK } from './narrative-task.js';
import { standardConditionMap } from '../conditions.js';
import { isAirborne } from '../aerial.js';
import { cellLabel } from '../small/spatial.js';
import { formationNode } from '../mass/formation.js';
import { woundedLabel } from '../recovery.js';
import {hasMemberHealth,memberHealth,memberHealthMax,memberHealthSummary,memberNoun} from '../member-health.js';
/**
 * 注入文案层：引擎状态 → 提示词文本（单向投影）。
 * 面板用同一文本源渲染结算卡与注入，保证"引擎算的=AI看的=玩家看的"。
 */

import type { BattleLogEntry, Combatant } from '../types.js';
import type { SmallBattle } from '../small/battle.js';
import type { MassBattle } from '../mass/battle.js';
import { bandLabel } from '../small/battle.js';
import { getTrait } from '../bonus.js';
import { activeTraitIds } from '../trait-sources.js';
import { scaleLabel } from '../unit-scale.js';

/** 判别是军团会战（有指挥点 cp）还是小规模战斗（有坐标 pos） */
function isMass(b: SmallBattle | MassBattle): b is MassBattle {
  return (b as MassBattle).cp !== undefined;
}

const STATUS_WORD: Record<Combatant['status'], string> = {
  ready: '',
  dying: '｜倒地失去战斗力（尚未死亡）',
  dead: '｜†死亡',
  routing: '｜溃逃',
  fled: '｜↩撤离',
};

/** 状态摘要的主控标记选项 */
export interface SummaryOpts {
  /** 主控单位 id：摘要中打【主控】标记，并用于指挥权约束。 */
  protagonistId?: string;
  includeRecent?: boolean;
  directives?: boolean;
}

function hpLabel(u: Combatant): string {
  const core = hasMemberHealth(u)?`现员${u.hp}/${u.base.hpMax}${memberNoun(u)} 总生命${memberHealth(u)}/${memberHealthMax(u)}（${memberHealthSummary(u,Infinity)}）`:`${u.scale === 'company' ? '人数' : 'HP '}${u.hp}/${u.base.hpMax}`;
  const morale = u.morale !== undefined ? ` 士气${u.morale}` : '';
  const defs = standardConditionMap();
  const conds = u.conditions.filter((c) => c.dur > 0).map((c) => (defs.get(c.id)?.name ?? c.id) + c.dur + '轮').join('、');
  return `${core}${morale}${conds ? ' [' + conds + ']' : ''}${woundedLabel(u) ? '｜' + woundedLabel(u) : ''}${u.scale === 'company' && u.status === 'dead' ? '｜编队失去战斗力' : STATUS_WORD[u.status]}`;
}

function traitNames(u: Combatant, registry?: Map<string, import('../types.js').Trait>): string {
  const names = activeTraitIds(u)
    .map((id) => getTrait(id, registry)?.name ?? id)
    .slice(0, 4)
    .join('·');
  return names ? `(${names})` : '';
}

/** 当前态势与最近关键变化；只使用已公开战场事实。 */
export function smallStateSummary(
  b: SmallBattle,
  era?: string,
  registry?: Map<string, import('../types.js').Trait>,
  opts: SummaryOpts = {},
): string {
  const lines: string[] = [];
  const pc = opts.protagonistId;
  lines.push(`【战阵·当前状态】${b.isOver() ? '战斗已结束' : `第${b.round}回合｜轮到：${b.visibleCombatants('ally').find((u) => u.id === b.active?.id)?.name ?? '未定位的敌方行动'}`}`);
  for (const side of ['ally', 'enemy'] as const) {
    const units = (b.isOver() ? b.combatants : b.visibleCombatants('ally')).filter((c) => c.side === side);
    if (!units.length) continue;
    const label = side === 'ally' ? '我方' : '敌方';
    lines.push(
      `${label}：${units
        .map((u) => `${pc === u.id ? '【主控】' : ''}${u.name}${smallPosition(b, u)} ${hpLabel(u)}${unitReadiness(b, u)}`)
        .join('；')}`,
    );
  }
  if (b.isOver()) lines.push(b.log.filter((e) => e.kind === 'battle-end').at(-1)?.text ?? '');
  lines.push(...battleSituation(b));
  if (opts.includeRecent !== false) lines.push(...recentEvents(b));
  if (opts.directives !== false) lines.push(...narrativeDirectives());
  return lines.join('\n');
}

/** 军团会战的状态摘要注入 */
export function massStateSummary(
  b: MassBattle,
  era?: string,
  registry?: Map<string, import('../types.js').Trait>,
  opts: SummaryOpts = {},
): string {
  const lines: string[] = [];
  const pc = opts.protagonistId;
  const cmdWord = b.commanderId
    ? `｜我方指挥：${b.commanderLost ? '†主帅倒下，军令自动' : (b.combatants.find((c) => c.id === b.commanderId)?.name ?? '—')}`
    : '';
  lines.push(
    `【战阵·会战状态】${b.isOver() ? '会战已结束' : `第${b.round}回合${b.rules.resolutionVersion === 'v2' ? '' : `｜我方指挥点${b.cp.ally}｜敌方指挥点${b.cp.enemy}`}${cmdWord}`}`,
  );
  for (const side of ['ally', 'enemy'] as const) {
    const units = (b.isOver() ? b.combatants : b.visibleCombatants('ally')).filter((c) => c.side === side);
    if (!units.length) continue;
    const label = side === 'ally' ? '我军' : '敌军';
    lines.push(
      `${label}：${units
        .map((u) => {
          const node = u.rulesVersion === 'v2' ? formationNode(u) : undefined;
          const zone = node ? `${node.wing}${({ front: '前列', rear: '后列', reserve: '预备列' })[node.rank]}·` : b.zones ? `${b.zoneOf(u)}·` : '';
          const engage = u.engagedWith.length ? '⚔' : '';
          const marks = `${pc === u.id ? '【主控】' : ''}${side === 'ally' && b.commanderId === u.id ? '【指挥官】' : ''}`;
          return `${zone}${marks}${u.name}${engage} ${hpLabel(u)}${unitReadiness(b, u)}`;
        })
        .join('；')}`,
    );
  }
  if (b.isOver()) lines.push(b.log.filter((e) => e.kind === 'battle-end').at(-1)?.text ?? '');
  lines.push(...battleSituation(b));
  if (opts.includeRecent !== false) lines.push(...recentEvents(b));
  if (opts.directives !== false) lines.push(...narrativeDirectives());
  return lines.join('\n');
}

/** 叙述任务指令（注入的权威性约束；与世界书协议措辞保持一致） */
function narrativeDirectives(): string[] {
  return [NARRATIVE_TASK];
}

function smallPosition(b: SmallBattle, u: Combatant): string {
  const distance = b.distToNearestFoe(u);
  return b.battlefield && u.pos !== undefined ? '(' + cellLabel(b.battlefield, u.pos) + (Number.isFinite(distance) ? '·距已知敌' + distance + '格' : '·未定位敌军') + ')'
    : Number.isFinite(distance) ? '(距敌' + bandLabel(distance) + ')' : '(未定位敌军)';
}
function unitReadiness(b: SmallBattle | MassBattle, u: Combatant): string {
  if (u.status === 'dead' || u.status === 'fled') return '';
  const info = [u.weapon?.name ?? '无主武器', isAirborne(u) ? '空中' : '', u.suppression ? '受压制' : '', u.tacticalPose ? '固守' : '',
    (b.reloadCd.get(u.id) ?? 0) > 0 ? (tbWeaponShortName(u.weapon) || '主武器') + '装填' : '', u.fatigue ? '疲劳' + u.fatigue : ''];
  if (u.side === 'ally') {
    info.push('SP' + (u.resources.SP ?? 0) + '/' + spCapacity(u));
    for (const ability of u.abilities.filter((a) => u.preparedAbilityIds?.includes(a.id))) {
      const cd = u.abilityState.find((s) => s.abilityId === (ability.cooldownGroup ?? ability.id))?.cdLeft ?? 0;
      info.push(ability.name + (cd > 0 ? '冷却' + cd : ''));
    }
  }
  return info.some(Boolean) ? '｜' + info.filter(Boolean).join('·') : '';
}
function battleSituation(b: SmallBattle | MassBattle): string[] {
  const lines: string[] = [];
  if (b.fieldTags.length) lines.push('环境：' + b.fieldTags.join('/'));
  if (!isMass(b) && b.battlefield) {
    const goal = b.battlefield.objective;
    lines.push(goal.kind === 'annihilation' ? '任务：歼灭敌军' : goal.kind === 'control'
      ? '任务：' + (goal.attackingSide === 'enemy' ? '敌方' : '我方') + '攻占' + cellLabel(b.battlefield, goal.cell) + '，连续控制' + b.controlRounds[goal.attackingSide ?? 'ally'] + '/' + goal.rounds + '轮'
      : '任务：护送' + (b.visibleCombatants('ally').find((u) => u.id === goal.unitId)?.name ?? '未定位目标') + '至' + cellLabel(b.battlefield, goal.cell));
  }
  return lines;
}

/** 结算卡：把若干日志条目格式化为可插入聊天/注入的文本块。
 *  wholeBattle=true 时标题标明整场（面板结算卡输出全战斗记录用）。 */
export function settlementCard(
  entries: BattleLogEntry[],
  round: number,
  mass = false,
  opts: { wholeBattle?: boolean } = {},
): string {
  const body = entries
    .filter((e) => e.kind !== 'round' && e.kind !== 'initiative')
    .map((e) => `▸ ${e.text}`)
    .join('\n');
  if (!body) return '';
  const head = opts.wholeBattle
    ? mass
      ? `【会战结算·共${round}回合】`
      : `【战斗结算·共${round}回合】`
    : mass
      ? `【第${round}回合·会战结算】`
      : `【第${round}回合·结算记录】`;
  return `${head}\n${body}`;
}

/** 回合纪要收录移动、行动、技能、交战、状态与战斗结束，但省略先攻和回合分隔。 */
const DIGEST_KINDS = new Set<BattleLogEntry['kind']>([
  'attack',
  'ability',
  'condition',
  'morale',
  'routing',
  'death',
  'move',
  'battle-end',
]);

/** 单条攻击的纪要行：从结构化 resolution 压缩（不含骰面与伤害构成，那是结算卡的职责）。
 *  前缀（战区/骑射反击/齐射段数/借机攻击）取原文去掉尾部结算文本的剩余段。 */
function digestAttackLine(e: BattleLogEntry): string | undefined {
  const res = e.resolution;
  if (!res) return undefined; // 装填中等无 resolution 的 attack 条目不进纪要
  const prefix = e.text.endsWith(res.text)
    ? e.text.slice(0, e.text.length - res.text.length).replace(/｜$/, '')
    : '';
  const head = `${res.attackerName}→${res.defenderName}`;
  const body = res.hit
    ? `${res.crit ? '✦暴击' : '命中'}${res.finalDamage}${res.damageModel==='member-health'?'生命':''}（${res.hpBefore}→${res.hpAfter}）${res.damageModel==='member-health'&&res.defenderScale!=='hero'&&res.membersBefore!==undefined&&res.membersAfter!==undefined?`，减员${res.membersBefore-res.membersAfter}`:''}`
    : '未中';
  const fell = res.hpAfter <= 0 ? res.defenderStatus === 'dying' ? '（濒死）' : '†' : '';
  return `${prefix ? `${prefix}｜` : ''}${head} ${body}${fell}`;
}

/** 技能日志只保留“谁释放了什么”和紧凑效果；完整骰面仍留在结算卡。 */
function digestAbilityLines(e: BattleLogEntry): string[] {
  const raw = e.text.split('\n').filter(Boolean);
  const lines = raw.length ? [raw[0]!] : [];
  if (e.resolution) {
    for(const r of e.resolutions?.length?e.resolutions:[e.resolution])lines.push(`${r.attackerName}→${r.defenderName} ${r.hit ? `${r.crit ? '✦暴击' : '命中'}${r.finalDamage}${r.damageModel==='member-health'?'生命':''}（${r.hpBefore}→${r.hpAfter}）${r.damageModel === 'member-health' && r.defenderScale !== 'hero' && r.membersBefore !== undefined && r.membersAfter !== undefined ? `，减员${r.membersBefore - r.membersAfter}` : ''}` : '未中'}`);
  }
  for (const line of raw.slice(1)) {
    if (/d20\[|命中率\d+%|^伤害 /.test(line)) continue;
    if (/治疗|获得【|士气|【召唤】|召唤失败|召唤请求/.test(line)) lines.push(line);
  }
  return [...new Set(lines)];
}

/** 相邻同一攻击者/目标的速射合并；状态、借机与其他行动的顺序保留。 */
export function compactEvents(entries: BattleLogEntry[]): string[] {
  const lines: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    if (e.kind === 'attack' && e.resolution) {
      const volley = [e];
      while (!/借机|反击|反应/.test(e.text) && entries[i + 1]?.kind === 'attack' && entries[i + 1]?.resolution
        && !/借机|反击|反应/.test(entries[i + 1]!.text)
        && entries[i + 1]!.resolution!.attackerId === e.resolution.attackerId
        && entries[i + 1]!.resolution!.defenderId === e.resolution.defenderId
        && entries[i + 1]!.round === e.round) volley.push(entries[++i]!);
      if (volley.length === 1) lines.push(digestAttackLine(e)!);
      else {
        const hits = volley.filter((v) => v.resolution!.hit).length, last = volley.at(-1)!.resolution!;
        const damage = volley.reduce((n, v) => n + v.resolution!.finalDamage, 0);
        lines.push(e.resolution.attackerName + '→' + e.resolution.defenderName + ' ' + volley.length + '段/' + hits + '中，损失' + damage + '（' + e.resolution.hpBefore + '→' + last.hpAfter + '）' + (volley.some((v) => v.resolution!.crit) ? '·含暴击' : ''));
      }
    } else if (e.kind === 'ability') lines.push(...digestAbilityLines(e));
    else if (e.kind !== 'attack') {
      // 仅合并真实连续格子移动，保留起终点；借机、起飞、撤离等事件打断该段。
      let text = e.text.split('\n').filter((line) => !/d20\[|^伤害 /.test(line)).join('；');
      const move = /^(.* )([A-Z]\d+)→([A-Z]\d+)$/.exec(text);
      if (e.kind === 'move' && move && e.participants?.length) {
        let end = move[3]!;
        while (entries[i + 1]?.kind === 'move' && entries[i + 1]?.round === e.round && e.participants.join() === entries[i + 1]?.participants?.join()) {
          const next = /^(.* )([A-Z]\d+)→([A-Z]\d+)$/.exec(entries[i + 1]!.text);
          if (!next || next[1] !== move[1] || next[2] !== end) break;
          end = next[3]!; i++;
        }
        text = move[1]! + move[2]! + '→' + end;
      }
      if (text && lines.at(-1) !== text) lines.push(text);
    }
  }
  return lines;
}
function recentEvents(b: SmallBattle | MassBattle): string[] {
  const log = (b.isOver() ? b.log : b.visibleLog('ally')).filter((e) => DIGEST_KINDS.has(e.kind));
  const latest = log.at(-1)?.round; if (latest === undefined) return [];
  const lines = compactEvents(log.filter((e) => e.round >= latest - 1));
  return lines.length ? [`最近变化（第${Math.max(1, latest - 1)}–${latest}回合）：`, ...lines.slice(-10).map((line) => '▸ ' + line)] : [];
}

/**
 * 回合纪要（中等详细摘要）：按回合分组，只保留每回合各单位命中/未中、状态变化、
 * 溃退/重整等特殊事件——介于状态摘要（只有现状）与结算卡（完整骰面）之间。
 * lastRounds 只取最近 N 回合；wholeBattle 标题标明整场。空纪要返回 ''。
 */
export function roundDigest(
  b: SmallBattle | MassBattle,
  era?: string,
  _registry?: Map<string, import('../types.js').Trait>,
  opts: { wholeBattle?: boolean; lastRounds?: number; protagonistId?: string } = {},
): string {
  const rounds = [...new Set((b.isOver() ? b.log : b.visibleLog('ally')).filter((e) => DIGEST_KINDS.has(e.kind)).map((e) => e.round))].sort(
    (x, y) => x - y,
  );
  const takeRounds = opts.lastRounds ? rounds.slice(-opts.lastRounds) : rounds;
  const lines: string[] = [];
  for (const r of takeRounds) {
    const entries = (b.isOver() ? b.log : b.visibleLog('ally')).filter((e) => e.round === r && DIGEST_KINDS.has(e.kind));
    if (!entries.length) continue;
    lines.push(`【第${r}回合】`);
    lines.push(...compactEvents(entries).map((line) => '▸ ' + line));
  }
  if (!lines.length) return '';
  const mass = isMass(b);
  const lastRound = rounds[rounds.length - 1] ?? b.round;
  const head = opts.wholeBattle
    ? `【战阵·回合纪要·共${lastRound}回合】`
    : opts.lastRounds
      ? `【战阵·回合纪要·最近${opts.lastRounds}回合】`
      : '';
  const statusOpts = { protagonistId: opts.protagonistId, includeRecent: false, directives: false };
  const status = isMass(b) ? massStateSummary(b, era, _registry, statusOpts) : smallStateSummary(b, era, _registry, statusOpts);
  return [head, ...lines, status, ...narrativeDirectives()]
    .filter(Boolean)
    .join('\n');
}

/** 导出 markdown 战报 */
export function battleReport(title: string, log: BattleLogEntry[], xp: number): string {
  const lines: string[] = [`# ${title}`, ''];
  let lastRound = 0;
  for (const e of log) {
    if (e.round !== lastRound) {
      lines.push(`## 第 ${e.round} 回合`, '');
      lastRound = e.round;
    }
    lines.push(`- ${e.text.replace(/\n/g, '\n  ')}`);
  }
  if (xp > 0) lines.push('', `> 原始击杀经验：${xp}（成长经验以战后折算为准）`);
  return lines.join('\n');
}

/** 单位卡简介（面板列表用） */
export function unitCardLine(u: Combatant, era?: string, registry?: Map<string, import('../types.js').Trait>): string {
  const arch = u.archetype ? ({ infantry: '步兵', ranged: '远程', mobile: '机动' })[u.archetype] : '';
  const scaleWord = `${scaleLabel(u)}Lv${u.level}`;
  return `[${arch ? arch + '·' + scaleWord : scaleWord}] ${u.name} ${hpLabel(u)} ${traitNames(u, registry)}`;
}

/**
 * 开战态势摘要（注入用）：双方投入单位 + 环境 + 距离/阵位。
 * 只列 status != dead/fled 的单位（开战瞬间全为 ready）。
 */
export function battleIntroSummary(
  b: SmallBattle | MassBattle,
  era?: string,
  registry?: Map<string, import('../types.js').Trait>,
  opts: SummaryOpts = {},
): string {
  const lines: string[] = [];
  const mass = isMass(b);
  lines.push(`【战阵·开战态势】${b.isOver() ? '战斗已结束' : `第${b.round}回合｜轮到：${b.visibleCombatants('ally').find((u) => u.id === (b as SmallBattle).active?.id)?.name ?? '未定位的敌方行动'}`}`);
  for (const side of ['ally', 'enemy'] as const) {
    const units = (b.isOver() ? b.combatants : b.visibleCombatants('ally')).filter((c) => c.side === side && c.status !== 'dead' && c.status !== 'fled');
    if (!units.length) continue;
    const label = side === 'ally' ? '我方' : '敌方';
    lines.push(
      `${label}：${units
        .map((u) => {
          const pc = opts.protagonistId === u.id ? '【主控】' : '';
          // 小规模带距离带；军团带翼/兵员/士气/接战
          if (!mass) {
            const sb = b as SmallBattle;
            const d = sb.distToNearestFoe(u) === Infinity ? 99 : sb.distToNearestFoe(u);
            return `${pc}${u.name}(距敌${bandLabel(d)}) ${hpLabel(u)}${statusSuffix(u)}`;
          }
          const zone = b.zones ? `${b.zoneOf(u)}·` : '';
          const engage = u.engagedWith.length ? '⚔' : '';
          return `${zone}${pc}${u.name}${engage} 兵力${u.hp}/${u.base.hpMax}${u.morale !== undefined ? ` 士气${u.morale}` : ''}${statusSuffix(u)}`;
        })
        .join('；')}`,
    );
  }
  if (b.fieldTags?.length) {
    lines.push(`环境：${b.fieldTags.join('/')}`);
  }
  lines.push(...narrativeDirectives());
  return lines.join('\n');
}

/** 战后双方单位状况摘要（注入用）：区分存活/伤亡，给出胜负与经验总览。 */
export function battleAftermathSummary(
  b: SmallBattle | MassBattle,
  era?: string,
  registry?: Map<string, import('../types.js').Trait>,
  opts: SummaryOpts = {},
): string {
  const won = b.winner() === 'ally';
  const mass = isMass(b);
  const lines: string[] = [];
  const head = mass
    ? `【战阵·战后状况】${won ? '会战大捷' : b.winner() === 'draw' ? '停战／僵持' : '会战失利'}｜我方原始击杀经验 ${b.xpGained}（成长另行折算）`
    : `【战阵·战后状况】${won ? '战斗胜利' : b.winner() === 'draw' ? '僵局' : '战斗失败'}｜我方原始击杀经验 ${b.xpGained}（成长另行折算）`;
  lines.push(head);
  if (b.isOver()) lines.push(b.log.filter((e) => e.kind === 'battle-end').at(-1)?.text ?? '');
  for (const side of ['ally', 'enemy'] as const) {
    const all = b.combatants.filter((c) => c.side === side);
    const dead = all.filter((c) => c.status === 'dead' || c.status === 'fled');
    const alive = all.filter((c) => c.status !== 'dead' && c.status !== 'fled');
    const label = side === 'ally' ? '我方' : '敌方';
    const aliveStr = alive
      .map((u) => {
        const pc = opts.protagonistId === u.id ? '【主控】' : '';
        return `${pc}${u.name} ${hpLabel(u)}${statusSuffix(u)}`;
      })
      .join('；') || '—';
    const deadStr = dead
      .map((u) => `${u.name}${u.status === 'fled' ? '(撤离)' : '(阵亡)'}`)
      .join('、') || '无';
    lines.push(`${label}（存活 ${alive.length}）：${aliveStr}`);
    lines.push(`${label}（损失 ${dead.length}）：${deadStr}`);
  }
  lines.push(...narrativeDirectives());
  return lines.join('\n');
}

/** 单位状态后缀：非 ready 时标注（汇总用） */
function statusSuffix(u: Combatant): string {
  return STATUS_WORD[u.status] ?? '';
}
