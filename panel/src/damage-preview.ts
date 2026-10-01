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
    + `整次行动${preview.attackRollCount ?? preview.aggregationSamples ?? 1}组判定，每组命中${Math.round((preview.hitChance??0)*100)}%。至少命中一次时，平均伤害${hitDamageText(preview)}${unit}；计入未命中的平均伤害${Number((preview.expectedDamage??0).toFixed(1))}${unit}。`
    + (preview.exact === false ? '伤害与减员为有界估算。' : '');
}
