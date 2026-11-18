import { enhancementLabel, parseEnhancementSuffix, validateEnhancements, type Enhancements } from './enhancements.js';
import type { Combatant } from './types.js';

export const platformKinds = { animal: '坐骑', open: '开放载具', transport: '封闭载具' } as const;
export interface Platform { kind: keyof typeof platformKinds; power: number; bonuses?: Enhancements }
export interface Ride { platformId: string; mode: 'mount' | 'aboard'; seats?: [number,number][]; stranded?: boolean }
export type PlatformUnit = Pick<Combatant, 'id' | 'name' | 'side' | 'body' | 'scale' | 'hp' | 'platform' | 'seats' | 'ride'>;

export function parsePlatform(text: string): Platform {
  const spec = parseEnhancementSuffix(text, 'unit');
  const match = /^(坐骑|开放载具|封闭载具|运输载具)L(10|[1-9])$/i.exec(spec.text);
  if (!match) throw Error('platform 须为坐骑、开放载具或封闭载具及 L1–L10 规格');
  const kind = match[1] === '坐骑' ? 'animal' : match[1] === '开放载具' ? 'open' : 'transport';
  return { kind, power: Number(match[2]), ...(spec.bonuses ? { bonuses: spec.bonuses } : {}) };
}
export function platformText(platform: Platform): string {
  return platformKinds[platform.kind] + 'L' + platform.power + enhancementLabel(platform.bonuses);
}
export function validatePlatform(unit: Pick<PlatformUnit, 'platform'|'seats'|'ride'|'body'>): void {
  const p = unit.platform;
  if (p !== undefined) {
    if (!p || !Object.hasOwn(platformKinds,p.kind) || !Number.isInteger(p.power) || p.power < 1 || p.power > 10) throw Error('坐骑或载具规格无效');
    validateEnhancements(p.bonuses, 'unit');
    if ((p.kind !== 'animal') !== (unit.body === 'vehicle')) throw Error('车辆规格须使用 vehicle 身体，生物坐骑须使用生物身体');
  }
  if (unit.seats !== undefined && (!p || !Number.isSafeInteger(unit.seats) || unit.seats < 1)) throw Error('seats 需要有平台规格及正整数座位数');
  if (unit.ride?.seats !== undefined && (!Array.isArray(unit.ride.seats) || unit.ride.seats.some(r =>
    !Array.isArray(r) || r.length !== 2 || !Number.isSafeInteger(r[0]) || r[0] < 0 || !Number.isSafeInteger(r[1]) || r[1] < 1 || !Number.isSafeInteger(r[0]+r[1])))) throw Error('乘员座位记录无效');
  if (unit.ride !== undefined && (p || !unit.ride || !['mount','aboard'].includes(unit.ride.mode) || typeof unit.ride.platformId !== 'string' || !unit.ride.platformId.trim())) throw Error('搭载关系无效或平台嵌套');
}
export const unitCount = (u: Pick<PlatformUnit,'scale'|'hp'>) => u.scale === 'hero' ? Number(u.hp > 0) : u.hp;
export function boardingReason(units: readonly PlatformUnit[], rider: PlatformUnit, carrier: PlatformUnit, mode: Ride['mode'], allowOverflow = false): string | undefined {
  if (carrier.id === rider.id || rider.platform || !carrier.platform || carrier.ride || rider.side !== carrier.side || carrier.hp <= 0 || rider.hp <= 0) return '需要同阵营可用平台与乘员';
  const others = units.filter(u => u.id !== rider.id && u.hp > 0 && u.ride?.platformId === carrier.id);
  if (mode === 'mount' && others.some(u => u.ride!.mode === 'mount')) return '该平台已有控制单位';
  if (allowOverflow) return;
  const free = (carrier.seats ?? 1) * unitCount(carrier) - others.reduce((sum,u) => sum + (u.ride?.stranded ? 0 : unitCount(u)),0);
  if (unitCount(rider) > free) return carrier.name + '缺少' + (unitCount(rider) - free) + '个座位';
}
export function validateRides(units: readonly PlatformUnit[], allowOverflow = false): void {
  for (const u of units) {
    validatePlatform(u);
    if (!u.ride || u.hp <= 0) continue;
    const carrier = units.find(p => p.id === u.ride!.platformId);
    const reason = carrier ? boardingReason(units,u,carrier,u.ride.mode,allowOverflow) : '平台档案不存在或未部署';
    if (reason) throw Error(u.name + '：' + reason);
  }
}
