import type { Enhancements } from './enhancements.js';

/** V29 capacity rules are explicit; historical snapshots and physical loads stay frozen. */
export const LOAD_MODEL = 'capacity-v2' as const;
export type LoadModel = typeof LOAD_MODEL;
export const revisedLoad = (value: { loadModel?: LoadModel }) => value.loadModel === LOAD_MODEL;
export function validateLoadModel(value: unknown): void {
  if (value !== undefined && value !== LOAD_MODEL) throw Error('未知负载模型');
}

export const REVISED_HUMAN_CAPACITY = [5, 8, 9, 12, 14, 16, 18, 20, 22, 24] as const;
export const VEHICLE_CAPACITY = [12, 16, 20, 24, 28, 34, 40, 46, 52, 60] as const;
export const REVISED_ARTILLERY_LOAD: Readonly<Record<string, number>> = {
  autocannon: 8, cannon: 12, 'indirect-cannon': 12, rocket: 3,
};
export const REVISED_ARMOR_LOAD = [0, 2, 4, 6, 8] as const;

/** Weight is independent of power/L. Reciprocal steps never make physical burden zero. */
export function modifiedEquipmentLoad(base: number, bonuses?: Enhancements): number {
  return Number((base * 1.1 ** (bonuses?.weight ?? 0)).toPrecision(12));
}
