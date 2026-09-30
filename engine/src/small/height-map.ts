import { isAirborne } from '../aerial.js';
import { activeTraitIds } from '../trait-sources.js';
import type { Combatant } from '../types.js';
import type { BattlefieldSpec } from './spatial.js';
import type { BattlefieldPlan } from './battlefield-plan.js';
export interface HeightTransition {
    from: number;
    to: number;
    kind: 'stairs' | 'ramp' | 'cliff';
}
export function groundHeightAt(field: BattlefieldSpec, cell: number): number { return field.spatialRulesVersion === 2 ? field.groundHeight?.[cell] ?? 0 : 0; }
export function surfaceHeightAt(field: BattlefieldSpec, cell: number, unit?: Combatant): number {
    const ground = groundHeightAt(field, cell), s = field.structures?.[cell];
    if (unit && isAirborne(unit)) {
        const obstacle = field.spatialRulesVersion === 2
            ? field.tiles[cell] === 'cliff' ? 3
                : field.tiles[cell] === 'wall' ? 1
                    : s?.hp ? s.obstructionHeight ?? (['building', 'tower'].includes(s.kind) ? 2 : ['wall', 'gate'].includes(s.kind) ? 1 : 0)
                        : 0
            : 0;
        return ground + Math.max(2, obstacle + 1);
    }
    if (unit?.elevation === 1)
        return ground + (s?.top ? s.platformHeight ?? (s.kind === 'tower' ? 2 : 1) : 1);
    if (s?.hp && s.kind === 'bridge')
        return s.deckHeight ?? ground;
    return ground;
}
export function unitHeight(field: BattlefieldSpec, unit: Combatant): number { return surfaceHeightAt(field, unit.pos!, unit); }
export function eyeHeight(field: BattlefieldSpec, unit: Combatant): number { return unitHeight(field, unit) + .25; }
export function heightTransition(field: BattlefieldSpec, from: number, to: number): HeightTransition['kind'] | 'flat' | 'slope' {
    const explicit = field.heightTransitions?.find(e => e.from === from && e.to === to || e.from === to && e.to === from);
    if (explicit)
        return explicit.kind;
    const delta = Math.abs(surfaceHeightAt(field, to) - surfaceHeightAt(field, from));
    return delta === 0 ? 'flat' : delta <= 1 ? 'slope' : 'cliff';
}
export function heightStepCost(field: BattlefieldSpec, from: number, to: number, actor?: Combatant): number {
    if (field.spatialRulesVersion !== 2 || actor && isAirborne(actor))
        return 0;
    const transition = heightTransition(field, from, to);
    const rise = surfaceHeightAt(field, to, actor) - surfaceHeightAt(field, from, actor);
    if (transition === 'cliff' && !(actor?.elevation === 1 && Math.abs(rise) <= 1))
        return Infinity;
    return Math.max(0, rise) * (actor && activeTraitIds(actor).includes('mountain-born') ? 0 : 1);
}
export function heightDescription(field: BattlefieldSpec, cell: number): string {
    if (field.spatialRulesVersion !== 2)
        return '';
    const h = surfaceHeightAt(field, cell);
    return `高度${h}`;
}
export function initializeHeightMap(field: BattlefieldSpec, plan: BattlefieldPlan | undefined): void {
    field.spatialRulesVersion = 2;
    field.groundHeight = Array(field.tiles.length).fill(0);
    for (let p = 0; p < field.tiles.length; p++)
        if (field.tiles[p] === 'hill')
            field.groundHeight[p] = 2;
    if (plan?.archetype === 'terraces')
        for (let p = 0; p < field.tiles.length; p++) {
            const y = Math.floor(p / field.width);
            if (!['deep_water', 'shallow_water', 'cliff'].includes(field.tiles[p]!))
                field.groundHeight[p] = Math.min(2, Math.floor(y / Math.max(1, Math.ceil(field.height / 3))));
        }
    if (plan?.archetype === 'hilltown' && field.city) {
        const cells = field.city.inside, xs = cells.map(p => p % field.width), min = Math.min(...xs), max = Math.max(...xs);
        for (const p of [...cells, ...field.city.frontline])
            field.groundHeight[p] = Math.max(0, Math.min(2, Math.floor((p % field.width - min) / Math.max(1, (max - min + 1) / 3))));
    }
    const locked = new Set<number>();
    for (const [index, mark] of (plan?.landmarks ?? []).entries())
        if (mark.height !== undefined) {
            const actual = mark.id ? field.landmarks?.find(m => m.id === mark.id) : field.landmarks?.[index];
            for (const p of actual?.cells ?? [])
                field.groundHeight[p] = mark.height;
            for (const p of actual?.cells ?? [])
                locked.add(p);
        }
    for (const e of plan?.intent?.entities ?? [])
        if (e.height !== undefined) {
            const cells = field.scene?.regions.find(r => r.id === e.id)?.cells ?? [];
            for (const p of cells) {
                field.groundHeight[p] = e.height;
                locked.add(p);
            }
        }
    for (const relation of plan?.intent?.relations ?? [])
        if (relation.relation === 'higher_than') {
            const a = field.scene?.regions.find(r => r.id === relation.subject), b = field.scene?.regions.find(r => r.id === relation.object);
            if (!a || !b)
                continue;
            const requested = plan?.intent?.entities.find(e => e.id === relation.subject)?.height;
            const platform = (p: number) => {
                const structure = field.structures?.[p];
                return structure?.hp && structure.top ? structure.platformHeight ?? (structure.kind === 'tower' ? 2 : 1) : 0;
            };
            const h = Math.max(...b.cells.map(p => surfaceHeightAt(field, p) + platform(p))) + 1
                - Math.max(...a.cells.map(platform));
            if (requested === undefined && h <= 3)
                for (const p of a.cells)
                    field.groundHeight[p] = Math.max(field.groundHeight[p]!, h);
        }
    // Build one-step foothills around elevated natural patches, without filling water or hard structures.
    for (let level = 3; level >= 2; level--)
        for (let p = 0; p < field.groundHeight.length; p++)
            if (field.groundHeight[p]! >= level) {
                for (const n of [p - field.width, p - 1, p + 1, p + field.width])
                    if (n >= 0 && n < field.groundHeight.length
                        && Math.abs(n % field.width - p % field.width) + Math.abs(Math.floor(n / field.width) - Math.floor(p / field.width)) === 1
                        && !locked.has(n) && !['deep_water', 'shallow_water', 'cliff'].includes(field.tiles[n]!) && !field.structures?.[n]
                        && field.groundHeight[n]! < field.groundHeight[p]! - 1)
                        field.groundHeight[n] = field.groundHeight[p]! - 1;
            }
    for (let p = 0; p < field.tiles.length; p++) {
        const s = field.structures?.[p];
        if (!s)
            continue;
        if (s.top)
            s.platformHeight = s.kind === 'tower' ? 2 : 1;
        if (s.kind === 'bridge') {
            const banks = [p - field.width, p - 1, p + 1, p + field.width].filter(n => n >= 0 && n < field.tiles.length
                && Math.abs(n % field.width - p % field.width) + Math.abs(Math.floor(n / field.width) - Math.floor(p / field.width)) === 1 && !['deep_water', 'shallow_water'].includes(field.tiles[n]!));
            s.deckHeight = Math.max(0, ...banks.map(n => field.groundHeight![n]!));
            for (const n of banks)
                if (Math.abs(s.deckHeight - field.groundHeight[n]!) > 1) {
                    field.heightTransitions ??= [];
                    field.heightTransitions.push({ from: n, to: p, kind: 'ramp' });
                }
        }
    }
}
export function validateHeightMap(field: BattlefieldSpec): void {
    if (field.spatialRulesVersion === undefined) {
        if (field.groundHeight !== undefined || field.heightTransitions !== undefined)
            throw Error('高度数据缺少空间规则版本');
        return;
    }
    if (field.spatialRulesVersion !== 2 || !field.layerVersion || !Array.isArray(field.groundHeight) || field.groundHeight.length !== field.tiles.length
        || field.groundHeight.some(h => !Number.isInteger(h) || h < 0 || h > 3))
        throw Error('地表高度数据损坏');
    if (field.heightTransitions !== undefined && (!Array.isArray(field.heightTransitions) || field.heightTransitions.length > field.tiles.length * 2
        || field.heightTransitions.some(e => !e || !Number.isInteger(e.from) || !Number.isInteger(e.to) || e.from < 0 || e.to < 0 || e.from >= field.tiles.length || e.to >= field.tiles.length
            || Math.abs(e.from % field.width - e.to % field.width) + Math.abs(Math.floor(e.from / field.width) - Math.floor(e.to / field.width)) !== 1
            || !['stairs', 'ramp', 'cliff'].includes(e.kind))))
        throw Error('高度连接数据损坏');
    for (const s of field.structures ?? [])
        if (s && [s.platformHeight, s.obstructionHeight, s.deckHeight].some(h => h !== undefined && (!Number.isFinite(h) || h < 0 || h > 5)))
            throw Error('结构高度损坏');
}
