import type { BattleLogEntry, Combatant, Side } from './types.js';

export type DiplomacyMode = 'surrender' | 'withdraw' | 'accept' | 'reject';
export interface DiplomacyDecision { mode: DiplomacyMode; target?: Side; id?: number; text?: string }
export interface DiplomacyOffer {
  id: number; round: number; mode: 'surrender' | 'withdraw'; from: Side; targets: Side[]; text: string;
  replies: { from: Side; mode: 'accept' | 'reject'; round: number; text: string }[];
  status: 'pending' | 'accepted' | 'rejected' | 'expired';
}
export interface BattleDiplomacy { next: number; revision: number; offers: DiplomacyOffer[] }
export interface DiplomacyBattle {
  round: number; combatants: Combatant[]; diplomacy: BattleDiplomacy; log: BattleLogEntry[];
  isOver(): boolean; finishDiplomacy(winner: Side | 'draw', text: string): void;
}
const sides: Side[] = ['ally', 'enemy', 'neutral'];
export const sideName = (side: Side): string => ({ ally: '我方', enemy: '敌方', neutral: '第三方' })[side];
export const emptyDiplomacy = (): BattleDiplomacy => ({ next: 1, revision: 0, offers: [] });
export function fightingSides(b: Pick<DiplomacyBattle, 'combatants'>): Side[] {
  return sides.filter(side => b.combatants.some(u => u.side === side && u.hp > 0 && ['ready', 'routing'].includes(u.status) && !u.moraleState?.forcedRetreat));
}
export function incomingDiplomacy(b: DiplomacyBattle, side: Side): DiplomacyOffer[] {
  if (b.isOver()) return [];
  const active = fightingSides(b);
  return b.diplomacy.offers.filter(o => o.status === 'pending' && active.includes(o.from) && active.includes(side)
    && o.targets.includes(side) && !o.replies.some(r => r.from === side));
}
export function diplomacyOptions(b: DiplomacyBattle, side: Side): DiplomacyMode[] {
  const active = fightingSides(b);
  if (b.isOver() || !active.includes(side)) return [];
  const incoming = incomingDiplomacy(b, side);
  const canOffer = !b.diplomacy.offers.some(o => o.from === side && (o.round === b.round || o.status === 'pending' && o.targets.some(target => active.includes(target))));
  return [...(incoming.length ? ['accept', 'reject'] as const : []), ...(canOffer ? ['surrender', 'withdraw'] as const : [])];
}
export function checkDiplomacy(b: DiplomacyBattle, side: Side, decision: DiplomacyDecision): void {
  if (!diplomacyOptions(b, side).includes(decision.mode)) throw Error('当前不能提交此提议或答复');
  if (decision.text !== undefined && (typeof decision.text !== 'string' || decision.text.length > 1000)) throw Error('回复须为1000字以内文本');
  if (decision.mode === 'surrender' || decision.mode === 'withdraw') {
    const targets = fightingSides(b).filter(s => s !== side);
    if (!targets.includes(decision.target as Side)) throw Error('提议对象无效');
  } else if (!incomingDiplomacy(b, side).some(o => o.id === decision.id)) throw Error('提议已失效或已经答复');
}
/** All checks precede mutation; retries and duplicate clicks cannot apply a decision twice. */
export function applyDiplomacy(b: DiplomacyBattle, side: Side, decision: DiplomacyDecision): void {
  checkDiplomacy(b, side, decision);
  const state = b.diplomacy, text = decision.text?.trim() ?? '';
  const log = (message: string, audience: Side[]) => b.log.push({ round: b.round, kind: 'rule', text: message, observedBy: [...new Set(audience)] });
  if (decision.mode === 'surrender' || decision.mode === 'withdraw') {
    const targets = fightingSides(b).filter(s => s !== side && decision.target === s);
    const offer: DiplomacyOffer = { id: state.next++, round: b.round, mode: decision.mode, from: side, targets, text, replies: [], status: 'pending' };
    state.offers.push(offer);
    log(`${sideName(side)}向${targets.map(sideName).join('、')}提出${decision.mode === 'surrender' ? '投降' : '双方各自撤军'}${text ? `：“${text}”` : ''}`, [side, ...targets]);
  } else {
    const offer = state.offers.find(o => o.id === decision.id)!;
    offer.replies.push({ from: side, mode: decision.mode, round: b.round, text });
    log(`${sideName(side)}${decision.mode === 'accept' ? '同意' : '拒绝'}了${sideName(offer.from)}的${offer.mode === 'surrender' ? '投降' : '双方撤军'}请求${text ? `：“${text}”` : ''}`, [offer.from, ...offer.targets]);
    if (decision.mode === 'accept') {
      offer.status = 'accepted';
      const active = fightingSides(b);
      if (offer.mode === 'withdraw' && active.length === 2) b.finishDiplomacy('draw', '双方同意各自撤军，本场平局；保留实际伤亡');
      else if (active.length === 2) b.finishDiplomacy(side, `${sideName(offer.from)}投降，${sideName(side)}接受，${sideName(side)}获胜；保留实际伤亡`);
      else {
        const withdrawing: Side[] = (offer.mode === 'withdraw' ? [offer.from, side] : [offer.from]).filter(s => s !== 'ally');
        for (const u of b.combatants.filter(u => withdrawing.includes(u.side) && u.hp > 0 && ['ready', 'routing'].includes(u.status))) {
          u.status = 'routing'; delete u.tacticalPose;
          u.moraleState = { ...(u.moraleState ?? { terrorSeen: [], routs: 0, attempts: 0 }), forcedRetreat: offer.mode,
            routs: Math.max(1, u.moraleState?.routs ?? 0), attempts: 0, routedRound: b.round, lastRallyRound: b.round };
        }
        log(`${withdrawing.map(sideName).join('、')}全军按${offer.mode === 'withdraw' ? '双方撤军协议' : '投降决定'}溃退，不再重整参战${offer.mode === 'withdraw' && (offer.from === 'ally' || side === 'ally') ? '；我方保持原状态，由玩家自行撤离' : ''}`, sides);
      }
      for (const other of state.offers) if (other.status === 'pending' && (other.from === offer.from || !fightingSides(b).includes(other.from))) other.status = 'expired';
    } else if (offer.targets.every(target => offer.replies.some(r => r.from === target))) offer.status = 'rejected';
  }
  state.revision++;
}

/** Optional state keeps old snapshots unchanged; malformed new state is reported instead of replayed. */
export function restoreDiplomacy(value: unknown): BattleDiplomacy {
  if (value === undefined) return emptyDiplomacy();
  const v = value as BattleDiplomacy;
  if (!v || !Number.isSafeInteger(v.next) || v.next < 1 || !Number.isSafeInteger(v.revision) || v.revision < 0 || !Array.isArray(v.offers)) throw Error('投降／撤军记录损坏');
  const ids = new Set<number>();
  for (const o of v.offers) {
    if (!o || !Number.isSafeInteger(o.id) || o.id < 1 || o.id >= v.next || ids.has(o.id) || !Number.isSafeInteger(o.round) || o.round < 1
      || !['surrender', 'withdraw'].includes(o.mode) || !sides.includes(o.from) || !Array.isArray(o.targets) || o.targets.length !== 1
      || new Set(o.targets).size !== o.targets.length || o.targets.some(s => !sides.includes(s) || s === o.from)
      || typeof o.text !== 'string' || o.text.length > 1000 || !['pending', 'accepted', 'rejected', 'expired'].includes(o.status)
      || !Array.isArray(o.replies) || new Set(o.replies.map(r => r.from)).size !== o.replies.length
      || o.replies.some(r => !r || !o.targets.includes(r.from) || !['accept', 'reject'].includes(r.mode) || !Number.isSafeInteger(r.round) || r.round < o.round || typeof r.text !== 'string' || r.text.length > 1000)) throw Error('投降／撤军提议损坏');
    ids.add(o.id);
  }
  return structuredClone(v);
}
