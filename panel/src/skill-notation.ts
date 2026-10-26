import { parseSkillMechanism } from '../../engine/src/data/skill-mechanisms.js';

/** Shared L may follow the category or the whole group; local Ls stay on their own words. */
export function splitSkillLevel(spec: string): { mechanism: string; level?: number; suffix: string } {
  const group = spec.match(/^[（(]([^()（）]+)[）)]\s*[lL]\s*([+-]?\d+(?:\.\d+)?)(.*)$/);
  const leading = spec.match(/^(.*?)[lL]\s*([+-]?\d+(?:\.\d+)?)(\s*\+.*)$/);
  const trailing = spec.match(/^(.*)[lL]\s*([+-]?\d+(?:\.\d+)?)([^lL]*)$/);
  // With a leading shared L, effect words are part of the mechanism until the first numeric enhancement.
  const leadingMechanism = !group && leading ? parseSkillMechanism(leading[1]!) : undefined;
  if (leading && leadingMechanism?.modifiers.length === 0) {
    const boundary = leading[3]!.search(/[+-]\s*\d/);
    const mechanism = leading[1]! + (boundary < 0 ? leading[3] : leading[3]!.slice(0,boundary));
    // 没有局部 L 的旧写法也可能含“+破甲/+距离”等省略数值的修正，留给容错层逐项识别。
    if (/[lL]\s*\d/.test(leading[3]!) || parseSkillMechanism(mechanism)) {
      return { mechanism, level: Number(leading[2]), suffix: boundary < 0 ? '' : leading[3]!.slice(boundary) };
    }
  }
  const match = group ?? trailing;
  return match ? { mechanism: match[1]!.trim(), level: Number(match[2]), suffix: match[3]!.trim() } : { mechanism: spec, suffix: '' };
}
