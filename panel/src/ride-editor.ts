import { platformText, unitCount, type PlatformUnit } from '../../engine/src/platforms.js';
import { escapeHtml as esc } from './battle-presentation.js';
import type { InventoryAction } from './inventory-state.js';

export function rideEditor(id: string, units: PlatformUnit[], locked = false): string {
  const current = units.find(u => u.id === id);
  if (!current || current.hp <= 0) return '';
  const carrier = !!current.platform;
  const candidates = units.filter(u => u.id !== id && u.hp > 0 && u.side === current.side && !!u.platform !== carrier);
  if (!carrier && !candidates.length && !current.ride) return '';
  const riders = carrier ? candidates.filter(u => u.ride?.platformId === id) : current.ride ? [current] : [];
  const seats = (u: PlatformUnit) => unitCount(u) * (u.seats ?? 1);
  const status = current.platform ? esc(platformText(current.platform)) + ' · 已用 ' +
    riders.reduce((sum,u) => sum + unitCount(u),0) + ' / ' + seats(current) + ' 席' : '';
  const entries = riders.map(rider => {
    const bound = rider.ride!.mode === 'mount';
    const name = carrier ? rider.name : candidates.find(u => u.id === rider.ride!.platformId)?.name ?? '坐骑或载具';
    return '<div class="ride-entry"><span>'+esc(name)+' · '+(bound ? '已绑定' : '已装载')+' · '+unitCount(rider)+' 席</span>'+
      '<button data-action="ride-edit" data-rider="'+esc(rider.id)+'">'+(bound ? '解绑' : '离开')+'</button></div>';
  }).join('');
  const options = candidates.map(u => {
    const selected = !carrier && current.ride?.platformId === u.id;
    const previous = carrier && u.ride ? units.find(other => other.id === u.ride!.platformId) : undefined;
    const detail = carrier ? unitCount(u)+' 席'+(previous ? ' · '+esc(previous.name) : '') : '共 '+seats(u)+' 席';
    return '<option value="'+esc(u.id)+'"'+(selected ? ' selected' : '')+'>'+esc(u.name)+' · '+detail+'</option>';
  }).join('');
  return '<fieldset class="ride-editor" data-'+(carrier ? 'carrier' : 'rider')+'="'+esc(id)+'"'+(locked ? ' disabled' : '')+'><legend>坐骑与载具</legend>'+
    (status ? '<div class="sub">'+status+'</div>' : '')+entries+(options ?
    '<div class="ride-entry"><label>'+ (carrier ? '乘员' : '坐骑或载具') +'<select>'+options+'</select></label>'+
    '<button data-action="ride-edit" data-mode="mount" title="绑定后共用行动回合">绑定</button>'+
    '<button data-action="ride-edit" data-mode="aboard" title="乘员和载具各自行动">装载</button></div>' : '')+'</fieldset>';
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
