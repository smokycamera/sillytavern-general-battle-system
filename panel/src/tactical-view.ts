import { ZONE_NAMES } from '../../engine/src/area-effects.js';
import { tbWeaponShortName } from '../../engine/src/weapon-name.js';
import { strengthDescription } from '../../engine/src/combat-model.js';
import { participationText,memberHealthPanel } from './combat-model-view.js';
import {hasMemberHealth} from '../../engine/src/member-health.js';
import { difficultEngagementDescription } from '../../engine/src/exposure.js';
import { renderBattleHighlights, traceOverlay, traceLocations, unitSymbol } from './battle-presentation.js';
import { weaponReloadKey, cellLabel, gridDistance, tileCost, inBounds, moraleLabel, isAirborne, activeTraitIds, postureLabel, concealmentLabel, standardConditionMap, type SmallBattle, type ActionOption, type ActionPreview, type Combatant, type Terrain, TERRAIN_NAMES } from '../../engine/src/index.js';

import { renderRoundFeedback } from './round-feedback.js';
import { movementLabel } from '../../engine/src/tactics.js';
import { spCapacity } from '../../engine/src/resources.js';

export interface TacticalView { selectedId?: string; targetId?: string; cell?: number; inspectedCell?: number; mode: string }
/** 仅在一次同步点选→渲染中复用；不能跨动作或异步保存缓存。 */
export interface TacticalQuery { battle: SmallBattle; actor: Combatant; options: ActionOption[] }
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const terrainNames = TERRAIN_NAMES;
const present = (u: Combatant) => !['dead', 'fled'].includes(u.status);

/** 查看敌军不切换到敌军观测口径；所有动作始终属于我方单位。 */
export function tacticalSelection(battle: SmallBattle, view: TacticalView, query?: TacticalQuery) {
  const visible = battle.visibleCombatants('ally').filter(present);
  const actor = visible.find((u) => u.id === view.selectedId && u.side === 'ally')
    ?? visible.find((u) => u.id === battle.active?.id && u.side === 'ally')
    ?? visible.find((u) => u.side === 'ally' && u.status === 'ready');
  const allOptions = actor ? query?.battle === battle && query.actor === actor ? query.options : battle.getActionOptions(actor.id) : [];
  const options = allOptions.filter((o) => ['weapon', 'ability', 'charge'].includes(o.kind));
  const option = options.find((o) => o.id === view.mode) ?? options.find((o) => o.id === 'weapon');
  const target = option?.targets?.find((t) => t.targetId === view.targetId)
    ?? option?.targets?.find((t) => t.enabled) ?? option?.targets?.[0];
  const canControl = !!actor && actor.id === battle.active?.id && actor.status === 'ready' && !battle.isOver();
  return { visible, actor, allOptions, options, option, target, canControl, query: actor ? { battle, actor, options: allOptions } : undefined };
}

/** 只改短暂选择，不提交存档、动作或随机数。友方治疗目标优先于切换行动者。
 *  敌我不共格是阻挡设计：点选敌人格即视为选定攻击目标，不做移动落点。 */
export function selectTacticalElement(battle: SmallBattle, view: TacticalView, input: { cell?: number; unitId?: string; mode?: string; actor?: boolean }): TacticalQuery | undefined {
  const field = battle.battlefield;
  if (!field) return;
  if (input.mode !== undefined) { view.mode = input.mode; view.cell = undefined; view.targetId = undefined; return; }
  const selection = tacticalSelection(battle, view);
  const cell = input.cell ?? selection.visible.find((u) => u.id === input.unitId)?.pos;
  if (cell === undefined || !inBounds(field, cell)) return selection.query;
  view.inspectedCell = cell; view.cell = undefined;
  if (selection.option?.targets?.some(t=>t.targetId==='cell:'+cell) && !input.actor) { view.targetId='cell:'+cell; return selection.query; }
  const occupants = selection.visible.filter((u) => u.pos === cell);
  const unit = input.unitId ? occupants.find((u) => u.id === input.unitId)
    : occupants.find((u) => selection.option?.targets?.some((t) => t.targetId === u.id)) ?? occupants[0];
  if (view.mode === 'move' && !input.actor && (!input.unitId || unit?.status === 'dying')
    && !occupants.some(u => u.side !== (selection.actor?.side ?? 'ally') && u.hp > 0 && u.status !== 'dying')) {
    view.cell = cell; view.targetId = undefined; return selection.query;
  }
  if (unit) {
    if (!input.actor && selection.option?.targets?.some((t) => t.targetId === unit.id)) {
      view.targetId = unit.id;
      if (view.mode === 'move' || view.mode === 'guard') view.mode = selection.option.id;
    } else if (unit.side === 'ally') {
      view.selectedId = unit.id; view.targetId = undefined;
    }
  } else {
    view.cell = cell; view.mode = 'move';
  }
  return selection.query;
}

function terrainDescription(terrain: Terrain, actor?: Combatant): string {
  const airborne = actor && isAirborne(actor);
  const traits = actor ? activeTraitIds(actor) : [];
  const effect = {
    open: '没有额外地形防护。',
    cover: '地面单位被一格以外的武器攻击时，防御提高2。',
    wall: '阻挡地面通行与地面直射；空中单位可越过。',
    rough: '地面移动花费2点，' + difficultEngagementDescription() + '。',
    forest: '地面单位抵御一格以外的远射时防御提高2；' + difficultEngagementDescription() + '。',
    hill: '地面单位面对不在山地的攻击者时防御提高1；' + difficultEngagementDescription() + '。',
  }[terrain];
  const penalty = terrain === 'forest' || terrain === 'hill'
    ? traits.includes(terrain === 'forest' ? 'forest-lore' : 'mountain-born') ? '当前单位适应该地形，免额外移动与攻击惩罚。' : '未适应的地面单位在此攻击降低1。'
    : '';
  return effect + (airborne ? '当前单位在空中，不享受地面地形防护与适应效果。' : penalty);
}

function objectiveDetails(battle: SmallBattle): string {
  const goal = battle.battlefield!.objective;
  if (goal.kind === 'annihilation') return '歼灭战：使敌方全部失去作战能力获胜，不存在占点胜利。达到期限仍未分胜负则僵持。';
  if (goal.kind === 'control') return `${goal.attackingSide ? (goal.attackingSide === 'ally' ? '我方进攻，敌方防守。' : '我方防守，敌方进攻。') + '仅攻方累计占领；守方坚持至第' + goal.limit + '轮结束获胜。' : ''}轮末由可行动的地面单位站在目标格，且目标及相邻一格没有其他阵营的可行动地面单位，才累计占领。占领当轮不计，之后连续守住${goal.rounds}个完整回合；任何中断归零。<div class="objective-progress">我方 ${battle.controlRounds.ally}/${goal.rounds} · 敌方 ${battle.controlRounds.enemy}/${goal.rounds}</div>`;
  const escorted = battle.visibleCombatants('ally').find((u) => u.id === goal.unitId);
  const enemyEscort = battle.combatants.find((u) => u.id === goal.unitId)?.side === 'enemy';
  return `${enemyEscort ? '我方拦截，敌方护送' : '我方护送，敌方拦截'}。${esc(escorted?.name ?? '指定护送单位')}须以可行动的地面状态进入此格，抵达则${enemyEscort ? '敌方' : '我方'}获胜。<div>期限：第${goal.limit}轮结束前。${goal.defenderWins ? '目标被消灭、从其他位置撤离或逾期未抵达，拦截方获胜；濒死仍可救援。' : '旧任务逾期未决则僵持。'}</div>`;
}

function tileInspector(battle: SmallBattle, view: TacticalView, selection: ReturnType<typeof tacticalSelection>): string {
  const cell = view.inspectedCell, field = battle.battlefield!;
  if (cell === undefined || !inBounds(field, cell)) return '<div class="map-inspector muted-inspector">点选单位查看或选目标；要移动到队友所在格，请先切到「移动」，再点该格。</div>';
  const terrain = field.tiles[cell]!, { actor, visible } = selection;
  const occupants = visible.filter((u) => u.pos === cell);
  const traversable = terrain !== 'wall' || actor && isAirborne(actor);
  return `<div class="map-inspector" aria-live="polite"><div class="inspector-heading"><strong>${cellLabel(field, cell)} · ${terrainNames[terrain]}</strong><span>${actor && traversable ? '进入花费' + tileCost(field, cell, actor) + '移动' : terrain === 'wall' ? '地面不可通行' : ''}</span></div>
    <p>${terrainDescription(terrain, actor)}</p>
    ${!battle.cellVisible('ally', cell) ? '<p class="grid-reason">此格尚未观测；路线只考虑已知占位，实际移动可能遇敌受阻。</p>' : ''}
    ${field.objective.kind !== 'annihilation' && field.objective.cell === cell ? '<div class="objective-detail"><b>任务目标</b><div class="objective-rule">' + objectiveDetails(battle) + '</div></div>' : ''}
    ${occupants.length ? '<div class="inspector-units">' + occupants.map((u) => `<button data-action="grid-inspect-unit" data-unit="${esc(u.id)}" class="${u.side}">${esc(u.name)} · ${u.hp}/${u.base.hpMax}${u.scale === 'hero' ? '生命' : '人'}${isAirborne(u) ? ' · 空中' : ''}${u.barrier?' · 屏障'+u.barrier.remaining:''}</button>`).join('') + '</div>' : ''}
  </div>`;
}

function actionPreview(battle: SmallBattle, preview: ActionPreview | undefined, option: ActionOption | undefined, targetId?: string): string {
  const target = targetId ? battle.visibleCombatants('ally').find((u) => u.id === targetId) : undefined;
  const unit = preview?.damageModel==='member-health'||target?.scale === 'hero' ? '生命' : '人';
  const p = preview;
  const primary = p?.moraleAfter !== undefined
    ? `有效士气 ${p.moraleBefore} → ${p.moraleAfter}<div>${p.rallyChance !== undefined ? '基础重整成功率' + Math.round(p.rallyChance * 100) + '%' : '惊退风险' + Math.round((p.breakChance ?? 0) * 100) + '%'}</div>`
    : p?.healing !== undefined ? `预计恢复 ${p.healing}${target?.scale === 'hero'||target&&hasMemberHealth(target) ? '生命' : '名可救伤兵'}`
    : p?.expectedDamage !== undefined ? `<div class="preview-numbers"><span>命中${p.exact ? '概率' : '估计'}<b>${Math.round((p.hitChance ?? 0) * 100)}%</b></span><span>主目标预计损失<b>${p.expectedDamage.toFixed(1)}<small>${unit}</small></b></span></div>`
    : '查看目标和效果后确认';
  const resistance = p?.penetrationFactor !== undefined
    ? `<div class="penetration-preview ${p.penetrationFactor === 0 ? 'grid-reason' : ''}">${p.channel ? { kinetic: '物理', thermal: '热能', arcane: '魔法' }[p.channel] : ''}穿透 ${p.penetration} 对防护 ${p.resistance} · ${p.penetrationFactor === 0 ? '无法穿透，不造成生命或人数损失' : '穿透通过' + Math.round(p.penetrationFactor * 100) + '%'}${(p.armorScale??1)>1?' · 装甲等效耐久×'+Number(p.armorScale!.toFixed(2)):''}</div>` : '';
  const cost = option?.preview?.resource;
  return `<div class="action-preview" aria-live="polite">${target ? '<div class="preview-target">' + esc(target.name) + ' · ' + strengthDescription(target) + '</div>'+memberHealthPanel(target) : ''}${primary}${resistance}${p?.participants!==undefined ? `<p class="sub">${participationText(p)}</p>` : ''}
    ${p?.effects?.length ? '<div class="preview-effects">' + p.effects.map(esc).join('；') + '</div>' : ''}
    ${p?.areaTargets?.length ? '<div class="area-preview">实际波及：' + p.areaTargets.map(esc).join('、') + (p.areaPreviews?.length ? '<div>' + p.areaPreviews.map((hit) => { const affected = battle.visibleCombatants('ally').find((u) => u.id === hit.targetId); return affected ? '<div>' + esc(affected.name) + ' · 命中' + Math.round(hit.hitChance * 100) + '% · 预计损失' + hit.expectedDamage.toFixed(1) + (affected.scale === 'hero'||hasMemberHealth(affected) ? '生命' : '人') + '</div>' : ''; }).join('') + '</div>' : '') + '</div>' : ''}
    ${p?.onHit ? '<div>' + esc(p.onHit) + '</div>' : ''}
    <div class="preview-cost">主行动1${cost ? ' · ' + esc(cost.name === 'SP' ? '战技点' : cost.name) + ' ' + cost.cost + '/' + cost.available : ''}${p?.movementCost ? ' · 另用移动' + p.movementCost + (p.lands ? '，先降落接敌' : '') : ''}</div>
    ${p?.fallDamage !== undefined ? `<div>${p.fallChance !== undefined && p.fallChance < 1 ? '迫降概率' + Math.round(p.fallChance * 100) + '%' : '将迫降'}，额外坠落损失至多${p.fallDamage}${p.forcedExit ? ' · 已知范围无落点，预计撤出' : p.landingCell !== undefined ? ' · 预计落点' + cellLabel(battle.battlefield!, p.landingCell) : ''}；未发现占位可能改变落点</div>` : ''}
    ${p?.expectedDamage !== undefined ? `<details data-detail-id="grid-calculation"><summary>伤害依据与波动</summary><p>${p.weaponName ? '使用' + esc(p.weaponName) + '。' : ''}${p.exact ? '主目标伤害范围' + p.minDamage + '–' + p.maxDamage + unit + '，期望已包含未命中。' : '实际伤害随骰子、暴击波动。'}实际扣除不超过目标余量。</p>${p.attackScore !== undefined ? '<p>攻击合计' + p.attackScore + '，防御合计' + p.defenseScore + '。</p><p>攻击修正：' + esc(p.attackModifiers || '无') + '</p><p>防御修正：' + esc(p.defenseModifiers || '无') + '</p>' : ''}</details>` : ''}
  </div>`;
}

export function renderTacticalBattle(battle: SmallBattle, view: TacticalView, autoTurn = false, query?: TacticalQuery): string {
  const field = battle.battlefield!, s = tacticalSelection(battle, view, query);
  const { visible, actor, options, option, target, canControl } = s;
  const active = visible.find((u) => u.id === battle.active?.id), over = battle.isOver();
  const activeLabel = active?.name ?? (battle.active?.side === 'enemy' ? '尚未发现的敌方单位' : '未定位单位');
  const events = over ? battle.log : battle.visibleLog('ally');
  const mode = view.mode === 'move' || view.mode === 'guard' ? view.mode : option?.id ?? 'weapon';
  const movement = actor && view.cell !== undefined ? battle.pathPreview(actor.id, view.cell) : undefined;
  const paths = new Set(movement?.path?.cells ?? []);
  const reachable = new Set(canControl && actor && mode === 'move' ? battle.reachableCells(actor.id).map((p) => p.cells.at(-1)!) : []);
  const targets = new Set(canControl && mode !== 'move' && mode !== 'guard' ? option?.targets?.filter((t) => t.enabled).map((t) => t.targetId) : []);
  const area = new Set(mode !== 'move' && mode !== 'guard' ? target?.preview?.areaTargetIds ?? [] : []);
  const range = mode !== 'move' && mode !== 'guard' ? option?.range : undefined;
  const trace = traceLocations(battle);
  const cells = field.tiles.map((terrain, cell) => {
    const occupants = visible.filter((u) => u.pos === cell && !['dead', 'fled'].includes(u.status));
    const distance = actor?.pos !== undefined ? gridDistance(field, actor.pos, cell) : Infinity;
    const inRange = !!actor && range && (range.metric === 'global' || range.metric === 'self' ? range.metric === 'global' || cell === actor.pos : distance >= range.min && distance <= range.max);
    const flags = [terrain, trace?.cells.includes(cell) ? 'trace-cell' : '', !battle.cellVisible('ally', cell) ? 'unobserved' : '', reachable.has(cell) ? 'reachable' : '', paths.has(cell) ? 'path' : '',
      occupants.some((u) => u.id === actor?.id) ? 'selected' : '', view.inspectedCell === cell ? 'inspected' : '',
      field.objective.kind !== 'annihilation' && field.objective.cell === cell ? 'objective' : '', inRange ? 'in-range' : '', (targets.has('cell:'+cell) || occupants.some((u) => targets.has(u.id))) ? 'legal-target' : '',
      (target?.targetId==='cell:'+cell || occupants.some((u) => u.id === target?.targetId)) && mode !== 'move' && mode !== 'guard' ? 'targeted' : '', occupants.some((u) => area.has(u.id)) ? 'area-hit' : ''].join(' ');
    const zones = battle.combatants.flatMap(u=>u.battleZones??[]).filter(z=>z.mode==='small' && Math.abs(z.x-cell%field.width)+Math.abs(z.y-Math.floor(cell/field.width))<=z.radius && (z.kind!=='trap'||z.side==='ally') && battle.cellVisible('ally',cell));
    const label = zones.map(z=>ZONE_NAMES[z.kind]).join('、')+' '+cellLabel(field, cell) + ' ' + terrainNames[terrain] + ' ' + occupants.map((u) => (u.side === 'ally' ? '我方' : u.side === 'enemy' ? '敌方' : '中立') + u.name).join('、');
    return `<button class="grid-cell ${flags}" data-action="grid-cell" data-cell="${cell}" title="${esc(label)}" aria-label="${esc(label)}" aria-pressed="${view.inspectedCell === cell}">
      <span class="grid-coordinate">${cellLabel(field, cell)}</span>${Math.floor(cell / field.width) === field.height - 1 ? '<span class="grid-exit">撤</span>' : ''}${field.objective.kind !== 'annihilation' && field.objective.cell === cell ? '<span class="grid-goal">旗</span>' : ''}
      ${occupants.map((u) => { const name = [...u.name]; return `<span class="grid-piece ${u.side}">${unitSymbol(u)}<span class="grid-piece-name"><span>${esc(name.slice(0, -2).join(''))}</span><span>${esc(name.slice(-2).join(''))}</span></span><small><span class="grid-affiliation">${u.side === 'ally' ? '我' : u.side === 'enemy' ? '敌' : '中'}</span>${u.hp}/${u.base.hpMax}${isAirborne(u) ? ' 空中' : ''}${u.suppression ? ' 受压' : ''}${battle.overwatch.has(u.id) ? ' 警戒' : ''}</small></span>`; }).join('')}
      ${occupants.length > 1 ? '<span class="grid-stack-count">' + occupants.length + '队</span>' : ''}
      ${zones.length ? '<span class="grid-zone">'+zones.map(z=>ZONE_NAMES[z.kind]).join('·')+'</span>' : ''}
      ${!occupants.length && terrain !== 'open' ? '<span class="grid-terrain">' + terrainNames[terrain] + '</span>' : ''}
    </button>`;
  }).join('');
  const concealment = actor && concealmentLabel(battle.observationContext(), actor);
  const pressure = actor && moraleLabel({ ...battle.observationContext(), units: visible }, actor, battle.traitRegistry);
  const mission = field.objective;
  const enemyEscort = mission.kind === 'escape' && battle.combatants.find((u) => u.id === mission.unitId)?.side === 'enemy';
  const goal = mission.kind === 'annihilation' ? '野战 · 歼灭战' : (mission.kind === 'control' ? mission.attackingSide === 'enemy' ? '防守据点 ' : '攻占据点 ' : enemyEscort ? '拦截于' : '护送至') + cellLabel(field, mission.cell);
  const skill = options.find((o) => o.id === view.mode && o.kind === 'ability') ?? options.find((o) => o.kind === 'ability' && o.enabled) ?? options.find((o) => o.kind === 'ability');
  const weapon = options.find((o) => o.id === view.mode && ['weapon', 'charge'].includes(o.kind)) ?? options.find((o) => o.kind === 'weapon' && o.enabled) ?? options.find((o) => o.id === 'weapon');
  const actionReady = canControl && !!option?.enabled && (!option.targets?.length || !!target?.enabled);
  const executeReady = mode === 'move' ? canControl && !!movement?.path && movement.path.cost > 0 : mode !== 'guard' && actionReady;
  const executeCommand = `<button class="primary" data-action="${mode === 'move' ? 'grid-move' : 'grid-execute'}" data-actor="${esc(actor?.id ?? '')}" data-mode="${esc(option?.id ?? 'weapon')}" data-target="${esc(target?.targetId ?? '')}" ${executeReady ? '' : 'disabled'} title="${mode === 'guard' ? '请在守备面板选择固守或警戒' : mode === 'move' ? '执行已预览的移动' : '执行已预览的攻击或技能'}">${mode === 'move' ? '执行移动' : '执行命令'}</button>`;
  const targetUnit = visible.find(u => u.id === target?.targetId);
  const preview = target?.preview ?? option?.preview;
  const commandTitle = mode === 'move' ? (view.cell === undefined ? '选择移动落点' : '移动 → ' + cellLabel(field, view.cell)) : mode === 'guard' ? '选择固守或警戒' : (option?.label ?? '行动') + (targetUnit ? ' → ' + targetUnit.name : '');
  const commandDetail = !executeReady ? (!canControl ? '当前不可下令' : mode === 'move' ? movement?.reason ?? '请选择可达落点' : target?.reason ?? option?.reason ?? '请在下方选择守备') : mode === 'move' ? movement?.path ? '花费' + movement.path.cost + '移动 · 保留主行动' : movement?.reason ?? '点击可达地块' : preview?.healing !== undefined ? '预计恢复' + preview.healing : preview?.expectedDamage !== undefined ? '命中' + Math.round((preview.hitChance ?? 0) * 100) + '% · 预计损失' + preview.expectedDamage.toFixed(1) + (preview.damageModel==='member-health'||targetUnit?.scale === 'hero' ? '生命' : '人') + ' · 主行动1' : preview?.resource ? '消耗' + preview.resource.cost + preview.resource.name : reasonText();
  function reasonText(): string { return canControl ? '请查看行动预览' : '当前不可下令'; }
  const reason = !canControl ? '当前行动者为' + activeLabel + '，可先查看战场。' : target?.reason ?? option?.reason;
  const movePanel = `<div class="move-preview">${movement ? movement.path ? '到' + cellLabel(field, view.cell!) + ' · 花费' + movement.path.cost + '移动，余' + (battle.movementLeft(actor!.id) - movement.path.cost) : esc(movement.reason ?? '') : '点击蓝边可达格，空格、队友格或濒死单位所在格均可预览移动；濒死单位不占容量，存活敌军仍阻路。'}
    ${movement?.path && movement.path.cost > 0 ? '<div class="sub">' + (movement.risks.length ? movement.risks.map(esc).join('；') : '已知敌军没有可触发的移动反应。') + '</div>' : ''}
    <button class="primary" data-action="grid-move" data-actor="${esc(actor?.id ?? '')}" ${canControl && movement?.path && movement.path.cost > 0 ? '' : 'disabled'}>确认移动${movement?.path ? ' · ' + movement.path.cost + '点' : ''}</button></div>`;
  return `<section class="tactical-workspace" data-ended="${over}">
    <div class="tactical-heading"><div><span class="sub">战术交战${battle.fieldTags.includes('night') ? ' · 夜间' : ''}</span><h2>${goal}</h2></div><button class="objective-status" ${mission.kind === 'annihilation' ? 'disabled' : 'data-action="grid-cell" data-cell="' + mission.cell + '"'}>第${battle.round}/${field.objective.limit}轮${mission.kind === 'control' ? '<small>攻方占领 ' + battle.controlRounds[mission.attackingSide ?? 'ally'] + '/' + mission.rounds + '</small>' : ''}</button></div>
    ${over ? '<div class="banner">' + (battle.winner() === 'ally' ? '任务胜利' : battle.winner() === 'enemy' ? '任务失败' : '任务结束：僵持') + '</div>' : '<div class="turn-indicator">当前行动 <b>' + esc(activeLabel) + '</b></div>'}
    ${renderBattleHighlights(battle)}
    <div class="tactical-columns"><div class="tactical-map-column">
      <div class="camera-tools"><span class="map-legend">${mode === 'move' ? '蓝边可移动 · 金线为路径' : mode === 'guard' ? '选择固守或警戒' : '浅底为射程参考 · 亮边为可选目标'}</span><button data-action="grid-focus">定位我方</button></div>
      <div class="grid-camera" tabindex="0" aria-label="战场地图，可横向和纵向滚动"><div class="grid-board" style="--columns:${field.width}">${cells}${traceOverlay(battle)}</div></div>
      ${renderRoundFeedback(battle)}${tileInspector(battle, view, s)}
    </div><div class="grid-command">
      <div class="command-actor"><span class="sub">${canControl ? '正在指挥' : '我方单位'}</span><h3>${esc(actor?.name ?? '没有可用单位')}</h3>${actor ? '<span>' + strengthDescription(actor) + '</span>' : ''}</div>${actor?memberHealthPanel(actor):''}
      <div class="sub">${actor ? movementLabel(actor, battle.fieldTags) + ' · 精力 ' + (actor.resources.SP ?? 0) + '/' + spCapacity(actor) : ''}</div><div class="grid-budgets">${canControl && actor ? '移动 ' + battle.movementLeft(actor.id) + '/' + battle.movementBudget(actor.id) + ' · 主行动 ' + Number(!battle.actedThisTurn.has(actor.id)) + ' · 反应 ' + Number(!battle.reactionSpent.has(actor.id) && !actor.suppression) : '待行动 · 可查看装备与行动'}</div>
      <div class="sub mission-summary">${objectiveDetails(battle)}</div>
      ${actor ? '<div class="actor-status">' + [(battle.reloadCd.get(actor.id) ?? 0) > 0 ? (tbWeaponShortName(actor.weapon) || '主武器') + '装填中' : '', actor.sidearm && (battle.reloadCd.get(weaponReloadKey(actor, actor.sidearm)) ?? 0) > 0 ? (tbWeaponShortName(actor.sidearm) || '副武器') + '装填中' : '', actor.fatigue ? '疲劳' + actor.fatigue + '/4' : '', concealment, pressure, isAirborne(actor) ? '空中，不能占领地面目标' : '', actor.tacticalPose ? postureLabel(actor, standardConditionMap()) : '', ...actor.conditions.filter((c) => c.dur > 0).map((c) => (battle.conditions.get(c.id)?.name ?? '持续效果') + ' ' + c.dur + '回合')].filter(Boolean).map((v) => '<span' + (v === pressure ? ' class="morale-pressure"' : '') + '>' + esc(v!) + '</span>').join('') + '</div>' : ''}
      <div class="command-modes" aria-label="行动类型">${[['move', '移动'], [weapon?.id ?? 'weapon', '攻击'], [skill?.id ?? '', '技能'], ['guard', '守备']].map(([id, label]) => `<button data-action="grid-mode" data-mode="${esc(id!)}" aria-pressed="${mode === id || label === '攻击' && !!option && ['weapon', 'charge'].includes(option.kind) && !['move', 'guard'].includes(mode) || label === '技能' && option?.kind === 'ability' && !['move', 'guard'].includes(mode)}" ${!id ? 'disabled' : ''}>${label}</button>`).join('')}</div>
      ${mode === 'move' ? movePanel : mode === 'guard' ? `<div class="guard-options"><button data-action="grid-brace" ${canControl && actor && !battle.braceReason(actor.id) ? '' : 'disabled'}>固守 · 主行动1</button><p>${esc(actor ? battle.braceReason(actor.id) ?? battle.braceDescription(actor.id) : '')}</p><button data-action="grid-watch" ${canControl && actor && !battle.overwatchReason(actor.id) ? '' : 'disabled'}>警戒 · 主行动1</button><p>${esc(actor ? battle.overwatchReason(actor.id) ?? '将主行动留作一次武器反应。' : '')}</p></div>` : `
        <label>使用<select data-role="grid-mode">${options.filter((o) => option?.kind === 'ability' ? o.kind === 'ability' : ['weapon', 'charge'].includes(o.kind)).map((o) => `<option value="${esc(o.id)}" ${o.id === option?.id ? 'selected' : ''}>${esc(o.label)}${o.enabled ? '' : ' · 暂不可用'}</option>`).join('')}</select></label>
        ${option?.targets?.length ? '<label>目标<select data-role="grid-target">' + option.targets.map((t) => '<option value="' + esc(t.targetId) + '" ' + (t.targetId === target?.targetId ? 'selected' : '') + '>' + esc(visible.find((u) => u.id === t.targetId)?.name ?? (t.targetId.startsWith('cell:') ? cellLabel(field,Number(t.targetId.slice(5))) : '未定位目标')) + (t.enabled ? '' : ' · ' + esc(t.reason ?? '不可选')) + '</option>').join('') + '</select></label>' : ''}
        ${actionPreview(battle, target?.preview ?? option?.preview, option, target?.targetId)}
        ${reason ? '<div class="grid-reason">' + esc(reason) + '</div>' : ''}
        <button class="primary" data-action="grid-execute" data-actor="${esc(actor?.id ?? '')}" data-mode="${esc(option?.id ?? 'weapon')}" data-target="${esc(target?.targetId ?? '')}" ${actionReady ? '' : 'disabled'}>确认${esc(option?.label ?? '行动')}</button>`}
      <details class="command-more" data-detail-id="grid-more"><summary>更多操作与单位（包含飞行、压制、撤离、移交单独单位操作权等）</summary>
        <label>查看我方单位<select data-role="grid-unit">${visible.filter((u) => u.side === 'ally').map((u) => '<option value="' + esc(u.id) + '" ' + (u.id === actor?.id ? 'selected' : '') + '>' + esc(u.name) + (u.id === battle.active?.id ? ' · 当前' : '') + '</option>').join('')}</select></label>
        ${actor && (isAirborne(actor) || activeTraitIds(actor).includes('flying')) ? `<button data-action="grid-flight" data-actor="${esc(actor.id)}" data-airborne="${!isAirborne(actor)}" ${!canControl || battle.flightReason(actor.id, !isAirborne(actor)) ? 'disabled' : ''}>${isAirborne(actor) ? '降落' : '起飞'} · 移动1</button><p>${esc(battle.flightReason(actor.id, !isAirborne(actor)) ?? '起飞离开接敌可能触发借机；扑击会先降落。')}</p>` : ''}
        <button data-action="grid-suppress" data-target="${esc(target?.targetId ?? '')}" ${canControl && actor && !battle.suppressReason(actor.id, target?.targetId) ? '' : 'disabled'}>压制目标 · 战技点1</button><p class="suppression-description">消耗1次主行动和1点战技点，需要合法射击目标；不造成生命伤害。目标攻击命中 -2，停用借机与警戒反应、取消现有警戒，且不能固守或冲锋；持续到目标完成2次行动结算。</p>${actor && battle.suppressReason(actor.id, target?.targetId) ? '<p class="grid-reason">' + esc(battle.suppressReason(actor.id, target?.targetId)!) + '</p>' : ''}
        <button data-action="grid-retreat" ${canControl && actor && s.allOptions.find((o) => o.id === 'retreat')?.enabled ? '' : 'disabled'}>从边缘撤离</button><p>我方撤离点：地图最下排标“撤”的格子；敌方从最上排撤离。脱离敌人至少2格并保留主行动后可撤离。${esc(s.allOptions.find((o) => o.id === 'retreat')?.reason ?? '')}</p>
        <button data-action="grid-auto" ${canControl ? '' : 'disabled'}>移交当前单位本次行动给AI</button><p>由AI代打当前单位的这次行动，后续回合仍按原控制设置执行。</p>
        <label><input type="checkbox" data-role="auto-turn" ${autoTurn ? 'checked' : ''}>自动非主控单位</label>
        <p>射程底色只表示距离；目标亮边和禁用原因同时考虑视线、接敌、装备、状态与行动成本。暗区可能存在未发现的敌军。</p>
      </details>
      <div class="command-finish">${executeCommand}<button data-action="grid-endturn" ${canControl ? '' : 'disabled'}>结束行动</button><button data-action="grid-auto" ${over ? 'disabled' : ''}>自动当前行动</button></div>
      
    </div></div>
    <div class="grid-mobile-shortcuts"><div class="mobile-command-context"><b>${esc(actor?.name ?? '')} · ${esc(commandTitle)}</b><small>${esc(commandDetail)}</small></div><div class="mobile-command-buttons"><button data-action="grid-command-focus">详情</button>${executeCommand}<button data-action="grid-mobile-endturn" ${canControl ? '' : 'disabled'}>结束行动</button></div></div>
    <details class="round-events" data-detail-id="grid-events"><summary>最近事件 · ${events.length}条</summary>${events.slice(-8).map((entry) => '<p>' + esc(entry.text) + '</p>').join('')}</details>
  </section>`;
}
