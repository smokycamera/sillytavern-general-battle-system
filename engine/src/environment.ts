/** 地理环境与昼夜分开；没有声明时采用普通野战。 */
export function environmentTags(tags: string[] = []): string[] {
  const result = [...new Set(tags)];
  if (!result.some((tag) => ['plains', 'urban', 'siege', 'forest', 'mountain'].includes(tag))) result.unshift('plains');
  return result;
}
export function macroTerrain(tags: string[]): 'forest' | 'hill' | 'open' {
  return tags.includes('forest') ? 'forest' : tags.includes('mountain') ? 'hill' : 'open';
}
