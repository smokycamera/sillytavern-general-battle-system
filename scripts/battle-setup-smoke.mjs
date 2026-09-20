import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
const capacity = process.argv.includes('--capacity');
const fixture = JSON.parse(execFileSync(process.execPath, ['--no-opt', 'node_modules/vite-node/vite-node.mjs', 'scripts/battle-setup-fixture.ts', ...(capacity ? ['--capacity'] : [])], { encoding: 'utf8' }));
const html = readFileSync('panel/dist/index.html', 'utf8');
const server = http.createServer((_req, res) => {
  res.setHeader('content-type', 'text/html;charset=utf-8');
  res.end(`<!doctype html><script>
  const vars={panel:${JSON.stringify(fixture)}};
  window.TavernHelper={getVariables:()=>vars,insertOrAssignVariables:(value)=>Object.assign(vars,value)};
  window.SillyTavern={getContext:()=>({chatId:'setup-test',characterId:0,characters:[{avatar:'test.png'}]})};
  window.readPanel=()=>vars.panel;
  window.loadSave=(save)=>{vars.panel=save;localStorage.clear()};
  </script><iframe id="panel" style="border:0;position:fixed;inset:0;width:100%;height:100%"></iframe>`);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }), errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const p = page.frameLocator('#panel');
  const reopen = async () => { await page.evaluate((html) => { document.querySelector('#panel').srcdoc = html; }, html); };
  if (capacity) {
    await reopen(); await p.locator('.grid-board').waitFor();
    const before = await page.evaluate(() => window.readPanel().battle.snap);
    assert.equal(before.combatants.length, 16);
    mkdirSync('panel/smoke-shots', { recursive: true });
    const widths = process.argv.includes('--compact-only') ? [320, 736] : [320, 390, 736, 1024];
    for (const width of widths) for (const theme of ['dark', 'light']) {
      await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
      await p.locator('body').evaluate((el, theme) => { el.dataset.theme = theme; }, theme);
      assert.ok(await p.locator('body').evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      assert.equal(await p.locator('.grid-cell').count(), 63);
      assert.ok(await p.locator('.grid-cell').evaluateAll((cells) => cells.every((c) => c.getBoundingClientRect().width >= 44 && c.getBoundingClientRect().height >= 44)));
      for (const cell of [0, 6, 56, 62]) await p.locator('.grid-cell[data-cell="' + cell + '"]').click();
      await p.locator('.grid-board').scrollIntoViewIfNeeded();
      await page.screenshot({ path: 'panel/smoke-shots/p6-capacity-' + width + '-' + theme + '.png' });
      assert.deepEqual(await page.evaluate(() => window.readPanel().battle.snap), before);
    }
    if (!process.argv.includes('--compact-only')) {
    await page.setViewportSize({ width: 390, height: 844 });
    await p.locator('[data-action="grid-mode"][data-mode="move"]').click();
    const actor = before.combatants.find((u) => u.id === before.turnOrder[before.turnIndex]);
    const cells = await p.locator('.grid-cell.reachable').evaluateAll((cells) => cells.map((c) => Number(c.dataset.cell)));
    const destination = cells.filter((n) => n !== actor.pos).sort((a, b) =>
      (Math.abs(a % 7 - actor.pos % 7) + Math.abs(Math.floor(a / 7) - Math.floor(actor.pos / 7))) -
      (Math.abs(b % 7 - actor.pos % 7) + Math.abs(Math.floor(b / 7) - Math.floor(actor.pos / 7))))[0];
    assert.notEqual(destination, undefined);
    await p.locator('.grid-cell[data-cell="' + destination + '"]').click();
    await p.locator('.move-preview [data-action="grid-move"]').click();
    const moved = await page.evaluate(() => window.readPanel().battle.snap);
    assert.equal(moved.combatants.find((u) => u.id === actor.id).pos, destination);
    assert.ok(moved.movementSpent.find(([id]) => id === actor.id)[1] > 0);
    await reopen(); await p.locator('.grid-board').waitFor();
    assert.deepEqual(await page.evaluate(() => window.readPanel().battle.snap), moved);
    }
    console.log('✓ 16单位/当前生成地图：' + widths.length * 2 + '组视口主题、63格可达、触控/无溢出、视图不改事实' + (process.argv.includes('--compact-only') ? '；仅复核紧凑标签' : '、真实移动扣费与重开'));
  } else if (process.argv.includes('--intercept-only')) {
    await reopen(); await p.locator('[data-action="small-start"]').waitFor();
    await p.locator('.preparation-options > summary').click();
    await p.locator('[data-role="objective-mode"]').selectOption('intercept');
    assert.equal((await page.evaluate(() => window.readPanel())).objectiveMode, 'intercept');
    await reopen(); await p.locator('[data-action="small-start"]').waitFor();
    await p.locator('.preparation-options > summary').click();
    assert.equal(await p.locator('[data-role="objective-mode"]').inputValue(), 'intercept');
    await p.locator('[data-action="small-start"]').click(); await p.locator('.grid-camera').waitFor();
    const snap = await page.evaluate(() => window.readPanel().battle.snap);
    assert.equal(snap.battlefield.objective.kind, 'escape');
    assert.equal(snap.battlefield.objective.defenderWins, true);
    assert.equal(snap.combatants.find((u) => u.id === snap.battlefield.objective.unitId).side, 'enemy');
    assert.equal(snap.battlefield.objective.cell, 59);
    await p.locator('.objective-status').click();
    assert.match(await p.locator('.objective-rule').innerText(), /我方拦截，敌方护送/);
    assert.match(await p.locator('.objective-rule').innerText(), /拦截方获胜/);
    mkdirSync('panel/smoke-shots', { recursive: true });
    await page.screenshot({ path: 'panel/smoke-shots/p6-intercept-390.png' });
    await reopen(); await p.locator('.grid-camera').waitFor();
    assert.deepEqual(await page.evaluate(() => window.readPanel().battle.snap), snap);
    console.log('✓ 正式准备界面选择敌方护送拦截→设置重开→敌方对象/我方边缘出口→双方任务说明→本场快照冻结重开');
  } else {
  await reopen(); await p.locator('[data-action="small-start"]').waitFor();
  assert.match(await p.locator('.battle-preparation').innerText(), /适合战术地图/);
  await p.locator('[data-action="small-start"]').click(); await p.locator('.grid-camera').waitFor();
  const first = await page.evaluate(() => window.readPanel().battle.snap);
  assert.equal(first.battlefield.width, 7); assert.ok(first.battlefield.tiles.includes('forest'));
  assert.ok(first.combatants.every((u) => u.scale === 'company' && u.base.hpMax === 5));
  await reopen(); await p.locator('.grid-camera').waitFor();
  const restored = await page.evaluate(() => window.readPanel().battle.snap);
  assert.deepEqual(restored.battlefield, first.battlefield); assert.equal(restored.rngState, first.rngState);
  const large = structuredClone(fixture);
  for (const record of large.storage) { record.hp = 40; record.base.hpMax = 40; record.snapshot.hp = 40; record.snapshot.base.hpMax = 40; }
  await page.evaluate((save) => window.loadSave(save), large); await reopen(); await p.locator('[data-action="small-start"]').waitFor();
  const many = structuredClone(large);
  many.storage = Array.from({ length: 18 }, (_, n) => {
    const record = structuredClone(large.storage[n < 9 ? 0 : 1]);
    record.id = 'unit-' + n; record.snapshot.id = record.id; return record;
  });
  many.rosterIds = many.storage.map((u) => u.id); many.protagonistId = 'unit-0';
  await page.evaluate((save) => window.loadSave(save), many); await reopen(); await p.locator('[data-action="mass-start"]').waitFor();
  await p.locator('[data-action="mass-start"]').click(); await p.locator('.formation-grid').waitFor();
  const mass = await page.evaluate(() => window.readPanel().battle);
  assert.equal(mass.kind, 'mass'); assert.equal(mass.snap.roundLimit, 40);
  console.log('✓ 5人小队与40对40都按小战→森林种子地图/重开精确保持→18支独立单位自动会战/本场40轮');
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); await new Promise((r) => server.close(r)); }
