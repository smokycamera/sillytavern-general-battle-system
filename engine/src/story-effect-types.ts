import type { EffectOp } from './types.js';

/** 新剧情来源的冻结轮末操作；旧来源缺省此字段，读取时不重编译。 */
export type StoryRoundEndEffect = { op: 'heal'; amount: number; power?: number }
  | Extract<EffectOp, { op: 'morale' | 'resource' | 'dispel' }>;
export const STORY_ROUND_END_IDS = ['heal', 'morale-up', 'morale-down', 'restore', 'drain', 'cleanse', 'dispel'] as const;
export type StoryRoundEndId = typeof STORY_ROUND_END_IDS[number];
export function storyRoundEndId(effect: StoryRoundEndEffect): StoryRoundEndId {
  return effect.op === 'heal' ? 'heal' : effect.op === 'morale' ? effect.amount >= 0 ? 'morale-up' : 'morale-down'
    : effect.op === 'resource' ? effect.amount >= 0 ? 'restore' : 'drain' : effect.polarity === 'negative' ? 'cleanse' : 'dispel';
}
export function positiveStoryRoundEnd(effect: StoryRoundEndEffect): boolean {
  return effect.op === 'heal' || (effect.op === 'morale' || effect.op === 'resource' ? effect.amount >= 0 : effect.polarity === 'negative');
}
export function validateStoryRoundEndEffects(effects: StoryRoundEndEffect[]): void {
  if (!Array.isArray(effects) || !effects.length || effects.some(e => !e || (e.op === 'heal'
    ? !Number.isFinite(e.amount) || e.amount <= 0 || e.amount > Number.MAX_SAFE_INTEGER
      || e.power !== undefined && (!Number.isSafeInteger(e.power) || e.power < 1 || e.power > 10)
    : e.op === 'morale' ? !Number.isSafeInteger(e.amount)
    : e.op === 'resource' ? e.resource !== 'SP' || !Number.isSafeInteger(e.amount) || e.maximum !== 'training'
    : e.op === 'dispel' ? !['positive', 'negative'].includes(e.polarity) || !Number.isSafeInteger(e.count) || e.count < 1 || e.count > 99
    : true))) throw new Error('统一效果的轮末结算规格损坏');
}
