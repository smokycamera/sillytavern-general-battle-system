// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installMapGestures } from './map-gestures.js';
const dispose: (() => void)[] = [];
function fixture() {
  const host = document.createElement('div');
  host.innerHTML = '<section class="tactical-workspace" data-map-scale="1"><div class="grid-camera"><div class="grid-stage"><button class="grid-cell">单位</button></div></div></section><button class="outside">外部</button>';
  document.body.append(host);
  const change = vi.fn(), commit = vi.fn(), browse = vi.fn();
  dispose.push(installMapGestures(document, { change, commit, browse }), () => host.remove());
  const cell = host.querySelector<HTMLButtonElement>('.grid-cell')!, camera = host.querySelector<HTMLElement>('.grid-camera')!;
  const pointer = (type: string, pointerId: number, x: number, y: number, pointerType = 'mouse') => cell.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId, pointerType, clientX: x, clientY: y }));
  const click = () => cell.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  return { host, cell, camera, change, commit, browse, pointer, click };
}
afterEach(() => { for (const cleanup of dispose.splice(0)) cleanup(); });
describe('地图缩放与平移事件', () => {
  it('只消费地图内的缩放滚轮，外部和Shift滚轮保留默认行为', () => {
    const { host, cell, change } = fixture();
    const wheel = () => new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -120, clientX: 100, clientY: 100 });
    const outside = wheel(); host.querySelector('.outside')!.dispatchEvent(outside); expect(outside.defaultPrevented).toBe(false); expect(change).not.toHaveBeenCalled();
    const shifted = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120 });
    Object.defineProperty(shifted, 'shiftKey', { value: true }); // Happy DOM does not retain WheelEvent modifier flags.
    cell.dispatchEvent(shifted); expect(shifted.defaultPrevented).toBe(false);
    const inside = wheel(); cell.dispatchEvent(inside); expect(inside.defaultPrevented).toBe(true); expect(change.mock.calls[0]![0]).toBeGreaterThan(1);
  });
  it('普通点选保留，拖动后的兼容点击被拦截，下一次新点选立即恢复', () => {
    const { cell, camera, pointer, click } = fixture(), selected = vi.fn(); cell.addEventListener('click', selected);
    pointer('pointerdown', 1, 100, 100); pointer('pointerup', 1, 100, 100); expect(click()).toBe(true); expect(selected).toHaveBeenCalledTimes(1);
    camera.scrollLeft = 100; camera.scrollTop = 100;
    pointer('pointerdown', 1, 100, 100); pointer('pointermove', 1, 80, 90); pointer('pointerup', 1, 80, 90);
    expect(camera.scrollLeft).toBe(120); expect(camera.scrollTop).toBe(110); expect(click()).toBe(false); expect(selected).toHaveBeenCalledTimes(1);
    pointer('pointerdown', 1, 80, 90); pointer('pointerup', 1, 80, 90); expect(click()).toBe(true); expect(selected).toHaveBeenCalledTimes(2);
  });
  it('双指拉开修改地图比例，松手提交查看偏好并拦截手势点击', () => {
    const { pointer, click, change, commit, camera } = fixture();
    pointer('pointerdown', 1, 100, 100, 'touch'); pointer('pointerdown', 2, 200, 100, 'touch');
    pointer('pointermove', 2, 250, 100, 'touch'); expect(change.mock.calls.at(-1)![0]).toBeCloseTo(1.5);
    pointer('pointerup', 1, 100, 100, 'touch'); pointer('pointerup', 2, 250, 100, 'touch'); expect(commit).toHaveBeenCalledTimes(1); expect(click()).toBe(false);
    expect(camera.classList.contains('map-dragging')).toBe(false);
  });
});
