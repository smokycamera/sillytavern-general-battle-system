export const WORKSPACES = [
  ['battle', '战场'], ['units', '队伍'], ['inventory', '配装'], ['reports', '战报'], ['settings', '设置'],
] as const;
export type WorkspaceTab = typeof WORKSPACES[number][0];
export function workspaceNavigation(selected: WorkspaceTab, pending = 0): string {
  return `<nav class="workspace-nav" aria-label="主要工作区">${WORKSPACES.map(([id, label]) => `<button data-action="workspace-tab" data-tab="${id}" aria-current="${selected === id ? 'page' : 'false'}">${label}${id === 'units' && pending ? `<span class="workspace-count">${pending}</span>` : ''}</button>`).join('')}</nav>`;
}
export function workspacePage(tab: WorkspaceTab, selected: WorkspaceTab, content: string): string {
  return `<div class="workspace-page" data-workspace="${tab}" ${selected === tab ? '' : 'hidden'}>${content}</div>`;
}
/** 切页只改变可见性，保留未保存的表单、相机位置与预览；不调用引擎或存档。 */
export function showWorkspace(tab: WorkspaceTab): void {
  for (const page of document.querySelectorAll<HTMLElement>('[data-workspace]')) page.hidden = page.dataset.workspace !== tab;
  for (const button of document.querySelectorAll<HTMLElement>('.workspace-nav [data-tab]')) button.setAttribute('aria-current', button.dataset.tab === tab ? 'page' : 'false');
  window.scrollTo(0, 0);
}
