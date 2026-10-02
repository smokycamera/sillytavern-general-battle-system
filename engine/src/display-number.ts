/**
 * Display-only rounding. Stored values keep their precision; a number that had to be shortened for display is
 * marked "≈" so it is not read as exact. `down` suits progress toward a threshold (never shows it reached early),
 * `up` suits what is still missing (never shows it as nothing left).
 */
export function approx(value: number, digits = 1, direction: 'nearest' | 'down' | 'up' = 'nearest'): string {
  if (!Number.isFinite(value)) return String(value);
  const scale = 10 ** digits, scaled = value * scale;
  // Absorb binary noise such as 0.1 + 0.2 before deciding whether the value is exact.
  const settled = Math.abs(scaled - Math.round(scaled)) < 1e-9 ? Math.round(scaled) : direction === 'down' ? Math.floor(scaled) : direction === 'up' ? Math.ceil(scaled) : Math.round(scaled);
  const shown = settled / scale;
  return (Math.abs(shown - value) > 1e-9 ? '≈' : '') + String(Object.is(shown, -0) ? 0 : shown);
}
/** A change shown with its sign, such as "+2" or "≈-0.4". */
export function approxDelta(value: number, digits = 1): string {
  const text = approx(Math.abs(value), digits), mark = text.startsWith('≈') ? '≈' : '', magnitude = text.replace('≈', '');
  return magnitude === '0' ? text : mark + (value < 0 ? '-' : '+') + magnitude;
}
