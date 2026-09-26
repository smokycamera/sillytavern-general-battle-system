import { ZONE_NAMES, visibleBattleZones } from '../../engine/src/area-effects.js';
import { tbWeaponShortName } from '../../engine/src/weapon-name.js';
import { strengthDescription } from '../../engine/src/combat-model.js';
import { participationText,memberHealthPanel } from './combat-model-view.js';
import {hasMemberHealth} from '../../engine/src/member-health.js';
import { renderBattleHighlights, traceOverlay, unitSymbol } from './battle-presentation.js';
import { weaponReloadKey, FORMATION_NODES, formationNode, isAirborne, moraleLabel, type Combatant, type MassBattle, type Order } from '../../engine/src/index.js';
import { renderFormationFeedback } from './formation-feedback.js';
import { formationSelection, orderKey, orderLabels, type FormationView, type OrderDrafts } from './formation-orders.js';
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const rankName = { front: '前线', rear: '支援', reserve: '预备' };
const location = (u: Combatant) => { const n = formationNode(u); return (n.side === 'ally' ? '我方' : '敌方') + n.wing + rankName[n.rank]; };
function orderName(b: MassBattle, order: Order | undefined): string {
  if (!order) return '尚未下令';
  if (order.type !== 'ability') return orderLabels[order.type];
  const source = b.combatants.find((u) => u.id === (order.abilityActorId ?? order.unitId));
  return (source?.id !== order.unitId ? (source?.name ?? '随队人物') + ' · ' : '') + (source?.abilities.find((a) => a.id === order.abilityId)?.name ?? '技能已失效');
}
export function renderFormationBattle(b: MassBattle, view: FormationView, drafts: OrderDrafts, automatic: boolean,
  details: (u: Combatant) => string, previewText: (b: MassBattle, order: Order) => string): string {
  const s = formationSelection(b, view, drafts), { actor, order, preview, visible, choices } = s;
  const over = b.isOver(), editable = !automatic && !over && !b.planningLocked;
  const selfTarget = order?.type === 'ability' && visible.find((u) => u.id === (order.abilityActorId ?? order.unitId))?.abilities.find((a) => a.id === order.abilityId)?.target === 'self';
  const selectedTarget = !selfTarget && order?.targetId && visible.find((u) => u.id === order.targetId);
  const targets = new Set(s.choice?.targets.filter((t) => !t.preview.reason && t.id).map((t) => t.id));
  const area = new Set(preview?.areaTargetIds ?? []);
  const destination = preview?.destination ?? preview?.vehicleMove ?? preview?.withdrawal ?? preview?.approach ?? preview?.landing;
  const invalidDrafts = Object.entries(drafts).filter(([unitId, draft]) => b.orderPreview({ unitId, ...draft }).reason);
  const pendingCount = Object.keys(drafts).length, issuedCount = s.hosts.filter((u) => b.orders.has(u.id)).length;
  const zones=visibleBattleZones(b.observationContext(),'ally');
  const nodes = [...FORMATION_NODES].sort((a, b) => a.y - b.y || a.x - b.x).map((node) => {
    const occupants = visible.filter((u) => !b.isAttached(u.id) && !['dead', 'fled'].includes(u.status) && formationNode(u).id === node.id);
    return `<div class="formation-node ${node.side} ${actor && formationNode(actor).id === node.id ? 'selected' : ''} ${node.id === destination?.id ? 'destination' : ''}" data-formation="${node.id}">${zones.filter(z=>Math.abs(z.x-node.x)+Math.abs(z.y-node.y)<=z.radius).map(z=>'<span class="zone-label">'+ZONE_NAMES[z.kind]+'</span>').join('')}
      <button class="formation-cell-label" data-action="formation-cell" data-node="${node.id}" aria-label="${esc((node.side === 'ally' ? '我方' : '敌方') + node.wing + rankName[node.rank])}">${node.side === 'ally' ? '我方' : '敌方'} · ${rankName[node.rank]}</button>
      ${occupants.length > 1 ? '<details class="formation-stack" data-detail-id="stack-' + node.id + '"' + (occupants.some(u => u.id === actor?.id) ? ' open' : '') + '><summary>' + occupants.length + '支编队 · 展开筹码</summary>' : ''}${occupants.map((u) => {
        const assigned = b.orders.get(u.id), draft = drafts[u.id], passenger = visible.find((h) => h.id === b.attached.get(u.id));
        return `<button class="formation-piece ${u.side} ${u.id === actor?.id ? 'active' : ''} ${targets.has(u.id) ? 'legal-target' : ''} ${u.id === order?.targetId ? 'targeted' : ''} ${area.has(u.id) ? 'area-hit' : ''}" data-action="formation-unit" data-id="${esc(u.id)}" aria-pressed="${u.id === actor?.id}">
          ${unitSymbol(u)}<b>${u.side === 'ally' ? '我' : '敌'} · ${esc(u.name)}</b><span>${u.hp}/${u.base.hpMax}${u.scale === 'hero' ? '生命' : '人'}${isAirborne(u) ? ' · 空中' : ''}${u.barrier?' · 屏障'+u.barrier.remaining:''}</span>
          ${u.side === 'ally' ? '<small>' + (draft ? '草案 · ' + esc(orderName(b, { unitId: u.id, ...draft })) : assigned ? '已下达 · ' + esc(orderName(b, assigned)) : '待安排') + '</small>' : ''}
          ${passenger ? '<small>随队 · ' + esc(passenger.name) + '</small>' : ''}</button>`;
      }).join('') || '<span class="formation-empty">' + (node.side === 'ally' ? '空位' : '未定位') + '</span>'}${occupants.length > 1 ? '</details>' : ''}
    </div>`;
  }).join('');
  const source = actor && (order?.type === 'ability' ? visible.find((u) => u.id === (order.abilityActorId ?? actor.id)) : actor);
  const ability = order?.type === 'ability' ? source?.abilities.find((a) => a.id === order.abilityId) : undefined;
  const pressure = actor && moraleLabel({ ...b.observationContext(), units: visible }, actor, b.traitRegistry);
  const selectedNode = FORMATION_NODES.find((n) => n.id === view.nodeId);
  const inspection = visible.find((u) => u.id === view.inspectedId);
  const unitControls = actor ? `<div class="formation-actor"><span class="sub">${editable ? '正在指挥' : '查看我方编队'}</span><h3>${esc(actor.name)}</h3><p>${strengthDescription(actor)} · ${location(actor)}${isAirborne(actor) ? ' · 空中' : ''}</p></div>${memberHealthPanel(actor)}
    <div class="formation-status">${[actor.fatigue ? '疲劳' + actor.fatigue + '/4' : '', (b.reloadCd.get(actor.id) ?? 0) > 0 ? (tbWeaponShortName(actor.weapon) || '主武器') + '装填中' : '', actor.sidearm && (b.reloadCd.get(weaponReloadKey(actor, actor.sidearm)) ?? 0) > 0 ? (tbWeaponShortName(actor.sidearm) || '副武器') + '装填中' : '', actor.suppression ? '受压制' : '', pressure,
      ...actor.conditions.filter((c) => c.dur > 0).map((c) => (b.conditions.get(c.id)?.name ?? '持续效果') + ' ' + c.dur + '轮')].filter(Boolean).map((t) => '<span>' + esc(t!) + '</span>').join('')}</div>
    <div class="formation-current"><span class="tag">${s.draft ? '草案' : s.issued ? '已下达' : '系统建议'}</span><b>${esc(orderName(b, order))}</b>${selectedTarget ? '<p>目标 · ' + esc(selectedTarget.name) + '</p>' : ''}${s.draft && s.issued ? '<small>确认后替换原任务：' + esc(orderName(b, s.issued)) + '</small>' : ''}</div>
    <details class="formation-adjust" data-detail-id="formation-adjust"><summary>调整任务或目标</summary>
      <label>任务<select data-role="formation-order" ${editable ? '' : 'disabled'}>${choices.map((c) => '<option value="' + esc(c.key) + '" ' + (order && c.key === orderKey(order) ? 'selected' : '') + '>' + esc(c.label) + (c.enabled ? '' : ' · 暂不可用') + '</option>').join('')}</select></label>
      ${s.choice?.targets.some((t) => t.id) ? '<label>目标<select data-role="formation-target" ' + (editable ? '' : 'disabled') + '>' + s.choice.targets.filter((t) => t.id).map((t) => '<option value="' + esc(t.id!) + '" ' + (t.id === order?.targetId ? 'selected' : '') + '>' + esc(visible.find((u) => u.id === t.id)?.name ?? (t.id?.startsWith('zone:') ? t.id.slice(5).replace('ally','我方').replace('enemy','敌方').replace('front','前线').replace('rear','后方').replace('reserve','预备') : '未定位目标')) + (t.preview.reason ? ' · ' + esc(t.preview.reason) : '') + '</option>').join('') + '</select></label>' : ''}
      <p>随队人物的技能也使用这支编队的一个主任务。确认改令会替换原任务。</p>
    </details>
    ${order ? '<div class="formation-preview" aria-live="polite">' + (preview?.preview ? '<div class="preview-numbers"><span>命中概率<b>' + Math.round(preview.preview.hitChance * 100) + '%</b></span><span>主目标预计损失<b>' + preview.preview.expectedDamage.toFixed(1) + (preview.preview.damageModel==='member-health'?'生命':'')+'</b></span></div>' : '')
      + (preview?.preview?.penetrationFactor !== undefined ? '<p class="' + (preview.preview.penetrationFactor === 0 ? 'grid-reason' : '') + '">' + ({ kinetic: '物理', thermal: '热能', arcane: '魔法' })[preview.preview.channel ?? 'kinetic'] + '穿透' + preview.preview.penetration + ' 对防护' + preview.preview.resistance + ' · ' + (preview.preview.penetrationFactor === 0 ? '无法穿透，不造成生命损失' : '穿透通过' + Math.round(preview.preview.penetrationFactor * 100) + '%') + ((preview.preview.armorScale??1)>1?' · 装甲等效耐久×'+Number(preview.preview.armorScale!.toFixed(2)):'')+'</p>' : '')
      + (preview?.preview?.participants!==undefined ? '<p class="sub">'+participationText(preview.preview)+'</p>' : '')
      + (preview?.areaPreviews?.length ? '<div class="formation-area-preview">' + preview.areaPreviews.map((hit) => { const affected = visible.find((u) => u.id === hit.targetId); return affected ? '<p>' + esc(affected.name) + ' · 预计损失' + hit.expectedDamage.toFixed(1) + (affected.scale === 'hero'||hasMemberHealth(affected) ? '生命' : '人') + '</p>' : ''; }).join('') + '</div>' : '')
      + '<p class="' + (preview?.reason ? 'grid-reason' : '') + '">' + esc(previewText(b, order)) + '</p>'
      + (ability?.cost && source ? '<div class="preview-cost">' + esc(source.name) + ' · ' + (ability.itemSourceId ? '消耗品' : ability.cost.resource === 'SP' ? '精力' : '预备资源') + ' ' + ability.cost.amount + '/' + (source.resources[ability.cost.resource] ?? 0) + '，支援阶段扣除</div>' : '')
      + '<small>基于当前已知信息；前序阶段和未发现的占位可能使后续任务受阻。</small></div>' : ''}
    <div class="formation-submit"><button class="primary" data-action="formation-issue" data-unit="${esc(actor.id)}" data-round="${b.round}" ${editable && order && !preview?.reason ? '' : 'disabled'}>${s.issued ? '确认改令' : '下达此任务'}</button>
      ${s.draft ? '<button data-action="formation-cancel" data-unit="' + esc(actor.id) + '">取消草案</button>' : s.issued ? '<button data-action="formation-revoke" data-unit="' + esc(actor.id) + '" ' + (editable ? '' : 'disabled') + '>撤回军令</button>' : ''}</div>
    <details class="formation-unit-details" data-detail-id="formation-unit-details"><summary>编队与随队人物详情</summary>${details(actor)}${visible.filter((u) => u.id === b.attached.get(actor.id)).map((u) => '<h4>随队 · ' + esc(u.name) + '</h4>' + details(u)).join('')}</details>` : '<p>没有可指挥的我方编队。</p>';
  return `<section class="formation-workspace"><div class="tactical-heading"><div><span class="sub">军团会战 · 每编队一个主任务</span><h2>${over ? b.winner() === 'ally' ? '会战胜利' : b.winner() === 'enemy' ? '会战失利' : '会战结束' : '第' + b.round + '轮计划'}</h2></div><span class="planning-state">${over ? '已结束' : b.planningLocked ? '已锁定' : pendingCount ? pendingCount + '份草案' : '计划中'} · ${issuedCount}/${s.hosts.length}已下达</span></div>
    ${b.endingReason() === 'round-limit' ? '<p class="sub">' + b.roundLimit + '轮期限已到，双方仍有独立主力，判为僵持。</p>' : ''}
    ${automatic && !over ? '<p class="grid-reason">当前由系统指挥：主控未担任指挥者，或指挥者已无法下令。仍可查看任务与战况。</p>' : ''}
    <div class="mass-controls">${actor ? '<button class="formation-mobile-summary" data-action="formation-command-focus"><b>' + esc(actor.name) + '</b><span>' + esc(orderName(b, order)) + (selectedTarget ? ' → ' + esc(selectedTarget.name) : '') + '</span><small>查看任务</small></button>' : ''}<button data-action="formation-fill" ${editable ? '' : 'disabled'}>补齐空缺</button><button class="primary" data-action="mass-resolve" data-round="${b.round}" data-seed="${esc(b.seed)}" ${over || b.planningLocked || invalidDrafts.length || automatic && pendingCount ? 'disabled' : ''}>锁定并执行本轮</button><span class="sub">${invalidDrafts.length ? invalidDrafts.length + '份草案需要调整' : automatic && pendingCount ? '旧草案需取消后再交由系统执行' : '空缺按系统建议执行，可先补齐预览'}</span></div>
    ${renderBattleHighlights(b)}
    <div class="formation-columns"><div class="formation-map-column"><div class="formation-wings"><b>左翼</b><b>中军</b><b>右翼</b></div><div class="formation-map-camera" tabindex="0" aria-label="军团阵位图，可滚动浏览双方前线与后方"><div class="formation-grid">${nodes}${traceOverlay(b)}</div></div>
      ${renderFormationFeedback(b)}<div class="formation-front">${Object.entries(b.frontControl).map(([wing, side]) => '<span>' + wing + ' · ' + ({ ally: '我方控制', enemy: '敌方控制', contested: '争夺中', empty: '空缺' })[side] + '</span>').join('')}</div>
      ${selectedNode ? '<div class="map-inspector"><b>' + (selectedNode.side === 'ally' ? '我方' : '敌方') + selectedNode.wing + rankName[selectedNode.rank] + '</b>' + (destination?.id === selectedNode.id ? '<p>当前任务预计到达此处，确认下令后执行。</p>' : '') + '<details><summary>阵位规则</summary><p>地面与空中每层最多3支独立编队，随队人物共用所在编队位置。未发现的占位可能使机动受阻。</p></details></div>' : ''}
      ${inspection && inspection.side !== 'ally' ? '<details class="formation-inspection" data-detail-id="formation-inspection"><summary>查看目标 · ' + esc(inspection.name) + '</summary>' + details(inspection) + '</details>' : ''}
    </div><div class="formation-command">${unitControls}</div></div>
    <details class="formation-order-list" data-detail-id="formation-order-list"><summary>本轮全部安排</summary>${s.hosts.map((u) => '<button data-action="formation-select-actor" data-id="' + esc(u.id) + '">' + esc(u.name) + ' · ' + (drafts[u.id] ? '草案：' + esc(orderName(b, { unitId: u.id, ...drafts[u.id]! })) : b.orders.has(u.id) ? '已下达：' + esc(orderName(b, b.orders.get(u.id))) : '待安排') + '</button>').join('')}${invalidDrafts.filter(([id]) => !s.hosts.some((u) => u.id === id)).map(([id]) => '<button data-action="formation-cancel" data-unit="' + esc(id) + '">取消无法执行的旧编队草案</button>').join('')}</details>
    ${b.lastPhases.length ? '<div class="sub formation-phase-line">上一轮已完成：' + b.lastPhases.map(esc).join(' → ') + '</div>' : ''}
    
  </section>`;
}
