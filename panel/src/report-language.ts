import { displayNumber } from '../../engine/src/display-number.js';
import { isCommunicationLog } from '../../engine/src/diplomacy.js';
import { cellLabel, type BattlefieldSpec } from '../../engine/src/small/spatial.js';
import type { BattleLogEntry } from '../../engine/src/types.js';
import { displayTextFor } from './ui-language.js';

const english = displayTextFor('en');

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
function englishReportHeadings(text: string): string {
  return text.replace(/^【([^】]+)】/gm, (heading, title: string) => {
    const translated = Object.hasOwn(headings, title) ? headings[title] : undefined;
    if (translated) return `【${translated}】`;
    const summary = /^(战阵·回合纪要·(?:共|最近)|会战结算·共|战斗结算·共)(\d+)回合$/.exec(title);
    if (summary) {
      const caption = summary[1]!.startsWith('战阵') ? 'Round-by-Round Report' : summary[1]!.startsWith('会战') ? 'Formation Battle Results' : 'Battle Results';
      return `【${caption} · ${summary[1]!.endsWith('最近') ? 'Last ' : ''}${summary[2]} ${summary[2] === '1' ? 'round' : 'rounds'}】`;
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

const eventEndings: Readonly<Record<string, string>> = {
  '阵亡': 'was killed', '死亡': 'died', '阵亡（生命归零）': 'was killed (0 HP)',
  '濒死，非致命失能': 'was incapacitated and remains alive',
  '失去战斗力': 'became combat ineffective', '撤离战场': 'withdrew from battle',
  '彻底溃散，退出战场': 'broke and left the battlefield', '仍在溃逃': 'is still routing',
  '重整旗鼓，重返战线': 'rallied and returned to combat', '屏障耗尽': 'has no barrier remaining',
  '主动装填，剩余装填时间减少1轮': 'reloaded, reducing the remaining reload time by 1 round',
  '使用加速动作': 'used a haste action', '固守': 'braced', '警戒': 'went on overwatch',
  '起飞，消耗1点移动': 'took off for 1 movement', '起飞被中断，消耗1点移动': 'was interrupted on takeoff after spending 1 movement',
  '降落，消耗1点移动': 'landed for 1 movement', '被重创，陷入【重伤】': 'was severely wounded',
  '警戒：共用一次反应额度': 'went on overwatch using the shared reaction',
  '满士气锁定，士气不变': 'remained at locked full morale',
  '重整失败，仍在溃退': 'failed to rally and is still routing',
  '重整失败，撤离战场': 'failed to rally and withdrew',
};
const reactions: Readonly<Record<string, string>> = {
  借机: 'Opportunity Attack', 借机攻击: 'Opportunity Attack', 借机反应: 'Opportunity Attack',
  起飞借机: 'Takeoff Opportunity Attack', 警戒反应: 'Overwatch', 拒止反应: 'Repel Charge',
  警戒拒止反应: 'Overwatch Repels Charge', 骑射反击: 'Mounted Countershot',
};
const unitEventPatterns: readonly [RegExp, string][] = [
  [/^(.+?) 士气([+−-][\d.]+) → ([\d.]+)$/, '$1 morale $2 → $3'],
  [/^(.+?) 有效士气([\d.]+)，士气崩溃，退出当前战线等待重整$/, '$1 broke at effective morale $2 and left the line to rally'],
  [/^(.+?) 溃退：([A-Z]+\d+)→([A-Z]+\d+)$/, '$1 routed: $2 → $3'],
  [/^(.+?) 固守，面向(.+)$/, '$1 braced facing $2'],
  [/^(.+?)：部署时装载至(.+)，人数(\d+)$/, '$1 deployed aboard $2 with $3 members'],
  [/^(.+?)：随(.+)撤离战场，人数(\d+)$/, '$1 withdrew with $2 ($3 members)'],
  [/^(.+?)：被迫离开(.+)，剩余(\d+)$/, '$1 was forced off $2 ($3 remaining)'],
  [/^(.+?)：分出(.+) (\d+)人，原队余(\d+)人$/, '$1 split off $2 ($3 members); $4 remained'],
  [/^(.+?)从(.+)摔落，(\d+)人，损失([\d.]+)生命，减员(\d+)人$/, '$1 fell from $2 ($3 members); lost $4 HP and $5 members'],
  [/^(.+?) (溺水|窒息)，损失([\d.]+)生命$/, '$1 suffered $3 HP loss from $2'],
];

export function englishBattleOutcome(source: string): string {
  const side = /^(我方|敌方|第三方)战斗胜利$/.exec(source);
  if (side) return english('{side}战斗胜利', { side: english(side[1]!) });
  const control = /^(我方|敌方|第三方)(作为攻方)?占旗获胜：控制(旗区|旗点)([A-Z]+\d+)满(\d+)个完整回合（(\d+\/\d+)）；本场因占领取胜结束(；第三方获胜，我方失败)?$/.exec(source);
  if (control) return english('{side}占旗获胜：控制{objective}{cell}满{rounds}个完整回合（{progress}）', {
    side: english(control[1]!), objective: english(control[3]!), cell: control[4]!, rounds: control[5]!, progress: control[6]!,
  }) + (control[7] ? ' · ' + english('第三方获胜，我方失败') : '');
  const defense = /^(我方|敌方|第三方)作为守方守城成功：攻方未在第(\d+)轮期限内完成(\d+)个完整回合的占领，守方获胜$/.exec(source);
  if (defense) return english('{side}守城成功：攻方未在第{limit}轮期限内完成{rounds}个完整回合的占领', {
    side: english(defense[1]!), limit: defense[2]!, rounds: defense[3]!,
  });
  const mission = /^任务结束：(ally|enemy|neutral|draw)$/.exec(source);
  if (mission) return english(({ ally: '任务胜利', enemy: '任务失败', neutral: '第三方获胜，我方失败', draw: '任务结束：僵持' } as Record<string, string>)[mission[1]!]!);
  return english(source);
}

/** Localize only the terrain tokens inside a recorded position. Its landmark name is authored text. */
function englishPlace(place: string): string {
  return place.replace(/(^[A-Z]+\d+(?:〔[^〕]*〕)?)(?:\(([^()]*)\))$/, (_, cell: string, details: string) =>
    cell + ' (' + details.split('·').map(englishPlaceDetail).join(' · ') + ')');
}

function englishPlaceDetail(detail: string): string {
  const height = /^高度(-?\d+(?:–-?\d+)?)$/.exec(detail);
  if (height) return english('高度{height}', { height: height[1]! });
  const structure = /^(.+?)( L\d+)?(（已毁）|（开启）|（关闭）)$/.exec(detail);
  if (structure && english(structure[1]!) !== structure[1]) {
    return english(structure[1]!) + (structure[2] ?? '') + english(structure[3]!);
  }
  return english(detail);
}

const position = '[A-Z]+\\d+(?:〔[^〕]*〕)?(?:\\([^()]*\\))?';
const movement = new RegExp(`^(.+?) (${position})→(${position})(，冲锋)?$`);
const assault = /^(［[^］\n]*］(?:｜)?)?(.*?)→(.*?) (?:((?:居高|仰攻)（高度-?\d+→-?\d+），))?(未中|(?:✦暴击|命中)[\d.]+(?:生命)?（[\d.]+→[\d.]+）|\d+段\/\d+中，损失[\d.]+(?:生命)?（[\d.]+→[\d.]+）)([^\n]*)$/;
const attackDetails: [RegExp, string][] = [
  [/^(?:居高|仰攻)（高度(-?\d+)→(-?\d+)），$/, 'Elevation $1 → $2 · '],
  [/^(?:✦暴击|命中)([\d.]+)(生命)?（([\d.]+)→([\d.]+)）$/, 'Hit · $1 $2 lost ($3 → $4)'],
  [/^(\d+)段\/(\d+)中，损失([\d.]+)(生命)?（([\d.]+)→([\d.]+)）$/, '$2/$1 hits · $3 $4 lost ($5 → $6)'],
];
const attackSuffix: [RegExp, string][] = [
  [/，减员(\d+)/g, ' · $1 members lost'], [/，能量盾吸收([\d.]+)/g, ' · Energy shield absorbed $1'],
  [/（耗盾([\d.]+)）/g, ' ($1 shield spent)'], [/，([\d.]+)份能量盾过载/g, ' · $1 energy shields overloaded'],
  [/，能量盾过载/g, ' · Energy shield overloaded'], [/，屏障吸收([\d.]+)/g, ' · Barrier absorbed $1'],
  [/，其中(\d+)段未穿透/g, ' · $1 hits did not penetrate'], [/，未穿透/g, ' · Did not penetrate'],
  [/，盾牌碎裂/g, ' · Shield broke'], [/（濒死）/g, ' · Dying'], [/†/g, ' · Defeated'], [/·含暴击/g, ' · Includes a critical hit'],
];

/** Compatibility for report lines saved before structured rendering, and events with prose-only effects. */
export function englishEventText(source: string): string {
  if (!/\p{Script=Han}/u.test(source) || isCommunicationLog({ kind: 'rule', text: source })) return source;
  const command = /^指挥：(我方|第三方|敌方) ([^·]+)·(.+)$/.exec(source);
  if (command) return english('{side}指挥：{profile}', {
    side: english(command[1]!), profile: english(command[2]!) + ' · ' + english(command[3]!),
  });
  const reaction = /^([^｜]+)｜/.exec(source);
  if (reaction && Object.hasOwn(reactions, reaction[1]!)) {
    return reactions[reaction[1]!] + ' · ' + englishBattleEvent(source.slice(reaction[0].length));
  }
  return englishBattleEvent(source);
}

function englishBattleEvent(source: string): string {
  const split = /^(.+?)：分出(.+)分队(\d+) (\d+)人，原队余(\d+)人$/.exec(source);
  if (split && split[1]!.replace(/分队\d+$/, '') === split[2]) {
    return english('{parent}：分出{child} {count}人，原队余{remaining}人', {
      parent: split[1]!, child: english('{name}分队{number}', { name: split[2]!, number: split[3]! }), count: split[4]!, remaining: split[5]!,
    });
  }
  if (source.startsWith('布阵：')) {
    const deployment = source.slice(3).replace(new RegExp(` ${position}(?=，|$)`, 'g'), place => ' ' + englishPlace(place.slice(1)));
    return 'Deployment: ' + deployment;
  }
  const move = movement.exec(source);
  if (move) {
    const verb = /^(.*) (突进|闪现|后撤)$/.exec(move[1]!);
    const who = verb?.[1] ?? move[1]!;
    const action = verb ? { 突进: 'advanced', 闪现: 'blinked', 后撤: 'fell back' }[verb[2] as '突进' | '闪现' | '后撤'] : 'moved';
    return `${who} ${action}: ${englishPlace(move[2]!)} → ${englishPlace(move[3]!)}${move[4] ? ' · Charge' : ''}`;
  }
  const hit = assault.exec(source);
  if (hit) {
    const [, weapon, attacker, defender, height, result, suffix] = hit;
    const critical = result!.startsWith('✦');
    const narrative = result === '未中' ? 'Missed' : attackDetails.slice(1).reduce((line, [pattern, replacement]) => line.replace(pattern, replacement), result!)
      .replace('生命', 'HP').replace('  lost', ' lost');
    const detail = attackSuffix.reduce((line, [pattern, replacement]) => line.replace(pattern, replacement), suffix!);
    return `${weapon?.replace(/｜$/, '') ?? ''}${attacker} → ${defender}: ${height?.replace(...attackDetails[0]!) ?? ''}${critical ? 'Critical hit · ' : ''}${narrative}${detail}`;
  }
  const skill = /^(.+?) 使用【([^】]+)】(.*)$/.exec(source);
  if (skill) {
    const tail = skill[3]!.replace(/^：消耗([\d.]+)件(?:，剩余[\d.]+件)?$/, ': used $1 items');
    return `${skill[1]} used 【${skill[2]}】${tail}`;
  }
  const climb = /^(.+?) (登上城防平台|下至地面) ([A-Z]+\d+(?:\(高度-?\d+\))?)$/.exec(source);
  if (climb) return `${climb[1]} ${climb[2] === '登上城防平台' ? 'climbed onto the fortification' : 'descended to the ground'} at ${englishPlace(climb[3]!)}`;
  const suppressed = /^(.+?) 压制 (.+)，未造成伤亡$/.exec(source);
  if (suppressed) return `${suppressed[1]} suppressed ${suppressed[2]} without casualties`;
  const loss = /^(.+?) (失去战斗力，可救伤兵|救回|恢复)([\d.]+)(?:人|名可救伤兵)$/.exec(source);
  if (loss) return `${loss[1]} ${loss[2] === '失去战斗力，可救伤兵' ? 'became combat ineffective; recoverable wounded:' : 'recovered'} ${loss[3]}`;
  for (const [pattern, replacement] of unitEventPatterns) {
    if (pattern.test(source)) return source.replace(pattern, replacement).replace(/ (溺水|窒息)$/, (_, hazard: string) => ' ' + english(hazard));
  }
  const condition = /^(.+?) (状态结束：|获得|抵抗|免疫)(.+)$/.exec(source);
  if (condition) {
    const name = english(condition[3]!);
    if (name !== condition[3]) {
      const action = { '状态结束：': 'is no longer affected by', 获得: 'gained', 抵抗: 'resisted', 免疫: 'was immune to' };
      return `${condition[1]} ${action[condition[2] as keyof typeof action]} ${name}`;
    }
  }
  const damage = /^(.+?) (.+?) -([\d.]+) → (总生命|HP) ([\d.]+)$/.exec(source);
  if (damage && english(damage[2]!) !== damage[2]) return `${damage[1]}: ${english(damage[2]!)} caused ${damage[3]} damage → ${damage[5]} ${damage[4] === 'HP' ? 'HP' : 'total HP'}`;
  for (const [ending, translated] of Object.entries(eventEndings)) {
    if (source.endsWith(' ' + ending)) return source.slice(0, -ending.length) + translated;
  }
  return englishBattleOutcome(source);
}

export function englishReportEvents(entries: readonly BattleLogEntry[], fallback: string, field?: BattlefieldSpec): string {
  if (!entries.length || entries.some(isCommunicationLog)) return fallback;
  const first = entries[0]!, last = entries.at(-1)!;
  if (first.kind === 'attack') {
    const translated = englishReportAttack(entries, fallback);
    if (translated !== fallback) return translated;
  }
  if (field && first.move && last.move && !first.move.skill && !last.move.skill) {
    const recorded = movement.exec(fallback);
    if (recorded && !recorded[4]) {
      const from = cellLabel(field, first.move.from), to = cellLabel(field, last.move.to);
      const startHeight = first.move.fromHeight;
      const start = startHeight === undefined || startHeight === last.move.toHeight ? from : `${from} (Elevation ${startHeight})`;
      const destination = recorded[3]!.startsWith(to) ? englishPlace(recorded[3]!) : to;
      return `${recorded[1]} moved: ${start} → ${destination}`;
    }
  }
  return englishEventText(fallback);
}

const savedStatus: [RegExp, string][] = [
  [/血量([\d.]+\/[\d.]+)/g, 'HP $1'], [/剩余总人数([\d.]+\/[\d.]+)/g, 'Members $1'],
  [/剩余总数([\d.]+\/[\d.]+)辆/g, 'Vehicles $1'], [/士气([\d.]+)/g, 'Morale $1'],
  [/\s(\d+)(\S*?)能量盾过载/g, ' · $1 overloaded energy shields'],
  [/能量盾过载/g, 'Energy shield overloaded'], [/能量盾([\d.]+\/[\d.]+)/g, 'Energy Shield $1'],
  [/可救伤兵(\d+)人?/g, '$1 recoverable wounded'], [/编队失去战斗力/g, 'Combat ineffective'],
  [/濒死/g, 'Dying'], [/†死亡/g, '†Dead'], [/溃逃/g, 'Routing'], [/撤离/g, 'Withdrawn'],
  [/可行动/g, 'Ready'], [/阵亡/g, 'Dead'], [/溃退中/g, 'Routing'], [/已(?=Withdrawn)/g, ''],
  [/距已知敌(\d+)格/g, '$1 tiles from known enemies'], [/未定位敌军/g, 'Enemy unlocated'],
  [/高度(-?\d+(?:–-?\d+)?)/g, 'Elevation $1'],
  [/【主控】/g, '[Player] '], [/【指挥官】/g, '[Commander] '],
];

function englishSavedStatus(line: string): string {
  const splitAt = line.search(/[\s：](?:血量|剩余总人数|剩余总数)[\d.]/);
  if (splitAt < 0) return line;
  const prefix = line.slice(0, splitAt).replace(/^【主控】/, '[Player] ').replace(/^【指挥官】/, '[Commander] ');
  const place = /\(([A-Z]+\d+)(·[^()]*)?\)$/.exec(prefix);
  const rank = /\((左翼|中军|右翼)(前列|后列|预备列)\)$/.exec(prefix);
  const location = place ? prefix.slice(0, place.index) + ' (' + place[1] + (place[2] ?? '')
    .split('·').map((value, i) => i === 0 ? '' : ' · ' + (/^(?:距已知敌|未定位敌军)/.test(value)
      ? savedStatus.reduce((part, [pattern, replacement]) => part.replace(pattern, replacement), value) : englishPlaceDetail(value))).join('') + ')'
    : rank ? prefix.slice(0, rank.index) + ' (' + english(rank[1]!) + ' · ' + english(rank[2]!) + ')' : prefix;
  const facts = savedStatus.reduce((tail, [pattern, replacement]) => tail.replace(pattern, replacement), line.slice(splitAt + 1));
  return location + (line[splitAt] === '：' ? ': ' : ' ') + facts.split(/[，、]/).map(part => english(part)).join(', ');
}

function englishArchivedLine(line: string): string {
  if (line.startsWith('▸ ')) return '▸ ' + englishEventText(line.slice(2));
  const epilogue = /^【战阵·战斗终章】(.+?)，共(\d+)轮；(.+)$/.exec(line);
  if (epilogue) return '【Battle System · Epilogue】 ' + english(epilogue[2] === '1' ? '{mission}，共1轮；{result}' : '{mission}，共{rounds}轮；{result}', {
    mission: english(epilogue[1]!), rounds: epilogue[2]!, result: englishBattleOutcome(epilogue[3]!),
  });
  if (line.startsWith('【胜负原因】')) return '【Outcome】 ' + englishBattleOutcome(line.slice('【胜负原因】'.length));
  if (line.startsWith('【本场规则】')) return '【Battle Rules】 ' + english(line.slice('【本场规则】'.length));
  const roundEvent = /^第(\d+)(?:回合|轮)｜(.+)$/.exec(line);
  if (roundEvent) return 'Round ' + roundEvent[1] + ' · ' + englishEventText(roundEvent[2]!);
  const unit = /^(我方|敌方|第三方) (.+[：](?:血量|剩余总人数|剩余总数)[\d.]+\/.*)$/.exec(line);
  if (unit) return english(unit[1]!) + ' ' + englishSavedStatus(unit[2]!);
  const side = /^(我方|敌方|第三方|我军|敌军)：(.*)$/.exec(line);
  if (side && /(?:血量|剩余总人数|剩余总数)[\d.]+\//.test(side[2]!)) {
    return english(side[1]!) + ': ' + side[2]!.split('；').map(englishSavedStatus).join('; ');
  }
  if (line.startsWith('环境：')) return 'Environment: ' + line.slice(3).split('/').map(part => english(part)).join('/');
  if (line.startsWith('地标：')) return 'Landmarks: ' + line.slice(3).split('；').map(mark =>
    mark.replace(/（([^（）]*)）$/, (_, details: string) => ' (' + details.split('·').map(englishPlaceDetail).join(' · ') + ')')).join('; ');
  const mission = /^任务：(歼灭敌军|((我方|敌方)攻占([A-Z]+\d+)，连续控制(\d+\/\d+)轮)|护送(.+)至([A-Z]+\d+))$/.exec(line);
  if (mission) return mission[1] === '歼灭敌军' ? 'Objective: Defeat the enemy forces'
    : mission[2] ? `Objective: ${english(mission[3]!)} capture ${mission[4]}, holding for ${mission[5]} consecutive rounds`
      : `Objective: Escort ${mission[6]} to ${mission[7]}`;
  if (line.startsWith('建筑与城防：')) return 'Structures and Fortifications: ' + line.slice(6).split('；').map(item =>
    item.replace(/^(.*?)(已毁|受损|打开、受损|关闭、受损|打开|关闭)(\d+)处（(.*)）$/,
      (_, structure: string, state: string, count: string, cells: string) =>
        `${english(structure)} ${english(state)} · ${count} (${cells.replaceAll('、', ', ')})`)).join('; ');
  const start = /^【(战阵·(?:当前状态|会战状态))】(战斗已结束|会战已结束)$/.exec(line);
  if (start) return `【${headings[start[1]!]}】 ${english(start[2]!)}`;
  const turn = /^【战阵·当前状态】第(\d+)回合｜轮到：(.*)$/.exec(line);
  if (turn) return `【${headings['战阵·当前状态']}】 Round ${turn[1]} · Active: ${turn[2] === '未定位的敌方行动' ? 'Unlocated enemy' : turn[2]}`;
  return englishBattleOutcome(line);
}

export function englishReportDocument(text: string): string {
  const instructions = text.indexOf('【叙述任务】');
  const facts = instructions < 0 ? text : text.slice(0, instructions);
  return englishReportHeadings(facts.split('\n').map(englishArchivedLine).join('\n')) + (instructions < 0 ? '' : text.slice(instructions));
}
