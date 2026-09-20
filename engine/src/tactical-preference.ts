export const TACTICAL_PREFERENCES = { balanced: '稳健推进', defensive: '固守当前位置', aggressive: '积极压迫' } as const;
export type TacticalPreference = keyof typeof TACTICAL_PREFERENCES;
export function normalizeTactic(value: unknown): TacticalPreference {
  return value === 'defensive' || value === 'aggressive' ? value : 'balanced';
}
