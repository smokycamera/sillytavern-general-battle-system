import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
const fixtures = ['grid', 'formation'].map((name) => JSON.parse(execFileSync(process.execPath, ['node_modules/vite-node/vite-node.mjs', `scripts/${name}-fixture.ts`], { encoding: 'utf8' })));
fixtures[0].battle.snap.battlefield.objective.limit = 12;
const html = readFileSync('panel/dist/index.html', 'utf8');
const server = http.createServer((_req, res) => {
  res.setHeader('content-type', 'text/html;charset=utf-8');
  res.end(`<!doctype html><script>
    const vars = {};
    window.TavernHelper = { getVariables:()=>vars, insertOrAssignVariables:v=>Object.assign(vars,v) };
    window.SillyTavern = {getContext:()=>({chatId:'auto-battle-test',characterId:0,characters:[{avatar:'test.png'}]})};
    window.readBattle = () => vars.panel.battle.snap;
    window.loadFixture = save => { vars.panel=save; localStorage.clear(); };
    </script><iframe id="panel" style="position:fixed;inset:0;width:100%;height:100%"></iframe>`);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
try {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  for (const fixture of fixtures) {
    await page.evaluate(({ fixture, html }) => { window.loadFixture(fixture); document.querySelector('#panel').srcdoc = html; }, { fixture, html });
    const panel = page.frameLocator('#panel'), toggle = panel.locator('[data-role="full-auto-battle"]');
    await toggle.waitFor(); assert.equal(await toggle.isChecked(), false);
    const before = fixture.battle.snap;
    await toggle.check();
    await page.waitForFunction(({ round, turnIndex }) => {
      const b = window.readBattle(); return b.round !== round || b.turnIndex !== turnIndex;
    }, { round: before.round, turnIndex: before.turnIndex });
    await toggle.uncheck();
    const paused = await page.evaluate(() => JSON.stringify(window.readBattle()));
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => JSON.stringify(window.readBattle())), paused);
    if (fixture.battle.kind === 'small') assert.equal(JSON.parse(paused).battlefield.objective.limit, 60);
    await toggle.check();
    await page.waitForFunction(() => document.querySelector('#panel').contentDocument.querySelector('[data-role="full-auto-battle"]')?.disabled, null, { timeout: 20000 });
    assert.equal(await toggle.isChecked(), false);
    console.log(`PASS ${fixture.battle.kind}: 主控也自动行动、关闭暂停、重开连续至结束并关闭开关`);
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
