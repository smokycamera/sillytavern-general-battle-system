import type { BodyKind } from './types.js';

export const VEHICLE_SIZES = {
  smallvehicle:  { label: '小型载具', channels: 1, capacity: 0.75 },
  mediumvehicle: { label: '中型载具', channels: 2, capacity: 1 },
  largevehicle:  { label: '大型载具', channels: 4, capacity: 4 },
  hugevehicle:   { label: '超大型载具', channels: 8, capacity: 16 },
  giantvehicle:  { label: '巨构载具', channels: 16, capacity: 64 },
} as const;

export type VehicleSize = keyof typeof VEHICLE_SIZES;
export function hasVehicleSize(body: unknown): body is VehicleSize {
  return typeof body === 'string' && Object.hasOwn(VEHICLE_SIZES, body);
}
export function isVehicleBody(body: unknown): body is VehicleSize | 'vehicle' {
  return body === 'vehicle' || hasVehicleSize(body);
}
export function baseBody(body?: BodyKind) {
  return isVehicleBody(body) ? 'vehicle' : body ?? 'human';
}
export function vehicleChannels(body?: BodyKind): number {
  return hasVehicleSize(body) ? VEHICLE_SIZES[body].channels : 1;
}

export const BODY_LABELS = {
  human: '普通人形', large: '大型生物', giant: '巨型生物', vehicle: '载具平台',
  ...Object.fromEntries(Object.entries(VEHICLE_SIZES).map(([key, value]) => [key, value.label])) as Record<VehicleSize,string>,
};
export const isBodyKind = (value: unknown): value is BodyKind => typeof value === 'string' && Object.hasOwn(BODY_LABELS,value);
