import { chromium } from 'playwright-core';
import { readFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
const fixture = JSON.parse(execFileSync(process.execPath, ['node_modules/vite-node/vite-node.mjs', 'scripts/p4-tactical-fixture.ts', '--json'], { encoding: 'utf8' }));
fixture.battle.snap.rngState = 1;
const html = readFileSync('panel/dist/index.html', 'utf8');
const server = http.createServer((_q, res) => { res.setHeader('content-type', 'text/html;charset=utf-8'); res.end('<!doctype html><body style="margin:0"></body>'); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 844 } }), errors = [];
  page.on('pageerror', (e) => errors.push(e.message)); page.setDefaultTimeout(8000);
  await page.goto('http://127.0.0.1:' + server.address().port);
  await page.evaluate(({ fixture, html }) => {
    const vars = { panel: fixture }; window.readSave = () => vars.panel; window.writes = 0;
    window.TavernHelper = { getVariables: () => vars, insertOrAssignVariables: (value) => { window.writes++; Object.assign(vars, value); } };
    window.SillyTavern = { getContext: () => ({ chatId: 'feedback-ui-test' }) };
    const frame = document.createElement('iframe'); frame.id = 'panel'; frame.style = 'position:fixed;inset:0;border:0;width:100%;height:100%'; frame.srcdoc = html; document.body.append(frame);
  }, { fixture, html });
  const p = page.frameLocator('#panel'); await p.locator('.grid-board').waitFor();
  await p.locator('.command-modes button').filter({ hasText: '技能' }).click();
  await p.locator('.grid-cell[data-cell="31"]').click();
  await p.locator('[data-action="grid-execute"]').click();
  assert.match(await p.locator('.round-feedback').innerText(), /守点步兵.*损失4人/s);
  await p.locator('[data-action="grid-endturn"]').click();
  assert.match(await p.locator('.activation-feedback').innerText(), /铁甲守卫/); // 结束我方后，宿主流程自动完成敌方激活。
  await p.locator('.round-feedback summary').click();
  assert.match(await p.locator('.round-feedback').innerText(), /战技点-3/);
  const saved = await page.evaluate(() => JSON.stringify(window.readSave().battle.snap));
  await page.evaluate((html) => { document.querySelector('#panel').srcdoc = html; }, html);
  await p.locator('.round-feedback').waitFor();
  assert.equal(await page.evaluate(() => JSON.stringify(window.readSave().battle.snap)), saved);
  assert.match(await p.locator('.round-feedback').innerText(), /损失4人/);
  for (let n = 0; n < 8 && await page.evaluate(() => window.readSave().battle.snap.round < 2); n++) {
    if (await p.locator('[data-action="grid-endturn"]').isEnabled()) await p.locator('[data-action="grid-endturn"]').click();
    else await p.locator('[data-action="grid-auto"]').click();
  }
  const rounds = await page.evaluate(() => window.readSave().battle.snap.feedback);
  assert.equal(rounds.previous.round, 1);
  assert.ok(rounds.previous.changes.find((u) => u.id === 'd').lost >= 4);
  const beforeViews = await page.evaluate(() => ({ save: JSON.stringify(window.readSave()), writes: window.writes }));
  mkdirSync('panel/smoke-shots', { recursive: true });
  for (const width of [320, 390, 736, 1024]) for (const theme of ['dark', 'light']) {
    await page.setViewportSize({ width, height: 844 });
    await p.locator('body').evaluate((el, theme) => { el.dataset.theme = theme; scrollTo(0, 0); }, theme);
    assert.ok(await p.locator('body').evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'overflow ' + width + theme);
    assert.ok(await p.locator('.grid-cell, .command-modes button, .workspace-nav button').evaluateAll((buttons) => buttons.every((b) => b.getBoundingClientRect().width >= 44 && b.getBoundingClientRect().height >= 44)));
    for (const cell of [0, 6, 56, 62]) {
      const tile = p.locator('.grid-cell[data-cell="' + cell + '"]');
      await tile.scrollIntoViewIfNeeded();
      assert.ok(await tile.evaluate((el) => {
        const box = el.getBoundingClientRect(), camera = el.closest('.grid-camera').getBoundingClientRect();
        return box.left >= camera.left && box.right <= camera.right && box.top >= camera.top && box.bottom <= camera.bottom;
      }), 'map corner unreachable');
    }
    await p.locator('.round-feedback').scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'panel/smoke-shots/p4-feedback-' + width + '-' + theme + '.png' });
  }
  await p.locator('.grid-cell[data-cell="31"]').focus();
  await p.locator('.grid-cell[data-cell="31"]').press('Enter');
  assert.match(await p.locator('.map-inspector').innerText(), /任务目标/);
  assert.deepEqual(await page.evaluate(() => ({ save: JSON.stringify(window.readSave()), writes: window.writes })), beforeViews);
  assert.deepEqual(errors, []);
  console.log('✓ 正式范围损失/资源/上一激活摘要→重开保留→跨轮保留；320/390/736/1024×深浅主题无溢出、触控≥44px、四角可访问，键盘点选与视觉操作零保存/RNG变化');
} finally { await browser.close(); await new Promise((r) => server.close(r)); }
