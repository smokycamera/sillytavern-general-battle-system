import { ZONE_NAMES, type BattleZone } from '../../engine/src/area-effects.js';
import { activeTraitIds, traitPrerequisiteReason } from '../../engine/src/trait-sources.js';
import { entrenched } from '../../engine/src/entrenchment.js';
import type { Combatant } from '../../engine/src/types.js';

const ICONS = {
  fire: '<path d="M12 2c2 6 7 7 7 13a7 7 0 0 1-14 0c0-3 1-5 4-8-1 5 1 5 2 6 2-3 2-7 1-11Z"/>',
  poison: '<circle cx="9" cy="9" r="5"/><circle cx="16" cy="12" r="5"/><circle cx="10" cy="17" r="4"/>',
  smoke: '<path d="M4 19h14a4 4 0 0 0 0-8 5 5 0 0 0-10-1 4 4 0 0 0-4 9Zm5-14 2-3m5 4 2-3"/>',
  healing: '<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6Z"/>',
  trap: '<path d="m3 18 4-9 5 9 5-9 4 9M3 21h18M8 5h8m-4-3v5"/>',
  works: '<path d="M3 20v-7h5v3h8v-3h5v7M3 9h7V5h4v4h7M7 20v-3m10 3v-3"/>',
} as const;
const SHORT = { fire: '火墙', poison: '毒雾', smoke: '烟幕', healing: '治疗', trap: '陷阱' } as const;
export function zoneLabel(zone: BattleZone): string { return `${SHORT[zone.kind]} ${zone.remaining}轮`; }
export function zoneDetail(zone: BattleZone): string {
  return `${ZONE_NAMES[zone.kind]} L${zone.power} · 剩余${zone.remaining}轮${zone.surface === 'platform' ? ' · 平台' : ''}`;
}
/** Only pass units visible to the viewer. A skill's works mark its owner's saved post, without creating a structure. */
export function fieldWorks(units: Combatant[]): Combatant[] {
  return units.filter(u => u.entrenchedAt !== undefined && !['dead', 'fled'].includes(u.status)
    && activeTraitIds(u).includes('fortification') && !traitPrerequisiteReason(u, 'fortification'));
}
export function worksLabelShort(works: Combatant[]): string {
  return works.some(entrenched) ? '工事·据守' : '工事·空置';
}
export function fieldEffectMarks(zones: BattleZone[], works: Combatant[]): string {
  const kinds = [...new Set(zones.map(z => z.kind)), ...(works.length ? ['works' as const] : [])];
  return kinds.map(kind => `<span class="field-effect effect-${kind}" aria-hidden="true"><svg viewBox="0 0 24 24">${ICONS[kind]}</svg></span>`).join('');
}
