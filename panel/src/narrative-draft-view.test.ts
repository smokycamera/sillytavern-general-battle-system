// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { updateRegion } from './view-dom.js';

it('重新渲染多条草稿时，焦点、选区和滚动仍属于当前查看的草稿', () => {
  const root = document.createElement('div'); document.body.append(root);
  const html = '<textarea data-role="narrative-draft" data-id="p1">第一条草稿</textarea>'
    + '<textarea data-role="narrative-draft" data-id="p2">第二条草稿中的错误</textarea>';
  updateRegion(root, html);
  const draft = root.querySelector<HTMLTextAreaElement>('[data-id="p2"]')!;
  draft.focus(); draft.setSelectionRange(7, 9); draft.scrollTop = 150;
  updateRegion(root, html);
  const focused = document.activeElement as HTMLTextAreaElement;
  expect(focused.dataset.id).toBe('p2');
  expect([focused.selectionStart, focused.selectionEnd, focused.scrollTop]).toEqual([7, 9, 150]);
  root.remove();
});
