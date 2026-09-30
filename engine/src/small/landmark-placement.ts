import type { LandmarkPlan } from './battlefield-plan.js';
import { gridDistance, neighbors, type BattlefieldSpec } from './spatial.js';
import { groundBlocked } from './layers.js';
import type { WorldAnchor } from './scene-intent.js';
export function worldAnchorCell(field: BattlefieldSpec, anchor: WorldAnchor): number {
    const x = anchor.includes('west') ? Math.max(1, Math.floor(field.width * .2)) : anchor.includes('east') ? Math.min(field.width - 2, Math.floor(field.width * .8)) : Math.floor(field.width / 2);
    const y = anchor.includes('north') ? Math.max(1, Math.floor(field.height * .2)) : anchor.includes('south') ? Math.min(field.height - 2, Math.floor(field.height * .8)) : Math.floor(field.height / 2);
    return y * field.width + x;
}
export function landmarkAnchorCell(field: BattlefieldSpec, anchor: LandmarkPlan['anchor'], defender: 'ally' | 'enemy', frontDepth: number, left: number, right: number): number {
    if (/^(north|south|east|west)/.test(anchor) || anchor === 'center')
        return worldAnchorCell(field, anchor as WorldAnchor);
    if (/^(ally|enemy|center)_/.test(anchor)) {
        const y = anchor.startsWith('ally_') ? field.height - 3 : anchor.startsWith('enemy_') ? 2 : Math.floor(field.height / 2);
        return y * field.width + (anchor.endsWith('left') ? 1 : anchor.endsWith('right') ? field.width - 2 : Math.floor(field.width / 2));
    }
    const x = anchor.endsWith('left') ? left + 2 : anchor.endsWith('right') ? right - 2 : Math.floor(field.width / 2);
    const d = anchor === 'approach' ? Math.min(field.height - 3, frontDepth + 1) : anchor.startsWith('front') ? frontDepth - 1
        : anchor === 'rear' ? 2 : anchor === 'core' ? Math.floor((field.city?.core[0] ?? field.objective.cell) / field.width) * (defender === 'enemy' ? 1 : -1) + (defender === 'enemy' ? 0 : field.height - 1)
            : Math.max(2, frontDepth - 3);
    const y = defender === 'enemy' ? d : field.height - 1 - d;
    return Math.max(1, Math.min(field.height - 2, y)) * field.width + Math.max(0, Math.min(field.width - 1, x));
}
export function riverbankCells(field: BattlefieldSpec): number[] {
    return field.tiles.flatMap((t, p) => t !== 'deep_water' && t !== 'shallow_water' && !groundBlocked(field, p)
        && neighbors(field, p).some(n => ['deep_water', 'shallow_water'].includes(field.tiles[n]!)) ? [p] : []);
}
/** Restrict local relocation to the requested region; never silently move a landmark across the battlefield. */
export function landmarkCandidates(field: BattlefieldSpec, mark: LandmarkPlan, anchor: number, legal: (p: number) => boolean): number[] {
    const radius = Math.max(2, Math.floor(field.width / 3));
    let cells = mark.anchor === 'riverbank' ? riverbankCells(field) : field.tiles.map((_, p) => p).filter(p => gridDistance(field, p, anchor) <= radius);
    if (mark.anchor.startsWith('inside') && field.city)
        cells = cells.filter(p => field.city!.inside.includes(p));
    if (mark.anchor.startsWith('ally'))
        cells = cells.filter(p => Math.floor(p / field.width) >= field.height / 2);
    if (mark.anchor.startsWith('enemy'))
        cells = cells.filter(p => Math.floor(p / field.width) < field.height / 2);
    if (mark.edge)
        cells = cells.filter(p => mark.anchor.includes('west') ? p % field.width === 0 : mark.anchor.includes('east') ? p % field.width === field.width - 1 : mark.anchor.includes('north') ? Math.floor(p / field.width) === 0 : mark.anchor.includes('south') ? Math.floor(p / field.width) === field.height - 1 : true);
    return cells.filter(legal).sort((a, b) => gridDistance(field, a, anchor) - gridDistance(field, b, anchor) || a - b);
}
