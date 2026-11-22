import type { ActionOption, Combatant } from '../../engine/src/index.js';
import { displayTextFor, ui, uiLanguage, type UiLanguage } from './ui-language.js';

export function battleUnitName(unit: Pick<Combatant, 'id' | 'name' | 'transportOrigin'>, language: UiLanguage = uiLanguage()): string {
  if (language === 'zh-CN' || !unit.transportOrigin) return unit.name;
  const number = unit.id.slice(unit.id.lastIndexOf(':') + 1), suffix = '分队' + number;
  return /^\d+$/.test(number) && unit.name.endsWith(suffix)
    ? displayTextFor(language)('{name}分队{number}', { name: unit.name.slice(0, -suffix.length), number })
    : unit.name;
}

export function battleOptionLabel(option: ActionOption): string {
  if (option.kind === 'charge' || option.id.startsWith('volley:')) return ui(option.label);
  if (uiLanguage() === 'zh-CN' || option.kind !== 'weapon') return option.label;
  const quantities = /^(.*) · 可用 (\d+)／持有 (\d+)(?: · 就绪 (\d+)，装填 (\d+))?$/.exec(option.label);
  if (!quantities) return option.label === '武器攻击' ? ui(option.label) : option.label;
  const [, weapon = '', available = '', total = '', ready, reloading] = quantities;
  return ui('{weapon} · 可用 {available}／持有 {total}', { weapon, available, total })
    + (ready === undefined ? '' : ui(' · 就绪 {ready}，装填 {reloading}', { ready, reloading: reloading ?? '' }));
}

// The engine returns the same reasons to the host and the UI; translate the known
// parameterized ones here so a weapon name or a saved event is never rewritten.
const reasonPatterns: readonly [RegExp, string, readonly string[]][] = [
  [/^需架设：本次激活已移动，不能用(.+)开火$/, '需架设：本次激活已移动，不能用{weapon}开火', ['weapon']],
  [/^(.+)暂无可用装备$/, '{weapon}暂无可用装备', ['weapon']],
  [/^(.+)过热：连续开火三次后需要冷却一次$/, '{weapon}过热：连续开火三次后需要冷却一次', ['weapon']],
  [/^(.+)燃料耗尽：每战只能喷射(\d+)次$/, '{weapon}燃料耗尽：每战只能喷射{count}次', ['weapon', 'count']],
  [/^攀登需要([\d.]+)点移动$/, '攀登需要{cost}点移动', ['cost']],
  [/^(突进|闪现)([\d.]+)格内没有能对目标出手的落点$/, '{move}{range}格内没有能对目标出手的落点', ['move', 'range']],
  [/^(.+) 无法行动（(ready|dying|dead|routing|fled)）$/, '{unit} 无法行动（{status}）', ['unit', 'status']],
  [/^(桥梁|城门)数量 (\d+)$/, '{structure}数量 {count}', ['structure', 'count']],
  [/^屏障吸收([\d.]+)点伤害，持续(\d+)轮$/, '屏障吸收{amount}点伤害，持续{rounds}轮', ['amount', 'rounds']],
  [/^恢复生命约([\d.]+)$/, '恢复生命约{amount}', ['amount']],
  [/^(精力|士气)([+−-]?[\d.]+)$/, '{resource} {value}', ['resource', 'value']],
  [/^获得(.+?)，持续(\d+)轮$/, '获得{effect}，持续{rounds}轮', ['effect', 'rounds']],
];

export function battleReason(source = ''): string {
  const label = ui(source);
  if (uiLanguage() === 'zh-CN' || label !== source || !/\p{Script=Han}/u.test(source)) return label;
  for (const [pattern, key, fields] of reasonPatterns) {
    const match = pattern.exec(source);
    if (match) return ui(key, Object.fromEntries(fields.map((field, index) => {
      const value = match[index + 1]!;
      return [field, ['move', 'structure', 'effect', 'resource'].includes(field) ? ui(value) : value];
    })));
  }
  return source;
}
