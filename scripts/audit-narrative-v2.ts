/** Read-only probes for the 2026-09-05 narrative/skin review; no chat or save writes. */
import { parseSuggestionTags } from '../panel/src/tags.js';
import { generateUnit, getSkin, getSystemPack, armorDR } from '../engine/src/index.js';

const report = (probe: string, observed: unknown) => console.log(JSON.stringify({ probe, observed }, null, 2));
report('N01 tag outside wrapper', parseSuggestionTags('这是格式说明：<xp amount="50"/>，不是入账请求。'));
report('N02 quoted example', parseSuggestionTags('示例代码，不应执行：\n```xml\n<give item="示例物品"/>\n```'));

const a = parseSuggestionTags('<tb>\n<xp amount="50" reason="示例"/>\n</tb>').suggestions[0];
const b = parseSuggestionTags('<tb>\n<xp reason="示例" amount="50"/>\n</tb>').suggestions[0];
report('N03 raw text is not event identity', { first: a, second: b, rawEqual: a?.raw === b?.raw });

report('N04 skin changes default equipment', ['medieval', 'modern'].map(era => {
  const { unit } = generateUnit({
    name: '同一生成配方', scale: 'hero', archetype: 'infantry', level: 4,
    traits: [], side: 'ally', era,
  }, { seed: 'narrative-audit', noVariance: true });
  return { era, displayArchetype: getSkin(era).archetypes.infantry, weapon: unit.weapon?.name, armor: unit.armor?.name };
}));

const { unit } = generateUnit({
  name: '固定装备', scale: 'hero', archetype: 'infantry', level: 4,
  traits: [], side: 'ally', armorId: 'arm-plate', armorTier: 3,
}, { seed: 'narrative-audit', noVariance: true });
report('N05 system pack changes same armor', ['medieval', 'modern'].map(system => ({
  system, armor: unit.armor?.name, actualBaseDR: armorDR(unit, getSystemPack(system).small),
})));
