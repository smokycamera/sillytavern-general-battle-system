import { BattlefieldPlanError } from './battlefield-error.js';
import type { BattlefieldPlan, DeploymentPlan } from './battlefield-plan.js';
import type { WorldAnchor } from './scene-intent.js';
import type { Combatant } from '../types.js';
import type { SceneRegion } from './scene-compiler.js';
import { groundBlocked, intactStructure } from './layers.js';
import { footprint, gridDistance, type BattlefieldSpec } from './spatial.js';

type Side = 'ally' | 'enemy';
type Post = DeploymentPlan['post'];
/** Snapshot budget for deployment zones (validateSceneRecord). */
const MAX_ZONES = 26;

/** Thirds of the battlefield, the same split for every map size; the compass names the 3×3 cell. */
function band(size: number, index: number): [number, number] {
  const a = Math.round(size / 3), b = Math.round(size * 2 / 3);
  return index === 0 ? [0, a - 1] : index === 1 ? [a, b - 1] : [b, size - 1];
}
function sectorBounds(field: BattlefieldSpec, anchor: WorldAnchor): [number, number, number, number] {
  const [x0, x1] = band(field.width, anchor.includes('west') ? 0 : anchor.includes('east') ? 2 : 1);
  const [y0, y1] = band(field.height, anchor.includes('north') ? 0 : anchor.includes('south') ? 2 : 1);
  return [x0, x1, y0, y1];
}
export function sectorCells(field: BattlefieldSpec, anchor: WorldAnchor): number[] {
  const [x0, x1, y0, y1] = sectorBounds(field, anchor), cells: number[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) cells.push(y * field.width + x);
  return cells;
}
function sectorDistance(field: BattlefieldSpec, p: number, anchors: readonly WorldAnchor[]): number {
  const x = p % field.width, y = Math.floor(p / field.width);
  return Math.min(...anchors.map(a => {
    const [x0, x1, y0, y1] = sectorBounds(field, a);
    return Math.max(0, x0 - x, x - x1) + Math.max(0, y0 - y, y - y1);
  }));
}
/** Cells a force needs: two ordinary units or one large unit share a cell. */
function requiredCells(units: readonly Combatant[]): number {
  const large = units.filter(u => footprint(u) === 2).length;
  return large + Math.ceil((units.length - large) / 2);
}
/** Whole distance rings around the origin until the force has room to spread; deterministic, no RNG. */
function nearestRings(field: BattlefieldSpec, distance: (p: number) => number, usable: (p: number) => boolean, required: number): number[] {
  const target = Math.max(6, required + 2, Math.ceil(required * 1.5));
  const ranked = field.tiles.map((_, p) => p).filter(usable).map(p => ({ p, d: distance(p) })).sort((a, b) => a.d - b.d || a.p - b.p);
  if (!ranked.length) return [];
  const own = ranked.filter(c => c.d === 0);
  if (own.length >= target) return own.map(c => c.p);
  const cutoff = ranked[Math.min(target, ranked.length) - 1]!.d;
  return ranked.filter(c => c.d <= cutoff).map(c => c.p);
}
function cityCells(field: BattlefieldSpec): Set<number> {
  return new Set(field.city ? [...field.city.inside, ...field.city.frontline] : []);
}
/**
 * Ground in front of a city that stands against a map edge. A siege city walled only on its front continues off the
 * map on its other sides, and a town at the edge leaves only a thin strip behind it; neither is a starting area.
 */
function inFront(field: BattlefieldSpec): (p: number) => boolean {
  const city = field.city;
  if (!city?.facing || city.shape !== 'front' && city.shape !== 'district') return () => true;
  const cells = [...city.inside, ...city.frontline], xs = cells.map(p => p % field.width), ys = cells.map(p => Math.floor(p / field.width));
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const backed = city.facing === 'south' ? minY <= 1 : city.facing === 'north' ? maxY >= field.height - 2 : city.facing === 'east' ? minX <= 1 : maxX >= field.width - 2;
  if (city.shape === 'district' && !backed) return () => true;
  return p => city.facing === 'south' ? Math.floor(p / field.width) > maxY : city.facing === 'north' ? Math.floor(p / field.width) < minY
    : city.facing === 'east' ? p % field.width > maxX : p % field.width < minX;
}
/**
 * Where a force may start, from the scene's roles rather than from a relation's wording: in a siege the
 * attackers start outside the walls and the defenders inside unless they sortie; at a city in an open-field
 * battle both sides start outside it, in street fighting inside it. A stated post overrides the open-field default.
 */
export function forceLegality(field: BattlefieldSpec, side: Side, post?: Post): (p: number) => boolean {
  const city = field.city, inCity = cityCells(field), open = (p: number) => !groundBlocked(field, p);
  const outside = () => { const front = inFront(field); return (p: number) => open(p) && !inCity.has(p) && front(p); };
  if (city?.defender) {
    if (side !== city.defender || post === 'outside') return outside();
    const inside = new Set(city.inside);
    return p => open(p) && inside.has(p);
  }
  if (!city || !inCity.size || field.generation?.scene === 'interior') return open;
  return (post ? post !== 'outside' : field.generation?.scene === 'city_streets') ? p => open(p) && inCity.has(p) : outside();
}
/** The scene's standard area for a side: the siege approach band or garrison, a sortie before its walls, else its own map edge. */
function defaultArea(field: BattlefieldSpec, side: Side, post?: Post): number[] {
  const base = field.deploymentZones?.find(z => z.side === side && !z.unitId && !z.landmarkId && !z.relation)?.cells;
  const legal = forceLegality(field, side, post);
  if (base?.length && post !== 'outside') return base.filter(legal);
  if (field.city?.defender === side && post === 'outside') {
    const walls = field.city.frontline;
    return nearestRings(field, p => Math.min(...walls.map(q => gridDistance(field, p, q))), legal, 0);
  }
  return nearestRings(field, p => sectorDistance(field, p, side === 'enemy' ? ['north_west', 'north', 'north_east'] : ['south_west', 'south', 'south_east']), legal, 0);
}

/**
 * Beside an unwalled city each side without a stated position starts at its own map edge, on the scene's side of the
 * city (outside it in open-field battles, inside it in street fighting), instead of on fixed rows that may cross it.
 */
export function withCitySides(field: BattlefieldSpec, plan: BattlefieldPlan): BattlefieldPlan {
  const placed = (side: Side) => plan.deployments?.some(d => d.subject === side) || field.deploymentZones?.some(z => z.side === side && !z.unitId);
  const missing = (['enemy', 'ally'] as const).filter(side => !placed(side));
  return missing.length ? { ...plan, deployments: [...plan.deployments ?? [], ...missing.map(side => ({ subject: side,
    at: side === 'enemy' ? ['north_west', 'north', 'north_east'] as WorldAnchor[] : ['south_west', 'south', 'south_east'] as WorldAnchor[] }))] } : plan;
}

/**
 * Siege roles outrank a relation's wording. An attacker's relation never puts it inside the walls; one aimed at the
 * city itself only names the assault, so the attackers use the approach band. A defender's relation to the city or one
 * of its gates keeps it inside. Only an explicit unit inside or occupying a named place may start behind enemy walls.
 */
export function clipRelationZone(field: BattlefieldSpec, side: Side, unitId: string | undefined, relation: string, region: SceneRegion,
  cells: number[], required: number): { cells: number[]; note?: string } {
  const city = field.city, inCity = cityCells(field);
  if (!city || !inCity.size) return { cells };
  const holds = relation === 'occupies' || relation === 'inside';
  const toRegion = (p: number) => Math.min(...(region.cells.length ? region.cells : region.access).map(q => gridDistance(field, p, q)));
  if (city.defender && side !== city.defender) {
    if (unitId && holds && region.kind !== 'city') return { cells };
    const legal = forceLegality(field, side), kept = cells.filter(legal);
    if (region.kind !== 'city' && kept.length >= Math.max(1, required)) return { cells: kept, ...(kept.length < cells.length ? { note: '攻方只在城外开局' } : {}) };
    const grown = region.kind === 'city' ? defaultArea(field, side) : nearestRings(field, toRegion, legal, required);
    return { cells: grown, note: region.kind === 'city' ? `攻方改在城外接近${region.label}` : `攻方改在${region.label}附近城外` };
  }
  if (city.defender) {
    const cityPlace = region.kind === 'city' || region.kind === 'gate' || region.cells.every(p => inCity.has(p));
    if (!cityPlace) return { cells };
    // Holding the city includes its wall tops, so part of the garrison still mans the walls.
    const tops = region.kind === 'city' ? city.frontline.filter(p => !!intactStructure(field, p)?.top && !cells.includes(p)) : [];
    const kept = [...cells.filter(p => inCity.has(p)), ...tops];
    if (kept.length >= Math.max(1, required)) return { cells: kept, ...(kept.length < cells.length + tops.length ? { note: `守方在城内据守${region.label}` } : {}) };
    return { cells: nearestRings(field, toRegion, forceLegality(field, side), required), note: `守方在城内据守${region.label}` };
  }
  // Open-field battle beside a town: approaching or guarding it does not place a force inside it.
  if (region.kind === 'city' && !holds && field.generation?.scene !== 'city_streets') {
    const legal = forceLegality(field, side, 'outside'), kept = cells.filter(legal);
    return kept.length >= Math.max(1, required) ? { cells: kept } : { cells: nearestRings(field, toRegion, legal, required) };
  }
  return { cells };
}

/**
 * Turn compass deployments into deployment zones. Side zones are sized for the force without a detachment of its own,
 * kept one cell clear of the opposing side, and grown ring by ring when the requested cell is too small. Siege attackers
 * asked to start inside or behind the walls use the approach band instead; every such change is reported.
 */
export function applyPlannedDeployments(field: BattlefieldSpec, plan: BattlefieldPlan | undefined, roster: readonly Combatant[] = [], unitBindings: Record<string, string> = {}): void {
  const plans = plan?.deployments;
  if (!plans?.length) return;
  const active = roster.filter(u => u.hp > 0 && u.status === 'ready'), notes: string[] = [];
  const zones = field.deploymentZones ??= [];
  const resolved = plans.map(d => {
    if (d.subject === 'ally' || d.subject === 'enemy') return { plan: d, side: d.subject as Side };
    const unitId = unitBindings[d.subject], unit = roster.find(u => u.id === unitId);
    if (!unitId || !unit || (unit.side !== 'ally' && unit.side !== 'enemy')) throw new BattlefieldPlanError('部署引用了未参战单位');
    return { plan: d, side: unit.side as Side, unitId, name: unit.name };
  });
  // A force whose position a narrative relation already fixes keeps that relation.
  const related = (side: Side, unitId?: string) => zones.some(z => !!z.landmarkId && (unitId ? z.unitId === unitId : !z.unitId && z.side === side));
  const detached = new Set(resolved.filter(r => r.unitId && !related(r.side, r.unitId)).map(r => r.unitId!));
  // The garrison claims its ground first, unless it sallies out into the attackers' approach.
  const defender = field.city?.defender, sortie = resolved.some(r => !r.unitId && r.side === defender && r.plan.post === 'outside');
  const first: Side = defender ? sortie ? defender === 'ally' ? 'enemy' : 'ally' : defender : 'enemy';
  const ordered = [...resolved].sort((a, b) => Number(!!a.unitId) - Number(!!b.unitId) || Number(a.side !== first) - Number(b.side !== first));
  for (const r of ordered) {
    if (related(r.side, r.unitId)) continue;
    const who = r.unitId ? r.name! : r.side === 'ally' ? '我方' : '敌方', attacker = !!defender && defender !== r.side;
    const post = attacker && r.plan.post !== 'outside' ? undefined : r.plan.post;
    const actors = r.unitId ? active.filter(u => u.id === r.unitId) : active.filter(u => u.side === r.side && !detached.has(u.id));
    // Keep one empty cell between opposing forces at the start.
    const avoid = new Set(zones.filter(z => z.side !== r.side).flatMap(z => z.cells).flatMap(p => [p, p - 1, p + 1, p - field.width, p + field.width]
      .filter(q => q >= 0 && q < field.tiles.length && gridDistance(field, p, q) <= 1)));
    const toSector = (p: number) => sectorDistance(field, p, r.plan.at);
    let cells: number[] = [], platform = false;
    if (r.unitId && post === 'wall' && defender === r.side) {
      const tops = (p: number) => field.city!.frontline.includes(p) && !!intactStructure(field, p)?.top && !avoid.has(p);
      cells = nearestRings(field, toSector, tops, 1).slice(0, 6); platform = cells.length > 0;
      // Compound walls and broken walls have no walkway; the unit then stays with the garrison.
      if (!platform) { notes.push(`${who}无墙可登，随守军部署`); continue; }
    } else if (!r.unitId && defender === r.side && post !== 'outside') {
      // The whole garrison area stays available; the deployment scorer keeps it near the walls.
      const legal = forceLegality(field, r.side, post);
      cells = field.tiles.map((_, p) => p).filter(p => legal(p) && !avoid.has(p));
    } else {
      const legal = forceLegality(field, r.side, post), required = requiredCells(actors);
      // An assault forms up beyond the reach of a first rush from the walls, when the map leaves room for it.
      const walls = attacker ? field.city!.frontline : [], wallGap = (p: number) => walls.length ? Math.min(...walls.map(q => gridDistance(field, p, q))) : Infinity;
      const standoff = [3, 2, 0].find(gap => field.tiles.filter((_, p) => legal(p) && !avoid.has(p) && wallGap(p) >= gap).length >= required + 2) ?? 0;
      // Nobody starts on a bridge: it is the crossing both sides contest.
      const usable = (p: number) => legal(p) && !avoid.has(p) && wallGap(p) >= standoff && field.structures?.[p]?.kind !== 'bridge';
      const fits = field.tiles.some((_, p) => usable(p) && toSector(p) === 0);
      // A detachment that cannot start where it was sent stays with its own side.
      if (!fits && r.unitId) { notes.push(`${who}随本方部署`); continue; }
      if (fits || !attacker && post !== 'outside') cells = nearestRings(field, toSector, usable, required);
      else {
        // Attackers fall back to the approach band; a sortie forms up before its own walls.
        const area = new Set(defaultArea(field, r.side, post).filter(usable));
        cells = area.size ? nearestRings(field, p => area.has(p) ? 0 : toSector(p), usable, required) : [];
      }
      if (!fits) notes.push(who + (attacker ? '改在城外正面开局' : post === 'outside' ? '改在城墙前列阵' : '开局位置就近调整'));
    }
    if (cells.length < requiredCells(actors) && post && !attacker && !platform) {
      // A post the scene cannot hold, such as a town both sides were asked to fill, falls back to the scene's own side.
      const legal = forceLegality(field, r.side), wider = nearestRings(field, toSector, p => legal(p) && !avoid.has(p), requiredCells(actors));
      if (wider.length > cells.length) { cells = wider; notes.push(`${who}改按默认位置部署`); }
    }
    if (!cells.length) throw new BattlefieldPlanError(`${who}没有可用的开局位置，请调整部署方位`);
    // A side's compass area replaces the scene's standard area for that side.
    if (!r.unitId) { const kept = zones.filter(z => z.side !== r.side || !!z.unitId || !!z.landmarkId); zones.length = 0; zones.push(...kept); }
    zones.push({ side: r.side, ...(r.unitId ? { unitId: r.unitId } : {}), cells, relation: post ? 'sector:' + post : 'sector', ...(platform ? { platform: true } : {}) });
  }
  if (zones.length > MAX_ZONES) throw new BattlefieldPlanError('单独部署的单位过多，请合并为整方部署');
  if (notes.length) field.generation!.notes = [...(field.generation!.notes ?? []), ...notes];
}
