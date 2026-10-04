import type { Suggestion } from './tags.js';
import type { NarrativeSave } from './narrative-state.js';

import { MAX_SMALL_UNITS, MAX_BATTLE_UNITS } from '../../engine/src/battle-limits.js';
export const RECOMMENDED_UNITS = MAX_SMALL_UNITS;
export const MAX_SCENE_UNITS = MAX_BATTLE_UNITS;
// One transaction can include all 64 deploys plus their updates and the field.
export const MAX_PROTOCOL_EVENTS = 160;
export const MAX_SPAWN_COUNT = 20;
export const MAX_PROTOCOL_CHARS = 64000;
export const GROUPING_HINT = '普通人员按同阵营、相近装备和训练编成少量编队，用hpMax表示人数；已有独立档案不能自动合并，也不要分多次绕过本场上限。';

/** spawn/deploy 明确指定本批完整出场名单；纯战外修改不改变选择。 */
export function hasNarrativeDeployment(events: Suggestion[]): boolean {
  return events.some((event) => event.kind === 'spawn' && !event.archiveOnly || event.kind === 'deploy');
}

/** 在生成装备/单位或复制整份存档前检查，拒绝时整批事实不变。 */
export function assertNarrativeCapacity(save: NarrativeSave, events: Suggestion[]): void {
  if (events.length > MAX_PROTOCOL_EVENTS) throw new Error(`单批最多${MAX_PROTOCOL_EVENTS}个事件`);
  const spawns = events.filter((e): e is Extract<Suggestion, { kind: 'spawn' }> => e.kind === 'spawn');
  if (spawns.some((e) => !Number.isInteger(e.count) || e.count < 1 || e.count > MAX_SPAWN_COUNT)) throw new Error(`count是单位卡数量，须为1–${MAX_SPAWN_COUNT}；人数写hpMax`);
  const count = spawns.reduce((n, e) => n + e.count, 0);
  if (count > MAX_SCENE_UNITS) throw new Error(`本批展开为${count}个新单位，最多${MAX_SCENE_UNITS}。${GROUPING_HINT}`);
  if (!hasNarrativeDeployment(events)) return; // 旧超量名单仍允许纯治疗/整理。
  // 新场只计算本批明确出场的档案，旧名单不占用本场名额。
  const deployed = new Set(events.filter((e): e is Extract<Suggestion, { kind: 'deploy' }> => e.kind === 'deploy').map((e) => e.id));
  const updates = new Map(events.filter((e): e is Extract<Suggestion, { kind: 'unit-update' }> => e.kind === 'unit-update').map((e) => [e.id, e.hp]));
  const alive = (save.storage ?? []).filter((r) => deployed.has(r.id) && !r.retired && r.status !== 'dead' && (updates.get(r.id) ?? r.hp) > 0).length;
  const joining = spawns.reduce((n, e) => n + (e.hp === 0 || e.archiveOnly ? 0 : e.count), 0);
  if (alive + joining > MAX_SCENE_UNITS) throw new Error(`本场合计将达${alive + joining}个参战单位，上限${MAX_SCENE_UNITS}；本批未提交。${GROUPING_HINT}`);
}
