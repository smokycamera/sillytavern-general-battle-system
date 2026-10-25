export const MIN_MAP_SCALE = .05;
export const MAX_MAP_SCALE = 3;
export function mapScale(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(MIN_MAP_SCALE, Math.min(MAX_MAP_SCALE, value)) : 1;
}
interface Point { x: number; y: number }
interface MapGestureOptions { change: (scale: number) => void; commit?: () => void; browse?: () => void }
function workspace(camera: HTMLElement): HTMLElement | null { return camera.closest('.tactical-workspace'); }
export function zoomMapAt(camera: HTMLElement, scale: number, to: Point, from = to): number {
  const root = workspace(camera); if (!root) return 1;
  const before = mapScale(Number(root.dataset.mapScale ?? 1)), next = mapScale(scale), rect = camera.getBoundingClientRect();
  const left = rect.left + camera.clientLeft, top = rect.top + camera.clientTop;
  const x = (camera.scrollLeft + from.x - left) / before, y = (camera.scrollTop + from.y - top) / before;
  root.dataset.mapScale = String(next); root.style.setProperty('--map-scale', String(next));
  camera.scrollLeft = x * next - (to.x - left); camera.scrollTop = y * next - (to.y - top);
  return next;
}
export function fitMap(camera: HTMLElement): number {
  const root = workspace(camera), stage = camera.querySelector<HTMLElement>('.grid-stage'); if (!root || !stage) return 1;
  const before = mapScale(Number(root.dataset.mapScale ?? 1)), rect = stage.getBoundingClientRect();
  const next = mapScale(before * Math.min((camera.clientWidth - 2) / Math.max(1, rect.width), (camera.clientHeight - 2) / Math.max(1, rect.height)));
  const bounds = camera.getBoundingClientRect();
  zoomMapAt(camera, next, { x: bounds.left + camera.clientLeft, y: bounds.top + camera.clientTop });
  camera.scrollLeft = 0; camera.scrollTop = 0;
  return next;
}
/** View-only gestures: no battle render, save, action selection or engine query during a drag. */
export function installMapGestures(doc: Document, options: MapGestureOptions): () => void {
  const points = new Map<number, Point>();
  let camera: HTMLElement | undefined, last: Point | undefined, pinch: { center: Point; distance: number } | undefined;
  let moved = false, suppressClickUntil = 0, wheelCommit: ReturnType<typeof setTimeout> | undefined;
  const cameraAt = (target: EventTarget | null) => target instanceof Element ? target.closest<HTMLElement>('.grid-camera') : null;
  const currentScale = (el: HTMLElement) => mapScale(Number(workspace(el)?.dataset.mapScale ?? 1));
  const pair = () => {
    const [a, b] = [...points.values()];
    return a && b ? { center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, distance: Math.hypot(a.x - b.x, a.y - b.y) } : undefined;
  };
  const capture = (id: number) => { try { camera?.setPointerCapture(id); } catch { /* Detached or already released pointer. */ } };
  const wheel = (event: WheelEvent) => {
    const el = cameraAt(event.target); if (!el || event.shiftKey || !event.deltaY) return;
    event.preventDefault(); options.browse?.();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? el.clientHeight : 1);
    options.change(zoomMapAt(el, currentScale(el) * Math.exp(-Math.max(-500, Math.min(500, delta)) * .0016), { x: event.clientX, y: event.clientY }));
    clearTimeout(wheelCommit); wheelCommit = setTimeout(() => options.commit?.(), 180);
  };
  const down = (event: PointerEvent) => {
    const el = cameraAt(event.target);
    if (!el || event.button !== 0 || camera && camera !== el || points.size >= 2) return;
    // Leave native scrollbars usable; gestures start on the map itself.
    if (event.pointerType === 'mouse' && !(event.target instanceof Element && event.target.closest('.grid-stage'))) return;
    if (!points.size) suppressClickUntil = 0;
    camera = el; points.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (points.size === 1) { last = { x: event.clientX, y: event.clientY }; moved = false; }
    else { pinch = pair(); moved = true; options.browse?.(); for (const id of points.keys()) capture(id); }
  };
  const move = (event: PointerEvent) => {
    if (!camera || !points.has(event.pointerId)) return;
    const point = { x: event.clientX, y: event.clientY }; points.set(event.pointerId, point);
    const next = pair();
    if (next && pinch) {
      if (event.cancelable) event.preventDefault();
      if (pinch.distance > 1 && next.distance > 1) options.change(zoomMapAt(camera, currentScale(camera) * next.distance / pinch.distance, next.center, pinch.center));
      pinch = next; moved = true; return;
    }
    if (!last || !moved && Math.hypot(point.x - last.x, point.y - last.y) < 4) return;
    if (event.cancelable) event.preventDefault();
    capture(event.pointerId); options.browse?.(); camera.classList.add('map-dragging');
    camera.scrollLeft += last.x - point.x; camera.scrollTop += last.y - point.y; last = point; moved = true;
  };
  const end = (event: PointerEvent) => {
    if (!points.delete(event.pointerId)) return;
    if (moved) suppressClickUntil = Date.now() + 400;
    pinch = undefined; last = [...points.values()][0];
    if (!points.size) { camera?.classList.remove('map-dragging'); camera = undefined; if (moved) options.commit?.(); moved = false; }
  };
  const click = (event: MouseEvent) => {
    if (Date.now() < suppressClickUntil && cameraAt(event.target)) { event.preventDefault(); event.stopImmediatePropagation(); suppressClickUntil = 0; }
  };
  const reset = () => { points.clear(); camera?.classList.remove('map-dragging'); camera = undefined; last = undefined; pinch = undefined; moved = false; };
  doc.addEventListener('wheel', wheel, { passive: false });
  doc.addEventListener('pointerdown', down); doc.addEventListener('pointermove', move, { passive: false });
  doc.addEventListener('pointerup', end); doc.addEventListener('pointercancel', end); doc.addEventListener('click', click, true);
  doc.defaultView?.addEventListener('blur', reset);
  return () => {
    clearTimeout(wheelCommit); reset(); doc.removeEventListener('wheel', wheel); doc.removeEventListener('pointerdown', down);
    doc.removeEventListener('pointermove', move); doc.removeEventListener('pointerup', end); doc.removeEventListener('pointercancel', end);
    doc.removeEventListener('click', click, true); doc.defaultView?.removeEventListener('blur', reset);
  };
}
