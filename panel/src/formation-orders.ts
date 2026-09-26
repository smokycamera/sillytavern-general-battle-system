import { FORMATION_NODES, zoneTarget } from '../../engine/src/index.js';
import { formationNode, isAirborne, hasFlightAbility, type MassBattle, type Order, type OrderType, type Combatant } from '../../engine/src/index.js';

export type OrderDraft = Omit<Order, 'unitId' | 'automatic'>;
export type OrderDrafts = Record<string, OrderDraft>;
export interface FormationView { selectedId?: string; inspectedId?: string; nodeId?: string }
export const orderLabels: Record<OrderType, string> = {
  attack: '近战攻击', volley: '武器射击', charge: '冲锋', hold: '原地休整', brace: '固守战线', retreat: '撤离战场',
  'rank-forward': '向前机动', 'rank-back': '向后机动', 'shift-left': '向左翼机动', 'shift-right': '向右翼机动',
  takeoff: '升空', land: '降落', ability: '使用技能',
};
export const orderKey = (order: OrderDraft) => order.type === 'ability' ? JSON.stringify([order.abilityActorId, order.abilityId]) : order.type;
export const orderDraft = ({ unitId: _unit, automatic: _auto, ...draft }: Order): OrderDraft => draft;
export interface FormationChoice {
  key: string; label: string; order: Order; enabled: boolean;
  targets: { id?: string; order: Order; preview: ReturnType<MassBattle['orderPreview']> }[];
}
/** 目标、距离、机动、武器和技能前提全部由引擎判断，面板只组织选择。 */
export function formationChoices(b: MassBattle, host: Combatant): FormationChoice[] {
  const visible = b.visibleCombatants('ally');
  const enemies = visible.filter((u) => u.side !== host.side && ['ready', 'routing', 'dying'].includes(u.status) && !b.isAttached(u.id));
  const make = (order: Order, label: string, targets: (Combatant | undefined)[]): FormationChoice => {
    const entries = targets.map((target) => { const intent = { ...order, targetId: target?.id }; return { id: target?.id, order: intent, preview: b.orderPreview(intent) }; });
    return { key: orderKey(order), label, order, targets: entries, enabled: entries.some((t) => !t.preview.reason) };
  };
  const types: OrderType[] = ['attack', 'volley', 'charge', 'brace', 'hold', 'rank-forward', 'rank-back', 'shift-left', 'shift-right', 'retreat'];
  if (hasFlightAbility(host) || isAirborne(host)) types.push(isAirborne(host) ? 'land' : 'takeoff');
  const choices = types.map((type) => make({ unitId: host.id, type }, orderLabels[type], ['attack', 'volley', 'charge'].includes(type) ? enemies : [undefined]));
  for (const source of [host, ...visible.filter((u) => u.id === b.attached.get(host.id))]) for (const ability of source.abilities) {
    const targets = ability.target === 'zone' ? FORMATION_NODES.map(node=>zoneTarget(b.observationContext(),source,'zone:'+node.id)) : ability.target === 'self' ? [source] : ability.target === 'ally'
      ? visible.filter((u) => u.side === host.side && !['dead', 'fled'].includes(u.status))
      : ability.target === 'enemy' ? enemies : [undefined];
    choices.push(make({ unitId: host.id, type: 'ability', abilityActorId: source.id, abilityId: ability.id },
      (source.id !== host.id ? source.name + ' · ' : '') + ability.name, targets));
  }
  return choices;
}
export function formationSelection(b: MassBattle, view: FormationView, drafts: OrderDrafts) {
  const visible = b.visibleCombatants('ally');
  const hosts = visible.filter((u) => u.side === 'ally' && !b.isAttached(u.id) && !['dead', 'fled'].includes(u.status));
  const actor = hosts.find((u) => u.id === view.selectedId) ?? hosts.find((u) => u.status === 'ready') ?? hosts[0];
  const choices = actor ? formationChoices(b, actor) : [];
  const issued = actor && b.orders.get(actor.id), draft = actor && drafts[actor.id];
  const candidate = actor ? draft ? { unitId: actor.id, ...draft } : issued ?? b.recommendedOrder(actor.id) ?? { unitId: actor.id, type: 'hold' as const } : undefined;
  const order = candidate?.type === 'ability' ? { ...candidate, abilityActorId: candidate.abilityActorId ?? candidate.unitId } : candidate;
  const choice = order && choices.find((c) => c.key === orderKey(order));
  return { visible, hosts, actor, choices, issued, draft, order, choice, preview: order ? b.orderPreview(order) : undefined };
}
export function selectFormationUnit(b: MassBattle, view: FormationView, drafts: OrderDrafts, id: string, editable: boolean, asActor = false): boolean {
  const s = formationSelection(b, view, drafts), unit = s.visible.find((u) => u.id === id);
  if (!unit) return false;
  view.inspectedId = id; view.nodeId = formationNode(b.effectiveUnit(unit)).id;
  const isTarget = s.choice?.targets.some((t) => t.id === id);
  if (editable && !asActor && isTarget && s.actor && s.order && (unit.side !== 'ally' || s.order.type === 'ability')) {
    drafts[s.actor.id] = orderDraft({ ...s.order, targetId: id }); return true;
  }
  if (unit.side === 'ally') view.selectedId = [...b.attached].find(([, hero]) => hero === id)?.[0] ?? id;
  return false;
}
export function setFormationChoice(b: MassBattle, view: FormationView, drafts: OrderDrafts, key: string): void {
  const s = formationSelection(b, view, drafts); if (!s.actor) return;
  const choice = s.choices.find((c) => c.key === key); if (!choice) throw Error('任务选项已经变化');
  const target = choice.targets.find((t) => t.id === s.order?.targetId && !t.preview.reason)
    ?? choice.targets.find((t) => !t.preview.reason) ?? choice.targets[0];
  drafts[s.actor.id] = orderDraft(target?.order ?? choice.order);
}
