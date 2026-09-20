import { chromium } from 'playwright-core';
import { readFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';

const fixture = JSON.parse(execFileSync(process.execPath, ['node_modules/vite-node/vite-node.mjs', 'scripts/continuity-fixture.ts'], { encoding: 'utf8' }));
const html = readFileSync('panel/dist/index.html', 'utf8');
const server = http.createServer((_req, res) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end('<!doctype html><div id="host"></div>'); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 900 } });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(({ fixture, html }) => {
    window.testVars = { panel: fixture }; window.testSends = []; window.testFail = false;
    window.SillyTavern = { getContext: () => ({ chatId: 'continuity-test' }) };
    window.TavernHelper = {
      getVariables: () => window.testVars,
      setVariables: ({ type, ...value }) => { if (window.testFail) throw new Error('test save failure'); Object.assign(window.testVars, value); },
      sendMessageAsUser: async (text) => { window.testSends.push(text); return true; },
    };
    const iframe = document.createElement('iframe'); iframe.id = 'panel'; iframe.style = 'width:100%;height:850px'; iframe.srcdoc = html; document.body.append(iframe);
  }, { fixture, html });
  const panel = page.frameLocator('#panel');
  await panel.locator('h1').waitFor();
  const record = () => page.evaluate(() => window.testVars.panel.storage.find((r) => r.id === 'corp-a'));
  const equipment = (await record()).snapshot.weapon;
  // 同时封锁宿主和镜像，战果提交必须保持原档案与未结算状态。
  await page.evaluate(() => { window.testFail = true; });
  await panel.locator('h1').evaluate(() => { Storage.prototype.setItem = () => { throw new Error('test quota'); }; });
  await panel.locator('[data-action="xp-settle"]').click();
  assert.equal((await record()).hp, 560);
  assert.match(await panel.locator('[data-role="save-status"]').innerText(), /未保存/);
  assert.equal(await panel.locator('[data-action="xp-settle"]').count(), 1);
  // 宿主恢复后可按原快照重试，镜像仍失败，宿主确认足以完成原子结果。
  await page.evaluate(() => { window.testFail = false; });
  await panel.locator('[data-action="xp-settle"]').click();
  let r = await record();
  assert.deepEqual([r.hp, r.base.hpMax, r.level, r.xp], [70, 560, 5, 7475]);
  assert.deepEqual(r.snapshot.weapon, equipment);
  console.log('✓ 真实面板：保存失败保留未提交战果；重试 C05 70/560 + L5 + 冻结武器');
  await panel.locator('.workspace-nav [data-tab="units"]').click();
  await panel.locator('[data-action="manage-toggle"]').click();
  await panel.locator('[data-action="storage-edit"][data-id="corp-a"]').click();
  await panel.locator('[data-role="s-hp-current"]').fill('500'); // 此组保留legacy档案回归；V2共用表单见p4-builder。
  await panel.locator('[data-action="storage-save"]').click();
  r = await record();
  assert.equal(r.hp, 500); assert.deepEqual(r.snapshot.weapon, equipment);
  const revision = r.revision;
  await panel.locator('.workspace-nav [data-tab="reports"]').click();
  await panel.locator('.report-options summary').click();
  await panel.locator('[data-action="out-card"]').click();
  assert.equal((await record()).hp, 500); assert.equal((await record()).revision, revision);
  await panel.locator('.workspace-nav [data-tab="battle"]').click();
  await panel.locator('.battle-exit [data-action="battle-close"]').click();
  await panel.locator('.workspace-nav [data-tab="reports"]').click();
  assert.equal((await record()).hp, 500);
  assert.equal(await panel.locator('[data-action="out-card"]').count(), 1);
  if (!await panel.locator('[data-action="out-inject"]').isVisible()) await panel.locator('.report-options summary').click();
  await panel.locator('[data-action="out-inject"]').click();
  assert.equal((await record()).hp, 500);
  assert.equal(await page.evaluate(() => window.testVars.panel.reports.length), 1);
  assert.equal(await page.evaluate(() => window.testSends.length), 2);
  console.log('✓ 真实面板：补员500→发送旧战报→收兵→补发归档摘要，全程500且XP/版本不重复');
  mkdirSync('panel/smoke-shots', { recursive: true });
  await page.screenshot({ path: 'panel/smoke-shots/p1-continuity-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'panel/smoke-shots/p1-continuity-mobile.png' });
  assert.deepEqual(errors, []);
} finally { await browser.close(); await new Promise((r) => server.close(r)); }
