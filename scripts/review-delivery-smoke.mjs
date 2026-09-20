/** 定点回归：发送回执等待期间发生事实通知，仍写回当前战报；不触碰真实宿主或聊天。 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { chromium } from 'playwright-core';

const { content: loader } = JSON.parse(readFileSync('panel/dist/tavern-battle-script.json', 'utf8'));
const sameText = process.argv.includes('--same-text');
const server = http.createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end('<!doctype html><html><body></body></html>');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1024, height: 850 } });
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate((sameText) => {
    const stores = { a: { panel: { schemaVersion: 2, factRevision: 1, storage: [], rosterIds: [], battle: null,
      selectedReportId: 'review-report', reports: [{ id: 'review-report', card: '回执审查：完整结算', digest: '回执审查：回合纪要', summary: '回执审查：状态摘要', deliveries: {} }] } }, b: {} };
    if (sameText) {
      stores.a.panel.reports.unshift({ ...structuredClone(stores.a.panel.reports[0]), id: 'older-identical-report', deliveries: { '回合纪要（整场）': { status: 'sent' } } });
    }
    const ctx = { chatId: 'a', characterId: 0, characters: [{ avatar: 'review.png' }], chat: [], setExtensionPrompt() {} };
    const handlers = new Map();
    window.__stores = stores; window.__ctx = ctx; window.__sendCount = 0;
    window.__emit = (type, ...args) => { for (const handler of handlers.get(type) ?? []) handler(...args); };
    window.event_types = Object.fromEntries(['GENERATION_AFTER_COMMANDS', 'GENERATION_ENDED', 'GENERATION_STOPPED', 'MESSAGE_RECEIVED', 'MESSAGE_EDITED', 'MESSAGE_SWIPED', 'CHAT_CHANGED', 'MESSAGE_SENT'].map((type) => [type, type]));
    window.eventSource = {
      on(type, handler) { if (!handlers.has(type)) handlers.set(type, new Set()); handlers.get(type).add(handler); },
      off(type, handler) { handlers.get(type)?.delete(handler); },
    };
    window.SillyTavern = { getContext: () => ctx };
    window.TavernHelper = {
      getVariables: () => stores[ctx.chatId],
      insertOrAssignVariables: (value) => Object.assign(stores[ctx.chatId], structuredClone(value)),
      getChatMessages: () => [],
      sendMessageAsUser: () => { window.__sendCount++; return new Promise((resolve) => { window.__finishSend = resolve; }); },
    };
  }, sameText);
  await page.evaluate((code) => {
    const frame = document.createElement('iframe'); frame.hidden = true;
    frame.srcdoc = '<script type="module">' + code + '</script>'; document.body.append(frame);
  }, loader);
  const panel = page.frameLocator('#tavern-battle-panel-window iframe');
  await panel.locator('[data-action="workspace-tab"][data-tab="reports"]').click();
  await panel.locator('[data-action="out-digest"]').click();
  assert.equal(await page.evaluate(() => window.__sendCount), 1, '同文旧战报已发送，不能阻止所选新战报的第一次投递');
  assert.equal(await page.evaluate(() => window.__stores.a.panel.reports.find((r) => r.id === 'review-report').deliveries['回合纪要（整场）'].status), 'sending');
  // 与新候选/剧情同步操作相同的控制器通知，会令面板重建自己的状态副本。
  await page.evaluate(() => window.__tavernBattleController.setStorySync(true));
  await page.evaluate(() => window.__finishSend(true));
  await panel.locator('#toast').filter({ hasText: '已发送给 AI' }).waitFor();
  assert.equal(await page.evaluate(() => window.__stores.a.panel.reports.find((r) => r.id === 'review-report').deliveries['回合纪要（整场）'].status), 'sent', '事实通知后成功回执必须写入当前战报');
  await panel.locator('[data-action="out-digest"]').click();
  assert.equal(await page.evaluate(() => window.__sendCount), 1, '已发送战报不可重复投递');

  await panel.locator('.report-options summary').click();
  await panel.locator('[data-action="out-card"]').click();
  await page.waitForFunction(() => window.__sendCount === 2);
  await page.evaluate(() => { window.__ctx.chatId = 'b'; window.__emit('CHAT_CHANGED'); window.__finishSend(true); });
  await panel.locator('[data-action="out-card"]').waitFor({ state: 'detached' });
  assert.deepEqual(await page.evaluate(() => window.__stores.b), {}, '旧聊天的异步回执不能写入新聊天');
  assert.deepEqual(errors, []);
  console.log('PASS：所选战报身份、控制器通知后的发送回执、重复发送拦截、跨聊天回执隔离（正式分发包，模拟宿主）。');
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
