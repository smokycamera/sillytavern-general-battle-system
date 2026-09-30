// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { nativeFixture } from '../../runtime/tests/native-fixture.js';
import { saveLlmSettings } from './llm-settings.js';
import { parseProtocol } from './protocol.js';

vi.mock('./panel-runtime.js', async () => import('../../extension/src/panel-runtime.js'));
afterEach(() => { window.dispatchEvent(new Event('pagehide')); vi.unstubAllGlobals(); });

it('AI扫描确认/取消、要求输入、顺序错误跳转及字段恢复可在原生面板完成', async () => {
  const f = nativeFixture(); await f.service.start(); localStorage.clear();
  try {
    f.context.chat!.push({ is_user: false, mes: '城门有一名友军和一名敌军。', gen_finished: 'done', swipe_id: 0 });
    const originalChat = structuredClone(f.context.chat);
    Object.assign(window, { __tavernBattleNative: { service: f.service, messages: {} }, __TAURITAVERN__: {}, SillyTavern: { getContext: () => f.context } });
    saveLlmSettings({ enabled: false, selectBattleScale: false, windowSize: 6, url: 'https://gateway.example/v1', token: 'fixture-private', model: 'scan-model', models: [] });
    const request = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ choices: [{ message: { content: '<tb>\n<spawn name="友军" side="ally" scale="hero" weapon="未知L3"/>\n<spawn name="敌军" side="enemy" scale="hero" skills="治疗L2,未知技能"/>\n</tb>' } }] })));
    vi.stubGlobal('fetch', request);
    document.body.innerHTML = '<div id="app"></div><div id="toast"></div>';
    await import('./main.js');
    const click = (action: string) => { const button = document.querySelector<HTMLButtonElement>(`[data-action="${action}"]`); expect(button, action).not.toBeNull(); button!.click(); };
    document.querySelector<HTMLButtonElement>('[data-action="workspace-tab"][data-tab="units"]')!.click();
    expect([...document.querySelectorAll('.team-workspace .section-heading [data-action]')].map(el => (el as HTMLElement).dataset.action)).toEqual(['ai-scan', 'gen-toggle']);
    click('ai-scan'); expect(document.querySelector('[data-role="ai-scan-requirements"]')).not.toBeNull();
    click('ai-scan-cancel'); expect(request).not.toHaveBeenCalled();
    click('ai-scan');
    const requirements = document.querySelector<HTMLTextAreaElement>('[data-role="ai-scan-requirements"]')!;
    requirements.value = '按正文补齐双方'; requirements.dispatchEvent(new Event('input', { bubbles: true })); click('ai-scan-confirm');
    await vi.waitFor(() => expect(f.service.snapshot().proposals).toHaveLength(1));
    await vi.waitFor(() => expect(document.querySelector('[data-role="ai-scan-requirements"]')).toBeNull());
    const payload = JSON.parse(String(request.mock.calls[0]![1]!.body));
    expect(JSON.parse(payload.messages[1].content).玩家要求).toBe('按正文补齐双方');
    const draft = document.querySelector<HTMLTextAreaElement>('[data-role="narrative-draft"]')!;
    click('narrative-error'); expect(draft.value.slice(draft.selectionStart, draft.selectionEnd)).toContain('weapon=');
    click('narrative-error'); expect(draft.value.slice(draft.selectionStart, draft.selectionEnd)).toBe('未知技能');
    click('narrative-recognized');
    await vi.waitFor(() => expect(document.querySelector<HTMLTextAreaElement>('[data-role="narrative-draft"]')!.value).not.toContain('未知'));
    const recovered = document.querySelector<HTMLTextAreaElement>('[data-role="narrative-draft"]')!.value;
    expect(parseProtocol(recovered).events).toHaveLength(2); expect(recovered).toContain('name="友军"'); expect(recovered).not.toContain('未知');
    click('narrative-correct'); await vi.waitFor(() => expect(f.service.snapshot().proposals!.at(-1)!.status).toBe('pending'));
    click('narrative-approve'); await vi.waitFor(() => expect(f.service.snapshot().storage).toHaveLength(2));
    await vi.waitFor(() => expect(document.body.hasAttribute('aria-busy')).toBe(false));
    const toggle = document.querySelector<HTMLInputElement>('[data-role="story-sync"]')!; toggle.click();
    await vi.waitFor(() => expect(f.service.snapshot().autoApprove).toBe(true));
    expect(f.context.chat).toEqual(originalChat);
  } finally { f.service.dispose(); delete (window as unknown as Record<string, unknown>).__tavernBattleNative; }
});
