import type { ActionPreview } from '../../engine/src/actions.js';
import { ui, uiLanguage } from './ui-language.js';

/** 命中率与伤害对应整次行动；连射不能用单发命中率反推整次损失。 */
export function hitChanceText(preview: ActionPreview): string {
  return Math.round((preview.anyHitChance ?? preview.hitChance ?? 0) * 100) + '%';
}

export function hitDamageText(preview: ActionPreview): string {
  const chance = preview.anyHitChance ?? preview.hitChance ?? 0;
  const damage = preview.damageOnHit ?? (chance > 0 ? (preview.expectedDamage ?? 0) / chance : 0);
  return damage > 0 ? ui('约{damage}', { damage: Number(damage.toFixed(1)) }) : '0';
}

export function hitDamageDetails(preview: ActionPreview, unit: string): string {
  const normal = preview.normalHitDamage, critical = preview.criticalHitDamage;
  const rolls = preview.attackRollCount ?? preview.aggregationSamples ?? 1;
  const channelDetails = preview.additionalChannels?.map(part => ui('{channel}穿透{penetration}对防护{resistance}，保留{factor}%', {
    channel: ui(({kinetic:'动能',thermal:'热能',arcane:'奥术'})[part.channel]),
    penetration: Number(part.penetration.toFixed(2)), resistance: Number(part.resistance.toFixed(2)),
    factor: Math.round(part.penetrationFactor * 100),
  }));
  return (normal === undefined ? '' : ui('普通命中约{damage}{unit}。', { damage: Number(normal.toFixed(1)), unit: ui(unit) }))
    + (critical === undefined ? '' : ui('暴击约{damage}{unit}。', { damage: Number(critical.toFixed(1)), unit: ui(unit) }))
    + (rolls > 1 ? ui('共{count}组判定，每组命中{chance}%。', { count: rolls, chance: Math.round((preview.hitChance ?? 0) * 100) }) : '')
    + (channelDetails?.length ? ui('附加{details}。', { details: channelDetails.join(ui('；')) }) : '');
}

export function modifierText(text?: string): string {
  if (!text) return ui('无');
  if (uiLanguage() === 'zh-CN') return text;
  return text.replace(/([^，；、+×−\-\d]+)(?=\s*[+×−\-]\d)/g, (_, label: string) => ui(label.trimEnd()) + label.slice(label.trimEnd().length));
}
