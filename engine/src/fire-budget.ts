export function normalCdf(x: number): number {
  const y = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * y);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) * Math.exp(-y * y);
  return 0.5 * (1 + (x < 0 ? -erf : erf));
}

export function killProbability(previews: readonly { expectedDamage: number; variance?: number }[], health: number): number {
  if (!previews.length) return 0;
  const mean = previews.reduce((sum, preview) => sum + preview.expectedDamage, 0);
  const variance = previews.reduce((sum, preview) => sum + (preview.variance ?? 0), 0);
  return variance > 0 ? normalCdf((mean - health) / Math.sqrt(variance)) : mean >= health ? 1 : 0;
}
