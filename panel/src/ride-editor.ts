import { platformText, unitCount, type PlatformUnit } from '../../engine/src/platforms.js';
import { escapeHtml as esc } from './battle-presentation.js';
import { ui } from './ui-language.js';
import type { InventoryAction } from './inventory-state.js';

export function rideEditor(id: string, units: PlatformUnit[], locked = false): string {
  const current = units.find(u => u.id === id);
  if (!current || current.hp <= 0) return '';
  const carrier = !!current.platform;
  const candidates = units.filter(u => u.id !== id && u.hp > 0 && u.side === current.side && !!u.platform !== carrier);
  if (!carrier && !candidates.length && !current.ride) return '';
  const riders = carrier ? candidates.filter(u => u.ride?.platformId === id) : current.ride ? [current] : [];
  const seats = (u: PlatformUnit) => unitCount(u) * (u.seats ?? 1);
  const requested = riders.reduce((sum,u) => sum + unitCount(u),0), capacity = seats(current);
  const status = current.platform ? [platformText(current.platform, ui), ui('已用 {used} / {capacity} 席', {
    used: Math.min(requested, capacity), capacity,
  }), requested > capacity ? ui('{count}人步行部署', {count:requested-capacity}) : ''].filter(Boolean).join(' · ') : '';
  const entries = riders.map(rider => {
    const bound = rider.ride!.mode === 'mount';
    const name = carrier ? rider.name : candidates.find(u => u.id === rider.ride!.platformId)?.name ?? ui('坐骑或载具');
    return '<div class="ride-entry"><span>'+esc(name)+' · '+ui(bound ? '已绑定' : '已装载')+' · '+ui('{count} 人', {count:unitCount(rider)})+'</span>'+
      '<button data-action="ride-edit" data-rider="'+esc(rider.id)+'">'+ui(bound ? '解绑' : '离开')+'</button></div>';
  }).join('');
  const options = candidates.map(u => {
    const selected = !carrier && current.ride?.platformId === u.id;
    const previous = carrier && u.ride ? units.find(other => other.id === u.ride!.platformId) : undefined;
    const detail = carrier ? ui('{count} 席', {count:unitCount(u)})+(previous ? ' · '+esc(previous.name) : '') : ui('共 {count} 席', {count:seats(u)});
    return '<option value="'+esc(u.id)+'"'+(selected ? ' selected' : '')+'>'+esc(u.name)+' · '+detail+'</option>';
  }).join('');
  return '<fieldset class="ride-editor" data-'+(carrier ? 'carrier' : 'rider')+'="'+esc(id)+'"'+(locked ? ' disabled' : '')+'><legend>'+ui('坐骑与载具')+'</legend>'+
    (status ? '<div class="sub">'+esc(status)+'</div>' : '')+entries+(options ?
    '<div class="ride-entry"><label>'+ui(carrier ? '乘员' : '坐骑或载具')+'<select>'+options+'</select></label>'+
    '<button data-action="ride-edit" data-mode="mount" title="'+ui('绑定后共用行动回合')+'">'+ui('绑定')+'</button>'+
    '<button data-action="ride-edit" data-mode="aboard" title="'+ui('乘员和载具各自行动')+'">'+ui('装载')+'</button></div>' : '')+'</fieldset>';
}

export function rideEditAction(button: HTMLElement): InventoryAction {
  const editor = button.closest<HTMLElement>('.ride-editor')!;
  const selection = editor.querySelector('select')?.value;
  const unitId = button.dataset.rider ?? editor.dataset.rider ?? selection;
  if (!unitId) throw Error('请选择乘员');
  const mode = button.dataset.mode;
  if (!mode) return {kind:'ride',unitId};
  const platformId = editor.dataset.carrier ?? selection;
  if (!platformId || (mode !== 'mount' && mode !== 'aboard')) throw Error('请选择坐骑或载具');
  return {kind:'ride',unitId,ride:{platformId,mode}};
}
