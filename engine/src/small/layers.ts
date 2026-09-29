import { instanceMultiplier } from '../instance-variance.js';
import { bodyProfile } from '../body.js';
/** Layered maps are opt-in on new fields. Frozen version-2 tile-only saves retain their rules. */
import type { Combatant, Weapon } from '../types.js';
import { activeTraitIds } from '../trait-sources.js';
import { isAirborne } from '../aerial.js';
import type { BattlefieldSpec } from './spatial.js';

export const STRUCTURE_NAMES = { cover: '掩体', fortification: '工事', wall: '城墙', gate: '城门', building: '建筑', tower: '塔楼', bridge: '桥梁' } as const;
export type StructureKind = keyof typeof STRUCTURE_NAMES;
export const STRUCTURE_ANCHORS = ['临时', '简易', '正规', '重型', '要塞', '超凡', '史诗', '传奇', '半神', '神造'] as const;
export type GroundOverlay = 'road' | 'rubble';
export interface FieldStructure {
  kind: StructureKind;
  level: number;
  hp: number;
  hpMax: number;
  /** Doors are physically open to both sides. Ownership only grants operation. */
  owner?: 'ally' | 'enemy';
  gateState?: 'closed' | 'open' | 'destroyed';
  top?: boolean;
  /** Ground cells with built-in stairs, not remote control points. */
  access?: number[];
  /** Legacy metadata, ignored by fortification protection. New fortifications omit it. */
  facing?: 'north' | 'south' | 'east' | 'west';
}
export interface FieldLandmark { kind: string; label: string; cells: number[]; scale: 'minor' | 'major' }
export type CityShape = 'front' | 'enclosure' | 'riverside' | 'hillside' | 'broken';
export interface CityRecord {
  shape: CityShape | 'district';
  /** Initial damage provenance; combat damage stays authoritative in structures. */
  breaches?: number[][];
  inside: number[];
  frontline: number[];
  gates: number[];
  core: number[];
  reserve: number[];
  defender?: 'ally' | 'enemy';
}
export function structureAt(field: BattlefieldSpec, cell: number): FieldStructure | undefined { return field.structures?.[cell] ?? undefined; }
export function intactStructure(field: BattlefieldSpec, cell: number): FieldStructure | undefined {
  const s = structureAt(field, cell); return s && s.hp > 0 ? s : undefined;
}
export function isElevated(unit: Combatant): boolean { return !isAirborne(unit) && unit.elevation === 1; }
export function supportsPlatform(field: BattlefieldSpec, cell: number): boolean { return intactStructure(field, cell)?.top === true; }
export function groundBlocked(field: BattlefieldSpec, cell: number, actor?: Combatant): boolean {
  if (!Number.isInteger(cell) || cell < 0 || cell >= field.tiles.length) return true;
  if (actor && isAirborne(actor)) return false;
  if (actor && isElevated(actor)) return !supportsPlatform(field, cell);
  const s = intactStructure(field, cell), t = field.tiles[cell];
  if (t === 'wall' || t === 'cliff') return true;
  if (s && (s.kind === 'wall' || s.kind === 'building' || s.kind === 'tower' || s.kind === 'gate' && s.gateState !== 'open')) return true;
  return t === 'deep_water' && s?.kind !== 'bridge' && !(actor && activeTraitIds(actor).includes('water-crossing'));
}
export function obstructionHeight(field: BattlefieldSpec, cell: number): number {
  if (field.tiles[cell] === 'cliff') return 3;
  if (field.tiles[cell] === 'wall') return 1;
  const s = intactStructure(field, cell);
  if (!s) return 0;
  return s.kind === 'building' || s.kind === 'tower' ? 2 : s.kind === 'wall' || s.kind === 'gate' && s.gateState !== 'open' ? 1 : 0;
}
export function layerMoveCost(field: BattlefieldSpec, cell: number, actor?: Combatant): number | undefined {
  if (!field.layerVersion) return undefined;
  if (actor && (isAirborne(actor) || isElevated(actor))) return 1;
  const s = intactStructure(field, cell), t = field.tiles[cell], overlays = field.overlays?.[cell] ?? [];
  const traits = actor ? activeTraitIds(actor) : [];
  if (groundBlocked(field, cell, actor)) return Infinity;
  if (s?.kind === 'bridge') return 1;
  let cost = t === 'shallow_water' ? traits.includes('water-crossing') ? 1 : 2
    : t === 'deep_water' ? 3 : t === 'swamp' ? traits.includes('water-crossing') ? 2 : 3
      : t === 'forest' ? traits.includes('forest-lore') ? 1 : 2
        : t === 'hill' ? traits.includes('mountain-born') ? 1 : 2 : t === 'rough' ? 2 : 1;
  // A road changes ground cost, not a barricade, water or rubble sitting on it.
  if (overlays.includes('road') && !['deep_water', 'shallow_water', 'swamp'].includes(t ?? '')) cost = 1;
  if (overlays.includes('rubble')) cost = Math.max(cost, 2);
  if (s?.kind === 'fortification') cost = Math.max(cost, 3);
  return cost;
}
export function structureDefense(field: BattlefieldSpec, defender: Combatant, attacker: Combatant, ranged: boolean): number {
  if (!field.layerVersion || isAirborne(defender) || defender.pos === undefined || attacker.pos === undefined) return 0;
  const s = intactStructure(field, defender.pos); if (!s) return 0;
  if (isElevated(defender)) return isElevated(attacker) ? 0 : 2;
  if (s.kind === 'cover') return ranged ? 2 : 0;
  if (s.kind !== 'fortification') return 0;
  // Facing in an older snapshot is harmless provenance, not a directional protection rule.
  return s.hp > s.hpMax / 2 ? 3 : 1;
}
export function canClimbFrom(field: BattlefieldSpec, actor: Combatant, target: number): boolean {
  if (actor.pos === undefined || isAirborne(actor)) return false;
  const adjacent = Math.abs(actor.pos % field.width - target % field.width)
    + Math.abs(Math.floor(actor.pos / field.width) - Math.floor(target / field.width)) === 1;
  if (!adjacent) return false;
  if (isElevated(actor)) return !groundBlocked(field, target, { ...actor, elevation: undefined });
  const s = intactStructure(field, target);
  return !!s?.top && (!!s.access?.includes(actor.pos) || activeTraitIds(actor).includes('siege-assault'));
}
export function meleeHeightReason(field: BattlefieldSpec, a: Combatant, b: Combatant): string | undefined {
  if (!field.layerVersion || isAirborne(a) || isAirborne(b) || isElevated(a) === isElevated(b)) return;
  const ground = isElevated(a) ? b : a, top = isElevated(a) ? a : b;
  return canClimbFrom(field, ground, top.pos!) ? undefined : '高差阻断近战；需通过梯道或具备登城能力';
}
/** Single-grade durability budget. Unit level does not silently rescale the scenery. */
export function structureDurability(kind: StructureKind, level: number): number {
  const coefficient = { cover: .25, fortification: .5, wall: 1, gate: .65, building: .75, tower: 1.2, bridge: .65 }[kind];
  return Math.round(80 * 2.2 ** (Math.max(1, Math.min(10, level)) - 1) * coefficient);
}
export function createStructure(kind: StructureKind, level = 3, options: Omit<Partial<FieldStructure>, 'kind' | 'level' | 'hp' | 'hpMax'> = {}): FieldStructure {
  const hp = structureDurability(kind, level);
  if (kind === 'fortification') { options = { ...options }; delete options.facing; }
  return { ...options, kind, level, hp, hpMax: hp, ...(kind === 'gate' ? { gateState: options.gateState ?? 'closed' } : {}) };
}
/** Per main action, not per bullet/member. Coefficients are game balance, not material physics.
 * Penetration/accuracy are intentionally not demolition bonuses; grade and damage are. */
export const BREACH_COEFFICIENTS: Readonly<Record<string, number>> = Object.freeze({
  demolition: 2, cannon: 1.5, 'indirect-cannon': 1.5, autocannon: .65,
  'heavy-rifle': .30, rifle: .16, firearm: .12, bow: .08, throwing: .12,
  'light-ranged': .08, energy: .65, magic: .55,
  blunt: 1, axe: 1, sword: .45, spear: .25, natural: .65, summon: .65,
});
export interface BreachBudget { damage: number; coefficient: number; enhancement: number; engineers: number; frontage: number; strength: number }
export function weaponBreachBudget(actor: Combatant, weapon: Weapon | undefined): BreachBudget {
  if (!weapon) return { damage: 0, coefficient: 0, enhancement: 1, engineers: 1, frontage: 1, strength: 1 };
  const mechanism = weapon.recipe?.mechanism ?? weapon.tags?.find(t => t.startsWith('mechanism:'))?.slice(10) ?? '';
  const ranged = weapon.tags?.includes('ranged');
  const coefficient = BREACH_COEFFICIENTS[mechanism] ?? (weapon.tags?.includes('blast') ? 1.5 : ranged ? .16 : .45);
  const enhancement = instanceMultiplier(weapon.recipe?.bonuses, 'damage', weapon.recipe?.variance, weapon.channel ?? 'kinetic');
  const engineers = activeTraitIds(actor).includes('siege-breaker') ? 1.5 : 1;
  const frontage = actor.scale === 'company' ? Math.min(3, Math.max(1, Math.sqrt(Math.max(0, actor.hp) / 10))) : 1;
  // Strong arms help melee demolition, not firearm/explosive projectile energy.
  const strength = ranged ? 1 : bodyProfile(actor.body, actor.damageModel).strength;
  const summonedShare = mechanism === 'summon' ? Math.min(1, weapon.damageScale ?? 1) : 1;
  const damage = Math.max(0, Math.round(structureDurability('wall', weapon.level ?? weapon.recipe?.power ?? 1) / 5
    * coefficient * enhancement * engineers * frontage * strength * summonedShare));
  return { damage, coefficient, enhancement, engineers, frontage, strength };
}
export function weaponStructureDamage(actor: Combatant, weapon: Weapon | undefined): number { return weaponBreachBudget(actor, weapon).damage; }
export function damageStructure(field: BattlefieldSpec, cell: number, amount: number): { damage: number; destroyed: boolean } {
  const s = intactStructure(field, cell);
  if (!s || !Number.isFinite(amount) || amount <= 0) return { damage: 0, destroyed: false };
  const damage = Math.min(s.hp, Math.round(amount)); s.hp -= damage;
  if (s.hp === 0) {
    if (s.kind === 'gate') s.gateState = 'destroyed';
    field.overlays ??= {}; field.overlays[cell] = [...new Set([...(field.overlays[cell] ?? []), 'rubble' as const])];
  }
  field.terrainRevision = (field.terrainRevision ?? 0) + 1;
  return { damage, destroyed: s.hp === 0 };
}
export function validateLayers(field: BattlefieldSpec): void {
  if (field.layerVersion === undefined) {
    if (field.structures !== undefined || field.overlays !== undefined || field.city !== undefined) throw Error('分层地图缺少版本');
    return;
  }
  if (field.layerVersion !== 1 || !Array.isArray(field.structures) || field.structures.length !== field.tiles.length) throw Error('结构层尺寸或版本损坏');
  const legalCell = (n: unknown): n is number => Number.isInteger(n) && Number(n) >= 0 && Number(n) < field.tiles.length;
  if (field.terrainRevision !== undefined && (!Number.isSafeInteger(field.terrainRevision) || field.terrainRevision < 0)) throw Error('地形修订号损坏');
  for (const s of field.structures) {
    if (s === null) continue;
    if (!s || !Object.hasOwn(STRUCTURE_NAMES, s.kind) || !Number.isInteger(s.level) || s.level < 1 || s.level > 10
      || !Number.isFinite(s.hpMax) || s.hpMax <= 0 || s.hpMax > 1e9 || !Number.isFinite(s.hp) || s.hp < 0 || s.hp > s.hpMax
      || s.owner !== undefined && !['ally', 'enemy'].includes(s.owner)
      || s.top !== undefined && typeof s.top !== 'boolean'
      || s.access !== undefined && (!Array.isArray(s.access) || s.access.some(p => !legalCell(p)))
      || s.facing !== undefined && !['north', 'south', 'east', 'west'].includes(s.facing)
      || s.kind === 'gate' && !['open', 'closed', 'destroyed'].includes(s.gateState ?? '')
      || s.kind === 'gate' && (s.hp === 0) !== (s.gateState === 'destroyed')) throw Error('结构数据损坏');
  }
  if (field.overlays !== undefined && (!field.overlays || typeof field.overlays !== 'object' || Array.isArray(field.overlays)
    || Object.entries(field.overlays).some(([p, overlays]) => !/^\d+$/.test(p) || !legalCell(+p) || !Array.isArray(overlays)
      || overlays.length > 2 || new Set(overlays).size !== overlays.length || overlays.some(t => !['road', 'rubble'].includes(t))))) throw Error('覆盖层损坏');
  if (field.city && (!['front', 'enclosure', 'riverside', 'hillside', 'broken', 'district'].includes(field.city.shape)
    || ['inside', 'frontline', 'gates', 'core', 'reserve'].some(key => {
      const cells = field.city![key as 'inside']; return !Array.isArray(cells) || cells.some(p => !legalCell(p)) || new Set(cells).size !== cells.length;
    }) || field.city.defender !== undefined && !['ally', 'enemy'].includes(field.city.defender))) throw Error('城区记录损坏');
  if (field.city?.breaches !== undefined && (!Array.isArray(field.city.breaches) || field.city.breaches.length > 3
    || field.city.breaches.some(group => !Array.isArray(group) || group.length < 1 || group.length > 2 || group.some(p => !legalCell(p))
      || group.length === 2 && Math.abs(group[0]! % field.width - group[1]! % field.width) + Math.abs(Math.floor(group[0]! / field.width) - Math.floor(group[1]! / field.width)) !== 1)
    || new Set(field.city.breaches.flat()).size !== field.city.breaches.flat().length)) throw Error('初始破口记录损坏');
  if (field.landmarks && (!Array.isArray(field.landmarks) || field.landmarks.length > 5 || field.landmarks.some(m => !m
    || typeof m.label !== 'string' || m.label.length > 64 || !Array.isArray(m.cells) || !m.cells.length || m.cells.some(p => !legalCell(p))))) throw Error('地标记录损坏');
}
