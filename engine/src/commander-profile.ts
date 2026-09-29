export const COMMANDER_ABILITIES = ['novice', 'regular', 'skilled', 'expert', 'master'] as const;
export const COMMANDER_STYLES = ['balanced', 'aggressive', 'cautious', 'flanking', 'firepower', 'ambush', 'siege', 'infiltration', 'skirmish', 'forward', 'depth', 'mobile', 'core'] as const;
export interface CommanderProfile {
  preferences?: Partial<Record<'reserve' | 'risk' | 'counterattack' | 'cohesion' | 'breach', number>>;
  ability: typeof COMMANDER_ABILITIES[number];
  style: typeof COMMANDER_STYLES[number];
}
export type CommanderProfiles = Partial<Record<'ally' | 'enemy', CommanderProfile>>;
export function normalizeCommanderProfiles(value: unknown): CommanderProfiles {
  const result: CommanderProfiles = {};
  if (!value || typeof value !== 'object') return result;
  for (const side of ['ally', 'enemy'] as const) {
    const p = (value as CommanderProfiles)[side];
    if (p && COMMANDER_ABILITIES.includes(p.ability) && COMMANDER_STYLES.includes(p.style)) result[side] = { ability: p.ability, style: p.style, ...(p.preferences ? { preferences: Object.fromEntries(Object.entries(p.preferences).filter(([k, v]) => ['reserve', 'risk', 'counterattack', 'cohesion', 'breach'].includes(k) && Number.isInteger(v) && v >= 0 && v <= 4).slice(0, 3)) } : {}) };
  }
  return result;
}
export interface CommandChoice {
  key: string;
  score: number;
  attack: boolean;
  ranged: boolean;
  move: boolean;
  defend: boolean;
}
/** Bounded preferences on already legal, observed candidates; no dice or unit-stat changes.
 * Ability reduces deterministic estimation error. The hash never consumes battle RNG.
 */
export function commanderScores(choices: CommandChoice[], profile: CommanderProfile | undefined, turnKey: string, layered = false): number[] {
  if (!profile) return choices.map(c => c.score);
  const scale = Math.max(1, ...choices.map(c => c.score));
  const error = { novice: .18, regular: .10, skilled: .05, expert: .02, master: 0 }[profile.ability];
  return choices.map(c => {
    let bias = 0;
    if (profile.style === 'aggressive') bias = c.attack ? .06 : 0;
    if (profile.style === 'cautious') bias = c.defend ? .06 : c.move && c.attack ? -.03 : 0;
    if (profile.style === 'flanking') bias = c.move && c.attack ? .06 : 0;
    if (profile.style === 'firepower') bias = c.attack && c.ranged ? .06 : 0;
    if (profile.style === 'ambush') bias = c.defend || c.attack && !c.move ? .06 : 0;
    if (layered) {
      const attack = ['aggressive', 'siege', 'infiltration', 'forward'].includes(profile.style);
      const mobile = ['flanking', 'skirmish', 'mobile', 'infiltration'].includes(profile.style);
      bias *= 2.5;
      if (attack && c.attack) bias += .10;
      if (mobile && c.move) bias += .07;
      if (['depth', 'core'].includes(profile.style) && c.defend) bias += .05;
      if (c.attack) bias += ((profile.preferences?.risk ?? 2) - 2) * .025;
      if (c.move && c.attack) bias += ((profile.preferences?.counterattack ?? 2) - 2) * .025;
    }
    let hash = 2166136261;
    for (const char of turnKey + ':' + c.key) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    const noise = ((hash >>> 0) / 0xffffffff * 2 - 1) * error;
    return c.score + scale * (bias + noise);
  });
}
