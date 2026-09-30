import { BONUS_NAMES, ENHANCEMENT_STATS, enhancementLabel, parseEnhancementSuffix, resolveBonusStat as bonusKey, type BonusStat, type Enhancements } from '../../engine/src/enhancements.js';
import { parseSkillMechanism, skillMechanismName, type SkillMechanism } from '../../engine/src/data/skill-mechanisms.js';

/** Read either sign/number/name or name/sign/number, without borrowing the next bonus's sign. */
function enhancementOrder(text: string): string | undefined {
  const parts: string[] = [];
  let rest = text.trim();
  while (rest) {
    const first = rest.match(/^[\p{L}_]+/u)?.[0];
    if (first) rest = rest.slice(first.length).trimStart();
    const sign = rest.match(/^[+-]/)?.[0];
    if (!sign) return undefined;
    rest = rest.slice(1).trimStart();
    const points = rest.match(/^\d+(?:\.\d+)?/)?.[0];
    if (points) rest = rest.slice(points.length).trimStart();
    const label = first ?? rest.match(/^[\p{L}_]+/u)?.[0];
    if (!first && label) rest = rest.slice(label.length).trimStart();
    if (first && !points || !points && !label) return undefined;
    parts.push(sign + (points ?? '') + (label ?? ''));
  }
  return parts.join('');
}

/** 仅用于正文输入；不放宽存档、手工表单和引擎数值校验。 */
export function normalizeNarrativeSpec(text: string): string {
  const separator = text.search(/[:：·｜|/／]/);
  const prefix = separator > 0 ? text.slice(0, separator).trim() + ':' : '';
  let spec = separator > 0 ? text.slice(separator + 1) : text;
  spec = spec.replace(/[０-９Ａ-Ｚａ-ｚ]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/＋/g, '+').replace(/[−－﹣]/g, '-').replace(/．/g, '.').trim();
  // 括号只有在包住整个规格或等级/修正时才是格式，不删除任意文字。
  spec = spec.replace(/^[（(]([^()（）]+)[）)]$/, '$1')
    .replace(/[（(]\s*((?:level|lv\.?|l)\s*\d[^()（）]*)[）)]$/i, '$1')
    .replace(/[（(]\s*([+-][^()（）]+)[）)]$/i, '$1');
  spec = spec.replace(/(?:level|lv\.?|l)\s*([+-]?\d+(?:\.\d+)?)\s*(?:级)?(?=\s*(?:[+\-]|$|[\p{L}]))/giu,
    (_all, level: string) => 'L' + (/^\d+\.0+$/.test(level) ? String(Number(level)) : level));
  const match = spec.match(/^(.*?[lL][+-]?\d+(?:\.\d+)?)(.*)$/);
  if (!match) return prefix + spec;
  let suffix = match[2]!.trim();
  // “伤害+3”与“+3伤害”只交换明确的名称/数值，不猜没有符号的数值。
  suffix = enhancementOrder(suffix) ?? suffix;
  suffix = suffix.replace(/\s+/g, '');
  suffix = suffix.replace(/([+-])(\d+(?:\.0+)?)([^+\-\d]*)/g, (_all, sign: string, points: string, label: string) => {
    const key = bonusKey(label);
    return sign + String(Number(points)) + (key ? BONUS_NAMES[key] : label);
  });
  // 仅已知强化方向允许省略点数；技能效果如“+击退”仍作为机制处理。
  suffix = suffix.replace(/\+([^+\-\d]+)/g, (whole, label: string) => {
    const key = bonusKey(label);
    return key ? '+1' + BONUS_NAMES[key] : whole;
  });
  return prefix + match[1]!.trim().replace(/\s+(?=[lL][+-]?\d)/g, '') + suffix;
}

function mechanism(text: string): SkillMechanism | undefined {
  const direct = parseSkillMechanism(text);
  if (direct) return direct;
  // 控制类短写的同义词与完整组合使用同一张引擎词表。
  const control = parseSkillMechanism('debuff+' + text);
  return control?.modifiers.length === 1 && ['stun', 'root', 'silence', 'disarm', 'slow', 'fear', 'push', 'pull'].includes(control.modifiers[0]!) ? control : undefined;
}

/** 将等级后的效果词归回机制段；无法实现的可选强化留下诊断，不废掉基础技能。 */
export function normalizeNarrativeSkill(text: string, warnings: string[]): string {
  const normalized = normalizeNarrativeSpec(text);
  const separator = normalized.search(/[:：·｜|/／]/);
  const prefix = separator > 0 ? normalized.slice(0, separator) + ':' : '';
  const spec = separator > 0 ? normalized.slice(separator + 1) : normalized;
  const match = spec.match(/^(.*?)[lL]([+-]?\d+(?:\.\d+)?)(.*)$/);
  if (!match) return prefix + (mechanism(spec) ? skillMechanismName(mechanism(spec)!) : spec);
  const [, base, level, suffix] = match;
  if (!/^\d+$/.test(level!) || Number(level) < 1 || Number(level) > 10) throw Error('技能等级必须是L1–L10整数');
  let parsed = mechanism(base!);
  if (!suffix) return prefix + (parsed ? skillMechanismName(parsed) : base) + 'L' + level;
  const parts = [...suffix!.matchAll(/([+-])(\d+(?:\.\d+)?)?([^+\-\d]*)/g)];
  if (parts.map(part => part[0]).join('') !== suffix) throw Error('技能强化格式不完整');
  const bonuses: Enhancements = {};
  const add = (key: BonusStat, points: number) => {
    if (bonuses[key] !== undefined && bonuses[key] !== points) throw Error('强化重复且数值冲突：' + BONUS_NAMES[key]);
    if (bonuses[key] !== undefined) warnings.push(`${text}：已合并重复强化 ${BONUS_NAMES[key]}`);
    bonuses[key] = points;
  };
  for (const part of parts) {
    const [, sign, number, label] = part;
    if (number === undefined && !label) throw Error('技能强化格式不完整');
    const points = number === undefined ? undefined : Number(number) * (sign === '-' ? -1 : 1);
    if (points !== undefined && (!Number.isInteger(points) || Math.abs(points) > 10)) throw Error('技能强化须为-10至+10整数');
    const key = label ? bonusKey(label) : 'power';
    if (points === undefined && key) throw Error('负修正需要明确点数，只有+方向可省略为+1');
    if (points !== undefined && key && ENHANCEMENT_STATS.skill.includes(key)) { add(key, points); continue; }
    // 防御、护盾和加速等原本由“强度”缩放；同义强化只在对应机制确实存在时换写。
    const targets = key === 'defense' ? ['defense', 'defense-down', 'barrier', 'ward']
      : key === 'protection' ? ['barrier', 'ward'] : key === 'speed' ? ['haste', 'slow'] : [];
    if (points !== undefined && parsed?.modifiers.some(id => targets.includes(id))) {
      add('power', points); warnings.push(`${text}：${label}强化已按技能强度处理`); continue;
    }
    const combined = parsed && label && sign === '+' && (points === undefined || !key)
      ? parseSkillMechanism(skillMechanismName(parsed) + '+' + label) : undefined;
    if (combined) {
      parsed = combined;
      warnings.push(`${text}：已将${label}移入技能效果${points === undefined ? '' : '，该效果按技能等级生效，忽略独立加值'}`);
      continue;
    }
    warnings.push(`${text}：已忽略未支持强化 ${part[0]}，保留基础技能`);
  }
  const result = prefix + (parsed ? skillMechanismName(parsed) : base) + 'L' + level + enhancementLabel(bonuses);
  parseEnhancementSuffix(result, 'skill');
  return result;
}
