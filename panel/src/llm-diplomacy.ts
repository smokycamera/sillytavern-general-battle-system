import { checkDiplomacy, diplomacyOptions, fightingSides, incomingDiplomacy, type DiplomacyBattle, type DiplomacyDecision, type Side } from '../../engine/src/index.js';

export const diplomacySide = (side: Side, own: Side): string => side === own ? 'friendly' : 'opponent-' + (['ally', 'enemy', 'neutral'].filter(s => s !== own).indexOf(side) + 1);
/** Faction-level negotiation contains no hidden units, positions or unrelated private replies. */
export function commandDiplomacy(b: DiplomacyBattle, side: Side) {
  const alias = (s: Side) => diplomacySide(s, side);
  const view = (o: DiplomacyBattle['diplomacy']['offers'][number]) => ({ id: o.id, mode: o.mode, from: alias(o.from), target: alias(o.targets[0]!), text: o.text });
  return { self: 'friendly', targets: fightingSides(b).filter(s => s !== side).map(alias), options: diplomacyOptions(b, side),
    incoming: incomingDiplomacy(b, side).map(view),
    recent: b.diplomacy.offers.filter(o => o.from === side || o.targets.includes(side)).slice(-6).flatMap(o => [view(o),
      ...o.replies.filter(r => r.from === side || o.from === side).map(r => ({ id: o.id, mode: r.mode, from: alias(r.from), target: alias(o.from), text: r.text }))]) };
}
export function commandDiplomacyDecision(b: DiplomacyBattle, side: Side, args: Record<string, unknown>): DiplomacyDecision {
  if (!['surrender', 'withdraw', 'accept', 'reject'].includes(String(args.mode)) || Object.keys(args).some(k => !['mode', 'target', 'id', 'text'].includes(k))) throw Error('提议格式无效');
  const target = fightingSides(b).find(s => s !== side && diplomacySide(s, side) === args.target);
  const decision = { mode: args.mode, ...(target ? { target } : {}), ...(args.id !== undefined ? { id: args.id } : {}), ...(args.text !== undefined ? { text: args.text } : {}) } as DiplomacyDecision;
  checkDiplomacy(b, side, decision); return decision;
}
