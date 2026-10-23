// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { updateRegion } from './view-dom.js';

describe('战场原位重绘', () => {
  it('同一行动的状态重绘保留正在播放的箭头及实际格心坐标，新行动正常替换', () => {
    const root = document.createElement('div'); root.dataset.workspace = 'battle'; document.body.append(root);
    const html = (key: string) => `<svg class="battle-trace trace-move" data-trace-key="${key}" viewBox="0 0 700 1300"><line x1="50" x2="150"/></svg>`;
    updateRegion(root, html('one'));
    const trace = root.querySelector('svg')!, line = trace.querySelector('line')!;
    trace.classList.add('trace-active'); line.setAttribute('x2','175');
    updateRegion(root, html('one'));
    expect(root.querySelector('svg')).toBe(trace); expect(trace.classList.contains('trace-active')).toBe(true); expect(line.getAttribute('x2')).toBe('175');
    updateRegion(root, html('two'));
    expect(root.querySelector('svg')).not.toBe(trace); expect(root.querySelector('line')!.getAttribute('x2')).toBe('150'); root.remove();
  });
  it('相同显示保留节点和焦点，但仍把用户临时改动的控件恢复到传入状态', () => {
    const root = document.createElement('div'); root.dataset.workspace = 'battle'; document.body.append(root);
    const html = '<section><article><b>未改变的单位说明</b><input data-role="toggle" type="checkbox"><input data-role="name" value="原值"><select data-role="target"><option value="a" selected>A</option><option value="b">B</option></select><textarea>原草稿</textarea></article></section>';
    updateRegion(root, html);
    const article = root.querySelector('article')!, label = article.querySelector('b')!, inputs = article.querySelectorAll('input'), select = article.querySelector('select')!, draft = article.querySelector('textarea')!;
    inputs[0]!.checked = true; inputs[1]!.value = '临时编辑'; select.value = 'b'; draft.value = '临时草稿'; inputs[1]!.focus();
    updateRegion(root, html);
    expect(root.querySelector('article')).toBe(article); expect(article.querySelector('b')).toBe(label);
    expect(inputs[0]!.checked).toBe(false); expect(inputs[1]!.value).toBe('原值'); expect(select.value).toBe('a'); expect(draft.value).toBe('原草稿');
    expect(document.activeElement).toBe(inputs[1]); root.remove();
  });
  it('改变的内容正常更新，详情开合、相机滚动和相同单位节点保留', () => {
    const root = document.createElement('div'); root.dataset.workspace = 'battle'; document.body.append(root);
    const html = (name: string) => `<section><div class="grid-camera"><button data-cell="1">单位甲</button></div><details data-detail-id="rules"><summary>规则</summary><b>${name}</b></details></section>`;
    updateRegion(root, html('原说明'));
    const camera = root.querySelector<HTMLElement>('.grid-camera')!, unit = root.querySelector('button')!, details = root.querySelector('details')!;
    camera.scrollLeft = 32; camera.scrollTop = 64; details.open = true;
    updateRegion(root, html('新说明'));
    expect(root.querySelector('.grid-camera')).toBe(camera); expect(root.querySelector('button')).toBe(unit);
    expect(camera.scrollLeft).toBe(32); expect(camera.scrollTop).toBe(64); expect(details.open).toBe(true); expect(details.textContent).toContain('新说明'); root.remove();
  });
});
