import type { ActionPreview } from '../../engine/src/actions.js';

/** 命中率与伤害对应整次行动；连射不能用单发命中率反推整次损失。 */
export function hitChanceText(preview: ActionPreview): string {
  return Math.round((preview.anyHitChance ?? preview.hitChance ?? 0) * 100) + '%';
}

export function hitDamageText(preview: ActionPreview): string {
  const chance = preview.anyHitChance ?? preview.hitChance ?? 0;
  const damage = preview.damageOnHit ?? (chance > 0 ? (preview.expectedDamage ?? 0) / chance : 0);
  return damage > 0 ? '约' + Number(damage.toFixed(1)) : '0';
}

export function hitDamageDetails(preview: ActionPreview, unit: string): string {
  const normal = preview.normalHitDamage, critical = preview.criticalHitDamage;
  return (normal === undefined ? '' : '普通命中约' + Number(normal.toFixed(1)) + unit + '。')
    + (critical === undefined ? '' : '暴击约' + Number(critical.toFixed(1)) + unit + '。')
    + ((preview.attackRollCount ?? preview.aggregationSamples ?? 1) > 1 ? `共${preview.attackRollCount ?? preview.aggregationSamples}组判定，每组命中${Math.round((preview.hitChance??0)*100)}%。` : '')
    + (preview.additionalChannels?.length ? '附加' + preview.additionalChannels.map(part => ({kinetic:'动能',thermal:'热能',arcane:'奥术'})[part.channel] + '穿透' + Number(part.penetration.toFixed(2)) + '对防护' + Number(part.resistance.toFixed(2)) + '，保留' + Math.round(part.penetrationFactor*100) + '%').join('；') + '。' : '');
}
