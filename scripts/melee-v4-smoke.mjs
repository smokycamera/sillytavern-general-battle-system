import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
const fixture = (...flags) => JSON.parse(execFileSync(process.execPath, ['node_modules/vite-node/vite-node.mjs', 'scripts/melee-v4-fixture.ts', ...flags], { encoding: 'utf8' }));
const cases = [['small', fixture()], ['mass', fixture('--mass')]], html = readFileSync('panel/dist/index.html', 'utf8'), checks = [], errors = [];
const server = http.createServer((_req, res) => { res.setHeader('content-type', 'text/html;charset=utf-8'); res.end(`<!doctype html><script>
const vars={};window.TavernHelper={getVariables:()=>vars,insertOrAssignVariables:v=>Object.assign(vars,v)};
window.SillyTavern={getContext:()=>({chatId:'melee-v4-smoke',characterId:0,characters:[{avatar:'fixture.png'}]})};
window.loadFixture=save=>{vars.panel=save;localStorage.clear();};window.readPanel=()=>vars.panel;
</script><iframe id="panel" style="border:0;position:fixed;inset:0;width:100%;height:100%"></iframe>`); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
mkdirSync('panel/smoke-shots', { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`); const p = page.frameLocator('#panel');
  for (const [mode, save] of cases) {
    await page.evaluate(({ save, html }) => { window.loadFixture(save); document.querySelector('#panel').srcdoc = html; }, { save, html });
    await p.locator(mode === 'small' ? '.grid-board' : '.formation-grid').waitFor();
    if (mode === 'small') { await p.locator('.command-modes button').filter({ hasText: '攻击' }).click(); await p.locator('[data-role="grid-target"]').selectOption('D'); }
    else { await p.locator('.formation-adjust > summary').click(); await p.locator('[data-role="formation-order"]').selectOption('attack'); await p.locator('[data-role="formation-target"]').selectOption('D'); }
    const command = p.locator(mode === 'small' ? '.grid-command' : '.formation-command');
    assert.match(await command.innerText(), /穿透\s*8/); assert.match(await command.innerText(), /30%/);
    if (mode === 'small') { await p.locator('[data-detail-id="grid-calculation"] > summary').click(); assert.match(await command.innerText(), /剑术格挡/); }
    assert.ok(await p.locator('html').evaluate(el => el.scrollWidth - innerWidth <= 1), '390宽度无横向溢出');
    await command.evaluate(el => el.scrollIntoView({ block: 'start' })); await page.screenshot({ path: `panel/smoke-shots/melee-v4-${mode}-390.png` });
    if (mode === 'small') await p.locator('.command-finish [data-action="grid-execute"]').click();
    else { await p.locator('[data-action="formation-issue"]').click(); await p.locator('.mass-controls [data-action="mass-resolve"]').click(); }
    const after = await page.evaluate(() => window.readPanel());
    const result = after.battle.snap.log.find(e => e.resolution?.attackerId === 'A')?.resolution;
    assert.ok(result?.finalDamage > 0); assert.equal(result.penetration, 8); assert.equal(result.penetrationFactor, .3);
    const snapshot = JSON.stringify(after.battle.snap);
    await page.evaluate(html => { document.querySelector('#panel').srcdoc = html; }, html); await p.locator(mode === 'small' ? '.grid-board' : '.formation-grid').waitFor();
    assert.equal(JSON.stringify((await page.evaluate(() => window.readPanel())).battle.snap), snapshot);
    checks.push({ mode, reach: 2, penetration: result.penetration, factor: result.penetrationFactor, actualDamage: result.finalDamage, snapshotPreserved: true, mobileOverflow: false });
  }
  await p.locator('.workspace-nav [data-tab="inventory"]').click();
  await p.locator('[data-role="inventory-unit"]').selectOption('A'); await p.locator('.item-rules > summary').first().click();
  const text = await p.locator('body').innerText(); assert.match(text, /长柄支援/); assert.match(text, /格子射程2／会战2阵距/);
  await p.locator('[data-role="inventory-unit"]').selectOption('D'); await p.locator('.item-rules > summary').first().click(); assert.match(await p.locator('body').innerText(), /剑术攻守/);
  assert.deepEqual(errors, []); writeFileSync('engine/sim/out/melee-v4-browser.json', JSON.stringify({ checks, errors }, null, 2) + '\n'); console.log(JSON.stringify({ checks, errors }, null, 2));
} finally { await browser.close(); await new Promise(r => server.close(r)); }
