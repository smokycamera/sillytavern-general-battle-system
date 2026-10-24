/** Shared L may follow the category or the whole group; local Ls stay on their own words. */
export function splitSkillLevel(spec: string): { mechanism: string; level?: number; suffix: string } {
  const group = spec.match(/^[（(]([^()（）]+)[）)]\s*[lL]\s*([+-]?\d+(?:\.\d+)?)(.*)$/);
  const leading = spec.match(/^(.*?)[lL]\s*([+-]?\d+(?:\.\d+)?)(\s*\+.*)$/);
  const trailing = spec.match(/^(.*)[lL]\s*([+-]?\d+(?:\.\d+)?)([^lL]*)$/);
  // With a leading shared L, effect words are part of the mechanism until the first numeric enhancement.
  if (!group && leading && /[lL]\s*\d/.test(leading[3]!)) {
    const boundary = leading[3]!.search(/[+-]\s*\d/);
    return { mechanism: leading[1]! + (boundary < 0 ? leading[3] : leading[3]!.slice(0,boundary)), level: Number(leading[2]), suffix: boundary < 0 ? '' : leading[3]!.slice(boundary) };
  }
  const match = group ?? trailing;
  return match ? { mechanism: match[1]!.trim(), level: Number(match[2]), suffix: match[3]!.trim() } : { mechanism: spec, suffix: '' };
}
