import type { Suggestion } from './tags.js';

import { MAX_BATTLE_UNITS } from '../../engine/src/battle-limits.js';
export const MAX_SCENE_UNITS = MAX_BATTLE_UNITS;
// One transaction can include all 64 deploys plus their updates and the field.
export const MAX_PROTOCOL_EVENTS = 160;
export const MAX_SPAWN_COUNT = 20;
export const MAX_PROTOCOL_CHARS = 64000;
export const GROUPING_HINT = '普通人员按同阵营、相近装备和训练编成少量编队，用hpMax表示人数；已有独立档案不能自动合并，按实际编制填写。';

/** spawn/deploy 明确指定本批完整出场名单；纯战外修改不改变选择。 */
export function hasNarrativeDeployment(events: Suggestion[]): boolean {
  return events.some((event) => event.kind === 'spawn' && !event.archiveOnly || event.kind === 'deploy');
}

/** 在生成装备/单位或复制整份存档前检查，拒绝时整批事实不变。 */
export function assertNarrativeCapacity(events: Suggestion[]): void {
  if (events.length > MAX_PROTOCOL_EVENTS) throw new Error(`单批最多${MAX_PROTOCOL_EVENTS}个事件`);
  const spawns = events.filter((e): e is Extract<Suggestion, { kind: 'spawn' }> => e.kind === 'spawn');
  if (spawns.some((e) => !Number.isInteger(e.count) || e.count < 1 || e.count > MAX_SPAWN_COUNT)) throw new Error(`count是单位卡数量，须为1–${MAX_SPAWN_COUNT}；人数写hpMax`);
}
