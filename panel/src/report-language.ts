import { displayNumber } from '../../engine/src/display-number.js';
import type { BattleLogEntry } from '../../engine/src/types.js';

const headings: Readonly<Record<string, string>> = {
  '战阵·新增战况': 'Battle System · New Events', '战阵·战斗终章': 'Battle System · Epilogue',
  '战阵·当前状态': 'Battle System · Current Status', '战阵·会战状态': 'Battle System · Formation Battle Status',
  '战阵·战后状况': 'Battle System · After the Battle', '胜负原因': 'Outcome', '本场规则': 'Battle Rules', '战场': 'Battlefield',
  '开局单位状态与血量': 'Opening Unit Status and HP', '结束单位状态与血量': 'Final Unit Status and HP',
  '伤害来源': 'Damage Sources', '道具使用和效果': 'Item Use and Effects', '坐骑与载具': 'Mounts and Vehicles',
  '消息与交涉': 'Messages and Diplomacy', '最新状态': 'Latest Status',
  '已被重战替代的历史战报：仅供对照，不代表当前战果': 'Historical Report Superseded by a Rematch',
};

/** Older archives contain prose only. Translate known headings and leave the facts as recorded. */
export function englishReportHeadings(text: string): string {
  return text.replace(/^【([^】]+)】/gm, (heading, title: string) => {
    const translated = Object.hasOwn(headings, title) ? headings[title] : undefined;
    if (translated) return `【${translated}】`;
    const summary = /^(战阵·回合纪要·(?:共|最近)|会战结算·共|战斗结算·共)(\d+)回合$/.exec(title);
    if (summary) {
      const caption = summary[1]!.startsWith('战阵') ? 'Round-by-Round Report' : summary[1]!.startsWith('会战') ? 'Formation Battle Results' : 'Battle Results';
      return `【${caption} · ${summary[1]!.endsWith('最近') ? 'Last ' : ''}${summary[2]} rounds】`;
    }
    const round = /^第(\d+)(?:轮|回合)$/.exec(title);
    return round ? `【Round ${round[1]}】` : heading;
  });
}

/** Translate ordinary resolved attacks. Keep specialist events and player-authored text verbatim. */
export function englishReportAttack(entries: readonly BattleLogEntry[], fallback: string): string {
  if (!entries.length || entries.some(e => e.kind !== 'attack' || !e.resolution || e.communication || e.transport
    || e.resolution.onHitConditions?.length || e.resolution.damageChannels?.length || e.structure || /借机|反击|反应/.test(e.text))) return fallback;
  const first = entries[0]!.resolution!, last = entries.at(-1)!.resolution!;
  const hits = entries.reduce((count, e) => count + Number(e.resolution!.hit), 0);
  const damage = entries.reduce((total, e) => total + e.resolution!.finalDamage, 0);
  const life = first.damageModel === 'member-health' || first.defenderScale === 'hero';
  const lines = [hits ? `${entries.length > 1 ? `${hits}/${entries.length} hits` : 'Hit'} · ${displayNumber(damage)} ${life ? 'HP lost' : 'lost'} (${displayNumber(first.hpBefore)} → ${displayNumber(last.hpAfter)})` : 'Missed'];
  if (entries.some(e => e.resolution!.crit)) lines.push('Critical hit');
  const blocked = entries.filter(e => e.resolution!.hit && e.resolution!.penetrationFactor === 0).length;
  if (blocked) lines.push(blocked === hits ? 'Did not penetrate' : `${blocked} hits did not penetrate`);
  if (first.attackerHeight !== undefined && first.defenderHeight !== undefined && first.attackerHeight !== first.defenderHeight) {
    lines.push(`Elevation ${first.attackerHeight} → ${first.defenderHeight}`);
  }
  const sum = (key: 'energyAbsorbed' | 'energyOverloaded' | 'barrierAbsorbed') => entries.reduce((total, e) => total + (e.resolution![key] ?? 0), 0);
  const energy = sum('energyAbsorbed'), barrier = sum('barrierAbsorbed'), overloaded = sum('energyOverloaded');
  if (energy) {
    const spent = entries.some(e => e.resolution!.energySpent !== undefined) ? entries.reduce((total, e) => total + (e.resolution!.energySpent ?? e.resolution!.energyAbsorbed ?? 0), 0) : undefined;
    lines.push(`Energy shield absorbed ${displayNumber(energy)}${spent === undefined ? '' : ` (${displayNumber(spent)} shield spent)`}`);
  }
  if (barrier) lines.push(`Barrier absorbed ${displayNumber(barrier)}`);
  if (overloaded) lines.push(`Energy shield overloaded (${overloaded})`);
  if (entries.some(e => e.resolution!.shieldBroken)) lines.push('Shield broke');
  if (first.membersBefore !== undefined && last.membersAfter !== undefined && first.membersBefore > last.membersAfter) lines.push(`${first.membersBefore - last.membersAfter} members lost`);
  if (last.hpAfter <= 0) lines.push(last.defenderStatus === 'dying' ? 'Dying' : 'Defeated');
  const weapons = [...new Set(entries.flatMap(e => e.volley ? [e.volley.weapon] : []))];
  const weaponLabel = weapons.length ? '［' + weapons.join(', ') + '］' : /^［[^］\n]+］/.exec(entries[0]!.text)?.[0] ?? '';
  return `${weaponLabel}${first.attackerName} → ${first.defenderName}: ${lines.join(' · ')}`;
}
