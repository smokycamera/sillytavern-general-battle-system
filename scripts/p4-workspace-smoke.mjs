import { chromium } from 'playwright-core';
import { readFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
const fixture = JSON.parse(execFileSync(process.execPath, ['node_modules/vite-node/vite-node.mjs', 'scripts/grid-fixture.ts'], { encoding: 'utf8' }));
const html = readFileSync('panel/dist/index.html', 'utf8');
const server = http.createServer((_q, res) => { res.setHeader('content-type', 'text/html;charset=utf-8'); res.end('<!doctype html><body style="margin:0"></body>'); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 844 } }), errors = [];
  page.on('pageerror', (e) => errors.push(e.message)); page.setDefaultTimeout(8000);
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(({ fixture, html }) => {
    const vars = { panel: fixture }; window.readSave = () => vars.panel;
    window.TavernHelper = { getVariables: () => vars, insertOrAssignVariables: (value) => Object.assign(vars, value) };
    window.SillyTavern = { getContext: () => ({ chatId: 'workspace-test' }) };
    const frame = document.createElement('iframe'); frame.id = 'panel'; frame.style = 'position:fixed;inset:0;border:0;width:100%;height:100%'; frame.srcdoc = html; document.body.append(frame);
  }, { fixture, html });
  const p = page.frameLocator('#panel'); await p.locator('.workspace-nav').waitFor();
  const snapshot = await page.evaluate(() => JSON.stringify(window.readSave()));
  for (const tab of ['units', 'inventory', 'reports', 'settings', 'battle']) {
    await p.locator(`.workspace-nav [data-tab="${tab}"]`).click();
    assert.equal(await p.locator('.workspace-page:visible').count(), 1);
    assert.equal(await p.locator(`[data-workspace="${tab}"]`).isVisible(), true);
    assert.equal(await page.evaluate(() => JSON.stringify(window.readSave())), snapshot);
  }
  await p.locator('.workspace-nav [data-tab="units"]').click(); await p.locator('[data-action="gen-toggle"]').click();
  await p.locator('[data-role="gen-name"]').fill('尚未保存的名字');
  await p.locator('.workspace-nav [data-tab="inventory"]').click(); await p.locator('.workspace-nav [data-tab="units"]').click();
  assert.equal(await p.locator('[data-role="gen-name"]').inputValue(), '尚未保存的名字');
  await p.locator('.workspace-nav [data-tab="battle"]').click();
  mkdirSync('panel/smoke-shots', { recursive: true });
  for (const width of [390, 1024]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await p.locator('.workspace-nav button').count(), 5);
    assert.ok(await p.locator('body').evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.ok(await p.locator('.workspace-nav button').evaluateAll((buttons) => buttons.every((b) => b.getBoundingClientRect().width >= 44 && b.getBoundingClientRect().height >= 44)));
    await page.screenshot({ path: `panel/smoke-shots/p4-workspace-${width}.png` });
  }
  assert.deepEqual(errors, []); console.log('✓ 工作区导航：仅一页可见、切页不改存档/RNG、保留未提交表单、390/1024无溢出、导航触控≥44px');
} finally { await browser.close(); await new Promise((r) => server.close(r)); }
