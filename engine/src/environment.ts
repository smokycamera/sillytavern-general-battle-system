/** 地理环境与昼夜分开；没有声明时采用普通野战。 */
export function environmentTags(tags: string[] = []): string[] {
  const result = [...new Set(tags)];
  if (!result.some((tag) => ['plains', 'urban', 'siege', 'forest', 'mountain'].includes(tag))) result.unshift('plains');
  return result;
}
/** 战报里的环境名；世界书、存档和地图生成仍用英文键。 */
export const ENVIRONMENT_NAMES: Readonly<Record<string, string>> = { plains: '平原', urban: '城镇', siege: '攻城', forest: '森林', mountain: '山地', night: '夜间' };
export function environmentLabel(tags: readonly string[]): string { return tags.map((tag) => ENVIRONMENT_NAMES[tag] ?? tag).join('/'); }
export function macroTerrain(tags: string[]): 'forest' | 'hill' | 'open' {
  return tags.includes('forest') ? 'forest' : tags.includes('mountain') ? 'hill' : 'open';
}
